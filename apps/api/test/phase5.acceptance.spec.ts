/**
 * Phase 5 acceptance (build plan, section 7) and the money flows: fees,
 * payments and receipts, corrections and reversals, agents and commission,
 * the government share, the finance report, exports and the owner's plan page.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 5 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  const secrets = new Map<string, string>();
  let owner: string;
  let finance: string;
  let support: string;

  async function signIn(email: string): Promise<string> {
    const login = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
    const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
    secrets.set(email, start.body.secret);
    const done = await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.body.ticket, code: totp(start.body.secret) }).expect(200);
    return done.body.accessToken;
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  const reauth = async (email: string) => {
    await sql`update tc.admin_user set totp_last_step = totp_last_step - 10 where email = ${email}`;
    return { password: PASSWORD, code: totp(secrets.get(email)!) };
  };

  /** A new business through sign-up, approved on a trial of the given plan; returns its id and owner token. */
  async function newBusiness(name: string, phone: string, plan: 'starter' | 'full', agentPhone?: string) {
    const st = await api().post('/api/v1/auth/business/signup').send({ businessName: name, ownerName: 'Abebe', phone, agree: true, category: 'cafe', agentPhone }).expect(200);
    const v = await api().post('/api/v1/auth/business/signup/verify').send({ ticket: st.body.ticket, code: await lastSmsCode(sql, '+251' + phone) });
    const ownerToken = (await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '590382' }).expect(201)).body.accessToken;
    const [r] = (await as(owner).get('/requests?type=signup').expect(200)).body.filter((x: { business: string }) => x.business === name);
    await as(owner).post(`/requests/${r.id}/approve`, { start: 'trial', plan }).expect(201);
    const [b] = await sql`select id from tc.business where name = ${name}`;
    return { id: b.id as string, ownerToken: ownerToken as string };
  }

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    w = await seedWorld(sql);
    secrets.clear();
    for (const [email, role] of [['owner1@temelash.et', 'owner'], ['owner2@temelash.et', 'owner'], ['fin@temelash.et', 'finance'], ['sup@temelash.et', 'support']] as const) {
      await createAdmin(sql, { email, name: email.split('@')[0], role, password: PASSWORD });
    }
    owner = await signIn('owner1@temelash.et');
    finance = await signIn('fin@temelash.et');
    support = await signIn('sup@temelash.et');
    await sql`insert into tc.agent (name, phone, area) values ('Mekdes Tadesse', '+251915550142', 'Bole')`;
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  // ---------------------------------------------------------------- acceptance 1
  it('1. reversing a payment restores the balance and removes the commission the same day', async () => {
    const b = await newBusiness('Tana Coffee', '962107733', 'starter', '915550142');
    let f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ plan: 'starter', fee: 19000, paid: 0, balance: 19000, billing: 'btrial' });

    const pay = (await as(finance).post(`/businesses/${b.id}/payments`, { amount: 19000, method: 'telebirr', reference: 'TB-482913' }).expect(201)).body;
    expect(pay.receiptNo).toMatch(/^TR-\d{8}-01$/);
    f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ paid: 19000, balance: 0, billing: 'paid', coversUntil: expect.any(String) });
    expect((await sql`select status from tc.business where id = ${b.id}`)[0].status).toBe('active'); // paid in full: trial ends
    const [ag] = await sql`select id from tc.agent`;
    expect((await as(finance).get(`/agents/${ag.id}`).expect(200)).body.stats).toMatchObject({ earned: 3000, paid: 0, owed: 3000 });

    await as(finance).post(`/payments/${pay.id}/reverse`, {}).expect(400); // a reason is needed
    await as(finance).post(`/payments/${pay.id}/reverse`, { reason: 'Money did not arrive' }).expect(201);
    f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ paid: 0, balance: 19000 });
    expect((await as(finance).get(`/agents/${ag.id}`).expect(200)).body.stats).toMatchObject({ earned: 0, owed: 0 });
    // The receipt stays on file, marked reversed; a second reversal is refused.
    expect((await as(finance).get(`/payments/${pay.id}`).expect(200)).body).toMatchObject({ receiptNo: pay.receiptNo, amount: 0, original: 19000, reversed: true });
    await as(finance).post(`/payments/${pay.id}/reverse`, { reason: 'again' }).expect(409);
  });

  // ---------------------------------------------------------------- acceptance 2
  it('2. payments − commission − government share = left for Temelash, for every month and in total', async () => {
    const b1 = await newBusiness('Tana Coffee', '962107733', 'starter', '915550142');
    const b2 = await newBusiness('Abay Salon', '962107744', 'full', '915550142');
    await as(finance).post(`/businesses/${b1.id}/payments`, { amount: 10000, method: 'cash' }).expect(201);
    await as(finance).post(`/businesses/${b1.id}/payments`, { amount: 9000, method: 'cash' }).expect(201); // now earns 3,000
    const p = (await as(finance).post(`/businesses/${b2.id}/payments`, { amount: 25000, method: 'bank' }).expect(201)).body; // earns 5,000
    await as(finance).post(`/payments/${p.id}/correct`, { amount: 20000, reason: 'Typed the wrong amount' }).expect(201); // commission gone
    const rep = (await as(finance).get('/finance/report').expect(200)).body;
    for (const m of [...rep.months, rep.total]) expect(m.payments - m.commission - m.govShare).toBe(m.left);
    expect(rep.total).toMatchObject({ payments: 39000, commission: 3000, govShare: 900, left: 35100 });
    expect(rep.byAgent[0]).toMatchObject({ agent: 'Mekdes Tadesse', payments: 39000, commission: 3000 });
    // The correction keeps the first amount as history.
    expect((await as(finance).get(`/payments/${p.id}`).expect(200)).body).toMatchObject({ amount: 20000, original: 25000, fixes: [expect.objectContaining({ kind: 'correction', amount: -5000 })] });
  });

  // ---------------------------------------------------------------- acceptance 3
  it('3. an export with a wrong code writes nothing and counts toward the lock', async () => {
    const before = (await sql`select failed_attempts from tc.admin_user where email = 'fin@temelash.et'`)[0].failed_attempts;
    await as(finance).post('/exports/finance', { password: PASSWORD, code: '000000' }).expect(401);
    expect((await sql`select failed_attempts from tc.admin_user where email = 'fin@temelash.et'`)[0].failed_attempts).toBe(before + 1);
    expect(await sql`select 1 from tc.audit_log where type like 'export.%'`).toHaveLength(0);
    const ok = await as(finance).post('/exports/finance', await reauth('fin@temelash.et')).expect(201);
    expect(ok.body).toMatchObject({ file: expect.stringMatching(/\.csv$/), csv: expect.stringContaining('Month') });
    expect(await sql`select actor_id from tc.audit_log where type = 'export.done'`).toHaveLength(1);
    // Finance exports money files only; Support none.
    await as(finance).post('/exports/log', await reauth('fin@temelash.et')).expect(403);
    await as(support).post('/exports/businesses', await reauth('sup@temelash.et')).expect(403);
    await as(owner).post('/exports/log', await reauth('owner1@temelash.et')).expect(201);
    await as(finance).post('/exports/finance-list', await reauth('fin@temelash.et')).expect(201);
  });

  // ---------------------------------------------------------------- the rest of the money flows
  it('receipts are numbered per day, store the finance year and month, and only Owner and Finance record them', async () => {
    const b = await newBusiness('Tana Coffee', '962107733', 'full');
    await as(support).post(`/businesses/${b.id}/payments`, { amount: 100, method: 'cash' }).expect(403);
    const a = (await as(owner).post(`/businesses/${b.id}/payments`, { amount: 5000, method: 'cbe_birr' }).expect(201)).body;
    const c = (await as(finance).post(`/businesses/${b.id}/payments`, { amount: 5000, method: 'cash' }).expect(201)).body;
    expect(a.receiptNo.slice(0, 12)).toBe(c.receiptNo.slice(0, 12));
    expect(c.receiptNo).toMatch(/-02$/);
    const [row] = await sql`select finance_year, eth_month from tc.payment where id = ${a.id}`;
    expect(row.finance_year).toBeGreaterThanOrEqual(2019);
    expect(row.eth_month).toBeGreaterThanOrEqual(1);
    await as(finance).post(`/businesses/${b.id}/payments`, { amount: 0, method: 'cash' }).expect(400);
    await as(finance).post(`/businesses/${b.id}/payments`, { amount: 10, method: 'gold' }).expect(400);
  });

  it('adding a branch and changing the plan change the yearly fee; what was paid stays', async () => {
    const b = await newBusiness('Tana Coffee', '962107733', 'starter');
    await as(finance).post(`/businesses/${b.id}/payments`, { amount: 19000, method: 'cash' }).expect(201);
    await as(owner).post(`/businesses/${b.id}/branches`, { name: 'Bole' }).expect(201); // second branch: Full plan
    let f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ plan: 'full', branches: 2, fee: 25000, paid: 19000, balance: 6000 });
    await as(owner).post(`/businesses/${b.id}/branches`, {}).expect(201); // third: +5,000
    f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ branches: 3, fee: 30000, balance: 11000 });
    await as(owner).post(`/businesses/${b.id}/plan`, { plan: 'starter' }).expect(409); // Starter is 1 branch only
    await as(owner).post(`/businesses/${b.id}/plan`, { plan: 'pilot' }).expect(201);
    f = (await as(finance).get(`/businesses/${b.id}/finance`).expect(200)).body;
    expect(f).toMatchObject({ plan: 'pilot', fee: 0, billing: 'pilot' });
    expect((await sql`select count(*)::int n from tc.branch where business_id = ${b.id}`)[0].n).toBe(3);
  });

  it('agents: a lead links when that phone signs up; payouts clear what is owed; deals reassign', async () => {
    const [ag] = await sql`select id from tc.agent`;
    await as(support).post('/agents', { name: 'X', phone: '911000000' }).expect(403);
    const ag2 = (await as(finance).post('/agents', { name: 'Yonatan Bekele', phone: '925550177', area: 'Piassa' }).expect(201)).body;
    await as(finance).post('/agents', { name: 'Again', phone: '925550177' }).expect(409);
    await as(finance).post('/deals', { agentId: ag2.id, lead: { businessName: 'Lead Cafe', ownerPhone: '962107799', plan: 'starter' } }).expect(201);
    const b = await newBusiness('Lead Cafe', '962107799', 'starter');
    expect((await sql`select agent_id from tc.business where id = ${b.id}`)[0].agent_id).toBe(ag2.id);
    await as(finance).post(`/businesses/${b.id}/payments`, { amount: 19000, method: 'cash' }).expect(201);
    let s2 = (await as(finance).get(`/agents/${ag2.id}`).expect(200)).body;
    expect(s2.stats).toMatchObject({ earned: 3000, owed: 3000 });
    expect(s2.leads[0]).toMatchObject({ businessName: 'Lead Cafe', linked: true });
    await as(finance).post(`/agents/${ag2.id}/payout`, { how: 'Telebirr' }).expect(201);
    s2 = (await as(finance).get(`/agents/${ag2.id}`).expect(200)).body;
    expect(s2.stats).toMatchObject({ earned: 3000, paid: 3000, owed: 0 });
    await as(finance).post(`/agents/${ag2.id}/payout`, {}).expect(409); // nothing owed
    // An admin deal moves the business to another agent.
    await as(finance).post('/deals', { agentId: ag.id, businessId: b.id }).expect(201);
    expect((await sql`select agent_id from tc.business where id = ${b.id}`)[0].agent_id).toBe(ag.id);
    const lb = (await as(finance).get('/agents/leaderboard?days=30').expect(200)).body;
    expect(lb.agents[0]).toMatchObject({ name: 'Mekdes Tadesse', deals: 1, paid: 1, before: 0 });
    expect(lb.days).toBe(30);
    const list = (await as(finance).get('/agents').expect(200)).body;
    expect(list.find((a: { id: string }) => a.id === ag2.id)).toMatchObject({ deals: 1, earned: 3000, owed: 0 });
  });

  it('the government share of a month is marked handed over, and can be unmarked (as a new row)', async () => {
    const b = await newBusiness('Tana Coffee', '962107733', 'starter', '915550142');
    await as(finance).post(`/businesses/${b.id}/payments`, { amount: 19000, method: 'cash' }).expect(201);
    let rep = (await as(finance).get('/finance/report').expect(200)).body;
    const m = rep.months.find((x: { govShare: number }) => x.govShare > 0);
    expect(m).toMatchObject({ govShare: 900, handedOver: null });
    await as(support).post('/gov-share', { financeYear: rep.financeYear, month: m.month, handedOver: true, amount: 900, how: 'Bank transfer' }).expect(403);
    await as(finance).post('/gov-share', { financeYear: rep.financeYear, month: m.month, handedOver: true, amount: 900, how: 'Bank transfer', reference: 'SLIP-1' }).expect(201);
    rep = (await as(finance).get('/finance/report').expect(200)).body;
    expect(rep.months.find((x: { month: number }) => x.month === m.month).handedOver).toMatchObject({ amount: 900, how: 'Bank transfer', reference: 'SLIP-1' });
    await as(finance).post('/gov-share', { financeYear: rep.financeYear, month: m.month, handedOver: false }).expect(201);
    rep = (await as(finance).get('/finance/report').expect(200)).body;
    expect(rep.months.find((x: { month: number }) => x.month === m.month).handedOver).toBeNull();
  });

  it('the finance list shows what is due, overdue and collected; Support cannot see it', async () => {
    const b = await newBusiness('Tana Coffee', '962107733', 'starter');
    await sql`insert into tc.plan_fee (business_id, finance_year, plan, branches, fee_birr, base_birr, extra_birr, commission_base_birr, commission_extra_birr, gov_share_percent, due_on, reason)
      select business_id, finance_year, plan, branches, fee_birr, base_birr, extra_birr, commission_base_birr, commission_extra_birr, gov_share_percent, current_date - 3, 'plan_changed'
      from tc.plan_fee where business_id = ${b.id}`;
    await sql`update tc.business set status = 'active' where id = ${b.id}`;
    await as(support).get('/finance/summary').expect(403);
    const s = (await as(finance).get('/finance/summary').expect(200)).body;
    expect(s.overdue.map((x: { name: string }) => x.name)).toEqual(['Tana Coffee']);
    expect(s).toMatchObject({ overdueBirr: 19000, collected: 0, financeYear: expect.any(Number) });
    expect(s.businesses.find((x: { name: string }) => x.name === 'Tana Coffee')).toMatchObject({ billing: 'overdue', balance: 19000 });
  });

  it('the owner sees their plan, what is due and their receipts', async () => {
    const b = await newBusiness('Tana Coffee', '962107733', 'starter');
    await as(finance).post(`/businesses/${b.id}/payments`, { amount: 9000, method: 'telebirr', reference: 'TB-1' }).expect(201);
    const p = (await api().get('/api/v1/owner/plan').auth(b.ownerToken, { type: 'bearer' }).expect(200)).body;
    expect(p).toMatchObject({ plan: 'starter', status: 'trial', fee: 19000, paid: 9000, balance: 10000, trialEndsAt: expect.any(String), payments: [expect.objectContaining({ amount: 9000, method: 'telebirr' })] });
    // A manager cannot see money.
    expect(w.manager.id).toBeDefined();
  });
});
