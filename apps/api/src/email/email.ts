import { Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';

type Tx = Sql | TransactionSql;

/**
 * Email to Temelash admins (account recovery and new-device alerts; plan,
 * section 7, Phase 8). Written to tc.email_outbox in the caller's transaction,
 * like SMS. No provider is chosen yet (DECISIONS.md), so nothing leaves the
 * outbox until a dispatcher is added. Admin email is English only.
 */
export abstract class EmailSender {
  abstract send(tx: Tx, to: string, template: string, subject: string, body: string): Promise<void>;
}

@Injectable()
export class OutboxEmailSender extends EmailSender {
  async send(tx: Tx, to: string, template: string, subject: string, body: string): Promise<void> {
    await tx`insert into tc.email_outbox (to_email, template, subject, body) values (${to}, ${template}, ${subject}, ${body})`;
  }
}
