-- Phase 9: indexes from the slow-query review of Phases 7 and 8 (docs/phases/phase-9.md).

-- "New cards in one hour in one shop" (checked on every join).
create index if not exists card_business_created on tc.card (business_id, created_at);
-- The retention job: accounts waiting to be erased.
create index if not exists customer_deleting on tc.customer (delete_requested_at) where status = 'deleting';
-- Ending every session of a person (closing, merge, phone moves) by person only.
create index if not exists session_actor_live on tc.session (actor_id) where revoked_at is null;
-- Flags and other requests looked up per business and type (flag de-duplication, My requests).
create index if not exists request_business_type on tc.request (business_id, type, created_at desc);
