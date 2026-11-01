import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { recordWrongPin, clearWrongPins } from '../auth/lockout';
import { verifySecret } from '../auth/pin';
import { addCard, lockCard, notify, rewardState, unlockRewards } from './cards';
import { AlertsService } from '../safety/alerts.service';
import { StampsService } from './stamps.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The staff scanner: StaffScan → StaffFound → StaffAdded (or one of the refusal screens). */
@Controller('staff')
@UseGuards(AuthGuard)
@Roles('staff')
export class StaffStampsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly stamps: StampsService,
  ) {}

  /** Looks only; nothing is written until the cashier taps Add or Confirm. */
  @Post('scan')
  @HttpCode(200)
  scan(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    return this.stamps.preview(a, b.code);
  }

  @Post('stamps')
  stamp(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.stamps.stamp(a, b, req.ip);
  }

  @Post('rewards/confirm')
  confirm(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.stamps.confirmReward(a, b.code, req.ip);
  }

  /** StaffRecent: this cashier's last stamps and rewards, and the hour count. */
  @Get('recent')
  async recent(@CurrentActor() a: Actor) {
    const items = await this.sql`
      (select 'stamp' as type, s.at, s.method = 'typed' as by_hand, s.needs_approval as pending, s.queued_at is not null as queued, null as reward
         from tc.stamp s where s.person_id = ${a.id} and s.kind = 'add' and s.method in ('scan', 'typed'))
      union all
      (select 'reward', d.at, false, false, false, (select (rs.ladder -> (w.tier - 1)) ->> 'reward' from tc.reward w join tc.card c on c.id = w.card_id join tc.rule_set rs on rs.id = c.rule_set_id where w.id = d.reward_id)
         from tc.redemption d where d.person_id = ${a.id})
      order by at desc limit 30`;
    const [h] = await this.sql<{ used: number; max: number | null }[]>`
      select (select count(*)::int from tc.stamp s where s.person_id = p.id and s.method in ('scan', 'typed') and s.kind = 'add'
                and date_trunc('hour', s.at at time zone 'Africa/Addis_Ababa') = date_trunc('hour', now() at time zone 'Africa/Addis_Ababa')) as used,
             coalesce(p.hourly_stamp_limit, (select hourly_limit_per_staff from tc.rule_set where business_id = p.business_id order by version desc limit 1)) as max
      from tc.person p where p.id = ${a.id}`;
    return { hour: h, items };
  }
}

/** The customer's wallet (Main), history (History) and notifications (Notifications). */
@Controller('customer')
@UseGuards(AuthGuard)
@Roles('customer')
export class CustomerCardsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly stamps: StampsService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('cards')
  cards(@CurrentActor() a: Actor) {
    return this.stamps.customerCards(a.id);
  }

  /** "Enter shop code" in the wallet. */
  @Post('cards')
  async add(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    const code = String(b.shopCode ?? '').trim().toUpperCase();
    if (!code) throw badRequest('no_code');
    const [shop] = await this.sql<{ id: string }[]>`select id from tc.business where shop_code = ${code} and status in ('trial', 'active')`;
    if (!shop) throw notFound('no_shop');
    const added = await this.sql.begin(async (tx) => {
      const ok = await addCard(tx, a.id, shop.id);
      if (ok) await this.alerts.afterNewCard(tx, shop.id);
      return ok;
    });
    if (!added) throw conflict('have_card');
    return { added: true };
  }

  @Get('history')
  history(@CurrentActor() a: Actor) {
    // History board: stamps earned and rewards used, with the shop's colour and logo for each row.
    return this.sql`
      select h.type, h.at, h.reward, b.name as shop, b.shop_code as "shopCode", b.brand_color as color,
        case when l.version is null then null else '/api/v1/shops/' || b.shop_code || '/logo?v=' || l.version end as "logoUrl"
      from (
        select 'stamp' as type, s.at, null as reward, c.business_id
          from tc.stamp s join tc.card c on c.id = s.card_id
          where c.customer_id = ${a.id} and s.kind = 'add' and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
            and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))
        union all
        select 'reward', d.at, (select t ->> 'reward' from jsonb_array_elements(r.ladder) t where (t ->> 'tier')::int = w.tier), c.business_id
          from tc.redemption d join tc.reward w on w.id = d.reward_id join tc.card c on c.id = w.card_id join tc.rule_set r on r.id = c.rule_set_id
          where c.customer_id = ${a.id} and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id)
      ) h join tc.business b on b.id = h.business_id left join tc.business_logo l on l.business_id = b.id
      order by h.at desc limit 100`;
  }

  @Get('notifications')
  notifications(@CurrentActor() a: Actor) {
    return this.sql`
      select n.id, n.type, n.data, n.created_at as "createdAt", n.read_at as "readAt", b.name as shop, b.shop_code as "shopCode",
        r.stamps_needed as total,
        (select count(*)::int from tc.stamp s where s.card_id = c.id and s.kind = 'add' and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
           and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))) as count,
        (select t ->> 'reward' from tc.reward w, jsonb_array_elements(r.ladder) t where w.id::text = n.data ->> 'rewardId' and (t ->> 'tier')::int = w.tier) as reward
      from tc.notification n left join tc.card c on c.id = n.card_id left join tc.business b on b.id = c.business_id left join tc.rule_set r on r.id = c.rule_set_id
      where n.customer_id = ${a.id} order by n.created_at desc limit 100`;
  }
}

