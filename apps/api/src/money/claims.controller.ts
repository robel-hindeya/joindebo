import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { SmsSender, smsLanguage, smsText } from '../sms/sms';
import { InboxService } from '../messages/inbox.service';
import { MoneyService, billingOf, moneyDate, todayEat } from './money.service';

type Tx = Sql | TransactionSql;

/** Plan billing now: fee, paid and state for the current finance year. */
async function billing(m: MoneyService, tx: Tx, businessId: string, status: string) {
  const fy = moneyDate().financeYear;
  const t = await m.feeFor(tx, businessId, fy);
  const paid = await m.paid(tx, businessId, fy);
  return { fy, t, paid, fee: t?.fee ?? 0, balance: Math.max(0, (t?.fee ?? 0) - paid), billing: billingOf(status, t, paid, todayEat()) };
}

/** The owner's payments sent, newest first (plan page and stand orders). */
export async function claimsOf(tx: Tx, businessId: string, orderId: string | null = null) {
  return tx`
    select c.id, c.purpose, c.method, c.amount_birr as amount, c.transaction_id as "transactionId", c.received_by as "receivedBy", to_char(c.paid_on, 'YYYY-MM-DD') as "paidOn",
      c.status, c.reason, c.created_at as "createdAt", c.decided_at as "decidedAt", p.receipt_no as "receiptNo"
    from tc.payment_claim c left join tc.payment p on p.id = c.payment_id
    where c.business_id = ${businessId} and (${orderId}::uuid is null or c.stand_order_id = ${orderId})
      and (${orderId}::uuid is not null or c.purpose = 'plan')
    order by c.created_at desc limit 50`;
}

/**
 * Paying in cash (DECISIONS.md, 2026-11-06): the owner pays, then reports the amount, the day and
 * who took the money, and an admin approves it. Owners only.
 */
@Controller('owner/payments')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerPaymentsController {
  constructor(@Inject(SQL) private readonly sql: Sql, private readonly m: MoneyService) {}

  @Post()
  async send(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (a.type !== 'owner') throw forbidden();
    const purpose = b.purpose === 'stand' ? 'stand' : b.purpose === 'plan' ? 'plan' : null;
    if (!purpose) throw badRequest('bad_purpose');
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) throw badRequest('bad_amount');
    const receivedBy = typeof b.receivedBy === 'string' ? b.receivedBy.trim().replace(/\s+/g, ' ') : '';
    if (receivedBy.length < 2 || receivedBy.length > 80) throw badRequest('received_by_needed');
    const paidOn = typeof b.paidOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.paidOn) ? b.paidOn : '';
    if (!paidOn || paidOn > todayEat() || paidOn < new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)) throw badRequest('bad_paid_on');
    const orderId = purpose === 'stand' ? (typeof b.orderId === 'string' ? b.orderId : '') : null;
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string; status: string }[]>`select name, status from tc.business where id = ${a.businessId!} for update`;
      if (purpose === 'plan') {
        const st = await billing(this.m, tx, a.businessId!, biz.status);
        if (st.billing === 'pilot' || st.billing === 'none' || st.balance === 0) throw conflict('nothing_to_pay');
      } else {
        const [o] = await tx<{ total: number; status: string; paid_at: Date | null }[]>`
          select total_birr::float as total, status, paid_at from tc.stand_order where id::text = ${orderId} and business_id = ${a.businessId!} for update`;
        if (!o) throw notFound();
        if (o.paid_at || o.status !== 'open') throw conflict('nothing_to_pay');
        if (amount !== Math.round(o.total)) throw badRequest('bad_amount', { total: o.total });
      }
      // One report at a time, so a double tap cannot count the same cash twice.
      const [open] = await tx`select 1 from tc.payment_claim where business_id = ${a.businessId!} and purpose = ${purpose} and stand_order_id is not distinct from ${orderId}::uuid and status = 'waiting'`;
      if (open) throw conflict('claim_waiting');
      const ref = `CASH-${randomBytes(4).toString('hex').toUpperCase()}`;
      const [c] = await tx<{ id: string }[]>`
        insert into tc.payment_claim (business_id, purpose, stand_order_id, method, amount_birr, transaction_id, received_by, paid_on, person_id)
        values (${a.businessId!}, ${purpose}, ${orderId}, 'cash', ${amount}, ${ref}, ${receivedBy}, ${paidOn}, ${a.id}) returning id`;
      await writeAudit(tx, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'payment.claim_sent',
        text: `Reported a cash payment to check: ${amount} Birr`, detail: { claimId: c.id, purpose, amount, method: 'cash', reference: ref, receivedBy, orderId } });
      return { id: c.id, status: 'waiting', reference: ref };
    });
  }
}

