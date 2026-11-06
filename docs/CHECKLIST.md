# Temelash Card — full app check list

Go through this on a phone-sized browser window for the customer, staff and owner apps, and a
laptop for Admin. Tick each box when what you see matches **Expect**. Note anything that does not.

## Before you start

**Where**

| App | Local (Docker stack) | Who uses it |
|---|---|---|
| Front page | http://localhost:8080/ | Everyone: choose owner, staff or customer |
| Customer | http://localhost:8080/?start=1 | Customers |
| Join page for a shop | http://localhost:8080/j/SHOPCODE | Customers scanning the poster |
| Staff (cashier) | http://localhost:8080/staff | Cashiers |
| Owner | http://localhost:8080/owner | Owners and managers |
| Admin | http://localhost:8080/administrator | Temelash team |

Start the stack with `docker compose up --build -d`. Its database runs in Docker and keeps its data in the
volume `debo_db`, through restarts and `docker compose down`. Only `docker compose down -v` deletes it.

**Example company:** `npm run seed:example -w @temelash/db` adds Yeshi Coffee House (shop code `YESH30`), with two
branches, a team, twelve customers and two weeks of stamps, so every owner screen has real data. Phones and the PIN
are in `packages/db/src/seed-example.ts`. Local and staging only.

**People you need** (use test phones you control; never a real customer's number)

- [ ] Two Admin accounts with the Owner role (you, and a second one for approvals). Plus one Finance
      and one Support admin to check what each role can see.
- [ ] One test owner phone with an approved business (it has a shop code, e.g. MOKA01).
- [ ] One manager phone and two cashier phones in that business.
- [ ] Two or three customer phones.
- [ ] A phone that can receive SMS. On the free SMS Ethiopia test campaign, only numbers verified in their console get texts (error 10007).
      With `DEV_SMS=1` locally the codes show in the API log instead.

**Languages:** repeat a few screens in አማርኛ and Afaan Oromoo. Look for clipped or overflowing text.

---

## Phase 0 — Foundations

- [ ] 1. Open http://localhost:8080/api/v1/health. **Expect:** `ok: true`, `db: up`, `migrations: 22`.
- [ ] 2. Open each app URL above. **Expect:** each loads with no error and the same fonts and colours.
- [ ] 3. In the browser developer tools (Network), look at any page's response headers. **Expect:** a
      Content-Security-Policy header is present.

## Phase 1 — Customer accounts

- [ ] 1. Open http://localhost:8080/ and choose "I'm a customer". **Expect:** the language choice (English,
      አማርኛ, Afaan Oromoo). Tigrinya, Somali, Sidama and Wolaytta show as "Coming soon".
- [ ] 2. Choose a language. **Expect:** every word on screen changes; the choice is remembered on reload.
- [ ] 3. Open the shop's join page (`/j/SHOPCODE`). Join with a new phone, a 6-digit PIN and consent.
      **Expect:** without consent you cannot continue; after joining, the wallet shows the shop's card.
      (Simple PINs such as 123456 are refused for owners and cashiers, not for customers.)
- [ ] 4. Sign out (menu → Sign out), then sign in with phone and PIN. **Expect:** back in the wallet.
- [ ] 5. Enter a wrong PIN 5 times. **Expect:** "tries left" counts down, then the account locks for
      15 minutes and even the right PIN is refused.
- [ ] 6. "Forgot PIN": enter the phone, get the SMS code, set a new PIN. **Expect:** the new PIN works
      and the old one does not.
- [ ] 7. Join a second shop from its join page while signed in. **Expect:** "added to your wallet",
      with two cards.
- [ ] 8. Open a card, then the (i) button at the top right. **Expect:** the business page with
      category, open now, directions, address, opening hours (today in bold), branches and the rewards.
- [ ] 9. With the network off and no cards saved on the phone, open the wallet. **Expect:** "Could not
      load your cards" with Try again (not "no cards yet").

## Phase 2 — Stamping

- [ ] 1. Customer: open a card. **Expect:** a QR code that refreshes every minute, plus a short code
      to type.
- [ ] 2. Cashier: sign in at `/staff` (phone and PIN; a first-time PIN must be changed). If the
      cashier works at two shops, **Expect:** a shop picker.
- [ ] 3. Cashier: scan the customer's QR. **Expect:** a preview (card, count, next reward). Tap Add,
      and the stamp count goes up by one. The customer sees the new stamp and a notification.
- [ ] 4. Scan the same card again the same visit. **Expect:** "already stamped" (duplicate).
- [ ] 5. Type the short code instead of scanning. **Expect:** it works only if the shop allows typed
      codes; with "review" it goes to the owner's "To check" list.
- [ ] 6. Take a QR screenshot, wait 2 minutes, scan it. **Expect:** refused as expired.
- [ ] 7. Turn the cashier's network off, stamp, then turn it on. **Expect:** the stamp is queued, then
      sent, with no duplicate.
