# Phase 1 security review: sign-in flows

Date: 2026-10-31. Reviewer: Claude (code review with an attacker's view, plus tests). Scope: everything
under `apps/api/src/auth`, `apps/api/src/business`, `apps/api/src/sms`, migrations 0001–0006, the
sign-in screens in the three apps, and `deploy/Caddyfile*`.

**This is the Phase 1 exit gate (build plan, section 7). It needs Robel's sign-off before Phase 2
starts.** The plan also asks for an independent review or penetration test before full launch
(Phase 9); this does not replace that.

## Fixed in this review (each has a test in `apps/api/test/security.spec.ts`)

| # | Finding | Risk | Fix |
| --- | --- | --- | --- |
| F1 | Tickets that grant an action (set PIN, pick shop, finish reset, finish sign-up) could be replayed until they expired (10–30 min). Someone who copied one could set the PIN again or open a second session. | Medium | Every ticket has a `jti`; those five are spent once in `tc.used_ticket`, inside the same transaction as the action, so a refused weak PIN keeps the ticket usable. |
| F2 | No limit on SMS codes per phone. Anyone could make the system text one number over and over (cost, harassment), and each new code is another guess at forgot-PIN. | Medium | At most `auth.otp_per_phone_hour` (5) codes per phone per hour across all purposes; the API answers 429 `too_many_codes` and sends nothing. |
| F3 | `DEV_SMS=true` shows every SMS code on an open endpoint. A copy-pasted staging `.env` would leak codes in production. | High if it happened | New `APP_ENV` (local, staging, production). The API refuses to start with `DEV_SMS=true` in production, and production images must set `APP_ENV`. |
| F4 | No Content-Security-Policy. Sessions are kept in browser storage, so an injected script could steal them; the apps could also be framed (clickjacking). | Medium | Caddy sends CSP (scripts and connections only from our origin, fonts from Google Fonts), `frame-ancestors 'none'` for staff, owner and admin, and only Telegram Web for the customer app; `Cache-Control: no-store` on the API. |

## Checked and found sound

- **PIN and code storage**: argon2id (19 MiB, 2 passes) for PINs and SMS codes; nothing stored or logged
  in clear (test checks the audit log and code table); request logs carry method, path, status and time only.
- **Lockout**: wrong PINs counted per account in the database; the right PIN is refused while locked
  (acceptance test 2); limits come from settings.
- **Codes**: 6 digits from a cryptographic generator, 5 minutes, single use, 5 wrong tries per code.
- **Tokens**: HS256 with a secret of at least 32 characters, algorithm pinned; access tokens 15 minutes and
  checked against a live session on every call, so sign-out takes effect at once; refresh tokens random,
  stored as SHA-256, rotated on every use, and replaying an old one ends the whole family.
- **Tickets vs access**: a ticket is never accepted as an access token (`use` claim; permission test).
- **Permissions**: every protected endpoint names its roles; a route without them is refused; branch
  and business checks live on the server; the permission matrix test fails if a new route is missed.
- **Enumeration**: unknown phones take as long as a wrong PIN; customer and owner PIN resets answer the
  same for unknown numbers and send nothing.
- **SQL injection**: all queries are tagged templates; the one dynamic identifier comes from a fixed list.
- **Append-only data**: the app role cannot update or delete stamps, rewards or the audit log; triggers
  refuse it for every role.
- **Supabase**: tables live in schema `tc`, not exposed by Supabase's REST API; the API user has no DDL
  rights; Supabase's security advisor reports no issues.
- **Proxy**: the API trusts exactly one proxy hop (Caddy) for the caller's IP; its port is not published.

## Accepted for now (decisions for Robel and Truman)

1. **Endless lock cycles.** Five wrong PINs, then 15 minutes, then five more, forever: about 480 guesses a
   day per account against a million PINs. Locks also let a stranger keep one person locked out.
   Option: lengthen the lock after repeated locks, or require an SMS reset after the second lock.
2. **Phone numbers can be confirmed.** Joining with a known number says "already a member", owner
   sign-up says the number is in use, and the code limit answers differently for real numbers after five
   requests. Hiding this would make sign-up confusing; the plan's phone-first design accepts it.
3. **Rate limits are per API process** (in memory). Fine with one API container; move them to Postgres
   before running several.
4. **Inline scripts are still allowed by the CSP** because Next.js needs them; switch to nonces later.
5. **Tokens in browser storage** rather than HttpOnly cookies, to keep one API for the web apps and the
   Telegram mini app. The CSP is the main guard; revisit for the admin app in Phase 4.
6. **SMS wording is English only** until the Phase 6 templates.

## Not covered yet (later phases)

Admin sign-in with TOTP and backup codes (Phase 4); Telegram `initData` verification (needs the bot
token); encrypted backups and restore drill (Phase 9); independent penetration test (Phase 9).
