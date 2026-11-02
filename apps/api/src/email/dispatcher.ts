import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { createTransport } from 'nodemailer';
import { SQL } from '../db/db.module';

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

/** Anything that can send one message; nodemailer's SMTP transport in production, a fake in tests. */
export interface EmailTransport {
  sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/**
 * The SMTP transport from the environment, or null (emails then wait in the outbox).
 * EMAIL_PROVIDER=smtp with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_FROM.
 */
export function emailFromEnv(env: Record<string, string | undefined> = process.env): { transport: EmailTransport; from: string } | null {
  if (env.EMAIL_PROVIDER !== 'smtp') return null;
  const need = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'].filter((k) => !env[k]);
  if (need.length) throw new Error(`EMAIL_PROVIDER=smtp needs ${need.join(', ')}`);
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    from: env.EMAIL_FROM!,
    transport: createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }),
  };
}

const MAX_ATTEMPTS = 5;
const BATCH = 20;

/**
 * Delivers tc.email_outbox (account recovery and new-device emails). Off until an
 * email provider is configured (DECISIONS.md). Rows are claimed with SKIP LOCKED,
 * failures back off and stop after five tries. Logs carry ids and reasons, never
 * the text.
 */
@Injectable()
export class EmailDispatcher implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Optional() @Inject(EMAIL_TRANSPORT) private readonly mail: { transport: EmailTransport; from: string } | null,
  ) {}

  onModuleInit() {
    if (!this.mail || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.runOnce().catch((e) => log('error', 'email sender failed', { error: (e as Error).message })).finally(() => (this.running = null));
    }, 15_000);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Send what is due; returns how many went out. */
  async runOnce(): Promise<number> {
    if (!this.mail) return 0;
    const rows = await this.sql<{ id: string; to_email: string; subject: string; body: string; attempts: number }[]>`
      update tc.email_outbox set attempts = attempts + 1
      where id in (
        select id from tc.email_outbox where sent_at is null and attempts < ${MAX_ATTEMPTS} and body <> ''
          and created_at > now() - interval '2 days'
        order by created_at limit ${BATCH} for update skip locked)
      returning id, to_email, subject, body, attempts`;
    let sent = 0;
    for (const r of rows) {
      try {
        await this.mail.transport.sendMail({ from: this.mail.from, to: r.to_email, subject: r.subject, text: r.body });
        await this.sql`update tc.email_outbox set sent_at = now(), last_error = null where id = ${r.id}`;
        sent++;
      } catch (e) {
        const reason = (e as Error).message.slice(0, 300);
        await this.sql`update tc.email_outbox set last_error = ${reason} where id = ${r.id}`;
        log(r.attempts >= MAX_ATTEMPTS ? 'error' : 'warn', r.attempts >= MAX_ATTEMPTS ? 'email gave up' : 'email failed', { id: r.id, attempts: r.attempts, error: reason });
      }
    }
    return sent;
  }
}

function log(level: string, msg: string, extra: Record<string, unknown>) {
  console.log(JSON.stringify({ level, msg, ...extra }));
}
