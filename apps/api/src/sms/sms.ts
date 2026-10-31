import { Inject, Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';

/**
 * Every SMS goes through this interface so the provider can be swapped
 * (build plan, section 9). Messages are recorded in tc.sms_outbox inside the
 * caller's transaction; SmsDispatcher delivers them through the provider
 * (AfroMessage) once the transaction commits.
 */
export abstract class SmsSender {
  abstract send(tx: Sql | TransactionSql, phone: string, template: string, body: string, opts?: { expiresInMinutes?: number }): Promise<void>;
}

@Injectable()
export class OutboxSmsSender extends SmsSender {
  constructor(@Inject(SQL) private readonly sql: Sql) {
    super();
  }

  async send(tx: Sql | TransactionSql, phone: string, template: string, body: string, opts: { expiresInMinutes?: number } = {}): Promise<void> {
    const expires = opts.expiresInMinutes ?? null;
    await tx`insert into tc.sms_outbox (phone, template, body, expires_at)
             values (${phone}, ${template}, ${body}, case when ${expires}::int is null then null else now() + make_interval(mins => ${expires}::int) end)`;
  }
}

/** The text of a code message. Templates per language arrive with Phase 6. */
export function codeMessage(code: string, minutes: number): string {
  return `Temelash Card code: ${code}. It expires in ${minutes} minutes. Do not share it.`;
}
