# Prototype

The design prototype is the specification for screens, wording, states and flows (build plan,
section 1). It is a Claude Design canvas of 336 boards:
<https://claude.ai/artifact/5bVJb5M37wPyLyE5Ki6dyR>

`project/` holds a copy of the canvas index and the component files that hold almost all screen
markup, strings and sample data:

| File | Covers |
| --- | --- |
| `Main.dc.html` | Customer app (cards, rewards, history, settings) |
| `ScanJoin.dc.html` | Customer join and sign-in |
| `Staff.dc.html` | Staff app |
| `Owner.dc.html` | Owner and branch-manager app |
| `Admin.dc.html` | Admin back-office (sample businesses and agents at the top of its script) |
| `canvas.json` | Every board name and the start state it opens with |

The other 330 boards are thin wrappers that open one of these components in a given state, language
or view (for example `StaffSignIn` = `Staff` with `start-view="signedout"`); `canvas.json` lists them.
Board names are the index: `Own…` owner, `OwnMgr…` manager, `Staff…`, `Admin…`, no prefix customer,
`Amharic…`/`Oromo…` language variants.

Copied on 2026-10-31. If the canvas changes, refresh these files.
