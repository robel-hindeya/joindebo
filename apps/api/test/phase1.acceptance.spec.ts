/**
 * Phase 1 acceptance (build plan, section 7) plus the flows behind each board.
 * Local 9-digit numbers are what people type; the API stores +251 numbers.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const local = (e164: string) => e164.slice(4);

describeDb('Phase 1 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());

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

  async function businessSignIn(phone: string) {
    const start = await api().post('/api/v1/auth/business/signin').send({ phone: local(phone), pin: GOOD_PIN }).expect(200);
    const code = await lastSmsCode(sql, phone);
    const done = await api().post('/api/v1/auth/business/signin/verify').send({ ticket: start.body.ticket, code }).expect(200);
    return done.body.accessToken as string;
  }

  // ---------------------------------------------------------------- acceptance 1
  describe('1. a manager cannot read another branch by changing the id', () => {
    it('reads their own branch', async () => {
      const token = await businessSignIn(w.manager.phone);
      const res = await api().get(`/api/v1/branches/${w.branchA1}`).auth(token, { type: 'bearer' }).expect(200);
      expect(res.body.name).toBe('Piassa');
    });

    it('is refused another branch of the same business', async () => {
      const token = await businessSignIn(w.manager.phone);
      await api().get(`/api/v1/branches/${w.branchA2}`).auth(token, { type: 'bearer' }).expect(403);
    });

    it('is refused a branch of another business', async () => {
      const token = await businessSignIn(w.manager.phone);
      await api().get(`/api/v1/branches/${w.branchB1}`).auth(token, { type: 'bearer' }).expect(403);
    });

    it('lets the owner read every branch of their business, and none of another', async () => {
      const token = await businessSignIn(w.owner.phone);
      await api().get(`/api/v1/branches/${w.branchA1}`).auth(token, { type: 'bearer' }).expect(200);
      await api().get(`/api/v1/branches/${w.branchA2}`).auth(token, { type: 'bearer' }).expect(200);
      await api().get(`/api/v1/branches/${w.branchB1}`).auth(token, { type: 'bearer' }).expect(403);
    });
  });

  // ---------------------------------------------------------------- acceptance 2
  describe('2. wrong PINs lock the account; the correct PIN is refused until the lock ends', () => {
    it('customer: 5 wrong, then the correct PIN is refused, then accepted after the lock', async () => {
      await api().post('/api/v1/auth/customer/join')
        .send({ phone: '912345678', pin: GOOD_PIN, language: 'am', consent: true, shopCode: 'MOKA01' }).expect(201);
      for (let i = 1; i <= 4; i++) {
        const r = await api().post('/api/v1/auth/customer/signin').send({ phone: '912345678', pin: '000001' }).expect(401);
        expect(r.body).toMatchObject({ error: 'wrong_pin', triesLeft: 5 - i });
      }
      const fifth = await api().post('/api/v1/auth/customer/signin').send({ phone: '912345678', pin: '000001' }).expect(423);
      expect(fifth.body.error).toBe('locked');
      const sixth = await api().post('/api/v1/auth/customer/signin').send({ phone: '912345678', pin: GOOD_PIN }).expect(423);
      expect(sixth.body.lockedUntil).toBeTruthy();

      await sql`update tc.customer set locked_until = now() - interval '1 second' where phone = '+251912345678'`;
      await api().post('/api/v1/auth/customer/signin').send({ phone: '912345678', pin: GOOD_PIN }).expect(200);
    });

    it('owner app: locks after 3 wrong PINs (auth.business.max_failed_attempts)', async () => {
      for (let i = 0; i < 2; i++) {
        await api().post('/api/v1/auth/business/signin').send({ phone: local(w.owner.phone), pin: '000001' }).expect(401);
      }
      await api().post('/api/v1/auth/business/signin').send({ phone: local(w.owner.phone), pin: '000001' }).expect(423);
      await api().post('/api/v1/auth/business/signin').send({ phone: local(w.owner.phone), pin: GOOD_PIN }).expect(423);
    });

    it('staff: 5 wrong PINs lock the account', async () => {
      for (let i = 0; i < 4; i++) {
        await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: '000001' }).expect(401);
      }
      await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: '000001' }).expect(423);
      await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(423);
    });

    it('writes each failed try and the lock to the audit log', async () => {
      for (let i = 0; i < 5; i++) {
        await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: '000001' });
      }
      const rows = await sql`select type from tc.audit_log where actor_id = ${w.staff.id} order by id`;
      expect(rows.map((r) => r.type)).toEqual([...Array(4).fill('auth.pin_wrong'), 'auth.locked']);
    });
  });

  // ---------------------------------------------------------------- acceptance 3
  describe('3. an expired staff PIN forces a change before anything else', () => {
    beforeEach(async () => {
      await sql`update tc.person set pin_set_at = now() - interval '91 days' where id = ${w.staff.id}`;
    });

    it('signs in to a PIN change only, with no access token', async () => {
      const res = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
      expect(res.body).toMatchObject({ next: 'set_pin', reason: 'expired' });
      expect(res.body.accessToken).toBeUndefined();
      // The change ticket is not an access token.
      await api().get('/api/v1/staff/me').auth(res.body.changeTicket, { type: 'bearer' }).expect(401);
    });

    it('refuses a weak or reused PIN, then works after a good one', async () => {
      const res = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
      for (const pin of ['111111', '123456', '987654', '123123', local(w.staff.phone).slice(-6), GOOD_PIN]) {
        const r = await api().post('/api/v1/auth/staff/set-pin').send({ ticket: res.body.changeTicket, pin }).expect(400);
        expect(['weak_pin', 'same_pin']).toContain(r.body.error);
      }
      const ok = await api().post('/api/v1/auth/staff/set-pin').send({ ticket: res.body.changeTicket, pin: '730194' }).expect(200);
      await api().get('/api/v1/staff/me').auth(ok.body.accessToken, { type: 'bearer' }).expect(200);
    });

    it('also forces the owner-issued first PIN to be changed', async () => {
      await sql`update tc.person set pin_set_at = now(), pin_must_change = true where id = ${w.staff.id}`;
      const res = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
      expect(res.body).toMatchObject({ next: 'set_pin', reason: 'first' });
    });
  });
});

describeDb('Phase 1 flows', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
    w = await seedWorld(sql);
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('customer: join validates like ScanJoin', async () => {
    const base = { phone: '923456789', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' };
    expect((await api().post('/api/v1/auth/customer/join').send({ ...base, phone: '12345' }).expect(400)).body.error).toBe('bad_phone');
    expect((await api().post('/api/v1/auth/customer/join').send({ ...base, pin: '12345' }).expect(400)).body.error).toBe('bad_pin');
    expect((await api().post('/api/v1/auth/customer/join').send({ ...base, consent: false }).expect(400)).body.error).toBe('no_consent');
    expect((await api().post('/api/v1/auth/customer/join').send({ ...base, shopCode: 'NOPE99' }).expect(404)).body.error).toBe('no_shop');
    const ok = await api().post('/api/v1/auth/customer/join').send(base).expect(201);
    expect(ok.body.accessToken).toBeTruthy();
    expect((await api().post('/api/v1/auth/customer/join').send(base).expect(409)).body.error).toBe('already_member');
    const [c] = await sql`select phone, language, pin_hash, consent_at from tc.customer where phone = '+251923456789'`;
    expect(c.language).toBe('en');
    expect(c.pin_hash).not.toContain(GOOD_PIN);
    expect(c.consent_at).toBeTruthy();
  });

  it('customer: the join page shows the shop, and joining adds its card once', async () => {
    const shop = await api().get('/api/v1/shops/moka01').expect(200);
    expect(shop.body).toMatchObject({ name: 'Moka House', shopCode: 'MOKA01', stampsNeeded: 8, rewards: [{ at: 8, reward: 'Free macchiato' }] });
    await api().get('/api/v1/shops/NOPE99').expect(404);

    const j = await api().post('/api/v1/auth/customer/join')
      .send({ phone: '956789012', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201);
    expect(j.body.cardAdded).toBe(true);
    const again = await api().post('/api/v1/auth/customer/signin').send({ phone: '956789012', pin: GOOD_PIN, shopCode: 'MOKA01' }).expect(200);
    expect(again.body.cardAdded).toBe(false);
    const [{ n }] = await sql`select count(*)::int n from tc.card c join tc.customer u on u.id = c.customer_id where u.phone = '+251956789012'`;
    expect(n).toBe(1);
  });

  it('customer: reset PIN with an SMS code', async () => {
    await api().post('/api/v1/auth/customer/join')
      .send({ phone: '934567890', pin: GOOD_PIN, language: 'om', consent: true, shopCode: 'MOKA01' }).expect(201);
    const start = await api().post('/api/v1/auth/customer/reset').send({ phone: '934567890' }).expect(200);
    const code = await lastSmsCode(sql, '+251934567890');
    await api().post('/api/v1/auth/customer/reset/verify').send({ ticket: start.body.ticket, code: '000000' }).expect(400);
    const v = await api().post('/api/v1/auth/customer/reset/verify').send({ ticket: start.body.ticket, code }).expect(200);
    await api().post('/api/v1/auth/customer/reset/pin').send({ ticket: v.body.ticket, pin: '640273' }).expect(200);
    await api().post('/api/v1/auth/customer/signin').send({ phone: '934567890', pin: GOOD_PIN }).expect(401);
    await api().post('/api/v1/auth/customer/signin').send({ phone: '934567890', pin: '640273' }).expect(200);
  });

  it('reset for an unknown phone looks the same and sends nothing', async () => {
    const r = await api().post('/api/v1/auth/customer/reset').send({ phone: '977777777' }).expect(200);
    expect(r.body.ticket).toBeTruthy();
    const [{ n }] = await sql`select count(*)::int n from tc.sms_outbox where phone = '+251977777777'`;
    expect(n).toBe(0);
  });

  it('owner: wrong SMS code is refused; the right one signs in', async () => {
    const start = await api().post('/api/v1/auth/business/signin').send({ phone: local(w.owner.phone), pin: GOOD_PIN }).expect(200);
    expect(start.body.maskedPhone).toBe('+251 •• ••• 0001');
    await api().post('/api/v1/auth/business/signin/verify').send({ ticket: start.body.ticket, code: '000000' }).expect(400);
    const code = await lastSmsCode(sql, w.owner.phone);
    const ok = await api().post('/api/v1/auth/business/signin/verify').send({ ticket: start.body.ticket, code }).expect(200);
    const me = await api().get('/api/v1/me').auth(ok.body.accessToken, { type: 'bearer' }).expect(200);
    expect(me.body).toMatchObject({ actorType: 'owner', businessId: w.bizA });
  });

  it('owner sign-up: code, PIN, then the business waits for approval', async () => {
    const start = await api().post('/api/v1/auth/business/signup')
      .send({ businessName: 'Tana Coffee', ownerName: 'Mulugeta Ayele', phone: '962107733', agentPhone: '' }).expect(200);
    const code = await lastSmsCode(sql, '+251962107733');
    const v = await api().post('/api/v1/auth/business/signup/verify').send({ ticket: start.body.ticket, code }).expect(200);
    await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '123456' }).expect(400);
    const done = await api().post('/api/v1/auth/business/signup/pin').send({ ticket: v.body.ticket, pin: '590382' }).expect(201);
    expect(done.body.accessToken).toBeTruthy();
    const [b] = await sql`select b.status, r.type, r.stage from tc.business b join tc.request r on r.business_id = b.id where b.name = 'Tana Coffee'`;
    expect(b).toMatchObject({ status: 'pending', type: 'signup', stage: 'new' });
    const [{ n }] = await sql`select count(*)::int n from tc.audit_log where type = 'business.signup'`;
    expect(n).toBe(1);
  });

  it('owner forgot PIN: code and new PIN together, as on OwnForgot', async () => {
    const start = await api().post('/api/v1/auth/business/forgot').send({ phone: local(w.ownerB.phone) }).expect(200);
    const code = await lastSmsCode(sql, w.ownerB.phone);
    await api().post('/api/v1/auth/business/forgot/finish').send({ ticket: start.body.ticket, code, pin: '111111' }).expect(400);
    await api().post('/api/v1/auth/business/forgot/finish').send({ ticket: start.body.ticket, code, pin: '305718' }).expect(200);
    await api().post('/api/v1/auth/business/signin').send({ phone: local(w.ownerB.phone), pin: '305718' }).expect(200);
  });

  it('staff in two shops pick one (StaffPickShop)', async () => {
    const [{ id }] = await sql`insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
      select ${w.bizB}, ${w.staff.phone}, 'Second job', 'staff', pin_hash, now(), false from tc.person where id = ${w.staff.id} returning id`;
    await sql`insert into tc.person_branch (person_id, branch_id) values (${id}, ${w.branchB1})`;
    const res = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
    expect(res.body.next).toBe('pick_shop');
    expect(res.body.shops.map((s: { businessName: string }) => s.businessName).sort()).toEqual(['Moka House', 'Sheba Salon']);
    const pick = res.body.shops.find((s: { businessName: string }) => s.businessName === 'Sheba Salon');
    const done = await api().post('/api/v1/auth/staff/pick').send({ ticket: res.body.ticket, choice: pick.choice }).expect(200);
    const me = await api().get('/api/v1/staff/me').auth(done.body.accessToken, { type: 'bearer' }).expect(200);
    expect(me.body).toMatchObject({ businessId: w.bizB, branchId: w.branchB1 });
  });

  it('refresh tokens rotate, and reusing an old one ends the whole session family', async () => {
    const r1 = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.manager.phone), pin: GOOD_PIN });
    // Managers sign in on the business page, not the staff page.
    expect(r1.status).toBe(401);
    const s = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN });
    const first = s.body.next === 'pick_shop'
      ? (await api().post('/api/v1/auth/staff/pick').send({ ticket: s.body.ticket, choice: s.body.shops[0].choice })).body
      : s.body;
    const second = await api().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it('sign-out ends every session of that person', async () => {
    const a = await api().post('/api/v1/auth/customer/join')
      .send({ phone: '945678901', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201);
    const b = await api().post('/api/v1/auth/customer/signin').send({ phone: '945678901', pin: GOOD_PIN }).expect(200);
    await api().post('/api/v1/auth/signout').auth(a.body.accessToken, { type: 'bearer' }).expect(204);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: b.body.refreshToken }).expect(401);
  });

  it('never stores or logs a PIN or code in clear', async () => {
    const rows = await sql`select detail::text d, text from tc.audit_log`;
    for (const r of rows) {
      expect(r.d + r.text).not.toContain(GOOD_PIN);
    }
    const codes = await sql`select code_hash from tc.otp_code`;
    for (const c of codes) expect(c.code_hash).not.toMatch(/^\d{6}$/);
  });
});
