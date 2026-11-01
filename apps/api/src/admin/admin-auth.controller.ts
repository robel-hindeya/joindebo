import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, unauthorized } from '../common/api-error';
import { requestMeta } from '../auth/auth.guard';
import { burnTime, hashSecret } from '../auth/pin';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { SettingsService } from '../settings/settings.service';
import { TokensService } from '../auth/tokens.service';
import { AdminAuthService } from './admin-auth.service';
import { RecoveryService } from './recovery.service';
import { decryptSecret, encryptSecret, newBackupCodes, newSecret, otpauthUri, verifyTotp } from './totp';

/**
 * Admin sign-in at /administrator (AdminLogin*): email and password, then a
 * 6-digit authenticator code or a backup code. The first sign-in sets up the
 * authenticator and shows 10 backup codes once.
 */
@Controller('admin/auth')
@UseGuards(RateLimitGuard)
export class AdminAuthController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tokens: TokensService,
    private readonly auth: AdminAuthService,
    private readonly settings: SettingsService,
    private readonly recovery: RecoveryService,
  ) {}

  /** The rules printed under the sign-in box (AdminLogin): tries, lock time and idle sign-out. */
  @Get('rules')
  async rules() {
    return {
      tries: await this.settings.number('auth.admin.max_failed_attempts', 5),
      lockMinutes: await this.settings.number('auth.lock_minutes', 15),
      idleMinutes: await this.settings.number('auth.admin_idle_signout_minutes', 30),
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const email = String(b.email ?? '').trim().toLowerCase();
    const [row] = await this.sql<{ id: string }[]>`select id from tc.admin_user where email = ${email} and status = 'active'`;
    if (!row) {
      await burnTime(String(b.password ?? ''));
      throw unauthorized('wrong_login');
    }
    const a = await this.auth.load(row.id);
    await this.auth.checkPassword(a, b.password, req.ip);
    // AdminLoginRecover: an approved reset sets up a new phone once the wait is over.
    const rec = await this.recovery.open(this.sql, a.id);
    if (rec?.status === 'approved') {
      if (rec.ready_at!.getTime() > Date.now()) return { next: 'wait', readyAt: rec.ready_at };
      return { next: 'setup', ticket: await this.tokens.ticket('admin_setup', { sub: a.id, rec: rec.id }, 10) };
    }
    const next = a.totp_secret_enc ? 'code' : 'setup';
    return { next, ticket: await this.tokens.ticket(`admin_${next}`, { sub: a.id }, 10) };
  }

  /** First sign-in: a new authenticator secret to scan (or type). It counts only once a code from it works. */
  @Post('setup/start')
  @HttpCode(200)
  async setupStart(@Body() b: Record<string, unknown>) {
    const t = await this.tokens.readTicket<{ sub: string; rec?: string }>(b.ticket, 'admin_setup');
    const a = await this.auth.load(t.sub);
    if (a.totp_secret_enc && !(t.rec && await this.readyRecovery(a.id, t.rec))) throw badRequest('already_set_up');
    const secret = newSecret();
    await this.sql`update tc.admin_user set totp_pending_enc = ${encryptSecret(secret)} where id = ${a.id}`;
    return { secret, otpauth: otpauthUri(secret, a.email) };
  }

  @Post('setup/finish')
  @HttpCode(200)
  async setupFinish(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ sub: string; rec?: string }>(b.ticket, 'admin_setup');
    const a = await this.auth.load(t.sub);
    const rec = t.rec && await this.readyRecovery(a.id, t.rec) ? t.rec : null;
    if (a.totp_secret_enc && !rec) throw badRequest('already_set_up');
    if (!a.totp_pending_enc) throw badRequest('setup_expired');
    const step = verifyTotp(decryptSecret(a.totp_pending_enc), b.code, 0);
    if (step === null) return this.auth.fail(a, req.ip, 'code');
    const backup = newBackupCodes();
    const hashes = await Promise.all(backup.map((c) => hashSecret(c)));
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update tc.admin_user set totp_secret_enc = totp_pending_enc, totp_pending_enc = null, totp_last_step = ${step},
          backup_code_hashes = ${hashes}, failed_attempts = 0, last_login_at = now()
        where id = ${a.id} and (totp_secret_enc is null or ${rec}::uuid is not null) and totp_pending_enc = ${a.totp_pending_enc} returning id`;
      if (!rows.length) throw badRequest('setup_expired');
      if (rec) {
        const [me] = await tx<{ id: string; email: string; name: string }[]>`select id, email, name from tc.admin_user where id = ${a.id}`;
        await this.recovery.finish(tx, me, rec);
        await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.role, ip: req.ip, type: 'admin.recovery_done', text: 'Set up a new phone after an approved reset', detail: { recoveryId: rec } });
      }
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.role, ip: req.ip, type: 'admin.authenticator_set', text: 'Set up the authenticator' });
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.role, ip: req.ip, type: 'admin.signin', text: 'Signed in' });
      // The backup codes are shown this once; only their hashes are kept.
      return { ...(await this.tokens.issue(tx, { type: 'admin', id: a.id, adminRole: a.role }, requestMeta(req))), backupCodes: backup };
    });
  }

  @Post('code')
  @HttpCode(200)
  async code(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ sub: string }>(b.ticket, 'admin_code');
    const a = await this.auth.load(t.sub);
    const proof = await this.auth.checkCode(a, b, req.ip);
    return this.sql.begin(async (tx) => {
      await this.auth.use(tx, a, proof, req.ip);
      await tx`update tc.admin_user set last_login_at = now() where id = ${a.id}`;
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.role, ip: req.ip, type: 'admin.signin', text: 'Signed in' });
      const [me] = await tx<{ id: string; email: string; name: string; new_device_alert: boolean }[]>`select id, email, name, new_device_alert from tc.admin_user where id = ${a.id}`;
      await this.recovery.newDevice(tx, me, req.header('user-agent'));
      return this.tokens.issue(tx, { type: 'admin', id: a.id, adminRole: a.role }, requestMeta(req));
    });
  }

  /** True while this approved reset is past its wait. */
  private async readyRecovery(adminId: string, recId: string): Promise<boolean> {
    const [r] = await this.sql`select 1 from tc.admin_recovery where id = ${recId} and admin_id = ${adminId} and status = 'approved' and ready_at <= now()`;
    return !!r;
  }

  /**
   * AdminLoginRecover "Ask for a reset": the same answer whether or not the email
   * belongs to an admin, so it cannot be used to find accounts.
   */
  @Post('recover')
  @HttpCode(200)
  async recover(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const email = String(b.email ?? '').trim().toLowerCase();
    const owner = typeof b.owner === 'string' ? b.owner.trim().slice(0, 120) : '';
    if (!email.includes('@') || !owner) throw badRequest('bad_request');
    await this.sql.begin(async (tx) => {
      const [a] = await tx<{ id: string; email: string; name: string; role: string }[]>`select id, email, name, role from tc.admin_user where email = ${email} and status = 'active'`;
      if (!a || await this.recovery.open(tx, a.id)) return;
      const [r] = await tx<{ id: string }[]>`insert into tc.admin_recovery (admin_id, owner_named, ip) values (${a.id}, ${owner}, ${req.ip ?? null}) returning id`;
      await this.recovery.mail(tx, a.email, 'recovery_requested', 'RecRequested', { a: a.email, b: owner });
      for (const o of await this.recovery.otherOwners(tx, a.id)) await this.recovery.mail(tx, o.email, 'recovery_to_approve', 'RecToApprove', { a: a.name, b: owner });
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.role, ip: req.ip, type: 'admin.recovery_requested', text: `Asked for an account reset, naming ${owner}`, detail: { recoveryId: r.id } });
    });
    return { ok: true };
  }
}
