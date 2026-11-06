/**
 * Development and staging only: one complete example company, Yeshi Coffee House,
 * so every owner screen can be tried with real rows. It has two branches, a manager,
 * two cashiers, twelve customers, two weeks of stamps, rewards given and waiting,
 * and one stamp each for Approvals and To check. Reward codes are signed with
 * QR_SIGNING_SECRET like real ones, so the whole loop keeps working from here.
 * The screens read this like any other shop; nothing is static.
 *
 * Refuses to run unless SEED_ALLOWED=true. Run once: it stops if the company exists.
 *   npm run seed:example -w @temelash/db
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, Algorithm } from '@node-rs/argon2';
import { rewardCode } from '@temelash/codes';
import { ethiopianDateOf, financeYearOf } from '@temelash/ethiopian-calendar';
import { createDb } from './index';

export const EXAMPLE_SHOP_CODE = 'YESH30';
export const EXAMPLE_OWNER_PHONE = '+251911100100';
/** The owner signs in with this PIN. The manager and cashiers must change it at first sign-in. */
export const EXAMPLE_PIN = '481726';

const DAY = 86_400_000;
const HOURS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, d === 'sun' ? [['08:00', '18:00']] : [['07:00', '20:00']]]));
const LADDER = [
  { tier: 1, at: 5, reward: 'Free macchiato' },
  { tier: 2, at: 10, reward: 'Free breakfast' },
];
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Stamps per customer, then whether their first reward has been given. */
const CUSTOMERS: Array<[number, boolean]> = [
  [10, true], [10, true], [9, true], [8, false], [7, true], [6, false], [5, false], [4, false], [4, false], [3, false], [2, false], [1, false],
];

/** Repeatable "random" numbers, so every run gives the same shop. */
function seeded(start: number) {
  let n = start;
  return () => {
    n = (n * 1664525 + 1013904223) % 4294967296;
    return n / 4294967296;
  };
}

