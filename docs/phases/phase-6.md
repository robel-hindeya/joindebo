# Phase 6: Messages, news and notifications

**Goal (build plan, section 7):** everyone hears what they need to hear, in their language, through the right
channel.

**Boards:** AdminMessages, AdminMessageCompose, OwnInbox, OwnMessage, OwnMyRequests, OwnNews*,
Notifications, AmharicNotifications, OromoNotifications.

**Acceptance (plan):**
1. A message to "payment due" reaches exactly the businesses with a balance.
2. The opened count updates when the owner reads it.
3. A customer who opted out never receives news.

**Exit gate (Release 2, paid launch):** Phases 5 and 6 done, a month of reconciled pilot money, support
playbook written.

Phase 6 started on 2026-11-01 at Robel's request ("continue"), with Phase 3's owner test, the Phase 4 pilot and
the Phase 5 reconciliation still open.

## Rules taken from the plan and the boards

| Rule | Source |
| --- | --- |
| Admin to owners: compose a title and message; send to every business, those with a payment due, one agent's businesses, or one business; start from a template (payment reminder, next-year payments) or write your own; optionally also by SMS. History with how many opened it; "send again" to those who did not open, by text too. | Plan; AdminMessages, AdminMessageCompose |
| Owners read it under "Messages from Temelash" (inbox with unread count, message page). | Plan; OwnInbox, OwnMessage |
| "My requests" lists everything the owner asked Temelash for and its live status. | Plan; OwnMyRequests |
| Shop news to customers: title and message (140 characters) per language, English required; audience everyone who allows news, one stamp from a reward, or not seen for 30 days; preview in every language; two a week at most, counted from Monday; "a message cannot be taken back once it is sent". | Plan; OwnNews* |
| Customers can turn off stamp, close-to-reward, reward-expiring and shop-news notifications. Messages from a shop about the card (a correction, a pause) are always shown. | Notifications and Settings boards |
| SMS: delivery status, retry, a monthly cost report; texts in all three languages. | Plan |

## Unclear (defaults used, flagged)

1. **Quiet hours.** The plan names them; no board sets them. Default: no news or Temelash messages by SMS
   between 21:00 and 07:00 East Africa Time (settings `messages.quiet_start_hour`, `messages.quiet_end_hour`);
   such texts wait until 07:00. Sign-in codes are never held. (Robel, Truman)
2. **"Reward ending soon".** The board shows "expires in 3 days". Default: one notification 3 days before a
   reward expires (setting `notify.reward_expiring_days`). (Truman)
3. **Telegram bot messages** need a bot and its token, which do not exist yet. Not built; blocked. (Robel)
4. **Owner language for SMS.** Owners choose a language in the app; SMS to owners uses it. Customers' texts
   use the language they joined with.
5. **SMS cost** comes from AfroMessage's status answer (`cost`), checked for each sent message within a day,
   at most 30 checks a minute (their limit).

## Screens (differences from the boards)

- Customer: the bell is back in the wallet header with an unread dot. Notifications and Settings
  (the four NOTIFICATIONS switches) are in the menu. Notices from a shop about the card (a fix or a
  pause) are always shown and cannot be switched off.
- Owner: the menu has Messages from Temelash (unread badge), My requests and Shop news (write → check →
  sent, 140 characters, limited to `news.per_week` a week).
- Admin: the Messages page, "Message owner" on a business, "Send the receipt to the owner" on receipts
  and "Send a payment reminder" on the Finance tab. Picking a template fills in the text. Finance does
  not see Messages.
- Not built: Telegram (blocked, see above).
- Added beyond the boards: a "near reward" notice when one stamp is left.
- Checked in the browser: customer Notifications and Settings (switches save); owner menu, Messages,
  My requests, Shop news and Write news. Admin Messages: its API calls checked with a test admin (all
  200, data shapes match the page); not seen rendered in the browser.
