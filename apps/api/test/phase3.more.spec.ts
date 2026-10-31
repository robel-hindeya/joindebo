/**
 * Phase 3, the rest of the owner board: look (colour and logo), security
 * (change own PIN, sign out other phones) and date and time settings.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Sql } from '@temelash/db';
import { GOOD_PIN, createTestApp, describeDb, lastSmsCode, resetDb, seedWorld, type World } from './harness';

// A real 1 x 1 PNG.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describeDb('Phase 3: look, security, date and time', () => {
  let sql: Sql;
  let app: INestApplication;
  let w: World;
  const api = () => request(app.getHttpServer());
  const local = (e164: string) => e164.slice(4);
  async function business(phone: string) {
    const s = await api().post('/api/v1/auth/business/signin').send({ phone: local(phone), pin: GOOD_PIN }).expect(200);
    return (await api().post('/api/v1/auth/business/signin/verify').send({ ticket: s.body.ticket, code: await lastSmsCode(sql, phone) }).expect(200)).body as { accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    sql = await resetDb();
    app = await createTestApp(sql);
    w = await seedWorld(sql);
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it('owner sets a card colour from the palette and a logo; customers see both', async () => {
    const { accessToken: t } = await business(w.owner.phone);
    await api().post('/api/v1/owner/look').auth(t, { type: 'bearer' }).send({ color: '#123456' }).expect(400);
    await api().post('/api/v1/owner/look').auth(t, { type: 'bearer' }).send({ color: '#0F6E4B' }).expect(201);
    await api().post('/api/v1/owner/look/logo').auth(t, { type: 'bearer' }).send({ dataUrl: 'data:image/png;base64,bm90IGFuIGltYWdl' }).expect(400);
    await api().post('/api/v1/owner/look/logo').auth(t, { type: 'bearer' }).send({ dataUrl: PNG_1PX }).expect(201);
    const shop = (await api().get('/api/v1/shops/MOKA01').expect(200)).body;
    expect(shop).toMatchObject({ color: '#0F6E4B', logoUrl: expect.stringContaining('/api/v1/shops/MOKA01/logo') });
    const img = await api().get('/api/v1/shops/MOKA01/logo').expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    const look = (await api().get('/api/v1/owner/look').auth(t, { type: 'bearer' }).expect(200)).body;
    expect(look).toMatchObject({ color: '#0F6E4B', logoUrl: expect.any(String) });
  });

  it('a manager cannot change the look', async () => {
    const { accessToken: m } = await business(w.manager.phone);
    await api().post('/api/v1/owner/look').auth(m, { type: 'bearer' }).send({ color: '#C8341F' }).expect(403);
    await api().post('/api/v1/owner/look/logo').auth(m, { type: 'bearer' }).send({ dataUrl: PNG_1PX }).expect(403);
  });

  it('change own PIN needs the current one, refuses weak PINs, and keeps this phone signed in', async () => {
    const { accessToken: t } = await business(w.ownerB.phone);
    const wrong = await api().post('/api/v1/owner/security/pin').auth(t, { type: 'bearer' }).send({ current: '000001', pin: '730194' }).expect(401);
    expect(wrong.body.error).toBe('wrong_pin');
    await api().post('/api/v1/owner/security/pin').auth(t, { type: 'bearer' }).send({ current: GOOD_PIN, pin: '111111' }).expect(400);
    const ok = await api().post('/api/v1/owner/security/pin').auth(t, { type: 'bearer' }).send({ current: GOOD_PIN, pin: '730194' }).expect(201);
    expect(ok.body.accessToken).toBeTruthy();
    await api().get('/api/v1/me').auth(ok.body.accessToken, { type: 'bearer' }).expect(200);
    await api().post('/api/v1/auth/business/signin').send({ phone: local(w.ownerB.phone), pin: '730194' }).expect(200);
  });

  it('sign out of all other phones keeps only this one', async () => {
    const a = await business(w.manager.phone);
    const b = await business(w.manager.phone);
    await api().post('/api/v1/owner/security/signout-others').auth(a.accessToken, { type: 'bearer' }).expect(201);
    await api().get('/api/v1/me').auth(a.accessToken, { type: 'bearer' }).expect(200);
    await api().get('/api/v1/me').auth(b.accessToken, { type: 'bearer' }).expect(401);
  });

  it('date and time settings are kept per person', async () => {
    const { accessToken: t } = await business(w.owner.phone);
    await api().post('/api/v1/owner/prefs').auth(t, { type: 'bearer' }).send({ calendar: 'moon' }).expect(400);
    await api().post('/api/v1/owner/prefs').auth(t, { type: 'bearer' }).send({ calendar: 'eth', clock: 'eth' }).expect(201);
    expect((await api().get('/api/v1/owner/prefs').auth(t, { type: 'bearer' }).expect(200)).body).toEqual({ calendar: 'eth', clock: 'eth' });
  });
});
