import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Authenticator codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), and
 * encryption of the shared secrets at rest (AES-256-GCM with ADMIN_TOTP_KEY).
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function newSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

function decodeBase32(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const stepOf = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

export function totp(secret: string, step = stepOf()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  const n = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/**
 * The step a code belongs to, allowing one step of clock drift either way, or
 * null. Steps at or before `lastStep` are refused, so a code works once.
 */
export function verifyTotp(secret: string, code: unknown, lastStep: number): number | null {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const now = stepOf();
  for (const s of [now, now - 1, now + 1]) {
    if (s <= lastStep) continue;
    const want = totp(secret, s);
    if (timingSafeEqual(Buffer.from(want), Buffer.from(code))) return s;
  }
  return null;
}

export function otpauthUri(secret: string, email: string): string {
  return `otpauth://totp/Temelash:${encodeURIComponent(email)}?secret=${secret}&issuer=Temelash&period=${STEP_SECONDS}&digits=6`;
}

function key(): Buffer {
  const raw = process.env.ADMIN_TOTP_KEY ?? '';
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('ADMIN_TOTP_KEY must be 32 bytes, base64');
  return k;
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, enc] = stored.split('.');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

/** Ten one-time backup codes like "K7Q2-M4TP", shown once. */
export function newBackupCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const out = Array.from({ length: 8 }, () => B32[randomInt(32)]).join('');
    return `${out.slice(0, 4)}-${out.slice(4)}`;
  });
}
