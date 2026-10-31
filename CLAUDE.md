# Temelash Card

Read `README.md`, `ARCHITECTURE.md` and `DECISIONS.md` first. The build plan is `docs/build-plan.pdf`
(text: run `pdftotext -layout docs/build-plan.pdf -`). The prototype in `docs/prototype/` is the spec for
screens, wording and flows; the plan wins for architecture. Flag any difference.

## Working rules (build plan, section 12)

- One phase at a time. At the start of a phase restate its goal, list its boards, name anything unclear.
- Write the phase's acceptance tests first, then the code.
- Never invent a business rule: add it to the Open list in `DECISIONS.md` and ask.
- Record decisions in `DECISIONS.md` with date and who decided.
- End each session with: done, next, blocked, needs a human.

## Code rules

- The API decides permissions, stamps and money; apps only ask.
- Append-only tables get new correcting rows, never UPDATE/DELETE (the DB refuses anyway).
- Write the audit row with `writeAudit(tx, …)` inside the same transaction as the action.
- Every user-facing string in `packages/i18n/src/locales/{en,am,om}.json`; `npm run lint` checks.
- Store UTC; show East Africa Time; dates via `@temelash/ethiopian-calendar`.
- Prices, limits and the kill switch come from `tc.setting`, never constants.
- Database is plain Postgres in schema `tc`; do not use Supabase-only features (Auth, REST, Storage,
  Edge Functions) so the move to the VPS stays a dump and restore.
- New schema change = new file in `packages/db/migrations`; never edit an applied migration.
- Never log PINs, codes, tokens or request bodies.

## Commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run db:migrate`, `npm run db:seed`.
Packages build to `dist/`; run `npm run build:packages` after changing one.
