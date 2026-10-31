import type { Sql, TransactionSql } from '@temelash/db';

/**
 * Wrong-PIN counting on tc.customer, tc.person and tc.admin_user (all have
 * failed_attempts and locked_until). At `max` wrong tries the account locks for
 * `minutes`, and while locked even the right PIN is refused.
 */
export type LockTable = 'customer' | 'person' | 'admin_user';

export function isLocked(row: { locked_until: Date | null }): boolean {
  return !!row.locked_until && row.locked_until.getTime() > Date.now();
}

export async function recordWrongPin(
  tx: Sql | TransactionSql,
  table: LockTable,
  id: string,
  max: number,
  minutes: number,
): Promise<{ locked: false; triesLeft: number } | { locked: true; lockedUntil: Date }> {
  const [row] = await tx<{ failed_attempts: number }[]>`
    update ${tx('tc.' + table)} set failed_attempts = failed_attempts + 1 where id = ${id} returning failed_attempts`;
  if (row.failed_attempts >= max) {
    const [l] = await tx<{ locked_until: Date }[]>`
      update ${tx('tc.' + table)} set failed_attempts = 0, locked_until = now() + make_interval(mins => ${minutes})
      where id = ${id} returning locked_until`;
    return { locked: true, lockedUntil: l.locked_until };
  }
  return { locked: false, triesLeft: max - row.failed_attempts };
}

export async function clearWrongPins(tx: Sql | TransactionSql, table: LockTable, id: string): Promise<void> {
  await tx`update ${tx('tc.' + table)} set failed_attempts = 0, locked_until = null where id = ${id}`;
}
