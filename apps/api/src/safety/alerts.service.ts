import { Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import { SmsSender } from '../sms/sms';
import { InboxService } from '../messages/inbox.service';
import { SettingsService } from '../settings/settings.service';
import type { Actor } from '../auth/actor';

type Tx = Sql | TransactionSql;
export type AlertKind = 'approve' | 'unusual' | 'locked' | 'phone' | 'daily' | 'weekly';
export interface AlertPrefs { approve: boolean; unusual: boolean; locked: boolean; phone: boolean; daily: boolean; weekly: boolean; how: 'push' | 'sms'; time: number }
export const ALERT_DEFAULTS: AlertPrefs = { approve: true, unusual: true, locked: true, phone: false, daily: true, weekly: false, how: 'push', time: 21 };
export const prefsOf = (raw: unknown): AlertPrefs => ({ ...ALERT_DEFAULTS, ...(raw && typeof raw === 'object' ? raw as Partial<AlertPrefs> : {}) });

/**
 * Unusual-activity flags (AdminReqFlag) and the owner alerts that go with them
 * (OwnAlertSet). Owners get a message in their inbox ("Notification"), and a
 * text as well when they chose SMS; managers of the branch get the text only,
 * since the inbox is the owners'.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly inbox: InboxService,
    private readonly sms: SmsSender,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Raise one flag for Temelash, unless the same one (same `dedupe` fields in the
   * payload) is already there; then tell the people who want unusual-activity alerts.
   */
  async flag(tx: Tx, businessId: string, payload: Record<string, unknown> & { kind: string }, dedupe: string[], tell: { titleKey: string; bodyKey: string; vars: Record<string, string | number>; branchId?: string | null }): Promise<boolean> {
    const same = Object.fromEntries(dedupe.map((k) => [k, payload[k]]));
    const [seen] = await tx`select 1 from tc.request where type = 'flag' and business_id = ${businessId} and payload @> ${tx.json({ kind: payload.kind, ...same } as never)}`;
    if (seen) return false;
    await tx`insert into tc.request (type, business_id, payload) values ('flag', ${businessId}, ${tx.json(payload as never)})`;
    await this.tell(tx, businessId, 'unusual', tell.titleKey, tell.bodyKey, tell.vars, tell.branchId ?? null);
    return true;
  }

  /** Tell the owners (and the branch's managers) who switched this alert on, in their language. */
  async tell(tx: Tx, businessId: string, kind: AlertKind, titleKey: string, bodyKey: string, vars: Record<string, string | number>, branchId: string | null = null, only: string | null = null): Promise<number> {
    const people = await tx<{ id: string; phone: string; role: string; lang: string | null; alert_prefs: unknown }[]>`
      select p.id, p.phone, p.role, p.prefs ->> 'lang' as lang, p.alert_prefs from tc.person p
      where p.business_id = ${businessId} and p.status = 'active' and (${only}::uuid is null or p.id = ${only})
        and (p.role = 'owner' or (p.role = 'manager' and ${branchId}::uuid is not null
          and exists (select 1 from tc.person_branch pb where pb.person_id = p.id and pb.branch_id = ${branchId})))`;
    const want = people.filter((p) => prefsOf(p.alert_prefs)[kind]);
    const langs = [...new Set(want.map((p) => (isLang(p.lang) ? p.lang : 'en')))] as Lang[];
    for (const lang of langs) {
      const group = want.filter((p) => (isLang(p.lang) ? p.lang : 'en') === lang);
      const title = t(lang, titleKey as MessageKey, vars);
      const body = t(lang, bodyKey as MessageKey, vars);
      const owners = group.filter((p) => p.role === 'owner');
      if (owners.length) {
        await this.inbox.send(tx, { audience: 'system', label: '', businessId, sms: false, title, body },
          owners.map((p) => ({ business_id: businessId, person_id: p.id, phone: p.phone, lang })));
      }
      for (const p of group.filter((x) => prefsOf(x.alert_prefs).how === 'sms')) {
        await this.sms.send(tx, p.phone, 'owner_alert', `${title}. ${body}`, { language: lang });
      }
    }
    return want.length;
  }

  /** The East Africa Time clock hour of an instant, as "YYYY-MM-DDTHH". */
  private async hourOf(tx: Tx, at: Date): Promise<string> {
    const [h] = await tx<{ hour: string }[]>`select to_char(date_trunc('hour', ${at}::timestamptz at time zone 'Africa/Addis_Ababa'), 'YYYY-MM-DD"T"HH24') as hour`;
    return h.hour;
  }

  /**
   * After a stamp by a cashier: "Stamps in one hour on one phone" (per cashier, per clock hour)
   * and "Stamps typed by hand in a week" (per shop, Monday to Sunday, once enough stamps).
   */
  async afterStamp(tx: Tx, staff: Actor, at: Date, typed: boolean): Promise<void> {
    const max = await this.settings.number('flags.stamps_per_hour', 60);
    const hour = await this.hourOf(tx, at);
    const [h] = await tx<{ used: number; phones: number }[]>`
      select count(*)::int as used, count(distinct s.card_id)::int as phones
      from tc.stamp s where s.person_id = ${staff.id} and s.method in ('scan', 'typed') and s.kind = 'add'
        and to_char(date_trunc('hour', s.at at time zone 'Africa/Addis_Ababa'), 'YYYY-MM-DD"T"HH24') = ${hour}`;
    if (h.used > max) {
      const [who] = await tx<{ name: string }[]>`select name from tc.person where id = ${staff.id}`;
      await this.flag(tx, staff.businessId!, { kind: 'stamps_per_hour', personId: staff.id, branchId: staff.branchId ?? null, hour, stamps: h.used, limit: max }, ['personId', 'hour'],
        { titleKey: 'inbox.unusualT', bodyKey: 'inbox.unusualHourB', vars: { a: who?.name ?? '', b: h.used }, branchId: staff.branchId ?? null });
    }
    if (!typed) return;
    const pct = await this.settings.number('flags.hand_typed_share_pct', 30);
    const min = await this.settings.number('flags.hand_typed_min_stamps', 20);
    const [wk] = await tx<{ week: string; total: number; typed: number }[]>`
      select to_char(date_trunc('week', ${at}::timestamptz at time zone 'Africa/Addis_Ababa'), 'YYYY-MM-DD') as week,
        count(*)::int as total, count(*) filter (where s.method = 'typed')::int as typed
      from tc.stamp s join tc.card c on c.id = s.card_id
      where c.business_id = ${staff.businessId!} and s.method in ('scan', 'typed') and s.kind = 'add'
        and date_trunc('week', s.at at time zone 'Africa/Addis_Ababa') = date_trunc('week', ${at}::timestamptz at time zone 'Africa/Addis_Ababa')`;
    const share = wk.total ? Math.round((wk.typed / wk.total) * 100) : 0;
    if (wk.total >= min && share > pct) {
      await this.flag(tx, staff.businessId!, { kind: 'hand_typed_share', week: wk.week, typed: wk.typed, total: wk.total, share, limit: pct }, ['week'],
        { titleKey: 'inbox.unusualT', bodyKey: 'inbox.unusualHandB', vars: { a: share } });
    }
  }

  /** After a card is added: "New cards in one hour in one shop". */
  async afterNewCard(tx: Tx, businessId: string, at = new Date()): Promise<void> {
    const max = await this.settings.number('flags.new_cards_per_hour', 25);
    const hour = await this.hourOf(tx, at);
    const [n] = await tx<{ cards: number }[]>`
      select count(*)::int as cards from tc.card where business_id = ${businessId}
        and to_char(date_trunc('hour', created_at at time zone 'Africa/Addis_Ababa'), 'YYYY-MM-DD"T"HH24') = ${hour}`;
    if (n.cards > max) {
      await this.flag(tx, businessId, { kind: 'new_cards_per_hour', hour, cards: n.cards, limit: max }, ['hour'],
        { titleKey: 'inbox.unusualT', bodyKey: 'inbox.unusualCardsB', vars: { a: n.cards } });
    }
  }
}
