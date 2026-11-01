/**
 * Phase 7 acceptance (build plan, section 7): stand orders move through every
 * stage and each stage tells the owner; the production list always equals the
 * open orders; stock never goes below zero. Plus the receiving report, the
 * problem path, prices kept on placed orders, hidden items and cancelling.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { createAdmin } from '../src/admin/accounts';
import { totp } from '../src/admin/totp';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, migrateFresh, resetDb, seedWorld, type World } from './harness';

const PASSWORD = 'correct horse battery 7';

describeDb('Phase 7 acceptance', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  let admin: string;
  let owner: string;

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
  const order = (items: Record<string, number>, branchId = w.branchA1) =>
    own(owner).post('/stands/orders', { items, branchId, phone: '0912005566', language: 'all' });
  const inboxTitles = async () => (await own(owner).get('/inbox').expect(200)).body.messages.map((m: { title: string }) => m.title) as string[];

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
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  // ---------------------------------------------------------------- acceptance 1
  it('1. an order moves through all stages and each stage tells the owner', async () => {
    const o = (await order({ table: 2, stickers: 1 }).expect(201)).body;
    expect(o.code).toMatch(/^ST-\d+$/);
    expect(Number(o.total)).toBe(2 * 350 + 120);
    const [{ request_id: reqId }] = await sql`select request_id from tc.stand_order where id = ${o.id}`;
    const [req] = await sql`select type, stage, payload from tc.request where id = ${reqId}`;
    expect(req).toMatchObject({ type: 'stand_order', stage: 'new' });

    for (const [i, stage] of ['confirmed', 'printing', 'way', 'delivered'].entries()) {
      await as(admin).post(`/stands/orders/${o.id}/stage`, { stage }).expect(201);
      const mine = (await own(owner).get(`/stands/orders/${o.id}`).expect(200)).body;
      expect(mine.stage).toBe(stage);
      expect((await inboxTitles()).length).toBe(i + 1);
    }
    const titles = await inboxTitles();
    expect(titles.length).toBe(4);
    expect(titles.some((t) => t.includes('on the way'))).toBe(true);
    const msg = (await own(owner).get('/inbox').expect(200)).body.messages[0];
    expect(msg.action).toBe('standorder');
    expect(msg.actionRef).toBe(o.id);

    // One step at a time; never backwards.
    await as(admin).post(`/stands/orders/${o.id}/stage`, { stage: 'printing' }).expect(409);

    // The owner confirms, then the team records the cash and the order closes.
    await own(owner).post(`/stands/orders/${o.id}/receive`, { condition: 'ok', pay: 'telebirr' }).expect(201);
    await as(admin).post(`/stands/orders/${o.id}/cash`).expect(201);
    const done = (await own(owner).get(`/stands/orders/${o.id}`).expect(200)).body;
    expect(done).toMatchObject({ status: 'done', received: 'ok', receivedPay: 'telebirr' });
    const [closed] = await sql`select stage, result from tc.request where id = ${reqId}`;
    expect(closed.stage).toBe('done');
    const log = await sql`select type from tc.audit_log where detail->>'orderId' = ${o.id} order by id`;
    expect(log.map((l) => l.type)).toEqual(['stand.ordered', 'stand.stage', 'stand.stage', 'stand.stage', 'stand.stage', 'stand.received', 'stand.cash']);
  });

  // ---------------------------------------------------------------- acceptance 2
  it('2. the production list always equals the open orders that are not on the way', async () => {
    const a = (await order({ table: 2, stickers: 1 }).expect(201)).body;
    const b = (await order({ table: 1, wall: 3 }, w.branchA2).expect(201)).body;
    await as(admin).post('/stands/stock/table', { change: 1, reason: 'We made more' }).expect(201);
    let p = (await as(admin).get('/stands').expect(200)).body;
    const need = (id: string) => p.production.find((x: { id: string }) => x.id === id);
    expect(need('table')).toMatchObject({ ordered: 3, stock: 1, toMake: 2 });
    expect(need('wall')).toMatchObject({ ordered: 3, toMake: 3 });
    expect(need('stickers')).toMatchObject({ ordered: 1 });
    expect(p.orders.map((o: { id: string }) => o.id).sort()).toEqual([a.id, b.id].sort());

    // On the way leaves the list; cancelling leaves it too.
    for (const stage of ['confirmed', 'printing', 'way']) await as(admin).post(`/stands/orders/${a.id}/stage`, { stage }).expect(201);
    await as(admin).post(`/stands/orders/${b.id}/cancel`, { reason: 'Owner asked to cancel' }).expect(201);
    p = (await as(admin).get('/stands').expect(200)).body;
    expect(p.orders).toEqual([]);
    expect(p.production.filter((x: { ordered: number }) => x.ordered > 0)).toEqual([]);
  });

  // ---------------------------------------------------------------- acceptance 3
  it('3. stock never goes below zero', async () => {
    await as(admin).post('/stands/stock/wall', { change: 3, reason: 'We bought more' }).expect(201);
    await as(admin).post('/stands/stock/wall', { change: -4, reason: 'Damaged' }).expect(409);
    await as(admin).post('/stands/stock/wall', { change: -3, reason: 'Used for an order' }).expect(201);
    const [it] = await sql`select stock from tc.stand_item where id = 'wall'`;
    expect(it.stock).toBe(0);
    await expect(sql`update tc.stand_item set stock = -1 where id = 'wall'`).rejects.toThrow();
    const moves = await sql`select change, stock_after from tc.stand_stock_move where item_id = 'wall' order by at`;
    expect(moves.map((m) => [m.change, m.stock_after])).toEqual([[3, 3], [-3, 0]]);
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'stand.stock'`)[0].n).toBe(2);
  });

  it('a problem report needs a note; replacement goes back to Printing, or the order closes without one', async () => {
    const o = (await order({ counter: 1 }).expect(201)).body;
    for (const stage of ['confirmed', 'printing', 'way']) await as(admin).post(`/stands/orders/${o.id}/stage`, { stage }).expect(201);
    await own(owner).post(`/stands/orders/${o.id}/receive`, { condition: 'damaged' }).expect(400);
    await own(owner).post(`/stands/orders/${o.id}/receive`, { condition: 'damaged', note: 'One stand is bent at the base' }).expect(201);
    await own(owner).post(`/stands/orders/${o.id}/receive`, { condition: 'ok', pay: 'cash' }).expect(409);
    // Cash cannot close an order with an open problem.
    await as(admin).post(`/stands/orders/${o.id}/stage`, { stage: 'delivered' }).expect(201);
    await as(admin).post(`/stands/orders/${o.id}/cash`).expect(409);

    await as(admin).post(`/stands/orders/${o.id}/replace`).expect(201);
    let mine = (await own(owner).get(`/stands/orders/${o.id}`).expect(200)).body;
    expect(mine).toMatchObject({ stage: 'printing', received: null, status: 'open' });
    expect(mine.history.map((h: { kind: string }) => h.kind)).toContain('problem');

    for (const stage of ['way', 'delivered']) await as(admin).post(`/stands/orders/${o.id}/stage`, { stage }).expect(201);
    await own(owner).post(`/stands/orders/${o.id}/receive`, { condition: 'missing', note: 'Frame missing' }).expect(201);
    await as(admin).post(`/stands/orders/${o.id}/close`, { reason: 'Agreed with the owner' }).expect(201);
    mine = (await own(owner).get(`/stands/orders/${o.id}`).expect(200)).body;
    expect(mine.status).toBe('done');
  });

  it('prices come from the admin list, placed orders keep theirs, hidden items cannot be ordered', async () => {
    const before = (await order({ table: 1 }).expect(201)).body;
    await as(admin).post('/stands/items/table', { price: 400, visible: true }).expect(201);
    await as(admin).post('/stands/items/window', { price: 220, visible: false }).expect(201);
    const shop = (await own(owner).get('/stands').expect(200)).body;
    expect(shop.items.find((i: { id: string }) => i.id === 'table').price).toBe(400);
    expect(shop.items.map((i: { id: string }) => i.id)).not.toContain('window');
    await order({ window: 1 }).expect(400);
    const again = (await own(owner).get(`/stands/orders/${before.id}`).expect(200)).body;
    expect(Number(again.total)).toBe(350);
    expect(again.lines[0].price).toBe(350);
    expect((await sql`select count(*)::int as n from tc.audit_log where type = 'stand.price'`)[0].n).toBe(2);
  });

  it('only the owner orders; bad orders are refused; cancelling is only before On the way', async () => {
    const mgr = await personToken(w.manager.phone);
    await own(mgr).post('/stands/orders', { items: { table: 1 }, branchId: w.branchA1, phone: '0912005566', language: 'en' }).expect(403);
    await order({}).expect(400);
    await order({ table: 21 }).expect(400);
    await order({ table: 1 }, w.branchB1).expect(400);
    const o = (await order({ table: 1 }).expect(201)).body;
    for (const stage of ['confirmed', 'printing', 'way']) await as(admin).post(`/stands/orders/${o.id}/stage`, { stage }).expect(201);
    await as(admin).post(`/stands/orders/${o.id}/cancel`, { reason: 'Owner asked to cancel' }).expect(409);
    // Sheba's owner cannot see Moka's order.
    const sheba = await personToken(w.ownerB.phone);
    await own(sheba).get(`/stands/orders/${o.id}`).expect(404);
  });

  it('orders on the way show on Today and in My requests; the team can remind the owner', async () => {
    const o = (await order({ table: 1 }).expect(201)).body;
    let today = (await own(owner).get('/today').expect(200)).body;
    expect(today.attention.standsWaiting).toEqual([]);
    for (const stage of ['confirmed', 'printing', 'way']) await as(admin).post(`/stands/orders/${o.id}/stage`, { stage }).expect(201);
    today = (await own(owner).get('/today').expect(200)).body;
    expect(today.attention.standsWaiting).toEqual([{ id: o.id, code: o.code }]);
    await as(admin).post(`/stands/orders/${o.id}/remind`).expect(201);
    expect((await inboxTitles()).length).toBe(4);
    const reqs = (await own(owner).get('/requests').expect(200)).body;
    expect(reqs[0]).toMatchObject({ type: 'stand_order', status: 'progress' });
    expect(reqs[0].payload.code).toBe(o.code);
  });
});
