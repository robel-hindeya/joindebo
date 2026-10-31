/**
 * AfroMessage (https://www.afromessage.com/developers), the SMS provider
 * (DECISIONS.md). One message per call: POST {baseUrl}/send with a Bearer
 * token; the reply's `acknowledge` is "success" or "error".
 */

/** Delivers one message; returns the provider's message id. */
export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string): Promise<{ ref: string | null }>;
}

/** A failed send. The message never contains the token or the SMS text. */
export class SmsSendError extends Error {}

export interface AfroMessageOptions {
  token: string;
  /** Verified sender name shown as "from"; empty uses AfroMessage's default (beta testing only). */
  sender?: string;
  /** Identifier id, when the account has more than one short code. */
  identifier?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class AfroMessageProvider implements SmsProvider {
  readonly name = 'afromessage';
  private readonly baseUrl: string;

  constructor(private readonly o: AfroMessageOptions) {
    this.baseUrl = (o.baseUrl ?? 'https://api.afromessage.com/api').replace(/\/+$/, '');
  }

  async send(to: string, message: string): Promise<{ ref: string | null }> {
    const body: Record<string, string> = {};
    if (this.o.identifier) body.from = this.o.identifier;
    if (this.o.sender) body.sender = this.o.sender;
    body.to = to;
    body.message = message;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(`${this.baseUrl}/send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.o.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      throw new SmsSendError(`AfroMessage unreachable: ${cause ?? (e as Error).name ?? 'network error'}${e instanceof Error && !cause ? ` (${e.message.slice(0, 80)})` : ''}`);
    }
    // 401/403 mostly mean a wrong or missing token.
    if (!res.ok) throw new SmsSendError(`AfroMessage HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as { acknowledge?: string; response?: { message_id?: string; errors?: unknown } } | null;
    if (json?.acknowledge !== 'success') {
      const errors = Array.isArray(json?.response?.errors) ? json!.response!.errors.map(String).join('; ') : 'no reason given';
      throw new SmsSendError(`AfroMessage refused: ${errors.slice(0, 300)}`);
    }
    return { ref: json.response?.message_id ?? null };
  }
}

/** The provider chosen by SMS_PROVIDER; null keeps messages in the outbox only (local development). */
export function smsProviderFromEnv(env: Record<string, string | undefined> = process.env): SmsProvider | null {
  if (env.SMS_PROVIDER !== 'afromessage') return null;
  if (!env.AFROMESSAGE_TOKEN) throw new Error('SMS_PROVIDER=afromessage needs AFROMESSAGE_TOKEN');
  return new AfroMessageProvider({
    token: env.AFROMESSAGE_TOKEN,
    sender: env.AFROMESSAGE_SENDER || undefined,
    identifier: env.AFROMESSAGE_IDENTIFIER || undefined,
    baseUrl: env.AFROMESSAGE_BASE_URL || undefined,
  });
}
