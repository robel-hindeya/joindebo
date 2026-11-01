# Phase 5: Money: plans, payments, agents, government share

**Goal (build plan, section 7):** every Birr in and out is recorded once, traceable, and reportable.

**Boards:** AdminFinance*, AdminRecordPay, AdminAddBranch, AdminChangePlan, AdminReceipt*, AdminGovMark,
AdminAgents*, AdminAgentPay, AdminAddDeal*, AdminLeadLink, AdminStatement, AdminLeaderboard*,
AdminFinanceReport*, AdminExport*, OwnPlan*.

**Acceptance (plan):**
1. Reversing a payment restores the balance and removes the commission the same day.
2. The sum of all payments minus commission minus government share equals "left for Temelash" for every
   period.
3. An export with a wrong code writes nothing and counts toward the lock.

**Exit gate:** the finance owner reconciles one month of real pilot payments against the system and the
totals match to the Birr.

Phase 5 started on 2026-11-01 at Robel's request ("next"), before Phase 4's exit gate (the private pilot).

## Rules taken from the plan and the Admin board

| Rule | Source |
| --- | --- |
| Yearly fee: Starter `plan.starter.yearly_fee_birr` (1 branch only); Full `plan.full.yearly_fee_birr` with 2 branches, plus `plan.extra_branch.yearly_fee_birr` for each branch after 2; Pilot is free. | Plan section 2; board `feeFn` |
| Payments are recorded by hand: Telebirr, CBE Birr, Cash, Bank transfer; amount, optional reference. A payment covers the finance year up to Sene 30. | Plan; AdminRecordPay |
| A business on trial that pays the whole fee becomes active. | AdminRecordPay |
| Receipt numbers `TR-yyyymmdd-nn` (East Africa date, nn counts that day's receipts). | Plan section 5 |
| Corrections and reversals are new rows linked to the payment; the first amount stays on the receipt as history. Balances and commission are worked out again from the rows. | Plan; AdminPayCorrect, AdminPayReverse |
| Finance year on the Ethiopian calendar: Hamle 1 to Sene 30 (year 2019 runs 8 Jul 2026 to 7 Jul 2027). Payments for next year open on Ginbot 1. The finance year and Ethiopian month are stored on every money row when written. | Plan sections 2 and 5 |
| Adding a branch: a second branch moves Starter to Full; each branch after the second adds the extra-branch fee. Changing the plan changes the yearly fee; what was paid this year stays. Starter is for 1 branch only. | AdminAddBranch, AdminChangePlan |
| Agent commission (net): Starter `agent.commission_birr.starter`, Full `agent.commission_birr.full`, each extra branch `agent.commission_birr.extra_branch`. Earned only once the business has paid: the plan part when the base fee is covered, each extra branch when its fee is covered. Nothing on a pilot. | Plan section 2; board `commFn` |
| An agent is linked by the phone typed at sign-up, or by an admin "deal" (a business already on Temelash, or a lead not registered yet, linked when that phone signs up). | Plan section 2; AdminAddDeal*, AdminLeadLink |
| "Mark as paid" pays an agent everything owed; payouts are rows (amount, how, when). | AdminAgentPay |
| Government share: `government.share_percent_of_commission` (30%) of each commission, on top. Tracked per Ethiopian month and marked as handed over (amount, how, reference). | Plan section 2; AdminGovMark |
| Left for Temelash = payments − commission − government share, per month and per agent. | Plan acceptance 2 |
| Leaderboard over 7, 14, 30, 60 or 90 days. | Plan |
| Every export asks for the password and an authenticator code again, every time, and is logged; a wrong code counts toward the lock. Money screens and exports: Owner and Finance only. | Plan section 7 and 8 |

## Unclear (defaults used, flagged)

1. **When the fee is due.** The board keeps a due date per business but does not say how it is set for a
   business that did not start with a trial. Default: due when the trial ends; otherwise on the day the
   plan starts (approval or plan change) or on Hamle 1 for a new finance year, whichever is later.
   "Due soon" means due within 14 days. (Robel, Truman)
2. **Joining mid-year.** The plan says "yearly fee"; nothing says whether a business that joins in Tir
   pays the whole year to Sene 30 or part of it. Default: the whole fee (the board's note says a payment
   "covers the year up to Sene 30"). (Robel, Truman)
3. **Which month commission and government share count in.** Default: the Ethiopian month of the payment
   that earned the commission, for both. (Truman)
4. **Extra-branch commission** is marked "sample amount, not decided yet" on the board. The setting
   (1,000 Birr) is used until decided. (Robel, Truman)
5. **Plan names** Starter/Full (plan) or Standard/Multi-branch (board): still open in DECISIONS.md;
   Starter/Full used.
6. **Undoing a government-share mark** ("Mark as not handed over") is a new row, as everything in money
   is append-only.
