# Phase 9 — Localisation, hardening and full launch

**Goal (plan, section 7):** ready for the public, in three languages, at scale.

## Acceptance (plan)

1. Zero untranslated strings in any shipped language.
2. p95 stamp scan under 1.5 seconds on a mid-range Android phone on a 3G-class connection.
3. A restore drill recovers the database to within 15 minutes of loss.

Exit gate: Release 3, full launch, with the launch checklist signed off (docs/CHECKLIST.md).

## Done in code (2026-11-02)

| Item | What was done | Result |
|---|---|---|
| Untranslated strings | `npm run lint` (i18n check) now also fails when an Amharic or Oromo string is still the English text, apart from a short list that reads the same everywhere (Temelash Card, PIN, SMS, Telebirr, CBE Birr). Three real gaps fixed ("Stamp added", "Reward given", "Role"). | 2,939 keys, none untranslated. Native review still needed. |
| Other languages | Tigrinya, Somali, Sidama and Wolaytta show as "Coming soon" (since Phase 1). | — |
| Slow-query review | Indexes in migration 0020: new cards per hour per shop, accounts waiting to be erased, live sessions per person, requests per business and type. The per-hour flag checks were rewritten as time ranges so the `(person_id, at)` index is used. | — |
| Cache | Owner reports and news audience counts are reused for up to 60 seconds per shop (`apps/api/src/common/cache.ts`). Off in tests. | — |
| Load test | The Phase 2 load test run again with every Phase 7–8 change in the stamp path: `scripts/loadtest` against a throwaway database, 50 stamps a second for 60 seconds with retries, re-scans and races. | 3,000 requests, server p95 **39 ms** (p99 42, max 76), 0 server errors; the database check found no lost, duplicate or miscounted stamps. Result in `scripts/loadtest/result-phase9.json`. |
| Restore drill | `scripts/ops/restore-drill.sh`: dumps the `tc` schema, restores it into an empty database and compares every table's row count. | On the load-test database (46 tables, 4,000 customers, ~3,000 stamps): identical counts, **6 seconds** in total. |
| Accessibility | Scan of all four apps for icon-only buttons without a label, images without alt text and fields without a label. | None found. Text size, contrast and screen-reader passes still need a person on real phones. |

## Needs people (not code)

1. **Native-speaker review** of every Amharic and Afaan Oromoo string, with layout checks on small
   phones (clipped text). All strings added since Phase 1 are drafts.
2. **The phone and network half of acceptance 2**: time a scan on a mid-range Android on a 3G-class
   connection (or Chrome's "Slow 3G" throttling), 20 scans, note the p95.
3. **Acceptance 3 in production**: "within 15 minutes of loss" needs point-in-time recovery. On
   Supabase, turn on PITR (paid add-on); on the VPS, continuous WAL archiving (pgBackRest or WAL-G)
   to storage in another region. Then run the drill monthly against the real backup.
4. **Independent security review or penetration test**, fix and retest.
5. **Uptime monitoring and a status page** (for example Better Stack or UptimeRobot on
   `/api/v1/health`), and error tracking (DECISIONS.md, Open 4).
6. **Hosting and licensing** for the Temelash entity; **terms and privacy policy** written by a lawyer
   and published in all three languages (the owner Privacy screen says the wording is a draft).
7. The open decisions in DECISIONS.md (prices, email provider, SMS sender name, and the rest).

Runbook: `docs/ops/disaster-recovery.md`.