/**
 * OwnFix*: remove or add stamps, undo a reward given, give a reward more time,
 * pause or resume a card. Each needs the owner's or manager's PIN and a reason,
 * adds rows (never edits the ledger), tells the customer and is logged.
 */
@Controller('owner/cards')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerFixController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly stamps: StampsService,
    private readonly settings: SettingsService,
  ) {}

  @Post(':id/fix')
  async fix(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (!UUID.test(id)) throw notFound();
    const [card] = await this.sql<{ id: string; business_id: string; customer_id: string; rule_set_id: string; status: string }[]>`
      select id, business_id, customer_id, rule_set_id, status from tc.card where id = ${id}`;
    if (!card || card.business_id !== a.businessId) throw forbidden();
    const action = String(b.action ?? '');
    if (!['add', 'remove', 'undo', 'extend', 'pause', 'resume'].includes(action)) throw badRequest('bad_action');
    // OwnRoles: undoing a reward given is owner only; a manager fixes only cards used at their branch.
    if (action === 'undo' && a.type !== 'owner') throw forbidden();
    if (a.type === 'manager') {
      const [seen] = await this.sql`select 1 from tc.stamp where card_id = ${card.id} and branch_id = ${a.branchId!} limit 1`;
      if (!seen) throw forbidden();
    }
    const reason = String(b.reason ?? '').trim();
    if (!reason) throw badRequest('need_reason');
    const note = b.note ? String(b.note).slice(0, 500) : null;

    // "Enter your PIN to confirm": wrong PINs count toward the business lock.
    const [me] = await this.sql<{ pin_hash: string | null }[]>`select pin_hash from tc.person where id = ${a.id}`;
    if (typeof b.pin !== 'string' || !(await verifySecret(me?.pin_hash, b.pin))) {
      const max = await this.settings.number('auth.business.max_failed_attempts', 3);
      const minutes = await this.settings.number('auth.lock_minutes', 15);
      await this.sql.begin((tx) => recordWrongPin(tx, 'person', a.id, max, minutes));
      throw unauthorized('wrong_pin');
    }

    return this.sql.begin(async (tx) => {
      await clearWrongPins(tx, 'person', a.id);
      await lockCard(tx, card.id);
      const count = Math.max(1, Math.min(20, Number(b.count ?? 1) | 0));
      let detail: Record<string, unknown> = { cardId: card.id, reason, note };

      if (action === 'add') {
        for (let i = 0; i < count; i++) {
          await tx`insert into tc.stamp (card_id, person_id, method, reason) values (${card.id}, ${a.id}, 'fix', ${reason})`;
        }
        await unlockRewards(tx, card);
        detail = { ...detail, count };
      } else if (action === 'remove') {
        const live = await tx<{ id: string }[]>`
          select s.id from tc.stamp s where s.card_id = ${card.id} and s.kind = 'add'
            and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
            and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))
          order by s.at desc limit ${count}`;
        for (const s of live) {
          await tx`insert into tc.stamp (card_id, person_id, kind, method, voids_stamp_id, reason) values (${card.id}, ${a.id}, 'void', 'fix', ${s.id}, ${reason})`;
        }
        detail = { ...detail, count: live.length };
      } else if (action === 'undo') {
        const rewards = await tx<{ id: string }[]>`select id from tc.reward where card_id = ${card.id} order by issued_at desc`;
        let undone = false;
        for (const w of rewards) {
          const st = await rewardState(tx, w.id);
          if (!st.live) continue;
          await tx`insert into tc.redemption_void (redemption_id, person_id, reason, note) values (${st.live.id}, ${a.id}, ${reason}, ${note})`;
          await tx`update tc.card set status = 'active' where id = ${card.id} and status = 'redeemed'`;
          detail = { ...detail, rewardId: w.id };
          undone = true;
          break;
        }
        if (!undone) throw conflict('nothing_to_undo');
      } else if (action === 'extend') {
        const days = Math.max(1, Math.min(365, Number(b.days ?? 0) | 0));
        const rewards = await tx<{ id: string }[]>`select id from tc.reward where card_id = ${card.id} order by issued_at desc`;
        let target: string | null = null;
        for (const w of rewards) if (!(await rewardState(tx, w.id)).live) { target = w.id; break; }
        if (!target) throw conflict('nothing_to_extend');
        await tx`insert into tc.reward_extension (reward_id, expires_at, person_id, reason, note)
                 values (${target}, now() + make_interval(days => ${days}), ${a.id}, ${reason}, ${note})`;
        detail = { ...detail, rewardId: target, days };
      } else {
        const to = action === 'pause' ? 'paused' : 'active';
        if (action === 'pause' && card.status !== 'active') throw conflict('not_active');
        if (action === 'resume' && card.status !== 'paused') throw conflict('not_paused');
        await tx`update tc.card set status = ${to} where id = ${card.id}`;
      }

      const type = action === 'pause' ? 'card_paused' : action === 'resume' ? 'card_resumed' : `fix_${action}`;
      // The customer's notice says how many stamps, which reward and how many days (OwnFix customer messages).
      await notify(tx, card.customer_id, card.id, type, { reason, count: detail.count, days: detail.days, rewardId: detail.rewardId });
      await writeAudit(tx, {
        actorType: a.type, actorId: a.id, role: a.type, businessId: a.businessId, ip: req.ip,
        type: `card.fix_${action}`, text: `Card fix: ${action}`, detail,
      });
      return { ok: true };
    });
  }
}
