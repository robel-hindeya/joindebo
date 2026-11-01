/**
 * Phase 8b (build plan, section 7): admin account recovery. Lost phone and
 * backup codes → a request → another Owner approves with password and code →
 * a 24-hour wait → a new phone. Email at every step, new-device alert, new
 * backup codes and moving to a new phone from the account page.
 * Acceptance: a recovery request cannot be approved by the person who made it.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { createTestApp, describeDb, migrateFresh, resetDb } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 8b: admin recovery', () => {
  let sql: Sql;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const secrets = new Map<string, string>();
  const backups = new Map<string, string[]>();

  /** A fresh code each time: replay protection refuses a step already used. */
  async function code(email: string) {
    await sql`update tc.admin_user set totp_last_step = totp_last_step - 10 where email = ${email}`;
    return totp(secrets.get(email)!);
  }
  async function signIn(email: string): Promise<string> {
    const login = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
    if (login.body.next === 'setup') {
      const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.body.ticket }).expect(200);
      secrets.set(email, start.body.secret);
      const done = await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.body.ticket, code: totp(start.body.secret) }).expect(200);
      backups.set(email, done.body.backupCodes);
      return done.body.accessToken;
    }
    return (await api().post('/api/v1/admin/auth/code').send({ ticket: login.body.ticket, code: await code(email) }).expect(200)).body.accessToken;
  }
  const as = (token: string) => ({
    get: (p: string) => api().get('/api/v1/admin' + p).auth(token, { type: 'bearer' }),
    post: (p: string, body: object = {}) => api().post('/api/v1/admin' + p).auth(token, { type: 'bearer' }).send(body),
  });
  const mails = (to: string) => sql<{ template: string; subject: string }[]>`select template, subject from tc.email_outbox where to_email = ${to} order by created_at`;

  let truman: string;
  let selam: string;
  let support: string;

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
  });
  beforeEach(async () => {
    await migrateFresh(sql);
    for (const [email, name, role] of [['truman@temelash.et', 'Truman', 'owner'], ['selam@temelash.et', 'Selam', 'owner'], ['sup@temelash.et', 'Hana', 'support']] as const) {
      await createAdmin(sql, { email, name, role, password: PASSWORD });
    }
    truman = await signIn('truman@temelash.et');
    selam = await signIn('selam@temelash.et');
    support = await signIn('sup@temelash.et');
    await sql`delete from tc.email_outbox`;
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('acceptance: the person who asked cannot approve their own reset; another Owner can, with password and code', async () => {
    await api().post('/api/v1/admin/auth/recover').send({ email: 'selam@temelash.et', owner: 'Truman' }).expect(200);
    const [rec] = await sql`select id, status from tc.admin_recovery`;
    expect(rec.status).toBe('pending');
    expect((await mails('selam@temelash.et')).map((m) => m.template)).toEqual(['recovery_requested']);
    expect((await mails('truman@temelash.et')).map((m) => m.template)).toEqual(['recovery_to_approve']);

    // Selam still holds a backup code, signs in with it and tries to approve herself.
    const waiting = (await as(truman).get('/recoveries').expect(200)).body;
    expect(waiting).toEqual([expect.objectContaining({ id: rec.id, name: 'Selam', ownerNamed: 'Truman', status: 'pending' })]);
    await as(selam).post(`/recoveries/${rec.id}/approve`, { password: PASSWORD, code: await code('selam@temelash.et') }).expect(403);
    await expect(sql`update tc.admin_recovery set status = 'approved', decided_by = admin_id where id = ${rec.id}`).rejects.toThrow();
    // Support cannot approve; a wrong code cannot approve.
    await as(support).post(`/recoveries/${rec.id}/approve`, { password: PASSWORD, code: await code('sup@temelash.et') }).expect(403);
    await as(truman).post(`/recoveries/${rec.id}/approve`, { password: PASSWORD, code: '000000' }).expect(401);

    const ok = (await as(truman).post(`/recoveries/${rec.id}/approve`, { password: PASSWORD, code: await code('truman@temelash.et') }).expect(201)).body;
    expect(new Date(ok.readyAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect((await mails('selam@temelash.et')).map((m) => m.template)).toContain('recovery_approved');
    const log = await sql`select type, actor_id from tc.audit_log where type like 'admin.recovery%' order by id`;
    expect(log.map((l) => l.type)).toEqual(['admin.recovery_requested', 'admin.recovery_approved']);
  });

  it('after approval the new phone waits 24 hours, then sign-in sets up a new authenticator and new codes', async () => {
    const oldBackup = backups.get('selam@temelash.et')![0];
    await api().post('/api/v1/admin/auth/recover').send({ email: 'selam@temelash.et', owner: 'Truman' }).expect(200);
    const [rec] = await sql`select id from tc.admin_recovery`;
    await as(truman).post(`/recoveries/${rec.id}/approve`, { password: PASSWORD, code: await code('truman@temelash.et') }).expect(201);

    const early = (await api().post('/api/v1/admin/auth/login').send({ email: 'selam@temelash.et', password: PASSWORD }).expect(200)).body;
    expect(early.next).toBe('wait');
    expect(early.readyAt).toBeDefined();
    expect(early.ticket).toBeUndefined();

    await sql`update tc.admin_recovery set ready_at = now() - interval '1 minute' where id = ${rec.id}`;
    const login = (await api().post('/api/v1/admin/auth/login').send({ email: 'selam@temelash.et', password: PASSWORD }).expect(200)).body;
    expect(login.next).toBe('setup');
    const start = await api().post('/api/v1/admin/auth/setup/start').send({ ticket: login.ticket }).expect(200);
    const done = await api().post('/api/v1/admin/auth/setup/finish').send({ ticket: login.ticket, code: totp(start.body.secret) }).expect(200);
    expect(done.body.backupCodes).toHaveLength(10);
    expect((await sql`select status from tc.admin_recovery where id = ${rec.id}`)[0].status).toBe('done');
    // The old backup codes no longer work.
    const again = (await api().post('/api/v1/admin/auth/login').send({ email: 'selam@temelash.et', password: PASSWORD }).expect(200)).body;
    await api().post('/api/v1/admin/auth/code').send({ ticket: again.ticket, backupCode: oldBackup }).expect(401);
    expect((await mails('selam@temelash.et')).map((m) => m.template)).toContain('recovery_done');
    expect((await mails('truman@temelash.et')).map((m) => m.template)).toContain('recovery_done_owner');
  });

  it('a denied reset keeps the account as it was; unknown emails get the same answer and nothing is made', async () => {
    const r1 = await api().post('/api/v1/admin/auth/recover').send({ email: 'nobody@temelash.et', owner: 'Truman' }).expect(200);
    await api().post('/api/v1/admin/auth/recover').send({ email: 'selam@temelash.et', owner: 'Truman' }).expect(200);
    const r2 = await api().post('/api/v1/admin/auth/recover').send({ email: 'selam@temelash.et', owner: 'Truman' }).expect(200);
    expect(r1.body).toEqual(r2.body);
    expect((await sql`select count(*)::int as n from tc.admin_recovery`)[0].n).toBe(1);
    const [rec] = await sql`select id from tc.admin_recovery`;
    await as(truman).post(`/recoveries/${rec.id}/deny`).expect(201);
    expect((await sql`select status from tc.admin_recovery`)[0].status).toBe('denied');
    expect((await api().post('/api/v1/admin/auth/login').send({ email: 'selam@temelash.et', password: PASSWORD }).expect(200)).body.next).toBe('code');
    expect((await mails('selam@temelash.et')).map((m) => m.template)).toContain('recovery_denied');
  });

  it('new backup codes replace the old ones; a new phone replaces the authenticator', async () => {
    const old = backups.get('truman@temelash.et')!;
    const fresh = (await as(truman).post('/me/backup-codes', { code: await code('truman@temelash.et') }).expect(201)).body.backupCodes;
    expect(fresh).toHaveLength(10);
    let login = (await api().post('/api/v1/admin/auth/login').send({ email: 'truman@temelash.et', password: PASSWORD }).expect(200)).body;
    await api().post('/api/v1/admin/auth/code').send({ ticket: login.ticket, backupCode: old[1] }).expect(401);
    login = (await api().post('/api/v1/admin/auth/login').send({ email: 'truman@temelash.et', password: PASSWORD }).expect(200)).body;
    await api().post('/api/v1/admin/auth/code').send({ ticket: login.ticket, backupCode: fresh[0] }).expect(200);

    const start = (await as(truman).post('/me/new-phone', { code: await code('truman@temelash.et') }).expect(201)).body;
    expect(start.otpauth).toMatch(/^otpauth:/);
    const done = (await as(truman).post('/me/new-phone/finish', { code: totp(start.secret) }).expect(201)).body;
    expect(done.backupCodes).toHaveLength(10);
    secrets.set('truman@temelash.et', start.secret);
    await signIn('truman@temelash.et');
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'admin.authenticator_replaced'`)[0].n).toBe(1);
  });

  it('a sign-in from a new device emails the admin and the other Owners, unless turned off', async () => {
    const login = (await api().post('/api/v1/admin/auth/login').set('user-agent', 'NewLaptop/1.0').send({ email: 'sup@temelash.et', password: PASSWORD }).expect(200)).body;
    await api().post('/api/v1/admin/auth/code').set('user-agent', 'NewLaptop/1.0').send({ ticket: login.ticket, code: await code('sup@temelash.et') }).expect(200);
    expect((await mails('sup@temelash.et')).map((m) => m.template)).toEqual(['new_device']);
    expect((await mails('truman@temelash.et')).map((m) => m.template)).toEqual(['new_device_owner']);

    await as(support).post('/me/device-alert', { on: false }).expect(201);
    const l2 = (await api().post('/api/v1/admin/auth/login').set('user-agent', 'Another/2.0').send({ email: 'sup@temelash.et', password: PASSWORD }).expect(200)).body;
    await api().post('/api/v1/admin/auth/code').set('user-agent', 'Another/2.0').send({ ticket: l2.ticket, code: await code('sup@temelash.et') }).expect(200);
    expect((await mails('sup@temelash.et')).length).toBe(1);
    expect((await as(support).get('/me').expect(200)).body.newDeviceAlert).toBe(false);
  });
});
