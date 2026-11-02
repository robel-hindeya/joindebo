-- Phase 8c: owner account requests. Change phone (OwnChangePhone*), lost phone (OwnLostPhone* →
-- AdminReqLostPhone), customer deletion through the shop (OwnPrivacy* → AdminReqDeletion) and
-- closing the business end to end (OwnCloseBiz* → AdminReqClosing, cancel closing).

alter table tc.otp_code drop constraint otp_code_purpose_check;
alter table tc.otp_code add constraint otp_code_purpose_check
  check (purpose in ('owner_signin', 'owner_signup', 'owner_reset', 'customer_reset', 'owner_phone_change'));

-- Closing: the status to go back to if the owner keeps the business, and when it was approved.
alter table tc.business add column status_before_closing text;
alter table tc.business add column closing_approved_at timestamptz;

-- Short references owners and Temelash read out on the phone (CLS-1042, LP-3318, DEL-1201).
create sequence tc.request_ref_no start 1001;
grant usage on sequence tc.request_ref_no to tc_app;

-- AdminSettings "Promises we make to owners" (board values). Owner screens read these.
insert into tc.setting (key, value, changed_by) values
  ('promise.close_answer_days', '3', 'migration 0017'),
  ('promise.close_after_days', '30', 'migration 0017'),
  ('promise.lost_answer_days', '2', 'migration 0017'),
  ('promise.signup_check_days', '1', 'migration 0017'),
  ('promise.delete_days', '30', 'migration 0017')
on conflict (key) do nothing;
