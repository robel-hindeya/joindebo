import { hashSecret, isPinFormat, isWeakPin, maskPhone, normalizePhone, verifySecret } from './pin';

describe('phone', () => {
  it.each([
    ['912345678', '+251912345678'],
    ['0912 345 678', '+251912345678'],
    ['+251 712-345-678', '+251712345678'],
    ['251912345678', '+251912345678'],
  ])('normalises %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['812345678', '91234567', '9123456789', '', 'abc', 12345])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('masks like the OTP screen', () => expect(maskPhone('+251911004417')).toBe('+251 •• ••• 4417'));
});

describe('PIN rules', () => {
  it('needs exactly 6 digits', () => {
    expect(isPinFormat('482915')).toBe(true);
    for (const p of ['48291', '4829150', '48a915', 482915]) expect(isPinFormat(p)).toBe(false);
  });

  it.each(['000000', '111111', '012345', '123456', '456789', '987654', '543210', '123123'])('refuses %s', (p) => {
    expect(isWeakPin(p)).toBe(true);
  });

  it('refuses the last six digits of the own phone', () => {
    expect(isWeakPin('100003', '+251911100003')).toBe(true);
    expect(isWeakPin('100003', '+251911100004')).toBe(false);
  });

  it.each(['482915', '730194', '135790', '112233'])('accepts %s', (p) => expect(isWeakPin(p)).toBe(false));
});

describe('hashing', () => {
  it('uses argon2id and verifies', async () => {
    const h = await hashSecret('482915');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).not.toContain('482915');
    await expect(verifySecret(h, '482915')).resolves.toBe(true);
    await expect(verifySecret(h, '482916')).resolves.toBe(false);
    await expect(verifySecret(null, '482915')).resolves.toBe(false);
  });
});
