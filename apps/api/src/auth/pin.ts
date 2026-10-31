import { hash, verify, Algorithm } from '@node-rs/argon2';

/** Ethiopian mobile as typed (912345678, 0912 345 678, +251912345678) to +251912345678, or null. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = input.replace(/[\s-]/g, '');
  if (d.startsWith('+251')) d = d.slice(4);
  else if (d.startsWith('251') && d.length === 12) d = d.slice(3);
  else if (d.startsWith('0') && d.length === 10) d = d.slice(1);
  return /^[79]\d{8}$/.test(d) ? `+251${d}` : null;
}

/** "+251 •• ••• 4417", as on the OTP screens. */
export function maskPhone(e164: string): string {
  return `+251 •• ••• ${e164.slice(-4)}`;
}

export function isPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

/**
 * Easy-to-guess PINs, from the prototype's Staff `weak` and Owner `weakPin`:
 * one digit six times, any run of 0123456789 or 9876543210, 123123, or the
 * last six digits of the person's own phone.
 */
export function isWeakPin(pin: string, phone?: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return true;
  if (pin === '123123') return true;
  if (phone && phone.replace(/\D/g, '').slice(-6) === pin) return true;
  return false;
}

// argon2id, OWASP's recommended minimum (19 MiB, 2 passes).
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** Slow salted hash for PINs and one-time codes. */
export function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON);
}

export async function verifySecret(hashed: string | null | undefined, secret: string): Promise<boolean> {
  if (!hashed) return false;
  try {
    return await verify(hashed, secret);
  } catch {
    return false;
  }
}

/** A hash of a throwaway value, so an unknown phone takes as long as a wrong PIN. */
let dummy: Promise<string> | undefined;
export async function burnTime(secret: string): Promise<void> {
  dummy ??= hashSecret('000000-dummy');
  await verifySecret(await dummy, secret);
}
