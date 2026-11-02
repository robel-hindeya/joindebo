/**
 * The email sender (account recovery and new-device emails): off until a provider is set,
 * sends queued rows once, records failures, gives up after five tries, never sends blanked bodies.
 */
import type { Sql } from '@temelash/db';
import { EmailDispatcher, emailFromEnv, type EmailTransport } from '../src/email/dispatcher';
import { describeDb, migrateFresh, resetDb } from './harness';

describeDb('email sender', () => {
  let sql: Sql;
  const queue = (to: string, body = 'Hello') => sql`insert into tc.email_outbox (to_email, template, subject, body) values (${to}, 't', 'Subject', ${body})`;

  beforeAll(async () => { sql = await resetDb(); });
  beforeEach(async () => { await migrateFresh(sql); });
  afterAll(async () => { await sql?.end(); });

  it('is off without a provider, and refuses a half-set SMTP configuration', async () => {
    expect(emailFromEnv({})).toBeNull();
    expect(() => emailFromEnv({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'mail.example.com' })).toThrow(/SMTP_USER, SMTP_PASS, EMAIL_FROM/);
    await queue('a@temelash.et');
    expect(await new EmailDispatcher(sql, null).runOnce()).toBe(0);
    expect((await sql`select sent_at from tc.email_outbox`)[0].sent_at).toBeNull();
  });

  it('sends each queued email once, from the configured address', async () => {
    const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];
    const transport: EmailTransport = { sendMail: async (m) => { sent.push(m); } };
    const d = new EmailDispatcher(sql, { transport, from: 'Temelash <no-reply@temelash.et>' });
    await queue('a@temelash.et');
    await queue('b@temelash.et');
    await queue('blank@temelash.et', '');
    expect(await d.runOnce()).toBe(2);
    expect(await d.runOnce()).toBe(0);
    expect(sent.map((m) => m.to).sort()).toEqual(['a@temelash.et', 'b@temelash.et']);
    expect(sent[0]).toMatchObject({ from: 'Temelash <no-reply@temelash.et>', subject: 'Subject', text: 'Hello' });
  });

  it('records a failure and stops after five tries', async () => {
    const transport: EmailTransport = { sendMail: async () => { throw new Error('connection refused'); } };
    const d = new EmailDispatcher(sql, { transport, from: 'x@temelash.et' });
    await queue('a@temelash.et');
    for (let i = 0; i < 7; i++) await d.runOnce();
    expect((await sql`select attempts, last_error, sent_at from tc.email_outbox`)[0]).toEqual({ attempts: 5, last_error: 'connection refused', sent_at: null });
  });
});
