-- Phase 1: sessions, SMS codes, outgoing SMS, auth settings.

-- One row per signed-in device. The refresh token is stored only as a hash and
-- rotates on every use; reusing an old one revokes the whole family.
create table tc.session (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('customer', 'staff', 'manager', 'owner', 'admin')),
  actor_id uuid not null,
  -- Staff signed in at one branch at a time (StaffPickShop).
  branch_id uuid references tc.branch(id),
  family_id uuid not null,
  refresh_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  ip inet,
  user_agent text
);
create index on tc.session (actor_type, actor_id) where revoked_at is null;
create index on tc.session (family_id);

-- Six-digit SMS codes for owner sign-in, sign-up and PIN resets. Only the hash is kept.
create table tc.otp_code (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null check (purpose in ('owner_signin', 'owner_signup', 'owner_reset', 'customer_reset')),
  code_hash text not null,
  -- Who the code is for, when known (owner sign-in: the person id).
  subject_id uuid,
  -- Data carried from the first step (sign-up form) to the last.
  payload jsonb not null default '{}',
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index on tc.otp_code (phone, purpose, created_at desc);

-- Every SMS the system sends. Delivery status and cost come with the provider (Phase 6).
create table tc.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  template text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed')),
  provider text,
  provider_ref text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on tc.sms_outbox (created_at desc);

alter table tc.customer add column consent_at timestamptz;

grant select, insert, update on tc.session, tc.otp_code, tc.sms_outbox to tc_app;

-- Auth settings. Insert-if-missing so existing values are never overwritten.
insert into tc.setting (key, value, changed_by) values
  ('auth.customer.max_failed_attempts', '5', 'migration 0004'),
  ('auth.business.max_failed_attempts', '3', 'migration 0004'),
  ('auth.staff.max_failed_attempts', '5', 'migration 0004'),
  ('auth.lock_minutes', '15', 'migration 0004'),
  ('auth.otp_minutes', '5', 'migration 0004'),
  ('auth.otp_max_attempts', '5', 'migration 0004'),
  ('auth.access_token_minutes', '15', 'migration 0004'),
  ('auth.refresh_token_days', '30', 'migration 0004'),
  ('pin.default_expiry_days', '90', 'migration 0004')
on conflict (key) do nothing;
