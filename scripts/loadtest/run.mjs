// Phase 2 exit-gate load test: a steady rate of stamp requests for a fixed time,
// plus traps that must not create stamps:
//   retry     - the same request (same idempotency key) sent again       -> same stamp, 201
//   rescan    - a card already stamped today scanned by another cashier -> 409 duplicate
//   race      - two cashiers scan one fresh card at the same instant    -> exactly one 201
// Usage: API=http://localhost:4200 RATE=50 SECONDS=600 node scripts/loadtest/run.mjs
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { cardCode, minuteOf } from '@temelash/codes';

const API = process.env.API ?? 'http://localhost:4200';
const RATE = Number(process.env.RATE ?? 50);
const SECONDS = Number(process.env.SECONDS ?? 600);
const cards = JSON.parse(fs.readFileSync(new URL('./cards.json', import.meta.url), 'utf8'));
if (cards.length < RATE * SECONDS) throw new Error(`need ${RATE * SECONDS} cards, have ${cards.length}`);

const post = async (path, body, token) => {
  const t0 = performance.now();
  try {
    const r = await fetch(API + '/api/v1' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})), ms: performance.now() - t0 };
  } catch (e) {
    return { status: 0, body: { error: String(e) }, ms: performance.now() - t0 };
  }
};

const tokens = [];
for (let s = 0; s < 10; s++) {
  const r = await post('/auth/staff/signin', { phone: '9110000' + String(s).padStart(2, '0'), pin: '730194' });
  if (!r.body.accessToken) throw new Error('staff sign-in failed: ' + JSON.stringify(r.body));
  tokens.push(r.body.accessToken);
}

const codeFor = async (c) => (await cardCode(c.secret, 'LOAD01', c.short, minuteOf(Date.now()))).qr;
const results = []; // { kind, cardId, status, ms, stampId }
const stamped = []; // cards with a 201, for later rescans
let next = 0;
const pending = new Set();

async function fire(i) {
  const roll = i % 100;
  const token = tokens[i % tokens.length];
  if (roll < 3 && results.length) {
    // retry: replay an earlier request with its own key
    const prev = results.findLast((r) => r.kind === 'plain' && r.status === 201);
    if (prev) {
      const r = await post('/staff/stamps', { code: await codeFor(prev.card), idempotencyKey: prev.key }, tokens[(i + 1) % 10]);
      results.push({ kind: 'retry', card: prev.card, key: prev.key, status: r.status, ms: r.ms, stampId: r.body.stampId, expect: prev.stampId });
      return;
    }
  }
  if (roll >= 3 && roll < 5 && stamped.length) {
    const card = stamped[Math.floor(Math.random() * stamped.length)];
    const r = await post('/staff/stamps', { code: await codeFor(card), idempotencyKey: randomUUID() }, tokens[(i + 3) % 10]);
    results.push({ kind: 'rescan', card, status: r.status, ms: r.ms, error: r.body.error });
    return;
  }
  const card = cards[next++];
  if (roll === 5) {
    const code = await codeFor(card);
    const [a, b] = await Promise.all([
      post('/staff/stamps', { code, idempotencyKey: randomUUID() }, tokens[i % 10]),
      post('/staff/stamps', { code, idempotencyKey: randomUUID() }, tokens[(i + 5) % 10]),
    ]);
    results.push({ kind: 'race', card, status: [a.status, b.status].sort().join('+'), ms: Math.max(a.ms, b.ms) });
    if (a.status === 201 || b.status === 201) stamped.push(card);
    return;
  }
  const key = randomUUID();
  const r = await post('/staff/stamps', { code: await codeFor(card), idempotencyKey: key }, token);
  results.push({ kind: 'plain', card, key, status: r.status, ms: r.ms, stampId: r.body.stampId, error: r.body.error });
  if (r.status === 201) stamped.push(card);
}

console.log(`load: ${RATE}/s for ${SECONDS}s against ${API}`);
const start = performance.now();
let sent = 0;
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const due = Math.floor(((performance.now() - start) / 1000) * RATE);
    while (sent < due && sent < RATE * SECONDS) {
      const p = fire(sent++).finally(() => pending.delete(p));
      pending.add(p);
    }
    if (sent >= RATE * SECONDS) {
      clearInterval(timer);
      resolve();
    }
    if (sent % (RATE * 60) === 0 && sent) console.log(`  ${sent / RATE}s sent=${sent} in flight=${pending.size}`);
  }, 20);
});
await Promise.all(pending);
const elapsed = (performance.now() - start) / 1000;

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const by = (k) => results.filter((r) => r.kind === k);
const count = (rs, s) => rs.filter((r) => r.status === s).length;
const summary = {
  sent, elapsedSeconds: Math.round(elapsed), achievedRate: +(sent / elapsed).toFixed(1),
  latencyMs: { p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms[ms.length - 1]) },
  plain: { total: by('plain').length, created: count(by('plain'), 201), other: by('plain').filter((r) => r.status !== 201).map((r) => r.status + ':' + r.error).slice(0, 5) },
  retry: { total: by('retry').length, sameStamp: by('retry').filter((r) => r.status === 201 && r.stampId === r.expect).length },
  rescan: { total: by('rescan').length, refusedDuplicate: by('rescan').filter((r) => r.status === 409 && r.error === 'duplicate').length },
  race: { total: by('race').length, exactlyOne: by('race').filter((r) => r.status === '201+409').length },
  serverErrors: results.filter((r) => String(r.status).startsWith('5') || r.status === 0).length,
};
fs.writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify({ summary, created: results.filter((r) => (r.kind === 'plain' && r.status === 201) || (r.kind === 'race' && r.status === '201+409')).map((r) => r.card.id) }));
console.log(JSON.stringify(summary, null, 2));
