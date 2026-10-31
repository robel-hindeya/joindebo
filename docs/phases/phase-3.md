# Phase 3: Owner app

**Goal (build plan, section 7):** an owner can run the shop's loyalty programme without calling anyone.

**Boards:** OwnToday, OwnApprovals, OwnToCheck, OwnCustomers*, OwnCustomer*, OwnTeam, OwnStaff*, OwnRules,
OwnRoles, OwnCard*, OwnGifts, OwnDetails, OwnHours*, OwnBranches, OwnBranchForm, OwnLook, OwnPoster*,
OwnReports*, OwnLog, OwnAlertSet, OwnSecurity, OwnDateTime*, OwnHelp, and every OwnMgr* board.

**Acceptance (plan):**
1. Changing the reward ladder does not change the cards already in progress.
2. A branch manager's every request for another branch returns forbidden.
3. Reports match a hand count of the ledger for the seeded data.

**Exit gate:** three real shop owners (not Temelash staff) set up a new shop unaided in under 20 minutes,
observed. That is a human test; this phase ends with the build ready for it.

## Rules taken from the prototype

| Rule | Source |
| --- | --- |
| Today: "Needs your attention" lists stamps waiting for approval (over the hourly limit), stamps typed by hand to check, unusual activity, locked-out staff, PINs expiring soon, closing request status. "Approve all". | Owner `attn*` |
| Card: up to two rewards, an optional early reward and the main reward when the card is full; the owner sees who is affected before saving. | Owner `cd*` |
| Rules: **time between stamps** 1, 2, 4, 8 or 24 hours (default 4); a reward lasts 7, 14, 30, 60 or 90 days (default 30); optional card end date; terms customers see; optional cost per reward for reports. | Owner `cr*`, `gapChips`, `validChips` |
| Default stamps per hour per phone (default 40), with per-person overrides; over the limit stamps wait for approval. | Owner `ru*` |
| **Stamps typed by hand**: "Allow, and I check them" (default, listed in To check), "Allow, no checking", or "Do not allow" (cashiers must scan). | Owner `hn*` |
| PIN expiry: Never, 60, 90 or 180 days (default 90); warning 14 days before. | Owner `ruPin*`, `px*` |
| Roles: managers see and manage only their own branch; they can approve over-limit stamps, fix stamps, give more time, pause cards, add cashiers, reset PINs, unlock accounts, and see reports and the log for their branch. **Only the owner** can undo a reward given, change the card, gifts, rules and branches, and send news. | Owner `rr1`–`rr8`, `rlNote` |

## Corrections to Phase 2 from these rules

- **One stamp per visit** becomes the shop's time between stamps (default 4 hours) instead of "the same
  calendar day". The staff message stays "Already stamped today" per the Staff board.
- **Hand-typed stamps** follow the shop's setting above; the default ("Allow, and I check them") is what
  Phase 2 already did, and "Do not allow" refuses typed codes and phone numbers.
- **Undo a reward given** is owner only; Phase 2 also let managers do it.

## Unclear or conflicting (flagged for Truman)

1. **Changing the card for customers already collecting.** The card designer says changes reach cards in
   progress ("Cards in progress need N more stamps", "customers who already have N or more get their
   reward next visit"). The plan's acceptance test 1 says cards in progress keep the rules they started
   under. The plan is followed (each change is a new rule version; existing cards keep theirs) until
   Truman decides; the "what changes for customers" panel then reports that nothing changes for them.
2. **Which cards a manager may fix.** Cards belong to the business, not a branch. Default: a manager may
   fix a card that has at least one stamp at their branch.
3. **Gifts** (OwnGifts: follow our pages, leave a Google review) give extra rewards without stamps. Their
   rules need a decision on how a cashier confirms them; built after the core owner screens.

## Progress

- [x] Acceptance tests first: `apps/api/test/phase3.acceptance.spec.ts`. The plan's three checks pass
      (a ladder change leaves cards in progress alone; a manager is refused every request about another
      branch: reports, log, approvals, to-check, team, customers, fixes, rules, branches; reports equal a
      hand count of the ledger, voided and waiting stamps excluded), plus team, shop, branches and log flows.
- [x] Phase 2 corrections: visit = the shop's time between stamps; "Do not allow" refuses typed codes and
      phone numbers; undo a reward given is owner only; managers fix only cards used at their branch.
- [x] API `/owner/*`: today (attention counts, locked staff, PINs expiring), approvals (decide in bulk),
      to check, customers (search, detail with history), team (add with a one-time temporary PIN, reset
      PIN, unlock, hourly limit, remove), card and rules (every save a new version), shop details,
      branches with opening hours, reports (7/14/30 days, per branch), activity log.
- [x] Migration 0008 applied to Supabase; permission matrix covers every new endpoint. 249 tests pass.
- [ ] Screens: OwnToday and the rest of the owner board, OwnMgr* variants, OwnFix* (next).
- [ ] Later in this phase: posters and QR downloads, look (colours, logo upload), gifts, alert settings,
      security page, date and time settings, help.