- [ ] 8. Fill a card to its reward. **Expect:** the customer sees "Reward unlocked" with a reward
      code. The cashier confirms the reward and the customer sees it used.
- [ ] 9. A cashier over their hourly limit. **Expect:** the stamp waits for approval and the owner
      sees it on Today.
- [ ] 10. On a phone with a camera light: the scanner shows a "Light" button that turns it on and off.

## Phase 3 — Owner app

- [ ] 1. Owner sign-in: phone, PIN, then the SMS code. **Expect:** Today with stamps and rewards today,
      a 7-day chart, and the attention list.
- [ ] 2. Today → approvals and "To check". Approve one and decline one. **Expect:** counts update and
      the customer's card changes to match.
- [ ] 3. Customers: search by the last digits of a phone. **Expect:** masked phone numbers. Open a
      customer to see their stamp history.
- [ ] 4. Customer → fix sheet: add a stamp, remove one, undo a reward, extend a reward, pause and
      resume the card. **Expect:** each one is logged, and the customer gets a notice.
- [ ] 5. Team: add a cashier and a manager (manager limited to one branch), reset a PIN, unlock a
      locked cashier, set an hourly limit, turn access off. **Expect:** each works and is logged.
- [ ] 6. Shop → Stamp card: change the stamps needed and the reward ladder. **Expect:** new cards use
      the new rules; existing cards keep theirs.
- [ ] 7. Shop → Rules, Branches and hours (add a branch, set hours), Look (colour and logo),
      QR and posters (poster, table tent, sticker; print), Details. **Expect:** saved, and the customer
      card shows the colour and logo.
- [ ] 8. Reports for 7, 14 and 30 days. **Expect:** numbers match what you did (they can be up to a
      minute old because of the cache).
- [ ] 9. Activity log, Date and time (Ethiopian calendar and Ethiopian clock), Security (change PIN,
      sign out other phones). **Expect:** dates show in the chosen calendar everywhere.
- [ ] 10. Menu → Help: questions open and close; "Tell us what went wrong" sends (Admin sees it in
       Requests → Help). Call and Telegram show only after Admin sets them (Settings → Rules).
- [ ] 11. Team → "Who can do what". A new shop sees "Set up your shop" on Today until its four steps
       are done.
- [ ] 12. Turn the phone's network off. **Expect:** the "No connection" banner.
- [ ] 13. Sign in as the manager. **Expect:** only their branch; no Shop tab; owner-only rows hidden
       (plan, messages, news, privacy, stands, closing).

## Phase 4 — Admin back-office and pilot

- [ ] 1. Admin first sign-in: email, temporary password, scan the authenticator QR, enter the code,
      save the 10 backup codes. **Expect:** codes shown once and the Overview loads.
- [ ] 2. Sign out and in with a code; then with a backup code. **Expect:** each backup code works once.
- [ ] 3. Wrong password or code 5 times. **Expect:** locked for 15 minutes. Leave the browser idle
      30 minutes, **Expect:** signed out.
- [ ] 4. Sign up a new business in the owner app. In Admin → Requests → Sign-ups, tick the three
      checks and approve (trial or pilot). **Expect:** the owner gets an SMS and an inbox message,
      and can stamp.
- [ ] 5. Reject a sign-up with a reason. **Expect:** the owner gets an SMS with the reason.
- [ ] 6. Businesses: search, open a business, pause it with a reason, resume. **Expect:** while paused,
      stamping is refused and the owner is told.
- [ ] 7. Settings → Safety → "Pause all stamping" (password and code). **Expect:** every shop stops
      within 5 seconds with your message; turn it back on.
- [ ] 8. Activity log: filter by type, business and person. **Expect:** every action above is there,
      including looking at a business.
- [ ] 9. Sign in as Support. **Expect:** no Finance, Agents or money settings, and no money exports.
- [ ] 10. Audience: unique clients counted once across shops, per business; "Refresh now" is logged.
- [ ] 11. Settings → My account: change password (12+ characters, upper and lower case, a number, a
       symbol); other devices are signed out. Also "Where you are signed in", "Sign out other devices"
       and recent sign-ins.
- [ ] 12. Type a wrong PIN or code inside any app (close business, delete account, approve a reset).
       **Expect:** a "not right" message, and you stay signed in.

## Phase 5 — Money

- [ ] 1. Admin → a business → Finance: record a payment (Telebirr, cash, etc.). **Expect:** a receipt
      with a number; the balance goes down; the owner gets a receipt message.
- [ ] 2. Correct a payment amount, then reverse one. **Expect:** new correcting rows (nothing edited);
      the receipt shows the change.
