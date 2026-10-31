import { randomInt } from 'node:crypto';
import type { Sql, TransactionSql } from '@temelash/db';
import { hashSecret } from '../auth/pin';

export type AdminRole = 'owner' | 'finance' | 'support';

/** A temporary password for a new admin: 4 groups of 4 letters and digits, shown once. */
export function tempPassword(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('')).join('-');
}

/**
 * Create an admin who sets up their authenticator at first sign-in. Used by the
 * admin team page and by `npm run admin:create` for the first Owners.
 */
export async function createAdmin(
  tx: Sql | TransactionSql,
  a: { email: string; name: string; role: AdminRole; password: string },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into tc.admin_user (email, name, role, status, password_hash, password_changed_at)
    values (${a.email.trim().toLowerCase()}, ${a.name}, ${a.role}, 'active', ${await hashSecret(a.password)}, now())
    returning id`;
  return row.id;
}
