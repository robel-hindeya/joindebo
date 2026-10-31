-- Phase 3: the owner's card rules (docs/phases/phase-3.md).

-- Stamps typed by hand: review (allow, listed in To check), allow (no checking), off (scan only).
alter table tc.rule_set add column hand_typed text not null default 'review' check (hand_typed in ('review', 'allow', 'off'));
-- Terms customers see, per language: {"en": ["One stamp per visit.", ...], "am": [...], "om": [...]}.
alter table tc.rule_set add column terms jsonb not null default '{}';
-- What one reward costs the shop, for its own reports only.
alter table tc.rule_set add column reward_cost_birr int check (reward_cost_birr is null or reward_cost_birr >= 0);
-- Time between stamps: the owner picks 1, 2, 4, 8 or 24 hours; the prototype's default is 4.
alter table tc.rule_set alter column visit_window_minutes set default 240;
alter table tc.rule_set add constraint rule_set_gap_check check (visit_window_minutes in (60, 120, 240, 480, 1440));
alter table tc.rule_set add constraint rule_set_valid_days_check check (reward_valid_days in (7, 14, 30, 60, 90));
alter table tc.rule_set add constraint rule_set_pin_days_check check (pin_days in (0, 60, 90, 180));

-- "To check": an owner or manager has looked at a hand-typed stamp.
create table tc.stamp_check (
  stamp_id uuid primary key references tc.stamp(id),
  person_id uuid not null references tc.person(id),
  at timestamptz not null default now()
);
create trigger stamp_check_append_only before update or delete on tc.stamp_check for each row execute function tc.refuse_change();
create trigger stamp_check_no_truncate before truncate on tc.stamp_check for each statement execute function tc.refuse_change();
grant select, insert on tc.stamp_check to tc_app;

create index on tc.stamp (branch_id, at);
create index on tc.redemption (branch_id, at);
