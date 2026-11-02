# Board audit (2026-11-02)

Every one of the 339 boards in `docs/prototype/project/canvas.json` was checked against the code.
Most are states of screens that exist (errors, empty, offline, each language). These were missing and
are now built (tests: `apps/api/test/board-gaps.spec.ts`):

| Board | App | What was added |
|---|---|---|
| BusinessPage | Customer | Info button on a card → shop name, category, open now, directions, address, opening hours (today in bold), branches, the card's rewards. |
| ErrorState | Customer | "Could not load your cards" with Try again, when nothing is saved on the phone. |
| StaffDark | Staff | "Light" button on the scanner when the phone lets the browser switch its light on. |
| OwnHelp, OwnMgrHelp | Owner | Menu → Help: call or Telegram (only once set in Admin), five questions and answers, "Report a problem" (becomes a Help request in Admin). |
| OwnRoles, OwnMgrRoles | Owner | Team → "Who can do what"; managers see yes or no for each. |
| OwnFresh | Owner | "Set up your shop" card on Today with four steps and progress, until done. |
| OwnOffline | Owner | Banner while the phone has no connection. |
| OwnCustomerHidden | Owner | Customer detail shows the hidden-visits note and no history when the customer turned sharing off. |
| OwnTodayClosing | Owner | Today shows a closing request waiting or approved (with the date). |
| AdminAudience | Admin | Unique clients across all businesses by phone (last 9 digits), per business, by number of shops; 12-hour cache, "Refresh now" logged. |
| AdminChangePassword | Admin | Settings → My account: change password (12+, mixed case, number, symbol); other devices signed out. |
| AdminSettingsAccount | Admin | Where you are signed in, "Sign out other devices", recent sign-ins. |

## Differences from the boards (flagged)

1. **OwnMgrOwnerOnly** is not shown: managers never see owner-only rows, so they cannot reach that
   screen.
2. **Business phone and "Call"** on BusinessPage: shops have no public phone number in the data yet,
   so there is no Call button. Directions open the branch address in Google Maps.
3. **Branch distance** ("away") on BusinessPage needs the customer's location; not shown.
4. **StaffDark hint** ("Too dark to read the code?") needs light detection; the Light button is there
   whenever the phone supports it.
5. **Help contacts** (support phone, Telegram) are empty until set in Admin → Settings → Rules; Help
   hides them until then. Telegram is still a blocked decision (phase-6.md).
