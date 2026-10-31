-- Temelash Card, migration 0001: foundations.
-- Plain PostgreSQL (15+). Nothing here depends on Supabase, so the same file
-- runs on the VPS. Everything lives in schema "tc", which Supabase's REST API
-- does not expose.
--
-- Append-only tables (stamps, rewards, redemptions, rule versions, audit log)
-- are protected twice: the app role is never granted UPDATE/DELETE on them,
-- and a trigger refuses UPDATE/DELETE for every role.

create schema if not exists tc;

-- Bookkeeping for packages/db/src/migrate.ts.
create table if not exists tc.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- The role the API runs as. A login user is granted this role (see docs/DATABASE.md).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tc_app') then
    create role tc_app nologin;
  end if;
end $$;

create or replace function tc.refuse_change() returns trigger
language plpgsql as $$
begin
  raise exception 'tc.% is append-only: % is not allowed; add a correcting row instead', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------- settings
-- Prices, commission, trial length, limits, kill switch. Never hard-coded.
create table tc.setting (
  key text primary key,
  value jsonb not null,
  changed_by text,
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- admin
create table tc.admin_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null check (role in ('owner', 'finance', 'support')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  password_hash text,
  totp_secret_enc text,
  backup_code_hashes text[] not null default '{}',
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- agents
create table tc.agent (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  area text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- businesses
create table tc.business (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('cafe', 'salon', 'spa', 'restaurant', 'car_wash', 'other')),
  city text not null,
  status text not null default 'pending'
    check (status in ('pending', 'trial', 'active', 'paused', 'closing', 'closed', 'rejected')),
  plan text check (plan in ('starter', 'full', 'pilot')),
  plan_date date,
  trial_ends_at timestamptz,
  closing_date date,
  agent_id uuid references tc.agent(id),
  -- Short code customers can type instead of scanning the shop QR.
  shop_code text not null unique,
  created_at timestamptz not null default now()
);
create index on tc.business (status);
create index on tc.business (agent_id);

create table tc.branch (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  name text not null,
  address text,
  -- {"mon": [["08:00","20:00"]], ...} in East Africa Time.
  hours jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now()
);
create index on tc.branch (business_id);

-- Owners, branch managers and staff share one table.
create table tc.person (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  phone text not null,
  name text not null,
  role text not null check (role in ('owner', 'manager', 'staff')),
  pin_hash text,
  pin_set_at timestamptz,
  -- First PIN issued by the owner must be changed by the person.
  pin_must_change boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  hourly_stamp_limit int check (hourly_stamp_limit is null or hourly_stamp_limit > 0),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);
create index on tc.person (phone);

-- Which branches a manager or staff member works at. Managers have exactly one.
create table tc.person_branch (
  person_id uuid not null references tc.person(id),
  branch_id uuid not null references tc.branch(id),
  primary key (person_id, branch_id)
);

-- ---------------------------------------------------------------- customers
create table tc.customer (
  id uuid primary key default gen_random_uuid(),
  -- Null once the account is anonymised after deletion.
  phone text unique,
  pin_hash text,
  language text not null default 'en' check (language in ('en', 'am', 'om')),
  status text not null default 'active' check (status in ('active', 'deleting', 'anonymised')),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  telegram_user_id bigint unique,
  delete_requested_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- card rules (versioned)
create table tc.rule_set (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  version int not null,
  stamps_needed int not null check (stamps_needed > 0),
  -- [{"tier":1,"at":5,"reward":"Free macchiato"}, ...]
  ladder jsonb not null,
  once_per_visit boolean not null default true,
  visit_window_minutes int not null default 120,
  hourly_limit_per_staff int,
  pin_days int not null default 90,
  card_valid_days int,
  created_by uuid references tc.person(id),
  created_at timestamptz not null default now(),
  unique (business_id, version)
);

create table tc.card (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references tc.customer(id),
  business_id uuid not null references tc.business(id),
  -- A card keeps the rule version it started under.
  rule_set_id uuid not null references tc.rule_set(id),
  status text not null default 'active' check (status in ('active', 'paused', 'expired', 'redeemed')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- One live card per customer per business.
create unique index card_one_live_per_shop on tc.card (customer_id, business_id) where status in ('active', 'paused');
create index on tc.card (business_id);

-- ---------------------------------------------------------------- stamps (append-only)
create table tc.stamp (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references tc.card(id),
  branch_id uuid references tc.branch(id),
  -- Staff who stamped, or the owner/manager who added or voided it as a fix.
  person_id uuid references tc.person(id),
  kind text not null default 'add' check (kind in ('add', 'void')),
  method text not null check (method in ('scan', 'typed', 'fix')),
  -- Hand-typed stamps wait for an owner decision (see tc.stamp_decision).
  needs_approval boolean not null default false,
  -- For kind = 'void': the stamp this row cancels.
  voids_stamp_id uuid references tc.stamp(id),
  reason text,
  at timestamptz not null default now(),
  -- When a stamp was taken offline and replayed later.
  queued_at timestamptz,
  -- Client-generated id so a replayed offline stamp is stored once.
  idempotency_key text unique,
  check ((kind = 'void') = (voids_stamp_id is not null))
);
create index on tc.stamp (card_id, at);
create index on tc.stamp (person_id, at);
create unique index stamp_void_once on tc.stamp (voids_stamp_id) where voids_stamp_id is not null;

create table tc.stamp_decision (
  stamp_id uuid primary key references tc.stamp(id),
  decision text not null check (decision in ('approved', 'rejected')),
  person_id uuid not null references tc.person(id),
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- rewards (append-only)
create table tc.reward (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references tc.card(id),
  tier int not null,
  code_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (card_id, tier)
);

create table tc.redemption (
  id uuid primary key default gen_random_uuid(),
  -- A code redeems once.
  reward_id uuid not null unique references tc.reward(id),
  branch_id uuid not null references tc.branch(id),
  person_id uuid not null references tc.person(id),
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- requests to Temelash
create table tc.request (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('signup', 'closing', 'lost_phone', 'deletion', 'stand_order', 'flag', 'privacy')),
  business_id uuid references tc.business(id),
  stage text not null default 'new',
  assignee_id uuid references tc.admin_user(id),
  result text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tc.request (type, stage);
create index on tc.request (business_id);

-- ---------------------------------------------------------------- audit log (append-only)
-- Written in the same transaction as the action it records.
create table tc.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('customer', 'staff', 'manager', 'owner', 'admin', 'system')),
  actor_id uuid,
  role text,
  business_id uuid references tc.business(id),
  type text not null,
  text text not null,
  detail jsonb not null default '{}',
  ip inet
);
create index on tc.audit_log (business_id, at desc);
create index on tc.audit_log (type, at desc);
create index on tc.audit_log (actor_id, at desc);

-- ---------------------------------------------------------------- append-only enforcement
do $$
declare t text;
begin
  foreach t in array array['rule_set', 'stamp', 'stamp_decision', 'reward', 'redemption', 'audit_log'] loop
    execute format('create trigger %I before update or delete on tc.%I for each row execute function tc.refuse_change()', t || '_append_only', t);
    execute format('create trigger %I before truncate on tc.%I for each statement execute function tc.refuse_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- grants
grant usage on schema tc to tc_app;
grant select on all tables in schema tc to tc_app;
grant insert on all tables in schema tc to tc_app;
grant update on tc.setting, tc.admin_user, tc.agent, tc.business, tc.branch, tc.person, tc.customer, tc.card, tc.request to tc_app;
grant delete on tc.person_branch to tc_app;
grant usage on all sequences in schema tc to tc_app;
-- Migrations stay with the owner role.
revoke all on tc.schema_migrations from tc_app;
grant select on tc.schema_migrations to tc_app;
