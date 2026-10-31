-- SMS delivery through AfroMessage (DECISIONS.md): the outbox stays the record of every message,
-- written in the same transaction as the action; a sender in the API delivers queued rows.

alter table tc.sms_outbox add column attempts int not null default 0;
-- When the sender may try this row next (retries back off; a claimed row is leased until then).
alter table tc.sms_outbox add column next_try_at timestamptz not null default now();
-- The provider's reason for the last failure. Never the message text.
alter table tc.sms_outbox add column last_error text;
-- Sign-in codes are useless after they expire, so they are not sent late.
alter table tc.sms_outbox add column expires_at timestamptz;

create index sms_outbox_due on tc.sms_outbox (next_try_at) where status = 'queued';

insert into tc.setting (key, value, changed_by) values
  ('sms.max_attempts', '5', 'migration 0011')
on conflict (key) do nothing;
