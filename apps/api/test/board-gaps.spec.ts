/**
 * Screens found missing in the board audit (docs/phases/board-audit.md): owner Help and
 * "Report a problem", the new-shop setup card and the closing notice on Today, the hidden-visits
 * customer, and Admin's Audience, Change password and sessions.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('board gaps', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  let admin: string;
  let owner: string;
  let secret = '';

  async function signIn(email: string, ua = 'Laptop/1'): Promise<string> {
    const login = await api().post('/api/v1/admin/auth/login').set('user-agent', ua).send({ email, password: PASSWORD }).expect(200);
    if (login.body.next === 'setup') {
      const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
      secret = start.body.secret;
      return (await api().post('/api/v1/admin/auth/setup/finish').set('user-agent', ua).send({ ticket: login.body.ticket, code: totp(secret) }).expect(200)).body.accessToken;
    }
    await sql`update tc.admin_user set totp_last_step = totp_last_step - 10 where email = ${email}`;
    return (await api().post('/api/v1/admin/auth/code').set('user-agent', ua).send({ ticket: login.body.ticket, code: totp(secret) }).expect(200)).body.accessToken;
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  async function personToken(phone: string) {
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: phone.slice(4), pin: GOOD_PIN });
    return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) })).body.accessToken as string;
  }
  const own = (token: string) => ({
    get: (p: string) => api().get('/api/v1/owner' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/owner' + p).auth(token, { type: 'bearer' }).send(body),
  });
  const join = async (phone: string, shop: string) => (await api().post('/api/v1/auth/customer/join').send({ phone, pin: GOOD_PIN, language: 'en', consent: true, shopCode: shop }).expect(201)).body.accessToken as string;

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    await createAdmin(sql, { email: 'owner1@temelash.et', name: 'Truman', role: 'owner', password: PASSWORD });
    admin = await signIn('owner1@temelash.et');
    owner = await personToken(w.owner.phone);
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('Help: ways to reach us appear once set; "Report a problem" reaches Admin', async () => {
    expect((await own(owner).get('/help').expect(200)).body).toEqual({ phone: null, telegram: null });
    await as(admin).post('/settings', { key: 'support.phone', value: '+251 911 000 000' }).expect(201);
    expect((await own(owner).get('/help').expect(200)).body.phone).toBe('+251 911 000 000');
    await own(owner).post('/help', { text: '' }).expect(400);
    await own(owner).post('/help', { text: 'The poster does not print.' }).expect(201);
    const reqs = (await as(admin).get('/requests?type=help').expect(200)).body;
    expect(reqs[0].payload).toMatchObject({ text: 'The poster does not print.' });
    await as(admin).post(`/requests/${reqs[0].id}/answered`, { reason: '' }).expect(400);
    await as(admin).post(`/requests/${reqs[0].id}/answered`, { reason: 'Called; printing works from Chrome.' }).expect(201);
    expect((await sql`select stage, result from tc.request where id = ${reqs[0].id}`)[0]).toEqual({ stage: 'done', result: 'Answered: Called; printing works from Chrome.' });
  });

  it('Today: the setup card until the four steps are done, and the closing notice', async () => {
    let t = (await own(owner).get('/today').expect(200)).body;
    expect(t.setup).toEqual({ card: false, details: false, staff: true, poster: false });
    await own(owner).post('/setup/poster').expect(201);
    await sql`insert into tc.audit_log (actor_type, business_id, type, text) values ('owner', ${w.bizA}, 'rules.changed', 'x'), ('owner', ${w.bizA}, 'shop.details', 'x')`;
    t = (await own(owner).get('/today').expect(200)).body;
    expect(t.setup).toBeNull();
    expect(t.attention.closing).toBeNull();
    await own(owner).post('/close', { reason: 'Other', pin: GOOD_PIN }).expect(201);
    expect((await own(owner).get('/today').expect(200)).body.attention.closing).toEqual({ state: 'pending', closesOn: null });
  });

  it('a customer who hides visits shows count only, no history', async () => {
    const c = await join('913800001', 'MOKA01');
    const card = (await api().get('/api/v1/customer/cards').auth(c, { type: 'bearer' })).body[0];
    await sql`insert into tc.stamp (card_id, branch_id, person_id, method) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan')`;
    expect((await own(owner).get(`/customers/${card.id}`).expect(200)).body).toMatchObject({ visitsHidden: false, stamps: 1 });
    await api().post('/api/v1/customer/privacy').auth(c, { type: 'bearer' }).send({ share: false }).expect(201);
    const d = (await own(owner).get(`/customers/${card.id}`).expect(200)).body;
    expect(d).toMatchObject({ visitsHidden: true, stamps: 1, history: [] });
  });

  it('Audience counts each phone once across shops', async () => {
    await sql`insert into tc.rule_set (business_id, version, stamps_needed, ladder) values (${w.bizB}, 1, 6, ${sql.json([{ tier: 1, at: 6, reward: 'Free trim' }])})`;
    const both = await join('913800002', 'MOKA01');
    await api().post('/api/v1/customer/cards').auth(both, { type: 'bearer' }).send({ shopCode: 'SHEB02' }).expect(201);
    await join('913800003', 'SHEB02');
    const a = (await as(admin).get('/audience').expect(200)).body;
    expect(a).toMatchObject({ unique: 2, cards: 3, multi: 1, dist: { 1: 1, 2: 1, 3: 0 } });
    expect(a.per.find((p: { name: string }) => p.name === 'Sheba Salon')).toMatchObject({ cards: 2, only: 1, shared: 1 });
    await as(admin).post('/audience/refresh').expect(201);
  });

  it('change password: strong rules, the current one checked, other devices signed out', async () => {
    const other = await signIn('owner1@temelash.et', 'Phone/2');
    const s = (await as(admin).get('/me/sessions').expect(200)).body;
    expect(s.sessions.length).toBe(2);
    expect(s.sessions.filter((x: { current: boolean }) => x.current).length).toBe(1);
    expect(s.recent.length).toBeGreaterThan(0);
    await as(admin).post('/me/password', { current: PASSWORD, next: 'short' }).expect(400);
    await as(admin).post('/me/password', { current: 'wrong password', next: 'New-pass-word-99' }).expect(401);
    await as(admin).post('/me/password', { current: PASSWORD, next: 'New-pass-word-99' }).expect(201);
    await as(other).get('/me').expect(401);
    await as(admin).get('/me').expect(200);
    await api().post('/api/v1/admin/auth/login').send({ email: 'owner1@temelash.et', password: 'New-pass-word-99' }).expect(200);
  });
});
