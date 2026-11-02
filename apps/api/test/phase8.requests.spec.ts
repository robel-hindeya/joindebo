/**
 * Phase 8c (build plan, section 7): owner lost phone and phone change with a
 * code check, the owner's privacy (customer deletion) request, and closing a
 * business end to end, including the approved closing date and cancelling.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { Notifier } from '../src/notify/notifier';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 8c: owner account requests', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  let admin: string;
  let owner: string;

  async function signIn(email: string): Promise<string> {
    const login = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
    const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
    return (await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.body.ticket, code: totp(start.body.secret) }).expect(200)).body.accessToken;
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  async function personToken(phone: string) {
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: phone.slice(4), pin: GOOD_PIN });
    if (s.status !== 200) return null;
    return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) })).body.accessToken as string;
  }
  const own = (token: string) => ({
    get: (p: string) => api().get('/api/v1/owner' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/owner' + p).auth(token, { type: 'bearer' }).send(body),
  });
  const inboxTitles = async (t = owner) => (await own(t).get('/inbox').expect(200)).body.messages.map((m: { title: string }) => m.title) as string[];
  const reqOf = async (type: string) => (await sql`select id, stage, result, payload from tc.request where type = ${type} order by created_at desc limit 1`)[0];

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    await createAdmin(sql, { email: 'owner1@temelash.et', name: 'Truman', role: 'owner', password: PASSWORD });
    admin = await signIn('owner1@temelash.et');
    owner = (await personToken(w.owner.phone))!;
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('change phone: PIN and a code sent to the new number; the old number is told; sign-in moves to the new one', async () => {
    await own(owner).post('/phone/start', { phone: w.owner.phone, pin: GOOD_PIN }).expect(400);
    await own(owner).post('/phone/start', { phone: '0912999888', pin: '000000' }).expect(401);
    const t = (await own(owner).post('/phone/start', { phone: '0912999888', pin: GOOD_PIN }).expect(201)).body.ticket;
    await own(owner).post('/phone/confirm', { ticket: t, code: '000000' }).expect(400);
    await own(owner).post('/phone/confirm', { ticket: t, code: await lastSmsCode(sql, '+251912999888') }).expect(201);
    const [old] = await sql`select template from tc.sms_outbox where phone = ${w.owner.phone} order by created_at desc limit 1`;
    expect(old.template).toBe('phone_changed');
    expect(await personToken(w.owner.phone)).toBeNull();
    expect(await personToken('+251912999888')).toBeTruthy();
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'owner.phone_changed'`)[0].n).toBe(1);
  });

  it('lost phone: a request from the sign-in page; Temelash checks and moves the account to the new number', async () => {
    const r = (await api().post('/api/v1/auth/business/lost-phone').send({ business: 'Moka House', name: 'Abebe', phone: '0912777666', old: w.owner.phone }).expect(201)).body;
    expect(r.ref).toMatch(/^LP-\d+$/);
    await api().post('/api/v1/auth/business/lost-phone').send({ business: '', name: 'Abebe', phone: '0912777666' }).expect(400);
    const q = await reqOf('lost_phone');
    expect(q.payload).toMatchObject({ businessName: 'Moka House', newPhone: '+251912777666', matched: true });
    const detail = (await as(admin).get(`/requests/${q.id}`).expect(200)).body;
    expect(detail.businessId).toBe(w.bizA);
    await as(admin).post(`/requests/${q.id}/phone`, {}).expect(201);
    expect((await sql`select phone from tc.person where id = ${w.owner.id}`)[0].phone).toBe('+251912777666');
    await own(owner).get('/today').expect(401);
    expect(await personToken('+251912777666')).toBeTruthy();
    expect((await reqOf('lost_phone')).stage).toBe('done');

    // A second request is rejected with a reason.
    await api().post('/api/v1/auth/business/lost-phone').send({ business: 'Sheba', name: 'X', phone: '0912111000' }).expect(201);
    const q2 = await reqOf('lost_phone');
    expect(q2.payload.matched).toBe(false);
    await as(admin).post(`/requests/${q2.id}/reject`, { reason: 'Could not confirm who they are' }).expect(201);
    expect((await reqOf('lost_phone')).result).toMatch(/^Rejected/);
  });

  it('privacy: a shop passes on a deletion request; Temelash removes the name and phone, stamps stay', async () => {
    const c = (await api().post('/api/v1/auth/customer/join').send({ phone: '913500001', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201)).body.accessToken;
    const card = (await api().get('/api/v1/customer/cards').auth(c, { type: 'bearer' })).body[0];
    await sql`insert into tc.stamp (card_id, branch_id, person_id, method) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan')`;
    await own(owner).post('/privacy/requests', { phone: '12' }).expect(400);
    await own(owner).post('/privacy/requests', { phone: '0913500001' }).expect(201);
    let mine = (await own(owner).get('/privacy/requests').expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ last4: '0001', status: 'waiting' })]);
    const q = await reqOf('deletion');
    await as(admin).post(`/requests/${q.id}/delete-customer`).expect(201);
    const [cu] = await sql`select phone, status from tc.customer where phone is null or phone = '+251913500001'`;
    expect(cu).toMatchObject({ phone: null, status: 'anonymised' });
    expect((await sql`select count(*)::int as n from tc.stamp where card_id = ${card.id}`)[0].n).toBe(1);
    await api().get('/api/v1/customer/cards').auth(c, { type: 'bearer' }).expect(401);
    mine = (await own(owner).get('/privacy/requests').expect(200)).body;
    expect(mine[0].status).toBe('done');
  });

  it('closing: request with PIN, cancel while waiting, approve with a closing date, keep it open, then close on the date', async () => {
    await own(owner).post('/close', { reason: 'The shop is closing', pin: '000000' }).expect(401);
    await own(owner).post('/close', { reason: 'The shop is closing', pin: GOOD_PIN }).expect(201);
    let st = (await own(owner).get('/close').expect(200)).body;
    expect(st).toMatchObject({ state: 'pending', answerDays: 3, afterDays: 30 });
    expect(st.ref).toMatch(/^CLS-\d+$/);
    await own(owner).post('/close', { reason: 'Other', pin: GOOD_PIN }).expect(409);
    await own(owner).post('/close/cancel').expect(201);
    expect((await own(owner).get('/close').expect(200)).body.state).toBe('none');
    expect((await reqOf('closing')).result).toBe('Cancelled by the owner');

    await own(owner).post('/close', { reason: 'I use another system', pin: GOOD_PIN }).expect(201);
    const q = await reqOf('closing');
    await as(admin).post(`/requests/${q.id}/close-approve`).expect(201);
    st = (await own(owner).get('/close').expect(200)).body;
    expect(st.state).toBe('approved');
    expect(st.daysLeft).toBe(30);
    expect((await sql`select status, status_before_closing from tc.business where id = ${w.bizA}`)[0]).toEqual({ status: 'closing', status_before_closing: 'active' });
    expect(await inboxTitles()).toContain('Your closing request is approved');
    expect((await sql`select count(*)::int as n from tc.sms_outbox where phone = ${w.owner.phone} and template = 'closing_approved'`)[0].n).toBe(1);

    // "Keep my business open".
    await own(owner).post('/close/cancel').expect(201);
    expect((await sql`select status, closing_date from tc.business where id = ${w.bizA}`)[0]).toEqual({ status: 'active', closing_date: null });

    // Approved again, then the date passes.
    await own(owner).post('/close', { reason: 'Too expensive', pin: GOOD_PIN }).expect(201);
    await as(admin).post(`/requests/${(await reqOf('closing')).id}/close-approve`).expect(201);
    const notifier = app.get(Notifier);
    expect(await notifier.closeDue(new Date(Date.now() + 29 * 86_400_000))).toBe(0);
    expect(await notifier.closeDue(new Date(Date.now() + 31 * 86_400_000))).toBe(1);
    expect((await sql`select status from tc.business where id = ${w.bizA}`)[0].status).toBe('closed');
    expect((await sql`select count(*)::int as n from tc.person where business_id = ${w.bizA} and status = 'active'`)[0].n).toBe(0);
    await own(owner).get('/today').expect(401);
  });

  it('Temelash can decline a closing with a reason, or cancel an approved closing from the business page', async () => {
    await own(owner).post('/close', { reason: 'Other', pin: GOOD_PIN }).expect(201);
    await as(admin).post(`/requests/${(await reqOf('closing')).id}/close-decline`, { reason: 'Unpaid balance' }).expect(201);
    expect((await own(owner).get('/close').expect(200)).body.state).toBe('none');
    expect(await inboxTitles()).toContain('Your closing request was declined');
    await own(owner).post('/close', { reason: 'Other', pin: GOOD_PIN }).expect(201);
    await as(admin).post(`/requests/${(await reqOf('closing')).id}/close-approve`).expect(201);
    await as(admin).post(`/businesses/${w.bizA}/cancel-closing`).expect(201);
    expect((await sql`select status from tc.business where id = ${w.bizA}`)[0].status).toBe('active');
    expect(await inboxTitles()).toContain('Your business stays open');
  });
});
