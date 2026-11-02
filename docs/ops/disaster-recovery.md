# Disaster recovery and backups

Plan, section 8: backups encrypted, tested monthly, kept in a different region from the main
database. Phase 9 acceptance: recover to within 15 minutes of loss.

## What we keep

| What | Where now (Supabase) | On the VPS |
|---|---|---|
| Database (`tc` schema) | Supabase daily backups; PITR is a paid add-on and is **off** | Nightly `pg_dump -Fc` plus continuous WAL archiving (pgBackRest or WAL-G), encrypted, to object storage in another region |
| Secrets (`.env`) | Password manager, two Owners | Same |
| Code | GitHub | Same |

Only point-in-time recovery (WAL) meets "within 15 minutes"; a nightly dump alone can lose a day.

## Monthly drill (write the result in the log below)

1. Create an empty scratch database (never production).
2. `SOURCE_URL=<backup or read replica> TARGET_URL=<scratch> bash scripts/ops/restore-drill.sh`
3. It prints `tables=… same_counts=yes … total_s=…`. `same_counts=no` is a failed drill: stop and
   find out why.
4. For PITR: restore to a time 10 minutes ago and check that the last stamps before that time are there.
5. Delete the scratch database.

## If the database is lost

1. Turn on the kill switch (Admin → Settings → Safety) if anything still runs, so no stamps are taken
   against a broken database.
2. Restore the newest backup (PITR to just before the failure where available) into a new database.
3. Run migrations (`npm run db:migrate`); it applies nothing if the restore was complete.
4. Point `DATABASE_URL` at it, restart the API, check `/api/v1/health` (`db: up`, migration count).
5. Turn the kill switch off. Tell owners in Messages what happened and for how long.
6. Stamps taken offline during the outage replay from the staff phones (up to `stamp.offline_max_hours`).

## Drill log

| Date | Source | Tables | Same counts | Time | Who |
|---|---|---|---|---|---|
| 2026-11-02 | Local load-test database (4,000 customers) | 46 | yes | 6 s | Claude (script check, not production) |
