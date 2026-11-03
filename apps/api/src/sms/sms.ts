import { Inject, Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';

type Tx = Sql | TransactionSql;

export interface SmsOptions {
  /** Sign-in codes are useless after they expire, so they are not sent late. */
  expiresInMinutes?: number;
  /** The text's language, kept with the message. */
  language?: Lang;
  /** News and Temelash messages wait out quiet hours; codes never do. */
  quiet?: boolean;
}

/**
 * Every SMS goes through this interface so the provider can be swapped
 * (build plan, section 9). Messages are recorded in tc.sms_outbox inside the
 * caller's transaction; SmsDispatcher delivers them through the provider
 * (SMS Ethiopia) once the transaction commits.
 */
export abstract class SmsSender {
  abstract send(tx: Tx, phone: string, template: string, body: string, opts?: SmsOptions): Promise<void>;
}

/**
 * When quiet hours (start to end, East Africa Time hours) end, if `now` falls inside
 * them; otherwise null. 21 to 7 holds a text sent at 22:30 until 07:00 the next day.
 */
export function quietUntil(now: Date, startHour: number, endHour: number): Date | null {
  if (startHour === endHour) return null;
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  const h = eat.getUTCHours() + eat.getUTCMinutes() / 60;
  const inside = startHour > endHour ? h >= startHour || h < endHour : h >= startHour && h < endHour;
  if (!inside) return null;
  const end = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate(), endHour) - 3 * 3_600_000);
  return end.getTime() > now.getTime() ? end : new Date(end.getTime() + 86_400_000);
}

@Injectable()
export class OutboxSmsSender extends SmsSender {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async send(tx: Tx, phone: string, template: string, body: string, opts: SmsOptions = {}): Promise<void> {
    const expires = opts.expiresInMinutes ?? null;
    const hold = opts.quiet
      ? quietUntil(new Date(), await this.settings.number('messages.quiet_start_hour', 21), await this.settings.number('messages.quiet_end_hour', 7))
      : null;
    await tx`insert into tc.sms_outbox (phone, template, body, expires_at, language, next_try_at)
             values (${phone}, ${template}, ${body}, case when ${expires}::int is null then null else now() + make_interval(mins => ${expires}::int) end,
                     ${opts.language ?? 'en'}, coalesce(${hold}::timestamptz, now()))`;
  }
}

/**
 * The language to text a person in: a customer's chosen language, or an owner's
 * (or staff member's) app language; English otherwise.
 */
export async function smsLanguage(tx: Tx, phone: string, who: 'customer' | 'person'): Promise<Lang> {
  const [r] = who === 'customer'
    ? await tx<{ lang: string }[]>`select language as lang from tc.customer where phone = ${phone} limit 1`
    : await tx<{ lang: string | null }[]>`select prefs ->> 'lang' as lang from tc.person where phone = ${phone} and status = 'active' order by created_at limit 1`;
  return isLang(r?.lang) ? r!.lang as Lang : 'en';
}

/** An SMS text in a language (templates in `sms.*`). */
export const smsText = (lang: Lang, key: string, vars: Record<string, string | number>) => t(lang, `sms.${key}` as MessageKey, vars);

/** The text of a code message. */
export function codeMessage(code: string, minutes: number, lang: Lang = 'en'): string {
  return smsText(lang, 'code', { a: code, b: minutes });
}
