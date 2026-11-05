import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { AlertsService, prefsOf } from '../safety/alerts.service';
import { anonymiseCustomer } from '../account/account';
import { InboxService } from '../messages/inbox.service';
import { SmsSender, smsLanguage, smsText } from '../sms/sms';
import { MoneyService, billingOf, moneyDate, todayEat } from '../money/money.service';

/**
 * Notifications nobody's action triggers: "Reward ending soon" (Notifications
 * board), once per reward, `notify.reward_expiring_days` before it runs out,
 * for customers who allow it. Checked every hour.
 */
@Injectable()
export class Notifier implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    private readonly alerts: AlertsService,
    private readonly money: MoneyService,
    private readonly inbox: InboxService,
    private readonly sms: SmsSender,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.rewardsEndingSoon().catch((e) => console.log(JSON.stringify({ level: 'error', msg: 'reward notices failed', error: (e as Error).message })));
      this.retention().catch((e) => console.log(JSON.stringify({ level: 'error', msg: 'retention failed', error: (e as Error).message })));
      this.closeDue().catch((e) => console.log(JSON.stringify({ level: 'error', msg: 'closing failed', error: (e as Error).message })));
      this.ownerSummaries().catch((e) => console.log(JSON.stringify({ level: 'error', msg: 'owner summaries failed', error: (e as Error).message })));
      this.billingDue().catch((e) => console.log(JSON.stringify({ level: 'error', msg: 'unpaid trials failed', error: (e as Error).message })));
    }, 3_600_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async rewardsEndingSoon(): Promise<number> {
    const days = await this.settings.number('notify.reward_expiring_days', 3);
    const rows = await this.sql`
      insert into tc.notification (customer_id, card_id, type, data)
      select c.customer_id, c.id, 'reward_expiring',
        jsonb_build_object('rewardId', w.id::text, 'reward', (select t ->> 'reward' from jsonb_array_elements(rs.ladder) t where (t ->> 'tier')::int = w.tier),
          'days', greatest(1, ceil(extract(epoch from w.expires_at - now()) / 86400))::int)
      from tc.reward w join tc.card c on c.id = w.card_id join tc.rule_set rs on rs.id = c.rule_set_id join tc.customer u on u.id = c.customer_id
      where w.expires_at > now() and w.expires_at <= now() + make_interval(days => ${days}) and c.status = 'active'
        and coalesce((u.notify_prefs ->> 'exp')::boolean, true)
        and not exists (select 1 from tc.redemption d where d.reward_id = w.id and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id))
      on conflict ((data ->> 'rewardId')) where type = 'reward_expiring' do nothing
      returning id`;
    return rows.length;
  }

  /**
   * OwnAlertSet "Daily summary" at the hour each person chose (20, 21 or 22 East Africa
   * Time) and "Weekly report" on Monday at 08:00 (the board says "every Monday morning";
   * phase-8.md). One of each per person per period. Returns how many were sent.
   */
  async ownerSummaries(now = new Date()): Promise<number> {
    const eat = new Date(now.getTime() + 3 * 3_600_000);
    const hour = eat.getUTCHours();
    const day = eat.toISOString().slice(0, 10);
    const monday = eat.getUTCDay() === 1;
    const people = await this.sql<{ id: string; business_id: string; business: string; alert_prefs: unknown }[]>`
      select p.id, p.business_id, b.name as business, p.alert_prefs from tc.person p join tc.business b on b.id = p.business_id
      where p.role = 'owner' and p.status = 'active' and b.status in ('trial', 'active')`;
    let sent = 0;
    for (const p of people) {
      const prefs = prefsOf(p.alert_prefs);
      const due: Array<['daily' | 'weekly', number]> = [];
      if (prefs.daily && prefs.time === hour) due.push(['daily', 1]);
      if (prefs.weekly && monday && hour === 8) due.push(['weekly', 7]);
      for (const [kind, days] of due) {
        await this.sql.begin(async (tx) => {
          const [mark] = await tx`insert into tc.owner_summary_sent (person_id, kind, period) values (${p.id}, ${kind}, ${day}) on conflict do nothing returning person_id`;
          if (!mark) return;
          // Today (or the 7 days before this one) in East Africa Time.
          const [n] = await tx<{ stamps: number; rewards: number; cards: number }[]>`
            with span as (select (${day}::date - (${days} - 1) - case when ${kind} = 'weekly' then 1 else 0 end)::timestamp at time zone 'Africa/Addis_Ababa' as f,
                                 (${day}::date + case when ${kind} = 'weekly' then 0 else 1 end)::timestamp at time zone 'Africa/Addis_Ababa' as t)
            select
              (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id, span where c.business_id = ${p.business_id}
                and s.method in ('scan', 'typed') and s.kind = 'add' and s.at >= span.f and s.at < span.t) as stamps,
              (select count(*)::int from tc.redemption d join tc.reward w on w.id = d.reward_id join tc.card c on c.id = w.card_id, span
                where c.business_id = ${p.business_id} and d.at >= span.f and d.at < span.t
                  and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id)) as rewards,
              (select count(*)::int from tc.card c, span where c.business_id = ${p.business_id} and c.created_at >= span.f and c.created_at < span.t) as cards`;
          const k = kind === 'daily' ? 'daily' : 'weekly';
          sent += await this.alerts.tell(tx, p.business_id, kind, `inbox.${k}T`, `inbox.${k}B`, { a: p.business, b: n.stamps, c: n.rewards, d: n.cards }, null, p.id);
        });
      }
    }
    return sent;
  }

  /**
   * A trial that ended unpaid pauses `billing.grace_days` later (DECISIONS.md, 2026-11-04):
   * stamping and rewards stop until a payment is approved, which lifts the pause. Cards stay safe.
   * The owner hears by inbox and SMS. Returns how many paused.
   */
  async billingDue(now = new Date()): Promise<number> {
    const grace = await this.settings.number('billing.grace_days', 7);
    const due = await this.sql<{ id: string }[]>`
      select id from tc.business where status = 'trial' and trial_ends_at <= ${now}::timestamptz - make_interval(days => ${grace})`;
    let paused = 0;
    for (const { id } of due) {
      await this.sql.begin(async (tx) => {
        const [b] = await tx<{ name: string; status: string; trial_ends_at: Date }[]>`select name, status, trial_ends_at from tc.business where id = ${id} for update`;
        if (b.status !== 'trial' || b.trial_ends_at.getTime() > now.getTime() - grace * 86_400_000) return;
        const fy = moneyDate(now).financeYear;
        const t = await this.money.feeFor(tx, id, fy);
        const billing = billingOf(b.status, t, await this.money.paid(tx, id, fy), todayEat());
        if (billing === 'paid' || billing === 'pilot' || billing === 'none') {
          // Nothing owed: the trial is simply over.
          await tx`update tc.business set status = 'active' where id = ${id}`;
          return;
        }
        await tx`update tc.business set status = 'paused', paused_unpaid = true where id = ${id}`;
        await this.inbox.system(tx, id, 'inbox.unpaidPausedT', 'inbox.unpaidPausedB', { a: b.name }, 'plan');
        const [owner] = await tx<{ phone: string }[]>`select phone from tc.person where business_id = ${id} and role = 'owner' and status = 'active' limit 1`;
        if (owner) {
          const lang = await smsLanguage(tx, owner.phone, 'person');
          await this.sms.send(tx, owner.phone, 'unpaid_paused', smsText(lang, 'unpaidPaused', { a: b.name }), { language: lang });
        }
        await writeAudit(tx, { actorType: 'system', businessId: id, type: 'business.paused_unpaid', text: `${b.name} paused: the trial ended unpaid`, detail: { graceDays: grace } });
        paused++;
      });
    }
    return paused;
  }

  /**
   * OwnCloseBiz: on the closing date the business closes. Its people can no longer
   * sign in; customers see "This shop has closed" on their card. Returns how many closed.
   */
  async closeDue(now = new Date()): Promise<number> {
    const today = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    return this.sql.begin(async (tx) => {
      const closed = await tx<{ id: string; name: string }[]>`
        update tc.business set status = 'closed' where status = 'closing' and closing_date <= ${today}::date returning id, name`;
      for (const b of closed) {
        const people = await tx<{ id: string }[]>`update tc.person set status = 'disabled' where business_id = ${b.id} and status = 'active' returning id`;
        if (people.length) await tx`update tc.session set revoked_at = now() where actor_id in ${tx(people.map((p) => p.id))} and revoked_at is null`;
        await writeAudit(tx, { actorType: 'system', businessId: b.id, type: 'business.closed', text: `${b.name} closed on its closing date`, detail: { people: people.length } });
      }
      return closed.length;
    });
  }

  /**
   * The retention schedule (phase-8.md, 8d): deleted accounts are erased after
   * promise.delete_days; old one-time codes and dead sessions go; SMS and email
   * bodies are blanked after their days. Append-only records stay.
   */
  async retention(now = new Date()) {
    const n = async (k: string, d: number) => this.settings.number(k, d);
    const deleteDays = await n('promise.delete_days', 30);
    const due = await this.sql<{ id: string }[]>`
      select id from tc.customer where status = 'deleting' and delete_requested_at <= ${now}::timestamptz - make_interval(days => ${deleteDays})`;
    let customers = 0;
    for (const c of due) {
      await this.sql.begin(async (tx) => {
        if (await anonymiseCustomer(tx, c.id)) {
          customers++;
          await writeAudit(tx, { actorType: 'system', type: 'customer.erased', text: 'Erased a deleted account', detail: { customerId: c.id } });
        }
      });
    }
    const otp = await this.sql`delete from tc.otp_code where created_at < ${now}::timestamptz - make_interval(days => ${await n('retention.otp_days', 2)}) returning id`;
    const sessions = await this.sql`delete from tc.session where coalesce(revoked_at, expires_at) < ${now}::timestamptz - make_interval(days => ${await n('retention.session_days', 60)}) returning id`;
    const sms = await this.sql`update tc.sms_outbox set body = '' where body <> '' and created_at < ${now}::timestamptz - make_interval(days => ${await n('retention.sms_body_days', 90)}) returning id`;
    const email = await this.sql`update tc.email_outbox set body = '' where body <> '' and created_at < ${now}::timestamptz - make_interval(days => ${await n('retention.email_body_days', 90)}) returning id`;
    return { customers, otp: otp.length, sessions: sessions.length, sms: sms.length, email: email.length };
  }
}
