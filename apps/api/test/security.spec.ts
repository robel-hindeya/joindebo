/**
 * Findings from the Phase 1 security review (docs/phases/phase-1-security-review.md),
 * each written as a test before the fix.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { assertSafeConfig } from '../src/main';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const local = (e164: string) => e164.slice(4);

describeDb('security review findings', () => {
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

  describe('F1: tickets that grant an action work once', () => {
    it('staff set-PIN ticket cannot be replayed', async () => {
      await sql`update tc.person set pin_must_change = true where id = ${w.staff.id}`;
      const s = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
      await api().post('/api/v1/auth/staff/set-pin').send({ ticket: s.body.changeTicket, pin: '730194' }).expect(200);
      const again = await api().post('/api/v1/auth/staff/set-pin').send({ ticket: s.body.changeTicket, pin: '640273' }).expect(401);
      expect(again.body.error).toBe('bad_ticket');
    });

    it('a refused weak PIN does not use the ticket up', async () => {
      await sql`update tc.person set pin_must_change = true where id = ${w.staff.id}`;
      const s = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
      await api().post('/api/v1/auth/staff/set-pin').send({ ticket: s.body.changeTicket, pin: '111111' }).expect(400);
      await api().post('/api/v1/auth/staff/set-pin').send({ ticket: s.body.changeTicket, pin: '730194' }).expect(200);
    });

    it('business set-PIN ticket cannot be replayed', async () => {
      await sql`update tc.person set pin_must_change = true where id = ${w.manager.id}`;
      const s = await api().post('/api/v1/auth/business/signin').send({ phone: local(w.manager.phone), pin: GOOD_PIN }).expect(200);
      const v = await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, w.manager.phone) }).expect(200);
      expect(v.body.next).toBe('set_pin');
      await api().post('/api/v1/auth/business/set-pin').send({ ticket: v.body.changeTicket, pin: '730194' }).expect(200);
      await api().post('/api/v1/auth/business/set-pin').send({ ticket: v.body.changeTicket, pin: '640273' }).expect(401);
    });

    it('customer reset-PIN ticket cannot be replayed', async () => {
      await api().post('/api/v1/auth/customer/join').send({ phone: '912345678', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' }).expect(201);
      const r = await api().post('/api/v1/auth/customer/reset').send({ phone: '912345678' }).expect(200);
      const v = await api().post('/api/v1/auth/customer/reset/verify').send({ ticket: r.body.ticket, code: await lastSmsCode(sql, '+251912345678') }).expect(200);
      await api().post('/api/v1/auth/customer/reset/pin').send({ ticket: v.body.ticket, pin: '640273' }).expect(200);
      await api().post('/api/v1/auth/customer/reset/pin').send({ ticket: v.body.ticket, pin: '730194' }).expect(401);
    });

    it('staff shop-pick ticket cannot be replayed', async () => {
      const [{ id }] = await sql`insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
        select ${w.bizB}, ${w.staff.phone}, 'Second job', 'staff', pin_hash, now(), false from tc.person where id = ${w.staff.id} returning id`;
      await sql`insert into tc.person_branch (person_id, branch_id) values (${id}, ${w.branchB1})`;
      const s = await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN }).expect(200);
      await api().post('/api/v1/auth/staff/pick').send({ ticket: s.body.ticket, choice: s.body.shops[0].choice }).expect(200);
      await api().post('/api/v1/auth/staff/pick').send({ ticket: s.body.ticket, choice: s.body.shops[1].choice }).expect(401);
    });
  });

  describe('F2: SMS codes per phone are limited (cost and code guessing)', () => {
    it('refuses more codes than auth.otp_per_phone_hour for one phone', async () => {
      for (let i = 0; i < 5; i++) {
        await api().post('/api/v1/auth/business/forgot').send({ phone: local(w.owner.phone) }).expect(200);
      }
      const sixth = await api().post('/api/v1/auth/business/forgot').send({ phone: local(w.owner.phone) }).expect(429);
      expect(sixth.body.error).toBe('too_many_codes');
      const [{ n }] = await sql`select count(*)::int n from tc.sms_outbox where phone = ${w.owner.phone}`;
      expect(n).toBe(5);
      // Another phone is not affected.
      await api().post('/api/v1/auth/business/forgot').send({ phone: local(w.ownerB.phone) }).expect(200);
    });
  });
});

describe('F3: development SMS reader can never run in production', () => {
  it('refuses DEV_SMS=true when APP_ENV=production', () => {
    expect(() => assertSafeConfig({ APP_ENV: 'production', DEV_SMS: 'true' })).toThrow(/DEV_SMS/);
    expect(() => assertSafeConfig({ APP_ENV: 'staging', DEV_SMS: 'true' })).not.toThrow();
    expect(() => assertSafeConfig({ APP_ENV: 'production', SMS_PROVIDER: 'afromessage', AFROMESSAGE_TOKEN: 't' })).not.toThrow();
  });

  it('production must deliver SMS through AfroMessage, with a token', () => {
    expect(() => assertSafeConfig({ APP_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
    expect(() => assertSafeConfig({ APP_ENV: 'staging', SMS_PROVIDER: 'afromessage' })).toThrow(/AFROMESSAGE_TOKEN/);
    expect(() => assertSafeConfig({ APP_ENV: 'local' })).not.toThrow();
  });

  it('refuses a missing APP_ENV in a production image', () => {
    expect(() => assertSafeConfig({ NODE_ENV: 'production' })).toThrow(/APP_ENV/);
  });
});
