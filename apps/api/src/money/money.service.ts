import { Inject, Injectable } from '@nestjs/common';
import { ethiopianDateOf, ethiopianToGregorian, financeYearOf, financeYearRange } from '@temelash/ethiopian-calendar';
import type { Sql, TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';

type Tx = Sql | TransactionSql;
export type Plan = 'starter' | 'full' | 'pilot';

/** The fee and commission terms of one plan_fee row (plan section 2, settings). */
export interface Terms {
  plan: Plan;
  branches: number;
  fee: number;
  base: number;
  extra: number;
  commissionBase: number;
  commissionExtra: number;
  govPercent: number;
  dueOn: string | null;
}

export interface MoneyRow { id: string; businessId: string; kind: 'payment' | 'correction' | 'reversal'; amount: number; fixes: string | null; at: Date; financeYear: number; ethMonth: number }

/** Where an instant falls: the finance year (Hamle 1 to Sene 30) and Ethiopian month, in Addis Ababa. */
export function moneyDate(at: Date = new Date()): { financeYear: number; ethMonth: number } {
  const e = ethiopianDateOf(at);
  return { financeYear: financeYearOf(e), ethMonth: e.month };
}

/** Sene 30 of a finance year, as a Gregorian date (YYYY-MM-DD). */
export function financeYearEnd(financeYear: number): string {
  const g = ethiopianToGregorian(financeYearRange(financeYear).end);
  return `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`;
}

/** Months of a finance year in order: Hamle, Nehase, Pagume, then Meskerem to Sene. */
export const FINANCE_MONTHS = [11, 12, 13, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Commission earned by what has been paid (board `commFn`): the plan part once the
 * base fee is covered, then each extra branch as its fee is covered. Nothing on a pilot.
 */
export function earnedBy(paid: number, t: Terms): number {
  if (t.plan === 'pilot' || paid < t.base || t.base === 0) return 0;
  const extras = t.plan === 'full' ? Math.max(0, t.branches - 2) : 0;
  const covered = t.extra > 0 ? Math.min(extras, Math.floor((paid - t.base) / t.extra)) : 0;
  return t.commissionBase + covered * t.commissionExtra;
}

/** "paid", "partial", "due", "overdue", "btrial" (trial running), "pilot" or "none" (board `billSt`). */
export function billingOf(status: string, t: Terms | null, paid: number, today: string): string {
  if (!t || ['pending', 'rejected', 'closed'].includes(status)) return 'none';
  if (t.plan === 'pilot') return 'pilot';
  if (paid >= t.fee) return 'paid';
  const late = !!t.dueOn && t.dueOn < today;
  if (status === 'trial' && !late) return 'btrial';
  if (paid > 0) return late ? 'overdue' : 'partial';
  return late ? 'overdue' : 'due';
}

/** Today in Addis Ababa, YYYY-MM-DD. */
export const todayEat = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * Fees, the payment ledger and commission, always worked out from the rows
 * (plan section 5: "derived, not stored by hand").
 */
@Injectable()
export class MoneyService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {}

  /** Fee and commission terms for a plan and branch count, from today's settings. */
  async terms(plan: Plan, branches: number, dueOn: string | null): Promise<Terms> {
    const n = (k: string, d: number) => this.settings.number(k, d);
    const included = await n('plan.full.branches_included', 2);
    const base = plan === 'pilot' ? 0 : plan === 'starter' ? await n('plan.starter.yearly_fee_birr', 19000) : await n('plan.full.yearly_fee_birr', 25000);
    const extra = plan === 'full' ? await n('plan.extra_branch.yearly_fee_birr', 5000) : 0;
    const extras = plan === 'full' ? Math.max(0, branches - included) : 0;
    return {
      plan, branches, base, extra, dueOn,
      fee: base + extras * extra,
      commissionBase: plan === 'pilot' ? 0 : plan === 'starter' ? await n('agent.commission_birr.starter', 3000) : await n('agent.commission_birr.full', 5000),
      commissionExtra: plan === 'full' ? await n('agent.commission_birr.extra_branch', 1000) : 0,
      govPercent: await n('government.share_percent_of_commission', 30),
    };
  }

  /** Write a new fee row (the newest wins) and keep tc.business.plan in step. */
  async setFee(tx: Tx, businessId: string, financeYear: number, t: Terms, reason: string, adminId: string | null): Promise<void> {
    await tx`insert into tc.plan_fee (business_id, finance_year, plan, branches, fee_birr, base_birr, extra_birr, commission_base_birr,
               commission_extra_birr, gov_share_percent, due_on, reason, admin_id)
             values (${businessId}, ${financeYear}, ${t.plan}, ${t.branches}, ${t.fee}, ${t.base}, ${t.extra}, ${t.commissionBase},
               ${t.commissionExtra}, ${t.govPercent}, ${t.dueOn}, ${reason}, ${adminId})`;
    await tx`update tc.business set plan = ${t.plan} where id = ${businessId}`;
  }

  /**
   * The terms in force for a business in a finance year: its newest fee row for that
   * year; else the newest earlier row carried into the year (due Hamle 1); else, for a
   * business from before Phase 5, its plan and branches at today's prices.
   */
  async feeFor(tx: Tx, businessId: string, financeYear: number): Promise<Terms | null> {
    const [r] = await tx<{ finance_year: number; plan: Plan; branches: number; fee_birr: number; base_birr: number; extra_birr: number; commission_base_birr: number; commission_extra_birr: number; gov_share_percent: number; due_on: string | null }[]>`
      select finance_year, plan, branches, fee_birr, base_birr, extra_birr, commission_base_birr, commission_extra_birr, gov_share_percent, to_char(due_on, 'YYYY-MM-DD') as due_on
      from tc.plan_fee where business_id = ${businessId} and finance_year <= ${financeYear} order by finance_year desc, id desc limit 1`;
    if (r) {
      const t: Terms = { plan: r.plan, branches: r.branches, fee: r.fee_birr, base: r.base_birr, extra: r.extra_birr, commissionBase: r.commission_base_birr, commissionExtra: r.commission_extra_birr, govPercent: r.gov_share_percent, dueOn: r.due_on };
      if (r.finance_year === financeYear) return t;
      const g = ethiopianToGregorian(financeYearRange(financeYear).start);
      return { ...t, dueOn: t.plan === 'pilot' ? null : `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}` };
    }
    const [b] = await tx<{ plan: Plan | null; branches: number }[]>`
      select plan, (select count(*)::int from tc.branch where business_id = ${businessId} and status = 'active') as branches from tc.business where id = ${businessId}`;
    if (!b?.plan) return null;
    return this.terms(b.plan, Math.max(1, b.branches), null);
  }

  /** Money rows (payments and their fixes) in time order. */
  async rows(tx: Tx, where: { businessId?: string; financeYear?: number }): Promise<MoneyRow[]> {
    return tx<MoneyRow[]>`
      select id, business_id as "businessId", kind, amount_birr as amount, fixes, at, finance_year as "financeYear", eth_month as "ethMonth"
      from tc.payment
      where (${where.businessId ?? null}::uuid is null or business_id = ${where.businessId ?? null})
        and (${where.financeYear ?? null}::int is null or finance_year = ${where.financeYear ?? null})
      order by at, id`;
  }

  /** Paid in a finance year: every payment, correction and reversal counted. */
  async paid(tx: Tx, businessId: string, financeYear: number): Promise<number> {
    const [{ n }] = await tx<{ n: number }[]>`select coalesce(sum(amount_birr), 0)::int as n from tc.payment where business_id = ${businessId} and finance_year = ${financeYear}`;
    return n;
  }

  /**
   * Commission and government share as events: walking each business's rows of a
   * finance year in time order, every row that changes what is earned books the
   * difference in its own month, for the agent the business had at that moment.
   * A reversal therefore takes the commission back the same day.
   */
  async commissionEvents(tx: Tx, financeYear: number) {
    const rows = await this.rows(tx, { financeYear });
    const deals = await tx<{ business_id: string; agent_id: string | null; at: Date }[]>`select business_id, agent_id, at from tc.deal order by id`;
    const current = await tx<{ id: string; agent_id: string | null }[]>`select id, agent_id from tc.business`;
    const now = new Map(current.map((b) => [b.id, b.agent_id]));
    const agentAt = (businessId: string, at: Date) => {
      const mine = deals.filter((d) => d.business_id === businessId);
      if (!mine.length) return now.get(businessId) ?? null;
      const before = mine.filter((d) => d.at <= at);
      return (before.length ? before[before.length - 1] : mine[0]).agent_id;
    };
    const terms = new Map<string, Terms | null>();
    const paidSoFar = new Map<string, number>();
    const out: Array<{ row: MoneyRow; agentId: string | null; commission: number; govShare: number }> = [];
    for (const r of rows) {
      if (!terms.has(r.businessId)) terms.set(r.businessId, await this.feeFor(tx, r.businessId, financeYear));
      const t = terms.get(r.businessId);
      const before = paidSoFar.get(r.businessId) ?? 0;
      const after = before + r.amount;
      paidSoFar.set(r.businessId, after);
      const agentId = agentAt(r.businessId, r.at);
      const delta = t && agentId ? earnedBy(after, t) - earnedBy(before, t) : 0;
      out.push({ row: r, agentId, commission: delta, govShare: t ? Math.round((delta * t.govPercent) / 100) : 0 });
    }
    return out;
  }

  /** The next receipt number of an East Africa day: TR-yyyymmdd-nn. */
  async receiptNo(tx: Tx, at: Date = new Date()): Promise<string> {
    const day = new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
    await tx`select pg_advisory_xact_lock(hashtextextended(${'receipt:' + day}, 0))`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from tc.payment where receipt_no like ${`TR-${day}-%`}`;
    return `TR-${day}-${String(n + 1).padStart(2, '0')}`;
  }
}
