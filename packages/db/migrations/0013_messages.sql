-- Phase 6: messages, news and notifications (docs/phases/phase-6.md).

-- Messages from Temelash to owners. Recipients are fixed when sent; an open is a row.
create table tc.admin_message (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('all', 'due', 'agent', 'biz', 'system')),
  audience_label text not null,
  agent_id uuid references tc.agent(id),
  business_id uuid references tc.business(id),
  title text not null,
  body text not null,
  sms boolean not null default false,
  -- "Send again" points at the message it repeats.
  again_of uuid references tc.admin_message(id),
  -- What the owner can do from it (OwnMessage button): 'plan', or nothing.
  action text check (action in ('plan')),
  admin_id uuid references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.admin_message (at desc);

create table tc.admin_message_recipient (
  message_id uuid not null references tc.admin_message(id),
  business_id uuid not null references tc.business(id),
  person_id uuid not null references tc.person(id),
  primary key (message_id, person_id)
);
create index on tc.admin_message_recipient (person_id);

create table tc.admin_message_open (
  message_id uuid not null references tc.admin_message(id),
  person_id uuid not null references tc.person(id),
  at timestamptz not null default now(),
  primary key (message_id, person_id)
);

-- Shop news to customers (OwnNews*): a title and message per language, English required.
create table tc.shop_news (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  audience text not null check (audience in ('all', 'near', 'quiet')),
  texts jsonb not null,
  recipients int not null check (recipients >= 0),
  person_id uuid not null references tc.person(id),
  at timestamptz not null default now()
);
create index on tc.shop_news (business_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['admin_message', 'admin_message_recipient', 'admin_message_open', 'shop_news'] loop
    execute format('create trigger %1$s_append_only before update or delete on tc.%1$s for each row execute function tc.refuse_change()', t);
    execute format('create trigger %1$s_no_truncate before truncate on tc.%1$s for each statement execute function tc.refuse_change()', t);
    execute format('grant select, insert on tc.%I to tc_app', t);
  end loop;
end $$;

-- What a customer wants to hear about (Settings, NOTIFICATIONS). Notices about the card are always shown.
alter table tc.customer add column notify_prefs jsonb not null default '{"stamp": true, "near": true, "exp": true, "offer": true}';

-- Reading a notification marks it (tc.notification already has read_at); one "reward ending soon" per reward.
create unique index notification_reward_expiring_once on tc.notification ((data ->> 'rewardId')) where type = 'reward_expiring';

-- SMS delivery status and cost from the provider; templates are per language.
alter table tc.sms_outbox add column cost_birr numeric(10, 2);
alter table tc.sms_outbox add column status_checked_at timestamptz;
alter table tc.sms_outbox add column language text not null default 'en' check (language in ('en', 'am', 'om'));

insert into tc.setting (key, value, changed_by) values
  ('news.per_week', '2', 'migration 0013'),
  ('messages.quiet_start_hour', '21', 'migration 0013'),
  ('messages.quiet_end_hour', '7', 'migration 0013'),
  ('notify.reward_expiring_days', '3', 'migration 0013')
on conflict (key) do nothing;
