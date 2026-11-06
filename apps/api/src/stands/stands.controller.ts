import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { normalizePhone } from '../auth/pin';
import { InboxService } from '../messages/inbox.service';
import { claimsOf } from '../money/claims.controller';

type Tx = Sql | TransactionSql;
type Stage = 'placed' | 'confirmed' | 'printing' | 'way' | 'delivered';
const STAGES: Stage[] = ['placed', 'confirmed', 'printing', 'way', 'delivered'];
/** Stages that are not on the way yet: these orders make the production list. */
const TO_PREPARE: Stage[] = ['placed', 'confirmed', 'printing'];
const STAGE_MSG: Record<Exclude<Stage, 'placed'>, string> = { confirmed: 'standConfirmed', printing: 'standPrinting', way: 'standWay', delivered: 'standDelivered' };

interface OrderRow {
  id: string; code: string; business_id: string; business: string; stage: Stage; status: 'open' | 'done' | 'cancelled';
  received: 'ok' | 'problem' | null; received_note: string | null; total_birr: string; request_id: string | null;
}

function why(b: Record<string, unknown>): string {
  const r = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!r) throw badRequest('reason_needed');
  return r.slice(0, 500);
}

/** Lines of one or more orders, with the item names. */
async function linesOf(tx: Tx, orderIds: string[]) {
  if (!orderIds.length) return [];
  return tx<{ orderId: string; itemId: string; qty: number; price: number; name: Record<string, string> }[]>`
    select l.order_id as "orderId", l.item_id as "itemId", l.qty, l.price_birr::float as price, i.name
    from tc.stand_order_line l join tc.stand_item i on i.id = l.item_id
    where l.order_id = any(${orderIds}::uuid[]) order by i.sort`;
}

const ORDER_COLS = (tx: Tx) => tx`
  o.id, o.code, o.stage, o.status, o.total_birr::float as total, o.phone, o.print_language as language,
  o.received, o.received_at as "receivedAt", o.received_condition as "receivedCondition", o.received_pay as "receivedPay",
  o.received_note as "receivedNote", o.cash_received_birr::float as "cashReceived", o.result, o.created_at as "createdAt",
  o.updated_at as "updatedAt", br.name as branch, br.address, o.request_id as "requestId", o.paid_at as "paidAt"`;

/**
 * OwnStands, OwnStandCart, OwnStandPlaced, OwnStandOrders and OwnStandOrder*:
 * the stand shop, the order and the receiving report. Owners only (OWNONLY).
 */
