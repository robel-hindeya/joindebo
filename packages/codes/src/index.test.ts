import { describe, expect, it } from 'vitest';
import { cardCode, minuteOf, parseCode, rewardCode, secondsLeft } from './index';

const SECRET = 'q3Jx0n0b6YJ2v1nQyWm2vK4cX8pS3hT7uL9eR5aD1fE'; // 32 bytes, base64url

describe('card codes', () => {
  it('are stable for a minute and change the next', async () => {
    const a = await cardCode(SECRET, 'MOKA01', 'K7Q2', 29000000);
    const b = await cardCode(SECRET, 'MOKA01', 'K7Q2', 29000000);
    const c = await cardCode(SECRET, 'MOKA01', 'K7Q2', 29000001);
    expect(a).toEqual(b);
    expect(a.qr).not.toBe(c.qr);
    expect(a.qr).toMatch(/^TC1:MOKA01:K7Q2:29000000:[A-Z2-7]{10}$/);
    expect(a.typed).toMatch(/^K7Q2-\d{6}$/);
  });

  it('depend on the secret and the shop', async () => {
    const a = await cardCode(SECRET, 'MOKA01', 'K7Q2', 1);
    expect((await cardCode(SECRET.replace('q', 'r'), 'MOKA01', 'K7Q2', 1)).qr).not.toBe(a.qr);
    expect((await cardCode(SECRET, 'SHEB02', 'K7Q2', 1)).qr.split(':')[4]).not.toBe(a.qr.split(':')[4]);
  });

  it('use one-minute periods', () => {
    expect(minuteOf(120_000)).toBe(2);
    expect(secondsLeft(125_000)).toBe(55);
  });
});

describe('parsing what staff scan or type', () => {
  it('reads every form', async () => {
    const c = await cardCode(SECRET, 'MOKA01', 'K7Q2', 5);
    expect(parseCode(c.qr)).toMatchObject({ kind: 'card_qr', shopCode: 'MOKA01', short: 'K7Q2', minute: 5 });
    expect(parseCode(' k7q2-123456 ')).toEqual({ kind: 'card_typed', short: 'K7Q2', digits: '123456' });
    expect(parseCode('K7Q2123456')).toEqual({ kind: 'card_typed', short: 'K7Q2', digits: '123456' });
    expect(parseCode('TCR:ABCD2345')).toEqual({ kind: 'reward', code: 'ABCD2345' });
    expect(parseCode('abcd2345')).toEqual({ kind: 'reward', code: 'ABCD2345' });
    expect(parseCode('0912 345 678')).toEqual({ kind: 'phone', local: '912345678' });
    expect(parseCode('+251912345678')).toEqual({ kind: 'phone', local: '912345678' });
    expect(parseCode('hello')).toEqual({ kind: 'unknown' });
  });
});

describe('reward codes', () => {
  it('are 8 characters, stable per reward', async () => {
    const a = await rewardCode('server-secret', '1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(a).toMatch(/^[A-Z2-7]{8}$/);
    expect(await rewardCode('server-secret', '1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe(a);
    expect(await rewardCode('server-secret', '2b4e28ba-2fa1-11d2-883f-0016d3cca427')).not.toBe(a);
  });
});
