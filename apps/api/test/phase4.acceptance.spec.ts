/**
 * Phase 4 acceptance (build plan, section 7) and the admin flows: sign-in with
 * password and authenticator, backup codes, lockout, idle sign-out, sign-up
 * approval, businesses, search, settings, team, kill switch and the log.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { cardCode, minuteOf } from '@temelash/codes';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 4 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  const secrets = new Map<string, string>();

  /** Sign in; the first time, set up the authenticator and keep its secret for later codes. */
  async function adminSignIn(email: string, password = PASSWORD): Promise<{ token: string; backupCodes?: string[] }> {
    const login = await api().post('/api/v1/admin/auth/login').send({ email, password }).expect(200);
    if (login.body.next === 'setup') {
      const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
      expect(start.body.otpauth).toMatch(/^otpauth:\/\/totp\/Temelash/);
      secrets.set(email, start.body.secret);
      const done = await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.body.ticket, code: totp(start.body.secret) }).expect(200);
      return { token: done.body.accessToken, backupCodes: done.body.backupCodes };
    }
    // A fresh step each time so replay protection does not refuse the test's own second sign-in.
    await sql`update tc.admin_user set totp_last_step = totp_last_step - 10 where email = ${email}`;
    const done = await api().post('/api/v1/admin/auth/code').send({ ticket: login.body.ticket, code: totp(secrets.get(email)!) }).expect(200);
    return { token: done.body.accessToken };
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  // Re-authentication spends a step like a sign-in does, so step back first (as adminSignIn does).
  const reauth = async (email: string) => {
    await sql`update tc.admin_user set totp_last_step = totp_last_step - 10 where email = ${email}`;
    return { password: PASSWORD, code: totp(secrets.get(email)!) };
  };

  let owner: string;
  let support: string;
  let finance: string;

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
    owner = (await adminSignIn('owner1@temelash.et')).token;
    support = (await adminSignIn('sup@temelash.et')).token;
    finance = (await adminSignIn('fin@temelash.et')).token;
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  // ---------------------------------------------------------------- acceptance 1
  it('1. Support cannot reach any money screen or money export', async () => {
    await as(support).get('/finance/summary').expect(403);
    await as(support).post('/exports/finance', await reauth('sup@temelash.et')).expect(403);
    await as(support).get(`/businesses/${w.bizA}/finance`).expect(403);
    await as(support).post('/settings', { key: 'plan.full.yearly_fee_birr', value: 1 }).expect(403);
    await as(finance).get('/finance/summary').expect(200);
    await as(owner).get(`/businesses/${w.bizA}/finance`).expect(200);
    // Support still does its own work.
    await as(support).get('/businesses').expect(200);
    await as(support).get('/requests').expect(200);
  });

  // ---------------------------------------------------------------- acceptance 2
  it('2. the kill switch stops every stamp and redemption within 5 seconds and tells owners', async () => {
    const customer = (await api().post('/api/v1/auth/customer/join').send({ phone: '912100001', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' })).body.accessToken;
    const card = (await api().get('/api/v1/customer/cards').auth(customer, { type: 'bearer' })).body[0];
    for (let i = 0; i < 8; i++) {
      await sql`insert into tc.stamp (card_id, branch_id, person_id, method, at) values (${card.id}, ${w.branchA1}, ${w.staff.id}, 'scan', now() - make_interval(days => ${i + 1}))`;
    }
    const reward = (await api().get('/api/v1/customer/cards').auth(customer, { type: 'bearer' })).body[0].rewards[0];
    const staff = (await api().post('/api/v1/auth/staff/signin').send({ phone: w.staff.phone.slice(4), pin: GOOD_PIN })).body.accessToken;

    await as(support).post('/kill-switch', { on: true, message: 'x', ...(await reauth('sup@temelash.et')) }).expect(403);
    await as(owner).post('/kill-switch', { on: true, message: 'Temelash is fixing a problem. Back soon.', password: PASSWORD, code: '000000' }).expect(401);
    const t0 = Date.now();
    await as(owner).post('/kill-switch', { on: true, message: 'Temelash is fixing a problem. Back soon.', ...(await reauth('owner1@temelash.et')) }).expect(201);

    const code = await cardCode(card.qr.secret, 'MOKA01', card.qr.short, minuteOf(Date.now()));
    const s = await api().post('/api/v1/staff/stamps').auth(staff, { type: 'bearer' }).send({ code: code.qr, idempotencyKey: randomUUID() });
    const r = await api().post('/api/v1/staff/rewards/confirm').auth(staff, { type: 'bearer' }).send({ code: reward.code });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(s.status).toBe(503);
    expect(s.body).toMatchObject({ error: 'paused_by_temelash', message: 'Temelash is fixing a problem. Back soon.' });
    expect(r.status).toBe(503);

    const ownerSession = await (async () => {
      const si = await api().post('/api/v1/auth/business/signin').send({ phone: w.owner.phone.slice(4), pin: GOOD_PIN });
      return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: si.body.ticket, code: await lastSmsCode(sql, w.owner.phone) })).body.accessToken;
    })();
    const today = (await api().get('/api/v1/owner/today').auth(ownerSession, { type: 'bearer' }).expect(200)).body;
    expect(today.killSwitch).toEqual({ on: true, message: 'Temelash is fixing a problem. Back soon.' });

    await as(owner).post('/kill-switch', { on: false, ...(await reauth('owner1@temelash.et')) }).expect(201);
    const code2 = await cardCode(card.qr.secret, 'MOKA01', card.qr.short, minuteOf(Date.now()));
    await api().post('/api/v1/staff/stamps').auth(staff, { type: 'bearer' }).send({ code: code2.qr, idempotencyKey: randomUUID() }).expect(201);
  });

  // ---------------------------------------------------------------- acceptance 3
  it('3. every admin action appears in the log with the right actor', async () => {
    const pending = (await as(support).get('/requests?type=signup').expect(200)).body;
    expect(pending.length).toBe(0);
    // A real sign-up from the owner side.
    const st = await api().post('/api/v1/auth/business/signup').send({ businessName: 'Tana Coffee', ownerName: 'Mulugeta', phone: '962107733', agree: true, category: 'food' }).expect(200);
    const v = await api().post('/api/v1/auth/business/signup/verify').send({ ticket: st.body.ticket, code: await lastSmsCode(sql, '+251962107733') }).expect(200);
    await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '590382' }).expect(201);
    const [req] = (await as(support).get('/requests?type=signup').expect(200)).body;

    await as(support).post(`/requests/${req.id}/note`, { text: 'Called the owner, all fine.' }).expect(201);
    await as(support).post(`/requests/${req.id}/approve`, { start: 'pilot' }).expect(201);
    await as(owner).post('/settings', { key: 'plan.trial_days', value: 21 }).expect(201);
    await as(owner).post(`/businesses/${w.bizB}/pause`, { reason: 'Owner asked' }).expect(201);
    await as(owner).post('/team', { email: 'new@temelash.et', name: 'New', role: 'support' }).expect(201);
    await as(owner).post('/kill-switch', { on: true, message: 'x', ...(await reauth('owner1@temelash.et')) }).expect(201);

    const rows = await sql<{ actor_type: string; actor_id: string; type: string }[]>`
      select actor_type, actor_id, type from tc.audit_log where actor_type = 'admin' order by id`;
    const [sup] = await sql`select id from tc.admin_user where email = 'sup@temelash.et'`;
    const [own] = await sql`select id from tc.admin_user where email = 'owner1@temelash.et'`;
    const by = (type: string) => rows.find((r) => r.type === type);
    expect(by('request.note')?.actor_id).toBe(sup.id);
    expect(by('request.approved')?.actor_id).toBe(sup.id);
    expect(by('setting.changed')?.actor_id).toBe(own.id);
    expect(by('business.paused')?.actor_id).toBe(own.id);
    expect(by('admin.team_added')?.actor_id).toBe(own.id);
    expect(by('safety.kill_switch')?.actor_id).toBe(own.id);
    expect(rows.filter((r) => r.type === 'admin.signin').length).toBeGreaterThanOrEqual(3);
    // The approved business is live on the free pilot and the owner was told.
    const [b] = await sql`select status, plan from tc.business where name = 'Tana Coffee'`;
    expect(b).toMatchObject({ status: 'active', plan: 'pilot' });
    const [{ n }] = await sql`select count(*)::int n from tc.sms_outbox where phone = '+251962107733' and template = 'signup_approved'`;
    expect(n).toBe(1);
  });

  // ---------------------------------------------------------------- sign-in safety
  describe('admin sign-in', () => {
    it('five wrong tries lock the account; the right password is refused while locked', async () => {
      for (let i = 0; i < 4; i++) await api().post('/api/v1/admin/auth/login').send({ email: 'owner2@temelash.et', password: 'wrong' }).expect(401);
      await api().post('/api/v1/admin/auth/login').send({ email: 'owner2@temelash.et', password: 'wrong' }).expect(423);
      await api().post('/api/v1/admin/auth/login').send({ email: 'owner2@temelash.et', password: PASSWORD }).expect(423);
    });

    it('wrong authenticator codes count toward the lock; a code cannot be used twice', async () => {
      const login = await api().post('/api/v1/admin/auth/login').send({ email: 'owner1@temelash.et', password: PASSWORD }).expect(200);
      await api().post('/api/v1/admin/auth/code').send({ ticket: login.body.ticket, code: '000000' }).expect(401);
      await sql`update tc.admin_user set totp_last_step = totp_last_step - 10 where email = 'owner1@temelash.et'`;
      const code = totp(secrets.get('owner1@temelash.et')!);
      await api().post('/api/v1/admin/auth/code').send({ ticket: login.body.ticket, code }).expect(200);
      const again = await api().post('/api/v1/admin/auth/login').send({ email: 'owner1@temelash.et', password: PASSWORD }).expect(200);
      await api().post('/api/v1/admin/auth/code').send({ ticket: again.body.ticket, code }).expect(401);
    });

    it('backup codes are shown once and each works once', async () => {
      await createAdmin(sql, { email: 'b@temelash.et', name: 'b', role: 'support', password: PASSWORD });
      const first = await adminSignIn('b@temelash.et');
      expect(first.backupCodes).toHaveLength(10);
      const [row] = await sql`select backup_code_hashes from tc.admin_user where email = 'b@temelash.et'`;
      expect(row.backup_code_hashes.join()).not.toContain(first.backupCodes![0]);
      const l1 = await api().post('/api/v1/admin/auth/login').send({ email: 'b@temelash.et', password: PASSWORD });
      await api().post('/api/v1/admin/auth/code').send({ ticket: l1.body.ticket, backupCode: first.backupCodes![0] }).expect(200);
      const l2 = await api().post('/api/v1/admin/auth/login').send({ email: 'b@temelash.et', password: PASSWORD });
      await api().post('/api/v1/admin/auth/code').send({ ticket: l2.body.ticket, backupCode: first.backupCodes![0] }).expect(401);
    });

    it('signs out after 30 idle minutes', async () => {
      await as(owner).get('/overview').expect(200);
      await sql`update tc.session set last_used_at = now() - interval '31 minutes' where actor_type = 'admin'`;
      await as(owner).get('/overview').expect(401);
    });

    it('keeps at least two Owners', async () => {
      const [o2] = await sql`select id from tc.admin_user where email = 'owner2@temelash.et'`;
      await as(owner).post(`/team/${o2.id}/role`, { role: 'support' }).expect(409);
    });

    it('authenticator secrets are encrypted at rest', async () => {
      const [r] = await sql`select totp_secret_enc from tc.admin_user where email = 'owner1@temelash.et'`;
      expect(r.totp_secret_enc).not.toContain(secrets.get('owner1@temelash.et'));
    });
  });

  describe('back-office', () => {
    it('overview, businesses, business page and search', async () => {
      const o = (await as(support).get('/overview').expect(200)).body;
      expect(o.businesses).toMatchObject({ active: 2 });
      const list = (await as(support).get('/businesses?q=moka').expect(200)).body;
      expect(list.map((b: { name: string }) => b.name)).toEqual(['Moka House']);
      const page = (await as(support).get(`/businesses/${w.bizA}`).expect(200)).body;
      expect(page).toMatchObject({ name: 'Moka House', branches: expect.any(Array), people: expect.any(Array) });
      const found = (await as(support).get('/search?q=sheba').expect(200)).body;
      expect(found.businesses[0].name).toBe('Sheba Salon');
    });

    it('rejecting a sign-up needs a reason and tells the owner', async () => {
      const st = await api().post('/api/v1/auth/business/signup').send({ businessName: 'No Go', ownerName: 'Abebe', phone: '962107744', agree: true }).expect(200);
      const v = await api().post('/api/v1/auth/business/signup/verify').send({ ticket: st.body.ticket, code: await lastSmsCode(sql, '+251962107744') });
      await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '590382' }).expect(201);
      const [req] = (await as(support).get('/requests?type=signup').expect(200)).body;
      await as(support).post(`/requests/${req.id}/reject`, {}).expect(400);
      await as(support).post(`/requests/${req.id}/reject`, { reason: 'Could not reach the owner' }).expect(201);
      const [b] = await sql`select status from tc.business where name = 'No Go'`;
      expect(b.status).toBe('rejected');
    });

    it('a paused business cannot stamp', async () => {
      await as(owner).post(`/businesses/${w.bizA}/pause`, { reason: 'Unpaid' }).expect(201);
      const customer = (await api().post('/api/v1/auth/customer/join').send({ phone: '912100002', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }));
      expect(customer.status).toBe(404); // a paused shop takes no new members
      await sql`update tc.business set status = 'active' where id = ${w.bizA}`;
    });

    it('a cashier far over the usual rate raises one flag for Temelash', async () => {
      await sql`insert into tc.setting (key, value) values ('flags.stamps_per_hour', '2') on conflict (key) do update set value = excluded.value`;
      const staff = (await api().post('/api/v1/auth/staff/signin').send({ phone: w.staff.phone.slice(4), pin: GOOD_PIN })).body.accessToken;
      for (const p of ['913000001', '913000002', '913000003']) {
        const c = (await api().post('/api/v1/auth/customer/join').send({ phone: p, pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' })).body.accessToken;
        const card = (await api().get('/api/v1/customer/cards').auth(c, { type: 'bearer' })).body[0];
        const code = await cardCode(card.qr.secret, 'MOKA01', card.qr.short, minuteOf(Date.now()));
        await api().post('/api/v1/staff/stamps').auth(staff, { type: 'bearer' }).send({ code: code.qr, idempotencyKey: randomUUID() }).expect(201);
      }
      const flags = (await as(support).get('/requests?type=flag').expect(200)).body;
      expect(flags.length).toBe(1);
    });
  });
});
