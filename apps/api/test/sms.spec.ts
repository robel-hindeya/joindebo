/**
 * SMS delivery: the SMS Ethiopia client and the sender that delivers queued
 * rows from tc.sms_outbox (retries, expired codes, nothing secret in errors).
 */
import type { Sql } from '@temelash/db';
import { SmsSendError, smsProviderFromEnv } from '../src/sms/provider';
import { SmsEthiopiaProvider, smsEthiopiaStatus } from '../src/sms/smsethiopia';
import { SmsDispatcher } from '../src/sms/dispatcher';
import { SettingsService } from '../src/settings/settings.service';
import { describeDb, resetDb } from './harness';

type Call = { url: string; init: RequestInit };

function fakeFetch(reply: (call: Call) => { status?: number; body: unknown } | Error) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const r = reply(call);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (id = '01JZX5M8Q3T5V0X8YW9RCB2K7D') => ({ body: { sent: true, id, description: 'Accepted for delivery', segments: 1, status: 'ACCEPTED' } });

describe('SMS Ethiopia client', () => {
  it('posts the message with the KEY header to API v2 and returns the message id', async () => {
    const f = fakeFetch(() => ok('m-1'));
    const p = new SmsEthiopiaProvider({ key: 'k', baseUrl: 'https://smsethiopia.com/api', fetch: f.fn });
    await expect(p.send('+251911223344', 'Join Debo code: 123456.')).resolves.toEqual({ ref: 'm-1' });
    expect(f.calls[0].url).toBe('https://smsethiopia.com/api/v2/sms/send');
    expect(f.calls[0].init.method).toBe('POST');
    expect(new Headers(f.calls[0].init.headers).get('key')).toBe('k');
    // SMS Ethiopia wants 2519XXXXXXXX: no plus sign.
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ msisdn: '251911223344', text: 'Join Debo code: 123456.' });
  });

  it('turns a business error (HTTP 400, error_message) into an error carrying the reason', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error_message: "You don't have enough package to send sms please contact with system Administrator. Error Code :: 10005" } }));
    const e = await new SmsEthiopiaProvider({ key: 'k', fetch: f.fn }).send('+251911223344', 'code 123456').catch((x) => x);
    expect(e).toBeInstanceOf(SmsSendError);
    expect(e.message).toContain('10005');
    expect(e.message).not.toContain('123456');
  });

  it('names the missing fields of a 400 answer', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { text: 'text is mandatory' } }));
    const e = await new SmsEthiopiaProvider({ key: 'k', fetch: f.fn }).send('+251911223344', 'x').catch((x) => x);
    expect(e.message).toContain('text is mandatory');
  });

  it('treats an answer without sent: true as a failure', async () => {
    const f = fakeFetch(() => ({ body: { sent: false, description: 'Not accepted' } }));
    const e = await new SmsEthiopiaProvider({ key: 'k', fetch: f.fn }).send('+251911223344', 'x').catch((x) => x);
    expect(e).toBeInstanceOf(SmsSendError);
    expect(e.message).toContain('Not accepted');
  });

  it('reports HTTP failures by status, without the key or the message', async () => {
    const f = fakeFetch(() => ({ status: 401, body: {} }));
    const e = await new SmsEthiopiaProvider({ key: 'secret-key', fetch: f.fn }).send('+251911223344', 'code 654321').catch((x) => x);
    expect(e).toBeInstanceOf(SmsSendError);
    expect(e.message).toContain('401');
    expect(e.message).not.toContain('secret-key');
    expect(e.message).not.toContain('654321');
  });

  it('looks up delivery status by id; SMS Ethiopia gives no cost', async () => {
    const f = fakeFetch(() => ({ body: { id: 'm-1', msisdn: '251911223344', segments: 1, status: 'DELIVERED' } }));
    await expect(new SmsEthiopiaProvider({ key: 'k', fetch: f.fn }).status('m-1')).resolves.toEqual({ status: 'delivered', cost: null });
    expect(f.calls[0].url).toBe('https://smsethiopia.com/api/v2/sms/m-1');
    expect(f.calls[0].init.method ?? 'GET').toBe('GET');
  });

  it.each([['DELIVERED', 'delivered'], ['ACCEPTED', 'sent'], ['SENT', 'sent'], ['FAILED', 'failed'], ['UNDELIVERED', 'failed'], ['EXPIRED', 'failed'], ['', 'sent']])('status %s is %s', (raw, want) => {
    expect(smsEthiopiaStatus(raw)).toBe(want);
  });

  it('is chosen by SMS_PROVIDER=smsethiopia and needs SMSETHIOPIA_KEY', () => {
    expect(smsProviderFromEnv({})).toBeNull();
    expect(smsProviderFromEnv({ SMS_PROVIDER: 'smsethiopia', SMSETHIOPIA_KEY: 'k' })?.name).toBe('smsethiopia');
    expect(() => smsProviderFromEnv({ SMS_PROVIDER: 'smsethiopia' })).toThrow(/SMSETHIOPIA_KEY/);
  });
});

