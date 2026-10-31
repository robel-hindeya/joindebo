# Phase 2 exit gate: load test

Date: 2026-10-31. Result: **PASS.**

**Gate (build plan, section 7):** 50 stamps per second sustained for 10 minutes with no duplicate or lost
stamps; the stamp ledger can be rebuilt from raw rows.

## Setup

- API built as in production (`tsc`, Node 22), one process, its default pool of 10 database connections.
- PostgreSQL 17 on the same machine (Docker), fresh database, all migrations, one shop with 10 cashiers and
  30,500 cards (`scripts/loadtest/seed.mjs`). Supabase was not used: from this PC every query crosses the
  internet to Frankfurt, which would measure the connection rather than the system. On the VPS the database
  sits next to the API, which this setup models.
- Load (`scripts/loadtest/run.mjs`): a steady 50 requests per second for 600 seconds, each with a real
  rotating card code computed like the customer's phone does, spread over the 10 cashiers. Mixed in:
  - 3% **retries**: an earlier request sent again with the same idempotency key (a network retry);
  - 2% **rescans**: a card already stamped today scanned by another cashier;
  - 1% **races**: two cashiers scanning the same fresh card at the same instant.
- Check (`scripts/loadtest/verify.mjs`): the database is compared with what the load generator saw, and
  every card's count is rebuilt from raw stamp rows.

## Results

| Measure | Result |
| --- | --- |
| Requests sent | 30,000 in 600 s (50.0 per second) |
| Latency | p50 21 ms, p95 37 ms, p99 44 ms, max 83 ms |
| Server errors | 0 |
| New stamps (plain requests) | 28,204 of 28,204 created |
| Retries | 897 of 897 returned the original stamp, no new row |
| Rescans the same day | 599 of 599 refused as "Already stamped today" |
| Simultaneous double scans | 300 of 300 gave exactly one stamp |
| Stamp rows in the database | 28,504 = 28,204 + 300 race winners |
| Duplicates / lost / unexpected rows | 0 / 0 / 0 |
| Ledger rebuilt from raw rows vs stored rows | 0 mismatches on 30,500 cards |

## Notes

- 50 per second is far below what one API process handled here (in flight never above 3); the limit was
  set by the plan, not reached.
- The phone-side target (stamp confirmed in under 1.5 s at p95 on a mid-range Android over 3G) is a
  Phase 9 test on real devices and networks; this test covers the server.
- To repeat: `DATABASE_URL=<throwaway db> node scripts/loadtest/seed.mjs 30500`, start the API on it, then
  `API=http://localhost:4200 node scripts/loadtest/run.mjs` and `node scripts/loadtest/verify.mjs`.
  The seed script refuses Supabase and pooler URLs.
