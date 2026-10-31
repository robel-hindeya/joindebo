import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, unauthorized } from '../common/api-error';
import { requestMeta } from '../auth/auth.guard';
import { burnTime, hashSecret } from '../auth/pin';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { TokensService } from '../auth/tokens.service';
import { AdminAuthService } from './admin-auth.service';
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
  ) {}

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
    const next = a.totp_secret_enc ? 'code' : 'setup';
    return { next, ticket: await this.tokens.ticket(`admin_${next}`, { sub: a.id }, 10) };
  }

  /** First sign-in: a new authenticator secret to scan (or type). It counts only once a code from it works. */
  @Post('setup/start')
  @HttpCode(200)
  async setupStart(@Body() b: Record<string, unknown>) {
    const t = await this.tokens.readTicket<{ sub: string }>(b.ticket, 'admin_setup');
    const a = await this.auth.load(t.sub);
    if (a.totp_secret_enc) throw badRequest('already_set_up');
    const secret = newSecret();
    await this.sql`update tc.admin_user set totp_pending_enc = ${encryptSecret(secret)} where id = ${a.id}`;
    return { secret, otpauth: otpauthUri(secret, a.email) };
  }

  @Post('setup/finish')
  @HttpCode(200)
  async setupFinish(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ sub: string }>(b.ticket, 'admin_setup');
    const a = await this.auth.load(t.sub);
    if (a.totp_secret_enc) throw badRequest('already_set_up');
    if (!a.totp_pending_enc) throw badRequest('setup_expired');
    const step = verifyTotp(decryptSecret(a.totp_pending_enc), b.code, 0);
    if (step === null) return this.auth.fail(a, req.ip, 'code');
    const backup = newBackupCodes();
    const hashes = await Promise.all(backup.map((c) => hashSecret(c)));
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update tc.admin_user set totp_secret_enc = totp_pending_enc, totp_pending_enc = null, totp_last_step = ${step},
          backup_code_hashes = ${hashes}, failed_attempts = 0, last_login_at = now()
        where id = ${a.id} and totp_secret_enc is null and totp_pending_enc = ${a.totp_pending_enc} returning id`;
      if (!rows.length) throw badRequest('setup_expired');
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
      return this.tokens.issue(tx, { type: 'admin', id: a.id, adminRole: a.role }, requestMeta(req));
    });
  }
}
