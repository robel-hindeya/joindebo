# Phase 1: Identity, businesses and permissions

**Goal (build plan, section 7):** every kind of person can sign in safely, and the server enforces who
may do what.

**Boards:** Welcome*, ScanJoin*, ScanJoinLock, StaffSignIn*, StaffSetPin*, StaffPickShop, OwnSignIn*,
OwnOtp*, OwnForgot*, OwnSignUp*, OwnMgrSignIn, OwnMgrFirstPin.

**Acceptance (plan):**
1. A manager cannot read another branch by changing an id in the URL.
2. Five wrong PINs lock the account, and the sixth (correct) PIN is still refused until the lock ends.
3. An expired staff PIN forces a change before any stamp can be added.

**Exit gate:** security review of the auth flows; permission tests cover every endpoint.

## Rules taken from the prototype

| Rule | Source |
| --- | --- |
| Phone: Ethiopian mobile, 9 digits starting 7 or 9, shown as +251 | ScanJoin `errPhone` |
| PIN: exactly 6 digits for customers, staff, managers and owners | ScanJoin, Staff, Owner |
| SMS codes: 6 digits, expire after 5 minutes | ScanJoin `rSubOtp`, Owner `otpTitle` |
| Weak PIN refused: six of the same digit, any 6-digit run of 0123456789 or 9876543210, 123123, the last 6 digits of the person's own phone | Staff `weak`, Owner `weakPin` |
| Customer join needs the Terms/Privacy box ticked | ScanJoin `errConsent` |
| Wrong PIN shows tries left; at the limit sign-in pauses with a countdown and a "Reset my PIN" link | ScanJoin `errWrongPin`, `lockText` |
| Customer forgot PIN: phone → SMS code → new PIN twice | ScanJoin reset steps |
| Staff/manager first PIN is set by the owner and must be changed at first sign-in; PINs expire (default 90 days) | Staff `StaffSetPin`, Owner team pages |

## Unclear or conflicting (decide before launch, defaults used meanwhile)

1. **Lock length.** ScanJoin locks for **5 minutes**; the plan says 5 tries / **15 minutes**. The server
   reads `auth.lock_minutes` (seeded 15, the plan's value). Truman to confirm.
2. **SMS provider** is not chosen (DECISIONS open item 3). Codes go through an `SmsSender` interface; in
   development a dev sender writes them to `tc.sms_outbox` and the dev-only endpoint
   `GET /api/v1/dev/sms` shows them. Disabled unless `DEV_SMS=true`; never on in production.
3. **Customer join vs card.** ScanJoin creates the account *and* the shop card in one step. Phase 1
   builds the account (sign up, sign in, reset); creating the card and the welcome stamp is Phase 2
   (stamp loop), so the join endpoint takes the shop code and Phase 2 adds the card.
4. **Tries before a lock differ by app.** Customer board: 5. Owner app (OwnSignIn): 3. Plan: 5. Separate
   settings: `auth.customer.max_failed_attempts` 5, `auth.business.max_failed_attempts` 3 (owners and
   managers), `auth.staff.max_failed_attempts` 5. Truman to confirm.
5. **Owners and managers** both use the business sign-in (OwnSignIn: "For shop owners and managers"):
   phone + PIN, then a 6-digit SMS code. Owner sign-up: business name, owner name, phone, optional agent
   phone → SMS code → PIN → business waits for Temelash approval.
6. **Staff in more than one business** (DECISIONS open item 5). Sign-in matches the phone in every
   business; if more than one account accepts the PIN, the app shows the shop picker (StaffPickShop).

## Progress

- [x] Acceptance tests written first: `apps/api/test/phase1.acceptance.spec.ts` (plan's three checks plus
      the flow behind each board) and `apps/api/test/permissions.spec.ts` (every protected endpoint × every
      kind of caller, and a check that no protected route is left out). 107 tests pass on Postgres 17.
- [x] API: customer join / sign-in / PIN reset; business (owner and manager) sign-in with SMS code,
      sign-up, forgot PIN, first/expired PIN; staff sign-in, shop picker, forced PIN change; refresh,
      sign-out everywhere, `/me`; lockouts and audit rows; per-IP rate limit on auth endpoints.
- [x] Screens ported from the prototype with its wording in three languages and its motion classes:
      Welcome → ScanJoin (join, sign-in, lock, reset, "You are in!"), StaffSignIn, StaffSetPin, StaffPickShop,
      OwnSignIn, OwnOtp, OwnForgot, OwnSignUp (form, code, PIN), OwnMgrFirstPin and the expired-PIN page.
      Tested in the browser against the API on Supabase.
- [ ] Not yet: shop logos (initials until OwnLook, Phase 3), the welcome stamp (Phase 2), "I no longer have
      this phone" (OwnLostPhone, Phase 8). Strings added beyond the prototype: already-a-member, unknown
      shop link, too many tries, "at N stamps"; Amharic and Oromo for these need native review.
- [ ] Telegram Web App launch and `initData` verification (needs the bot token).
- [ ] Exit gate: security review of the auth flows.