@Controller('owner/stands')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerStandsController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  private ownerOnly(a: Actor) {
    if (a.type !== 'owner') throw forbidden();
  }

  @Get()
  async shop(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const items = await this.sql`
      select id, name, description, price_birr::float as price from tc.stand_item where visible order by sort`;
    const branches = await this.sql`
      select id, name, address from tc.branch where business_id = ${a.businessId!} and status = 'active' order by created_at`;
    const [me] = await this.sql<{ phone: string }[]>`select phone from tc.person where id = ${a.id}`;
    const [{ n }] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from tc.stand_order where business_id = ${a.businessId!} and created_at > now() - interval '12 months'`;
    return { items, branches, phone: me?.phone ?? '', orders: n };
  }

  /** OwnStandOrders: the last 12 months. */
  @Get('orders')
  async orders(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const rows = await this.sql<Array<{ id: string }>>`
      select ${ORDER_COLS(this.sql)} from tc.stand_order o join tc.branch br on br.id = o.branch_id
      where o.business_id = ${a.businessId!} and o.created_at > now() - interval '12 months' order by o.created_at desc`;
    const lines = await linesOf(this.sql, rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.orderId === r.id) }));
  }

  @Get('orders/:id')
  async order(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const [o] = await this.sql`
      select ${ORDER_COLS(this.sql)} from tc.stand_order o join tc.branch br on br.id = o.branch_id
      where o.id = ${id} and o.business_id = ${a.businessId!}`;
    if (!o) throw notFound();
    const history = await this.sql`select kind, stage, note, at from tc.stand_order_event where order_id = ${id} order by id`;
    return { ...o, lines: await linesOf(this.sql, [id]), history, claims: await claimsOf(this.sql, a.businessId!, id) };
  }

  /** OwnStandCart "Place order": prices from the admin list, kept on the order. */
  @Post('orders')
  async place(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const items = (b.items && typeof b.items === 'object' ? b.items : {}) as Record<string, unknown>;
    const want = Object.entries(items).filter(([, q]) => q !== 0);
    if (!want.length) throw badRequest('no_items');
    if (want.some(([, q]) => !Number.isInteger(q) || (q as number) < 1 || (q as number) > 20)) throw badRequest('bad_quantity');
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    const language = typeof b.language === 'string' && ['en', 'am', 'om', 'all'].includes(b.language) ? b.language : null;
    if (!language) throw badRequest('bad_language');
    const branchId = typeof b.branchId === 'string' ? b.branchId : '';
    return this.sql.begin(async (tx) => {
      const [br] = await tx<{ id: string }[]>`
        select id from tc.branch where id::text = ${branchId} and business_id = ${a.businessId!} and status = 'active'`;
      if (!br) throw badRequest('bad_branch');
      const ids = want.map(([id]) => id);
      const priced = await tx<{ id: string; price: number; name: Record<string, string> }[]>`
        select id, price_birr::float as price, name from tc.stand_item where id = any(${ids}) and visible`;
      if (priced.length !== ids.length) throw badRequest('bad_item');
      const total = priced.reduce((s, i) => s + i.price * (items[i.id] as number), 0);
      const [biz] = await tx<{ name: string }[]>`select name from tc.business where id = ${a.businessId!}`;
      const [o] = await tx<{ id: string; code: string }[]>`
        insert into tc.stand_order (business_id, branch_id, person_id, phone, print_language, total_birr)
        values (${a.businessId!}, ${br.id}, ${a.id}, ${phone}, ${language}, ${total}) returning id, code`;
      for (const i of priced) {
        await tx`insert into tc.stand_order_line (order_id, item_id, qty, price_birr) values (${o.id}, ${i.id}, ${items[i.id] as number}, ${i.price})`;
      }
      // AdminReqStand: the order is a request in the admin inbox.
      const [r] = await tx<{ id: string }[]>`
        insert into tc.request (type, business_id, stage, payload) values ('stand_order', ${a.businessId!}, 'new', ${tx.json({ orderId: o.id, code: o.code })}) returning id`;
      await tx`update tc.stand_order set request_id = ${r.id} where id = ${o.id}`;
      await tx`insert into tc.stand_order_event (order_id, kind, stage, actor_type, actor_id) values (${o.id}, 'placed', 'placed', 'owner', ${a.id})`;
      const what = priced.map((i) => `${i.name.en} × ${items[i.id] as number}`).join(', ');
      await writeAudit(tx, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'stand.ordered',
        text: `Ordered stands, ${o.code}`, detail: { orderId: o.id, code: o.code, items: what, totalBirr: total, business: biz?.name } });
      return { id: o.id, code: o.code, total, phone };
    });
  }

  /** OwnStandOrder "Did your order arrive?": all fine (and how they paid), or a problem with a note. */
  @Post('orders/:id/receive')
  async receive(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const condition = b.condition;
    if (condition !== 'ok' && condition !== 'missing' && condition !== 'damaged') throw badRequest('bad_condition');
    const ok = condition === 'ok';
    const asked = ok && b.pay === 'cash' ? 'cash' : null;
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 120) : '';
    if (!ok && !note) throw badRequest('note_needed');
    return this.sql.begin(async (tx) => {
      const [o] = await tx<Array<OrderRow & { paid_at: Date | null }>>`
        select o.id, o.code, o.stage, o.status, o.received, o.paid_at from tc.stand_order o
        where o.id = ${id} and o.business_id = ${a.businessId!} for update`;
      if (!o) throw notFound();
      // Paid ahead by an approved transfer: nothing to ask about paying.
      const pay = ok ? (o.paid_at ? 'prepaid' : asked) : null;
      if (ok && !pay) throw badRequest('bad_pay');
      if (o.status !== 'open' || (o.stage !== 'way' && o.stage !== 'delivered') || o.received) throw conflict('not_waiting');
      await tx`update tc.stand_order set received = ${ok ? 'ok' : 'problem'}, received_at = now(), received_condition = ${condition},
        received_pay = ${pay}, received_note = ${ok ? null : note}, updated_at = now() where id = ${id}`;
      await tx`insert into tc.stand_order_event (order_id, kind, note, actor_type, actor_id) values (${id}, ${ok ? 'received' : 'problem'}, ${ok ? pay : note}, 'owner', ${a.id})`;
      await writeAudit(tx, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: ok ? 'stand.received' : 'stand.problem',
        text: ok ? `Confirmed stand order received, ${o.code}` : `Reported a problem with stand order ${o.code}`, detail: { orderId: id, condition, pay, note: ok ? undefined : note } });
      return { ok: true };
    });
  }
}

/**
 * AdminStandsProduction / Prices / Stock and AdminReqStand*: the production
 * list, prices, hand-counted stock and moving an order to the owner's door.
 */
@Controller('admin/stands')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminStandsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly inbox: InboxService,
  ) {}

  private audit(tx: Tx, a: Actor, req: Request, type: string, text: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text, ...extra });
  }

  /** Items, the production list (open orders not on the way yet, against stock) and those orders. */
  @Get()
  async stands() {
    const items = await this.sql<Array<{ id: string; stock: number; lowAt: number; name: Record<string, string>; price: number; visible: boolean }>>`
      select id, name, description, price_birr::float as price, visible, stock, low_at as "lowAt" from tc.stand_item order by sort`;
    const orders = await this.sql<Array<{ id: string }>>`
      select o.id, o.code, o.stage, o.created_at as "createdAt", o.request_id as "requestId", b.name as business, br.name as branch, br.address
      from tc.stand_order o join tc.business b on b.id = o.business_id join tc.branch br on br.id = o.branch_id
      where o.status = 'open' and o.stage = any(${TO_PREPARE}) order by o.created_at`;
    const lines = await linesOf(this.sql, orders.map((o) => o.id));
    const production = items.map((i) => {
      const ordered = lines.filter((l) => l.itemId === i.id).reduce((s, l) => s + l.qty, 0);
      return { id: i.id, name: i.name, price: i.price, ordered, stock: i.stock, toMake: Math.max(0, ordered - i.stock) };
    });
    return {
      items, production, low: items.filter((i) => i.stock <= i.lowAt).length,
      orders: orders.map((o) => ({ ...o, lines: lines.filter((l) => l.orderId === o.id) })),
    };
  }

  @Get('orders/:id')
  async order(@Param('id', ParseUUIDPipe) id: string) {
    const [o] = await this.sql`
      select ${ORDER_COLS(this.sql)}, o.business_id as "businessId", b.name as business
      from tc.stand_order o join tc.branch br on br.id = o.branch_id join tc.business b on b.id = o.business_id where o.id = ${id}`;
    if (!o) throw notFound();
    const history = await this.sql`select kind, stage, note, actor_type as "actorType", at from tc.stand_order_event where order_id = ${id} order by id`;
    return { ...o, lines: await linesOf(this.sql, [id]), history };
  }

  /** AdminStandsPrices: price and "can owners order it?"; placed orders keep their price. */
  @Post('items/:id')
  async price(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (a.adminRole !== 'owner' && a.adminRole !== 'finance') throw forbidden();
    const price = Number(b.price);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw badRequest('bad_price');
    const visible = b.visible !== false;
    return this.sql.begin(async (tx) => {
      const [old] = await tx<{ name: Record<string, string>; price: number; visible: boolean }[]>`
        select name, price_birr::float as price, visible from tc.stand_item where id = ${id} for update`;
      if (!old) throw notFound();
      await tx`update tc.stand_item set price_birr = ${price}, visible = ${visible}, updated_at = now() where id = ${id}`;
      await this.audit(tx, a, req, 'stand.price', `Changed the stand price: ${old.name.en}`, { detail: { itemId: id, from: old.price, to: price, visible } });
      return { ok: true };
    });
  }

  /** AdminStandsStock: add or take away with a reason; never below zero. */
  @Post('stock/:id')
  async stock(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const change = Number(b.change);
    if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 100_000) throw badRequest('bad_change');
    const reason = why(b);
    return this.sql.begin(async (tx) => {
      const [it] = await tx<{ name: Record<string, string>; stock: number }[]>`select name, stock from tc.stand_item where id = ${id} for update`;
      if (!it) throw notFound();
      const after = it.stock + change;
      if (after < 0) throw conflict('stock_below_zero', { stock: it.stock });
      await tx`update tc.stand_item set stock = ${after}, updated_at = now() where id = ${id}`;
      await tx`insert into tc.stand_stock_move (item_id, change, stock_after, reason, admin_id) values (${id}, ${change}, ${after}, ${reason}, ${a.id})`;
      await this.audit(tx, a, req, 'stand.stock', `Changed the stock of ${it.name.en}`, { detail: { itemId: id, from: it.stock, to: after, reason } });
      return { stock: after };
    });
  }

  private async lock(tx: Tx, id: string): Promise<OrderRow> {
    const [o] = await tx<OrderRow[]>`
      select o.id, o.code, o.business_id, b.name as business, o.stage, o.status, o.received, o.received_note, o.total_birr, o.request_id
      from tc.stand_order o join tc.business b on b.id = o.business_id where o.id = ${id} for update of o`;
    if (!o) throw notFound();
    if (o.status !== 'open') throw conflict('order_closed');
    return o;
  }

  private async event(tx: Tx, a: Actor, id: string, kind: string, stage: string | null, note: string | null) {
    await tx`insert into tc.stand_order_event (order_id, kind, stage, note, actor_type, actor_id) values (${id}, ${kind}, ${stage}, ${note}, 'admin', ${a.id})`;
  }

  private async request(tx: Tx, o: OrderRow, a: Actor, stage: 'progress' | 'done', result: string | null = null) {
    if (o.request_id) {
      await tx`update tc.request set stage = ${stage}, result = coalesce(${result}, result), assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now() where id = ${o.request_id}`;
    }
  }

  /** "Move to: …": one stage forward; each step tells the owner. */
  @Post('orders/:id/stage')
  async stage(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const to = b.stage as Stage;
    if (!STAGES.includes(to) || to === 'placed') throw badRequest('bad_stage');
    return this.sql.begin(async (tx) => {
      const o = await this.lock(tx, id);
      if (STAGES.indexOf(to) !== STAGES.indexOf(o.stage) + 1) throw conflict('not_next_stage', { stage: o.stage });
      await tx`update tc.stand_order set stage = ${to}, updated_at = now() where id = ${id}`;
      await this.event(tx, a, id, 'stage', to, null);
      await this.request(tx, o, a, 'progress');
      const m = STAGE_MSG[to as Exclude<Stage, 'placed'>];
      await this.inbox.system(tx, o.business_id, `inbox.${m}T`, `inbox.${m}B`, { a: o.code }, 'standorder', id);
      await this.audit(tx, a, req, 'stand.stage', `Moved stand order ${o.code} to ${to}`, { businessId: o.business_id, detail: { orderId: id, from: o.stage, to } });
      return { stage: to };
    });
  }

  /** AdminReqStandProblem "Send a replacement": back to Printing; the owner's report stays in the history. */
  @Post('orders/:id/replace')
  async replace(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const o = await this.lock(tx, id);
      if (o.received !== 'problem') throw conflict('no_problem');
      await tx`update tc.stand_order set stage = 'printing', received = null, received_at = null, received_condition = null,
        received_pay = null, received_note = null, updated_at = now() where id = ${id}`;
      await this.event(tx, a, id, 'replacement', 'printing', o.received_note);
      await this.request(tx, o, a, 'progress');
      await this.inbox.system(tx, o.business_id, 'inbox.standReplaceT', 'inbox.standReplaceB', { a: o.code }, 'standorder', id);
      await this.audit(tx, a, req, 'stand.replacement', `Replacement for stand order ${o.code} sent to print`, { businessId: o.business_id, detail: { orderId: id, note: o.received_note } });
      return { stage: 'printing' };
    });
  }

  /** "Close without a replacement": only after a problem, after agreeing with the owner. */
  @Post('orders/:id/close')
  async close(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const reason = why(b);
    return this.sql.begin(async (tx) => {
      const o = await this.lock(tx, id);
      if (o.received !== 'problem') throw conflict('no_problem');
      const result = `Closed after a problem: ${o.received_note ?? ''}`.trim();
      await tx`update tc.stand_order set status = 'done', result = ${result}, updated_at = now() where id = ${id}`;
      await this.event(tx, a, id, 'closed', null, reason);
      await this.request(tx, o, a, 'done', result);
      await this.inbox.system(tx, o.business_id, 'inbox.standClosedT', 'inbox.standClosedB', { a: o.code }, 'standorder', id);
      await this.audit(tx, a, req, 'stand.closed', `Stand order ${o.code} closed after a problem`, { businessId: o.business_id, detail: { orderId: id, reason, note: o.received_note } });
      return { status: 'done' };
    });
  }

  /** "Remind the owner to confirm": a message in the owner app. */
  @Post('orders/:id/remind')
  async remind(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const o = await this.lock(tx, id);
      if ((o.stage !== 'way' && o.stage !== 'delivered') || o.received) throw conflict('not_waiting');
      await this.event(tx, a, id, 'reminded', null, null);
      await this.inbox.system(tx, o.business_id, 'inbox.standRemindT', 'inbox.standRemindB', { a: o.code }, 'standorder', id);
      await this.audit(tx, a, req, 'stand.reminded', `Reminded the owner of ${o.business} to confirm stand order ${o.code}`, { businessId: o.business_id, detail: { orderId: id } });
      return { ok: true };
    });
  }

  /** "Cash received": closes a delivered order with no open problem. */
  @Post('orders/:id/cash')
  async cash(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const o = await this.lock(tx, id);
      if ((o.stage !== 'way' && o.stage !== 'delivered') || o.received === 'problem') throw conflict('not_deliverable');
      const [{ paid }] = await tx<{ paid: boolean }[]>`select paid_at is not null as paid from tc.stand_order where id = ${id}`;
      const result = paid ? 'Delivered, paid by transfer' : 'Delivered, cash received';
      await tx`update tc.stand_order set status = 'done', cash_received_birr = case when ${paid} then null else total_birr end, result = ${result}, updated_at = now() where id = ${id}`;
      await this.event(tx, a, id, 'closed', null, result);
      await this.request(tx, o, a, 'done', result);
      await this.audit(tx, a, req, 'stand.cash', `Stand order ${o.code} delivered, cash received`, { businessId: o.business_id, detail: { orderId: id, birr: Number(o.total_birr) } });
      return { status: 'done' };
    });
  }

  /** "Cancel this order": only before it is on the way; no cash is taken. */
  @Post('orders/:id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const reason = why(b);
    return this.sql.begin(async (tx) => {
      const o = await this.lock(tx, id);
      if (!TO_PREPARE.includes(o.stage)) throw conflict('already_on_the_way');
      const result = `Cancelled: ${reason}`;
      await tx`update tc.stand_order set status = 'cancelled', result = ${result}, updated_at = now() where id = ${id}`;
      await this.event(tx, a, id, 'cancelled', null, reason);
      await this.request(tx, o, a, 'done', result);
      await this.inbox.system(tx, o.business_id, 'inbox.standCancelT', 'inbox.standCancelB', { a: o.code, b: reason }, 'standorder', id);
      await this.audit(tx, a, req, 'stand.cancelled', `Cancelled stand order ${o.code}`, { businessId: o.business_id, detail: { orderId: id, reason } });
      return { status: 'cancelled' };
    });
  }
}
