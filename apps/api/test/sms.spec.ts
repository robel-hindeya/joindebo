/**
 * SMS delivery: the AfroMessage client and the sender that delivers queued
 * rows from tc.sms_outbox (retries, expired codes, nothing secret in errors).
 */
import type { Sql } from '@temelash/db';
import { AfroMessageProvider, SmsSendError } from '../src/sms/afromessage';
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

const ok = (id = '9ab2867c-96ce-4405-b890-8d35d52c8e01') => ({ body: { acknowledge: 'success', response: { status: 'Send in progress...', message_id: id } } });

describe('AfroMessage client', () => {
  it('posts the message with the token, sender and identifier, and returns the message id', async () => {
    const f = fakeFetch(() => ok('m-1'));
    const p = new AfroMessageProvider({ token: 'tok', sender: 'Temelash', identifier: 'id-1', baseUrl: 'https://api.afromessage.com/api', fetch: f.fn });
    await expect(p.send('+251911223344', 'Temelash Card code: 123456.')).resolves.toEqual({ ref: 'm-1' });
    expect(f.calls[0].url).toBe('https://api.afromessage.com/api/send');
    expect(f.calls[0].init.method).toBe('POST');
    expect(new Headers(f.calls[0].init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ from: 'id-1', sender: 'Temelash', to: '+251911223344', message: 'Temelash Card code: 123456.' });
  });

  it('leaves out the sender and identifier when not set (AfroMessage defaults)', async () => {
    const f = fakeFetch(() => ok());
    await new AfroMessageProvider({ token: 'tok', fetch: f.fn }).send('+251911223344', 'hi');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ to: '+251911223344', message: 'hi' });
  });

  it('turns an "error" acknowledge into an error carrying AfroMessage\'s reasons', async () => {
    const f = fakeFetch(() => ({ body: { acknowledge: 'error', response: { errors: ['Unable to send your message. Insufficient balance...'] } } }));
    const e = await new AfroMessageProvider({ token: 'tok', fetch: f.fn }).send('+251911223344', 'code 123456').catch((x) => x);
    expect(e).toBeInstanceOf(SmsSendError);
    expect(e.message).toContain('Insufficient balance');
  });

  it('reports HTTP failures by status, without the token or the message', async () => {
    const f = fakeFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
    const e = await new AfroMessageProvider({ token: 'secret-token', fetch: f.fn }).send('+251911223344', 'code 654321').catch((x) => x);
    expect(e).toBeInstanceOf(SmsSendError);
    expect(e.message).toContain('401');
    expect(e.message).not.toContain('secret-token');
    expect(e.message).not.toContain('654321');
  });
});

describeDb('SMS sender (outbox to AfroMessage)', () => {
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
    new SmsDispatcher(sql, new SettingsService(sql), new AfroMessageProvider({ token: 'tok', fetch: f.fn }));

  it('sends queued messages and records the AfroMessage id', async () => {
    await queue('+251911000001', 'Temelash Card code: 111111.', 5);
    await queue('+251911000002', 'Temelash Card: Moka House is approved.');
    const f = fakeFetch(() => ok('m-42'));
    expect(await dispatcher(f).runOnce()).toBe(2);
    const rows = await sql`select status, provider, provider_ref, sent_at, attempts from tc.sms_outbox order by phone`;
    expect(rows).toEqual([
      expect.objectContaining({ status: 'sent', provider: 'afromessage', provider_ref: 'm-42', attempts: 1, sent_at: expect.any(Date) }),
      expect.objectContaining({ status: 'sent', provider: 'afromessage', provider_ref: 'm-42', attempts: 1 }),
    ]);
    // A second run sends nothing again.
    expect(await dispatcher(f).runOnce()).toBe(0);
    expect(f.calls).toHaveLength(2);
  });

  it('retries a failed send later, and gives up after sms.max_attempts', async () => {
    await queue('+251911000003', 'Temelash Card code: 222222.', 60);
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
    await queue('+251911000004', 'Temelash Card code: 333333.', -1);
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
    expect(new Set(f.calls.map((c) => JSON.parse(String(c.init.body)).to)).size).toBe(10);
  });
});
