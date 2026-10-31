# Temelash Card

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

Needs Node 22+. Copy `.env.example` to `.env` (and to `packages/db/.env`, `apps/api/.env`) with the
real `DATABASE_URL`.

```bash
npm install
npm run build:packages
npm run dev:api        # http://localhost:4000/api/v1/health
npm run dev:customer   # http://localhost:3001
npm run dev:staff      # http://localhost:3002/staff
npm run dev:owner      # http://localhost:3003/owner
npm run dev:admin      # http://localhost:3004/administrator
```

Or run the whole stack in Docker, the same way the VPS runs it (needs Docker Desktop and the root `.env`):

```bash
docker compose up --build -d
```

Then open http://localhost:8080 (customer), `/staff`, `/owner`, `/administrator`, or
`/api/v1/health`. Stop it with `docker compose down`.

Checks (the same ones CI runs):

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
