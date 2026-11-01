import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { cardCode, minuteOf, parseCode, rewardCode } from '@temelash/codes';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { SafetyService } from '../settings/safety.service';
import { ApiError, badRequest, conflict, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { maskPhone } from '../auth/pin';
import { cardCount, ensureCardKeys, lockCard, notify, rewardSecret, rewardState, sha256, unlockRewards, type Ladder } from './cards';

type Tx = Sql | TransactionSql;

interface CardRow {
  id: string;
  business_id: string;
  customer_id: string;
  rule_set_id: string;
  status: string;
  short_code: string | null;
  qr_secret: string | null;
  expires_at: Date | null;
}

export type Resolved =
  | { kind: 'card'; card: CardRow; typed: boolean }
  | { kind: 'reward'; rewardId: string; cardId: string };

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Injectable()
export class StampsService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    private readonly safety: SafetyService,
  ) {}

  /**
   * Work out what a scanned or typed code points at, as seen by this cashier,
   * at the moment it was scanned (offline replays pass the original time).
   */
  async resolve(tx: Tx, staff: Actor, raw: unknown, scannedAt: Date): Promise<Resolved> {
    if (typeof raw !== 'string' || !raw.trim()) throw badRequest('bad_code');
    const p = parseCode(raw);
    const [shop] = await tx<{ shop_code: string; name: string; status: string }[]>`select shop_code, name, status from tc.business where id = ${staff.businessId!}`;
    // A business Temelash paused (AdminPauseBusiness) gives no stamps or rewards until resumed.
    if (shop.status !== 'trial' && shop.status !== 'active') throw new ApiError(403, 'business_paused');

    if (p.kind === 'reward') {
      const [r] = await tx<{ id: string; card_id: string; business_id: string; name: string }[]>`
        select r.id, r.card_id, c.business_id, b.name from tc.reward r join tc.card c on c.id = r.card_id join tc.business b on b.id = c.business_id
        where r.code_hash = ${sha256(p.code)}`;
      if (!r) throw badRequest('bad_code');
      if (r.business_id !== staff.businessId) throw conflict('wrong_shop', { otherShop: r.name, thisShop: shop.name });
      return { kind: 'reward', rewardId: r.id, cardId: r.card_id };
    }

    if (p.kind === 'phone') {
      const [card] = await tx<CardRow[]>`
        select c.* from tc.card c join tc.customer u on u.id = c.customer_id
        where u.phone = ${'+251' + p.local} and c.business_id = ${staff.businessId!} and c.status in ('active', 'paused', 'redeemed')
        order by c.created_at desc limit 1`;
      if (!card) throw notFound('no_card');
      return { kind: 'card', card, typed: true };
    }

    if (p.kind !== 'card_qr' && p.kind !== 'card_typed') throw badRequest('bad_code');
    const shopCode = p.kind === 'card_qr' ? p.shopCode : shop.shop_code;
    const [card] = await tx<(CardRow & { shop_code: string; shop_name: string })[]>`
      select c.*, b.shop_code, b.name as shop_name from tc.card c join tc.business b on b.id = c.business_id
      where b.shop_code = ${shopCode} and c.short_code = ${p.short}`;
    if (!card || !card.qr_secret) throw badRequest('bad_code');

    const windows = await this.settings.number('stamp.code_windows', 3);
    const m = minuteOf(scannedAt);
    let ok = false;
    for (let k = 0; k < windows && !ok; k++) {
      const c = await cardCode(card.qr_secret, card.shop_code, card.short_code!, m - k);
      ok = p.kind === 'card_qr' ? p.minute === m - k && same(c.qr, raw.trim().toUpperCase()) : same(c.typed.split('-')[1], p.digits);
    }
    if (!ok) throw badRequest('bad_code');
    if (card.business_id !== staff.businessId) throw conflict('wrong_shop', { otherShop: card.shop_name, thisShop: shop.name });
    return { kind: 'card', card, typed: p.kind === 'card_typed' };
  }

  /** Hourly limit for this cashier (person, else shop rule) and how many they gave this clock hour. */
  async limitFor(tx: Tx, staff: Actor, ruleSetId: string, at: Date) {
    const [l] = await tx<{ max: number | null; used: number }[]>`
      select coalesce(p.hourly_stamp_limit, r.hourly_limit_per_staff) as max,
        (select count(*)::int from tc.stamp s where s.person_id = p.id and s.method in ('scan', 'typed') and s.kind = 'add'
           and date_trunc('hour', s.at at time zone 'Africa/Addis_Ababa') = date_trunc('hour', ${at}::timestamptz at time zone 'Africa/Addis_Ababa')) as used
      from tc.person p, tc.rule_set r where p.id = ${staff.id} and r.id = ${ruleSetId}`;
    if (!l.max) return null;
    return { used: l.used, max: l.max, near: l.used + 1 >= Math.ceil(l.max * 0.8), over: l.used >= l.max };
  }

  /**
   * The stamp from this visit, if there is one: a scan or typed stamp less than the shop's
   * "time between stamps" (OwnRules: 1, 2, 4, 8 or 24 hours) before or after `at`. Looking both
   * ways also covers an offline stamp arriving after a later online one.
   */
  async visitStamp(tx: Tx, cardId: string, at: Date, gapMinutes: number) {
    const [s] = await tx<{ at: Date; by: string | null }[]>`
      select s.at, p.name as by from tc.stamp s left join tc.person p on p.id = s.person_id
      where s.card_id = ${cardId} and s.kind = 'add' and s.method in ('scan', 'typed')
        and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
        and s.at > ${at}::timestamptz - make_interval(mins => ${gapMinutes})
        and s.at < ${at}::timestamptz + make_interval(mins => ${gapMinutes})
      order by s.at desc limit 1`;
    return s ?? null;
  }

  /** The visit rules of a card's rule version. */
  private async visitRules(tx: Tx, ruleSetId: string) {
    const [r] = await tx<{ once_per_visit: boolean; visit_window_minutes: number; hand_typed: 'review' | 'allow' | 'off' }[]>`
      select once_per_visit, visit_window_minutes, hand_typed from tc.rule_set where id = ${ruleSetId}`;
    return r;
  }

  /** OwnRules "Do not allow": typed codes and phone numbers are refused; the camera must be used. */
  private refuseTyped(typed: boolean, rules: { hand_typed: string }) {
    if (typed && rules.hand_typed === 'off') throw new ApiError(403, 'typed_not_allowed');
  }

  private refuseCardState(card: CardRow) {
    if (card.status === 'paused') throw conflict('card_paused');
    if (card.status === 'redeemed') throw conflict('card_redeemed');
    if (card.status === 'expired' || (card.expires_at && card.expires_at.getTime() <= Date.now())) throw conflict('card_expired');
  }

  /** StaffFound: what the cashier sees before tapping "Add 1 stamp" or "Confirm reward given". */
  async preview(staff: Actor, raw: unknown) {
    await this.safety.refuseIfPaused();
    const now = new Date();
    const r = await this.resolve(this.sql, staff, raw, now);
    if (r.kind === 'reward') return { kind: 'reward', ...(await this.rewardView(this.sql, r.rewardId)) };
    this.refuseCardState(r.card);
    const [rules] = await this.sql<Ladder[]>`select stamps_needed, ladder, reward_valid_days from tc.rule_set where id = ${r.card.rule_set_id}`;
    const count = await cardCount(this.sql, r.card.id);
    const next = rules.ladder.find((t) => t.at > count) ?? rules.ladder[rules.ladder.length - 1];
    const vr = await this.visitRules(this.sql, r.card.rule_set_id);
    this.refuseTyped(r.typed, vr);
    const visit = vr.once_per_visit ? await this.visitStamp(this.sql, r.card.id, now, vr.visit_window_minutes) : null;
    const [cust] = await this.sql<{ phone: string | null }[]>`select phone from tc.customer where id = ${r.card.customer_id}`;
    return {
      kind: 'stamp',
      cardId: r.card.id,
      customer: cust?.phone ? maskPhone(cust.phone) : null,
      count,
      total: rules.stamps_needed,
      nextReward: next?.reward ?? null,
      typed: r.typed,
      stampedToday: !!visit,
      stampedAt: visit?.at ?? null,
      stampedBy: visit?.by ?? null,
      limit: await this.limitFor(this.sql, staff, r.card.rule_set_id, now),
    };
  }

  /** StaffAdded / StaffQueued / StaffLimit. Safe to replay: the idempotency key is stored once. */
  async stamp(staff: Actor, b: { code?: unknown; idempotencyKey?: unknown; scannedAt?: unknown }, ip?: string) {
    if (typeof b.idempotencyKey !== 'string' || !/^[\w-]{8,64}$/.test(b.idempotencyKey)) throw badRequest('bad_key');
    const key = b.idempotencyKey;
    await this.safety.refuseIfPaused();
    const prior = await this.result(this.sql, key);
    if (prior) return prior;

    const now = new Date();
    let at = now;
    let queued = false;
    if (b.scannedAt !== undefined) {
      at = new Date(String(b.scannedAt));
      const maxHours = await this.settings.number('stamp.offline_max_hours', 24);
      if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 60_000 || now.getTime() - at.getTime() > maxHours * 3_600_000) {
        throw badRequest('bad_code');
      }
      queued = now.getTime() - at.getTime() > 60_000;
    }

    return this.sql.begin(async (tx) => {
      const r = await this.resolve(tx, staff, b.code, at);
      if (r.kind !== 'card') throw badRequest('bad_code');
      await lockCard(tx, r.card.id);
      const [card] = await tx<CardRow[]>`select * from tc.card where id = ${r.card.id}`;
      this.refuseCardState(card);
      const vr = await this.visitRules(tx, card.rule_set_id);
      this.refuseTyped(r.typed, vr);
      if (vr.once_per_visit) {
        const visit = await this.visitStamp(tx, card.id, at, vr.visit_window_minutes);
        if (visit) throw conflict('duplicate', { at: visit.at.toISOString(), by: visit.by });
      }
      const limit = await this.limitFor(tx, staff, card.rule_set_id, at);
      const pending = !!limit?.over;
      const [s] = await tx<{ id: string }[]>`
        insert into tc.stamp (card_id, branch_id, person_id, method, needs_approval, at, queued_at, idempotency_key)
        values (${card.id}, ${staff.branchId!}, ${staff.id}, ${r.typed ? 'typed' : 'scan'}, ${pending}, ${at}, ${queued ? now : null}, ${key})
        on conflict (idempotency_key) do nothing returning id`;
      if (!s) return (await this.result(tx, key))!;
      await this.flagIfUnusual(tx, staff, at);
      const unlocked = pending ? [] : await unlockRewards(tx, card);
      if (!pending) {
        await notify(tx, card.customer_id, card.id, 'stamp_added', {});
        // "One stamp from a reward" (Notifications board): the next stamp unlocks a tier.
        const [rs] = await tx<{ ladder: Array<{ at: number; reward: string }> }[]>`select ladder from tc.rule_set where id = ${card.rule_set_id}`;
        const now = await cardCount(tx, card.id);
        const next = rs?.ladder.find((x) => x.at === now + 1);
        if (next) await notify(tx, card.customer_id, card.id, 'near_reward', { reward: next.reward });
      }
      await writeAudit(tx, {
        actorType: 'staff', actorId: staff.id, role: 'staff', businessId: staff.businessId, ip,
        type: pending ? 'stamp.pending' : 'stamp.added',
        text: pending ? 'Stamp over the hourly limit, waiting for approval' : r.typed ? 'Stamp added by hand' : 'Stamp added',
        detail: { cardId: card.id, stampId: s.id, typed: r.typed, queued },
      });
      const out = await this.result(tx, key);
      return { ...out!, rewardUnlocked: unlocked[0] ?? null, limit: limit ? { ...limit, used: limit.used + 1 } : null };
    });
  }

  /**
   * Basic unusual-activity flag (phase-4.md, item 5): a cashier going over
   * flags.stamps_per_hour in one clock hour raises one request for Temelash.
   */
  private async flagIfUnusual(tx: Tx, staff: Actor, at: Date) {
    const max = await this.settings.number('flags.stamps_per_hour', 60);
    const [h] = await tx<{ used: number; hour: string }[]>`
      select count(*)::int as used, to_char(date_trunc('hour', ${at}::timestamptz at time zone 'Africa/Addis_Ababa'), 'YYYY-MM-DD"T"HH24') as hour
      from tc.stamp s where s.person_id = ${staff.id} and s.method in ('scan', 'typed') and s.kind = 'add'
        and date_trunc('hour', s.at at time zone 'Africa/Addis_Ababa') = date_trunc('hour', ${at}::timestamptz at time zone 'Africa/Addis_Ababa')`;
    if (h.used <= max) return;
    const [seen] = await tx`select 1 from tc.request where type = 'flag' and payload ->> 'personId' = ${staff.id} and payload ->> 'hour' = ${h.hour}`;
    if (seen) return;
    await tx`insert into tc.request (type, business_id, payload)
             values ('flag', ${staff.businessId!}, ${tx.json({ kind: 'stamps_per_hour', personId: staff.id, branchId: staff.branchId ?? null, hour: h.hour, stamps: h.used, limit: max })})`;
  }

  private async result(tx: Tx, key: string) {
    const [s] = await tx<{ id: string; card_id: string; method: string; needs_approval: boolean; queued_at: Date | null; stamps_needed: number }[]>`
      select s.id, s.card_id, s.method, s.needs_approval, s.queued_at, r.stamps_needed
      from tc.stamp s join tc.card c on c.id = s.card_id join tc.rule_set r on r.id = c.rule_set_id where s.idempotency_key = ${key}`;
    if (!s) return null;
    return {
      stampId: s.id,
      cardId: s.card_id,
      count: await cardCount(tx, s.card_id),
      total: s.stamps_needed,
      pending: s.needs_approval,
      typed: s.method === 'typed',
      queued: !!s.queued_at,
      rewardUnlocked: null as string | null,
    };
  }

  async rewardView(tx: Tx, rewardId: string) {
    const [r] = await tx<{ tier: number; ladder: Ladder['ladder'] }[]>`
      select w.tier, rs.ladder from tc.reward w join tc.card c on c.id = w.card_id join tc.rule_set rs on rs.id = c.rule_set_id where w.id = ${rewardId}`;
    const t = r.ladder.find((x) => x.tier === r.tier);
    const st = await rewardState(tx, rewardId);
    return { rewardId, reward: t?.reward ?? '', earnedWith: t?.at ?? null, status: st.status, expiresAt: st.expiresAt, usedAt: st.live?.at ?? null, usedBy: st.live?.by ?? null };
  }

  /** StaffRewardDone. Online only; a reward is used once per round (undo opens a new round). */
  async confirmReward(staff: Actor, raw: unknown, ip?: string) {
    await this.safety.refuseIfPaused();
    try {
      return await this.sql.begin(async (tx) => {
        const r = await this.resolve(tx, staff, raw, new Date());
        if (r.kind !== 'reward') throw badRequest('bad_code');
        await lockCard(tx, r.cardId);
        const [card] = await tx<CardRow[]>`select * from tc.card where id = ${r.cardId}`;
        if (card.status === 'paused') throw conflict('card_paused');
        const st = await rewardState(tx, r.rewardId);
        if (st.live) throw conflict('reward_used', { at: st.live.at.toISOString(), by: st.live.by });
        if (st.status === 'expired') throw new ApiError(410, 'reward_expired', { expiredAt: st.expiresAt.toISOString() });
        await tx`insert into tc.redemption (reward_id, branch_id, person_id, round) values (${r.rewardId}, ${staff.branchId!}, ${staff.id}, ${st.rounds})`;
        const view = await this.rewardView(tx, r.rewardId);
        await notify(tx, card.customer_id, card.id, 'reward_used', { reward: view.reward });
        await this.markRedeemedIfDone(tx, card);
        await writeAudit(tx, { actorType: 'staff', actorId: staff.id, role: 'staff', businessId: staff.businessId, ip, type: 'reward.redeemed', text: `Reward given: ${view.reward}`, detail: { rewardId: r.rewardId, cardId: card.id } });
        return view;
      });
    } catch (e) {
      // Two cashiers confirming at the same instant: the second hits the round key.
      if ((e as { code?: string }).code === '23505') throw conflict('reward_used');
      throw e;
    }
  }

  /** "All rewards redeemed": every tier has a live redemption. */
  async markRedeemedIfDone(tx: Tx, card: CardRow) {
    const [rules] = await tx<Ladder[]>`select ladder from tc.rule_set where id = ${card.rule_set_id}`;
    const rewards = await tx<{ id: string; tier: number }[]>`select id, tier from tc.reward where card_id = ${card.id}`;
    if (rewards.length < rules.ladder.length) return;
    for (const w of rewards) if (!(await rewardState(tx, w.id)).live) return;
    await tx`update tc.card set status = 'redeemed' where id = ${card.id} and status = 'active'`;
  }

  /** The customer's view of their cards, with what the phone needs to make codes offline. */
  async customerCards(customerId: string) {
    return this.sql.begin(async (tx) => {
      const cards = await tx<(CardRow & { shop_name: string; shop_code: string; brand_color: string; logo_version: number | null; created_at: Date })[]>`
        select c.*, b.name as shop_name, b.shop_code, b.brand_color, (select version from tc.business_logo l where l.business_id = b.id) as logo_version
        from tc.card c join tc.business b on b.id = c.business_id
        where c.customer_id = ${customerId} and c.status in ('active', 'paused', 'redeemed', 'expired') order by c.created_at`;
      const out = [];
      for (const c of cards) {
        await ensureCardKeys(tx, c);
        if (c.status === 'active') await unlockRewards(tx, c);
        const [keys] = await tx<{ short_code: string; qr_secret: string }[]>`select short_code, qr_secret from tc.card where id = ${c.id}`;
        const [rules] = await tx<Ladder[]>`select stamps_needed, ladder, reward_valid_days from tc.rule_set where id = ${c.rule_set_id}`;
        const rewards = [];
        for (const w of await tx<{ id: string; tier: number }[]>`select id, tier from tc.reward where card_id = ${c.id} order by tier`) {
          const st = await rewardState(tx, w.id);
          rewards.push({
            id: w.id,
            tier: w.tier,
            reward: rules.ladder.find((t) => t.tier === w.tier)?.reward ?? '',
            status: st.status,
            expiresAt: st.expiresAt,
            code: st.status === 'ready' ? await rewardCode(rewardSecret(), w.id) : null,
          });
        }
        const vr = await this.visitRules(tx, c.rule_set_id);
        const today = await this.visitStamp(tx, c.id, new Date(), vr.visit_window_minutes);
        out.push({
          id: c.id,
          status: c.status,
          shop: { name: c.shop_name, shopCode: c.shop_code, color: c.brand_color, logoUrl: c.logo_version ? `/api/v1/shops/${c.shop_code}/logo?v=${c.logo_version}` : null },
          count: await cardCount(tx, c.id),
          total: rules.stamps_needed,
          ladder: rules.ladder,
          rewardValidDays: rules.reward_valid_days,
          rewards,
          stampedToday: !!today,
          expiresAt: c.expires_at,
          qr: { secret: keys.qr_secret, short: keys.short_code },
        });
      }
      return out;
    });
  }
}
