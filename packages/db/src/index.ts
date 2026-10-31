import postgres from 'postgres';

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;

/**
 * Connect to Postgres. The same URL format works for Supabase (session pooler)
 * today and a self-hosted Postgres on the VPS later.
 */
export function createDb(url = process.env.DATABASE_URL, options: postgres.Options<Record<string, postgres.PostgresType>> = {}): Sql {
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    // Supabase's transaction pooler cannot use prepared statements; harmless elsewhere.
    prepare: !url.includes(':6543/'),
    connection: { search_path: 'tc', TimeZone: 'UTC' },
    ...options,
  });
}

export type ActorType = 'customer' | 'staff' | 'manager' | 'owner' | 'admin' | 'system';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  role?: string | null;
  businessId?: string | null;
  type: string;
  text: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Write an audit row. Call it with the transaction that performs the action,
 * so there is never an action without a log row or a log row without an action.
 */
export async function writeAudit(tx: Sql | TransactionSql, e: AuditEntry): Promise<void> {
  await tx`
    insert into tc.audit_log (actor_type, actor_id, role, business_id, type, text, detail, ip)
    values (${e.actorType}, ${e.actorId ?? null}, ${e.role ?? null}, ${e.businessId ?? null},
            ${e.type}, ${e.text}, ${tx.json((e.detail ?? {}) as postgres.JSONValue)}, ${e.ip ?? null})
  `;
}
