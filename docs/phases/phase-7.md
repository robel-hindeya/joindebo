# Phase 7 — Stands and printed material

**Goal (plan, section 7):** owners can order printed QR stands and Temelash can produce and deliver them.

## Boards

- Owner: OwnStands, OwnStandCart, OwnStandPlaced, OwnStandOrders, OwnStandOrder (and its Wait, Bad,
  Done and Prob states), plus "Did your stand arrive?" on Today and stand orders in My requests.
- Admin: AdminStandsProduction, AdminStandsPrices, AdminStandsStock, AdminReqStand,
  AdminReqStandProblem, AdminReqStandDone.

## Acceptance (plan)

1. An order moves through all stages and each stage tells the owner.
2. The production list always equals the open orders.
3. Stock never goes below zero.

Tests: `apps/api/test/phase7.acceptance.spec.ts`.

## Rules taken from the plan and the boards

- Five items, owner app prices read from the admin price list (the AdminStandsPrices note says the real
  app must read one list). Hidden items are not shown to owners and cannot be ordered. An order keeps
  the price it was placed at.
- 1 to 20 of each item. Delivery to one branch of the business, a phone for the delivery and the
  printed language (English, Amharic, Afaan Oromoo or all three). Pay on delivery, cash or Telebirr.
- Only the owner orders stands and confirms receipt (OWNONLY); managers do not see them.
- Admin stages: Placed → Confirmed → Printing → On the way → Delivered, one step at a time. The owner
  sees Placed, Preparing (confirmed and printing), On the way, Received, Problem reported, Delivered.
- On the way (or Delivered) the owner confirms "All here and fine" with how they paid, or reports
  "Something is missing" / "Damaged or wrong" with a note (note required).
- After a problem: "Send a replacement" (back to Printing, the report is kept in the history) or
  "Close without a replacement". Otherwise "Remind the owner to confirm" and "Cash received" (closes it).
- Cancel only before On the way, with a reason.
- Production list = items in open orders that are not on the way yet (Placed, Confirmed, Printing),
  against stock: "to make or buy" = ordered − in stock, never below zero.
- Stock is counted by hand: each change has a reason and is written to the log; it can never go
  below zero (the database refuses it too). Low when stock ≤ "warn me at".
- Each stage change sends a message to the owner's inbox with "See my order".
- Every order, receipt, stage, price and stock change goes to the audit log in the same transaction.

## Unclear (defaults used, flagged — see DECISIONS.md Open list)

1. **Real prices and stock.** The migration loads the board's example prices (350, 650, 120, 180,
   220 Birr) and stock 0. The owner screen keeps the board note "These are example prices." until
   real prices are set.
2. **Delivery outside Addis Ababa.** The board says delivery is free in Addis Ababa; nothing says what
   happens elsewhere. Orders are accepted from any city with free delivery.
3. **Stand cash and the books.** "Cash received" is recorded on the order and in the log, not as a
   plan payment and not in the government-share report.
4. **Stock and orders.** Stock is not taken off automatically when an order goes out ("counted by
   hand", reason "Used for an order").
5. **Who can do what.** All admin roles see Stands and move orders; only Owner and Finance change
   prices.
6. **SMS.** Stage changes go to the owner inbox only, no SMS.
