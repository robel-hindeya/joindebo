-- Phase 5: money (docs/phases/phase-5.md). Every table here is append-only: a correction,
-- reversal or change is a new row linked to what it changes. Each row stores its finance
-- year and Ethiopian month when written, so reports never depend on a later rule change.

-- The plan and yearly fee of a business for a finance year. The newest row wins. The
-- commission terms in force when it was written are kept with it.
create table tc.plan_fee (
  id bigint generated always as identity primary key,
  business_id uuid not null references tc.business(id),
  finance_year int not null,
  plan text not null check (plan in ('starter', 'full', 'pilot')),
  branches int not null check (branches >= 1),
  fee_birr int not null check (fee_birr >= 0),
  -- The plan part of the fee (Starter or Full price) and each extra branch's price.
  base_birr int not null check (base_birr >= 0),
  extra_birr int not null check (extra_birr >= 0),
  commission_base_birr int not null check (commission_base_birr >= 0),
  commission_extra_birr int not null check (commission_extra_birr >= 0),
  gov_share_percent int not null check (gov_share_percent between 0 and 100),
  due_on date,
  reason text not null check (reason in ('approved', 'plan_changed', 'branch_added', 'year_opened')),
  admin_id uuid references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.plan_fee (business_id, finance_year, id desc);

-- Money received. A payment has a receipt; a correction carries the difference and a
-- reversal takes back what was left, each linked to the payment it fixes.
create table tc.payment (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  kind text not null check (kind in ('payment', 'correction', 'reversal')),
  amount_birr int not null,
  method text check (method in ('telebirr', 'cbe_birr', 'cash', 'bank')),
  reference text,
  receipt_no text unique,
  fixes uuid references tc.payment(id),
  reason text,
  finance_year int not null,
  eth_month int not null check (eth_month between 1 and 13),
  admin_id uuid not null references tc.admin_user(id),
  at timestamptz not null default now(),
  check ((kind = 'payment') = (fixes is null)),
  check (kind <> 'payment' or (amount_birr > 0 and method is not null and receipt_no is not null)),
  check (kind = 'payment' or reason is not null)
);
create index on tc.payment (business_id, finance_year);
create index on tc.payment (at);
create index on tc.payment (fixes) where fixes is not null;

-- A company an agent brought that is not registered yet; linked when that phone signs up.
create table tc.agent_lead (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tc.agent(id),
  business_name text not null,
  owner_phone text not null,
  plan text not null check (plan in ('starter', 'full')),
  branches int not null default 1 check (branches >= 1),
  admin_id uuid references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.agent_lead (owner_phone);

-- Who brought a business: from the phone typed at sign-up, a lead, or an admin deal.
-- The newest row is the agent now (agent_id null = no agent); tc.business.agent_id follows it.
create table tc.deal (
  id bigint generated always as identity primary key,
  business_id uuid not null references tc.business(id),
  agent_id uuid references tc.agent(id),
  how text not null check (how in ('signup', 'lead', 'admin')),
  lead_id uuid references tc.agent_lead(id),
  admin_id uuid references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.deal (business_id, id desc);
create index on tc.deal (agent_id, at);

-- Commission paid out to an agent.
create table tc.agent_payout (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tc.agent(id),
  amount_birr int not null check (amount_birr > 0),
  how text,
  reference text,
  finance_year int not null,
  eth_month int not null check (eth_month between 1 and 13),
  admin_id uuid not null references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.agent_payout (agent_id, at);

-- The government share of one Ethiopian month marked as handed over (or, by mistake, not).
create table tc.gov_share_mark (
  id bigint generated always as identity primary key,
  finance_year int not null,
  eth_month int not null check (eth_month between 1 and 13),
  handed_over boolean not null,
  amount_birr int check (amount_birr >= 0),
  how text,
  reference text,
  admin_id uuid not null references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.gov_share_mark (finance_year, eth_month, id desc);

do $$
declare t text;
begin
  foreach t in array array['plan_fee', 'payment', 'agent_lead', 'deal', 'agent_payout', 'gov_share_mark'] loop
    execute format('create trigger %1$s_append_only before update or delete on tc.%1$s for each row execute function tc.refuse_change()', t);
    execute format('create trigger %1$s_no_truncate before truncate on tc.%1$s for each statement execute function tc.refuse_change()', t);
    execute format('grant select, insert on tc.%I to tc_app', t);
  end loop;
end $$;

-- Prices and commission are settings (plan section 2); seeded here so production has them.
insert into tc.setting (key, value, changed_by) values
  ('plan.starter.yearly_fee_birr', '19000', 'migration 0012'),
  ('plan.full.yearly_fee_birr', '25000', 'migration 0012'),
  ('plan.full.branches_included', '2', 'migration 0012'),
  ('plan.extra_branch.yearly_fee_birr', '5000', 'migration 0012'),
  ('agent.commission_birr.starter', '3000', 'migration 0012'),
  ('agent.commission_birr.full', '5000', 'migration 0012'),
  ('agent.commission_birr.extra_branch', '1000', 'migration 0012'),
  ('government.share_percent_of_commission', '30', 'migration 0012'),
  ('finance.due_soon_days', '14', 'migration 0012')
on conflict (key) do nothing;
