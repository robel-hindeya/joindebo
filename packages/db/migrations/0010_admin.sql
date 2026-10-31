-- Phase 4: the admin back-office (docs/phases/phase-4.md).

-- TOTP replay protection: the last 30-second step that signed in; an older or equal step is refused.
alter table tc.admin_user add column totp_last_step bigint not null default 0;
alter table tc.admin_user add column password_changed_at timestamptz;
-- First sign-in: the secret shown for scanning, kept (encrypted) until the first code proves it was saved.
alter table tc.admin_user add column totp_pending_enc text;

-- Idle sign-out for admins (30 minutes): every use of a session moves this forward.
alter table tc.session add column last_used_at timestamptz not null default now();

-- Notes Temelash staff leave on a request ("Called the owner, all fine.").
create table tc.request_note (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references tc.request(id),
  admin_id uuid not null references tc.admin_user(id),
  text text not null,
  at timestamptz not null default now()
);
create index on tc.request_note (request_id, at);
create trigger request_note_append_only before update or delete on tc.request_note for each row execute function tc.refuse_change();
create trigger request_note_no_truncate before truncate on tc.request_note for each statement execute function tc.refuse_change();

grant select, insert on tc.request_note to tc_app;

insert into tc.setting (key, value, changed_by) values
  ('auth.admin.max_failed_attempts', '5', 'migration 0010'),
  ('flags.stamps_per_hour', '60', 'migration 0010'),
  ('auth.admin_idle_signout_minutes', '30', 'migration 0010'),
  ('plan.trial_days', '30', 'migration 0010'),
  ('safety.kill_switch', '{"on": false, "owner_message": ""}', 'migration 0010')
on conflict (key) do nothing;