/** "Payments to check" and "Extend the trial" (Admin, Finance). Owner and Finance only: money. */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminClaimsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly m: MoneyService,
    private readonly inbox: InboxService,
    private readonly sms: SmsSender,
  ) {}

  private money(a: Actor) {
    if (a.adminRole !== 'owner' && a.adminRole !== 'finance') throw forbidden();
  }

  private audit(tx: Tx, a: Actor, req: Request, type: string, text: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text, ...extra });
  }

  /** The owner hears by inbox and SMS. */
  private async tell(tx: Tx, businessId: string, key: string, vars: Record<string, string | number>, template: string) {
    await this.inbox.system(tx, businessId, `inbox.${key}T`, `inbox.${key}B`, vars, 'plan');
    const [owner] = await tx<{ phone: string }[]>`select phone from tc.person where business_id = ${businessId} and role = 'owner' and status = 'active' limit 1`;
    if (owner) {
      const lang = await smsLanguage(tx, owner.phone, 'person');
      await this.sms.send(tx, owner.phone, template, smsText(lang, key, vars), { language: lang });
    }
  }

  @Get('payment-claims')
  async list(@CurrentActor() a: Actor, @Query('status') status?: string) {
    this.money(a);
    const want = ['waiting', 'approved', 'rejected'].includes(status ?? '') ? status! : 'waiting';
    const rows = await this.sql<Array<{ businessId: string; status: string; bizStatus: string; purpose: string }>>`
      select c.id, c.purpose, c.method, c.amount_birr as amount, c.transaction_id as "transactionId", c.received_by as "receivedBy", to_char(c.paid_on, 'YYYY-MM-DD') as "paidOn",
        c.status, c.reason, c.created_at as "createdAt", c.decided_at as "decidedAt", b.id as "businessId", b.name as business, b.status as "bizStatus",
        o.code as "orderCode", pe.name as "sentBy", ad.name as "decidedBy"
      from tc.payment_claim c join tc.business b on b.id = c.business_id join tc.person pe on pe.id = c.person_id
      left join tc.stand_order o on o.id = c.stand_order_id left join tc.admin_user ad on ad.id = c.decided_by
      where c.status = ${want} order by c.created_at ${want === 'waiting' ? this.sql`asc` : this.sql`desc`} limit 200`;
    const out = [];
    for (const r of rows) {
      const st = r.purpose === 'plan' ? await billing(this.m, this.sql, r.businessId, r.bizStatus) : null;
      out.push({ ...r, balance: st?.balance ?? null, fee: st?.fee ?? null });
    }
    return out;
  }

  @Get('payment-claims/:id')
  async one(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    this.money(a);
    const [c] = await this.sql<Array<{ businessId: string; bizStatus: string; purpose: string }>>`
      select c.id, c.purpose, c.method, c.amount_birr as amount, c.transaction_id as "transactionId", c.received_by as "receivedBy", to_char(c.paid_on, 'YYYY-MM-DD') as "paidOn",
        c.status, c.reason, c.created_at as "createdAt", c.decided_at as "decidedAt", b.id as "businessId", b.name as business, b.status as "bizStatus",
        o.code as "orderCode", o.total_birr::float as "orderTotal", pe.name as "sentBy", pe.phone as "sentByPhone", ad.name as "decidedBy", p.receipt_no as "receiptNo", p.id as "paymentId"
      from tc.payment_claim c join tc.business b on b.id = c.business_id join tc.person pe on pe.id = c.person_id
      left join tc.stand_order o on o.id = c.stand_order_id left join tc.admin_user ad on ad.id = c.decided_by left join tc.payment p on p.id = c.payment_id
      where c.id = ${id}`;
    if (!c) throw notFound();
    const [proof] = await this.sql<{ content_type: string; bytes: Buffer }[]>`select content_type, bytes from tc.payment_claim_proof where claim_id = ${id}`;
    const st = c.purpose === 'plan' ? await billing(this.m, this.sql, c.businessId, c.bizStatus) : null;
    return { ...c, balance: st?.balance ?? null, fee: st?.fee ?? null, screenshot: proof ? { type: proof.content_type, data: Buffer.from(proof.bytes).toString('base64') } : null };
  }

  private async lock(tx: Tx, id: string) {
    const [c] = await tx<{ id: string; business_id: string; purpose: string; stand_order_id: string | null; method: string; amount_birr: number; transaction_id: string; status: string; name: string; biz_status: string; paused_unpaid: boolean }[]>`
      select c.id, c.business_id, c.purpose, c.stand_order_id, c.method, c.amount_birr, c.transaction_id, c.status, b.name, b.status as biz_status, b.paused_unpaid
      from tc.payment_claim c join tc.business b on b.id = c.business_id where c.id = ${id} for update of c, b`;
    if (!c) throw notFound();
    if (c.status !== 'waiting') throw conflict('already_decided');
    return c;
  }

  /** Approve: a plan payment becomes a receipt; a stand payment marks its order paid. */
  @Post('payment-claims/:id/approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    this.money(a);
    return this.sql.begin(async (tx) => {
      const c = await this.lock(tx, id);
      let receiptNo: string | null = null;
      let paymentId: string | null = null;
      if (c.purpose === 'plan') {
        if (['pending', 'rejected', 'closed'].includes(c.biz_status)) throw conflict('not_billable');
        const now = moneyDate();
        receiptNo = await this.m.receiptNo(tx);
        [{ id: paymentId }] = await tx<{ id: string }[]>`
          insert into tc.payment (business_id, kind, amount_birr, method, reference, receipt_no, finance_year, eth_month, admin_id)
          values (${c.business_id}, 'payment', ${c.amount_birr}, ${c.method}, ${c.transaction_id}, ${receiptNo}, ${now.financeYear}, ${now.ethMonth}, ${a.id}) returning id`;
        const st = await billing(this.m, tx, c.business_id, c.biz_status);
        // Paid in full: the trial ends, and a pause for not paying lifts. A pause an admin chose stays.
        if (st.billing === 'paid' && (c.biz_status === 'trial' || (c.biz_status === 'paused' && c.paused_unpaid))) {
          await tx`update tc.business set status = 'active', paused_unpaid = false where id = ${c.business_id}`;
        }
      } else {
        await tx`update tc.stand_order set paid_claim_id = ${id}, paid_at = now(), updated_at = now() where id = ${c.stand_order_id} and paid_at is null`;
        await tx`insert into tc.stand_order_event (order_id, kind, note, actor_type, actor_id) values (${c.stand_order_id}, 'paid', ${c.transaction_id}, 'admin', ${a.id})`;
      }
      await tx`update tc.payment_claim set status = 'approved', decided_by = ${a.id}, decided_at = now(), payment_id = ${paymentId} where id = ${id}`;
      await this.tell(tx, c.business_id, 'payOk', { a: c.amount_birr.toLocaleString('en-US'), b: c.transaction_id }, 'payment_approved');
      await this.audit(tx, a, req, 'payment.claim_approved', `Approved a payment from ${c.name}`, { businessId: c.business_id,
        detail: { claimId: id, purpose: c.purpose, amount: c.amount_birr, method: c.method, transactionId: c.transaction_id, receiptNo } });
      return { status: 'approved', receiptNo, paymentId };
    });
  }

  @Post('payment-claims/:id/reject')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.money(a);
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
    if (!reason) throw badRequest('reason_needed');
    return this.sql.begin(async (tx) => {
      const c = await this.lock(tx, id);
      await tx`update tc.payment_claim set status = 'rejected', reason = ${reason}, decided_by = ${a.id}, decided_at = now() where id = ${id}`;
      await this.tell(tx, c.business_id, 'payNo', { a: c.transaction_id, b: reason }, 'payment_rejected');
      await this.audit(tx, a, req, 'payment.claim_rejected', `Rejected a payment from ${c.name}`, { businessId: c.business_id,
        detail: { claimId: id, purpose: c.purpose, amount: c.amount_birr, transactionId: c.transaction_id, reason } });
      return { status: 'rejected' };
    });
  }

  /**
   * "Extend the trial" to a day the admin picks (the board offers 7, 14 or 30 days; the
   * screen turns those into a date). The trial runs to the end of that East Africa day.
   */
  @Post('businesses/:id/trial')
  async extendTrial(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.money(a);
    const until = typeof b.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.until) ? b.until : '';
    const today = todayEat();
    const max = new Date(Date.parse(today + 'T00:00:00Z') + 365 * 86_400_000).toISOString().slice(0, 10);
    if (!until || until <= today || until > max) throw badRequest('bad_date');
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string; status: string; paused_unpaid: boolean; trial_ends_at: Date | null }[]>`
        select name, status, paused_unpaid, trial_ends_at from tc.business where id = ${id} for update`;
      if (!biz) throw notFound();
      const st = await billing(this.m, tx, id, biz.status);
      if (!st.t || st.billing === 'pilot' || st.billing === 'paid' || !['trial', 'active', 'paused'].includes(biz.status) || (biz.status === 'paused' && !biz.paused_unpaid)) throw conflict('no_trial');
      await tx`update tc.business set trial_ends_at = (${until}::date + 1)::timestamp at time zone 'Africa/Addis_Ababa', status = 'trial', paused_unpaid = false where id = ${id}`;
      await this.m.setFee(tx, id, st.fy, { ...st.t, start: until, dueOn: until }, 'trial_extended', a.id);
      await this.audit(tx, a, req, 'business.trial_extended', `Extended the trial of ${biz.name} to ${until}`, { businessId: id, detail: { from: biz.trial_ends_at, to: until } });
      return { status: 'trial', until };
    });
  }
}