async function main() {
  if (process.env.SEED_ALLOWED !== 'true') throw new Error('Refusing to seed: set SEED_ALLOWED=true (local and staging only).');
  const secret = process.env.QR_SIGNING_SECRET;
  if (!secret || secret.length < 16) throw new Error('QR_SIGNING_SECRET must be at least 16 characters');

  const sql = createDb(undefined, { max: 1 });
  const rand = seeded(30);
  const pinHash = await hash(EXAMPLE_PIN, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const now = Date.now();
  const joined = new Date(now - 45 * DAY);

  try {
    const [found] = await sql`select 1 from tc.business where shop_code = ${EXAMPLE_SHOP_CODE}`;
    if (found) {
      console.log(`example company skipped: ${EXAMPLE_SHOP_CODE} already exists`);
      return;
    }

    await sql.begin(async (tx) => {
      const audit = (at: Date, actorType: string, actorId: string | null, role: string | null, businessId: string, type: string, text: string, detail: object = {}) =>
        tx`insert into tc.audit_log (at, actor_type, actor_id, role, business_id, type, text, detail)
           values (${at}, ${actorType}, ${actorId}, ${role}, ${businessId}, ${type}, ${text}, ${tx.json(detail as never)})`;

      const [biz] = await tx<{ id: string }[]>`
        insert into tc.business (name, category, city, status, plan, plan_date, shop_code, brand_color, terms_accepted_at, created_at)
        values ('Yeshi Coffee House', 'cafe', 'Addis Ababa · Bole', 'active', 'full', ${joined}, ${EXAMPLE_SHOP_CODE}, '#0F6E4B', ${joined}, ${joined})
        returning id`;

      const branch = async (name: string, address: string) => {
        const [b] = await tx<{ id: string }[]>`
          insert into tc.branch (business_id, name, address, hours, created_at)
          values (${biz.id}, ${name}, ${address}, ${tx.json(HOURS as never)}, ${joined}) returning id`;
        return b.id;
      };
      const bole = await branch('Bole', 'Bole Road, near Edna Mall');
      const kaz = await branch('Kazanchis', 'Kazanchis, Africa Avenue');

      const person = async (phone: string, name: string, role: string, branches: string[]) => {
        const [p] = await tx<{ id: string }[]>`
          insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change, created_at)
          values (${biz.id}, ${phone}, ${name}, ${role}, ${pinHash}, now(), ${role !== 'owner'}, ${joined}) returning id`;
        for (const b of branches) await tx`insert into tc.person_branch (person_id, branch_id) values (${p.id}, ${b})`;
        return p.id;
      };
      const owner = await person(EXAMPLE_OWNER_PHONE, 'Yeshi Tadesse', 'owner', []);
      await person('+251911100101', 'Dawit Haile', 'manager', [kaz]);
      const cashierA = await person('+251911100102', 'Liya Kebede', 'staff', [bole]);
      const cashierB = await person('+251911100103', 'Samuel Girma', 'staff', [kaz]);
      const staff = [[cashierA, bole], [cashierB, kaz]] as const;

      const [rules] = await tx<{ id: string }[]>`
        insert into tc.rule_set (business_id, version, stamps_needed, ladder, created_by, reward_cost_birr, created_at)
        values (${biz.id}, 1, 10, ${tx.json(LADDER)}, ${owner}, 80, ${joined}) returning id`;

      // On the Full plan: this month's fee falls due today (DECISIONS.md, 2026-11-06).
      await tx`insert into tc.plan_fee (business_id, finance_year, plan, branches, fee_birr, base_birr, extra_birr, commission_base_birr, commission_extra_birr, gov_share_percent, due_on, reason)
               values (${biz.id}, ${financeYearOf(ethiopianDateOf(new Date()))}, 'full', 2, 2100, 2100, 420, 420, 84, 30, (now() at time zone 'Africa/Addis_Ababa')::date, 'approved')`;

      await audit(joined, 'owner', owner, 'owner', biz.id, 'rules.changed', 'Stamp card set: 10 stamps, rewards at 5 and 10');
      await audit(joined, 'owner', owner, 'owner', biz.id, 'shop.details', 'Shop details saved');
      await audit(joined, 'owner', owner, 'owner', biz.id, 'shop.poster', 'Join poster printed');

      for (const [i, [count, gave]] of CUSTOMERS.entries()) {
        // Customers with lower numbers come more often, and the first five came in today.
        const days = Array.from({ length: count }, (_, s) => Math.round((13 * (count - 1 - s)) / Math.max(count - 1, 1)));
        const ats = days.map((d, s) => {
          const last = s === count - 1;
          if (d === 0 && last) return new Date(now - (i + 1) * 23 * 60_000);
          return new Date(now - (d + (last ? 1 : 0)) * DAY - Math.floor(rand() * 8) * 3_600_000 - 3_600_000);
        });
        if (i >= 5) ats[ats.length - 1] = new Date(now - (i - 3) * DAY - 2 * 3_600_000);
        const first = new Date(ats[0].getTime() - 600_000);

        const [c] = await tx<{ id: string }[]>`
          insert into tc.customer (phone, pin_hash, language, consent_at, created_at)
          values (${'+2519111002' + String(i + 1).padStart(2, '0')}, ${pinHash}, ${i % 3 === 1 ? 'am' : i % 3 === 2 ? 'om' : 'en'}, ${first}, ${first}) returning id`;
        const short = 'YS' + B32[i] + B32[(i * 7 + 3) % 32];
        const [card] = await tx<{ id: string }[]>`
          insert into tc.card (customer_id, business_id, rule_set_id, short_code, qr_secret, created_at)
          values (${c.id}, ${biz.id}, ${rules.id}, ${short}, ${randomBytes(32).toString('base64url')}, ${first}) returning id`;
        await audit(first, 'customer', c.id, null, biz.id, 'card.added', 'Customer got a card', { cardId: card.id });

        for (const [s, at] of ats.entries()) {
          const [who, where] = staff[(i + s) % 2];
          const [st] = await tx<{ id: string }[]>`
            insert into tc.stamp (card_id, branch_id, person_id, method, at) values (${card.id}, ${where}, ${who}, 'scan', ${at}) returning id`;
          await audit(at, 'staff', who, 'staff', biz.id, 'stamp.added', 'Stamp added', { cardId: card.id, stampId: st.id });

          for (const t of LADDER.filter((l) => l.at === s + 1)) {
            const id = randomUUID();
            const code = await rewardCode(secret, id);
            await tx`insert into tc.reward (id, card_id, tier, code_hash, issued_at, expires_at)
                     values (${id}, ${card.id}, ${t.tier}, ${sha256(code)}, ${at}, ${new Date(at.getTime() + 30 * DAY)})`;
            await tx`insert into tc.notification (customer_id, card_id, type, data, created_at)
                     values (${c.id}, ${card.id}, 'reward_unlocked', ${tx.json({ reward: t.reward })}, ${at})`;
            if (gave && t.tier === 1) {
              // Customer 2 collects theirs today, so Today shows a reward.
              const when = i === 1 ? new Date(now - 40 * 60_000) : new Date(Math.min(at.getTime() + DAY, now - 2 * 3_600_000));
              await tx`insert into tc.redemption (reward_id, branch_id, person_id, at) values (${id}, ${where}, ${who}, ${when})`;
              await audit(when, 'staff', who, 'staff', biz.id, 'reward.redeemed', `Reward given: ${t.reward}`, { rewardId: id });
            }
          }
        }

        // One stamp over a cashier's limit waits on Today; one typed by hand waits in To check.
        if (i === 10 || i === 11) {
          const [who, where] = staff[i % 2];
          const at = new Date(now - (i - 8) * 15 * 60_000);
          const [st] = await tx<{ id: string }[]>`
            insert into tc.stamp (card_id, branch_id, person_id, method, needs_approval, at)
            values (${card.id}, ${where}, ${who}, ${i === 10 ? 'scan' : 'typed'}, ${i === 10}, ${at}) returning id`;
          await audit(at, 'staff', who, 'staff', biz.id, i === 10 ? 'stamp.pending' : 'stamp.added',
            i === 10 ? 'Stamp over the hourly limit, waiting for approval' : 'Stamp added by hand', { cardId: card.id, stampId: st.id, typed: i === 11 });
        }
      }
    });
    console.log(`example company ready: Yeshi Coffee House (${EXAMPLE_SHOP_CODE}), owner ${EXAMPLE_OWNER_PHONE}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
