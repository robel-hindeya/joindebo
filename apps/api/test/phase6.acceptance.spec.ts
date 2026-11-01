/**
 * Phase 6 acceptance (build plan, section 7) and the message flows: admin
 * messages to owners with opens and "send again", the owner inbox and "my
 * requests", shop news with its weekly limit and opt-out, customer
 * notifications and preferences, quiet hours and SMS in three languages.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { quietUntil } from '../src/sms/sms';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 6 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  let admin: string;

  async function signIn(email: string): Promise<string> {
    const login = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
    const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
    return (await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.body.ticket, code: totp(start.body.secret) }).expect(200)).body.accessToken;
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  async function ownerToken(phone: string) {
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: phone.slice(4), pin: GOOD_PIN });
    return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) })).body.accessToken as string;
  }
  const own = (token: string) => ({
    get: (p: string) => api().get('/api/v1/owner' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/owner' + p).auth(token, { type: 'bearer' }).send(body),
  });
  async function customer(phone: string, language = 'en') {
    const r = await api().post('/api/v1/auth/customer/join').send({ phone, pin: GOOD_PIN, language, consent: true, shopCode: 'MOKA01' });
    return r.body.accessToken as string;
  }
  const cust = (token: string) => ({
    get: (p: string) => api().get('/api/v1/customer' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/customer' + p).auth(token, { type: 'bearer' }).send(body),
  });

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    await createAdmin(sql, { email: 'owner1@temelash.et', name: 'Truman', role: 'owner', password: PASSWORD });
    admin = await signIn('owner1@temelash.et');
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  // ---------------------------------------------------------------- acceptance 1
  it('1. a message to "payment due" reaches exactly the businesses with a balance', async () => {
    // Sheba Salon pays its whole Starter fee; Moka House (Full) owes.
    await as(admin).post(`/businesses/${w.bizB}/payments`, { amount: 19000, method: 'cash' }).expect(201);
    const m = (await as(admin).post('/messages', { audience: 'due', title: 'Payment reminder', body: 'Your Temelash Card payment is due. Please pay by Telebirr.' }).expect(201)).body;
    expect(m.recipients).toBe(1);
    const moka = await ownerToken(w.owner.phone);
    const sheba = await ownerToken(w.ownerB.phone);
    expect((await own(moka).get('/inbox').expect(200)).body.messages.map((x: { title: string }) => x.title)).toContain('Payment reminder');
    expect((await own(sheba).get('/inbox').expect(200)).body.messages.map((x: { title: string }) => x.title)).not.toContain('Payment reminder');
  });

  // ---------------------------------------------------------------- acceptance 2
  it('2. the opened count updates when the owner reads it; "send again" goes to those who did not open, by text too', async () => {
    const m = (await as(admin).post('/messages', { audience: 'all', title: 'Next year payments open on Ginbot 1', body: 'From Ginbot 1 you can pay for the next year.' }).expect(201)).body;
    expect(m.recipients).toBe(2);
    const moka = await ownerToken(w.owner.phone);
    let inbox = (await own(moka).get('/inbox').expect(200)).body;
    expect(inbox.unread).toBe(1);
    await own(moka).get(`/inbox/${m.id}`).expect(200);
    inbox = (await own(moka).get('/inbox').expect(200)).body;
    expect(inbox.unread).toBe(0);
    const list = (await as(admin).get('/messages').expect(200)).body;
    expect(list[0]).toMatchObject({ id: m.id, recipients: 2, opened: 1 });
    const again = (await as(admin).post(`/messages/${m.id}/again`).expect(201)).body;
    expect(again.recipients).toBe(1);
    const texts = await sql`select phone from tc.sms_outbox where template = 'admin_message'`;
    expect(texts.map((t) => t.phone)).toEqual([w.ownerB.phone]);
  });

  // ---------------------------------------------------------------- acceptance 3
  it('3. a customer who opted out never receives news', async () => {
    const a = await customer('912400001');
    const b = await customer('912400002');
    await cust(b).post('/prefs', { offer: false }).expect(201);
    const moka = await ownerToken(w.owner.phone);
    const sent = (await own(moka).post('/news', { audience: 'all', texts: { en: { title: 'Coffee week', body: 'Two stamps for every macchiato this week.' } } }).expect(201)).body;
    expect(sent.recipients).toBe(1);
    expect((await cust(a).get('/notifications').expect(200)).body.map((n: { type: string }) => n.type)).toContain('news');
    expect((await cust(b).get('/notifications').expect(200)).body.map((n: { type: string }) => n.type)).not.toContain('news');
  });

  // ---------------------------------------------------------------- the rest
  it('news: two a week at most, English required, other languages fall back, managers cannot send', async () => {
    await customer('912400003', 'am');
    const moka = await ownerToken(w.owner.phone);
    await own(moka).post('/news', { audience: 'all', texts: { am: { title: 'x', body: 'y' } } }).expect(400);
    await own(moka).post('/news', { audience: 'all', texts: { en: { title: 'A', body: 'a'.repeat(141) } } }).expect(400);
    let n = (await own(moka).get('/news').expect(200)).body;
    expect(n).toMatchObject({ left: 2, perWeek: 2, audience: { all: 1, near: 0, quiet: 0 } });
    await own(moka).post('/news', { audience: 'all', texts: { en: { title: 'One', body: 'First news.' }, am: { title: 'አንድ', body: 'የመጀመሪያ ዜና።' } } }).expect(201);
    await own(moka).post('/news', { audience: 'all', texts: { en: { title: 'Two', body: 'Second news.' } } }).expect(201);
    await own(moka).post('/news', { audience: 'all', texts: { en: { title: 'Three', body: 'Third news.' } } }).expect(429);
    n = (await own(moka).get('/news').expect(200)).body;
    expect(n.left).toBe(0);
    expect(n.past.map((x: { texts: { en: { title: string } } }) => x.texts.en.title)).toEqual(['Two', 'One']);
    const mgr = await ownerToken(w.manager.phone);
    await own(mgr).post('/news', { audience: 'all', texts: { en: { title: 'M', body: 'm' } } }).expect(403);
  });

  it('owner inbox: one business, receipts and approvals land there; "my requests" shows live status', async () => {
    const moka = await ownerToken(w.owner.phone);
    await as(admin).post(`/businesses/${w.bizA}/message`, { title: 'Verification needed', body: 'Please call us today.', sms: true }).expect(201);
    const pay = (await as(admin).post(`/businesses/${w.bizA}/payments`, { amount: 5000, method: 'telebirr' }).expect(201)).body;
    await as(admin).post(`/payments/${pay.id}/send`).expect(201);
    const inbox = (await own(moka).get('/inbox').expect(200)).body;
    expect(inbox.messages.map((x: { title: string }) => x.title)).toEqual([expect.stringContaining(pay.receiptNo), 'Verification needed']);
    expect(inbox.messages[0]).toMatchObject({ action: 'plan' });
    expect(await sql`select 1 from tc.sms_outbox where template = 'admin_message' and phone = ${w.owner.phone}`).toHaveLength(1);
    await sql`insert into tc.request (type, business_id, stage, payload) values ('flag', ${w.bizA}, 'new', '{}'), ('closing', ${w.bizA}, 'new', '{}')`;
    const reqs = (await own(moka).get('/requests').expect(200)).body;
    // Flags are Temelash's own; the owner sees what they asked for.
    expect(reqs.map((r: { type: string; status: string }) => `${r.type}:${r.status}`)).toEqual(['closing:waiting']);
  });

  it('customer notifications: preferences hide stamp news but never card notices; reading marks them', async () => {
    const t = await customer('912400004');
    const card = (await cust(t).get('/cards').expect(200)).body[0];
    await cust(t).post('/prefs', { stamp: false }).expect(201);
    expect((await cust(t).get('/prefs').expect(200)).body).toMatchObject({ stamp: false, near: true, exp: true, offer: true });
    const staff = (await api().post('/api/v1/auth/staff/signin').send({ phone: w.staff.phone.slice(4), pin: GOOD_PIN })).body.accessToken;
    const { cardCode, minuteOf } = await import('@temelash/codes');
    const code = await cardCode(card.qr.secret, 'MOKA01', card.qr.short, minuteOf(Date.now()));
    await api().post('/api/v1/staff/stamps').auth(staff, { type: 'bearer' }).send({ code: code.qr, idempotencyKey: 'k-' + Date.now() }).expect(201);
    await sql`update tc.card set status = 'active' where id = ${card.id}`;
    await sql`insert into tc.notification (customer_id, card_id, type, data) select customer_id, id, 'card_paused', '{}' from tc.card where id = ${card.id}`;
    const list = (await cust(t).get('/notifications').expect(200)).body;
    expect(list.map((n: { type: string }) => n.type)).toEqual(['card_paused']);
    await cust(t).post('/notifications/read', {}).expect(201);
    expect((await cust(t).get('/notifications').expect(200)).body.every((n: { readAt: string | null }) => !!n.readAt)).toBe(true);
  });

  it('a reward about to run out is announced once', async () => {
    const t = await customer('912400005');
    const card = (await cust(t).get('/cards').expect(200)).body[0];
    await sql`insert into tc.reward (card_id, tier, code_hash, expires_at) values (${card.id}, 1, 'h', now() + interval '2 days')`;
    const notifier = app.get((await import('../src/notify/notifier')).Notifier);
    await notifier.rewardsEndingSoon();
    await notifier.rewardsEndingSoon();
    const list = (await cust(t).get('/notifications').expect(200)).body.filter((n: { type: string }) => n.type === 'reward_expiring');
    expect(list).toHaveLength(1);
  });

  it('quiet hours hold texts until 07:00 East Africa Time; codes are sent in the customer\'s language', async () => {
    // 22:30 EAT = 19:30 UTC → 07:00 EAT next day = 04:00 UTC.
    expect(quietUntil(new Date('2026-11-01T19:30:00Z'), 21, 7)?.toISOString()).toBe('2026-11-02T04:00:00.000Z');
    expect(quietUntil(new Date('2026-11-01T09:00:00Z'), 21, 7)).toBeNull(); // 12:00 EAT
    await api().post('/api/v1/auth/customer/join').send({ phone: '912400006', pin: GOOD_PIN, language: 'am', consent: true, shopCode: 'MOKA01' });
    await api().post('/api/v1/auth/customer/reset').send({ phone: '912400006' });
    const [sms] = await sql`select language, body from tc.sms_outbox where phone = '+251912400006' order by created_at desc limit 1`;
    expect(sms.language).toBe('am');
    expect(sms.body).not.toMatch(/Temelash Card code/);
  });

  it('the SMS report counts messages and cost by month', async () => {
    await sql`insert into tc.sms_outbox (phone, template, body, status, cost_birr, sent_at) values ('+251911000001', 'owner_signin', 'x', 'delivered', 0.15, now()), ('+251911000002', 'admin_message', 'y', 'failed', null, now())`;
    const r = (await as(admin).get('/sms/report').expect(200)).body;
    expect(r.months[0]).toMatchObject({ delivered: 1, failed: 1, costBirr: 0.15 });
  });
});
