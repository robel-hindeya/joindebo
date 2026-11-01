import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { hashSecret } from '../auth/pin';
import { SettingsService } from '../settings/settings.service';
import { AdminAuthService } from './admin-auth.service';
import { RecoveryService, eatTime } from './recovery.service';
import { decryptSecret, encryptSecret, newBackupCodes, newSecret, otpauthUri, verifyTotp } from './totp';

/**
 * AdminTeamRecovery / AdminRecoveryApprove (Owners decide another admin's
 * reset) and AdminAccount (new backup codes, a new phone, the new-device alert).
 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminRecoveryController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly auth: AdminAuthService,
    private readonly recovery: RecoveryService,
    private readonly settings: SettingsService,
  ) {}

  private owner(a: Actor) {
    if (a.adminRole !== 'owner') throw forbidden();
  }

  /** "An account reset is waiting for you" (Settings → Team). */
  @Get('recoveries')
  async list(@CurrentActor() a: Actor) {
    this.owner(a);
    return this.sql`
      select r.id, r.status, r.owner_named as "ownerNamed", r.requested_at as "requestedAt", r.ready_at as "readyAt",
        r.admin_id = ${a.id} as mine, u.name, u.email, d.name as "decidedBy"
      from tc.admin_recovery r join tc.admin_user u on u.id = r.admin_id left join tc.admin_user d on d.id = r.decided_by
      where r.status in ('pending', 'approved') order by r.requested_at`;
  }

  /** Approve: password and a fresh code (plan, section 8); never your own; the new phone waits. */
  @Post('recoveries/:id/approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.owner(a);
    const [r] = await this.sql<{ admin_id: string }[]>`select admin_id from tc.admin_recovery where id = ${id} and status = 'pending'`;
    if (!r) throw notFound();
    if (r.admin_id === a.id) throw forbidden('not_your_own');
    const { admin, proof } = await this.auth.reauth(a, b, req.ip);
    const hours = await this.settings.number('auth.admin_recovery_wait_hours', 24);
    return this.sql.begin(async (tx) => {
      await this.auth.use(tx, admin, proof, req.ip);
      const [x] = await tx<{ ready_at: Date; name: string; email: string }[]>`
        update tc.admin_recovery q set status = 'approved', decided_by = ${a.id}, decided_at = now(), ready_at = now() + make_interval(hours => ${hours})
        from tc.admin_user u where q.id = ${id} and q.status = 'pending' and u.id = q.admin_id returning q.ready_at, u.name, u.email`;
      if (!x) throw conflict('already_decided');
      const [me] = await tx<{ name: string }[]>`select name from tc.admin_user where id = ${a.id}`;
      await this.recovery.mail(tx, x.email, 'recovery_approved', 'RecApproved', { a: me.name, b: eatTime(x.ready_at) });
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type: 'admin.recovery_approved', text: `Approved the account reset of ${x.name}`, detail: { recoveryId: id, readyAt: x.ready_at } });
      return { status: 'approved', readyAt: x.ready_at };
    });
  }

  @Post('recoveries/:id/deny')
  async deny(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    this.owner(a);
    return this.sql.begin(async (tx) => {
      const [x] = await tx<{ name: string; email: string; admin_id: string }[]>`
        update tc.admin_recovery q set status = 'denied', decided_by = ${a.id}, decided_at = now()
        from tc.admin_user u where q.id = ${id} and q.status in ('pending', 'approved') and q.admin_id <> ${a.id} and u.id = q.admin_id
        returning u.name, u.email, q.admin_id`;
      if (!x) throw notFound();
      const [me] = await tx<{ name: string }[]>`select name from tc.admin_user where id = ${a.id}`;
      await this.recovery.mail(tx, x.email, 'recovery_denied', 'RecDenied', { a: me.name });
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type: 'admin.recovery_denied', text: `Denied the account reset of ${x.name}`, detail: { recoveryId: id } });
      return { status: 'denied' };
    });
  }

  /** AdminAccount "Make new backup codes": a code from the app; the old codes stop working. */
  @Post('me/backup-codes')
  async backupCodes(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const admin = await this.auth.load(a.id);
    const proof = await this.auth.checkCode(admin, { code: b.code }, req.ip);
    const codes = newBackupCodes();
    const hashes = await Promise.all(codes.map((c) => hashSecret(c)));
    return this.sql.begin(async (tx) => {
      await this.auth.use(tx, admin, proof, req.ip);
      await tx`update tc.admin_user set backup_code_hashes = ${hashes} where id = ${a.id}`;
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type: 'admin.backup_codes_new', text: 'Made new backup codes' });
      return { backupCodes: codes };
    });
  }

  /** AdminAccount "Set up a new phone": prove the old one, then scan a new key. */
  @Post('me/new-phone')
  async newPhone(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const admin = await this.auth.load(a.id);
    const proof = await this.auth.checkCode(admin, { code: b.code }, req.ip);
    const secret = newSecret();
    await this.sql.begin(async (tx) => {
      await this.auth.use(tx, admin, proof, req.ip);
      await tx`update tc.admin_user set totp_pending_enc = ${encryptSecret(secret)} where id = ${a.id}`;
    });
    return { secret, otpauth: otpauthUri(secret, admin.email) };
  }

  @Post('me/new-phone/finish')
  async newPhoneFinish(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const admin = await this.auth.load(a.id);
    if (!admin.totp_pending_enc) throw badRequest('setup_expired');
    const step = verifyTotp(decryptSecret(admin.totp_pending_enc), b.code, 0);
    if (step === null) return this.auth.fail(admin, req.ip, 'code');
    const codes = newBackupCodes();
    const hashes = await Promise.all(codes.map((c) => hashSecret(c)));
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update tc.admin_user set totp_secret_enc = totp_pending_enc, totp_pending_enc = null, totp_last_step = ${step}, backup_code_hashes = ${hashes}
        where id = ${a.id} and totp_pending_enc = ${admin.totp_pending_enc} returning id`;
      if (!rows.length) throw badRequest('setup_expired');
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type: 'admin.authenticator_replaced', text: 'Set up a new phone' });
      return { backupCodes: codes };
    });
  }

  @Post('me/device-alert')
  async deviceAlert(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (typeof b.on !== 'boolean') throw badRequest('bad_value');
    return this.sql.begin(async (tx) => {
      await tx`update tc.admin_user set new_device_alert = ${b.on as boolean} where id = ${a.id}`;
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type: 'admin.device_alert', text: `Turned the new-device alert ${b.on ? 'on' : 'off'}` });
      return { on: b.on };
    });
  }
}
