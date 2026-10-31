-- Phase 1 security review (docs/phases/phase-1-security-review.md).

-- F1: sign-in tickets that grant an action (set a PIN, pick a shop, finish a
-- reset or sign-up) are spent once. Rows can be cleared after expires_at.
create table tc.used_ticket (
  jti uuid primary key,
  used_at timestamptz not null default now(),
  expires_at timestamptz not null
);
grant select, insert on tc.used_ticket to tc_app;

-- F2: at most this many SMS codes per phone per hour, across all purposes.
insert into tc.setting (key, value, changed_by) values
  ('auth.otp_per_phone_hour', '5', 'migration 0006')
on conflict (key) do nothing;
