/**
 * Permission matrix (Phase 1 exit gate: "permission tests cover every endpoint").
 * Every protected endpoint is called by every kind of caller; the expected
 * status is written out in full so a change to who-may-do-what shows up here.
 * A new protected endpoint must add a row, or the route check at the bottom fails.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, resetDb, seedWorld, type World } from './harness';

type Caller = 'anonymous' | 'ticket' | 'customer' | 'staff' | 'manager' | 'owner' | 'otherOwner';
const ADMIN_GETS = ['messages', 'sms/report', 'agents', 'agents/:id', 'agents/leaderboard', 'finance/report', 'payments/:id', 'overview', 'me', 'businesses/:id/customers', 'cards/:id', 'businesses', 'businesses/:id', 'businesses/:id/finance', 'search', 'requests', 'requests/:id', 'log', 'settings', 'team', 'kill-switch', 'finance/summary', 'stands', 'stands/orders/:id', 'recoveries', 'businesses/:id/follow-ups', 'follow-ups', 'businesses/:id/owner-view', 'businesses/:id/merge-preview', 'audience', 'me/sessions', 'payment-claims', 'payment-claims/:id'];

describeDb('permission matrix', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const tokens = {} as Record<Caller, string>;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
    w = await seedWorld(sql);
    const local = (p: string) => p.slice(4);
    const business = async (phone: string) => {
      const s = await api().post('/api/v1/auth/business/signin').send({ phone: local(phone), pin: GOOD_PIN });
      const v = await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) });
      return v.body.accessToken as string;
    };
    tokens.anonymous = '';
    tokens.customer = (await api().post('/api/v1/auth/customer/join')
      .send({ phone: '911223344', pin: GOOD_PIN, language: 'en', consent: true, shopCode: 'MOKA01' })).body.accessToken;
    tokens.staff = (await api().post('/api/v1/auth/staff/signin').send({ phone: local(w.staff.phone), pin: GOOD_PIN })).body.accessToken;
    tokens.manager = await business(w.manager.phone);
    tokens.owner = await business(w.owner.phone);
    tokens.otherOwner = await business(w.ownerB.phone);
    // A sign-in ticket (not an access token) must never open anything.
    tokens.ticket = (await api().post('/api/v1/auth/business/signin').send({ phone: local(w.owner.phone), pin: GOOD_PIN })).body.ticket;
    for (const [k, v] of Object.entries(tokens)) if (k !== 'anonymous' && !v) throw new Error(`no token for ${k}`);
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  const rows: Array<[string, () => string, Record<Caller, number>]> = [
    ['GET /me', () => '/api/v1/me',
      { anonymous: 401, ticket: 401, customer: 200, staff: 200, manager: 200, owner: 200, otherOwner: 200 }],
    ['GET /businesses/:own', () => `/api/v1/businesses/${w.bizA}`,
      { anonymous: 401, ticket: 401, customer: 403, staff: 200, manager: 200, owner: 200, otherOwner: 403 }],
    ['GET /businesses/:other', () => `/api/v1/businesses/${w.bizB}`,
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 403, otherOwner: 200 }],
    ['GET /branches/:A1 (manager and staff branch)', () => `/api/v1/branches/${w.branchA1}`,
      { anonymous: 401, ticket: 401, customer: 403, staff: 200, manager: 200, owner: 200, otherOwner: 403 }],
    ['GET /branches/:A2 (same business, other branch)', () => `/api/v1/branches/${w.branchA2}`,
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 403 }],
    ['GET /branches/:B1 (other business)', () => `/api/v1/branches/${w.branchB1}`,
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 403, otherOwner: 200 }],
    ['GET /branches/:unknown', () => '/api/v1/branches/00000000-0000-4000-8000-000000000000',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /staff/me', () => '/api/v1/staff/me',
      { anonymous: 401, ticket: 401, customer: 403, staff: 200, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /staff/recent', () => '/api/v1/staff/recent',
      { anonymous: 401, ticket: 401, customer: 403, staff: 200, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /customer/cards', () => '/api/v1/customer/cards',
      { anonymous: 401, ticket: 401, customer: 200, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /customer/history', () => '/api/v1/customer/history',
      { anonymous: 401, ticket: 401, customer: 200, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /customer/notifications', () => '/api/v1/customer/notifications',
      { anonymous: 401, ticket: 401, customer: 200, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /owner/today', () => '/api/v1/owner/today',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/approvals', () => '/api/v1/owner/approvals',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/to-check', () => '/api/v1/owner/to-check',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/customers', () => '/api/v1/owner/customers',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/team', () => '/api/v1/owner/team',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/rules', () => '/api/v1/owner/rules',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/shop', () => '/api/v1/owner/shop',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/branches', () => '/api/v1/owner/branches',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/reports', () => '/api/v1/owner/reports',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/log', () => '/api/v1/owner/log',
      {anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200}],
    ['GET /owner/look', () => '/api/v1/owner/look',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200 }],
    ['GET /owner/prefs', () => '/api/v1/owner/prefs',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200 }],
    ['GET /owner/inbox (owners only)', () => '/api/v1/owner/inbox',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/inbox/:unknown', () => '/api/v1/owner/inbox/00000000-0000-4000-8000-000000000000',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 404, otherOwner: 404 }],
    ['GET /owner/requests (owners only)', () => '/api/v1/owner/requests',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/news (owners only)', () => '/api/v1/owner/news',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/stands (owners only)', () => '/api/v1/owner/stands',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/stands/orders (owners only)', () => '/api/v1/owner/stands/orders',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/stands/orders/:unknown', () => '/api/v1/owner/stands/orders/00000000-0000-4000-8000-000000000000',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 404, otherOwner: 404 }],
    ['GET /owner/alert-prefs', () => '/api/v1/owner/alert-prefs',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200 }],
    ['GET /owner/alerts/:unknown', () => '/api/v1/owner/alerts/00000000-0000-4000-8000-000000000000',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 404, owner: 404, otherOwner: 404 }],
    ['GET /owner/privacy/requests (owners only)', () => '/api/v1/owner/privacy/requests',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/export (owners only)', () => '/api/v1/owner/export',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/help', () => '/api/v1/owner/help',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 200, owner: 200, otherOwner: 200 }],
    ['GET /owner/close (owners only)', () => '/api/v1/owner/close',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /customer/privacy', () => '/api/v1/customer/privacy',
      { anonymous: 401, ticket: 401, customer: 200, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /customer/export', () => '/api/v1/customer/export',
      { anonymous: 401, ticket: 401, customer: 200, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /customer/prefs', () => '/api/v1/customer/prefs',
      { anonymous: 401, ticket: 401, customer: 200, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    ['GET /owner/plan (owners only: money)', () => '/api/v1/owner/plan',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 200, otherOwner: 200 }],
    ['GET /owner/customers/:unknown', () => '/api/v1/owner/customers/00000000-0000-4000-8000-000000000000',
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 403, otherOwner: 403 }],
    // The back-office takes admin tokens only; admin roles are covered in phase4.acceptance.spec.ts.
    ...ADMIN_GETS.map((p): [string, () => string, Record<Caller, number>] => ['GET /admin/' + p, () => '/api/v1/admin/' + p.replace(':id', w.bizA),
      { anonymous: 401, ticket: 401, customer: 403, staff: 403, manager: 403, owner: 403, otherOwner: 403 }]),
  ];

  for (const [name, path, expected] of rows) {
    describe(name, () => {
      for (const caller of Object.keys(expected) as Caller[]) {
        it(`${caller} -> ${expected[caller]}`, async () => {
          const r = api().get(path());
          if (tokens[caller]) r.auth(tokens[caller], { type: 'bearer' });
          await r.expect(expected[caller]);
        });
      }
    });
  }

  it('covers every protected GET route in the app', () => {
    const express = app.getHttpAdapter().getInstance();
    // Express 5 exposes the router as `router`; Express 4 as `_router`.
    const router = express.router ?? express._router;
    const routes: string[] = router.stack
      .filter((l: { route?: { methods: Record<string, boolean> } }) => l.route?.methods.get)
      .map((l: { route: { path: string } }) => l.route.path);
    const open = ['/api/v1/admin/auth/rules', '/api/v1/health', '/api/v1/dev/sms', '/api/v1/shops/:code', '/api/v1/shops/:code/logo', '/api/v1/shops/:code/details'];
    const covered = ['/api/v1/me', '/api/v1/businesses/:id', '/api/v1/branches/:id', '/api/v1/staff/me', '/api/v1/staff/recent',
      '/api/v1/customer/cards', '/api/v1/customer/history', '/api/v1/customer/notifications', '/api/v1/customer/prefs', '/api/v1/customer/privacy', '/api/v1/customer/export',
      ...['today', 'approvals', 'to-check', 'customers', 'customers/:cardId', 'team', 'rules', 'shop', 'branches', 'reports', 'log', 'look', 'prefs', 'plan', 'inbox', 'inbox/:id', 'requests', 'news', 'stands', 'stands/orders', 'stands/orders/:id', 'alert-prefs', 'alerts/:id', 'privacy/requests', 'close', 'export', 'help'].map((p) => '/api/v1/owner/' + p),
      ...ADMIN_GETS.map((p) => '/api/v1/admin/' + p)];
    expect(routes.filter((r) => !open.includes(r)).sort()).toEqual([...covered].sort());
  });

  it('signing out ends that person\'s access at once', async () => {
    const t = (await api().post('/api/v1/auth/staff/signin').send({ phone: w.staff.phone.slice(4), pin: GOOD_PIN })).body.accessToken;
    await api().get('/api/v1/me').auth(t, { type: 'bearer' }).expect(200);
    await api().post('/api/v1/auth/signout').auth(t, { type: 'bearer' }).expect(204);
    await api().get('/api/v1/me').auth(t, { type: 'bearer' }).expect(401);
  });
});
