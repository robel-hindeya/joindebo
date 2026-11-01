import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import type { SmsProvider } from './afromessage';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

const BATCH = 20;
/** A claimed row is leased this long, so a crashed sender's rows are retried. */
const LEASE = '2 minutes';

/**
 * Delivers tc.sms_outbox. Messages are written in the same transaction as the
 * action (so a rolled-back sign-up sends nothing); this sender picks up queued
 * rows every few seconds. Several API instances can run it: rows are claimed
 * with SKIP LOCKED. Failed sends back off and stop after sms.max_attempts;
 * expired sign-in codes are never sent. Logs carry ids and reasons, never the
 * text (it holds codes).
 */
@Injectable()
export class SmsDispatcher implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private lastStatusMinute = 0;

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    @Optional() @Inject(SMS_PROVIDER) private readonly provider: SmsProvider | null,
  ) {}

  onModuleInit() {
    if (!this.provider) return;
    const every = Number(process.env.SMS_POLL_MS ?? 2000);
    this.timer = setInterval(() => {
      if (this.running) return;
      const minute = Math.floor(Date.now() / 60_000);
      const statuses = minute !== this.lastStatusMinute ? (this.lastStatusMinute = minute, this.checkStatuses()) : Promise.resolve(0);
      this.running = Promise.all([this.runOnce(), statuses])
        .catch((e) => log('error', 'sms sender failed', { error: (e as Error).message }))
        .finally(() => (this.running = null));
    }, every);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /**
   * Delivery status and cost of messages sent in the last day (plan: delivery status and a
   * monthly cost report). At most 25 a run, every 2 seconds' run only once a minute.
   */
  async checkStatuses(): Promise<number> {
    if (!this.provider?.status) return 0;
    const rows = await this.sql<{ id: string; provider_ref: string }[]>`
      update tc.sms_outbox set status_checked_at = now()
      where id in (select id from tc.sms_outbox where status = 'sent' and provider_ref is not null and sent_at > now() - interval '1 day'
        and sent_at < now() - interval '1 minute' and (status_checked_at is null or status_checked_at < now() - interval '10 minutes')
        order by sent_at limit 25 for update skip locked)
      returning id, provider_ref`;
    let done = 0;
    for (const r of rows) {
      try {
        const s = await this.provider.status(r.provider_ref);
        await this.sql`update tc.sms_outbox set status = ${s.status}, cost_birr = coalesce(${s.cost}, cost_birr) where id = ${r.id}`;
        if (s.status !== 'sent') done++;
      } catch (e) {
        log('warn', 'sms status check failed', { id: r.id, error: (e as Error).message.slice(0, 200) });
      }
    }
    return done;
  }

  /** One pass: drop expired codes, claim due rows, send them. Returns how many were sent. */
  async runOnce(): Promise<number> {
    if (!this.provider) return 0;
    await this.sql`update tc.sms_outbox set status = 'failed', last_error = 'expired'
                   where status = 'queued' and expires_at <= now()`;
    const rows = await this.sql<{ id: string; phone: string; body: string; attempts: number }[]>`
      update tc.sms_outbox set attempts = attempts + 1, next_try_at = now() + ${LEASE}::interval
      where id in (
        select id from tc.sms_outbox
        where status = 'queued' and next_try_at <= now() and (expires_at is null or expires_at > now())
        order by next_try_at limit ${BATCH} for update skip locked)
      returning id, phone, body, attempts`;
    if (!rows.length) return 0;
    const max = await this.settings.number('sms.max_attempts', 5);
    let sent = 0;
    for (const r of rows) {
      try {
        const { ref } = await this.provider.send(r.phone, r.body);
        await this.sql`update tc.sms_outbox set status = 'sent', provider = ${this.provider.name}, provider_ref = ${ref},
                       sent_at = now(), last_error = null where id = ${r.id}`;
        sent++;
      } catch (e) {
        const reason = (e as Error).message.slice(0, 300);
        const giveUp = r.attempts >= max;
        // Back off: 30 s, 1, 2, 4 minutes ... at most 10 minutes.
        const wait = Math.min(15 * 2 ** r.attempts, 600);
        await this.sql`update tc.sms_outbox set status = ${giveUp ? 'failed' : 'queued'}, provider = ${this.provider.name},
                       last_error = ${reason}, next_try_at = now() + make_interval(secs => ${wait}) where id = ${r.id}`;
        log(giveUp ? 'error' : 'warn', giveUp ? 'sms gave up' : 'sms send failed, will retry', { id: r.id, attempts: r.attempts, error: reason });
      }
    }
    return sent;
  }
}

function log(level: string, msg: string, extra: Record<string, unknown>) {
  console.log(JSON.stringify({ level, msg, ...extra }));
}
