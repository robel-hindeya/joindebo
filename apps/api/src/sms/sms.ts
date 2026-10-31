import { Inject, Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';

/**
 * Every SMS goes through this interface so the provider can be swapped
 * (build plan, section 9). The provider is not chosen yet (DECISIONS.md), so
 * the only implementation records messages in tc.sms_outbox; a provider worker
 * will send queued rows in Phase 6.
 */
export abstract class SmsSender {
  abstract send(tx: Sql | TransactionSql, phone: string, template: string, body: string): Promise<void>;
}

@Injectable()
export class OutboxSmsSender extends SmsSender {
  constructor(@Inject(SQL) private readonly sql: Sql) {
    super();
  }

  async send(tx: Sql | TransactionSql, phone: string, template: string, body: string): Promise<void> {
    await tx`insert into tc.sms_outbox (phone, template, body) values (${phone}, ${template}, ${body})`;
  }
}

/** The text of a code message. Templates per language arrive with Phase 6. */
export function codeMessage(code: string, minutes: number): string {
  return `Temelash Card code: ${code}. It expires in ${minutes} minutes. Do not share it.`;
}
