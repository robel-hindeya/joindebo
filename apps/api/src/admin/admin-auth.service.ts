import { Inject, Injectable } from '@nestjs/common';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { badRequest, locked, unauthorized } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { isLocked, recordWrongPin } from '../auth/lockout';
import { verifySecret } from '../auth/pin';
import type { AdminRole } from './accounts';
import { decryptSecret, verifyTotp } from './totp';

export interface AdminRow {
  id: string;
  email: string;
  role: AdminRole;
  password_hash: string | null;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_last_step: string;
  backup_code_hashes: string[];
  locked_until: Date | null;
}

/** A proven second factor, applied with `use` inside the action's transaction. */
export type Proof = { kind: 'totp'; step: number } | { kind: 'backup'; index: number };

/**
 * Checks shared by admin sign-in and re-authentication (kill switch, money
 * exports): password, authenticator code or backup code. Wrong passwords and
 * wrong codes share one counter; at auth.admin.max_failed_attempts the account
 * locks for auth.lock_minutes.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {}

  async load(id: string): Promise<AdminRow> {
    const [a] = await this.sql<AdminRow[]>`
      select id, email, role, password_hash, totp_secret_enc, totp_pending_enc, totp_last_step, backup_code_hashes, locked_until
      from tc.admin_user where id = ${id} and status = 'active'`;
    if (!a) throw unauthorized('bad_ticket');
    if (isLocked(a)) throw locked(a.locked_until!);
    return a;
  }

  /** One failed try; the last allowed one locks the account. */
  async fail(a: AdminRow, ip: string | undefined, what: 'password' | 'code'): Promise<never> {
    const max = await this.settings.number('auth.admin.max_failed_attempts', 5);
    const minutes = await this.settings.number('auth.lock_minutes', 15);
    const r = await this.sql.begin(async (tx) => {
      const r = await recordWrongPin(tx, 'admin_user', a.id, max, minutes);
      await writeAudit(tx, {
        actorType: 'admin', actorId: a.id, role: a.role, ip,
        type: r.locked ? 'admin.locked' : 'admin.signin_failed', text: r.locked ? 'Admin account locked' : `Wrong ${what}`,
      });
      return r;
    });
    if (r.locked) throw locked(r.lockedUntil);
    // The sign-in screen says how many tries are left before it locks.
    throw unauthorized(what === 'password' ? 'wrong_login' : 'wrong_code', { triesLeft: r.triesLeft });
  }

  async checkPassword(a: AdminRow, password: unknown, ip?: string): Promise<void> {
    if (!(await verifySecret(a.password_hash, String(password ?? '')))) await this.fail(a, ip, 'password');
  }

  /** A 6-digit code (not used before) or one of the unused backup codes. */
  async checkCode(a: AdminRow, b: { code?: unknown; backupCode?: unknown }, ip?: string): Promise<Proof> {
    if (!a.totp_secret_enc) throw badRequest('not_set_up');
    if (typeof b.backupCode === 'string' && b.backupCode.trim()) {
      const given = b.backupCode.trim().toUpperCase();
      for (let i = 0; i < a.backup_code_hashes.length; i++) {
        if (await verifySecret(a.backup_code_hashes[i], given)) return { kind: 'backup', index: i };
      }
      return this.fail(a, ip, 'code');
    }
    const step = verifyTotp(decryptSecret(a.totp_secret_enc), b.code, Number(a.totp_last_step));
    if (step === null) return this.fail(a, ip, 'code');
    return { kind: 'totp', step };
  }

  /**
   * Spend the proof so it cannot be used again: a backup code's hash is dropped,
   * and a code's step becomes the newest one accepted (replay protection). Also
   * clears the wrong-try counter.
   */
  async use(tx: Sql | TransactionSql, a: AdminRow, p: Proof, ip?: string): Promise<void> {
    if (p.kind === 'backup') {
      const left = a.backup_code_hashes.filter((_, i) => i !== p.index);
      const rows = await tx`update tc.admin_user set backup_code_hashes = ${left} where id = ${a.id} and backup_code_hashes = ${a.backup_code_hashes} returning id`;
      if (!rows.length) throw unauthorized('wrong_code');
      await writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.role, ip, type: 'admin.backup_code_used', text: `Backup code used, ${left.length} left` });
    } else {
      const rows = await tx`update tc.admin_user set totp_last_step = ${p.step} where id = ${a.id} and totp_last_step < ${p.step} returning id`;
      if (!rows.length) throw unauthorized('wrong_code');
    }
    await tx`update tc.admin_user set failed_attempts = 0, locked_until = null where id = ${a.id}`;
  }

  /** Password and code again before a dangerous action; returns the proof to spend in its transaction. */
  async reauth(actor: Actor, b: Record<string, unknown>, ip?: string): Promise<{ admin: AdminRow; proof: Proof }> {
    const admin = await this.load(actor.id);
    await this.checkPassword(admin, b.password, ip);
    return { admin, proof: await this.checkCode(admin, b, ip) };
  }
}
