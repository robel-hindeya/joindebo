import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { SafetyService } from '../settings/safety.service';
import { badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { maskPhone, normalizePhone } from '../auth/pin';
import { cardProgress } from '../stamps/cards';
import { SmsSender, smsLanguage, smsText } from '../sms/sms';
import { InboxService } from '../messages/inbox.service';
import { AdminAuthService } from './admin-auth.service';
import { createAdmin, tempPassword, type AdminRole } from './accounts';
import { MoneyService, moneyDate } from '../money/money.service';

type Tx = Sql | TransactionSql;
const ROLES: AdminRole[] = ['owner', 'finance', 'support'];

function need(a: Actor, ...roles: AdminRole[]): void {
  if (!a.adminRole || !roles.includes(a.adminRole)) throw forbidden();
}

function reason(b: Record<string, unknown>): string {
  const r = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!r) throw badRequest('reason_needed');
  return r.slice(0, 500);
}

/**
 * The Temelash back-office (Admin board): overview, businesses, requests,
 * search, the log, settings, the team and the kill switch. Every action, and
 * every look at a business or a person, is written to the audit log with the
 * admin as actor (plan section 8).
 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    private readonly safety: SafetyService,
    private readonly auth: AdminAuthService,
    private readonly sms: SmsSender,
    private readonly money: MoneyService,
    private readonly inbox: InboxService,
  ) {}

  private audit(tx: Tx, a: Actor, req: Request, type: string, text: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text, ...extra });
  }

  // ---------------------------------------------------------------- AdminOverview
  @Get('overview')
  async overview() {
    const byStatus = await this.sql<{ status: string; n: number }[]>`select status, count(*)::int n from tc.business group by status`;
    const [n] = await this.sql<{ customers: number; stamps_today: number; open_requests: number; signups: number; flags: number }[]>`
      select (select count(*)::int from tc.customer where status = 'active') customers,
        (select count(*)::int from tc.stamp where kind = 'add' and (at at time zone 'Africa/Addis_Ababa')::date = (now() at time zone 'Africa/Addis_Ababa')::date) stamps_today,
        (select count(*)::int from tc.request where stage <> 'done') open_requests,
        (select count(*)::int from tc.request where type = 'signup' and stage <> 'done') signups,
        (select count(*)::int from tc.request where type = 'flag' and stage <> 'done') flags`;
    const businesses: Record<string, number> = { pending: 0, trial: 0, active: 0, paused: 0, closing: 0, closed: 0, rejected: 0 };
    for (const r of byStatus) businesses[r.status] = r.n;
    const [m] = await this.sql<{ stamps30d: number; cards: number; new_this_week: number }[]>`
      select (select count(*)::int from tc.stamp s where s.kind = 'add' and s.method in ('scan', 'typed') and s.at > now() - interval '30 days') "stamps30d",
        (select count(*)::int from tc.card) cards,
        (select count(*)::int from tc.business where status not in ('rejected') and created_at > now() - interval '7 days') new_this_week`;
    // "New businesses per week": the last 8 weeks, oldest first (week starting, East Africa Time).
    const newPerWeek = await this.sql<{ weekStart: string; count: number }[]>`
      select to_char(w::date, 'YYYY-MM-DD') as "weekStart",
        (select count(*)::int from tc.business b where b.status <> 'rejected'
           and (b.created_at at time zone 'Africa/Addis_Ababa')::date >= w::date and (b.created_at at time zone 'Africa/Addis_Ababa')::date < w::date + 7) as count
      from generate_series(((now() at time zone 'Africa/Addis_Ababa')::date - 55)::timestamp,
                           ((now() at time zone 'Africa/Addis_Ababa')::date - 6)::timestamp, interval '7 days') as w
      order by w`;
    const attention = await this.sql`
      select r.id, r.type, r.stage, r.created_at as "createdAt", b.name as business
      from tc.request r left join tc.business b on b.id = r.business_id where r.stage <> 'done' order by r.created_at limit 6`;
    const watch = await this.sql`
      select b.id, b.name, b.status, (select l.text from tc.audit_log l where l.business_id = b.id and l.type = 'business.paused' order by l.id desc limit 1) as why
      from tc.business b where b.status in ('paused', 'closing') order by b.name limit 5`;
    return {
      businesses,
      newThisWeek: m.new_this_week,
      customers: n.customers,
      cards: m.cards,
      stampsToday: n.stamps_today,
      stamps30d: m.stamps30d,
      requests: { open: n.open_requests, signups: n.signups, flags: n.flags },
      newPerWeek,
      attention,
      watch,
      killSwitch: await this.safety.killSwitch(),
    };
  }

  /** The signed-in admin, for the sidebar and My account. */
  @Get('me')
  async me(@CurrentActor() a: Actor) {
    const [m] = await this.sql`
      select id, name, email, role, last_login_at as "lastLoginAt", cardinality(backup_code_hashes) as "backupCodesLeft", new_device_alert as "newDeviceAlert"
      from tc.admin_user where id = ${a.id}`;
    return m;
  }

  // ---------------------------------------------------------------- AdminBusinesses / AdminBusiness*
  @Get('businesses')
  async businesses(@Query('q') q?: string, @Query('status') status?: string) {
    const like = `%${(q ?? '').trim()}%`;
    return this.sql`
      select b.id, b.name, b.category, b.city, b.status, b.plan, b.shop_code as "shopCode", b.trial_ends_at as "trialEndsAt", b.created_at as "createdAt",
        o.name as owner, o.phone as "ownerPhone", ag.name as agent,
        (select count(*)::int from tc.branch br where br.business_id = b.id and br.status = 'active') as branches,
        (select count(*)::int from tc.card c where c.business_id = b.id) as customers,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id
          where c.business_id = b.id and s.kind = 'add' and s.method in ('scan', 'typed') and s.at > now() - interval '30 days') as "stamps30d",
        (select max(s.at) from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = b.id) as "lastActive"
      from tc.business b
      left join tc.person o on o.business_id = b.id and o.role = 'owner' and o.status = 'active'
      left join tc.agent ag on ag.id = b.agent_id
      where (b.name ilike ${like} or b.shop_code ilike ${like} or b.city ilike ${like} or o.name ilike ${like} or o.phone like ${like})
        and (${status ?? ''} = '' or b.status = ${status ?? ''})
      order by b.created_at desc limit 500`;
  }

  @Get('businesses/:id')
  async business(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const [b] = await this.sql`
      select b.id, b.name, b.category, b.city, b.status, b.plan, b.plan_date as "planDate", b.trial_ends_at as "trialEndsAt",
        b.shop_code as "shopCode", b.created_at as "createdAt", ag.name as agent, ag.phone as "agentPhone"
      from tc.business b left join tc.agent ag on ag.id = b.agent_id where b.id = ${id}`;
    if (!b) throw notFound();
    const branches = await this.sql`select id, name, address, status from tc.branch where business_id = ${id} order by created_at`;
    const people = await this.sql`
      select p.id, p.name, p.role, p.phone, p.status, (p.locked_until > now()) as locked, p.pin_set_at as "pinSetAt",
        (select max(s.created_at) from tc.session s where s.actor_id = p.id) as "lastSignIn",
        coalesce((select array_agg(br.name order by br.name) from tc.person_branch pb join tc.branch br on br.id = pb.branch_id where pb.person_id = p.id), '{}') as branches
      from tc.person p where p.business_id = ${id}
      order by case p.role when 'owner' then 0 when 'manager' then 1 else 2 end, p.name`;
    const [counts] = await this.sql`
      select (select count(*)::int from tc.card where business_id = ${id}) customers,
        (select count(*)::int from tc.branch where business_id = ${id} and status = 'active') branches,
        (select count(*)::int from tc.person where business_id = ${id} and role <> 'owner' and status = 'active') staff,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = ${id} and s.kind = 'add'
          and s.method in ('scan', 'typed') and s.at > now() - interval '30 days') "stamps30d",
        (select max(s.at) from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = ${id}) "lastActive"`;
    const requests = await this.sql`select id, type, stage, result, created_at as "createdAt" from tc.request where business_id = ${id} order by created_at desc limit 20`;
    await this.audit(this.sql, a, req, 'admin.viewed', `Looked at ${b.name}`, { businessId: id });
    return { ...b, branches, people, counts, requests };
  }

  @Post('businesses/:id/pause')
  async pause(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const why = reason(b);
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`update tc.business set status = 'paused' where id = ${id} and status in ('trial', 'active') returning name`;
      if (!biz) throw conflict('not_live');
      // AdminPauseBusiness: "The owner is told their account is paused" (by SMS until the owner inbox, Phase 6).
      const [owner] = await tx<{ phone: string }[]>`select phone from tc.person where business_id = ${id} and role = 'owner' and status = 'active' limit 1`;
      if (owner) {
        const lang = await smsLanguage(tx, owner.phone, 'person');
        await this.sms.send(tx, owner.phone, 'business_paused', smsText(lang, 'paused', { a: biz.name }), { language: lang });
        await this.inbox.system(tx, id, 'inbox.pausedT', 'inbox.pausedB', { a: biz.name, b: why });
      }
      await this.audit(tx, a, req, 'business.paused', `Paused ${biz.name}: ${why}`, { businessId: id, detail: { reason: why } });
      return { status: 'paused' };
    });
  }

  @Post('businesses/:id/resume')
  async resume(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string; status: string }[]>`
        update tc.business set status = case when trial_ends_at > now() then 'trial' else 'active' end, paused_unpaid = false
        where id = ${id} and status = 'paused' returning name, status`;
      if (!biz) throw conflict('not_paused');
      await this.audit(tx, a, req, 'business.resumed', `Resumed ${biz.name}`, { businessId: id });
      return { status: biz.status };
    });
  }

  /** AdminBusiness History: "Add a note (only the Temelash team can see it)". Kept in the log. */
  @Post('businesses/:id/note')
  async businessNote(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 2000) : '';
    if (!text) throw badRequest('text_needed');
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`select name from tc.business where id = ${id}`;
      if (!biz) throw notFound();
      await this.audit(tx, a, req, 'business.note', `Added a note on ${biz.name}`, { businessId: id, detail: { text } });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- AdminBusinessCustomers / AdminCustomer*
  /** A business's customers. Phones are partly hidden (AdminBusinessCustomers). */
  @Get('businesses/:id/customers')
  async customers(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const [biz] = await this.sql<{ name: string }[]>`select name from tc.business where id = ${id}`;
    if (!biz) throw notFound();
    const rows = await this.sql<{ cardId: string; phone: string | null; status: string; total: number; joined: Date; lastVisit: Date | null; rewardsEarned: number; rewardsUsed: number }[]>`
      select c.id as "cardId", u.phone, c.status, r.stamps_needed as total, c.created_at as joined,
        (select max(s.at) from tc.stamp s where s.card_id = c.id) as "lastVisit",
        (select count(*)::int from tc.reward w where w.card_id = c.id) as "rewardsEarned",
        (select count(*)::int from tc.redemption d join tc.reward w on w.id = d.reward_id where w.card_id = c.id
           and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id)) as "rewardsUsed"
      from tc.card c join tc.customer u on u.id = c.customer_id join tc.rule_set r on r.id = c.rule_set_id
      where c.business_id = ${id} order by c.created_at desc limit 500`;
    const out = [];
    for (const r of rows) out.push({ ...r, phone: r.phone ? maskPhone(r.phone) : null, stamps: (await cardProgress(this.sql, r.cardId, r.total)).count });
    await this.audit(this.sql, a, req, 'admin.viewed', `Looked at the customers of ${biz.name}`, { businessId: id });
    return out;
  }

  @Get('cards/:id')
  async card(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const [c] = await this.sql<{ id: string; businessId: string; business: string; customerId: string; phone: string | null; status: string; total: number; joined: Date }[]>`
      select c.id, c.business_id as "businessId", b.name as business, c.customer_id as "customerId", u.phone, c.status, r.stamps_needed as total, c.created_at as joined
      from tc.card c join tc.business b on b.id = c.business_id join tc.customer u on u.id = c.customer_id join tc.rule_set r on r.id = c.rule_set_id
      where c.id = ${id}`;
    if (!c) throw notFound();
    const [n] = await this.sql<{ lastVisit: Date | null; rewardsEarned: number; rewardsUsed: number; otherShops: number }[]>`
      select (select max(s.at) from tc.stamp s where s.card_id = ${id}) as "lastVisit",
        (select count(*)::int from tc.reward w where w.card_id = ${id}) as "rewardsEarned",
        (select count(*)::int from tc.redemption d join tc.reward w on w.id = d.reward_id where w.card_id = ${id}
           and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id)) as "rewardsUsed",
        (select count(distinct business_id)::int from tc.card where customer_id = ${c.customerId} and business_id <> ${c.businessId}) as "otherShops"`;
    await this.audit(this.sql, a, req, 'admin.viewed', `Looked at a customer card at ${c.business}`, { businessId: c.businessId, detail: { cardId: id } });
    return {
      id: c.id, businessId: c.businessId, business: c.business, status: c.status, total: c.total, joined: c.joined,
      phone: c.phone ? maskPhone(c.phone) : null, stamps: (await cardProgress(this.sql, id, c.total)).count, ...n,
    };
  }

  /** AdminCustomerPause: the card stops collecting and using stamps until resumed; stamps stay. */
  @Post('cards/:id/pause')
  async pauseCard(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const why = reason(b);
    return this.sql.begin(async (tx) => {
      const [c] = await tx<{ business_id: string; name: string }[]>`
        update tc.card c set status = 'paused' from tc.business b where c.id = ${id} and b.id = c.business_id and c.status = 'active'
        returning c.business_id, b.name`;
      if (!c) throw conflict('not_active');
      await this.audit(tx, a, req, 'card.paused', `Paused a customer card at ${c.name}`, { businessId: c.business_id, detail: { cardId: id, reason: why } });
      return { status: 'paused' };
    });
  }

  @Post('cards/:id/resume')
  async resumeCard(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [c] = await tx<{ business_id: string; name: string }[]>`
        update tc.card c set status = 'active' from tc.business b where c.id = ${id} and b.id = c.business_id and c.status = 'paused'
        returning c.business_id, b.name`;
      if (!c) throw conflict('not_paused');
      await this.audit(tx, a, req, 'card.resumed', `Resumed a customer card at ${c.name}`, { businessId: c.business_id, detail: { cardId: id } });
      return { status: 'active' };
    });
  }

  // ---------------------------------------------------------------- search (top bar)
  @Get('search')
  async search(@Query('q') q: string | undefined, @CurrentActor() a: Actor, @Req() req: Request) {
    const term = (q ?? '').trim();
    if (term.length < 2) return { businesses: [], people: [], customers: [] };
    const like = `%${term}%`;
    const phone = normalizePhone(term);
    const businesses = await this.sql`select id, name, status, shop_code as "shopCode" from tc.business where name ilike ${like} or shop_code ilike ${like} order by name limit 20`;
    const people = await this.sql`
      select p.id, p.name, p.role, p.phone, b.id as "businessId", b.name as business from tc.person p join tc.business b on b.id = p.business_id
      where p.name ilike ${like} or p.phone = ${phone ?? ''} order by p.name limit 20`;
    const customers = phone
      ? await this.sql`select id, phone, status, created_at as "createdAt", (select count(*)::int from tc.card c where c.customer_id = u.id) cards from tc.customer u where phone = ${phone}`
      : [];
    await this.audit(this.sql, a, req, 'admin.searched', 'Searched', { detail: { found: businesses.length + people.length + customers.length } });
    return { businesses, people, customers };
  }

  // ---------------------------------------------------------------- AdminRequests / AdminReqSignup* / AdminApproveSignup
  @Get('requests')
  async requests(@Query('type') type?: string, @Query('stage') stage?: string) {
    return this.sql`
      select r.id, r.type, r.stage, r.result, r.payload, r.created_at as "createdAt", r.updated_at as "updatedAt",
        r.business_id as "businessId", b.name as business, ad.name as assignee
      from tc.request r left join tc.business b on b.id = r.business_id left join tc.admin_user ad on ad.id = r.assignee_id
      where (${type ?? ''} = '' or r.type = ${type ?? ''})
        -- stage: '' = open (not done), 'all' = everything, else that stage.
        and (${stage ?? ''} = 'all' or (${stage ?? ''} = '' and r.stage <> 'done') or r.stage = ${stage ?? ''})
      order by r.created_at limit 200`;
  }

  @Get('requests/:id')
  async request(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const [r] = await this.sql`
      select r.id, r.type, r.stage, r.result, r.payload, r.created_at as "createdAt", r.business_id as "businessId", r.owner_dismissed_at as "ownerDismissedAt",
        b.name as business, b.category, b.status as "businessStatus", ag.name as agent, ad.name as assignee,
        (select o.name from tc.person o where o.business_id = b.id and o.role = 'owner' order by o.created_at limit 1) as "ownerName",
        (select o.phone from tc.person o where o.business_id = b.id and o.role = 'owner' order by o.created_at limit 1) as "ownerPhone"
      from tc.request r left join tc.business b on b.id = r.business_id left join tc.agent ag on ag.id = b.agent_id
      left join tc.admin_user ad on ad.id = r.assignee_id where r.id = ${id}`;
    if (!r) throw notFound();
    const notes = await this.sql`select n.text, n.at, ad.name as by from tc.request_note n join tc.admin_user ad on ad.id = n.admin_id where n.request_id = ${id} order by n.at`;
    await this.audit(this.sql, a, req, 'admin.viewed', `Looked at a ${r.type} request`, { businessId: r.businessId ?? undefined, detail: { requestId: id } });
    return { ...r, notes };
  }

  @Post('requests/:id/note')
  async note(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 2000) : '';
    if (!text) throw badRequest('text_needed');
    return this.sql.begin(async (tx) => {
      const [r] = await tx<{ business_id: string | null }[]>`select business_id from tc.request where id = ${id}`;
      if (!r) throw notFound();
      await tx`insert into tc.request_note (request_id, admin_id, text) values (${id}, ${a.id}, ${text})`;
      await this.audit(tx, a, req, 'request.note', 'Added a note to a request', { businessId: r.business_id ?? undefined, detail: { requestId: id } });
      return { ok: true };
    });
  }

  @Post('requests/:id/assign')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const to = typeof b.adminId === 'string' ? b.adminId : a.id;
    return this.sql.begin(async (tx) => {
      const [ad] = await tx<{ name: string }[]>`select name from tc.admin_user where id = ${to} and status = 'active'`;
      if (!ad) throw badRequest('bad_admin');
      const [r] = await tx<{ business_id: string | null }[]>`update tc.request set assignee_id = ${to}, updated_at = now() where id = ${id} returning business_id`;
      if (!r) throw notFound();
      await this.audit(tx, a, req, 'request.assigned', `Request given to ${ad.name}`, { businessId: r.business_id ?? undefined, detail: { requestId: id, adminId: to } });
      return { ok: true };
    });
  }

  /** A pending sign-up, locked for the decision. */
  private async signup(tx: Tx, id: string) {
    const [r] = await tx<{ business_id: string; stage: string; name: string; status: string; phone: string }[]>`
      select r.business_id, r.stage, b.name, b.status, p.phone
      from tc.request r join tc.business b on b.id = r.business_id
      join tc.person p on p.business_id = b.id and p.role = 'owner'
      where r.id = ${id} and r.type = 'signup' for update of r`;
    if (!r) throw notFound();
    if (r.stage === 'done' || r.status !== 'pending') throw conflict('already_decided');
    return r;
  }

  @Post('requests/:id/approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (b.start !== 'trial' && b.start !== 'pilot') throw badRequest('bad_start');
    // AdminApproveSignup: a trial also names the plan they will pay for after it.
    if (b.start === 'trial' && b.plan !== 'starter' && b.plan !== 'full') throw badRequest('bad_plan');
    const trialDays = await this.settings.number('plan.trial_days', 15);
    return this.sql.begin(async (tx) => {
      const r = await this.signup(tx, id);
      if (b.start === 'pilot') {
        await tx`update tc.business set status = 'active', plan = 'pilot', plan_date = (now() at time zone 'Africa/Addis_Ababa')::date where id = ${r.business_id}`;
      } else {
        await tx`update tc.business set status = 'trial', plan = ${b.plan as string}, trial_ends_at = now() + make_interval(days => ${trialDays}) where id = ${r.business_id}`;
      }
      // The monthly fee (and commission terms) from today's settings; first due when the trial ends.
      const [{ due }] = await tx<{ due: string }[]>`select to_char((trial_ends_at at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as due from tc.business where id = ${r.business_id}`;
      const plan = b.start === 'pilot' ? 'pilot' : (b.plan as 'starter' | 'full');
      await this.money.setFee(tx, r.business_id, moneyDate().financeYear, await this.money.terms(plan, 1, plan === 'pilot' ? null : due), 'approved', a.id);
      await tx`update tc.request set stage = 'done', result = 'approved', assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now() where id = ${id}`;
      // The owner inbox is Phase 6; until then the owner hears by SMS (phase-4.md, item 4).
      const lang = await smsLanguage(tx, r.phone, 'person');
      await this.sms.send(tx, r.phone, 'signup_approved', smsText(lang, 'approved', { a: r.name }), { language: lang });
      await this.inbox.system(tx, r.business_id, 'inbox.approvedT', 'inbox.approvedB', { a: r.name });
      await this.audit(tx, a, req, 'request.approved', b.start === 'pilot' ? `Approved ${r.name} on a free pilot` : `Approved ${r.name}: ${trialDays}-day trial, then the ${b.plan as string} plan`,
        { businessId: r.business_id, detail: { requestId: id, start: b.start, plan: b.plan ?? 'pilot' } });
      return { status: b.start === 'pilot' ? 'active' : 'trial' };
    });
  }

  @Post('requests/:id/reject')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const why = reason(b);
    const [kind] = await this.sql<{ type: string }[]>`select type from tc.request where id = ${id}`;
    if (kind && (kind.type === 'lost_phone' || kind.type === 'deletion')) return this.rejectOther(id, kind.type, why, a, req);
    return this.sql.begin(async (tx) => {
      const r = await this.signup(tx, id);
      await tx`update tc.business set status = 'rejected' where id = ${r.business_id}`;
      await tx`update tc.request set stage = 'done', result = 'rejected', assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now() where id = ${id}`;
      const lang = await smsLanguage(tx, r.phone, 'person');
      await this.sms.send(tx, r.phone, 'signup_rejected', smsText(lang, 'rejected', { a: r.name, b: why }), { language: lang });
      await this.audit(tx, a, req, 'request.rejected', `Rejected ${r.name}: ${why}`, { businessId: r.business_id, detail: { requestId: id, reason: why } });
      return { status: 'rejected' };
    });
  }

  /** AdminReqLostPhone / AdminReqDeletion "Reject": the person who asked is told why. */
  private rejectOther(id: string, type: string, why: string, a: Actor, req: Request) {
    return this.sql.begin(async (tx) => {
      const [r] = await tx<{ business_id: string | null; payload: Record<string, unknown> }[]>`
        update tc.request set stage = 'done', result = ${'Rejected: ' + why}, assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now()
        where id = ${id} and type = ${type} and stage <> 'done' returning business_id, payload`;
      if (!r) throw conflict('already_decided');
      if (type === 'lost_phone') {
        const to = String(r.payload.newPhone);
        const lang = await smsLanguage(tx, to, 'person');
        await this.sms.send(tx, to, 'lost_phone_rejected', smsText(lang, 'lostRejected', { a: why }), { language: lang });
      } else if (r.business_id) {
        await this.inbox.system(tx, r.business_id, 'inbox.delNoT', 'inbox.delNoB', { a: String(r.payload.last4 ?? ''), b: why });
      }
      await this.audit(tx, a, req, 'request.rejected', `Rejected a ${type === 'lost_phone' ? 'lost-phone' : 'deletion'} request: ${why}`, { businessId: r.business_id ?? undefined, detail: { requestId: id, reason: why } });
      return { status: 'rejected' };
    });
  }

  /** AdminReqFlag "Dismiss this alert": marked as looked at, with a reason; it can come back. */
  @Post('requests/:id/dismiss')
  async dismiss(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const why = reason(b);
    return this.sql.begin(async (tx) => {
      const [r] = await tx<{ business_id: string | null; name: string | null }[]>`
        update tc.request r set stage = 'done', result = ${'Dismissed: ' + why}, assignee_id = coalesce(r.assignee_id, ${a.id}), updated_at = now()
        from tc.request q left join tc.business b on b.id = q.business_id
        where r.id = ${id} and q.id = r.id and r.type = 'flag' and r.stage <> 'done' returning r.business_id, b.name`;
      if (!r) throw conflict('already_decided');
      await this.audit(tx, a, req, 'request.dismissed', `Dismissed an alert for ${r.name ?? 'a business'}`, { businessId: r.business_id ?? undefined, detail: { requestId: id, reason: why } });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- AdminAudit
  @Get('log')
  async log(@Query('actorType') actorType?: string, @Query('businessId') businessId?: string, @Query('type') type?: string, @Query('before') before?: string, @Query('q') q?: string) {
    const beforeId = Number(before);
    const like = `%${(q ?? '').trim()}%`;
    return this.sql`
      select l.id::text, l.at, l.actor_type as "actorType", coalesce(ad.name, p.name) as actor, l.role, l.type, l.text, l.detail,
        l.business_id as "businessId", b.name as business, l.ip
      from tc.audit_log l left join tc.admin_user ad on l.actor_type = 'admin' and ad.id = l.actor_id
      left join tc.person p on l.actor_type in ('owner', 'manager', 'staff') and p.id = l.actor_id
      left join tc.business b on b.id = l.business_id
      where (${actorType ?? ''} = '' or l.actor_type = ${actorType ?? ''})
        and (${businessId ?? ''} = '' or l.business_id::text = ${businessId ?? ''})
        -- type: one or more prefixes, comma separated ("business.,card.").
        and (${type ?? ''} = '' or exists (select 1 from unnest(string_to_array(${type ?? ''}, ',')) t where l.type like t || '%'))
        and (l.text ilike ${like} or l.detail::text ilike ${like} or coalesce(b.name, '') ilike ${like})
        and (${Number.isFinite(beforeId) && beforeId > 0 ? beforeId : null}::bigint is null or l.id < ${Number.isFinite(beforeId) && beforeId > 0 ? beforeId : null})
      order by l.id desc limit 200`;
  }

  // ---------------------------------------------------------------- AdminSettings*
  @Get('settings')
  async getSettings(@CurrentActor() a: Actor) {
    const rows = await this.sql<{ key: string; value: unknown; changed_by: string | null; changed_at: Date }[]>`
      select key, value, changed_by, changed_at from tc.setting order by key`;
    // Prices are money: Support sees the rules, not the fees.
    const money = (k: string) => k.startsWith('plan.') && k.endsWith('_birr') || k.startsWith('agent.commission') || k.startsWith('government.');
    return rows.filter((r) => a.adminRole !== 'support' || !money(r.key))
      .map((r) => ({ key: r.key, value: r.value, changedBy: r.changed_by, changedAt: r.changed_at }));
  }

  /** Owner only. A known key, and a value of the same kind as before (a number stays a number). */
  @Post('settings')
  async setSetting(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    need(a, 'owner');
    const key = typeof b.key === 'string' ? b.key : '';
    if (key === 'safety.kill_switch') throw badRequest('use_kill_switch');
    return this.sql.begin(async (tx) => {
      const [old] = await tx<{ value: unknown }[]>`select value from tc.setting where key = ${key} for update`;
      if (!old) throw badRequest('unknown_setting');
      const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
      if (kind(old.value) !== kind(b.value) || (typeof b.value === 'number' && (!Number.isFinite(b.value) || b.value < 0))) throw badRequest('bad_value');
      const [ad] = await tx<{ email: string }[]>`select email from tc.admin_user where id = ${a.id}`;
      await tx`update tc.setting set value = ${tx.json(b.value as never)}, changed_by = ${ad.email}, changed_at = now() where key = ${key}`;
      await this.audit(tx, a, req, 'setting.changed', `Changed ${key}`, { detail: { key, from: old.value, to: b.value } });
      return { key, value: b.value };
    });
  }

  // ---------------------------------------------------------------- team (AdminSettings, Team)
  @Get('team')
  async team(@CurrentActor() a: Actor) {
    // Every admin sees who is on the team (to give a request to someone); only Owners change it.
    return this.sql`
      select id, email, name, role, status, (id = ${a.id}) as me, last_login_at as "lastLoginAt", (totp_secret_enc is not null) as "authenticatorSet",
        cardinality(backup_code_hashes) as "backupCodesLeft", (locked_until > now()) as locked
      from tc.admin_user order by case role when 'owner' then 0 when 'finance' then 1 else 2 end, name`;
  }

  /** A new admin gets a temporary password, shown once here, and sets up the authenticator at first sign-in. */
  @Post('team')
  async addTeam(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    need(a, 'owner');
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw badRequest('bad_member');
    if (!ROLES.includes(b.role as AdminRole)) throw badRequest('bad_role');
    const password = tempPassword();
    return this.sql.begin(async (tx) => {
      const [taken] = await tx`select 1 from tc.admin_user where email = ${email}`;
      if (taken) throw conflict('email_in_use');
      const id = await createAdmin(tx, { email, name, role: b.role as AdminRole, password });
      await this.audit(tx, a, req, 'admin.team_added', `Added ${name} (${b.role as string})`, { detail: { adminId: id, role: b.role } });
      return { id, tempPassword: password };
    });
  }

  /** At least two Owners at all times (plan section 3). */
  private async keepTwoOwners(tx: Tx, changing: string) {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from tc.admin_user where role = 'owner' and status = 'active' and id <> ${changing}`;
    if (n < 2) throw conflict('two_owners_needed');
  }

  @Post('team/:id/role')
  async setRole(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    need(a, 'owner');
    if (!ROLES.includes(b.role as AdminRole)) throw badRequest('bad_role');
    return this.sql.begin(async (tx) => {
      await tx`lock table tc.admin_user in share row exclusive mode`;
      const [m] = await tx<{ role: AdminRole; name: string }[]>`select role, name from tc.admin_user where id = ${id}`;
      if (!m) throw notFound();
      if (m.role === 'owner' && b.role !== 'owner') await this.keepTwoOwners(tx, id);
      await tx`update tc.admin_user set role = ${b.role as string} where id = ${id}`;
      // A new role takes effect at the next sign-in; end their sessions now.
      await tx`update tc.session set revoked_at = now() where actor_type = 'admin' and actor_id = ${id} and revoked_at is null`;
      await this.audit(tx, a, req, 'admin.role_changed', `${m.name}: ${m.role} to ${b.role as string}`, { detail: { adminId: id, from: m.role, to: b.role } });
      return { role: b.role };
    });
  }

  @Post('team/:id/disable')
  async disable(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    need(a, 'owner');
    if (id === a.id) throw conflict('not_yourself');
    return this.sql.begin(async (tx) => {
      await tx`lock table tc.admin_user in share row exclusive mode`;
      const [m] = await tx<{ role: AdminRole; name: string }[]>`select role, name from tc.admin_user where id = ${id} and status = 'active'`;
      if (!m) throw notFound();
      if (m.role === 'owner') await this.keepTwoOwners(tx, id);
      await tx`update tc.admin_user set status = 'disabled' where id = ${id}`;
      await tx`update tc.session set revoked_at = now() where actor_type = 'admin' and actor_id = ${id} and revoked_at is null`;
      await this.audit(tx, a, req, 'admin.disabled', `Turned off ${m.name}`, { detail: { adminId: id } });
      return { status: 'disabled' };
    });
  }

  // ---------------------------------------------------------------- AdminSettingsSafety / AdminKillSwitch
  @Get('kill-switch')
  async getKillSwitch() {
    this.safety.forget();
    // AdminSettingsSafety shows why, when and by whom it was turned on.
    const [row] = await this.sql<{ value: { reason?: string } | null; changed_by: string | null; changed_at: Date }[]>`
      select s.value, coalesce(a.name, s.changed_by) as changed_by, s.changed_at
      from tc.setting s left join tc.admin_user a on a.email = s.changed_by where s.key = 'safety.kill_switch'`;
    return { ...(await this.safety.killSwitch()), reason: row?.value?.reason ?? '', changedBy: row?.changed_by ?? null, changedAt: row?.changed_at ?? null };
  }

  /** Owner only (plan section 11), after the password and an authenticator code again. */
  @Post('kill-switch')
  async setKillSwitch(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    need(a, 'owner');
    if (typeof b.on !== 'boolean') throw badRequest('bad_value');
    const message = typeof b.message === 'string' ? b.message.trim().slice(0, 300) : '';
    if (b.on && !message) throw badRequest('message_needed');
    // AdminKillSwitch: an internal reason for the log, besides the message owners and staff see.
    const why = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
    const { admin, proof } = await this.auth.reauth(a, b, req.ip);
    const out = await this.sql.begin(async (tx) => {
      await this.auth.use(tx, admin, proof, req.ip);
      const value = { on: b.on as boolean, owner_message: b.on ? message : '', reason: b.on ? why : '' };
      await tx`insert into tc.setting (key, value, changed_by) values ('safety.kill_switch', ${tx.json(value)}, ${admin.email})
               on conflict (key) do update set value = excluded.value, changed_by = excluded.changed_by, changed_at = now()`;
      await this.audit(tx, a, req, 'safety.kill_switch', b.on ? `Kill switch on: ${message}` : 'Kill switch off', { detail: value });
      return { on: value.on, message: value.owner_message, reason: value.reason };
    });
    this.safety.forget();
    return out;
  }


}