- [ ] 3. Change the plan, add a branch, extend a trial. **Expect:** the fee changes as the rules say.
- [ ] 4. Finance page: due, overdue, collected. Report page: government share. **Expect:** totals match
      the payments.
- [ ] 5. Agents: add an agent, link a business, see commission, record a payout. **Expect:** commission
      is removed if the payment is reversed.
- [ ] 6. Export a file. **Expect:** it asks for password and code first, and is logged.
- [ ] 7. Owner app → Plan and payments. **Expect:** the same fee, paid, balance and "covered until"
      as Admin.

## Phase 6 — Messages, news and notifications

- [ ] 1. Admin → Messages → New message to "Every business". **Expect:** the owners see it in
      Messages from Temelash, with an unread badge on the menu.
- [ ] 2. Open it as an owner. **Expect:** Admin's "opened" count goes up. "Send again" goes only to
      those who did not open it.
- [ ] 3. "Payment reminders" sends only to businesses with a balance.
- [ ] 4. Owner → Shop news → Write news (English needed, at most 140 characters) → check → send.
      **Expect:** customers who allow news see it; "You can send N more this week" goes down; the
      limit stops the third one.
- [ ] 5. Customer → menu → Notifications. **Expect:** stamp, close-to-reward, reward-ending and news
      notices; "Mark all as read" works; the bell dot clears.
- [ ] 6. Customer → Settings → switch "Shop news" off and send news again. **Expect:** that customer
      gets nothing.
- [ ] 7. Owner → My requests. **Expect:** your requests with Waiting, In progress or Done.

## Phase 7 — Stands

- [ ] 1. Owner → Shop → QR and posters → PRINTED STANDS → Order a stand. **Expect:** five items with
      prices; + and − (0 to 20); the button shows the count and total.
- [ ] 2. Review the order: choose the printed language, branch and delivery phone, then place it.
      **Expect:** "Order ST-… is placed" with the lines and total.
- [ ] 3. Admin → Stands → Production list. **Expect:** the order's items are counted; "to make or buy"
      = ordered minus stock.
- [ ] 4. Admin → Stock: add 10 to one item, then try taking away more than there is. **Expect:**
      refused; stock never goes below zero; changes are in the log.
- [ ] 5. Admin → Prices: change a price and hide an item. **Expect:** the owner sees the new price, not
      the hidden item; the placed order keeps its old price.
- [ ] 6. Admin → Requests → the stand order: move it Confirmed → Printing → On the way → Delivered.
      **Expect:** at each step the owner gets an inbox message with "See my order".
- [ ] 7. Owner → Today shows "Did your stand arrive?". Answer "All here and fine" with Cash.
      **Expect:** Received. Admin → "Cash received" closes the order.
- [ ] 8. Another order: report "Damaged or wrong" (a note is required). Admin → "Send a replacement"
      (back to Printing) or "Close without a replacement".
- [ ] 9. Cancel an order before On the way. **Expect:** allowed with a reason; not possible after.
- [ ] 10. Sign in as the manager. **Expect:** no stands rows.

## Phase 8 — Trust, safety, recovery and privacy

### 8a Flags and alerts

- [ ] 1. Admin → Settings → Safety. **Expect:** limits for stamps per hour on one phone, typed by
      hand per week (with the minimum stamps), and new cards per hour.
- [ ] 2. Set "stamps per hour" low (e.g. 5) and stamp 6 customers with one cashier. **Expect:** one
      flag in Admin → Requests → Flags; the owner gets "Unusual activity" in Messages and on Today.
- [ ] 3. Owner → Today → the alert. **Expect:** cashier, branch, time, stamps, phones; "Review these
      stamps", "Turn off access for …" and "It is fine, dismiss". Dismiss hides it for the owner;
      Admin still sees it.
- [ ] 4. Owner → menu → Alerts: switch things off, choose SMS, pick 20:00. **Expect:** saved;
      with SMS chosen the owner also gets texts.
- [ ] 5. Lock a cashier out (5 wrong PINs). **Expect:** the owner gets "A cashier is locked out".
- [ ] 6. Put the limits back to normal afterwards.

### 8b Admin account recovery (needs two Owner admins)

- [ ] 1. Admin sign-in → Use a backup code → "I lost my phone and my backup codes". Give your email
      and the other Owner's name. **Expect:** "Reset requested".
- [ ] 2. As the other Owner: Settings → Team. **Expect:** "An account reset is waiting for you".
      Approve with password and code. **Expect:** approved; the first admin cannot approve their own.
- [ ] 3. As the first admin, sign in with your password. **Expect:** "Your reset is approved" with the
      time 24 hours later. (To test the end now, ask a developer to shorten the wait.)
- [ ] 4. Settings → My account: "Make new backup codes" and "Set up a new phone". **Expect:** old codes
      stop working; the new phone works.
