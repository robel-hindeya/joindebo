import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { rewardCode } from '@temelash/codes';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';

/**
 * Card ledger helpers. Everything here runs inside the caller's transaction.
 * A card's count is never stored: it is the number of "add" stamps that are
 * not voided and not waiting for (or refused) approval, so it can always be
 * rebuilt from the rows.
 */

type Tx = Sql | TransactionSql;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function rewardSecret(): string {
  const s = process.env.QR_SIGNING_SECRET;
  if (!s || s.length < 16) throw new Error('QR_SIGNING_SECRET must be at least 16 characters');
  return s;
}

/** Serialise everything that changes one card (concurrent scans, confirms, fixes). */
export async function lockCard(tx: Tx, cardId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${'card:' + cardId}, 0))`;
}

export async function cardCount(tx: Tx, cardId: string): Promise<number> {
  const [{ n }] = await tx<{ n: number }[]>`
    select count(*)::int as n from tc.stamp s
    where s.card_id = ${cardId} and s.kind = 'add'
      and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
      and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))`;
  return n;
}

/** Give a card its rotating-code secret and short id the first time it is needed. */
export async function ensureCardKeys(tx: Tx, card: { id: string; business_id: string; short_code: string | null }): Promise<void> {
  if (card.short_code) return;
  for (let i = 0; i < 20; i++) {
    const short = Array.from({ length: 4 }, () => B32[randomInt(32)]).join('');
    const rows = await tx`
      update tc.card set short_code = ${short}, qr_secret = ${randomBytes(32).toString('base64url')}
      where id = ${card.id} and short_code is null
        and not exists (select 1 from tc.card c where c.business_id = ${card.business_id} and c.short_code = ${short})
      returning id`;
    if (rows.length) return;
    const [again] = await tx<{ short_code: string | null }[]>`select short_code from tc.card where id = ${card.id}`;
    if (again.short_code) return;
  }
  throw new Error('could not assign a card short code');
}

export interface Ladder {
  stamps_needed: number;
  ladder: Array<{ tier: number; at: number; reward: string }>;
  reward_valid_days: number;
}

/** Create reward rows for every tier the card has reached and does not have yet. */
export async function unlockRewards(tx: Tx, card: { id: string; customer_id: string; rule_set_id: string }): Promise<string[]> {
  const [rules] = await tx<Ladder[]>`select stamps_needed, ladder, reward_valid_days from tc.rule_set where id = ${card.rule_set_id}`;
  const count = await cardCount(tx, card.id);
  const have = new Set((await tx<{ tier: number }[]>`select tier from tc.reward where card_id = ${card.id}`).map((r) => r.tier));
  const unlocked: string[] = [];
  for (const t of rules.ladder) {
    if (count < t.at || have.has(t.tier)) continue;
    const id = randomUUID();
    const code = await rewardCode(rewardSecret(), id);
    await tx`insert into tc.reward (id, card_id, tier, code_hash, expires_at)
             values (${id}, ${card.id}, ${t.tier}, ${sha256(code)}, now() + make_interval(days => ${rules.reward_valid_days}))
             on conflict (card_id, tier) do nothing`;
    await notify(tx, card.customer_id, card.id, 'reward_unlocked', { reward: t.reward });
    unlocked.push(t.reward);
  }
  return unlocked;
}

export async function notify(tx: Tx, customerId: string, cardId: string | null, type: string, data: Record<string, unknown> = {}) {
  await tx`insert into tc.notification (customer_id, card_id, type, data) values (${customerId}, ${cardId}, ${type}, ${tx.json(data as never)})`;
}

/**
 * Give a customer a card at a shop under its current rules (unless they hold a
 * live one), with the shop's welcome stamps. Returns whether a card was added.
 */
export async function addCard(tx: Tx, customerId: string, businessId: string): Promise<boolean> {
  const [rules] = await tx<{ id: string; welcome_stamps: number }[]>`
    select id, welcome_stamps from tc.rule_set where business_id = ${businessId} order by version desc limit 1`;
  if (!rules) return false;
  const [card] = await tx<{ id: string; business_id: string; short_code: string | null }[]>`
    insert into tc.card (customer_id, business_id, rule_set_id) values (${customerId}, ${businessId}, ${rules.id})
    on conflict (customer_id, business_id) where status in ('active', 'paused') do nothing
    returning id, business_id, short_code`;
  if (!card) return false;
  await ensureCardKeys(tx, card);
  for (let i = 0; i < rules.welcome_stamps; i++) {
    await tx`insert into tc.stamp (card_id, method, reason) values (${card.id}, 'welcome', 'welcome stamp')`;
  }
  if (rules.welcome_stamps > 0) await unlockRewards(tx, { id: card.id, customer_id: customerId, rule_set_id: rules.id });
  await writeAudit(tx, { actorType: 'customer', actorId: customerId, businessId, type: 'card.added', text: 'Card added', detail: { welcomeStamps: rules.welcome_stamps } });
  return true;
}

/** Live state of a reward: used (a redemption not voided), expired, or ready. */
export async function rewardState(tx: Tx, rewardId: string): Promise<{
  status: 'ready' | 'used' | 'expired';
  expiresAt: Date;
  rounds: number;
  live: { id: string; at: Date; by: string } | null;
}> {
  const [r] = await tx<{ expires_at: Date }[]>`
    select coalesce((select e.expires_at from tc.reward_extension e where e.reward_id = r.id order by e.at desc limit 1), r.expires_at) as expires_at
    from tc.reward r where r.id = ${rewardId}`;
  const reds = await tx<{ id: string; at: Date; by: string; voided: boolean }[]>`
    select d.id, d.at, p.name as by, exists (select 1 from tc.redemption_void v where v.redemption_id = d.id) as voided
    from tc.redemption d join tc.person p on p.id = d.person_id where d.reward_id = ${rewardId} order by d.round`;
  const liveRow = reds.find((d) => !d.voided) ?? null;
  const live = liveRow ? { id: liveRow.id, at: liveRow.at, by: liveRow.by } : null;
  const status = live ? 'used' : r.expires_at.getTime() <= Date.now() ? 'expired' : 'ready';
  return { status, expiresAt: r.expires_at, rounds: reds.length, live };
}
