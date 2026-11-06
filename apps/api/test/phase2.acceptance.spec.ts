/**
 * Phase 2 acceptance (build plan, section 7) and the stamp-loop flows behind
 * the boards. After every test the ledger check recomputes each card's count
 * from raw rows and compares it with what the API reports.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { cardCode, minuteOf } from '@temelash/codes';
import type { Sql } from '@temelash/db';
import { GOOD_PIN, createTestApp, describeDb, migrateFresh, resetDb, seedWorld, type World } from './harness';

interface Card {
  id: string;
  status: string;
  count: number;
  round: number;
  ladder: Array<{ tier: number; at: number; reward: string }>;
  total: number;
  shop: { name: string; shopCode: string };
  qr: { secret: string; short: string };
  rewards: Array<{ id: string; tier: number; reward: string; status: string; code: string | null; expiresAt: string }>;
}

describeDb('Phase 2 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  const local = (e164: string) => e164.slice(4);

  let staffToken: string;
  let ownerToken: string;
  let customerToken: string;

  async function staffSignIn(phone: string) {
    return (await api().post('/api/v1/auth/staff/signin').send({ phone: local(phone), pin: GOOD_PIN }).expect(200)).body.accessToken as string;
  }
  async function cards(token = customerToken): Promise<Card[]> {
    return (await api().get('/api/v1/customer/cards').auth(token, { type: 'bearer' }).expect(200)).body;
  }
  async function mokaCard(token = customerToken): Promise<Card> {
    return (await cards(token)).find((c) => c.shop.shopCode === 'MOKA01')!;
  }
  async function code(card: Card, at = Date.now()) {
    return cardCode(card.qr.secret, card.shop.shopCode, card.qr.short, minuteOf(at));
  }
  const stamp = (token: string, body: Record<string, unknown>) =>
    api().post('/api/v1/staff/stamps').auth(token, { type: 'bearer' }).send({ idempotencyKey: randomUUID(), ...body });

  /** Count from raw rows: adds that are not voided and are not waiting for (or refused) approval. */
  async function ledgerCount(cardId: string): Promise<number> {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from tc.stamp s
      where s.card_id = ${cardId} and s.kind = 'add'
        and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
        and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))`;
    return n;
  }

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    // Moka House: 5 stamps for a small reward, 8 for a big one, welcome stamp off.
    // Rule sets are append-only: a change is a new version, and new cards use the newest.
    await sql`insert into tc.rule_set (business_id, version, stamps_needed, ladder)
      values (${w.bizA}, 2, 8, ${sql.json([{ tier: 1, at: 5, reward: 'Free cookie' }, { tier: 2, at: 8, reward: 'Free macchiato' }])})`;
    staffToken = await staffSignIn(w.staff.phone);
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: local(w.owner.phone), pin: GOOD_PIN });
    const [{ body }] = await sql<{ body: string }[]>`select body from tc.sms_outbox where phone = ${w.owner.phone} order by created_at desc limit 1`;
    ownerToken = (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: body.match(/\d{6}/)![0] })).body.accessToken;
    customerToken = (await api().post('/api/v1/auth/customer/join')
      .send({ phone: '912345678', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201)).body.accessToken;
  });
  afterEach(async () => {
    // Acceptance 4: the ledger sums to every card's stamps, full rounds included.
    for (const c of await cards()) expect((c.round - 1) * c.total + c.count).toBe(await ledgerCount(c.id));
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  // ---------------------------------------------------------------- acceptance 1
  it('1. two staff scanning the same customer in one visit give exactly one stamp', async () => {
    const [{ id: staff2 }] = await sql`insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
      select business_id, '+251911100009', 'Second cashier', 'staff', pin_hash, now(), false from tc.person where id = ${w.staff.id} returning id`;
    await sql`insert into tc.person_branch (person_id, branch_id) values (${staff2}, ${w.branchA1})`;
    const token2 = await staffSignIn('+251911100009');
    const c = await code(await mokaCard());
    const results = await Promise.all([stamp(staffToken, { code: c.qr }), stamp(token2, { code: c.qr })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body).toMatchObject({ error: 'duplicate' });
    expect((await mokaCard()).count).toBe(1);
  });

  // ---------------------------------------------------------------- acceptance 2
  it('2. a reward code used twice redeems once', async () => {
    await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at)
      select ${(await mokaCard()).id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - make_interval(days => g) from generate_series(1, 5) g`;
    const card = await mokaCard(); // reading the card unlocks rewards that are due
    const reward = card.rewards.find((r) => r.tier === 1)!;
    expect(reward).toMatchObject({ status: 'ready', reward: 'Free cookie' });
    const confirm = () => api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: `TCR:${reward.code}` });
    const results = await Promise.all([confirm(), confirm()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error).toBe('reward_used');
    const again = await confirm().expect(409);
    expect(again.body).toMatchObject({ error: 'reward_used', by: expect.any(String), at: expect.any(String) });
    expect((await mokaCard()).rewards.find((r) => r.tier === 1)!.status).toBe('used');
  });

  // ---------------------------------------------------------------- acceptance 3
  it('3. a queued stamp replayed after its card was paused is rejected clearly', async () => {
    const card = await mokaCard();
    const scannedAt = Date.now() - 10 * 60_000; // scanned offline 10 minutes ago
    const c = await code(card, scannedAt);
    await api().post(`/api/v1/owner/cards/${card.id}/fix`).auth(ownerToken, { type: 'bearer' })
      .send({ action: 'pause', reason: 'lost_phone', pin: GOOD_PIN }).expect(201);
    const r = await stamp(staffToken, { code: c.qr, scannedAt: new Date(scannedAt).toISOString() }).expect(409);
    expect(r.body.error).toBe('card_paused');
    expect((await mokaCard()).count).toBe(0);
  });

  // ---------------------------------------------------------------- flows
  describe('scanning', () => {
    it('previews then stamps; the same idempotency key is stored once', async () => {
      const c = await code(await mokaCard());
      const preview = await api().post('/api/v1/staff/scan').auth(staffToken, { type: 'bearer' }).send({ code: c.qr }).expect(200);
      expect(preview.body).toMatchObject({ kind: 'stamp', count: 0, total: 8, nextReward: 'Free cookie', typed: false });
      const key = randomUUID();
      const a = await stamp(staffToken, { code: c.qr, idempotencyKey: key }).expect(201);
      expect(a.body).toMatchObject({ count: 1, total: 8, pending: false });
      const b = await stamp(staffToken, { code: c.qr, idempotencyKey: key }).expect(201);
      expect(b.body.stampId).toBe(a.body.stampId);
      expect((await mokaCard()).count).toBe(1);
    });

    it('refuses a code from a saved picture (older than two minutes)', async () => {
      const c = await code(await mokaCard(), Date.now() - 5 * 60_000);
      const r = await stamp(staffToken, { code: c.qr }).expect(400);
      expect(r.body.error).toBe('bad_code');
    });

    it('accepts a phone whose clock is up to a minute ahead, and no further', async () => {
      const card = await mokaCard();
      const ahead = await code(card, Date.now() + 60_000);
      expect((await stamp(staffToken, { code: ahead.typed }).expect(201)).body.count).toBe(1);
      const far = await code(card, Date.now() + 3 * 60_000);
      expect((await stamp(staffToken, { code: far.qr }).expect(400)).body.error).toBe('bad_code');
    });

    it('refuses a forged code', async () => {
      const c = await code(await mokaCard());
      await stamp(staffToken, { code: c.qr.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')) }).expect(400);
    });

    it('says which shop a card belongs to when it is another shop', async () => {
      const shebaStaff = await (async () => {
        const [{ id }] = await sql`insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
          select ${w.bizB}, '+251911100010', 'Sheba cashier', 'staff', pin_hash, now(), false from tc.person where id = ${w.staff.id} returning id`;
        await sql`insert into tc.person_branch (person_id, branch_id) values (${id}, ${w.branchB1})`;
        return staffSignIn('+251911100010');
      })();
      const c = await code(await mokaCard());
      const r = await stamp(shebaStaff, { code: c.qr }).expect(409);
      expect(r.body).toMatchObject({ error: 'wrong_shop', otherShop: 'Moka House', thisShop: 'Sheba Salon' });
    });

    it('typed code and phone number stamp, marked as by hand', async () => {
      const c = await code(await mokaCard());
      const r = await stamp(staffToken, { code: c.typed }).expect(201);
      expect(r.body.typed).toBe(true);
      const [{ method }] = await sql`select method from tc.stamp where id = ${r.body.stampId}`;
      expect(method).toBe('typed');
      const preview = await api().post('/api/v1/staff/scan').auth(staffToken, { type: 'bearer' }).send({ code: '912345678' }).expect(200);
      expect(preview.body).toMatchObject({ kind: 'stamp', typed: true, stampedToday: true });
    });

    it('a phone without a card here says so', async () => {
      const r = await api().post('/api/v1/staff/scan').auth(staffToken, { type: 'bearer' }).send({ code: '977777777' }).expect(404);
      expect(r.body.error).toBe('no_card');
    });

    it('a second visit the same day is a duplicate, with who and when', async () => {
      const card = await mokaCard();
      await stamp(staffToken, { code: (await code(card)).qr }).expect(201);
      const r = await stamp(staffToken, { code: (await code(card)).qr }).expect(409);
      expect(r.body).toMatchObject({ error: 'duplicate', by: expect.stringContaining('staff'), at: expect.any(String) });
    });
  });

  describe('hourly limit', () => {
    it('warns near the limit and holds stamps over it for approval', async () => {
      await sql`update tc.person set hourly_stamp_limit = 2 where id = ${w.staff.id}`;
      // Two other customers stamped this hour.
      for (const p of ['931111111', '932222222']) {
        const t = (await api().post('/api/v1/auth/customer/join').send({ phone: p, pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' })).body.accessToken;
        const c = await mokaCard(t);
        const preview = await api().post('/api/v1/staff/scan').auth(staffToken, { type: 'bearer' }).send({ code: (await code(c)).qr });
        expect(preview.body.limit).toMatchObject({ used: expect.any(Number), max: 2 });
        await stamp(staffToken, { code: (await code(c)).qr }).expect(201);
      }
      const card = await mokaCard();
      const preview = await api().post('/api/v1/staff/scan').auth(staffToken, { type: 'bearer' }).send({ code: (await code(card)).qr }).expect(200);
      expect(preview.body.limit).toMatchObject({ used: 2, max: 2, over: true });
      const r = await stamp(staffToken, { code: (await code(card)).qr }).expect(201);
      expect(r.body).toMatchObject({ pending: true, count: 0 });
      expect((await mokaCard()).count).toBe(0);
    });
  });

  describe('rewards', () => {
    it('unlock at the ladder count, expire after reward_valid_days, and refuse when expired', async () => {
      const card = await mokaCard();
      await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at)
        select ${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - make_interval(days => g) from generate_series(1, 5) g`;
      const reward = (await mokaCard()).rewards.find((r) => r.tier === 1)!;
      const days = (Date.parse(reward.expiresAt) - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(30);
      await sql`alter table tc.reward disable trigger reward_append_only`;
      await sql`update tc.reward set expires_at = now() - interval '1 day' where id = ${reward.id}`;
      await sql`alter table tc.reward enable trigger reward_append_only`;
      const r = await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: reward.code }).expect(410);
      expect(r.body.error).toBe('reward_expired');
    });

    it('stops a used or expired reward at the scan, before the cashier hands it over', async () => {
      const card = await mokaCard();
      await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at)
        select ${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - make_interval(days => g) from generate_series(1, 8) g`;
      const rewards = (await mokaCard()).rewards;
      const scan = (code: string | null) => api().post('/api/v1/staff/scan').auth(staffToken, { type: 'bearer' }).send({ code });

      const used = rewards.find((r) => r.tier === 1)!;
      expect((await scan(used.code).expect(200)).body).toMatchObject({ kind: 'reward', status: 'ready' });
      await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: used.code }).expect(201);
      const again = await scan(used.code).expect(409);
      expect(again.body).toMatchObject({ error: 'reward_used', by: expect.any(String), at: expect.any(String) });

      const old = rewards.find((r) => r.tier === 2)!;
      await sql`alter table tc.reward disable trigger reward_append_only`;
      await sql`update tc.reward set expires_at = now() - interval '1 day' where id = ${old.id}`;
      await sql`alter table tc.reward enable trigger reward_append_only`;
      expect((await scan(old.code).expect(410)).body.error).toBe('reward_expired');
    });

    it('a full card starts a new round; rewards earn again and nothing is lost', async () => {
      const add = async (id: string, n: number) => sql`insert into tc.stamp (card_id, branch_id, person_id, method, at)
        select ${id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - make_interval(days => g + 1) from generate_series(1, ${n}::int) g`;
      const start = await mokaCard();
      await add(start.id, start.total - start.count);
      const full = await mokaCard();
      expect(full).toMatchObject({ count: start.total, total: start.total, round: 1, status: 'active' });
      const firstRewards = full.rewards.length;
      expect(firstRewards).toBeGreaterThan(0);

      // Every reward used: the card stays open, unlike before.
      for (const r of full.rewards) {
        await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: r.code }).expect(201);
      }
      expect((await mokaCard()).status).toBe('active');

      // The next stamp starts round 2.
      await add(start.id, 1);
      const next = await mokaCard();
      expect(next).toMatchObject({ count: 1, round: 2, status: 'active' });
      expect(next.rewards).toHaveLength(firstRewards);

      // Round 2 earns the rewards again, with codes that work.
      const firstAt = next.ladder[0].at;
      await add(start.id, firstAt - 1);
      const again = await mokaCard();
      expect(again).toMatchObject({ count: firstAt, round: 2 });
      expect(again.rewards).toHaveLength(firstRewards + 1);
      const fresh = again.rewards[again.rewards.length - 1];
      expect(fresh).toMatchObject({ tier: 1, status: 'ready' });
      await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: fresh.code }).expect(201);
      await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: fresh.code }).expect(409); // once
    });

    it('an unused reward from an earlier round stays valid', async () => {
      const card = await mokaCard();
      await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at)
        select ${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - make_interval(days => g + 1) from generate_series(1, ${card.total - card.count + 1}::int) g`;
      const after = await mokaCard();
      expect(after.round).toBe(2);
      const old = after.rewards[0];
      expect(old).toMatchObject({ status: 'ready' });
      await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: old.code }).expect(201);
    });
  });

  describe('owner fixes (OwnFix*)', () => {
    const fix = (cardId: string, body: Record<string, unknown>) =>
      api().post(`/api/v1/owner/cards/${cardId}/fix`).auth(ownerToken, { type: 'bearer' }).send({ reason: 'mistake', pin: GOOD_PIN, ...body });

    it('need the PIN, add and remove stamps as new rows, and tell the customer', async () => {
      const card = await mokaCard();
      await fix(card.id, { action: 'add', count: 3, pin: '000001' }).expect(401);
      await fix(card.id, { action: 'add', count: 3 }).expect(201);
      expect((await mokaCard()).count).toBe(3);
      await fix(card.id, { action: 'remove', count: 2 }).expect(201);
      expect((await mokaCard()).count).toBe(1);
      const [{ adds, voids }] = await sql`select count(*) filter (where kind = 'add')::int adds, count(*) filter (where kind = 'void')::int voids from tc.stamp where card_id = ${card.id}`;
      expect({ adds, voids }).toEqual({ adds: 3, voids: 2 });
      const notes = (await api().get('/api/v1/customer/notifications').auth(customerToken, { type: 'bearer' }).expect(200)).body;
      expect(notes.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['fix_add', 'fix_remove']));
      const [{ n }] = await sql`select count(*)::int n from tc.audit_log where type like 'card.fix%'`;
      expect(n).toBe(2);
    });

    it('undo a reward given and give a reward more time', async () => {
      const card = await mokaCard();
      await fix(card.id, { action: 'add', count: 5 }).expect(201);
      const reward = (await mokaCard()).rewards[0];
      await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: reward.code }).expect(201);
      await fix(card.id, { action: 'undo' }).expect(201);
      expect((await mokaCard()).rewards[0].status).toBe('ready');
      await api().post('/api/v1/staff/rewards/confirm').auth(staffToken, { type: 'bearer' }).send({ code: reward.code }).expect(201);
      await fix(card.id, { action: 'undo' }).expect(201);
      await fix(card.id, { action: 'extend', days: 14 }).expect(201);
      const after = (await mokaCard()).rewards[0];
      expect(Math.round((Date.parse(after.expiresAt) - Date.now()) / 86_400_000)).toBe(14);
    });

    it('a manager cannot fix another business\'s card; staff cannot fix at all', async () => {
      const card = await mokaCard();
      await api().post(`/api/v1/owner/cards/${card.id}/fix`).auth(staffToken, { type: 'bearer' })
        .send({ action: 'add', count: 1, reason: 'x', pin: GOOD_PIN }).expect(403);
      const sOther = await api().post('/api/v1/auth/business/signin').send({ phone: local(w.ownerB.phone), pin: GOOD_PIN });
      const [{ body }] = await sql<{ body: string }[]>`select body from tc.sms_outbox where phone = ${w.ownerB.phone} order by created_at desc limit 1`;
      const otherOwner = (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: sOther.body.ticket, code: body.match(/\d{6}/)![0] })).body.accessToken;
      await api().post(`/api/v1/owner/cards/${card.id}/fix`).auth(otherOwner, { type: 'bearer' })
        .send({ action: 'add', count: 1, reason: 'x', pin: GOOD_PIN }).expect(403);
    });
  });

  describe('customer side', () => {
    it('adding a card by shop code puts the welcome stamp on it', async () => {
      await sql`insert into tc.rule_set (business_id, version, stamps_needed, ladder, welcome_stamps)
        select business_id, 3, stamps_needed, ladder, 1 from tc.rule_set where business_id = ${w.bizA} and version = 2`;
      const t = (await api().post('/api/v1/auth/customer/join').send({ phone: '941111111', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' })).body.accessToken;
      expect((await mokaCard(t)).count).toBe(1);
    });

    it('history lists stamps and rewards, newest first', async () => {
      const card = await mokaCard();
      await stamp(staffToken, { code: (await code(card)).qr }).expect(201);
      const h = (await api().get('/api/v1/customer/history').auth(customerToken, { type: 'bearer' }).expect(200)).body;
      expect(h[0]).toMatchObject({ type: 'stamp', shop: 'Moka House' });
    });
  });
});
