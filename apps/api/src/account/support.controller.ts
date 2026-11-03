import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { cardCount, ensureCardKeys } from '../stamps/cards';
import { eatDate } from './account';
import { TtlCache } from '../common/cache';

/** AdminAudience "Updates itself every 12 hours". */
const AUDIENCE = new TtlCache(12 * 3_600_000);

type Tx = Sql | TransactionSql;
const WHEN: Record<string, number> = { today: 0, tomorrow: 1, three: 3, week: 7 };
const CATEGORIES = ['cafe', 'salon', 'spa', 'restaurant', 'car_wash', 'barber', 'bakery', 'food', 'other'];

/**
 * AdminBusinessSupport: follow-ups, "See what the owner sees" (read only,
 * logged), AdminEditBusiness, "Merge a duplicate" and "Close one branch".
 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class SupportController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  private audit(tx: Tx, a: Actor, req: Request, type: string, text: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text, ...extra });
  }

  // ---------------------------------------------------------------- AdminAudience
  @Get('audience')
  audience() {
    return AUDIENCE.get('all', () => this.countAudience());
  }

  /** "Refresh now": count again and log it. */
  @Post('audience/refresh')
  async refreshAudience(@CurrentActor() a: Actor, @Req() req: Request) {
    AUDIENCE.forget('all');
    const r = await AUDIENCE.get('all', () => this.countAudience());
    await this.audit(this.sql, a, req, 'settings.audience', 'Refreshed the client count', { detail: { unique: r.unique, cards: r.cards } });
    return r;
  }

  private async countAudience() {
    const per = await this.sql<{ id: string; name: string; category: string; city: string; cards: number; only: number; shared: number }[]>`
      with live as (
        select c.business_id, right(u.phone, 9) as who from tc.card c join tc.customer u on u.id = c.customer_id
        join tc.business b on b.id = c.business_id
        where c.status in ('active', 'paused', 'redeemed') and u.phone is not null and b.status in ('trial', 'active', 'paused', 'closing')),
      reach as (select who, count(distinct business_id) as shops from live group by who)
      select b.id, b.name, b.category, b.city, count(*)::int as cards,
        count(*) filter (where r.shops = 1)::int as only, count(*) filter (where r.shops > 1)::int as shared
      from live l join reach r on r.who = l.who join tc.business b on b.id = l.business_id
      group by b.id order by cards desc`;
    const [t] = await this.sql<{ unique: number; cards: number; one: number; two: number; more: number }[]>`
      with live as (
        select c.business_id, right(u.phone, 9) as who from tc.card c join tc.customer u on u.id = c.customer_id
        join tc.business b on b.id = c.business_id
        where c.status in ('active', 'paused', 'redeemed') and u.phone is not null and b.status in ('trial', 'active', 'paused', 'closing')),
      reach as (select who, count(distinct business_id) as shops from live group by who)
      select (select count(*)::int from reach) as unique, (select count(*)::int from live) as cards,
        (select count(*)::int from reach where shops = 1) as one, (select count(*)::int from reach where shops = 2) as two,
        (select count(*)::int from reach where shops >= 3) as more`;
    return { at: new Date(), unique: t.unique, cards: t.cards, businesses: per.length, multi: t.two + t.more, dist: { 1: t.one, 2: t.two, 3: t.more }, per };
  }

  // ---------------------------------------------------------------- AdminFollowUp
  @Get('businesses/:id/follow-ups')
  followUps(@Param('id', ParseUUIDPipe) id: string) {
    return this.sql`
      select f.id, f.text, to_char(f.due, 'YYYY-MM-DD') as due, f.done_at as "doneAt", u.name as assignee
      from tc.follow_up f left join tc.admin_user u on u.id = f.assignee_id
      where f.business_id = ${id} order by (f.done_at is not null), f.due`;
  }

  /** Overview "Follow-ups due": open ones due today or earlier. */
  @Get('follow-ups')
  due(@Query('due') due?: string) {
    return this.sql`
      select f.id, f.text, to_char(f.due, 'YYYY-MM-DD') as due, u.name as assignee, b.id as "businessId", b.name as business
      from tc.follow_up f join tc.business b on b.id = f.business_id left join tc.admin_user u on u.id = f.assignee_id
      where f.done_at is null and (${due ?? ''} <> '1' or f.due <= ${eatDate(new Date())}::date) order by f.due limit 100`;
  }

  @Post('businesses/:id/follow-ups')
  async addFollowUp(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 500) : '';
    const days = WHEN[String(b.when)];
    if (text.length < 4 || days === undefined) throw badRequest('bad_follow_up');
    const due = eatDate(new Date(Date.now() + days * 86_400_000));
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`select name from tc.business where id = ${id}`;
      if (!biz) throw notFound();
      const [f] = await tx<{ id: string }[]>`
        insert into tc.follow_up (business_id, text, due, assignee_id, created_by)
        values (${id}, ${text}, ${due}, ${typeof b.assigneeId === 'string' ? b.assigneeId : a.id}, ${a.id}) returning id`;
      await this.audit(tx, a, req, 'business.follow_up', `Added a follow-up on ${biz.name}`, { businessId: id, detail: { followUpId: f.id, due, text } });
      return { id: f.id, due };
    });
  }

  /** Mark done, or open again. */
  @Post('follow-ups/:id/done')
  async doneFollowUp(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [f] = await tx<{ business_id: string; done: boolean; text: string }[]>`
        update tc.follow_up set done_at = case when done_at is null then now() end, done_by = case when done_at is null then ${a.id}::uuid end
        where id = ${id} returning business_id, done_at is not null as done, text`;
      if (!f) throw notFound();
      await this.audit(tx, a, req, 'business.follow_up_done', `${f.done ? 'Finished' : 'Reopened'} a follow-up`, { businessId: f.business_id, detail: { followUpId: id, text: f.text } });
      return { done: f.done };
    });
  }

  // ---------------------------------------------------------------- AdminViewAsOwner
  @Get('businesses/:id/owner-view')
  async ownerView(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const [v] = await this.sql<{ name: string; owner: string | null; customers: number; stamps30: number; team: number; branches: number; last_stamp: Date | null; waiting: number; to_check: number }[]>`
      select b.name,
        (select name from tc.person where business_id = b.id and role = 'owner' order by created_at limit 1) as owner,
        (select count(*)::int from tc.card where business_id = b.id and status in ('active', 'paused', 'redeemed')) as customers,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = b.id and s.kind = 'add' and s.method in ('scan', 'typed') and s.at > now() - interval '30 days') as stamps30,
        (select count(*)::int from tc.person where business_id = b.id and status = 'active') as team,
        (select count(*)::int from tc.branch where business_id = b.id and status = 'active') as branches,
        (select max(s.at) from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = b.id and s.method in ('scan', 'typed')) as last_stamp,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id where c.business_id = b.id and s.needs_approval and not exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id)) as waiting,
        (select count(*)::int from tc.request r where r.business_id = b.id and r.type = 'flag' and r.stage <> 'done' and r.owner_dismissed_at is null) as to_check
      from tc.business b where b.id = ${id}`;
    if (!v) throw notFound();
    // Plan section 8: no admin look at an owner's view is hidden from the log.
    await this.audit(this.sql, a, req, 'admin.viewed_as_owner', `Looked at what the owner of ${v.name} sees`, { businessId: id, detail: { readOnly: true } });
    return { name: v.name, owner: v.owner, customers: v.customers, stamps30: v.stamps30, team: v.team, branches: v.branches, lastStamp: v.last_stamp, waiting: v.waiting, alerts: v.to_check };
  }

  // ---------------------------------------------------------------- AdminEditBusiness
  @Post('businesses/:id/details')
  async details(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const str = (k: string, max = 120) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');
    const name = str('name');
    const city = str('city');
    const owner = str('owner');
    const category = str('category');
    if (name.length < 2 || city.length < 2 || owner.length < 2 || !CATEGORIES.includes(category)) throw badRequest('bad_details');
    return this.sql.begin(async (tx) => {
      const [old] = await tx<{ name: string; city: string; category: string; owner: string | null }[]>`
        select b.name, b.city, b.category, (select name from tc.person where business_id = b.id and role = 'owner' order by created_at limit 1) as owner
        from tc.business b where b.id = ${id} for update`;
      if (!old) throw notFound();
      const changed = [['name', old.name, name], ['city', old.city, city], ['category', old.category, category], ['owner', old.owner, owner]].filter(([, x, y]) => x !== y).map(([k]) => k);
      if (!changed.length) return { changed };
      await tx`update tc.business set name = ${name}, city = ${city}, category = ${category} where id = ${id}`;
      await tx`update tc.person set name = ${owner} where id = (select id from tc.person where business_id = ${id} and role = 'owner' order by created_at limit 1)`;
      await this.audit(tx, a, req, 'business.details', `Edited the details of ${old.name}`, { businessId: id, detail: { changed } });
      return { changed };
    });
  }

  // ---------------------------------------------------------------- Close one branch
  @Post('branches/:id/close')
  async closeBranch(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [br] = await tx<{ business_id: string; name: string; open: number }[]>`
        select business_id, name, (select count(*)::int from tc.branch x where x.business_id = br.business_id and x.status = 'active') as open
        from tc.branch br where id = ${id} and status = 'active' for update`;
      if (!br) throw notFound();
      if (br.open <= 1) throw conflict('last_branch');
      await tx`update tc.branch set status = 'closed' where id = ${id}`;
      await this.audit(tx, a, req, 'branch.closed', `Closed the branch ${br.name}`, { businessId: br.business_id, detail: { branchId: id, branches: br.open - 1 } });
      return { branches: br.open - 1 };
    });
  }

  // ---------------------------------------------------------------- Merge a duplicate
  @Get('businesses/:id/merge-preview')
  async mergePreview(@Param('id', ParseUUIDPipe) id: string, @Query('from') from?: string) {
    if (!from || from === id) throw badRequest('bad_merge');
    const [p] = await this.sql<{ name: string; customers: number; both: number }[]>`
      select b.name,
        (select count(distinct customer_id)::int from tc.card where business_id = b.id and status in ('active', 'paused')) as customers,
        (select count(distinct d.customer_id)::int from tc.card d join tc.card t on t.customer_id = d.customer_id and t.business_id = ${id} and t.status in ('active', 'paused')
          where d.business_id = b.id and d.status in ('active', 'paused')) as both
      from tc.business b where b.id = ${from} and b.status <> 'closed'`;
    if (!p) throw notFound();
    return p;
  }

  /**
   * The duplicate's customers move here with their stamps. Stamps cannot move
   * (append-only), so each card's count is added to this shop's card as
   * correcting stamps and the duplicate's card is retired; a customer who had
   * both ends with one card. The duplicate business is closed.
   */
  @Post('businesses/:id/merge')
  async merge(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const from = typeof b.from === 'string' ? b.from : '';
    if (!from || from === id) throw badRequest('bad_merge');
    return this.sql.begin(async (tx) => {
      const [into] = await tx<{ name: string }[]>`select name from tc.business where id = ${id} and status not in ('closed', 'rejected') for update`;
      const [dup] = await tx<{ name: string }[]>`select name from tc.business where id = ${from} and status not in ('closed', 'rejected') for update`;
      if (!into || !dup) throw notFound();
      const [rules] = await tx<{ id: string }[]>`select id from tc.rule_set where business_id = ${id} order by version desc limit 1`;
      if (!rules) throw conflict('no_rules');
      const cards = await tx<{ id: string; customer_id: string }[]>`
        select id, customer_id from tc.card where business_id = ${from} and status in ('active', 'paused') for update`;
      let moved = 0;
      for (const c of cards) {
        const n = await cardCount(tx, c.id);
        let [target] = await tx<{ id: string }[]>`select id from tc.card where business_id = ${id} and customer_id = ${c.customer_id} and status in ('active', 'paused')`;
        if (!target) {
          [target] = await tx<{ id: string }[]>`insert into tc.card (customer_id, business_id, rule_set_id) values (${c.customer_id}, ${id}, ${rules.id}) returning id`;
          await ensureCardKeys(tx, { id: target.id, business_id: id, short_code: null });
        }
        for (let i = 0; i < n; i++) {
          await tx`insert into tc.stamp (card_id, method, reason) values (${target.id}, 'fix', ${`Moved from ${dup.name}`})`;
        }
        await tx`update tc.card set status = 'expired' where id = ${c.id}`;
        moved++;
      }
      const people = await tx<{ id: string }[]>`update tc.person set status = 'disabled' where business_id = ${from} and status = 'active' returning id`;
      if (people.length) await tx`update tc.session set revoked_at = now() where actor_id in ${tx(people.map((p) => p.id))} and revoked_at is null`;
      await tx`update tc.business set status = 'closed', merged_into = ${id} where id = ${from}`;
      await this.audit(tx, a, req, 'business.merged', `Merged ${dup.name} into ${into.name}`, { businessId: id, detail: { from, customers: moved } });
      return { customers: moved };
    });
  }
}
