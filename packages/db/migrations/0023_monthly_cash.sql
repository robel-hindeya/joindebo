-- Owners pay monthly, in cash (DECISIONS.md, 2026-11-06). After a 15-day free trial each shop owes
-- one monthly fee per month from the day its trial ended. The owner reports cash with who took it,
-- and an admin approves it: the same claim, approval and receipt as before. tc.plan_fee.fee_birr now
-- holds the monthly fee. Old rows stay as they were; the newest row wins, so one is added below.

alter table tc.payment_claim drop constraint payment_claim_method_check;
alter table tc.payment_claim add constraint payment_claim_method_check check (method in ('telebirr', 'cbe_birr', 'bank', 'cash'));
-- Who took the cash. For cash, transaction_id is a reference the server makes.
alter table tc.payment_claim add column received_by text check (length(received_by) between 2 and 80);
alter table tc.payment_claim add constraint payment_claim_cash_who check (method <> 'cash' or received_by is not null);

update tc.setting set value = '15', changed_by = 'migration 0023', changed_at = now() where key = 'plan.trial_days';
insert into tc.setting (key, value, changed_by) values
  ('plan.trial_days', '15', 'migration 0023'),
  ('plan.starter.monthly_fee_birr', '1600', 'migration 0023'),
  ('plan.full.monthly_fee_birr', '2100', 'migration 0023'),
  ('plan.extra_branch.monthly_fee_birr', '420', 'migration 0023'),
  -- Commission is a share of each payment, the same share as the old yearly amounts.
  ('agent.commission_percent.starter', '16', 'migration 0023'),
  ('agent.commission_percent.full', '20', 'migration 0023'),
  ('agent.commission_percent.extra_branch', '20', 'migration 0023'),
  -- Where owners pay cash, shown on their Plan page. Set in Admin, Settings.
  ('pay.cash', '""', 'migration 0023')
on conflict (key) do nothing;

-- Put every shop on a paid plan onto the monthly fee, keeping its first due date.
insert into tc.plan_fee (business_id, finance_year, plan, branches, fee_birr, base_birr, extra_birr, commission_base_birr, commission_extra_birr, gov_share_percent, due_on, reason)
select business_id, finance_year, plan, branches,
  case plan when 'starter' then 1600 else 2100 + greatest(0, branches - 2) * 420 end,
  case plan when 'starter' then 1600 else 2100 end,
  case plan when 'starter' then 0 else 420 end,
  case plan when 'starter' then 256 else 420 end,
  case plan when 'starter' then 0 else 84 end,
  gov_share_percent, due_on, 'plan_changed'
from (
  select distinct on (business_id) * from tc.plan_fee order by business_id, finance_year desc, id desc
) newest
where plan <> 'pilot';
