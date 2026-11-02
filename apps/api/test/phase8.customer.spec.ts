/**
 * Phase 8d (build plan, section 7): customer account deletion with a 30-day
 * window, the customer's own data export, the privacy switches, and the
 * retention schedule for short-lived data.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { Notifier } from '../src/notify/notifier';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

describeDb('Phase 8d: customer data', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  const join = (phone: string) => api().post('/api/v1/auth/customer/join').send({ phone, pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' });
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
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('deleting the account signs out at once and erases the phone after 30 days; stamps stay without a name', async () => {
    const t = (await join('913600001').expect(201)).body.accessToken;
    const card = (await cust(t).get('/cards').expect(200)).body[0];
    await sql`insert into tc.stamp (card_id, branch_id, person_id, method) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan')`;
    await cust(t).post('/account/delete', { pin: '000000' }).expect(401);
    await cust(t).post('/account/delete', { pin: GOOD_PIN }).expect(201);
    await cust(t).get('/cards').expect(401);
    await api().post('/api/v1/auth/customer/signin').send({ phone: '913600001', pin: GOOD_PIN }).expect(401);
    expect((await sql`select status from tc.customer where phone = '+251913600001'`)[0].status).toBe('deleting');

    const notifier = app.get(Notifier);
    expect((await notifier.retention(new Date(Date.now() + 29 * 86_400_000))).customers).toBe(0);
    expect((await notifier.retention(new Date(Date.now() + 31 * 86_400_000))).customers).toBe(1);
    expect((await sql`select count(*)::int as n from tc.customer where phone = '+251913600001'`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from tc.stamp where card_id = ${card.id}`)[0].n).toBe(1);
    // The number is free again.
    await join('913600001').expect(201);
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'customer.delete_requested'`)[0].n).toBe(1);
  });

  it('"Download my data" returns the customer\'s own data and is logged', async () => {
    const t = (await join('913600002').expect(201)).body.accessToken;
    const d = (await cust(t).get('/export').expect(200)).body;
    expect(d.account).toMatchObject({ phone: '+251913600002', language: 'en' });
    expect(d.cards).toEqual([expect.objectContaining({ shop: 'Moka House', stamps: 0 })]);
    expect(d.notifications).toBeDefined();
    expect(d.preferences).toMatchObject({ notifications: expect.any(Object), privacy: { share: true, pers: false } });
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'customer.export'`)[0].n).toBe(1);
  });

  it('"Share my visit activity" off hides visit dates from the shop', async () => {
    const t = (await join('913600003').expect(201)).body.accessToken;
    const card = (await cust(t).get('/cards').expect(200)).body[0];
    await sql`insert into tc.stamp (card_id, branch_id, person_id, method) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan')`;
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: w.owner.phone.slice(4), pin: GOOD_PIN });
    const owner = (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, w.owner.phone) })).body.accessToken;
    const list = async () => (await api().get('/api/v1/owner/customers').auth(owner, { type: 'bearer' }).expect(200)).body[0];
    expect((await list()).lastVisit).not.toBeNull();
    expect((await cust(t).get('/privacy').expect(200)).body).toEqual({ share: true, pers: false });
    await cust(t).post('/privacy', { share: false }).expect(201);
    expect((await list()).lastVisit).toBeNull();
    expect((await list()).stamps).toBe(1);
  });

  it('retention clears old codes, message bodies and dead sessions; append-only records stay', async () => {
    await join('913600004').expect(201);
    await sql`insert into tc.otp_code (phone, purpose, code_hash, expires_at, created_at) values ('+251913600004', 'customer_reset', 'x', now() - interval '3 days', now() - interval '3 days')`;
    await sql`insert into tc.sms_outbox (phone, template, body, created_at) values ('+251913600004', 'code', 'secret text', now() - interval '100 days')`;
    const r = await app.get(Notifier).retention(new Date());
    expect(r.otp).toBeGreaterThan(0);
    expect(r.sms).toBe(1);
    expect((await sql`select body from tc.sms_outbox where created_at < now() - interval '90 days'`)[0].body).toBe('');
    expect((await sql`select count(*)::int as n from tc.audit_log`)[0].n).toBeGreaterThan(0);
  });
});
