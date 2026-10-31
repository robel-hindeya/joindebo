/**
 * Rotating card codes and reward codes, shared by the customer app (which
 * computes card codes offline) and the API (which checks them).
 *
 * Card code for minute m: HMAC-SHA256(card secret, "<shop>:<short>:<m>").
 *   QR form:    TC1:<SHOPCODE>:<SHORT>:<m>:<10 base32 chars of the MAC>
 *   Typed form: <SHORT>-<6 digits from the MAC>   (printed under the QR)
 * Reward code: 8 base32 characters, QR form TCR:<CODE>.
 * Uses Web Crypto, so it runs in browsers and in Node 20+.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const CODE_PERIOD_MS = 60_000;

export function minuteOf(at: Date | number): number {
  return Math.floor((typeof at === 'number' ? at : at.getTime()) / CODE_PERIOD_MS);
}

export function base32(bytes: Uint8Array, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export interface CardCode {
  qr: string;
  typed: string;
  minute: number;
}

/** The card's code for a minute. `secret` is base64url, as the API sends it. */
export async function cardCode(secret: string, shopCode: string, short: string, minute: number): Promise<CardCode> {
  const mac = await hmac(fromBase64Url(secret), `${shopCode}:${short}:${minute}`);
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return {
    qr: `TC1:${shopCode}:${short}:${minute}:${base32(mac.subarray(4), 10)}`,
    typed: `${short}-${String(n % 1_000_000).padStart(6, '0')}`,
    minute,
  };
}

export type ParsedCode =
  | { kind: 'card_qr'; shopCode: string; short: string; minute: number; mac: string }
  | { kind: 'card_typed'; short: string; digits: string }
  | { kind: 'reward'; code: string }
  | { kind: 'phone'; local: string }
  | { kind: 'unknown' };

/** Read whatever the staff scanned or typed. */
export function parseCode(raw: string): ParsedCode {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  let m = /^TC1:([A-Z0-9]{2,12}):([A-Z2-7]{4}):(\d{1,12}):([A-Z2-7]{10})$/.exec(s);
  if (m) return { kind: 'card_qr', shopCode: m[1], short: m[2], minute: Number(m[3]), mac: m[4] };
  m = /^([A-Z2-7]{4})-?(\d{6})$/.exec(s);
  if (m) return { kind: 'card_typed', short: m[1], digits: m[2] };
  m = /^(?:TCR:)?([A-Z2-7]{8})$/.exec(s);
  if (m) return { kind: 'reward', code: m[1] };
  const d = s.replace(/^\+?251/, '').replace(/^0/, '');
  if (/^[79]\d{8}$/.test(d)) return { kind: 'phone', local: d };
  return { kind: 'unknown' };
}

/** Reward code: 8 base32 characters derived from a server secret and the reward id. */
export async function rewardCode(serverSecret: string, rewardId: string): Promise<string> {
  return base32(await hmac(new TextEncoder().encode(serverSecret), `reward:${rewardId}`), 8);
}

/** Seconds until the code changes ("New code in 23s"). */
export function secondsLeft(now: number = Date.now()): number {
  return Math.ceil((CODE_PERIOD_MS - (now % CODE_PERIOD_MS)) / 1000);
}
