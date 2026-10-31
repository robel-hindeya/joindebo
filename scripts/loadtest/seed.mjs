// Load-test data: one shop, 10 cashiers, N customers with one card each.
// Usage: DATABASE_URL=... node scripts/loadtest/seed.mjs 30000
// Never point this at a real database: it creates thousands of fake customers.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { hash, Algorithm } from '@node-rs/argon2';

const N = Number(process.argv[2] ?? 30000);
const url = process.env.DATABASE_URL;
if (!url || /supabase|pooler/.test(url)) throw new Error('Set DATABASE_URL to a throwaway local database');
const sql = postgres(url, { max: 4, onnotice: () => {} });
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Short codes must be unique per shop: encode the index in base32 (up to 1,048,576 cards).
const short = (i) => Array.from({ length: 4 }, (_, k) => B32[(i >> (5 * (3 - k))) & 31]).join('');

const pinHash = await hash('730194', { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const [biz] = await sql`insert into tc.business (name, category, city, status, plan, shop_code)
  values ('Load Test Cafe', 'cafe', 'Addis Ababa', 'active', 'full', 'LOAD01') returning id`;
const [branch] = await sql`insert into tc.branch (business_id, name) values (${biz.id}, 'Main') returning id`;
const [rules] = await sql`insert into tc.rule_set (business_id, version, stamps_needed, ladder)
  values (${biz.id}, 1, 10, ${sql.json([{ tier: 1, at: 5, reward: 'Small' }, { tier: 2, at: 10, reward: 'Big' }])}) returning id`;
for (let s = 0; s < 10; s++) {
  const [p] = await sql`insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
    values (${biz.id}, ${'+2519110000' + String(s).padStart(2, '0')}, ${'Load cashier ' + s}, 'staff', ${pinHash}, now(), false) returning id`;
  await sql`insert into tc.person_branch (person_id, branch_id) values (${p.id}, ${branch.id})`;
}

const cards = [];
for (let start = 0; start < N; start += 2000) {
  const n = Math.min(2000, N - start);
  const customers = Array.from({ length: n }, (_, k) => ({ phone: '+2517' + String(start + k).padStart(8, '0'), language: 'en' }));
  const ids = await sql`insert into tc.customer ${sql(customers, 'phone', 'language')} returning id`;
  const rows = ids.map((c, k) => ({
    customer_id: c.id, business_id: biz.id, rule_set_id: rules.id,
    short_code: short(start + k), qr_secret: randomBytes(32).toString('base64url'),
  }));
  const out = await sql`insert into tc.card ${sql(rows, 'customer_id', 'business_id', 'rule_set_id', 'short_code', 'qr_secret')} returning id, short_code, qr_secret`;
  cards.push(...out);
}
const fs = await import('node:fs');
fs.writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(cards.map((c) => ({ id: c.id, short: c.short_code, secret: c.qr_secret }))));
console.log(`seeded LOAD01 with 10 cashiers and ${cards.length} cards`);
await sql.end();
