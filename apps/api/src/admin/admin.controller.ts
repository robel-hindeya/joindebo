import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { SafetyService } from '../settings/safety.service';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { normalizePhone } from '../auth/pin';
import { SmsSender } from '../sms/sms';
import { AdminAuthService } from './admin-auth.service';
import { createAdmin, tempPassword, type AdminRole } from './accounts';

type Tx = Sql | TransactionSql;
const ROLES: AdminRole[] = ['owner', 'finance', 'support'];
/** Money screens and exports: Owner and Finance only (plan section 3). */
const MONEY: AdminRole[] = ['owner', 'finance'];

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
    return {
      businesses,
      customers: n.customers,
      stampsToday: n.stamps_today,
      requests: { open: n.open_requests, signups: n.signups, flags: n.flags },
      killSwitch: await this.safety.killSwitch(),
    };
  }

  // ---------------------------------------------------------------- AdminBusinesses / AdminBusiness*
  @Get('businesses')
  async businesses(@Query('q') q?: string, @Query('status') status?: string) {
    const like = `%${(q ?? '').trim()}%`;
    return this.sql`
      select b.id, b.name, b.category, b.city, b.status, b.plan, b.shop_code as "shopCode", b.trial_ends_at as "trialEndsAt", b.created_at as "createdAt",
        (select count(*)::int from tc.branch br where br.business_id = b.id and br.status = 'active') as branches,
        (select count(*)::int from tc.card c where c.business_id = b.id) as cards
      from tc.business b
      where (b.name ilike ${like} or b.shop_code ilike ${like}) and (${status ?? ''} = '' or b.status = ${status ?? ''})
      order by b.name limit 200`;
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
      select id, name, role, phone, status, locked_until as "lockedUntil" from tc.person where business_id = ${id}
      order by case role when 'owner' then 0 when 'manager' then 1 else 2 end, name`;
    const [counts] = await this.sql`
      select (select count(*)::int from tc.card where business_id = ${id}) cards,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = ${id} and s.kind = 'add'
          and s.at > now() - interval '30 days') "stamps30d"`;
    const requests = await this.sql`select id, type, stage, result, created_at as "createdAt" from tc.request where business_id = ${id} order by created_at desc limit 20`;
    await this.audit(this.sql, a, req, 'admin.viewed', `Looked at ${b.name}`, { businessId: id });
    return { ...b, branches, people, counts, requests };
  }

  /** Money for one business: Owner and Finance. Payments arrive in Phase 5. */
  @Get('businesses/:id/finance')
  async businessFinance(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    need(a, ...MONEY);
    const [b] = await this.sql`select id, plan, plan_date as "planDate", status from tc.business where id = ${id}`;
    if (!b) throw notFound();
    return { ...b, payments: [], trackedOutside: true };
  }

  @Post('businesses/:id/pause')
  async pause(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const why = reason(b);
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`update tc.business set status = 'paused' where id = ${id} and status in ('trial', 'active') returning name`;
      if (!biz) throw conflict('not_live');
      // AdminPauseBusiness: "The owner is told their account is paused" (by SMS until the owner inbox, Phase 6).
      const [owner] = await tx<{ phone: string }[]>`select phone from tc.person where business_id = ${id} and role = 'owner' and status = 'active' limit 1`;
      if (owner) await this.sms.send(tx, owner.phone, 'business_paused', `Temelash Card: ${biz.name} is paused by Temelash. Your customers' cards are safe. Please call Temelash.`);
      await this.audit(tx, a, req, 'business.paused', `Paused ${biz.name}: ${why}`, { businessId: id, detail: { reason: why } });
      return { status: 'paused' };
    });
  }

  @Post('businesses/:id/resume')
  async resume(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string; status: string }[]>`
        update tc.business set status = case when trial_ends_at > now() then 'trial' else 'active' end
        where id = ${id} and status = 'paused' returning name, status`;
      if (!biz) throw conflict('not_paused');
      await this.audit(tx, a, req, 'business.resumed', `Resumed ${biz.name}`, { businessId: id });
      return { status: biz.status };
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
        and (${stage ?? ''} = '' and r.stage <> 'done' or r.stage = ${stage ?? ''})
      order by r.created_at limit 200`;
  }

  @Get('requests/:id')
  async request(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const [r] = await this.sql`
      select r.id, r.type, r.stage, r.result, r.payload, r.created_at as "createdAt", r.business_id as "businessId",
        b.name as business, b.category, b.status as "businessStatus", ag.name as agent, ad.name as assignee
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
    const trialDays = await this.settings.number('plan.trial_days', 30);
    return this.sql.begin(async (tx) => {
      const r = await this.signup(tx, id);
      if (b.start === 'pilot') {
        await tx`update tc.business set status = 'active', plan = 'pilot', plan_date = (now() at time zone 'Africa/Addis_Ababa')::date where id = ${r.business_id}`;
      } else {
        await tx`update tc.business set status = 'trial', trial_ends_at = now() + make_interval(days => ${trialDays}) where id = ${r.business_id}`;
      }
      await tx`update tc.request set stage = 'done', result = 'approved', assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now() where id = ${id}`;
      // The owner inbox is Phase 6; until then the owner hears by SMS (phase-4.md, item 4).
      await this.sms.send(tx, r.phone, 'signup_approved', `Temelash Card: ${r.name} is approved. Open the owner app to set up your card.`);
      await this.audit(tx, a, req, 'request.approved', `Approved ${r.name} on a free ${b.start}`, { businessId: r.business_id, detail: { requestId: id, start: b.start } });
      return { status: b.start === 'pilot' ? 'active' : 'trial' };
    });
  }

  @Post('requests/:id/reject')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const why = reason(b);
    return this.sql.begin(async (tx) => {
      const r = await this.signup(tx, id);
      await tx`update tc.business set status = 'rejected' where id = ${r.business_id}`;
      await tx`update tc.request set stage = 'done', result = 'rejected', assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now() where id = ${id}`;
      await this.sms.send(tx, r.phone, 'signup_rejected', `Temelash Card: we could not approve ${r.name}. ${why}`);
      await this.audit(tx, a, req, 'request.rejected', `Rejected ${r.name}: ${why}`, { businessId: r.business_id, detail: { requestId: id, reason: why } });
      return { status: 'rejected' };
    });
  }

  // ---------------------------------------------------------------- AdminAudit
  @Get('log')
  async log(@Query('actorType') actorType?: string, @Query('businessId') businessId?: string, @Query('type') type?: string, @Query('before') before?: string) {
    const beforeId = Number(before);
    return this.sql`
      select l.id::text, l.at, l.actor_type as "actorType", coalesce(ad.name, p.name) as actor, l.role, l.type, l.text,
        l.business_id as "businessId", b.name as business, l.ip
      from tc.audit_log l left join tc.admin_user ad on l.actor_type = 'admin' and ad.id = l.actor_id
      left join tc.person p on l.actor_type in ('owner', 'manager', 'staff') and p.id = l.actor_id
      left join tc.business b on b.id = l.business_id
      where (${actorType ?? ''} = '' or l.actor_type = ${actorType ?? ''})
        and (${businessId ?? ''} = '' or l.business_id::text = ${businessId ?? ''})
        and (${type ?? ''} = '' or l.type like ${(type ?? '') + '%'})
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
    need(a, 'owner');
    return this.sql`
      select id, email, name, role, status, last_login_at as "lastLoginAt", (totp_secret_enc is not null) as "authenticatorSet",
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
    return this.safety.killSwitch();
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

  // ---------------------------------------------------------------- money (Phase 5 fills these)
  @Get('finance/summary')
  async financeSummary(@CurrentActor() a: Actor) {
    need(a, ...MONEY);
    const plans = await this.sql<{ plan: string | null; n: number }[]>`
      select plan, count(*)::int n from tc.business where status in ('trial', 'active', 'paused') group by plan`;
    return { plans: Object.fromEntries(plans.map((p) => [p.plan ?? 'none', p.n])), payments: [], trackedOutside: true };
  }

  /** Money exports: Owner and Finance, after the password and a code. The files arrive with Phase 5. */
  @Post('exports/:kind')
  async exportFile(@Param('kind') kind: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    need(a, ...MONEY);
    const { admin, proof } = await this.auth.reauth(a, b, req.ip);
    await this.sql.begin(async (tx) => {
      await this.auth.use(tx, admin, proof, req.ip);
      await this.audit(tx, a, req, 'export.requested', `Asked for the ${kind} export`, { detail: { kind } });
    });
    throw new ApiError(501, 'not_yet');
  }
}
