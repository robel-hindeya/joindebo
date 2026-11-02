/**
 * Talking to the API from the four apps. Every app is served from the same
 * origin as the API (Caddy routes /api), so calls are same-origin.
 */

export const API_BASE = '/api/v1';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export type AppName = 'customer' | 'staff' | 'owner' | 'admin';

const key = (app: AppName) => `tc_session_${app}`;

/** The saved sign-in for this app on this device. Storage can be unavailable; then there is none. */
export function loadSession(app: AppName): Session | null {
  try {
    const raw = window.localStorage.getItem(key(app));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(app: AppName, s: Session | null): void {
  try {
    if (s) window.localStorage.setItem(key(app), JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }));
    else window.localStorage.removeItem(key(app));
  } catch {
    /* private mode or blocked storage: the session lasts for this page only */
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFailure(0, 'offline');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiFailure(res.status, typeof data.error === 'string' ? data.error : 'error', data);
  return data as T;
}

export const apiGet = <T>(path: string, token?: string) => call<T>('GET', path, undefined, token);
export const apiPost = <T>(path: string, body: unknown = {}, token?: string) => call<T>('POST', path, body, token);

/** Answers to a PIN, code or password typed inside the app; they never mean the session ended. */
const WRONG_SECRET = new Set(['wrong_pin', 'wrong_code', 'wrong_login']);

/** A call as the signed-in person; renews the access token once if it has expired. */
export async function authed<T>(app: AppName, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const s = loadSession(app);
  if (!s) throw new ApiFailure(401, 'signed_out');
  try {
    return await call<T>(method, path, body, s.accessToken);
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.status !== 401) throw e;
    // A wrong PIN, code or password asked for inside the app is an answer for the screen,
    // not an ended session: refreshing would retry it and then sign the person out.
    if (WRONG_SECRET.has(e.code)) throw e;
    try {
      const next = await call<Session>('POST', '/auth/refresh', { refreshToken: s.refreshToken });
      saveSession(app, next);
      return await call<T>(method, path, body, next.accessToken);
    } catch (e2) {
      if (e2 instanceof ApiFailure && e2.status === 401) saveSession(app, null);
      throw e2;
    }
  }
}
