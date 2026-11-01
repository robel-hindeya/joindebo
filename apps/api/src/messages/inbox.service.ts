import { Inject, Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import { SQL } from '../db/db.module';
import { SmsSender, smsText } from '../sms/sms';
import { MoneyService, billingOf, moneyDate, todayEat } from '../money/money.service';

type Tx = Sql | TransactionSql;
export type Audience = 'all' | 'due' | 'agent' | 'biz';
export interface Recipient { business_id: string; person_id: string; phone: string; lang: Lang }

/**
 * Messages from Temelash to owners (AdminMessages, OwnInbox): who gets one,
 * writing it with its recipients fixed, an optional text message, and the
 * notices the system itself sends (approval, pause, receipts).
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly sms: SmsSender,
    private readonly money: MoneyService,
  ) {}

  /** The active owners of the businesses an audience covers. "Payment due" means a balance to pay. */
  async recipients(tx: Tx, audience: Audience, ref: { agentId?: string | null; businessId?: string | null }): Promise<Recipient[]> {
    const rows = await tx<{ business_id: string; person_id: string; phone: string; lang: string | null; status: string; agent_id: string | null }[]>`
      select b.id as business_id, p.id as person_id, p.phone, p.prefs ->> 'lang' as lang, b.status, b.agent_id
      from tc.business b join tc.person p on p.business_id = b.id and p.role = 'owner' and p.status = 'active'
      where b.status in ('trial', 'active', 'paused', 'closing') order by b.name`;
    let list = [...rows];
    if (audience === 'agent') list = rows.filter((r) => r.agent_id === ref.agentId);
    if (audience === 'biz') list = rows.filter((r) => r.business_id === ref.businessId);
    if (audience === 'due') {
      const fy = moneyDate().financeYear;
      const snap = await this.money.snapshot(tx, fy);
      list = rows.filter((r) => ['due', 'overdue', 'partial'].includes(billingOf(r.status, snap.fee(r.business_id), snap.paid(r.business_id), todayEat())));
    }
    return list.map((r) => ({ business_id: r.business_id, person_id: r.person_id, phone: r.phone, lang: isLang(r.lang) ? r.lang : 'en' }));
  }

  /** Write a message with its recipients; with `sms`, each also gets a text (held in quiet hours). */
  async send(tx: Tx, m: { audience: Audience | 'system'; label: string; title: string; body: string; sms: boolean; agentId?: string | null; businessId?: string | null; againOf?: string | null; action?: 'plan' | null; adminId?: string | null }, to: Recipient[]) {
    const [row] = await tx<{ id: string }[]>`
      insert into tc.admin_message (audience, audience_label, agent_id, business_id, title, body, sms, again_of, action, admin_id)
      values (${m.audience}, ${m.label}, ${m.agentId ?? null}, ${m.businessId ?? null}, ${m.title}, ${m.body}, ${m.sms}, ${m.againOf ?? null}, ${m.action ?? null}, ${m.adminId ?? null})
      returning id`;
    for (const r of to) {
      await tx`insert into tc.admin_message_recipient (message_id, business_id, person_id) values (${row.id}, ${r.business_id}, ${r.person_id}) on conflict do nothing`;
      if (m.sms) await this.sms.send(tx, r.phone, 'admin_message', smsText(r.lang, 'message', { a: m.title, b: m.body }), { language: r.lang, quiet: true });
    }
    return { id: row.id, recipients: to.length };
  }

  /** A notice from the system to a business's owners, written in each owner's language. */
  async system(tx: Tx, businessId: string, titleKey: string, bodyKey: string, vars: Record<string, string | number>, action: 'plan' | null = null) {
    const to = await this.recipients(tx, 'biz', { businessId });
    // Owners may read different languages; one message per language keeps each in their own.
    const langs = [...new Set(to.map((r) => r.lang))];
    for (const lang of langs) {
      await this.send(tx, {
        audience: 'system', label: '', businessId, sms: false, action,
        title: t(lang, titleKey as MessageKey, vars), body: t(lang, bodyKey as MessageKey, vars),
      }, to.filter((r) => r.lang === lang));
    }
  }
}
