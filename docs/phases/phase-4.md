# Phase 4: Admin core, sign-up and the private pilot

**Goal (build plan, section 7):** Temelash can approve real businesses and watch them, safely. This is the
first release gate.

**Boards:** AdminLogin*, AdminOverview, AdminBusinesses, AdminBusiness*, AdminRequests, AdminReqSignup*,
AdminApproveSignup, AdminAudit, AdminSettings*, AdminSettingsSafety, AdminKillSwitch, AdminCustomer*,
AdminPauseBusiness.

**Acceptance (plan):**
1. An admin with the Support role cannot reach any money screen or money export.
2. The kill switch stops every stamp and redemption within 5 seconds and shows the owner message.
3. Every admin action appears in the log with the right actor.

**Exit gate (Release 1, private pilot):** 5 to 10 friendly businesses on the free pilot, money tracked
outside the system until Phase 5, a written rollback plan, and an on-call person for the first two weeks.

## Rules taken from the plan and the Admin board

| Rule | Source |
| --- | --- |
| Sign-in at `/administrator`: email and password, then a 6-digit authenticator (TOTP) code or a backup code; first sign-in sets up the authenticator and shows 10 backup codes once ("I saved my backup codes"). | Plan section 7 and 8; Admin login boards |
| Five wrong tries lock for 15 minutes ("How long it stays locked" is a setting); sign-out after 30 idle minutes. | Plan; Admin safety settings |
| TOTP: 30-second steps, a used code cannot be reused (replay protection); secrets encrypted at rest; backup codes kept only as hashes and each works once. | Plan section 8 |
| Roles: Owner (everything), Finance (money, agent payouts, government share, money exports), Support (businesses, requests, messages; no money). At least two Owners at all times. | Plan section 3 and 5 |
| Sign-up check: call the owner, match the agent by phone, then approve with a free trial or a free pilot ("Approve and start", "Choose a trial or a free pilot next"), or reject with a reason. | Plan; AdminReqSignup, AdminApproveSignup |
| The kill switch is for emergencies, needs the admin's authenticator code (plan: password and code), stops all stamps and redemptions, and shows the owner a message. | Plan section 8; AdminKillSwitch |
| Every admin action, including looking, is logged with the admin as actor. | Plan section 8 |

## Unclear or conflicting (defaults used, flagged)

1. **Phase 3 exit gate not yet run.** Three real owners setting up a shop unaided is still to do. Robel
   started Phase 4 in parallel (DECISIONS.md); the owner test must happen before the pilot opens.
2. **Admin languages.** The plan says every user-facing string ships in three languages; the Admin board is
   English only (Temelash staff). The admin app is built in English; Truman to confirm.
3. **Who may use the kill switch.** Plan section 11 recommends Owner role only; used.
4. **Owner message on approval.** The owner inbox is Phase 6; until then approval and rejection are sent as
   an SMS (through the same outbox as codes) and the owner app shows the new status.
5. **Unusual-activity flags (basic).** A cashier going over `flags.stamps_per_hour` (default 60) in one
   clock hour raises one flag request for Temelash; Phase 8 refines the rules.
6. **Wording not on any board (flagged).** The cashier refusal titles "All stamping is paused" and "This
   business is paused" and the text "Staff and customers cannot add stamps. Cards stay safe." are taken
   from the Admin board's own banners; the kill-switch text staff and owners see is the message the admin
   types (English only for now). The SMS texts for approval, rejection and pause are placeholders until
   the per-language templates of Phase 6. Amharic and Oromo join the native-speaker review list.
7. **Re-authentication spends a code.** Turning the kill switch on or off and money exports ask for the
   password and a fresh authenticator code; a code used to sign in cannot be used again, so an admin who
   signs in and acts within the same 30 seconds waits for the next code.
8. **A paused business** keeps its staff sign-ins (they see "This business is paused" when they scan) but
   gives no stamps or rewards and takes no new members. Resuming returns it to its trial if the trial has
   not ended, otherwise to active.
9. **Offline queue during the kill switch.** Queued offline stamps are kept on the cashier's phone while
   stamping is paused and sent once it is back on.

## Built

- API: `/admin/auth/*` (password, authenticator setup with 10 backup codes, code or backup code, lockout,
  replay protection, 30-minute idle sign-out) and `/admin/*` (overview, businesses, business page, pause and
  resume, search, requests with notes, assign, approve and reject, log, settings, team, kill switch, money
  stubs for Phase 5). Secrets encrypted with `ADMIN_TOTP_KEY` (AES-256-GCM).
- First Owners: `npm run admin:create -w @temelash/api -- <email> "<name>" owner` prints a temporary
  password once.
- Stamps and redemptions refuse with 503 `paused_by_temelash` while the kill switch is on (each API instance
  rereads it at least every 2 seconds); owners see the message on Today; cashiers see it on the refusal screen.
- Flags: a cashier going over `flags.stamps_per_hour` in a clock hour raises one `flag` request.
