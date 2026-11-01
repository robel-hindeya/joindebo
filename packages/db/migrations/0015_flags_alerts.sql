-- Phase 8a: the three unusual-activity flags with editable limits (AdminSettingsSafety)
-- and owner alerts (OwnAlertSet, OwnUnusual).

insert into tc.setting (key, value, changed_by) values
  -- AdminSettingsSafety defaults from the board (flags.stamps_per_hour exists since 0010).
  ('flags.hand_typed_share_pct', '30', 'migration 0015'),
  -- Not on the board: a shop needs this many stamps in the week before the share counts (phase-8.md).
  ('flags.hand_typed_min_stamps', '20', 'migration 0015'),
  ('flags.new_cards_per_hour', '25', 'migration 0015')
on conflict (key) do nothing;

-- The owner's "It is fine, dismiss" on an unusual-activity alert; Temelash's own decision stays separate.
alter table tc.request add column owner_dismissed_at timestamptz;
alter table tc.request add column owner_dismissed_by uuid references tc.person(id);

-- OwnAlertSet: what each owner or manager is told, and how. Board defaults.
alter table tc.person add column alert_prefs jsonb not null
  default '{"approve": true, "unusual": true, "locked": true, "phone": false, "daily": true, "weekly": false, "how": "push", "time": 21}';

-- One daily summary and one weekly report per person per period.
create table tc.owner_summary_sent (
  person_id uuid not null references tc.person(id),
  kind text not null check (kind in ('daily', 'weekly')),
  period text not null,
  at timestamptz not null default now(),
  primary key (person_id, kind, period)
);
create trigger owner_summary_sent_append_only before update or delete on tc.owner_summary_sent for each row execute function tc.refuse_change();
grant select, insert on tc.owner_summary_sent to tc_app;
