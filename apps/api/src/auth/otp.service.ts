import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { SmsSender, codeMessage } from '../sms/sms';
import { ApiError, badRequest } from '../common/api-error';
import { hashSecret, verifySecret } from './pin';

export type OtpPurpose = 'owner_signin' | 'owner_signup' | 'owner_reset' | 'customer_reset';

/** Six-digit SMS codes: stored hashed, single use, limited tries, expire after auth.otp_minutes. */
@Injectable()
export class OtpService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    private readonly sms: SmsSender,
  ) {}

  async issue(
    tx: Sql | TransactionSql,
    phone: string,
    purpose: OtpPurpose,
    subjectId: string | null,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    // Limit codes per phone: each SMS costs money, and every code is another chance to guess one.
    const perHour = await this.settings.number('auth.otp_per_phone_hour', 5);
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from tc.otp_code where phone = ${phone} and created_at > now() - interval '1 hour'`;
    if (n >= perHour) throw new ApiError(429, 'too_many_codes');
    const minutes = await this.settings.number('auth.otp_minutes', 5);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const [row] = await tx<{ id: string }[]>`
      insert into tc.otp_code (phone, purpose, code_hash, subject_id, payload, expires_at)
      values (${phone}, ${purpose}, ${await hashSecret(code)}, ${subjectId}, ${tx.json(payload as never)},
              now() + make_interval(mins => ${minutes}))
      returning id`;
    await this.sms.send(tx, phone, purpose, codeMessage(code, minutes));
    return row.id;
  }

  /** Check a code. Wrong codes count against the code; too many and it stops working. */
  async verify(otpId: string | null, purpose: OtpPurpose, code: unknown): Promise<{ phone: string; subjectId: string | null; payload: Record<string, unknown> }> {
    if (!otpId || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw badRequest('bad_code');
    const max = await this.settings.number('auth.otp_max_attempts', 5);
    const [row] = await this.sql<{ id: string; phone: string; code_hash: string; subject_id: string | null; payload: Record<string, unknown>; attempts: number; live: boolean }[]>`
      select id, phone, code_hash, subject_id, payload, attempts, (expires_at > now() and used_at is null) as live
      from tc.otp_code where id = ${otpId} and purpose = ${purpose}`;
    if (!row || !row.live || row.attempts >= max) throw badRequest('bad_code');
    if (!(await verifySecret(row.code_hash, code))) {
      await this.sql`update tc.otp_code set attempts = attempts + 1 where id = ${row.id}`;
      throw badRequest('bad_code');
    }
    const [used] = await this.sql`update tc.otp_code set used_at = now() where id = ${row.id} and used_at is null returning id`;
    if (!used) throw badRequest('bad_code');
    return { phone: row.phone, subjectId: row.subject_id, payload: row.payload };
  }
}
