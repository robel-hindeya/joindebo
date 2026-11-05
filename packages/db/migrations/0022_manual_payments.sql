-- Owners pay by hand and tell us (DECISIONS.md, 2026-11-04): they pay to the accounts in the
-- settings, send the transaction ID with a screenshot, and an admin approves or rejects it.
-- Approving a plan payment writes the usual tc.payment row (receipt, commission); approving a
-- stand payment marks the order paid. Trials are 14 days; 7 days after a trial ends unpaid the
-- business is paused until a payment is approved.

create table tc.payment_claim (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  -- What it pays for: the yearly plan fee, or one stand order.
  purpose text not null check (purpose in ('plan', 'stand')),
  stand_order_id uuid references tc.stand_order(id),
  method text not null check (method in ('telebirr', 'cbe_birr', 'bank')),
  amount_birr int not null check (amount_birr > 0),
  transaction_id text not null check (length(transaction_id) between 4 and 60),
  paid_on date not null,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'rejected')),
  reason text,
  person_id uuid not null references tc.person(id),
  decided_by uuid references tc.admin_user(id),
  decided_at timestamptz,
  -- The receipt written on approval (plan payments).
  payment_id uuid references tc.payment(id),
  created_at timestamptz not null default now(),
  check ((purpose = 'stand') = (stand_order_id is not null)),
  check (status <> 'rejected' or reason is not null)
);
create index on tc.payment_claim (status, created_at);
create index on tc.payment_claim (business_id, created_at);
-- One transaction ID pays once: it cannot be sent again unless it was rejected.
create unique index payment_claim_txn_once on tc.payment_claim (method, upper(transaction_id)) where status <> 'rejected';

-- The screenshot, kept apart so lists stay light. Stored in Postgres, so the move to the VPS stays a dump and restore.
create table tc.payment_claim_proof (
  claim_id uuid primary key references tc.payment_claim(id),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) <= 3145728)
);

grant select, insert, update on tc.payment_claim to tc_app;
grant select, insert on tc.payment_claim_proof to tc_app;

-- A stand order paid ahead by an approved transfer.
alter table tc.stand_order add column paid_claim_id uuid references tc.payment_claim(id);
alter table tc.stand_order add column paid_at timestamptz;
alter table tc.stand_order drop constraint stand_order_received_pay_check;
alter table tc.stand_order add constraint stand_order_received_pay_check check (received_pay in ('cash', 'telebirr', 'prepaid'));

alter table tc.stand_order_event drop constraint stand_order_event_kind_check;
alter table tc.stand_order_event add constraint stand_order_event_kind_check
  check (kind in ('placed', 'stage', 'received', 'problem', 'replacement', 'reminded', 'closed', 'cancelled', 'paid'));
-- "Extend the trial" moves the due date, so it writes a new fee row.
alter table tc.plan_fee drop constraint plan_fee_reason_check;
alter table tc.plan_fee add constraint plan_fee_reason_check check (reason in ('approved', 'plan_changed', 'branch_added', 'year_opened', 'trial_extended'));

-- Paused because the trial ended unpaid (not by an admin): an approved payment lifts it.
alter table tc.business add column paused_unpaid boolean not null default false;

update tc.setting set value = '14', changed_by = 'migration 0022', changed_at = now() where key = 'plan.trial_days';
insert into tc.setting (key, value, changed_by) values
  ('plan.trial_days', '14', 'migration 0022'),
  ('billing.grace_days', '7', 'migration 0022'),
  -- Where owners pay, shown on their Plan page. Set in Admin, Settings.
  ('pay.telebirr', '""', 'migration 0022'),
  ('pay.cbe_birr', '""', 'migration 0022'),
  ('pay.bank', '""', 'migration 0022')
on conflict (key) do nothing;
