# Join Debo (formerly Temelash Card)

Digital stamp-card loyalty for cafés, salons, spas, restaurants and car washes in Ethiopia.
Four apps (customer, staff, owner, admin) on one API and one PostgreSQL database.

- Plan: [docs/build-plan.pdf](docs/build-plan.pdf) (ten phases, three release gates)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Decisions: [DECISIONS.md](DECISIONS.md) · Database: [docs/DATABASE.md](docs/DATABASE.md)
- Prototype (the screen spec): [docs/prototype](docs/prototype/README.md)

## Status

Phase 0 (foundations) in progress. Done: monorepo, four app shells, API with health check, database
schema on Supabase with append-only enforcement, seed of the prototype's sample data, Ethiopian
calendar library, three-language i18n with a missing-key check, CI, Docker images and the VPS staging
deploy (deploy/README.md). Not yet: the staging server itself, error tracking, backups.

## Run locally

Needs Node 22+. Copy `.env.example` to `.env` (and to `packages/db/.env`, `apps/api/.env`) and choose the
passwords and secrets in it. `DATABASE_URL` points at the Docker database (see below), so start that first:
`docker compose up -d db migrate`.

```bash
npm install
npm run build:packages
npm run dev:api        # http://localhost:4000/api/v1/health
npm run dev:customer   # http://localhost:3001
npm run dev:staff      # http://localhost:3002/staff
npm run dev:owner      # http://localhost:3003/owner
npm run dev:admin      # http://localhost:3004/administrator
```

The apps reach the API through `API_ORIGIN` in each `apps/<app>/.env.local` (for example
`API_ORIGIN=http://localhost:4000`). If another project holds port 4000, set `API_PORT` in `apps/api/.env`
and use that port in `API_ORIGIN`. The links between apps on the front page only work through port 8080.

Or run the whole stack in Docker, the same way the VPS runs it (needs Docker Desktop and the root `.env`):

```bash
docker compose up --build -d
```

Then open http://localhost:8080 (the front page: owner, staff or customer), `/staff`, `/owner`, `/administrator`,
or `/api/v1/health`. Stop it with `docker compose down`.

Data lives in the Docker volume `debo_db`, so it survives restarts, rebuilds and `docker compose down`.
**`docker compose down -v` deletes it.** Postgres is on `127.0.0.1:5433`; backups are in
[docs/DATABASE.md](docs/DATABASE.md).

Sample data, local and staging only:

```bash
docker compose run --rm -T -e SEED_ALLOWED=true migrate npx tsx src/seed.ts
npm run seed:example -w @temelash/db
```

The second adds one complete example company, Yeshi Coffee House, for trying the owner screens.

Checks (the same ones CI runs):

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Set `TEST_DATABASE_URL` to a throwaway Postgres 17 to run the 744 API tests; without it most are skipped. They wipe
schema `tc`, so never point it at a database you want to keep.
