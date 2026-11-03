/**
 * SMS Ethiopia (https://smsethiopia.com, Docs → SMS API v2), the SMS provider
 * (DECISIONS.md). One message per call: POST {baseUrl}/v2/sms/send with the
 * API key in the KEY header. The key belongs to one campaign, which fixes the
 * Sender ID and the SMS package, so there is no sender field. Business errors
 * come back as HTTP 400 with `error_message` ("... Error Code :: 10005").
 */
import { SmsSendError, type SmsProvider } from './provider';

export interface SmsEthiopiaOptions {
  key: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class SmsEthiopiaProvider implements SmsProvider {
  readonly name = 'smsethiopia';
  private readonly baseUrl: string;

  constructor(private readonly o: SmsEthiopiaOptions) {
    this.baseUrl = (o.baseUrl ?? 'https://smsethiopia.com/api').replace(/\/+$/, '');
  }

  async send(to: string, message: string): Promise<{ ref: string | null }> {
    // Phones are stored as +2519XXXXXXXX; SMS Ethiopia wants 2519XXXXXXXX.
    const body = { msisdn: to.replace(/^\+/, ''), text: message };
    const res = await this.call(`${this.baseUrl}/v2/sms/send`, { method: 'POST', body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as { sent?: boolean; id?: string | number; description?: string } | null;
    if (json?.sent !== true) throw new SmsSendError(`SMS Ethiopia refused: ${String(json?.description ?? 'no reason given').slice(0, 300)}`);
    return { ref: json.id !== undefined && json.id !== null && json.id !== 0 ? String(json.id) : null };
  }

  /** GET {baseUrl}/v2/sms/{id}. SMS Ethiopia reports no cost per message. */
  async status(ref: string): Promise<{ status: 'delivered' | 'failed' | 'sent'; cost: number | null }> {
    const res = await this.call(`${this.baseUrl}/v2/sms/${encodeURIComponent(ref)}`, { method: 'GET' });
    const json = (await res.json().catch(() => null)) as { status?: string } | null;
    return { status: smsEthiopiaStatus(json?.status), cost: null };
  }

  private async call(url: string, init: { method: string; body?: string }): Promise<Response> {
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(url, {
        ...init,
        headers: { KEY: this.o.key, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      throw new SmsSendError(`SMS Ethiopia unreachable: ${cause ?? (e as Error).name ?? 'network error'}${e instanceof Error && !cause ? ` (${e.message.slice(0, 80)})` : ''}`);
    }
    if (res.ok) return res;
    // 400 carries the reason (error_message, or one message per missing field); it never echoes the key or the text.
    if (res.status === 400) {
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const reason = typeof json?.error_message === 'string' ? json.error_message : json ? Object.values(json).map(String).join('; ') : 'no reason given';
      throw new SmsSendError(`SMS Ethiopia refused: ${reason.slice(0, 300)}`);
    }
    // 401 means a missing, wrong or deactivated key; 429 the account's rate limit.
    throw new SmsSendError(`SMS Ethiopia HTTP ${res.status}`);
  }
}

/** SMS Ethiopia's status as ours: DELIVERED, a final failure, or still on the way (ACCEPTED, SENT). */
export function smsEthiopiaStatus(raw: unknown): 'delivered' | 'failed' | 'sent' {
  const v = String(raw ?? '').toUpperCase();
  if (v.startsWith('DELIV')) return 'delivered';
  if (['UNDELIV', 'FAILED', 'EXPIRED', 'REJECTED'].some((x) => v.startsWith(x))) return 'failed';
  return 'sent';
}
