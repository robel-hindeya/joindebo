# Architecture

Temelash Card is four apps on one backend. The apps hold no business rules: they ask, the API decides.
Source of truth for the plan: [docs/build-plan.pdf](docs/build-plan.pdf). Source of truth for screens,
wording and flows: the prototype ([docs/prototype/](docs/prototype/README.md)).

```
                     ┌──────────────── one API (NestJS) ────────────────┐
 customer  (Next.js) │  auth · stamps · business & money · messages ·   │      PostgreSQL
 staff     (Next.js) ├─▶ audit · settings          (modules, one deploy) ├──▶  schema "tc"
 owner     (Next.js) │                                                   │   (Supabase now,
 admin     (Next.js) └───────────── queue (pg-boss, Phase 6) ───────────┘    VPS later)
```

## Repo layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS service, all endpoints under `/api/v1` |
| `apps/customer` | Customer app (Telegram Web App later), served at `/` |
| `apps/staff` | Staff app, shared link `/staff` |
| `apps/owner` | Owner and branch-manager app, `/owner` |
| `apps/admin` | Temelash back-office, `/administrator` (desktop, 1280 wide) |
| `packages/db` | Postgres client, audit helper, SQL migrations, migrate and seed scripts |
| `packages/ethiopian-calendar` | Gregorian ⇄ Ethiopian, EAT, local-time clock, finance year |
| `packages/i18n` | English, Amharic, Afaan Oromoo strings and the missing-key check |
| `packages/ui` | Design tokens (`tokens.css`) and shared React components |

## Rules the code follows

1. **The server decides.** Permissions, stamps and money are checked in the API on every request.
2. **Append-only.** `stamp`, `stamp_decision`, `reward`, `redemption`, `rule_set` and `audit_log`
   (money tables join them in Phase 5) have no UPDATE/DELETE grant for the app role and a trigger
   that refuses UPDATE/DELETE/TRUNCATE for everyone. Corrections are new rows pointing at the old one.
3. **Audit in the same transaction.** Use `writeAudit(tx, …)` from `@temelash/db` inside the
   transaction that performs the action.
4. **Three languages from day one.** Every string goes into all of `packages/i18n/src/locales/*.json`;
   `npm run lint` fails on a missing key.
5. **Time.** Store UTC (`timestamptz`, connection `TimeZone=UTC`); show East Africa Time with the
   Ethiopian calendar and local-time clock as options. Money rows store their finance year and
   Ethiopian month when written.
6. **Settings, not constants.** Prices, commission, trial length, limits and the kill switch live in
   `tc.setting`.

## Database: Supabase now, VPS later

Supabase is used **only as a managed PostgreSQL**. We do not use Supabase Auth, its REST/Realtime
APIs, Storage or Edge Functions, because phone-and-PIN login, Telegram `initData` checks and local SMS
do not fit Supabase Auth (build plan, section 11). Concretely:

- All tables live in schema `tc`, which Supabase's REST API does not expose.
- The API connects with a plain `DATABASE_URL` as login role `tc_api`, which only has the rights of
  `tc_app` (SELECT/INSERT everywhere, UPDATE on mutable tables only, no DDL).
- Migrations are plain SQL in `packages/db/migrations`, tracked in `tc.schema_migrations`, run by
  `npm run db:migrate`. CI applies them to a stock `postgres:17` on every push to prove they are
  portable.

Moving to the VPS is therefore: `pg_dump` the `tc` schema, restore into the VPS Postgres, create
`tc_app`/`tc_api` there, change `DATABASE_URL`. Steps in [docs/DATABASE.md](docs/DATABASE.md).

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript everywhere | |
| API | NestJS 11 on Node 22 | One deployable, internal modules |
| Frontends | Next.js 15 (App Router), React 19 | Four apps, one `@temelash/ui` package |
| Database | PostgreSQL 17 via `postgres` (postgres.js) | Raw SQL, no ORM lock-in |
| Queue | pg-boss on the same Postgres (planned, Phase 6) | Replaces Redis until load needs it |
| Tests | Vitest (packages), Jest (API) | Acceptance tests become automated tests |
| CI | GitHub Actions | Lint, i18n keys, type-check, tests, build, migrations on clean Postgres |

Not set up yet (Phase 0 remainder): staging deploy target, error tracking, backups policy.
See [DECISIONS.md](DECISIONS.md) for what is decided and what is still open.
