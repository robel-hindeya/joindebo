/**
 * Phase 8a (build plan, section 7): unusual-activity flags with editable
 * limits, flag requests and owner alerts. Acceptance: a script that stamps 100
 * times in an hour from one phone raises a flag within one minute.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { cardCode, minuteOf } from '@temelash/codes';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { ensureCardKeys } from '../src/stamps/cards';
import { Notifier } from '../src/notify/notifier';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 8a: flags and owner alerts', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  let admin: string;
  let owner: string;
  let staff: string;

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
    return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) })).body.accessToken as string;
  }
  const own = (token: string) => ({
    get: (p: string) => api().get('/api/v1/owner' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/owner' + p).auth(token, { type: 'bearer' }).send(body),
  });
  const setting = (key: string, value: number) => sql`update tc.setting set value = ${sql.json(value)} where key = ${key}`;
  const flags = (kind?: string) => sql<{ id: string; payload: Record<string, unknown>; created_at: Date }[]>`
    select id, payload, created_at from tc.request where type = 'flag' and (${kind ?? ''} = '' or payload->>'kind' = ${kind ?? ''}) order by created_at`;
  const inboxTitles = async () => (await own(owner).get('/inbox').expect(200)).body.messages.map((m: { title: string }) => m.title) as string[];

  /** n Moka House customers with ready cards, made directly (not through join, which has its own flag). */
  async function cards(n: number) {
    const [{ id: rule }] = await sql`select id from tc.rule_set where business_id = ${w.bizA} order by version desc limit 1`;
    const out: Array<{ id: string; short: string; secret: string }> = [];
    for (let i = 0; i < n; i++) {
      const [c] = await sql`insert into tc.customer (phone, language) values (${`+2519140${String(i).padStart(5, '0')}`}, 'en') returning id`;
      const [card] = await sql<{ id: string; business_id: string; short_code: string | null }[]>`
        insert into tc.card (customer_id, business_id, rule_set_id) values (${c.id}, ${w.bizA}, ${rule}) returning id, business_id, short_code`;
      await ensureCardKeys(sql, card);
      const [k] = await sql<{ short_code: string; qr_secret: string }[]>`select short_code, qr_secret from tc.card where id = ${card.id}`;
      out.push({ id: card.id, short: k.short_code, secret: k.qr_secret });
    }
    return out;
  }
  const stamp = async (c: { short: string; secret: string }, typed = false) => {
    const code = await cardCode(c.secret, 'MOKA01', c.short, minuteOf(Date.now()));
    return api().post('/api/v1/staff/stamps').auth(staff, { type: 'bearer' }).send({ code: typed ? code.typed : code.qr, idempotencyKey: randomUUID() });
  };

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
    staff = (await api().post('/api/v1/auth/staff/signin').send({ phone: w.staff.phone.slice(4), pin: GOOD_PIN })).body.accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('acceptance: 100 stamps in an hour from one phone raise one flag within a minute, and the owner is told', async () => {
    const cs = await cards(100);
    let crossedAt = 0;
    for (const [i, c] of cs.entries()) {
      expect((await stamp(c)).status).toBe(201);
      if (i === 60) crossedAt = Date.now();
    }
    const f = await flags('stamps_per_hour');
    expect(f.length).toBe(1);
    expect(f[0].created_at.getTime() - crossedAt).toBeLessThan(60_000);
    expect(f[0].payload).toMatchObject({ kind: 'stamps_per_hour', personId: w.staff.id, limit: 60 });
    expect(Number(f[0].payload.stamps)).toBeGreaterThan(60);
    expect((await inboxTitles()).filter((t) => t === 'Unusual activity').length).toBe(1);
  });

  it('a week with too many stamps typed by hand raises one flag for the shop', async () => {
    await setting('flags.hand_typed_share_pct', 50);
    await setting('flags.hand_typed_min_stamps', 4);
    await sql`insert into tc.rule_set (business_id, version, stamps_needed, ladder, hand_typed)
      select business_id, version + 1, stamps_needed, ladder, 'allow' from tc.rule_set where business_id = ${w.bizA} order by version desc limit 1`;
    const cs = await cards(6);
    await stamp(cs[0]);
    for (const c of cs.slice(1, 4)) expect((await stamp(c, true)).status).toBe(201);
    expect((await flags('hand_typed_share')).length).toBe(1);
    await stamp(cs[4], true);
    expect((await flags('hand_typed_share')).length).toBe(1);
    expect((await flags('hand_typed_share'))[0].payload).toMatchObject({ kind: 'hand_typed_share', limit: 50 });
  });

  it('too many new cards in one hour in one shop raise one flag', async () => {
    await setting('flags.new_cards_per_hour', 2);
    for (const p of ['913300001', '913300002', '913300003', '913300004']) {
      await api().post('/api/v1/auth/customer/join').send({ phone: p, pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201);
    }
    const f = await flags('new_cards_per_hour');
    expect(f.length).toBe(1);
    expect(f[0].payload).toMatchObject({ kind: 'new_cards_per_hour', limit: 2, cards: 3 });
  });

  it('the limits are edited in Admin settings by an Owner and logged', async () => {
    const s = (await as(admin).get('/settings').expect(200)).body as Array<{ key: string; value: unknown }>;
    expect(s.find((x) => x.key === 'flags.new_cards_per_hour')?.value).toBe(25);
    expect(s.find((x) => x.key === 'flags.hand_typed_share_pct')?.value).toBe(30);
    await as(admin).post('/settings', { key: 'flags.new_cards_per_hour', value: 40 }).expect(201);
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'setting.changed' and detail->>'key' = 'flags.new_cards_per_hour'`)[0].n).toBe(1);
  });

  it('owners see the alert on Today, can open and dismiss it; Temelash still sees it open', async () => {
    await setting('flags.stamps_per_hour', 2);
    for (const c of await cards(3)) await stamp(c);
    const [f] = await flags();
    const today = (await own(owner).get('/today').expect(200)).body;
    expect(today.attention.unusual).toEqual([expect.objectContaining({ id: f.id, kind: 'stamps_per_hour', staff: `staff ${w.staff.phone.slice(-4)}` })]);
    const one = (await own(owner).get(`/alerts/${f.id}`).expect(200)).body;
    expect(one).toMatchObject({ kind: 'stamps_per_hour', stamps: 3, phones: 3 });
    await own(owner).post(`/alerts/${f.id}/dismiss`).expect(201);
    expect((await own(owner).get('/today').expect(200)).body.attention.unusual).toEqual([]);
    expect((await as(admin).get('/requests?type=flag').expect(200)).body.length).toBe(1);
    const sheba = await personToken(w.ownerB.phone);
    await own(sheba).get(`/alerts/${f.id}`).expect(404);
  });

  it('alert settings: unusual off means no message; SMS sends a text; a lock-out tells the owner', async () => {
    const prefs = (await own(owner).get('/alert-prefs').expect(200)).body;
    expect(prefs).toEqual({ approve: true, unusual: true, locked: true, phone: false, daily: true, weekly: false, how: 'push', time: 21 });
    await own(owner).post('/alert-prefs', { ...prefs, unusual: false }).expect(201);
    await setting('flags.stamps_per_hour', 1);
    for (const c of await cards(2)) await stamp(c);
    expect(await inboxTitles()).not.toContain('Unusual activity');

    await own(owner).post('/alert-prefs', { ...prefs, how: 'sms', time: 25 }).expect(400);
    await own(owner).post('/alert-prefs', { ...prefs, how: 'sms' }).expect(201);
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/staff/signin').send({ phone: w.staff.phone.slice(4), pin: '000000' });
    const [sms] = await sql`select body from tc.sms_outbox where phone = ${w.owner.phone} and template = 'owner_alert' order by created_at desc limit 1`;
    expect(sms.body).toContain(`staff ${w.staff.phone.slice(-4)}`);
    expect(await inboxTitles()).toContain('A cashier is locked out');
  });

  it('the daily summary goes once a day at the chosen hour', async () => {
    const notifier = app.get(Notifier);
    for (const c of await cards(2)) await stamp(c);
    const at21 = new Date(Date.UTC(2026, 10, 1, 18, 5));
    // Both seeded owners keep the default 21:00.
    expect(await notifier.ownerSummaries(at21)).toBe(2);
    expect(await notifier.ownerSummaries(new Date(at21.getTime() + 600_000))).toBe(0);
    const titles = await inboxTitles();
    expect(titles.some((t) => t.startsWith('Today at Moka House'))).toBe(true);
    // The next day Moka's owner moved theirs to 22:00, so at 21:00 only Sheba's owner gets one.
    await sql`update tc.person set alert_prefs = alert_prefs || '{"time": 22}' where id = ${w.owner.id}`;
    expect(await notifier.ownerSummaries(new Date(Date.UTC(2026, 10, 2, 18, 5)))).toBe(1);
  });
});
