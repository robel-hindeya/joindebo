# Phase 2: The stamp loop

**Goal (build plan, section 7):** a customer joins a shop, gets stamped, reaches a reward and redeems it,
with no owner or admin screens needed yet.

**Boards:** Main, CouponDetail, StampEarned, StampedToday, History, RedeemReady, RedeemConfirm,
RedeemCode*, RedeemDone, StaffScan, StaffFound, StaffAdded, StaffDuplicate, StaffBadCode, StaffManual,
StaffCamera, StaffOffline, StaffQueued, StaffRewardNeedsNet, StaffRewardUsed, StaffRewardExpired,
StaffRewardDone, StaffLimit, StaffWrongShop, StaffNoCard, StaffPaused, CardPaused, ExpiredCard,
RedeemedCard, OwnFix*.

**Acceptance (plan):**
1. Two staff scanning the same customer within one visit produce exactly one stamp.
2. A reward code used twice redeems once.
3. Replaying a queued stamp after its card was paused is rejected with a clear message.
4. The ledger sums to the card's stamp count after every test run.

**Exit gate:** a load test of 50 stamps per second for 10 minutes with no duplicate or lost stamps; the
stamp ledger can be rebuilt from raw rows.

## Rules taken from the prototype

| Rule | Source |
| --- | --- |
| The card QR changes every minute and **works without internet** on the customer's phone; a saved picture of an old code is refused. | Main `qrHelpOffline`, `codeIn`; Staff `badText` |
| A short code is printed under the QR for typing when the camera fails; staff may also type the customer's phone number. Stamps added by hand are marked for the owner. | Staff `mnHelp`, `handNote` |
| One stamp per visit: a second scan the same day shows "Already stamped today … by …". | Staff `dupTitle`, `dupText` |
| Per-staff hourly limit set by the owner. From 80% of it the screen warns; over it the stamp is saved but waits for the owner's approval and is not counted until approved. | Staff `limitNear`, `limitOver`, `limitDoneSub`, `NEAR = ceil(0.8 × LIMIT)` |
| A card from another shop, no card at this shop, and a paused card are refused with their own screens. | Staff `wrong*`, `nocard*`, `paused*` |
| Rewards unlock at the ladder's stamp counts and stay valid 30 days after unlocking. | Main `rewardAt`, `loyTerms` |
| Redeem: the customer taps Redeem, confirms at the counter, shows a reward code; staff scan it and confirm after handing over the reward. A reward code works once; used and expired codes have their own screens. **Rewards need a connection.** | Main `rd*`; Staff `rd*`, `used*`, `rexp*`, `rnet*` |
| Offline staff stamps are kept on the phone, shown as waiting, and sent in order later. | Staff `offBanner`, `queued*` |
| When every reward on a card is redeemed the card shows "All rewards redeemed". | Main `redeemedTitle` |
| Adding a card can put the shop's welcome stamp on it ("Your first stamp is on it"). | Main `codeAdded`, ScanJoin `chip` |
| Owner fixes: remove or add stamps, undo a reward given, give a reward more days, pause or resume a card. Each needs the owner's PIN and a reason, notifies the customer, and is logged. | Owner `fix*`, `fx*` |

## How the rotating code works

Each card has a random secret, given to the customer's phone when the card loads. The phone computes the
code for the current minute itself (HMAC of the card id and the minute), so it works offline, like an
authenticator app. The server recomputes it and accepts the current and previous minute. The typed
form is the card's 4-character short id plus a 6-digit time code. Reward codes are 8 characters made
from a server secret; one redemption per reward is enforced by the database.

## Unclear or conflicting (defaults used, flagged for Truman)

1. **Hand-typed stamps.** The plan says typed stamps take the "needs approval" path; the prototype
   counts them at once, marks them "Added by hand. The shop owner will see this.", and sends only
   over-limit stamps to approval. The prototype is used (screens win); the owner reviews typed stamps on
   OwnToCheck in Phase 3. If typed stamps must wait instead, it is a one-line rule change.
2. **What "one visit" means.** The prototype says "already stamped today". A visit is the shop's
   calendar day in East Africa Time.
3. **"This hour" for the limit** is the clock hour in East Africa Time.
4. **Offline stamps** are accepted if the code was valid at the time it was scanned and the scan is less
   than 24 hours old (`stamp.offline_max_hours`), and the card is still active when it arrives.
5. **Welcome stamp** is a per-shop rule (`welcome_stamps`, default 0); the shop's card rules set it in
   Phase 3. The seeded Moka House gets 1, as in the prototype.
6. **Typing a phone number** finds a customer by phone alone, as the prototype allows. Those stamps are
   marked hand-typed like typed codes.

## Progress

- [x] Acceptance tests first: `apps/api/test/phase2.acceptance.spec.ts`. The plan's four checks pass
      (one stamp from two simultaneous scans, a reward code redeems once, a queued stamp for a paused card
      is refused, the ledger matches every card's count after every test), plus 14 flow tests.
- [x] `@temelash/codes`: rotating card codes (QR and typed), reward codes, parsing; shared by the
      customer app (offline) and the API.
- [x] API: staff scan preview, stamp (online and offline replay, idempotent), hourly limit with
      approval hold, duplicate-visit check, wrong shop, no card, paused, expired code; reward confirm with
      used/expired; customer cards (with code secrets), add card by shop code with welcome stamps,
      history, notifications; owner fixes (add, remove, undo reward, extend, pause, resume) with PIN.
- [x] Migration 0007 applied to Supabase; permission matrix covers the new endpoints.
- [x] Customer screens (Main board): wallet list with loading skeleton and empty state, card ticket with
      stamp grid, reward tiers, unlocked banner, live rotating QR computed on the phone (works offline, cached
      cards), full-screen QR, redeem confirm → code → used, "Stamp added!" (slam, ripple), add by shop code.
- [x] Staff screens (Staff board): camera scanner (BarcodeDetector or jsQR), camera-off, type a code or
      phone, Customer found (stamp or reward, limit warnings, by-hand note), added / queued / waiting for
      approval, every refusal screen, recent activity with the hour count, offline queue sent in order.
- [x] Browser-tested end to end on Supabase: join with welcome stamp, cashier types the rotating code,
      stamp added, the customer's phone shows "Stamp added!" within 10 s, a second scan is refused as a
      duplicate (times in East Africa Time).
- [ ] OwnFix* screens come with the owner app (Phase 3), the API for them is done.
- [ ] Not like the prototype yet: shop colours and logos (Phase 3 OwnLook), notifications list, history
      screen, settings menu, Telegram mini-app launch.
- [ ] Exit gate: load test 50 stamps/second for 10 minutes; rebuild the ledger from raw rows.
