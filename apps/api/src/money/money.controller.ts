import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { normalizePhone } from '../auth/pin';
import { AdminAuthService } from '../admin/admin-auth.service';
import { FINANCE_MONTHS, MoneyService, billingOf, financeYearEnd, moneyDate, todayEat, type Plan } from './money.service';

type Tx = Sql | TransactionSql;
type Snap = Awaited<ReturnType<MoneyService['snapshot']>>;
const METHODS = ['telebirr', 'cbe_birr', 'cash', 'bank'];

/** Money screens and exports: Owner and Finance only (plan sections 3 and 7). */
function money(a: Actor): void {
  if (a.adminRole !== 'owner' && a.adminRole !== 'finance') throw forbidden();
}
function reason(b: Record<string, unknown>): string {
  const r = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!r) throw badRequest('reason_needed');
  return r.slice(0, 500);
}
const text = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/**
 * Phase 5 money (Admin board: Finance, Receipt, Agents, Report, Export):
 * fees and plans, payments with receipts, corrections and reversals, agents,
 * deals and payouts, the government share and authenticated exports.
 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class MoneyController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly m: MoneyService,
    private readonly settings: SettingsService,
    private readonly auth: AdminAuthService,
  ) {}

  private audit(tx: Tx, a: Actor, req: Request, type: string, txt: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text: txt, ...extra });
  }

  private fy(q?: string): number {
    const n = Number(q);
    return Number.isInteger(n) && n > 2000 ? n : moneyDate().financeYear;
  }

  /** One business's money for a year: terms, paid, balance, billing state and covers-until. */
  private async state(tx: Tx, businessId: string, status: string, financeYear: number, snap?: Snap) {
    const t = snap ? snap.fee(businessId) : await this.m.feeFor(tx, businessId, financeYear);
    const paid = snap ? snap.paid(businessId) : await this.m.paid(tx, businessId, financeYear);
    const fee = t?.fee ?? 0;
    return {
      plan: t?.plan ?? null, branches: t?.branches ?? null, fee, paid, balance: Math.max(0, fee - paid), dueOn: t?.dueOn ?? null,
      billing: billingOf(status, t, paid, todayEat()), coversUntil: t && t.fee > 0 && paid >= t.fee ? financeYearEnd(financeYear) : null,
    };
  }

  // ---------------------------------------------------------------- AdminFinance
  @Get('finance/summary')
  async summary(@CurrentActor() a: Actor, @Query('year') year?: string) {
    money(a);
    const fy = this.fy(year);
    const snap = await this.m.snapshot(this.sql, fy);
    // Independent reads, sent together.
    const [soon, list, events, lastYear, [{ collected }], [{ paidOut }]] = await Promise.all([
      this.settings.number('finance.due_soon_days', 14),
      this.sql<{ id: string; name: string; status: string; agent: string | null }[]>`
        select b.id, b.name, b.status, ag.name as agent from tc.business b left join tc.agent ag on ag.id = b.agent_id
        where b.status not in ('pending', 'rejected') order by b.name`,
      this.m.commissionEvents(this.sql, fy, snap),
      this.m.commissionEvents(this.sql, fy - 1),
      this.sql<{ collected: number }[]>`select coalesce(sum(amount_birr), 0)::int as collected from tc.payment where finance_year = ${fy}`,
      this.sql<{ paidOut: number }[]>`select coalesce(sum(amount_birr), 0)::int as "paidOut" from tc.agent_payout`,
    ]);
    const businesses = [];
    for (const b of list) businesses.push({ id: b.id, name: b.name, status: b.status, agent: b.agent, ...(await this.state(this.sql, b.id, b.status, fy, snap)) });
    const today = todayEat();
    const limit = new Date(Date.parse(today) + soon * 86_400_000).toISOString().slice(0, 10);
    const overdue = businesses.filter((b) => b.billing === 'overdue');
    const dueSoon = businesses.filter((b) => ['due', 'partial', 'btrial'].includes(b.billing) && b.dueOn && b.dueOn >= today && b.dueOn <= limit);
    const earnedAll = [...events, ...lastYear].reduce((s, e) => s + e.commission, 0);
    return {
      financeYear: fy, yearEnds: financeYearEnd(fy), collected,
      overdueBirr: overdue.reduce((s, b) => s + b.balance, 0), overdue, dueSoon,
      commission: events.reduce((s, e) => s + e.commission, 0), commissionOwed: Math.max(0, earnedAll - paidOut),
      businesses,
    };
  }

  @Get('businesses/:id/finance')
  async businessFinance(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Query('year') year?: string) {
    money(a);
    const fy = this.fy(year);
    const [b] = await this.sql<{ id: string; name: string; status: string; trial_ends_at: Date | null }[]>`select id, name, status, trial_ends_at from tc.business where id = ${id}`;
    if (!b) throw notFound();
    const history = await this.sql`
      select finance_year as "financeYear", plan, branches, fee_birr as fee, to_char(due_on, 'YYYY-MM-DD') as "dueOn", reason, at
      from tc.plan_fee where business_id = ${id} order by id desc`;
    return { id, name: b.name, status: b.status, financeYear: fy, yearEnds: financeYearEnd(fy), trialEndsAt: b.trial_ends_at, ...(await this.state(this.sql, id, b.status, fy)), payments: await this.payments(this.sql, id), history };
  }

  /** Receipts of a business, each with its effective amount after corrections. */
  private async payments(tx: Tx, businessId: string) {
    return tx`
      select p.id, p.receipt_no as "receiptNo", p.amount_birr as original, p.amount_birr + coalesce(f.delta, 0) as amount, (f.reversed is true) as reversed,
        p.method, p.reference, p.at, p.finance_year as "financeYear", ad.name as by
      from tc.payment p join tc.admin_user ad on ad.id = p.admin_id
      left join lateral (select sum(x.amount_birr)::int as delta, bool_or(x.kind = 'reversal') as reversed from tc.payment x where x.fixes = p.id) f on true
      where p.business_id = ${businessId} and p.kind = 'payment' order by p.at desc`;
  }

  // ---------------------------------------------------------------- AdminRecordPay / AdminReceipt / corrections
  @Post('businesses/:id/payments')
  async record(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) throw badRequest('bad_amount');
    if (!METHODS.includes(String(b.method))) throw badRequest('bad_method');
    const now = moneyDate();
    // From Ginbot 1, a payment may be for next year (plan section 2).
    const fy = b.financeYear === undefined ? now.financeYear : Number(b.financeYear);
    if (fy !== now.financeYear && !(fy === now.financeYear + 1 && (now.ethMonth === 9 || now.ethMonth === 10))) throw badRequest('bad_year');
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string; status: string }[]>`select name, status from tc.business where id = ${id} for update`;
      if (!biz) throw notFound();
      if (['pending', 'rejected', 'closed'].includes(biz.status)) throw conflict('not_billable');
      const receiptNo = await this.m.receiptNo(tx);
      const [p] = await tx<{ id: string }[]>`
        insert into tc.payment (business_id, kind, amount_birr, method, reference, receipt_no, finance_year, eth_month, admin_id)
        values (${id}, 'payment', ${amount}, ${String(b.method)}, ${text(b.reference, 100)}, ${receiptNo}, ${fy}, ${now.ethMonth}, ${a.id}) returning id`;
      // A business on trial that has paid the whole fee is active (AdminRecordPay).
      const st = await this.state(tx, id, biz.status, fy);
      if (biz.status === 'trial' && st.billing === 'paid') await tx`update tc.business set status = 'active' where id = ${id}`;
      await this.audit(tx, a, req, 'payment.recorded', `Recorded a payment from ${biz.name}`, { businessId: id, detail: { receiptNo, amount, method: b.method } });
      return { id: p.id, receiptNo, ...st };
    });
  }

  @Get('payments/:id')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    money(a);
    const [p] = await this.sql`
      select p.id, p.receipt_no as "receiptNo", p.amount_birr as original, p.method, p.reference, p.at, p.finance_year as "financeYear",
        b.id as "businessId", b.name as business, ad.name as by
      from tc.payment p join tc.business b on b.id = p.business_id join tc.admin_user ad on ad.id = p.admin_id
      where p.id = ${id} and p.kind = 'payment'`;
    if (!p) throw notFound();
    const fixes = await this.sql<{ kind: string; amount: number }[]>`
      select x.kind, x.amount_birr as amount, x.reason, x.at, ad.name as by from tc.payment x join tc.admin_user ad on ad.id = x.admin_id where x.fixes = ${id} order by x.at`;
    const amount = Number(p.original) + fixes.reduce((s, f) => s + f.amount, 0);
    return { ...p, amount, reversed: fixes.some((f) => f.kind === 'reversal'), fixes, coversUntil: financeYearEnd(Number(p.financeYear)) };
  }

  /** AdminPayCorrect / AdminPayReverse: a new row with the difference, linked to the payment. */
  private async fix(id: string, a: Actor, req: Request, kind: 'correction' | 'reversal', why: string, newAmount?: number) {
    return this.sql.begin(async (tx) => {
      const [p] = await tx<{ business_id: string; amount_birr: number; receipt_no: string; finance_year: number; name: string }[]>`
        select p.business_id, p.amount_birr, p.receipt_no, p.finance_year, b.name from tc.payment p join tc.business b on b.id = p.business_id
        where p.id = ${id} and p.kind = 'payment' for update of p`;
      if (!p) throw notFound();
      const [{ delta, reversed }] = await tx<{ delta: number; reversed: boolean }[]>`
        select coalesce(sum(amount_birr), 0)::int as delta, coalesce(bool_or(kind = 'reversal'), false) as reversed from tc.payment where fixes = ${id}`;
      const now = p.amount_birr + delta;
      if (reversed) throw conflict('already_reversed');
      const change = kind === 'reversal' ? -now : newAmount! - now;
      if (change === 0) throw badRequest('no_change');
      const at = moneyDate();
      await tx`insert into tc.payment (business_id, kind, amount_birr, fixes, reason, finance_year, eth_month, admin_id)
               values (${p.business_id}, ${kind}, ${change}, ${id}, ${why}, ${p.finance_year}, ${at.ethMonth}, ${a.id})`;
      await this.audit(tx, a, req, kind === 'reversal' ? 'payment.reversed' : 'payment.corrected',
        kind === 'reversal' ? `Reversed payment ${p.receipt_no} of ${p.name}` : `Corrected payment ${p.receipt_no} of ${p.name}`,
        { businessId: p.business_id, detail: { receiptNo: p.receipt_no, from: now, to: now + change, reason: why } });
      return { amount: now + change };
    });
  }

  @Post('payments/:id/correct')
  async correct(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw badRequest('bad_amount');
    return this.fix(id, a, req, 'correction', reason(b), amount);
  }

  @Post('payments/:id/reverse')
  async reverse(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    return this.fix(id, a, req, 'reversal', reason(b));
  }

  // ---------------------------------------------------------------- AdminChangePlan / AdminAddBranch
  @Post('businesses/:id/plan')
  async changePlan(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const plan = String(b.plan) as Plan;
    if (!['starter', 'full', 'pilot'].includes(plan)) throw badRequest('bad_plan');
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`select name from tc.business where id = ${id} for update`;
      if (!biz) throw notFound();
      const fy = moneyDate().financeYear;
      const cur = await this.m.feeFor(tx, id, fy);
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from tc.branch where business_id = ${id} and status = 'active'`;
      if (plan === 'starter' && n > 1) throw conflict('starter_one_branch');
      if (cur?.plan === plan) throw badRequest('no_change');
      // From the free pilot to a paid plan the fee is due now; otherwise the due date stays.
      const dueOn = plan === 'pilot' ? null : cur?.plan === 'pilot' || !cur?.dueOn ? todayEat() : cur.dueOn;
      const t = await this.m.terms(plan, Math.max(1, n), dueOn);
      await this.m.setFee(tx, id, fy, t, 'plan_changed', a.id);
      await this.audit(tx, a, req, 'business.plan_changed', `Changed the plan of ${biz.name} to ${plan}`, { businessId: id, detail: { from: cur?.plan ?? null, to: plan, fee: t.fee } });
      return { plan, fee: t.fee };
    });
  }

  @Post('businesses/:id/branches')
  async addBranch(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string; status: string }[]>`select name, status from tc.business where id = ${id} for update`;
      if (!biz) throw notFound();
      if (['pending', 'rejected', 'closed'].includes(biz.status)) throw conflict('not_billable');
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from tc.branch where business_id = ${id} and status = 'active'`;
      const name = text(b.name, 80) ?? `${biz.name} ${n + 1}`;
      await tx`insert into tc.branch (business_id, name) values (${id}, ${name})`;
      const fy = moneyDate().financeYear;
      const cur = await this.m.feeFor(tx, id, fy);
      // A second branch moves Starter to Full (AdminAddBranch); a pilot stays free.
      const plan: Plan = cur?.plan === 'pilot' ? 'pilot' : 'full';
      const t = await this.m.terms(plan, n + 1, cur?.dueOn ?? (plan === 'pilot' ? null : todayEat()));
      await this.m.setFee(tx, id, fy, t, 'branch_added', a.id);
      await this.audit(tx, a, req, 'business.branch_added', `Added a branch to ${biz.name}`, { businessId: id, detail: { branches: n + 1, fee: t.fee, name } });
      return { branches: n + 1, plan, fee: t.fee };
    });
  }

  // ---------------------------------------------------------------- AdminAgents* / AdminAgentPay / AdminAddDeal* / AdminLeaderboard
  /** Earned, paid out and owed per agent, over the current and the previous finance year. */
  private async agentMoney(tx: Tx) {
    const fy = moneyDate().financeYear;
    const earned = new Map<string, number>();
    for (const e of (await Promise.all([fy - 1, fy].map((y) => this.m.commissionEvents(tx, y)))).flat()) {
      if (e.agentId) earned.set(e.agentId, (earned.get(e.agentId) ?? 0) + e.commission);
    }
    const paid = new Map((await tx<{ agent_id: string; n: number }[]>`select agent_id, sum(amount_birr)::int as n from tc.agent_payout group by agent_id`).map((r) => [r.agent_id, r.n]));
    return (id: string) => { const e = earned.get(id) ?? 0; const p = paid.get(id) ?? 0; return { earned: e, paid: p, owed: Math.max(0, e - p) }; };
  }

  @Get('agents')
  async agents(@CurrentActor() a: Actor) {
    money(a);
    const list = await this.sql<{ id: string; name: string; phone: string; area: string | null; status: string; deals: number; leads: number }[]>`
      select ag.id, ag.name, ag.phone, ag.area, ag.status,
        (select count(distinct d.business_id)::int from tc.deal d where d.agent_id = ag.id) +
        (select count(*)::int from tc.business b where b.agent_id = ag.id and not exists (select 1 from tc.deal d where d.business_id = b.id)) as deals,
        (select count(*)::int from tc.agent_lead l where l.agent_id = ag.id and not exists (select 1 from tc.deal d where d.lead_id = l.id)) as leads
      from tc.agent ag order by ag.name`;
    const m = await this.agentMoney(this.sql);
    return list.map((ag) => ({ ...ag, ...m(ag.id) }));
  }

  @Post('agents')
  async addAgent(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const name = text(b.name, 80);
    const phone = normalizePhone(b.phone);
    if (!name || !phone) throw badRequest('bad_agent');
    return this.sql.begin(async (tx) => {
      const [taken] = await tx`select 1 from tc.agent where phone = ${phone}`;
      if (taken) throw conflict('phone_in_use');
      const [ag] = await tx<{ id: string }[]>`insert into tc.agent (name, phone, area) values (${name}, ${phone}, ${text(b.area, 80)}) returning id`;
      await this.audit(tx, a, req, 'agent.added', `Added agent ${name}`, { detail: { agentId: ag.id } });
      return { id: ag.id };
    });
  }

  @Get('agents/leaderboard')
  async leaderboard(@CurrentActor() a: Actor, @Query('days') days?: string) {
    money(a);
    const d = [7, 14, 30, 60, 90].includes(Number(days)) ? Number(days) : 30;
    // AdminLeaderboard: businesses registered with each agent in the period, how many of them paid in
    // full, and the same number of days just before (counted by the day the business registered).
    const rows = await this.sql<{ id: string; name: string; area: string | null; status: string; business_ids: string[]; before: number }[]>`
      select ag.id, ag.name, ag.area, ag.status,
        coalesce(array_agg(distinct b.id) filter (where b.created_at > now() - make_interval(days => ${d})), '{}') as business_ids,
        count(distinct b.id) filter (where b.created_at <= now() - make_interval(days => ${d}) and b.created_at > now() - make_interval(days => ${2 * d}))::int as before
      from tc.agent ag left join tc.business b on b.agent_id = ag.id and b.status <> 'rejected'
      group by ag.id order by ag.name`;
    const fy = moneyDate().financeYear;
    const snap = await this.m.snapshot(this.sql, fy);
    const statuses = new Map((await this.sql<{ id: string; status: string }[]>`select id, status from tc.business`).map((b) => [b.id, b.status]));
    const out = [];
    for (const r of rows) {
      let paid = 0;
      for (const id of r.business_ids) {
        if ((await this.state(this.sql, id, statuses.get(id) ?? 'active', fy, snap)).billing === 'paid') paid++;
      }
      out.push({ id: r.id, name: r.name, area: r.area, status: r.status, deals: r.business_ids.length, paid, before: r.before });
    }
    out.sort((x, y) => y.deals - x.deals || y.paid - x.paid || x.name.localeCompare(y.name));
    const [{ noAgent }] = await this.sql<{ noAgent: number }[]>`
      select count(*)::int as "noAgent" from tc.business where agent_id is null and status <> 'rejected' and created_at > now() - make_interval(days => ${d})`;
    return { days: d, agents: out, noAgent };
  }

  @Get('agents/:id')
  async agent(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    money(a);
    const [ag] = await this.sql`select id, name, phone, area, status, created_at as "createdAt" from tc.agent where id = ${id}`;
    if (!ag) throw notFound();
    const businesses = await this.sql<{ id: string; name: string; status: string }[]>`
      select b.id, b.name, b.status from tc.business b
      where b.agent_id = ${id} or exists (select 1 from tc.deal d where d.business_id = b.id and d.agent_id = ${id}) order by b.name`;
    const fy = moneyDate().financeYear;
    const snap = await this.m.snapshot(this.sql, fy);
    const ev = [...(await this.m.commissionEvents(this.sql, fy - 1)), ...(await this.m.commissionEvents(this.sql, fy, snap))].filter((e) => e.agentId === id);
    const deals = [];
    for (const b of businesses) {
      const st = await this.state(this.sql, b.id, b.status, fy, snap);
      deals.push({ ...b, plan: st.plan, fee: st.fee, paid: st.paid, billing: st.billing, earned: ev.filter((e) => e.row.businessId === b.id).reduce((s, e) => s + e.commission, 0) });
    }
    const leads = await this.sql`
      select l.id, l.business_name as "businessName", l.owner_phone as "ownerPhone", l.plan, l.branches, l.at,
        exists (select 1 from tc.deal d where d.lead_id = l.id) as linked
      from tc.agent_lead l where l.agent_id = ${id} order by l.at desc`;
    const payouts = await this.sql`
      select p.amount_birr as amount, p.how, p.reference, p.at, ad.name as by from tc.agent_payout p join tc.admin_user ad on ad.id = p.admin_id
      where p.agent_id = ${id} order by p.at desc`;
    const stats = (await this.agentMoney(this.sql))(id);
    const pct = await this.settings.number('government.share_percent_of_commission', 30);
    return { ...ag, stats: { ...stats, govShareOnOwed: Math.round((stats.owed * pct) / 100) }, deals, leads, payouts };
  }

  /** AdminAgentPay "Mark as paid": everything owed, as one payout row. It does not send money. */
  @Post('agents/:id/payout')
  async payout(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    return this.sql.begin(async (tx) => {
      const [ag] = await tx<{ name: string }[]>`select name from tc.agent where id = ${id} for update`;
      if (!ag) throw notFound();
      const { owed } = (await this.agentMoney(tx))(id);
      if (owed <= 0) throw conflict('nothing_owed');
      const at = moneyDate();
      await tx`insert into tc.agent_payout (agent_id, amount_birr, how, reference, finance_year, eth_month, admin_id)
               values (${id}, ${owed}, ${text(b.how, 80)}, ${text(b.reference, 100)}, ${at.financeYear}, ${at.ethMonth}, ${a.id})`;
      await this.audit(tx, a, req, 'agent.paid', `Paid commission to ${ag.name}`, { detail: { agentId: id, amount: owed } });
      return { paid: owed };
    });
  }

  /** AdminAddDeal*: link a business to an agent, or record a lead not registered yet. */
  @Post('deals')
  async deal(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const agentId = typeof b.agentId === 'string' ? b.agentId : null;
    return this.sql.begin(async (tx) => {
      const [ag] = agentId ? await tx<{ name: string }[]>`select name from tc.agent where id = ${agentId} and status = 'active'` : [];
      if (agentId && !ag) throw badRequest('bad_agent');
      const lead = b.lead as Record<string, unknown> | undefined;
      if (lead) {
        if (!ag) throw badRequest('bad_agent');
        const name = text(lead.businessName, 80);
        const phone = normalizePhone(lead.ownerPhone);
        const plan = String(lead.plan);
        if (!name || !phone || !['starter', 'full'].includes(plan)) throw badRequest('bad_lead');
        const branches = Math.max(1, Number(lead.branches) || 1);
        const [l] = await tx<{ id: string }[]>`insert into tc.agent_lead (agent_id, business_name, owner_phone, plan, branches, admin_id)
          values (${agentId}, ${name}, ${phone}, ${plan}, ${branches}, ${a.id}) returning id`;
        await this.audit(tx, a, req, 'agent.lead_added', `Added a deal for ${ag.name}: ${name} (not registered yet)`, { detail: { agentId, leadId: l.id } });
        return { leadId: l.id };
      }
      const businessId = typeof b.businessId === 'string' ? b.businessId : '';
      const [biz] = await tx<{ name: string }[]>`select name from tc.business where id = ${businessId}`;
      if (!biz) throw notFound();
      const leadId = typeof b.leadId === 'string' ? b.leadId : null;
      if (leadId) {
        const [l] = await tx`select 1 from tc.agent_lead l where l.id = ${leadId} and l.agent_id = ${agentId} and not exists (select 1 from tc.deal d where d.lead_id = l.id)`;
        if (!l) throw badRequest('bad_lead');
      }
      await tx`insert into tc.deal (business_id, agent_id, how, lead_id, admin_id) values (${businessId}, ${agentId}, ${leadId ? 'lead' : 'admin'}, ${leadId}, ${a.id})`;
      await tx`update tc.business set agent_id = ${agentId} where id = ${businessId}`;
      await this.audit(tx, a, req, 'agent.deal', ag ? `Linked ${biz.name} to ${ag.name}` : `Removed the agent of ${biz.name}`, { businessId, detail: { agentId } });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- AdminFinanceReport* / AdminGovMark
  @Get('finance/report')
  async report(@CurrentActor() a: Actor, @Query('year') year?: string) {
    money(a);
    return this.buildReport(this.fy(year));
  }

  private async buildReport(fy: number) {
    const ev = await this.m.commissionEvents(this.sql, fy);
    const marks = await this.sql<{ eth_month: number; handed_over: boolean; amount_birr: number | null; how: string | null; reference: string | null; at: Date }[]>`
      select distinct on (eth_month) eth_month, handed_over, amount_birr, how, reference, at from tc.gov_share_mark
      where finance_year = ${fy} order by eth_month, id desc`;
    const sum = (rows: typeof ev) => {
      const payments = rows.reduce((s, e) => s + e.row.amount, 0);
      const commission = rows.reduce((s, e) => s + e.commission, 0);
      const govShare = rows.reduce((s, e) => s + e.govShare, 0);
      return { payments, commission, govShare, left: payments - commission - govShare };
    };
    const months = FINANCE_MONTHS.map((month) => {
      const mk = marks.find((x) => x.eth_month === month);
      return { month, ...sum(ev.filter((e) => e.row.ethMonth === month)), handedOver: mk?.handed_over ? { amount: mk.amount_birr, how: mk.how, reference: mk.reference, at: mk.at } : null };
    });
    const agentIds = [...new Set(ev.map((e) => e.agentId))];
    const names = new Map((await this.sql<{ id: string; name: string }[]>`select id, name from tc.agent`).map((r) => [r.id, r.name]));
    const byAgent = agentIds.map((id) => ({ agentId: id, agent: id ? names.get(id) ?? '' : null, ...sum(ev.filter((e) => e.agentId === id)) }))
      .sort((x, y) => y.commission - x.commission || y.payments - x.payments);
    return { financeYear: fy, months, byAgent, total: sum(ev) };
  }

  @Post('gov-share')
  async govShare(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const fy = Number(b.financeYear);
    const month = Number(b.month);
    if (!Number.isInteger(fy) || !FINANCE_MONTHS.includes(month) || typeof b.handedOver !== 'boolean') throw badRequest('bad_month');
    const amount = b.handedOver ? Number(b.amount) : null;
    if (b.handedOver && (!Number.isInteger(amount) || amount! < 0)) throw badRequest('bad_amount');
    return this.sql.begin(async (tx) => {
      await tx`insert into tc.gov_share_mark (finance_year, eth_month, handed_over, amount_birr, how, reference, admin_id)
               values (${fy}, ${month}, ${b.handedOver as boolean}, ${amount}, ${text(b.how, 80)}, ${text(b.reference, 100)}, ${a.id})`;
      await this.audit(tx, a, req, 'gov_share.marked', b.handedOver ? `Marked the government share of month ${month}, ${fy} as handed over` : `Marked the government share of month ${month}, ${fy} as not handed over`, { detail: { financeYear: fy, month, amount } });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- AdminExport*
  /**
   * A file, after the password and a fresh code every time (plan section 8). A wrong
   * code writes nothing and counts toward the lock. Owner: every file; Finance: money files.
   */
  @Post('exports/:kind')
  async exportFile(@Param('kind') kind: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    money(a);
    const moneyFiles = ['finance', 'finance-list', 'agents'];
    if (![...moneyFiles, 'businesses', 'log'].includes(kind)) throw notFound();
    if (!moneyFiles.includes(kind) && a.adminRole !== 'owner') throw forbidden();
    const { admin, proof } = await this.auth.reauth(a, b, req.ip);
    const fy = moneyDate().financeYear;
    let rows: unknown[][];
    if (kind === 'finance') {
      const r = await this.buildReport(fy);
      rows = ([['Month', 'Payments (Birr)', 'Commission (Birr)', 'Government share (Birr)', 'Left for Temelash (Birr)', 'Handed over']] as unknown[][])
        .concat(r.months.map((m) => [m.month, m.payments, m.commission, m.govShare, m.left, m.handedOver ? 'yes' : 'no']))
        .concat([['Total', r.total.payments, r.total.commission, r.total.govShare, r.total.left, '']]);
    } else if (kind === 'agents') {
      const list = await this.agents(a);
      rows = ([['Agent', 'Phone', 'Area', 'Deals', 'Earned (Birr)', 'Paid out (Birr)', 'Owed (Birr)']] as unknown[][]).concat(list.map((x) => [x.name, x.phone, x.area, x.deals, x.earned, x.paid, x.owed]));
    } else if (kind === 'finance-list' || kind === 'businesses') {
      const s = await this.summary(a);
      rows = ([['Business', 'Status', 'Plan', 'Branches', 'Fee (Birr)', 'Paid (Birr)', 'Balance (Birr)', 'Billing', 'Agent']] as unknown[][])
        .concat(s.businesses.map((x) => [x.name, x.status, x.plan, x.branches, x.fee, x.paid, x.balance, x.billing, x.agent]));
    } else {
      const log = await this.sql<{ at: Date; actor_type: string; type: string; text: string }[]>`select at, actor_type, type, text from tc.audit_log order by id desc limit 5000`;
      rows = ([['When', 'Who', 'Type', 'What']] as unknown[][]).concat(log.map((l) => [l.at.toISOString(), l.actor_type, l.type, l.text]));
    }
    const file = `temelash-${kind}-${fy}.csv`;
    await this.sql.begin(async (tx) => {
      await this.auth.use(tx, admin, proof, req.ip);
      await this.audit(tx, a, req, 'export.done', `Exported ${kind}`, { detail: { kind, file, rows: rows.length - 1 } });
    });
    return { file, csv: toCsv(rows) };
  }
}
