/**
 * The SMS provider seen by the sender (dispatcher.ts). SMS Ethiopia is the one
 * provider (DECISIONS.md); SMS_PROVIDER picks it.
 */
import { SmsEthiopiaProvider } from './smsethiopia';

/** Delivers one message; returns the provider's message id. */
export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string): Promise<{ ref: string | null }>;
  /** Delivery status and cost of a sent message, when the provider can tell. */
  status?(ref: string): Promise<{ status: 'delivered' | 'failed' | 'sent'; cost: number | null }>;
}

/** A failed send. The message never contains the key or the SMS text. */
export class SmsSendError extends Error {}

/** The provider chosen by SMS_PROVIDER; null keeps messages in the outbox only (local development). */
export function smsProviderFromEnv(env: Record<string, string | undefined> = process.env): SmsProvider | null {
  if (env.SMS_PROVIDER !== 'smsethiopia') return null;
  if (!env.SMSETHIOPIA_KEY) throw new Error('SMS_PROVIDER=smsethiopia needs SMSETHIOPIA_KEY');
  return new SmsEthiopiaProvider({ key: env.SMSETHIOPIA_KEY, baseUrl: env.SMSETHIOPIA_BASE_URL || undefined });
}
