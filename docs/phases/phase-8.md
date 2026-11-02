# Phase 8 — Trust, safety, recovery and privacy

**Goal (plan, section 7):** the system stays honest and recoverable when people lose phones, make
mistakes or misbehave.

## Acceptance (plan)

1. A script that stamps 100 times in an hour from one phone raises a flag within one minute.
2. A recovery request cannot be approved by the person who made it.
3. Merging two shops leaves one set of customers with no duplicate cards.

Built in five parts: 8a flags and owner alerts, 8b admin recovery, 8c owner account requests,
8d customer data, 8e support tools.

## 8a — Flags and owner alerts

Boards: AdminSettingsSafety, AdminReqFlag, OwnUnusual (Today "Unusual activity"), OwnAlertSet.
Tests: `apps/api/test/phase8.flags.spec.ts` (acceptance 1 and the rest below).

- Three flags with limits edited in Admin → Settings → Safety (Owner only, logged):
  - **Stamps in one hour on one phone** (`flags.stamps_per_hour`): per cashier, per East Africa Time
    clock hour. Raised in the same transaction as the stamp that crosses the limit, so at once.
  - **Stamps typed by hand in a week** (`flags.hand_typed_share_pct`, board default 30%): per shop,
    Monday to Sunday.
  - **New cards in one hour in one shop** (`flags.new_cards_per_hour`, board default 25): checked
    when a card is added (join, sign-in from a join page, adding a shop).
- One flag per cashier and hour, per shop and week, per shop and hour. Flags are requests of type
  `flag` in Admin → Requests → Flags; the detail shows the signal for each kind.
- Owners (and managers, for their branch) see open flags on Today → OwnUnusual with what we saw,
  "Review these stamps", "Turn off access for …" and "It is fine, dismiss". Dismissing hides it for
  the business only; Temelash still decides on its own copy.
- OwnAlertSet, per person: Stamps wait for approval, Unusual activity, A cashier is locked out,
  A cashier signs in on a new phone, Daily summary, Weekly report; how (Notification or SMS); daily
  summary time 20:00, 21:00 or 22:00. "Notification" is the owner inbox; SMS also sends a text.

### Unclear (defaults used, flagged)

1. **Minimum week for the typed share.** One typed stamp would be 100%. A shop needs
   `flags.hand_typed_min_stamps` (20) stamps in the week before the share counts; editable in Safety.
2. **"Stamps wait for approval"** is told once, when the waiting list goes from empty to one stamp,
   not for every stamp.
3. **"New phone"** means a browser (user agent) this cashier has not signed in from before; there is
   no device id yet.
4. **Weekly report** goes Monday 08:00 East Africa Time ("every Monday morning"). Summaries go to
   owners only; managers' counts would need to be per branch.
5. **Managers** have no inbox, so they get alerts only when they choose SMS.
6. **Push notifications** do not exist yet; "Notification" means the owner inbox.

## 8b — Admin account recovery

Boards: AdminLoginRecover*, AdminTeamRecovery, AdminRecoveryApprove, AdminAccount.
Tests: `apps/api/test/phase8.recovery.spec.ts` (acceptance 2 and the rest below).

- Sign-in → "Use a backup code" → "I lost my phone and my backup codes": email and the name of the
  Owner they will call. The answer is the same whether or not the email is an admin.
- Every other active Owner is emailed and sees "An account reset is waiting for you" in Settings →
  Team. Approve needs the approver's **password and a fresh code** (plan, section 8; the board shows
  only a code). Nobody can approve their own reset (API refuses, and the database check refuses
  `decided_by = admin_id`). Deny keeps the account as it was.
- After approval the new phone waits `auth.admin_recovery_wait_hours` (24). Sign-in before then
  shows "Your reset is approved" with the time; after, sign-in sets up a new authenticator and 10 new
  backup codes, and the old ones stop working.
- Email at every step: requested (to them and the other Owners), approved, denied, done (to them and
  the Owners), and a new-device sign-in (to them and the other Owners, unless they turn it off).
- Account: "Make new backup codes" and "Set up a new phone" (code from the current app first).

### Unclear (defaults used, flagged)

1. **Email provider.** Emails are written to `tc.email_outbox` but nothing sends them yet. Choose a
   provider (and sender address) before relying on recovery emails. Until then Owners see waiting
   resets in Settings → Team.
2. **No "your new phone is ready" email** at the end of the 24 hours (that needs a timer); the
   approval email gives the time instead.
3. **New device** means a browser (user agent) not used by this admin before.

## 8c — Owner account requests

Boards: OwnChangePhone*, OwnLostPhone*, OwnPrivacy*, OwnCloseBiz*, AdminReqLostPhone, AdminReqDeletion,
AdminReqClosing, AdminBusiness ("Cancel the closing"), AdminSettings "Promises we make to owners".
Tests: `apps/api/test/phase8.requests.spec.ts`.

- **Change phone** (Security → YOUR ACCOUNT, owners and managers): new number and PIN, a code to the
  new number, then the old number gets an SMS; other sessions end.
- **Lost phone** (sign-in code screen → "I no longer have this phone number"): business, name, new
  number, old number. Matched to a business by the old number or the exact name; Temelash ticks four
  checks and moves the account to the new number (or rejects, told by SMS). Reference LP-….
- **Privacy** (menu, owners): what the shop may do with customer data, and "send deletion request" for
  a customer's number. Temelash deletes the name and phone (the account is anonymised; stamps stay)
  or rejects with a reason. Reference DEL-….
- **Closing**: reasons and PIN → pending (answer by N working days) → approved with a closing date
  (N days) → closes on the date (people can no longer sign in, customers see "This shop has closed").
  The owner can cancel while waiting or "Keep my business open" after approval; Temelash can decline
  or cancel the closing. The owner is told in the inbox and by SMS on approval.
- **Download my reports and customer list**: a CSV of every card (phone masked), logged.
- The promise days (answer, after, lost-phone, sign-up, deletion) are settings in Admin → Settings → Rules.

### Unclear (defaults used, flagged)

1. **Working days** are Monday to Friday; public holidays are not counted.
2. **What closing deletes.** On the date the business is closed and its people disabled; cards and
   stamps stay (append-only), shown as closed. Removing the customer list for good belongs to the
   retention schedule (8d).
3. **Lost-phone matching** by exact business name can match the wrong shop if two share a name; the
   checklist (call the new number) is the safeguard.
