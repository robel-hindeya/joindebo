/**
 * Phase 3 acceptance (build plan, section 7), the owner and manager flows,
 * and the Phase 2 corrections found in the owner board's rules.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { cardCode, minuteOf } from '@temelash/codes';
import type { Sql } from '@temelash/db';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

describeDb('Phase 3 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  const local = (e164: string) => e164.slice(4);
  let owner: string;
  let manager: string;
  let staff: string;

  async function business(phone: string) {
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: local(phone), pin: GOOD_PIN }).expect(200);
    return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) }).expect(200)).body.accessToken as string;
  }
  async function customer(phone: string) {
    return (await api().post('/api/v1/auth/customer/join').send({ phone, pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201)).body.accessToken as string;
  }
  async function card(token: string) {
    return (await api().get('/api/v1/customer/cards').auth(token, { type: 'bearer' }).expect(200)).body[0];
  }
  // Scan a card now and check the status (an async helper cannot hand back a chainable request).
  async function scan(token: string, c: { qr: { secret: string; short: string }; shop: { shopCode: string } }, status: number, typed = false) {
    const code = await cardCode(c.qr.secret, c.shop.shopCode, c.qr.short, minuteOf(Date.now()));
    return api().post('/api/v1/staff/stamps').auth(token, { type: 'bearer' }).send({ code: typed ? code.typed : code.qr, idempotencyKey: randomUUID() }).expect(status);
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1' + p).auth(token, { type: 'bearer' }).send(body),
  });
  /** A stamp at a branch, some hours ago, straight into the ledger (seeding history). */
  async function pastStamp(cardId: string, branchId: string, personId: string, hoursAgo: number, extra: { method?: string; needs_approval?: boolean } = {}) {
    const [s] = await sql`insert into tc.stamp (card_id, branch_id, person_id, method, needs_approval, at)
      values (${cardId}, ${branchId}, ${personId}, ${extra.method ?? 'scan'}, ${extra.needs_approval ?? false}, now() - make_interval(hours => ${hoursAgo})) returning id`;
    return s.id as string;
  }

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    owner = await business(w.owner.phone);
    manager = await business(w.manager.phone);
    staff = (await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN })).body.accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  // ---------------------------------------------------------------- acceptance 1
  it('1. changing the reward ladder does not change cards already in progress', async () => {
    const before = await card(await customer('912000001'));
    expect(before).toMatchObject({ total: 8, ladder: [{ at: 8, reward: 'Free macchiato' }] });
    await as(owner).post('/owner/rules', {
      stampsNeeded: 6, ladder: [{ at: 3, reward: 'Free cookie' }, { at: 6, reward: 'Free coffee' }],
      gapHours: 4, rewardValidDays: 30, hourlyLimit: 40, handTyped: 'review', pinDays: 90,
    }).expect(201);
    const again = (await api().post('/api/v1/auth/customer/signin').send({ phone: '912000001', pin: GOOD_PIN }).expect(200)).body.accessToken;
    const same = await card(again);
    expect(same).toMatchObject({ total: 8, ladder: [{ at: 8, reward: 'Free macchiato' }] });
    const fresh = await card(await customer('912000002'));
    expect(fresh).toMatchObject({ total: 6, ladder: [{ at: 3 }, { at: 6 }] });
    const [{ n }] = await sql`select count(*)::int n from tc.rule_set where business_id = ${w.bizA}`;
    expect(n).toBe(2);
  });

  // ---------------------------------------------------------------- acceptance 2
  describe('2. a branch manager is refused everything for another branch', () => {
    it('reports, log, approvals, to-check, team, customers, rules, branches and undo', async () => {
      const t = await customer('912000003');
      const c = await card(t);
      const atA2 = await pastStamp(c.id, w.branchA2, w.staff.id, 1, { needs_approval: true });
      const typedA2 = await pastStamp(c.id, w.branchA2, w.staff.id, 2, { method: 'typed' });
      const m = as(manager);
      await m.get(`/owner/reports?days=7&branchId=${w.branchA2}`).expect(403);
      await m.get(`/owner/log?branchId=${w.branchA2}`).expect(403);
      await m.post('/owner/approvals/decide', { stampIds: [atA2], decision: 'approved' }).expect(403);
      await m.post('/owner/to-check/mark', { stampIds: [typedA2] }).expect(403);
      await m.post('/owner/team', { name: 'New cashier', phone: '911200009', role: 'staff', branchId: w.branchA2 }).expect(403);
      await m.post('/owner/team', { name: 'New manager', phone: '911200010', role: 'manager', branchId: w.branchA1 }).expect(403);
      await m.get(`/owner/customers/${c.id}`).expect(403); // this card has stamps only at A2
      await m.post(`/owner/cards/${c.id}/fix`, { action: 'add', count: 1, reason: 'x', pin: GOOD_PIN }).expect(403);
      await m.post('/owner/rules', { stampsNeeded: 5, ladder: [{ at: 5, reward: 'x' }] }).expect(403);
      await m.post('/owner/branches', { name: 'New branch' }).expect(403);
      await m.post(`/owner/branches/${w.branchA2}`, { name: 'Renamed' }).expect(403);
      const other = await as(manager).get(`/owner/team?branchId=${w.branchA2}`);
      expect(other.status).toBe(403);
    });

    it('sees and acts on their own branch', async () => {
      const t = await customer('912000004');
      const c = await card(t);
      const pending = await pastStamp(c.id, w.branchA1, w.staff.id, 1, { needs_approval: true });
      const m = as(manager);
      const today = (await m.get('/owner/today').expect(200)).body;
      expect(today.attention.pendingApprovals).toBe(1);
      await m.post('/owner/approvals/decide', { stampIds: [pending], decision: 'approved' }).expect(201);
      expect((await card(t)).count).toBe(1);
      expect((await m.get('/owner/customers').expect(200)).body.length).toBe(1);
      await m.post('/owner/team', { name: 'Branch cashier', phone: '911200011', role: 'staff', branchId: w.branchA1 }).expect(201);
    });

    it('cannot undo a reward given (owner only), the owner can', async () => {
      const c = await card(await customer('912000005'));
      for (let i = 0; i < 8; i++) await pastStamp(c.id, w.branchA1, w.staff.id, 24 * (i + 1));
      const r = (await card((await api().post('/api/v1/auth/customer/signin').send({ phone: '912000005', pin: GOOD_PIN })).body.accessToken)).rewards[0];
      await api().post('/api/v1/staff/rewards/confirm').auth(staff, { type: 'bearer' }).send({ code: r.code }).expect(201);
      await as(manager).post(`/owner/cards/${c.id}/fix`, { action: 'undo', reason: 'mistake', pin: GOOD_PIN }).expect(403);
      await as(owner).post(`/owner/cards/${c.id}/fix`, { action: 'undo', reason: 'mistake', pin: GOOD_PIN }).expect(201);
    });
  });

  // ---------------------------------------------------------------- acceptance 3
  it('3. reports match a hand count of the ledger', async () => {
    const t1 = await customer('912000006');
    const t2 = await customer('912000007');
    const c1 = await card(t1);
    const c2 = await card(t2);
    // Hand count: in the last 7 days, A1 has 3 stamps, A2 has 2; one more A1 stamp 20 days ago;
    // one voided A1 stamp and one still waiting for approval, neither counted.
    await pastStamp(c1.id, w.branchA1, w.staff.id, 5);
    await pastStamp(c1.id, w.branchA1, w.staff.id, 30);
    await pastStamp(c2.id, w.branchA1, w.staff.id, 50);
    await pastStamp(c2.id, w.branchA2, w.staff.id, 10);
    await pastStamp(c1.id, w.branchA2, w.staff.id, 100);
    await pastStamp(c1.id, w.branchA1, w.staff.id, 24 * 20);
    const voided = await pastStamp(c2.id, w.branchA1, w.staff.id, 3);
    await sql`insert into tc.stamp (card_id, person_id, kind, method, voids_stamp_id, reason) values (${c2.id}, ${w.owner.id}, 'void', 'fix', ${voided}, 'x')`;
    await pastStamp(c2.id, w.branchA1, w.staff.id, 4, { needs_approval: true });

    const r7 = (await as(owner).get('/owner/reports?days=7').expect(200)).body;
    expect(r7).toMatchObject({ stamps: 5, customers: 2 });
    const r30 = (await as(owner).get('/owner/reports?days=30').expect(200)).body;
    expect(r30.stamps).toBe(6);
    const a1 = (await as(owner).get(`/owner/reports?days=7&branchId=${w.branchA1}`).expect(200)).body;
    expect(a1.stamps).toBe(3);
    const mine = (await as(manager).get('/owner/reports?days=7').expect(200)).body;
    expect(mine.stamps).toBe(3);
    expect(r7.byDay.reduce((s: number, d: { stamps: number }) => s + d.stamps, 0)).toBe(5);
  });

  // ---------------------------------------------------------------- Phase 2 corrections
  describe('Phase 2 corrections from the owner rules', () => {
    it('one visit is the shop time between stamps, not the calendar day', async () => {
      const t = await customer('912000008');
      const c = await card(t);
      await pastStamp(c.id, w.branchA1, w.staff.id, 5); // 5 hours ago; default gap is 4 hours
      await scan(staff, c, 201);
      const again = await scan(staff, c, 409);
      expect(again.body.error).toBe('duplicate');
    });

    it('"Do not allow" refuses typed codes; the default puts them in To check', async () => {
      const c = await card(await customer('912000009'));
      await scan(staff, c, 201, true);
      const check = (await as(owner).get('/owner/to-check').expect(200)).body;
      expect(check.length).toBe(1);
      await as(owner).post('/owner/to-check/mark', { stampIds: [check[0].id] }).expect(201);
      expect((await as(owner).get('/owner/to-check').expect(200)).body.length).toBe(0);

      await as(owner).post('/owner/rules', { stampsNeeded: 8, ladder: [{ at: 8, reward: 'Free macchiato' }], gapHours: 4, rewardValidDays: 30, hourlyLimit: 40, handTyped: 'off', pinDays: 90 }).expect(201);
      const c2 = await card(await customer('912000010'));
      const r = await scan(staff, c2, 403, true);
      expect(r.body.error).toBe('typed_not_allowed');
    });
  });

  // ---------------------------------------------------------------- owner flows
  describe('team', () => {
    it('adds a cashier with a temporary PIN shown once, resets it, unlocks, sets a limit', async () => {
      const add = await as(owner).post('/owner/team', { name: 'Hana', phone: '911200012', role: 'staff', branchId: w.branchA1 }).expect(201);
      expect(add.body.tempPin).toMatch(/^\d{6}$/);
      const first = await api().post('/api/v1/auth/staff/signin').send({ phone: '911200012', pin: add.body.tempPin }).expect(200);
      expect(first.body).toMatchObject({ next: 'set_pin', reason: 'first' });
      const reset = await as(owner).post(`/owner/team/${add.body.id}/reset-pin`).expect(201);
      expect(reset.body.tempPin).not.toBe(add.body.tempPin);
      await sql`update tc.person set locked_until = now() + interval '10 minutes' where id = ${add.body.id}`;
      await as(owner).post(`/owner/team/${add.body.id}/unlock`).expect(201);
      await as(owner).post(`/owner/team/${add.body.id}/limit`, { limit: 25 }).expect(201);
      const team = (await as(owner).get('/owner/team').expect(200)).body;
      expect(team.find((p: { id: string }) => p.id === add.body.id)).toMatchObject({ name: 'Hana', role: 'staff', hourlyLimit: 25, locked: false });
      const [{ n }] = await sql`select count(*)::int n from tc.audit_log where type like 'team.%'`;
      expect(n).toBe(4);
    });
  });

  describe('shop and branches', () => {
    it('owner edits details and opening hours, adds a branch', async () => {
      await as(owner).post('/owner/shop', { name: 'Moka House', city: 'Addis Ababa', category: 'cafe' }).expect(201);
      const b = await as(owner).post('/owner/branches', { name: 'Kazanchis', address: 'Near the stadium', hours: { mon: [['07:00', '20:00']] } }).expect(201);
      const list = (await as(owner).get('/owner/branches').expect(200)).body;
      expect(list.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['Piassa', 'Bole', 'Kazanchis']));
      await as(owner).post(`/owner/branches/${b.body.id}`, { hours: { mon: [['08:00', '18:00']] } }).expect(201);
      const mine = (await as(manager).get('/owner/branches').expect(200)).body;
      expect(mine.map((x: { name: string }) => x.name)).toEqual(['Piassa']);
    });
  });

  it('the activity log lists what happened, newest first', async () => {
    await as(owner).post('/owner/team', { name: 'Logged', phone: '911200013', role: 'staff', branchId: w.branchA1 }).expect(201);
    const log = (await as(owner).get('/owner/log').expect(200)).body;
    expect(log[0]).toMatchObject({ type: 'team.added' });
    expect(log.some((e: { type: string }) => e.type === 'auth.signin')).toBe(true);
  });
});
