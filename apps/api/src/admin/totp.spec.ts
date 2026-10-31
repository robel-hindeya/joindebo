import { decryptSecret, encryptSecret, newBackupCodes, newSecret, otpauthUri, totp, verifyTotp } from './totp';

describe('authenticator codes', () => {
  // RFC 6238 test vector: secret "12345678901234567890", time 59 s -> 94287082 (8 digits), 6 digits 287082.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it('matches the RFC 6238 vector', () => {
    expect(totp(RFC_SECRET, 1)).toBe('287082');
  });

  it('accepts the current code once, refuses replays and wrong codes', () => {
    const s = newSecret();
    const code = totp(s);
    const step = verifyTotp(s, code, 0);
    expect(step).not.toBeNull();
    expect(verifyTotp(s, code, step!)).toBeNull();
    expect(verifyTotp(s, '000000' === code ? '111111' : '000000', 0)).toBeNull();
    expect(verifyTotp(s, '12345', 0)).toBeNull();
  });

  it('encrypts secrets at rest and reads them back', () => {
    process.env.ADMIN_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
    const s = newSecret();
    const enc = encryptSecret(s);
    expect(enc).not.toContain(s);
    expect(decryptSecret(enc)).toBe(s);
  });

  it('makes 10 distinct backup codes and an otpauth link', () => {
    const codes = newBackupCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(otpauthUri('ABC', 'a@b.et')).toBe('otpauth://totp/Temelash:a%40b.et?secret=ABC&issuer=Temelash&period=30&digits=6');
  });
});
