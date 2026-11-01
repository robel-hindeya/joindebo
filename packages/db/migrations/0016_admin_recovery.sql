-- Phase 8b: admin account recovery (AdminLoginRecover*, AdminTeamRecovery, AdminRecoveryApprove),
-- email at every step, and the new-device alert.

-- "Lost your phone and backup codes?": another Owner approves, then a wait before a new phone.
create table tc.admin_recovery (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references tc.admin_user(id),
  owner_named text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'done', 'cancelled')),
  requested_at timestamptz not null default now(),
  ip text,
  decided_by uuid references tc.admin_user(id),
  decided_at timestamptz,
  -- When the new phone can be set up (approval + auth.admin_recovery_wait_hours).
  ready_at timestamptz,
  done_at timestamptz,
  -- The person who asked can never approve their own reset (Phase 8 acceptance).
  check (decided_by is null or decided_by <> admin_id)
);
create unique index admin_recovery_one_open on tc.admin_recovery (admin_id) where status in ('pending', 'approved');
grant select, insert, update on tc.admin_recovery to tc_app;

-- Emails written in the same transaction as the action; a dispatcher sends them once a
-- provider is chosen (DECISIONS.md). Bodies are never logged.
create table tc.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index on tc.email_outbox (created_at) where sent_at is null;
grant select, insert, update on tc.email_outbox to tc_app;

-- AdminAccount "Tell me when a new device signs in" (board: on).
alter table tc.admin_user add column new_device_alert boolean not null default true;

insert into tc.setting (key, value, changed_by) values
  ('auth.admin_recovery_wait_hours', '24', 'migration 0016')
on conflict (key) do nothing;