- [ ] 5. Emails go out once `EMAIL_PROVIDER=smtp` and the `SMTP_*` settings are set on the server;
      until then they wait in `tc.email_outbox`.

### 8c Owner account requests

- [ ] 1. Owner → Security → Change my phone number: new number and PIN, then the code sent to the
      new number. **Expect:** the old number gets an SMS; sign-in works only with the new number.
- [ ] 2. Owner sign-in → code screen → "I no longer have this phone number". Fill the form.
      **Expect:** a reference LP-…. Admin → Requests → Lost phone: tick the four checks → Change the
      number. **Expect:** the owner signs in with the new number.
- [ ] 3. Owner → menu → Privacy: read the page, send a deletion request for a test customer's
      number. Admin → Requests → Deletion → tick → Delete. **Expect:** that customer is signed out
      and cannot sign in; the shop keeps the stamp counts.
- [ ] 4. Owner → Security → Close my business: reason and PIN. **Expect:** "Waiting for our approval",
      with the answer-by date. Cancel it, then send it again.
- [ ] 5. Admin → Requests → Closing: tick three checks → Approve. **Expect:** the owner gets an SMS
      and a message; the owner app shows "Closes on …" with days left; everything still works.
- [ ] 6. Owner → "Keep my business open". **Expect:** back to normal. (Admin can also cancel it from
      the business page.)
- [ ] 7. "Download my reports and customer list". **Expect:** a CSV file with masked phones.

### 8d Customer data

- [ ] 1. Customer → Settings → PRIVACY: switch "Share my visit activity" off. **Expect:** the owner's
      customer list no longer shows that customer's last visit.
- [ ] 2. "Download my data". **Expect:** a file with the account, cards, stamps and notifications.
- [ ] 3. ACCOUNT → Delete account: a wrong PIN is refused; the right PIN shows "Account deleted".
      **Expect:** signed out, and sign-in no longer works. After 30 days the number is erased and can
      join again.

### 8e Support tools

- [ ] 1. Admin → a business → Support tab → Add a follow-up for today. **Expect:** it shows on Overview
      under "Follow-ups due"; tap it to mark it done.
- [ ] 2. "See what the owner sees". **Expect:** read-only numbers, and a log entry each time.
- [ ] 3. "Edit business details": change the name. **Expect:** the owner app shows the new name.
- [ ] 4. "Merge a duplicate": use a test duplicate with a shared customer. **Expect:** that customer has
      one card here with all the stamps; the duplicate is closed.
- [ ] 5. "Close one branch" (only offered with 2 or more branches). **Expect:** the branch is gone from
      the owner app.
- [ ] 6. Requests → "Who handles this?" to assign a request to a teammate.

## Phase 9 — Launch readiness

- [ ] 1. `npm run lint`, `npm run typecheck`, `npm test`. **Expect:** all pass (733 API tests, which need `TEST_DATABASE_URL` set to a throwaway Postgres or most are skipped).
- [ ] 2. Phone speed: on a mid-range Android with Chrome DevTools "Slow 3G" (or a real 3G SIM), time 20
      scans from tapping Scan to the result. **Expect:** 95% under 1.5 seconds.
- [ ] 3. Server load (developer): `scripts/loadtest` against a throwaway database. **Expect:** p95 under
      1.5 s and `PASS` from verify.mjs. (2026-11-02: p95 39 ms.)
- [ ] 4. Restore drill: `scripts/ops/restore-drill.sh` into an empty database. **Expect:**
      `same_counts=yes`. Log it in `docs/ops/disaster-recovery.md`.
- [ ] 5. Native speakers read every Amharic and Oromo screen on a small phone. **Expect:** natural
      wording, nothing clipped.
- [ ] 6. Accessibility on a phone: largest system text size, a screen reader (TalkBack), only the
      keyboard on Admin. **Expect:** everything readable, labelled and reachable.

## Launch checklist (needs people, from plan sections 9 and 10)

- [ ] Point-in-time backups on, in another region, and one monthly drill done on the real backup.
- [ ] Independent security review or penetration test, fixes made and retested.
- [ ] Uptime monitoring on `/api/v1/health`, alerting, a status page, and error tracking.
- [ ] Hosting and licensing in the Temelash entity's name; the production VPS and domain.
- [ ] Terms and privacy policy from a lawyer, in English, Amharic and Afaan Oromoo, published.
- [ ] A paid SMS Ethiopia campaign with an approved Sender ID; an email provider for admin email.
- [ ] Real stand prices and stock entered; the "example prices" note removed.
- [ ] Every item in DECISIONS.md "Open" decided.
- [ ] `DEV_SMS` off and `SEED_ALLOWED` off in production; test admin accounts disabled.
- [ ] Support playbook written (plan, Release 2 gate) and the tabletop exercise done (Phase 8 gate).
