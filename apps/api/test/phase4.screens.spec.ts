/**
 * Phase 4: what the admin screens read and do (Admin board): the signed-in
 * admin, business list and page, a business's customers and their cards,
 * notes, the overview numbers, approval with a plan, and the team list.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 4 admin screens', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  let owner: string;
  let support: string;

  async function signIn(email: string): Promise<string> {
    const login = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
    const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
    const done = await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.body.ticket, code: totp(start.body.secret) }).expect(200);
    return done.body.accessToken;
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  async function signup(name: string, phone: string) {
    const st = await api().post('/api/v1/auth/business/signup').send({ businessName: name, ownerName: 'Abebe', phone, agree: true, category: 'cafe' }).expect(200);
    const v = await api().post('/api/v1/auth/business/signup/verify').send({ ticket: st.body.ticket, code: await lastSmsCode(sql, '+251' + phone) });
    await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '590382' }).expect(201);
    return (await as(support).get('/requests?type=signup').expect(200)).body.find((r: { business: string }) => r.business === name);
  }

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    await createAdmin(sql, { email: 'owner1@temelash.et', name: 'Truman', role: 'owner', password: PASSWORD });
    await createAdmin(sql, { email: 'sup@temelash.et', name: 'Selam', role: 'support', password: PASSWORD });
    owner = await signIn('owner1@temelash.et');
    support = await signIn('sup@temelash.et');
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  async function joinMoka(phone: string) {
    const c = await api().post('/api/v1/auth/customer/join').send({ phone, pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' });
    return (await api().get('/api/v1/customer/cards').auth(c.body.accessToken, { type: 'bearer' })).body[0];
  }

  it('says who is signed in', async () => {
    expect((await as(support).get('/me').expect(200)).body).toMatchObject({ name: 'Selam', email: 'sup@temelash.et', role: 'support' });
  });

  it('lists businesses with their customers, stamps, agent and last activity, and finds them by owner phone', async () => {
    const card = await joinMoka('912300001');
    await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - interval '2 days')`;
    const list = (await as(support).get('/businesses').expect(200)).body;
    const moka = list.find((b: { name: string }) => b.name === 'Moka House');
    expect(moka).toMatchObject({ customers: 1, stamps30d: 1, agent: null, lastActive: expect.any(String), owner: expect.any(String) });
    const byPhone = (await as(support).get('/businesses?q=' + w.ownerB.phone.slice(-6)).expect(200)).body;
    expect(byPhone.map((b: { name: string }) => b.name)).toEqual(['Sheba Salon']);
  });

  it('a business page shows its people with their branches, and its counts', async () => {
    const page = (await as(support).get(`/businesses/${w.bizA}`).expect(200)).body;
    expect(page.counts).toMatchObject({ branches: 2, staff: 2, customers: 0 });
    const mgr = page.people.find((p: { role: string }) => p.role === 'manager');
    expect(mgr.branches).toEqual(['Piassa']);
  });

  it('notes on a business go to its history', async () => {
    await as(support).post(`/businesses/${w.bizA}/note`, {}).expect(400);
    await as(support).post(`/businesses/${w.bizA}/note`, { text: 'Owner asked us to call after 4 pm' }).expect(201);
    const log = (await as(support).get(`/log?businessId=${w.bizA}`).expect(200)).body;
    expect(log[0]).toMatchObject({ type: 'business.note', actor: 'Selam', detail: { text: 'Owner asked us to call after 4 pm' } });
    // The log can be searched.
    expect((await as(support).get('/log?q=after%204').expect(200)).body).toHaveLength(1);
  });

  it('lists a business\'s customers with hidden phones, and pauses and resumes one card', async () => {
    const card = await joinMoka('912300002');
    const cust = (await as(support).get(`/businesses/${w.bizA}/customers`).expect(200)).body;
    expect(cust).toHaveLength(1);
    expect(cust[0]).toMatchObject({ cardId: card.id, phone: expect.stringContaining('••'), stamps: expect.any(Number), total: 8, status: 'active' });
    expect(cust[0].phone).not.toContain('912300002');
    const one = (await as(support).get(`/cards/${card.id}`).expect(200)).body;
    expect(one).toMatchObject({ business: 'Moka House', otherShops: 0, rewardsEarned: 0, rewardsUsed: 0 });
    await as(support).post(`/cards/${card.id}/pause`, {}).expect(400);
    await as(support).post(`/cards/${card.id}/pause`, { reason: 'Lost phone' }).expect(201);
    expect((await sql`select status from tc.card where id = ${card.id}`)[0].status).toBe('paused');
    await as(support).post(`/cards/${card.id}/resume`).expect(201);
    expect((await sql`select status from tc.card where id = ${card.id}`)[0].status).toBe('active');
    const types = (await sql`select type from tc.audit_log where actor_type = 'admin' and type like 'card.%' order by id`).map((r) => r.type);
    expect(types).toEqual(['card.paused', 'card.resumed']);
  });

  it('the overview has the weekly sign-ups, stamps, customers, what needs attention and businesses to watch', async () => {
    await joinMoka('912300003');
    await signup('Tana Coffee', '962107733');
    await sql`update tc.business set status = 'paused' where id = ${w.bizB}`;
    const o = (await as(support).get('/overview').expect(200)).body;
    expect(o.newPerWeek).toHaveLength(8);
    expect(o.newPerWeek[7].count).toBeGreaterThanOrEqual(3);
    expect(o).toMatchObject({ customers: 1, cards: 1, stamps30d: expect.any(Number) });
    expect(o.attention.map((r: { business: string }) => r.business)).toEqual(['Tana Coffee']);
    expect(o.watch.map((b: { name: string }) => b.name)).toEqual(['Sheba Salon']);
  });

  it('approving with a trial needs the plan they will pay for after it', async () => {
    const r = await signup('Tana Coffee', '962107733');
    await as(support).post(`/requests/${r.id}/approve`, { start: 'trial' }).expect(400);
    await as(support).post(`/requests/${r.id}/approve`, { start: 'trial', plan: 'full' }).expect(201);
    const [b] = await sql`select status, plan, trial_ends_at > now() + interval '13 days' and trial_ends_at < now() + interval '15 days' as long_enough from tc.business where name = 'Tana Coffee'`;
    expect(b).toMatchObject({ status: 'trial', plan: 'full', long_enough: true });
  });

  it('customer History rows carry the shop, its colour and the reward name; removed stamps are left out', async () => {
    const c = await api().post('/api/v1/auth/customer/join').send({ phone: '912300009', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' });
    const token = c.body.accessToken;
    const card = (await api().get('/api/v1/customer/cards').auth(token, { type: 'bearer' })).body[0];
    const [kept] = await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - interval '1 day') returning id`;
    const [gone] = await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - interval '2 days') returning id`;
    await sql`insert into tc.stamp (card_id, kind, voids_stamp_id, person_id, method, reason) values (${card.id}, 'void', ${gone.id}, ${w.owner.id}, 'fix', 'mistake')`;
    const h = (await api().get('/api/v1/customer/history').auth(token, { type: 'bearer' }).expect(200)).body;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ type: 'stamp', shop: 'Moka House', shopCode: 'MOKA01', color: expect.any(String), reward: null });
    expect(kept.id).toBeDefined();
    // The menu shows the customer's own phone.
    expect((await api().get('/api/v1/me').auth(token, { type: 'bearer' }).expect(200)).body.phone).toBe('+251912300009');
  });

  it('a flag can be dismissed with a reason; the sign-in rules and kill-switch details can be read', async () => {
    const [biz] = await sql`select id from tc.business where shop_code = 'MOKA01'`;
    const [f] = await sql`insert into tc.request (type, business_id, payload) values ('flag', ${biz.id}, '{"stamps": 70, "limit": 60}') returning id`;
    await as(support).post(`/requests/${f.id}/dismiss`, {}).expect(400);
    await as(support).post(`/requests/${f.id}/dismiss`, { reason: 'Owner explained it' }).expect(201);
    expect((await sql`select stage, result from tc.request where id = ${f.id}`)[0]).toEqual({ stage: 'done', result: 'Dismissed: Owner explained it' });
    expect((await api().get('/api/v1/admin/auth/rules').expect(200)).body).toEqual({ tries: 5, lockMinutes: 15, idleMinutes: 30 });
    expect((await as(support).get('/kill-switch').expect(200)).body).toMatchObject({ on: false, reason: '' });
  });

  it('every admin sees the team (to assign requests); only Owners change it', async () => {
    const team = (await as(support).get('/team').expect(200)).body;
    expect(team.find((m: { email: string }) => m.email === 'sup@temelash.et')).toMatchObject({ me: true });
    await as(support).post('/team', { email: 'x@temelash.et', name: 'X', role: 'support' }).expect(403);
    await as(owner).get('/team').expect(200);
  });
});