describeDb('SMS sender (outbox to SMS Ethiopia)', () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = await resetDb();
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await sql`delete from tc.sms_outbox`;
  });

  const queue = (phone: string, body: string, expiresMinutes: number | null = null) =>
    sql`insert into tc.sms_outbox (phone, template, body, expires_at)
        values (${phone}, 'test', ${body}, ${expiresMinutes === null ? null : sql`now() + make_interval(mins => ${expiresMinutes})`})`;
  const dispatcher = (f: ReturnType<typeof fakeFetch>) =>
    new SmsDispatcher(sql, new SettingsService(sql), new SmsEthiopiaProvider({ key: 'k', fetch: f.fn }));

  it('sends queued messages and records the SMS Ethiopia id', async () => {
    await queue('+251911000001', 'Join Debo code: 111111.', 5);
    await queue('+251911000002', 'Join Debo: Moka House is approved.');
    const f = fakeFetch(() => ok('m-42'));
    expect(await dispatcher(f).runOnce()).toBe(2);
    const rows = await sql`select status, provider, provider_ref, sent_at, attempts from tc.sms_outbox order by phone`;
    expect(rows).toEqual([
      expect.objectContaining({ status: 'sent', provider: 'smsethiopia', provider_ref: 'm-42', attempts: 1, sent_at: expect.any(Date) }),
      expect.objectContaining({ status: 'sent', provider: 'smsethiopia', provider_ref: 'm-42', attempts: 1 }),
    ]);
    // A second run sends nothing again.
    expect(await dispatcher(f).runOnce()).toBe(0);
    expect(f.calls).toHaveLength(2);
  });

  it('retries a failed send later, and gives up after sms.max_attempts', async () => {
    await queue('+251911000003', 'Join Debo code: 222222.', 60);
    const f = fakeFetch(() => new Error('connect ETIMEDOUT'));
    const d = dispatcher(f);
    await d.runOnce();
    let [r] = await sql`select status, attempts, last_error, next_try_at > now() as later from tc.sms_outbox`;
    expect(r).toMatchObject({ status: 'queued', attempts: 1, later: true });
    expect(r.last_error).toContain('ETIMEDOUT');
    expect(r.last_error).not.toContain('222222');
    // Not due yet: nothing is sent.
    await d.runOnce();
    expect(f.calls).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      await sql`update tc.sms_outbox set next_try_at = now()`;
      await d.runOnce();
    }
    [r] = await sql`select status, attempts from tc.sms_outbox`;
    expect(r).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('does not send a sign-in code that has already expired', async () => {
    await queue('+251911000004', 'Join Debo code: 333333.', -1);
    const f = fakeFetch(() => ok());
    await dispatcher(f).runOnce();
    expect(f.calls).toHaveLength(0);
    const [r] = await sql`select status, last_error from tc.sms_outbox`;
    expect(r).toMatchObject({ status: 'failed', last_error: 'expired' });
  });

  it('two senders never send the same message twice', async () => {
    for (let i = 0; i < 10; i++) await queue(`+25191100010${i}`, `msg ${i}`);
    const f = fakeFetch(() => ok());
    await Promise.all([dispatcher(f).runOnce(), dispatcher(f).runOnce()]);
    expect(f.calls).toHaveLength(10);
    expect(new Set(f.calls.map((c) => JSON.parse(String(c.init.body)).msisdn)).size).toBe(10);
  });
});
