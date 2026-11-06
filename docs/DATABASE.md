# Database

PostgreSQL 17. Everything lives in schema `tc`. Development uses the Supabase project
`temelash-card-dev` (ref `oavipgttrrqeabtlgmia`, Frankfurt); production will be a VPS.
The local Docker stack has its own database (below).

## Local Docker database

`docker compose up --build -d` starts Postgres 17 in the service `db`, with database `temelash`.
On first start `deploy/db-init/01-roles.sh` creates `tc_api`; the `migrate` service then applies
new migrations on every start, before the API starts.

- **Data is kept** in the Docker volume `debo_db`, through restarts, rebuilds and `docker compose down`.
- **`docker compose down -v` deletes it.** So does removing the volume or resetting Docker Desktop.
- Reach it from your machine at `127.0.0.1:5433`. It is not open to other computers.
- Passwords are read from the root `.env` only when the volume is first created. Changing them there
  later does not change them in the database.
- Sample data, if wanted:
  `docker compose run --rm -e SEED_ALLOWED=true migrate npx tsx src/seed.ts`
- Back up: `docker compose exec -T db pg_dump -U postgres temelash > debo-backup.sql`

## Roles

| Role | Login | Rights | Used by |
| --- | --- | --- | --- |
| `postgres` (Supabase) / DB owner (VPS) | yes | owns schema `tc`, runs migrations | `npm run db:migrate` via `MIGRATION_DATABASE_URL` |
| `tc_app` | no | SELECT, INSERT on all `tc` tables; UPDATE only on mutable tables; no DDL | granted to `tc_api` |
| `tc_api` | yes | inherits `tc_app` | the API, the seed script (`DATABASE_URL`) |

Append-only tables (`stamp`, `stamp_decision`, `reward`, `redemption`, `rule_set`, `audit_log`) also
have triggers that refuse UPDATE, DELETE and TRUNCATE for every role, the owner included.

Creating `tc_api` on a new server (pick a long random password, keep it in the secret store):

```sql
create role tc_api login password '<random>';
grant tc_app to tc_api;
alter role tc_api set search_path = tc;
```

## Connection strings

- Supabase, as `tc_api` (session pooler, IPv4):
  `postgresql://tc_api.oavipgttrrqeabtlgmia:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`
- Supabase, as `postgres` for migrations: the "Session pooler" string in
  Supabase → Project Settings → Database, with the database password set there.
- VPS: `postgresql://tc_api:<password>@127.0.0.1:5432/temelash`

Local `.env` files (gitignored) hold the real values; `.env.example` shows the shape.

## Commands

```bash
npm run db:migrate   # apply new files in packages/db/migrations (needs the owner role)
npm run db:seed      # load prototype sample data; needs SEED_ALLOWED=true; skips if data exists
```

Migrations are numbered `NNNN_name.sql`, run in order, each in a transaction, and are never edited
after they are applied anywhere: add a new file instead. On Supabase they were also applied through
the Supabase MCP and recorded in `tc.schema_migrations`, so `db:migrate` sees them as done.

## Moving from Supabase to the VPS

1. Install PostgreSQL 17 on the VPS; create database `temelash` and the `tc_app` role
   (migration 0001 does this) and `tc_api` (above).
2. Put the API into maintenance (kill switch on), then dump only our schema:
   `pg_dump --schema=tc --no-owner --no-privileges "<supabase postgres url>" > tc.sql`
3. Restore: `psql "<vps owner url>" -f tc.sql`, then re-run the grants at the end of
   `0001_foundation.sql`. (Alternative: run `npm run db:migrate` on the empty VPS database, then restore
   a `pg_dump --data-only --schema=tc` dump. The append-only triggers only block UPDATE/DELETE, so a
   data load of INSERTs passes through them.)
4. Change `DATABASE_URL` for the API, restart, check `GET /api/v1/health`, kill switch off.
5. Keep the Supabase project read-only for a week, then pause it.
