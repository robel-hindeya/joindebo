-- Phase 2: the stamp loop (docs/phases/phase-2.md).

-- Rotating card codes: each card has a random secret the customer's phone uses
-- to compute the code offline, and a short id printed with the typed code.
alter table tc.card add column short_code text;
alter table tc.card add column qr_secret text;
create unique index card_short_per_shop on tc.card (business_id, short_code) where short_code is not null;

-- Shop rules used by the loop. The owner edits them in Phase 3.
alter table tc.rule_set add column welcome_stamps int not null default 0 check (welcome_stamps >= 0);
alter table tc.rule_set add column reward_valid_days int not null default 30 check (reward_valid_days > 0);

-- Welcome stamps have no cashier.
alter table tc.stamp drop constraint stamp_method_check;
alter table tc.stamp add constraint stamp_method_check check (method in ('scan', 'typed', 'fix', 'welcome'));

-- A redemption can be undone (OwnFixUndo) and the reward given again, so the
-- one-redemption rule is per round: round n is allowed once n earlier
-- redemptions were all voided. Concurrent confirms of one code clash on the key.
alter table tc.redemption drop constraint redemption_reward_id_key;
alter table tc.redemption add column round int not null default 0;
alter table tc.redemption add constraint redemption_once_per_round unique (reward_id, round);

create table tc.redemption_void (
  redemption_id uuid primary key references tc.redemption(id),
  person_id uuid not null references tc.person(id),
  reason text not null,
  note text,
  at timestamptz not null default now()
);

-- More time for a reward (OwnFixExtend). The newest row wins.
create table tc.reward_extension (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references tc.reward(id),
  expires_at timestamptz not null,
  person_id uuid not null references tc.person(id),
  reason text not null,
  note text,
  at timestamptz not null default now()
);
create index on tc.reward_extension (reward_id, at desc);

-- Notes the customer sees in the app (stamps, rewards, fixes, a paused card).
create table tc.notification (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references tc.customer(id),
  card_id uuid references tc.card(id),
  type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on tc.notification (customer_id, created_at desc);

create index on tc.stamp (voids_stamp_id) where voids_stamp_id is not null;
create index on tc.redemption (reward_id);

do $$
declare t text;
begin
  foreach t in array array['redemption_void', 'reward_extension'] loop
    execute format('create trigger %I before update or delete on tc.%I for each row execute function tc.refuse_change()', t || '_append_only', t);
    execute format('create trigger %I before truncate on tc.%I for each statement execute function tc.refuse_change()', t || '_no_truncate', t);
  end loop;
end $$;

grant select, insert on tc.redemption_void, tc.reward_extension to tc_app;
grant select, insert, update on tc.notification to tc_app;

insert into tc.setting (key, value, changed_by) values
  ('stamp.offline_max_hours', '24', 'migration 0007'),
  ('stamp.code_windows', '3', 'migration 0007')
on conflict (key) do nothing;
