/**
 * Phase 8e (build plan, section 7): support tools on a business. Follow-ups,
 * the read-only owner view (logged), editing details, closing a branch and
 * merging a duplicate. Acceptance: merging two shops leaves one set of
 * customers with no duplicate cards.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { cardCount } from '../src/stamps/cards';
import { GOOD_PIN, createTestApp, describeDb, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 8e: support tools', () => {
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
  const join = async (phone: string, shop: string) => (await api().post('/api/v1/auth/customer/join').send({ phone, pin: GOOD_PIN, language: 'en', consent: true, shopCode: shop }).expect(201)).body.accessToken as string;
  const addShop = async (token: string, shop: string) => api().post('/api/v1/customer/cards').auth(token, { type: 'bearer' }).send({ shopCode: shop }).expect(201);
  const stamps = async (cardId: string, n: number) => { for (let i = 0; i < n; i++) await sql`insert into tc.stamp (card_id, method, reason) values (${cardId}, 'fix', 'test')`; };
  const liveCard = async (phone: string, biz: string) => sql<{ id: string }[]>`
    select c.id from tc.card c join tc.customer u on u.id = c.customer_id where u.phone = ${phone} and c.business_id = ${biz} and c.status in ('active', 'paused')`;

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

  it('acceptance: merging a duplicate leaves one set of customers with no duplicate cards; stamp counts add up', async () => {
    const [{ id: dup }] = await sql`insert into tc.business (name, category, city, status, plan, shop_code) values ('Moka House Piassa', 'cafe', 'Addis Ababa', 'active', 'starter', 'MOKA99') returning id`;
    await sql`insert into tc.rule_set (business_id, version, stamps_needed, ladder) values (${dup}, 1, 8, ${sql.json([{ tier: 1, at: 8, reward: 'Free macchiato' }])})`;
    await sql`insert into tc.branch (business_id, name) values (${dup}, 'Piassa')`;
    const both = await join('913700001', 'MOKA01');
    await addShop(both, 'MOKA99');
    await join('913700002', 'MOKA99');
    await stamps((await liveCard('+251913700001', w.bizA))[0].id, 1);
    await stamps((await liveCard('+251913700001', dup))[0].id, 2);
    await stamps((await liveCard('+251913700002', dup))[0].id, 3);

    const preview = (await as(admin).get(`/businesses/${w.bizA}/merge-preview?from=${dup}`).expect(200)).body;
    expect(preview).toMatchObject({ customers: 2, both: 1 });
    await as(admin).post(`/businesses/${w.bizA}/merge`, { from: w.bizA }).expect(400);
    await as(admin).post(`/businesses/${w.bizA}/merge`, { from: dup }).expect(201);

    for (const [phone, n] of [['+251913700001', 3], ['+251913700002', 3]] as const) {
      const live = await liveCard(phone, w.bizA);
      expect(live.length).toBe(1);
      expect(await cardCount(sql, live[0].id)).toBe(n);
      expect((await liveCard(phone, dup)).length).toBe(0);
    }
    const dupes = await sql`select customer_id from tc.card where business_id = ${w.bizA} and status in ('active', 'paused') group by customer_id having count(*) > 1`;
    expect(dupes).toEqual([]);
    expect((await sql`select status, merged_into from tc.business where id = ${dup}`)[0]).toEqual({ status: 'closed', merged_into: w.bizA });
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'business.merged'`)[0].n).toBe(1);
  });

  it('follow-ups: add with a date and a person, they show on Overview when due, and can be finished', async () => {
    const team = (await as(admin).get('/team').expect(200)).body;
    await as(admin).post(`/businesses/${w.bizA}/follow-ups`, { text: 'Call back after 4 pm', when: 'today', assigneeId: team[0].id }).expect(201);
    await as(admin).post(`/businesses/${w.bizA}/follow-ups`, { text: 'Ask about a fourth branch', when: 'week', assigneeId: team[0].id }).expect(201);
    const list = (await as(admin).get(`/businesses/${w.bizA}/follow-ups`).expect(200)).body;
    expect(list.length).toBe(2);
    const due = (await as(admin).get('/follow-ups?due=1').expect(200)).body;
    expect(due.map((f: { text: string }) => f.text)).toEqual(['Call back after 4 pm']);
    await as(admin).post(`/follow-ups/${due[0].id}/done`).expect(201);
    expect((await as(admin).get('/follow-ups?due=1').expect(200)).body).toEqual([]);
  });

  it('see what the owner sees: read only, and every look is logged', async () => {
    const v = (await as(admin).get(`/businesses/${w.bizA}/owner-view`).expect(200)).body;
    expect(v).toMatchObject({ customers: expect.any(Number), stamps30: expect.any(Number), team: expect.any(Number), branches: 2 });
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'admin.viewed_as_owner'`)[0].n).toBe(1);
  });

  it('edit details and close one branch (never the last), both logged', async () => {
    await as(admin).post(`/businesses/${w.bizA}/details`, { name: 'Moka House Cafe', category: 'cafe', city: 'Addis Ababa', owner: 'Abebe K.' }).expect(201);
    expect((await sql`select name from tc.business where id = ${w.bizA}`)[0].name).toBe('Moka House Cafe');
    expect((await sql`select name from tc.person where id = ${w.owner.id}`)[0].name).toBe('Abebe K.');
    await as(admin).post(`/businesses/${w.bizA}/details`, { name: '', category: 'cafe', city: 'x', owner: 'y' }).expect(400);
    await as(admin).post(`/branches/${w.branchA2}/close`).expect(201);
    await as(admin).post(`/branches/${w.branchA1}/close`).expect(409);
    expect((await sql`select count(*)::int as n from tc.audit_log where type in ('business.details', 'branch.closed')`)[0].n).toBe(2);
  });
});
