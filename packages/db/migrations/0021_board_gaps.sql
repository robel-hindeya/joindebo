-- Screens found missing in the board audit (docs/phases/board-audit.md).

-- OwnHelp "Report a problem": a request for the Temelash team.
alter table tc.request drop constraint request_type_check;
alter table tc.request add constraint request_type_check
  check (type in ('signup', 'closing', 'lost_phone', 'deletion', 'stand_order', 'flag', 'privacy', 'help'));

-- OwnHelp "Call us" / "Message us on Telegram": shown only once set (DECISIONS.md, Open).
insert into tc.setting (key, value, changed_by) values
  ('support.phone', '""', 'migration 0021'),
  ('support.telegram', '""', 'migration 0021')
on conflict (key) do nothing;
