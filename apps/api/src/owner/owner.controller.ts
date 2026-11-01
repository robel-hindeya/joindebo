import { randomInt } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SafetyService } from '../settings/safety.service';
import { MoneyService, billingOf, financeYearEnd, moneyDate, todayEat } from '../money/money.service';
import { badRequest, conflict, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { hashSecret, isWeakPin, maskPhone, normalizePhone } from '../auth/pin';
import { cardCount, unlockRewards } from '../stamps/cards';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tx = Sql | TransactionSql;

/** Live, counted stamps (not voided, not waiting for or refused approval) as SQL text for reuse. */
const COUNTED = `s.kind = 'add'
  and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
  and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))`;

/**
 * The owner and branch-manager app (OwnToday, OwnApprovals, OwnToCheck,
 * OwnCustomers, OwnTeam, OwnRules, OwnCard, OwnDetails, OwnBranches,
 * OwnReports, OwnLog). Owners see the whole business, or one branch when they
 * pick it; managers are always held to their own branch (OwnRoles), and any
 * request about another branch is refused.
 */
@Controller('owner')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly safety: SafetyService,
    private readonly money: MoneyService,
  ) {}

  // ---------------------------------------------------------------- scope
  /** The branch this request is about: null = whole business (owners only). */
  private async branchScope(a: Actor, requested?: unknown): Promise<string | null> {
    const want = typeof requested === 'string' && requested ? requested : null;
    if (a.type === 'manager') {
      if (want && want !== a.branchId) throw forbidden();
      return a.branchId!;
    }
    if (!want) return null;
    if (!UUID.test(want)) throw notFound();
    const [b] = await this.sql`select 1 from tc.branch where id = ${want} and business_id = ${a.businessId!}`;
    if (!b) throw forbidden();
    return want;
  }

  private ownerOnly(a: Actor) {
    if (a.type !== 'owner') throw forbidden();
  }

  /** Stamps the caller may act on: in their business and, for managers, at their branch. */
  private async stampsInScope(a: Actor, ids: unknown): Promise<string[]> {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((x) => typeof x === 'string' && UUID.test(x))) throw badRequest('bad_ids');
    const rows = await this.sql<{ id: string; business_id: string; branch_id: string | null }[]>`
      select s.id, c.business_id, s.branch_id from tc.stamp s join tc.card c on c.id = s.card_id where s.id in ${this.sql(ids as string[])}`;
    if (rows.length !== ids.length) throw notFound();
    for (const r of rows) {
      if (r.business_id !== a.businessId) throw forbidden();
      if (a.type === 'manager' && r.branch_id !== a.branchId) throw forbidden();
    }
    return rows.map((r) => r.id);
  }

  private audit(tx: Tx, a: Actor, req: Request, type: string, text: string, detail: Record<string, unknown> = {}) {
    return writeAudit(tx, { actorType: a.type, actorId: a.id, role: a.type, businessId: a.businessId, ip: req.ip, type, text, detail: { ...detail, branchId: detail.branchId ?? a.branchId ?? null } });
  }

  // ---------------------------------------------------------------- Today
  @Get('today')
  async today(@CurrentActor() a: Actor, @Query('branchId') branchId?: string) {
    const branch = await this.branchScope(a, branchId);
    const [n] = await this.sql<{ pending: number; to_check: number; stamps_today: number; rewards_today: number }[]>`
      select
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
            and s.needs_approval and not exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id)) as pending,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id join tc.rule_set r on r.id = c.rule_set_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
            and s.method = 'typed' and r.hand_typed = 'review' and s.kind = 'add'
            and not exists (select 1 from tc.stamp_check k where k.stamp_id = s.id)) as to_check,
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch}) and s.method in ('scan', 'typed') and ${this.sql.unsafe(COUNTED)}
            and (s.at at time zone 'Africa/Addis_Ababa')::date = (now() at time zone 'Africa/Addis_Ababa')::date) as stamps_today,
        (select count(*)::int from tc.redemption d join tc.reward w on w.id = d.reward_id join tc.card c on c.id = w.card_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or d.branch_id = ${branch})
            and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id)
            and (d.at at time zone 'Africa/Addis_Ababa')::date = (now() at time zone 'Africa/Addis_Ababa')::date) as rewards_today`;
    const team = await this.teamRows(a.businessId!, branch);
    return {
      attention: {
        pendingApprovals: n.pending,
        toCheck: n.to_check,
        locked: team.filter((p) => p.locked).map((p) => ({ id: p.id, name: p.name })),
        pinsExpiringSoon: team.filter((p) => p.pinDaysLeft !== null && p.pinDaysLeft <= 14).map((p) => ({ id: p.id, name: p.name, daysLeft: p.pinDaysLeft })),
      },
      today: { stamps: n.stamps_today, rewards: n.rewards_today },
      // AdminKillSwitch: owners see why stamping stopped.
      killSwitch: await this.safety.killSwitch(),
    };
  }

  // ---------------------------------------------------------------- OwnPlan* (owners only; money)
  /** The plan page: plan, fee, paid, balance, due date, covers-until, trial days and receipts, from the same ledger as Admin. */
  @Get('plan')
  async plan(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const fy = moneyDate().financeYear;
    const [b] = await this.sql<{ status: string; trial_ends_at: Date | null }[]>`select status, trial_ends_at from tc.business where id = ${a.businessId!}`;
    const t = await this.money.feeFor(this.sql, a.businessId!, fy);
    const paid = await this.money.paid(this.sql, a.businessId!, fy);
    const payments = await this.sql`
      select p.receipt_no as "receiptNo", p.amount_birr + coalesce((select sum(x.amount_birr) from tc.payment x where x.fixes = p.id), 0)::int as amount,
        p.method, p.reference, p.at
      from tc.payment p where p.business_id = ${a.businessId!} and p.kind = 'payment' order by p.at desc`;
    return {
      financeYear: fy, status: b.status, trialEndsAt: b.trial_ends_at, plan: t?.plan ?? null, branches: t?.branches ?? null,
      fee: t?.fee ?? 0, paid, balance: Math.max(0, (t?.fee ?? 0) - paid), dueOn: t?.dueOn ?? null,
      billing: billingOf(b.status, t, paid, todayEat()), coversUntil: t && t.fee > 0 && paid >= t.fee ? financeYearEnd(fy) : null, payments,
    };
  }

  // ---------------------------------------------------------------- Approvals (over the hourly limit)
  @Get('approvals')
  async approvals(@CurrentActor() a: Actor, @Query('branchId') branchId?: string) {
    const branch = await this.branchScope(a, branchId);
    return this.sql`
      select s.id, s.at, p.name as staff, br.name as branch, u.phone
      from tc.stamp s join tc.card c on c.id = s.card_id join tc.customer u on u.id = c.customer_id
      left join tc.person p on p.id = s.person_id left join tc.branch br on br.id = s.branch_id
      where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
        and s.needs_approval and not exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id)
      order by s.at`.then((rows) => rows.map((r) => ({ ...r, phone: r.phone ? maskPhone(r.phone) : null })));
  }

  @Post('approvals/decide')
  async decide(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (b.decision !== 'approved' && b.decision !== 'rejected') throw badRequest('bad_decision');
    const ids = await this.stampsInScope(a, b.stampIds);
    return this.sql.begin(async (tx) => {
      let done = 0;
      for (const id of ids) {
        const rows = await tx`insert into tc.stamp_decision (stamp_id, decision, person_id) values (${id}, ${b.decision as string}, ${a.id})
                              on conflict (stamp_id) do nothing returning stamp_id`;
        done += rows.length;
        if (rows.length && b.decision === 'approved') {
          const [card] = await tx<{ id: string; customer_id: string; rule_set_id: string }[]>`
            select c.id, c.customer_id, c.rule_set_id from tc.card c join tc.stamp s on s.card_id = c.id where s.id = ${id}`;
          await unlockRewards(tx, card);
        }
      }
      await this.audit(tx, a, req, `stamp.${b.decision}`, `${done} stamp(s) ${b.decision}`, { stampIds: ids });
      return { decided: done };
    });
  }

  // ---------------------------------------------------------------- To check (typed by hand)
  @Get('to-check')
  async toCheck(@CurrentActor() a: Actor, @Query('branchId') branchId?: string) {
    const branch = await this.branchScope(a, branchId);
    return this.sql`
      select s.id, s.at, p.name as staff, br.name as branch
      from tc.stamp s join tc.card c on c.id = s.card_id join tc.rule_set r on r.id = c.rule_set_id
      left join tc.person p on p.id = s.person_id left join tc.branch br on br.id = s.branch_id
      where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
        and s.method = 'typed' and s.kind = 'add' and r.hand_typed = 'review'
        and not exists (select 1 from tc.stamp_check k where k.stamp_id = s.id)
      order by s.at desc limit 200`;
  }

  @Post('to-check/mark')
  async markChecked(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const ids = await this.stampsInScope(a, b.stampIds);
    return this.sql.begin(async (tx) => {
      for (const id of ids) await tx`insert into tc.stamp_check (stamp_id, person_id) values (${id}, ${a.id}) on conflict (stamp_id) do nothing`;
      await this.audit(tx, a, req, 'stamp.checked', `${ids.length} hand-typed stamp(s) checked`, { stampIds: ids });
      return { checked: ids.length };
    });
  }

  // ---------------------------------------------------------------- Customers
  @Get('customers')
  async customers(@CurrentActor() a: Actor, @Query('q') q?: string, @Query('branchId') branchId?: string) {
    const branch = await this.branchScope(a, branchId);
    const digits = (q ?? '').replace(/\D/g, '');
    const rows = await this.sql<{ card_id: string; phone: string | null; status: string; joined: Date; last_visit: Date | null; total: number }[]>`
      select c.id as card_id, u.phone, c.status, c.created_at as joined, (select r.stamps_needed from tc.rule_set r where r.id = c.rule_set_id) as total,
        (select max(s.at) from tc.stamp s where s.card_id = c.id and s.kind = 'add') as last_visit
      from tc.card c join tc.customer u on u.id = c.customer_id
      where c.business_id = ${a.businessId!}
        and (${branch}::uuid is null or exists (select 1 from tc.stamp s where s.card_id = c.id and s.branch_id = ${branch}))
        and (${digits} = '' or u.phone like ${'%' + digits + '%'})
      order by last_visit desc nulls last limit 200`;
    const out = [];
    for (const r of rows) {
      out.push({ cardId: r.card_id, phone: r.phone ? maskPhone(r.phone) : null, status: r.status, joined: r.joined, lastVisit: r.last_visit, stamps: await cardCount(this.sql, r.card_id), total: r.total });
    }
    return out;
  }

  @Get('customers/:cardId')
  async customer(@Param('cardId') cardId: string, @CurrentActor() a: Actor) {
    if (!UUID.test(cardId)) throw notFound();
    const [c] = await this.sql<{ id: string; business_id: string; status: string; phone: string | null; total: number; created_at: Date }[]>`
      select c.id, c.business_id, c.status, u.phone, r.stamps_needed as total, c.created_at
      from tc.card c join tc.customer u on u.id = c.customer_id join tc.rule_set r on r.id = c.rule_set_id where c.id = ${cardId}`;
    if (!c || c.business_id !== a.businessId) throw forbidden();
    if (a.type === 'manager') {
      const [seen] = await this.sql`select 1 from tc.stamp where card_id = ${c.id} and branch_id = ${a.branchId!} limit 1`;
      if (!seen) throw forbidden();
    }
    const history = await this.sql`
      select s.id, s.at, s.kind, s.method, s.needs_approval as pending, p.name as by, br.name as branch, s.reason
      from tc.stamp s left join tc.person p on p.id = s.person_id left join tc.branch br on br.id = s.branch_id
      where s.card_id = ${c.id} order by s.at desc limit 100`;
    return { cardId: c.id, status: c.status, phone: c.phone ? maskPhone(c.phone) : null, joined: c.created_at, stamps: await cardCount(this.sql, c.id), total: c.total, history };
  }

  // ---------------------------------------------------------------- Team
  private async teamRows(businessId: string, branch: string | null) {
    const rows = await this.sql<{ id: string; name: string; phone: string; role: string; status: string; hourly_stamp_limit: number | null; locked_until: Date | null; pin_set_at: Date | null; pin_days: number | null; branches: string[] }[]>`
      select p.id, p.name, p.phone, p.role, p.status, p.hourly_stamp_limit, p.locked_until, p.pin_set_at,
        (select pin_days from tc.rule_set where business_id = p.business_id order by version desc limit 1) as pin_days,
        coalesce(array(select pb.branch_id::text from tc.person_branch pb where pb.person_id = p.id), '{}') as branches
      from tc.person p
      where p.business_id = ${businessId} and p.role in ('staff', 'manager') and p.status = 'active'
        and (${branch}::uuid is null or exists (select 1 from tc.person_branch pb where pb.person_id = p.id and pb.branch_id = ${branch}))
      order by p.role, p.name`;
    return rows.map((p) => ({
      id: p.id, name: p.name, phone: maskPhone(p.phone), role: p.role, hourlyLimit: p.hourly_stamp_limit, branches: p.branches,
      locked: !!p.locked_until && p.locked_until.getTime() > Date.now(),
      pinDaysLeft: p.pin_days && p.pin_set_at ? Math.ceil((p.pin_set_at.getTime() + p.pin_days * 86_400_000 - Date.now()) / 86_400_000) : null,
    }));
  }

  @Get('team')
  async team(@CurrentActor() a: Actor, @Query('branchId') branchId?: string) {
    return this.teamRows(a.businessId!, await this.branchScope(a, branchId));
  }

  /** A temporary 6-digit PIN the person must change at first sign-in; shown once, stored hashed. */
  private tempPin(phone: string): string {
    for (;;) {
      const p = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (!isWeakPin(p, phone)) return p;
    }
  }

  @Post('team')
  async addPerson(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const role = b.role === 'manager' ? 'manager' : b.role === 'staff' ? 'staff' : null;
    if (!role) throw badRequest('bad_role');
    if (role === 'manager') this.ownerOnly(a);
    const branch = await this.branchScope(a, b.branchId);
    if (!branch) throw badRequest('need_branch');
    const name = String(b.name ?? '').trim();
    const phone = normalizePhone(b.phone);
    if (name.length < 2) throw badRequest('need_name');
    if (!phone) throw badRequest('bad_phone');
    const temp = this.tempPin(phone);
    const pinHash = await hashSecret(temp);
    return this.sql.begin(async (tx) => {
      const [p] = await tx<{ id: string }[]>`
        insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
        values (${a.businessId!}, ${phone}, ${name}, ${role}, ${pinHash}, now(), true)
        on conflict (business_id, phone) do nothing returning id`;
      if (!p) throw conflict('phone_in_use');
      await tx`insert into tc.person_branch (person_id, branch_id) values (${p.id}, ${branch})`;
      await this.audit(tx, a, req, 'team.added', `Added ${role} ${name}`, { personId: p.id, branchId: branch });
      return { id: p.id, tempPin: temp };
    });
  }

  /** A team member the caller may manage: same business; managers only staff of their branch. */
  private async member(a: Actor, id: string) {
    if (!UUID.test(id)) throw notFound();
    const [p] = await this.sql<{ id: string; phone: string; role: string; business_id: string }[]>`
      select id, phone, role, business_id from tc.person where id = ${id} and role in ('staff', 'manager')`;
    if (!p || p.business_id !== a.businessId) throw forbidden();
    if (a.type === 'manager') {
      if (p.role !== 'staff') throw forbidden();
      const [inBranch] = await this.sql`select 1 from tc.person_branch where person_id = ${id} and branch_id = ${a.branchId!}`;
      if (!inBranch) throw forbidden();
    }
    return p;
  }

  @Post('team/:id/reset-pin')
  async resetPin(@Param('id') id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const p = await this.member(a, id);
    const temp = this.tempPin(p.phone);
    const pinHash = await hashSecret(temp);
    await this.sql.begin(async (tx) => {
      await tx`update tc.person set pin_hash = ${pinHash}, pin_set_at = now(), pin_must_change = true, failed_attempts = 0, locked_until = null where id = ${id}`;
      await tx`update tc.session set revoked_at = now() where actor_id = ${id} and revoked_at is null`;
      await this.audit(tx, a, req, 'team.pin_reset', 'Gave a new temporary PIN', { personId: id });
    });
    return { tempPin: temp };
  }

  @Post('team/:id/unlock')
  async unlock(@Param('id') id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    await this.member(a, id);
    await this.sql.begin(async (tx) => {
      await tx`update tc.person set failed_attempts = 0, locked_until = null where id = ${id}`;
      await this.audit(tx, a, req, 'team.unlocked', 'Unlocked an account', { personId: id });
    });
    return { ok: true };
  }

  @Post('team/:id/limit')
  async limit(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    await this.member(a, id);
    const limit = b.limit === null ? null : Number(b.limit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw badRequest('bad_limit');
    await this.sql.begin(async (tx) => {
      await tx`update tc.person set hourly_stamp_limit = ${limit} where id = ${id}`;
      await this.audit(tx, a, req, 'team.limit', limit === null ? 'Uses the shop limit' : `Hourly limit set to ${limit}`, { personId: id, limit });
    });
    return { ok: true };
  }

  @Post('team/:id/remove')
  async remove(@Param('id') id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    await this.member(a, id);
    await this.sql.begin(async (tx) => {
      await tx`update tc.person set status = 'disabled' where id = ${id}`;
      await tx`update tc.session set revoked_at = now() where actor_id = ${id} and revoked_at is null`;
      await this.audit(tx, a, req, 'team.removed', 'Removed from the team', { personId: id });
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- Card and rules (owner changes, everyone reads)
  @Get('rules')
  async rules(@CurrentActor() a: Actor) {
    const [r] = await this.sql`
      select version, stamps_needed as "stampsNeeded", ladder, visit_window_minutes / 60 as "gapHours", reward_valid_days as "rewardValidDays",
        hourly_limit_per_staff as "hourlyLimit", hand_typed as "handTyped", pin_days as "pinDays", card_valid_days as "cardValidDays",
        welcome_stamps as "welcomeStamps", terms, reward_cost_birr as "rewardCostBirr", created_at as "createdAt"
      from tc.rule_set where business_id = ${a.businessId!} order by version desc limit 1`;
    // A newly approved business has no card yet: start the editors from the defaults saveRules
    // uses, with the prototype's 8 stamps and no reward named (version 0 = never saved).
    return r ?? {
      version: 0, stampsNeeded: 8, ladder: [], gapHours: 4, rewardValidDays: 30, hourlyLimit: null, handTyped: 'review',
      pinDays: 90, cardValidDays: null, welcomeStamps: 0, terms: {}, rewardCostBirr: null, createdAt: null,
    };
  }

  /** Every change is a new rule version; cards already in progress keep the version they started under. */
  @Post('rules')
  async saveRules(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const stamps = Number(b.stampsNeeded);
    if (!Number.isInteger(stamps) || stamps < 2 || stamps > 30) throw badRequest('bad_stamps');
    const ladderIn = Array.isArray(b.ladder) ? (b.ladder as Array<{ at: unknown; reward: unknown }>) : [];
    if (ladderIn.length < 1 || ladderIn.length > 2) throw badRequest('bad_ladder');
    const ladder = ladderIn
      .map((t) => ({ at: Number(t.at), reward: String(t.reward ?? '').trim().slice(0, 60) }))
      .sort((x, y) => x.at - y.at)
      .map((t, i) => ({ tier: i + 1, ...t }));
    if (ladder.some((t) => !Number.isInteger(t.at) || t.at < 1 || t.at > stamps || !t.reward) || ladder[ladder.length - 1].at !== stamps) throw badRequest('bad_ladder');
    if (ladder.length === 2 && ladder[0].at === ladder[1].at) throw badRequest('bad_ladder');
    const pick = <T>(v: unknown, allowed: T[], dflt: T): T => (v === undefined ? dflt : allowed.includes(v as T) ? (v as T) : (() => { throw badRequest('bad_rule'); })());
    const gapHours = pick(b.gapHours, [1, 2, 4, 8, 24], 4);
    const valid = pick(b.rewardValidDays, [7, 14, 30, 60, 90], 30);
    const hand = pick(b.handTyped, ['review', 'allow', 'off'], 'review');
    const pinDays = pick(b.pinDays, [0, 60, 90, 180], 90);
    const hourly = b.hourlyLimit === undefined || b.hourlyLimit === null ? null : Number(b.hourlyLimit);
    if (hourly !== null && (!Number.isInteger(hourly) || hourly < 1 || hourly > 1000)) throw badRequest('bad_rule');
    const welcome = b.welcomeStamps === undefined ? 0 : Number(b.welcomeStamps);
    if (!Number.isInteger(welcome) || welcome < 0 || welcome >= stamps) throw badRequest('bad_rule');
    const cardDays = b.cardValidDays === undefined || b.cardValidDays === null ? null : Number(b.cardValidDays);
    const cost = b.rewardCostBirr === undefined || b.rewardCostBirr === null ? null : Number(b.rewardCostBirr);

    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'rules:' + a.businessId}, 0))`;
      const [{ v }] = await tx<{ v: number }[]>`select coalesce(max(version), 0)::int + 1 as v from tc.rule_set where business_id = ${a.businessId!}`;
      await tx`insert into tc.rule_set (business_id, version, stamps_needed, ladder, visit_window_minutes, reward_valid_days, hourly_limit_per_staff,
                 hand_typed, pin_days, card_valid_days, welcome_stamps, terms, reward_cost_birr, created_by)
               values (${a.businessId!}, ${v}, ${stamps}, ${tx.json(ladder)}, ${gapHours * 60}, ${valid}, ${hourly}, ${hand}, ${pinDays},
                 ${cardDays}, ${welcome}, ${tx.json((b.terms ?? {}) as never)}, ${cost}, ${a.id})`;
      await this.audit(tx, a, req, 'rules.changed', `Card and rules saved as version ${v}`, { version: v, stampsNeeded: stamps, ladder });
      return { version: v };
    });
  }

  // ---------------------------------------------------------------- Shop details and branches
  @Get('shop')
  async shop(@CurrentActor() a: Actor) {
    const [s] = await this.sql`select name, category, city, status, plan, shop_code as "shopCode" from tc.business where id = ${a.businessId!}`;
    return s;
  }

  @Post('shop')
  async saveShop(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const name = String(b.name ?? '').trim();
    if (name.length < 2) throw badRequest('need_name');
    const cats = ['food', 'cafe', 'salon', 'barber', 'spa', 'restaurant', 'bakery', 'car_wash', 'other'];
    const category = cats.includes(String(b.category)) ? String(b.category) : null;
    await this.sql.begin(async (tx) => {
      await tx`update tc.business set name = ${name}, city = ${String(b.city ?? '').trim()}, category = coalesce(${category}, category) where id = ${a.businessId!}`;
      await this.audit(tx, a, req, 'shop.details', 'Shop details saved', { name });
    });
    return { ok: true };
  }

  @Get('branches')
  async branches(@CurrentActor() a: Actor) {
    const branch = await this.branchScope(a);
    return this.sql`
      select id, name, address, hours, status from tc.branch
      where business_id = ${a.businessId!} and status = 'active' and (${branch}::uuid is null or id = ${branch}) order by created_at`;
  }

  private hours(v: unknown): Record<string, string[][]> {
    if (v === undefined) return {};
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const out: Record<string, string[][]> = {};
    if (typeof v !== 'object' || v === null) throw badRequest('bad_hours');
    for (const [d, spans] of Object.entries(v as Record<string, unknown>)) {
      if (!days.includes(d) || !Array.isArray(spans) || spans.length > 3) throw badRequest('bad_hours');
      out[d] = spans.map((s) => {
        if (!Array.isArray(s) || s.length !== 2 || !s.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw badRequest('bad_hours');
        return [s[0], s[1]];
      });
    }
    return out;
  }

  @Post('branches')
  async addBranch(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const name = String(b.name ?? '').trim();
    if (name.length < 2) throw badRequest('need_name');
    const hours = this.hours(b.hours);
    return this.sql.begin(async (tx) => {
      const [br] = await tx<{ id: string }[]>`insert into tc.branch (business_id, name, address, hours)
        values (${a.businessId!}, ${name}, ${b.address ? String(b.address).slice(0, 200) : null}, ${tx.json(hours)}) returning id`;
      await this.audit(tx, a, req, 'branch.added', `Added branch ${name}`, { branchId: br.id });
      return { id: br.id };
    });
  }

  @Post('branches/:id')
  async saveBranch(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    if (!UUID.test(id)) throw notFound();
    const [br] = await this.sql`select id from tc.branch where id = ${id} and business_id = ${a.businessId!}`;
    if (!br) throw forbidden();
    const name = b.name === undefined ? null : String(b.name).trim();
    if (name !== null && name.length < 2) throw badRequest('need_name');
    const hours = b.hours === undefined ? null : this.hours(b.hours);
    await this.sql.begin(async (tx) => {
      await tx`update tc.branch set name = coalesce(${name}, name),
                 address = coalesce(${b.address === undefined ? null : String(b.address).slice(0, 200)}, address),
                 hours = coalesce(${hours ? tx.json(hours) : null}, hours) where id = ${id}`;
      await this.audit(tx, a, req, 'branch.saved', 'Branch saved', { branchId: id });
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- Reports (from the ledger)
  @Get('reports')
  async reports(@CurrentActor() a: Actor, @Query('days') daysQ?: string, @Query('branchId') branchId?: string) {
    const days = [7, 14, 30].includes(Number(daysQ)) ? Number(daysQ) : 7;
    const branch = await this.branchScope(a, branchId);
    const [t] = await this.sql<{ stamps: number; customers: number; rewards: number; new_cards: number }[]>`
      select
        (select count(*)::int from tc.stamp s join tc.card c on c.id = s.card_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
            and s.method in ('scan', 'typed') and ${this.sql.unsafe(COUNTED)} and s.at > now() - make_interval(days => ${days})) as stamps,
        (select count(distinct c.customer_id)::int from tc.stamp s join tc.card c on c.id = s.card_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
            and s.method in ('scan', 'typed') and ${this.sql.unsafe(COUNTED)} and s.at > now() - make_interval(days => ${days})) as customers,
        (select count(*)::int from tc.redemption d join tc.reward w on w.id = d.reward_id join tc.card c on c.id = w.card_id
          where c.business_id = ${a.businessId!} and (${branch}::uuid is null or d.branch_id = ${branch})
            and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id) and d.at > now() - make_interval(days => ${days})) as rewards,
        (select count(*)::int from tc.card c where c.business_id = ${a.businessId!} and c.created_at > now() - make_interval(days => ${days})
            and (${branch}::uuid is null or exists (select 1 from tc.stamp s where s.card_id = c.id and s.branch_id = ${branch}))) as new_cards`;
    const byDay = await this.sql<{ day: string; stamps: number }[]>`
      select to_char((s.at at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as day, count(*)::int as stamps
      from tc.stamp s join tc.card c on c.id = s.card_id
      where c.business_id = ${a.businessId!} and (${branch}::uuid is null or s.branch_id = ${branch})
        and s.method in ('scan', 'typed') and ${this.sql.unsafe(COUNTED)} and s.at > now() - make_interval(days => ${days})
      group by 1 order by 1`;
    return { days, branchId: branch, stamps: t.stamps, customers: t.customers, rewards: t.rewards, newCards: t.new_cards, byDay };
  }

  // ---------------------------------------------------------------- Activity log
  @Get('log')
  async log(@CurrentActor() a: Actor, @Query('branchId') branchId?: string, @Query('type') type?: string) {
    const branch = await this.branchScope(a, branchId);
    return this.sql`
      select l.at, l.actor_type as "actorType", p.name as actor, l.type, l.text
      from tc.audit_log l left join tc.person p on p.id = l.actor_id
      where l.business_id = ${a.businessId!}
        and (${branch}::uuid is null or l.detail ->> 'branchId' = ${branch}
             or exists (select 1 from tc.person_branch pb where pb.person_id = l.actor_id and pb.branch_id = ${branch}))
        and (${type ?? ''} = '' or l.type like ${(type ?? '') + '%'})
      order by l.id desc limit 200`;
  }
}
