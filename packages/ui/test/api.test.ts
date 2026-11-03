/**
 * authed(): the one way the four apps call the API as the signed-in person.
 * Found in the browser check: a wrong PIN inside an app must not sign people out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, authed, loadSession, saveSession } from '../src/api';

type Reply = { status: number; body: Record<string, unknown> };
let replies: Reply[];
let calls: Array<{ url: string; auth: string | null }>;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } });
  replies = [];
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: { headers?: Record<string, string> }) => {
    calls.push({ url, auth: init.headers?.authorization ?? null });
    const r = replies.shift() ?? { status: 500, body: { error: 'no reply set' } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
  saveSession('owner', { accessToken: 'old-access', refreshToken: 'old-refresh' });
});
afterEach(() => vi.unstubAllGlobals());

describe('authed', () => {
  it('returns the answer with the saved access token', async () => {
    replies.push({ status: 200, body: { ok: true } });
    expect(await authed('owner', 'GET', '/owner/today')).toEqual({ ok: true });
    expect(calls).toEqual([{ url: '/api/v1/owner/today', auth: 'Bearer old-access' }]);
  });

  it('renews an ended access token once and retries', async () => {
    replies.push({ status: 401, body: { error: 'bad_ticket' } }, { status: 200, body: { accessToken: 'new-access', refreshToken: 'new-refresh' } }, { status: 200, body: { ok: true } });
    expect(await authed('owner', 'GET', '/owner/today')).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/owner/today', '/api/v1/auth/refresh', '/api/v1/owner/today']);
    expect(loadSession('owner')).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('signs out when the session cannot be renewed', async () => {
    replies.push({ status: 401, body: { error: 'session_ended' } }, { status: 401, body: { error: 'bad_refresh' } });
    await expect(authed('owner', 'GET', '/owner/today')).rejects.toMatchObject({ status: 401, code: 'bad_refresh' });
    expect(loadSession('owner')).toBeNull();
  });

  it.each(['wrong_pin', 'wrong_code', 'wrong_login'])('a %s answer goes back to the screen and keeps the session', async (code) => {
    replies.push({ status: 401, body: { error: code, triesLeft: 4 } });
    const e = await authed('owner', 'POST', '/owner/close', { pin: '000000' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e).toMatchObject({ status: 401, code, body: { triesLeft: 4 } });
    expect(calls.length).toBe(1);
    expect(loadSession('owner')).toEqual({ accessToken: 'old-access', refreshToken: 'old-refresh' });
  });

  it('refuses at once with no saved session', async () => {
    saveSession('owner', null);
    await expect(authed('owner', 'GET', '/owner/today')).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    expect(calls).toEqual([]);
  });
});
