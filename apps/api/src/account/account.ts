import type { Sql, TransactionSql } from '@temelash/db';

type Tx = Sql | TransactionSql;

/** A short reference read out on the phone: CLS-1042, LP-1043, DEL-1044. */
export async function nextRef(tx: Tx, prefix: 'CLS' | 'LP' | 'DEL'): Promise<string> {
  const [r] = await tx<{ n: string }[]>`select nextval('tc.request_ref_no')::text as n`;
  return `${prefix}-${r.n}`;
}

/** The East Africa Time date (YYYY-MM-DD) `days` working days (Monday to Friday) after `from`. */
export function addWorkingDays(from: Date, days: number): string {
  const d = new Date(from.getTime() + 3 * 3_600_000);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** The East Africa Time date (YYYY-MM-DD) of an instant. */
export const eatDate = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * Remove a customer's name and phone for good (DeleteAccount, AdminReqDeletion):
 * the account is anonymised, signed out everywhere and can no longer sign in.
 * Cards and stamps stay, without anyone attached, so shop reports stay right.
 */
export async function anonymiseCustomer(tx: Tx, customerId: string): Promise<boolean> {
  const rows = await tx`
    update tc.customer set phone = null, pin_hash = null, telegram_user_id = null, status = 'anonymised',
      failed_attempts = 0, locked_until = null
    where id = ${customerId} and status <> 'anonymised' returning id`;
  if (!rows.length) return false;
  await tx`update tc.session set revoked_at = now() where actor_type = 'customer' and actor_id = ${customerId} and revoked_at is null`;
  return true;
}
