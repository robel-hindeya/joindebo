# Decisions

Date, decision, who decided. Open items are at the bottom; the build plan (section 12) says Truman
owns product, pricing and wording, Robel owns architecture and security, and money rules,
permissions or the data model need both.

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-31 | Develop on **Supabase (managed Postgres only)** until development is final, then move to a VPS. No Supabase Auth/REST/Storage, so the move is a dump-and-restore plus a new `DATABASE_URL`. | Robel (request), Claude (how) |
| 2026-10-31 | Supabase project `temelash-card-dev` (ref `oavipgttrrqeabtlgmia`), org TemelashCard, region eu-central-1 (Frankfurt), free tier. | Robel |
| 2026-10-31 | New private repo `robel-hindeya/temelash-card`; the earlier `robel-hindeya/temelash` stays as reference only. | Robel |
| 2026-10-31 | Stack per build plan section 11 defaults: TypeScript, NestJS, PostgreSQL, Next.js for all four apps with one shared UI package. | Plan default |
| 2026-10-31 | Queue: pg-boss on Postgres instead of Redis for now (one less service on Supabase and on the VPS). Revisit if queue load needs Redis. | Claude, needs Robel's OK |
| 2026-10-31 | Data access with postgres.js and plain SQL migrations (no ORM), so append-only grants, triggers and partial indexes are written exactly. | Claude, needs Robel's OK |
| 2026-10-31 | App database role `tc_app` cannot UPDATE/DELETE append-only tables; a trigger also refuses it for every role. Verified against Supabase with the `tc_api` user. | Claude |
| 2026-10-31 | **Staging on a VPS** with Docker Compose and Caddy (HTTPS, path routing, password-protected), images built by GitHub Actions and pushed to GHCR. Production later reuses the same setup. See deploy/README.md. | Robel |
| 2026-10-31 | Auth (Phase 1): PINs and SMS codes hashed with argon2id; 15-minute HS256 access tokens; random refresh tokens stored as SHA-256, rotated on every use, replay revokes the family; sign-in steps carry signed single-purpose tickets that are never accepted as access tokens. | Claude, needs Robel's OK |
| 2026-10-31 | Until an SMS provider is chosen, codes go to `tc.sms_outbox` through an `SmsSender` interface; `DEV_SMS=true` (local and staging only) shows them at `/api/v1/dev/sms`. | Claude |
| 2026-10-31 | **Phase 1 exit gate passed.** Security review (`docs/phases/phase-1-security-review.md`) signed off, including its six accepted risks (endless lock cycles, phone numbers can be confirmed, in-memory rate limits, inline scripts in CSP, tokens in browser storage, English-only SMS) for now. Phase 2 may start. | Robel |
| 2026-10-31 | Phase 2 defaults replaced by the owner board's own rules: one visit = the shop's time between stamps (1, 2, 4, 8 or 24 h, default 4); hand-typed stamps follow the shop setting (check, allow, or do not allow; default check); undoing a reward is owner only. See docs/phases/phase-3.md. | Prototype (OwnRules, OwnRoles) |
| 2026-10-31 | **Phase 2 exit gate passed.** Load test (`docs/phases/phase-2-load-test.md`): 50 stamps/s for 10 min, no duplicate or lost stamps, ledger rebuilt with no mismatch. Signed off; the six Phase 2 defaults in `docs/phases/phase-2.md` stand until Truman says otherwise. Phase 3 may start. | Robel |
| 2026-10-31 | Phase 4 started before Phase 3's exit gate (three real owners set up a shop unaided in under 20 minutes). The owner test stays required before the private pilot opens. | Robel |
| 2026-10-31 | Apps served under one domain by path: `/` customer, `/staff`, `/owner`, `/administrator` (Next.js `basePath`). | Claude |
| 2026-10-31 | **SMS provider: AfroMessage.** Messages stay in `tc.sms_outbox` (written in the action's transaction); a sender in the API delivers them with `POST /api/send`, retries with back-off up to `sms.max_attempts`, and never sends an expired code. Production must run with `SMS_PROVIDER=afromessage`. | Robel |
| 2026-11-01 | The admin app ships in English only: its strings live in `en.json` under `admin.` and the translation check does not ask for Amharic or Oromo copies (phase-4.md, item 2). Strings with a number can have a `_one` form for a count of 1. | Claude, needs Robel's OK |
| 2026-11-01 | Phase 5 (money) started before Phase 4's exit gate (the private pilot with 5 to 10 businesses). The pilot can open alongside; money is tracked outside the system until Phase 5 is signed off. | Robel |
| 2026-11-03 | **SMS provider changed: AfroMessage → SMS Ethiopia** (smsethiopia.com, SMS API v2). AfroMessage is removed from the code. Same outbox and sender; delivery is `POST /api/v2/sms/send` with the API key in the `KEY` header, status by `GET /api/v2/sms/{id}`. The key's campaign sets the Sender ID and SMS package. Production must run with `SMS_PROVIDER=smsethiopia` and `SMSETHIOPIA_KEY`. | Robel |
| 2026-11-03 | **Tagline: "Your loyalty is honoured."** (Amharic draft: *ታማኝነትዎ ይከበራል።*) It works whichever brand name is chosen. Not yet in the apps. | Robel, needs Truman's OK (wording) |
| 2026-11-03 | **Brand name: Debo** (ደቦ / *Daboo*, neighbours helping each other, the host giving back), replacing *Temelash*. Brand book (positioning, story, message house, voice, logo brief, colours from `tokens.css`, type, messages, three-language lines): [Debo Brand Book](https://claude.ai/artifact/LnUgdjFNnsdjGB3s1TxWij). Web home **joindebo.com** (not yet registered; also take debo.com.et and point debocard.com at it), call to action **Join Debo**. Apps, SMS and posters still say Temelash until the trademark check clears. | Robel, needs Truman's OK and an EIPA check |

## Open

1. **Plan names differ.** The build plan says *Starter* (19,000 Birr) and *Full* (25,000 Birr); the
   prototype's Admin board shows *Standard* and *Multi-branch*. The database uses `starter` / `full`
   and the seed maps Standard → starter, Multi-branch → full. Which names do the screens show? (Truman)
2. **Staging VPS and domain.** Which VPS provider and which subdomain staging uses; needed to finish the Phase 0 deploy gate. (Robel)
3. ~~**SMS provider**~~ Decided: SMS Ethiopia (2026-11-03, Robel; was AfroMessage). Still open: the approved Sender ID on the SMS Ethiopia campaign, and whether Amharic SMS (Unicode, shorter messages, higher cost) is wanted in Phase 6.
4. **Error tracking** (Sentry or self-hosted GlitchTip on the VPS). (Robel)
5. **Staff in more than one business.** The schema allows the same phone in several businesses and
   several branches of one business; the shared `/staff` sign-in then shows a picker
   (StaffPickShop). Confirm staff may belong to more than one business. (Truman)
6. **Oromo month names** in `@temelash/ethiopian-calendar` and all Amharic/Oromo strings are drafts
   pending native-speaker review (plan, ground rule 4).
7. **Owner app while a sign-up waits for approval.** The Owner board has no screen for a pending
   business, so the app opens as if live (customers cannot join and cashiers cannot stamp until
   approved). Show a "we are checking your business" note on Today, or nothing? (Robel, Truman)
8. **Stands (Phase 7), defaults used until decided** — see `docs/phases/phase-7.md`, "Unclear":
   real prices and opening stock (the board's example prices are loaded; the owner screen still says
   "These are example prices."), delivery outside Addis Ababa, whether stand cash belongs in the
   finance books, whether stock should drop automatically when an order goes out, which admin roles
   change prices (now Owner and Finance), and whether stage changes also go by SMS. (Truman)
9. **Email provider for admin emails (Phase 8b).** Account recovery and new-device alerts write to
   `tc.email_outbox`. The SMTP sender is built and off: set EMAIL_PROVIDER=smtp and the SMTP_* values
   (any SMTP service) to switch it on. Which provider and sender address? (Robel)
10. **Safaricom numbers and SMS Ethiopia.** The apps accept Ethio Telecom (09…) and Safaricom (07…)
   numbers, but SMS Ethiopia only sends to numbers starting 2519 (error 10000 otherwise). Safaricom
   customers and staff would never get a code. Keep accepting 07… (and ask SMS Ethiopia about
   Safaricom, or add a second provider for it), or accept only 09… for now? (Robel)
11. **SMS cost report.** SMS Ethiopia's API gives no cost per message (only the segment count), so the
   admin SMS cost total stays at 0. Leave it at 0 and read costs from the SMS Ethiopia console, or
   work it out from a price per segment in `tc.setting`? (Robel)
12. **Debo trademark.** *Debo* was chosen although it was found already in use; *DeboCard* would not
   get around that (trademark offices ignore "Card"). Before artwork, print or renaming the apps: EIPA
   search in classes 35, 9 and 42, who holds it, and the domain and handles. Amharic and Oromo lines
   in the brand book need a native speaker. (Robel, Truman)
