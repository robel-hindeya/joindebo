/**
 * Manual payments (DECISIONS.md, 2026-11-04): owners pay to Join Debo's accounts and send the
 * transaction ID with a screenshot; Owner or Finance admins approve or reject it. Trials are
 * 14 days; 7 days after an unpaid trial ends the business pauses until a payment is approved.
 * Admins can extend a trial to a date they pick.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { Notifier } from '../src/notify/notifier';
import { createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld } from './harness';

const PASSWORD = 'correct horse battery 7';
// A 1×1 PNG: the smallest real screenshot.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const shot = { type: 'image/png', data: PNG };
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

describeDb('Manual payments and trials', () => {
  let sql: Sql;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  let owner: string;
  let finance: string;
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
  const own = (token: string) => ({
    get: (p: string) => api().get('/api/v1/owner' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/owner' + p).auth(token, { type: 'bearer' }).send(body),
  });

  /** A new business through sign-up, approved on a Starter trial; returns its id and owner token. */
  async function newBusiness(name: string, phone: string, start: 'trial' | 'pilot' = 'trial') {
    const st = await api().post('/api/v1/auth/business/signup').send({ businessName: name, ownerName: 'Abebe', phone, agree: true, category: 'cafe' }).expect(200);
    const v = await api().post('/api/v1/auth/business/signup/verify').send({ ticket: st.body.ticket, code: await lastSmsCode(sql, '+251' + phone) });
    const ownerToken = (await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '590382' }).expect(201)).body.accessToken;
    const [r] = (await as(owner).get('/requests?type=signup').expect(200)).body.filter((x: { business: string }) => x.business === name);
    await as(owner).post(`/requests/${r.id}/approve`, start === 'trial' ? { start, plan: 'starter' } : { start }).expect(201);
    const [b] = await sql`select id from tc.business where name = ${name}`;
    return { id: b.id as string, ownerToken: ownerToken as string };
  }
  const pay = (token: string, body: object = {}) =>
    own(token).post('/payments', { purpose: 'plan', method: 'telebirr', amount: 19000, transactionId: 'CJK8A1B2C3', paidOn: today(), screenshot: shot, ...body });

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    await seedWorld(sql);
    for (const [email, role] of [['owner1@temelash.et', 'owner'], ['owner2@temelash.et', 'owner'], ['fin@temelash.et', 'finance'], ['sup@temelash.et', 'support']] as const) {
      await createAdmin(sql, { email, name: email.split('@')[0], role, password: PASSWORD });
    }
    owner = await signIn('owner1@temelash.et');
    finance = await signIn('fin@temelash.et');
    support = await signIn('sup@temelash.et');
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('a new business gets a 14-day trial when approved', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    const [r] = await sql`select status, extract(epoch from trial_ends_at - now()) / 86400 as days from tc.business where id = ${b.id}`;
    expect(r.status).toBe('trial');
    expect(Number(r.days)).toBeGreaterThan(13.9);
    expect(Number(r.days)).toBeLessThan(14.1);
    expect((await own(b.ownerToken).get('/plan').expect(200)).body).toMatchObject({ billing: 'btrial', claims: [] });
  });

  it('the owner sends a transaction ID with a screenshot; an approval writes the receipt and ends the trial', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    await sql`update tc.setting set value = '"0911 223344 (Join Debo)"' where key = 'pay.telebirr'`;
    expect((await own(b.ownerToken).get('/plan').expect(200)).body.payTo).toMatchObject({ telebirr: '0911 223344 (Join Debo)', cbe_birr: '', bank: '' });

    const sent = (await pay(b.ownerToken).expect(201)).body;
    expect(sent.status).toBe('waiting');
    const plan = (await own(b.ownerToken).get('/plan').expect(200)).body;
    expect(plan.claims).toEqual([expect.objectContaining({ id: sent.id, status: 'waiting', amount: 19000, method: 'telebirr', transactionId: 'CJK8A1B2C3' })]);

    // Money: Owner and Finance see it; Support does not.
    await as(support).get('/payment-claims').expect(403);
    const list = (await as(finance).get('/payment-claims').expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id: sent.id, business: 'Tana Coffee', amount: 19000, status: 'waiting', balance: 19000 })]);
    expect(list[0].screenshot).toBeUndefined();
    const one = (await as(finance).get(`/payment-claims/${sent.id}`).expect(200)).body;
    expect(one.screenshot).toEqual({ type: 'image/png', data: PNG });

    const ok = (await as(finance).post(`/payment-claims/${sent.id}/approve`).expect(201)).body;
    expect(ok.receiptNo).toMatch(/^TR-\d{8}-01$/);
    await as(finance).post(`/payment-claims/${sent.id}/approve`).expect(409); // once
    expect((await sql`select status from tc.business where id = ${b.id}`)[0].status).toBe('active');
    const [p] = await sql`select method, reference, amount_birr from tc.payment where business_id = ${b.id}`;
    expect(p).toMatchObject({ method: 'telebirr', reference: 'CJK8A1B2C3', amount_birr: 19000 });
    const after = (await own(b.ownerToken).get('/plan').expect(200)).body;
    expect(after).toMatchObject({ billing: 'paid', claims: [expect.objectContaining({ status: 'approved', receiptNo: ok.receiptNo })] });
    expect((await own(b.ownerToken).get('/inbox').expect(200)).body.messages.map((m: { title: string }) => m.title)).toContain('Payment approved');
    const [log] = await sql`select type from tc.audit_log where type = 'payment.claim_approved'`;
    expect(log).toBeDefined();
  });

  it('a rejection needs a reason the owner sees; the same transaction ID cannot be sent twice unless rejected', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    const first = (await pay(b.ownerToken).expect(201)).body;
    await pay(b.ownerToken).expect(409); // already sent
    await pay(b.ownerToken, { transactionId: 'cjk8a1b2c3' }).expect(409); // case does not matter
    await as(owner).post(`/payment-claims/${first.id}/reject`, {}).expect(400);
    await as(owner).post(`/payment-claims/${first.id}/reject`, { reason: 'No money arrived with this ID' }).expect(201);
    const plan = (await own(b.ownerToken).get('/plan').expect(200)).body;
    expect(plan.claims[0]).toMatchObject({ status: 'rejected', reason: 'No money arrived with this ID' });
    expect(plan.billing).toBe('btrial');
    await pay(b.ownerToken).expect(201); // the owner may send it again
  });

  it('checks what the owner sends', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    await pay(b.ownerToken, { screenshot: undefined }).expect(400);
    await pay(b.ownerToken, { screenshot: { type: 'image/png', data: Buffer.from('not an image').toString('base64') } }).expect(400);
    await pay(b.ownerToken, { screenshot: { type: 'image/gif', data: PNG } }).expect(400);
    await pay(b.ownerToken, { screenshot: { type: 'image/png', data: Buffer.alloc(3_200_000, 1).toString('base64') } }).expect(413);
    await pay(b.ownerToken, { transactionId: 'ab' }).expect(400);
    await pay(b.ownerToken, { amount: 0 }).expect(400);
    await pay(b.ownerToken, { method: 'cash' }).expect(400);
    await pay(b.ownerToken, { paidOn: addDays(today(), 2) }).expect(400); // not in the future
    await pay(b.ownerToken, { purpose: 'stand', orderId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    expect((await sql`select count(*)::int as n from tc.payment_claim`)[0].n).toBe(0);
    const pilot = await newBusiness('Free Shop', '962107744', 'pilot');
    await pay(pilot.ownerToken).expect(409); // a pilot has nothing to pay
  });

  it('7 days after an unpaid trial ends the business pauses; an approved payment lifts it', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    const notifier = app.get(Notifier);
    // Ended 3 days ago: still in the grace days.
    await sql`update tc.business set trial_ends_at = now() - interval '3 days' where id = ${b.id}`;
    expect(await notifier.billingDue()).toBe(0);
    expect((await own(b.ownerToken).get('/plan').expect(200)).body.graceEndsOn).toEqual(expect.any(String));
    // Ended 8 days ago: paused.
    await sql`update tc.business set trial_ends_at = now() - interval '8 days' where id = ${b.id}`;
    expect(await notifier.billingDue()).toBe(1);
    expect(await notifier.billingDue()).toBe(0); // once
    expect((await sql`select status, paused_unpaid from tc.business where id = ${b.id}`)[0]).toMatchObject({ status: 'paused', paused_unpaid: true });
    expect((await own(b.ownerToken).get('/inbox').expect(200)).body.messages.map((m: { title: string }) => m.title)).toContain('Your shop is paused');
    const [sms] = await sql`select template from tc.sms_outbox where template = 'unpaid_paused'`;
    expect(sms).toBeDefined();
    // The owner can still pay while paused.
    const sent = (await pay(b.ownerToken).expect(201)).body;
    await as(owner).post(`/payment-claims/${sent.id}/approve`).expect(201);
    expect((await sql`select status, paused_unpaid from tc.business where id = ${b.id}`)[0]).toMatchObject({ status: 'active', paused_unpaid: false });
  });

  it('a part payment does not lift the pause; a business an admin paused is left alone', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    await sql`update tc.business set trial_ends_at = now() - interval '8 days' where id = ${b.id}`;
    await app.get(Notifier).billingDue();
    const part = (await pay(b.ownerToken, { amount: 5000 }).expect(201)).body;
    await as(finance).post(`/payment-claims/${part.id}/approve`).expect(201);
    expect((await sql`select status from tc.business where id = ${b.id}`)[0].status).toBe('paused');

    const c = await newBusiness('Abol Cafe', '962107755');
    await as(owner).post(`/businesses/${c.id}/pause`, { reason: 'Owner asked' }).expect(201);
    const full = (await pay(c.ownerToken, { transactionId: 'ABOL123456' }).expect(201)).body;
    await as(finance).post(`/payment-claims/${full.id}/approve`).expect(201);
    expect((await sql`select status from tc.business where id = ${c.id}`)[0].status).toBe('paused');
  });

  it('an admin extends a trial to a date they pick; a paused trial comes back', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    const until = addDays(today(), 40);
    await as(support).post(`/businesses/${b.id}/trial`, { until }).expect(403);
    await as(finance).post(`/businesses/${b.id}/trial`, { until: today() }).expect(400); // must be later than today
    await as(finance).post(`/businesses/${b.id}/trial`, { until: addDays(today(), 400) }).expect(400); // at most a year
    await as(finance).post(`/businesses/${b.id}/trial`, { until }).expect(201);
    const f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ billing: 'btrial', dueOn: until });
    const [r] = await sql`select to_char(trial_ends_at at time zone 'Africa/Addis_Ababa', 'YYYY-MM-DD HH24:MI') as ends from tc.business where id = ${b.id}`;
    expect(r.ends).toBe(`${addDays(until, 1)} 00:00`); // the whole of that day
    expect((await sql`select type from tc.audit_log where type = 'business.trial_extended'`).length).toBe(1);

    await sql`update tc.business set trial_ends_at = now() - interval '8 days' where id = ${b.id}`;
    await app.get(Notifier).billingDue();
    await as(owner).post(`/businesses/${b.id}/trial`, { until: addDays(today(), 7) }).expect(201);
    expect((await sql`select status, paused_unpaid from tc.business where id = ${b.id}`)[0]).toMatchObject({ status: 'trial', paused_unpaid: false });
    expect(await app.get(Notifier).billingDue()).toBe(0);

    const pilot = await newBusiness('Free Shop', '962107744', 'pilot');
    await as(owner).post(`/businesses/${pilot.id}/trial`, { until }).expect(409);
  });

  it('a stand order is paid the same way; approving marks it paid', async () => {
    const b = await newBusiness('Tana Coffee', '962107733');
    const [br] = await sql`select id from tc.branch where business_id = ${b.id} limit 1`;
    const o = (await own(b.ownerToken).post('/stands/orders', { items: { table: 2 }, branchId: br.id, phone: '0962107733', language: 'en' }).expect(201)).body;
    await pay(b.ownerToken, { purpose: 'stand', orderId: o.id, amount: o.total + 1, transactionId: 'STAND00001' }).expect(400); // the order's total
    const sent = (await pay(b.ownerToken, { purpose: 'stand', orderId: o.id, amount: o.total, transactionId: 'STAND00001' }).expect(201)).body;
    let mine = (await own(b.ownerToken).get(`/stands/orders/${o.id}`).expect(200)).body;
    expect(mine).toMatchObject({ paidAt: null, claims: [expect.objectContaining({ status: 'waiting' })] });
    const list = (await as(finance).get('/payment-claims').expect(200)).body;
    expect(list[0]).toMatchObject({ purpose: 'stand', orderCode: o.code });
    await as(finance).post(`/payment-claims/${sent.id}/approve`).expect(201);
    mine = (await own(b.ownerToken).get(`/stands/orders/${o.id}`).expect(200)).body;
    expect(mine.paidAt).not.toBeNull();
    await pay(b.ownerToken, { purpose: 'stand', orderId: o.id, amount: o.total, transactionId: 'STAND00002' }).expect(409); // already paid
    // The plan is untouched by a stand payment.
    expect((await own(b.ownerToken).get('/plan').expect(200)).body).toMatchObject({ paid: 0, billing: 'btrial' });
  });
});
