/**
 * Apply every migrations/*.sql file not yet recorded in tc.schema_migrations,
 * in name order, each in its own transaction.
 *
 * Needs a role that owns the schema (the "postgres" user on Supabase, the
 * database owner on the VPS): MIGRATION_DATABASE_URL, falling back to DATABASE_URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from './index';

async function main() {
  const sql = createDb(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`create schema if not exists tc`;
    await sql`create table if not exists tc.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql<{ name: string }[]>`select name from tc.schema_migrations`).map((r) => r.name));
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into tc.schema_migrations (name) values (${file})`;
      });
      console.log(`applied ${file}`);
      applied++;
    }
    console.log(applied ? `${applied} migration(s) applied` : 'database is up to date');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
