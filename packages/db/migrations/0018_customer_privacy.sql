-- Phase 8d: customer privacy (Settings → PRIVACY), account deletion with a 30-day window
-- (DeleteAccount) and the retention schedule for short-lived data.

-- "Share my visit activity" (shops see visit dates) and "Personalised offers".
alter table tc.customer add column privacy_prefs jsonb not null default '{"share": true, "pers": false}';

-- Retention (phase-8.md, 8d). Append-only records (stamps, money, audit log) are kept; these are not.
insert into tc.setting (key, value, changed_by) values
  ('retention.sms_body_days', '90', 'migration 0018'),
  ('retention.email_body_days', '90', 'migration 0018'),
  ('retention.otp_days', '2', 'migration 0018'),
  ('retention.session_days', '60', 'migration 0018')
on conflict (key) do nothing;
