-- Phase 8e: support tools on a business (AdminBusinessSupport): follow-ups, merging a
-- duplicate sign-up, and the read-only owner view (logged).

create table tc.follow_up (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tc.business(id),
  text text not null,
  due date not null,
  assignee_id uuid references tc.admin_user(id),
  created_by uuid not null references tc.admin_user(id),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references tc.admin_user(id)
);
create index on tc.follow_up (business_id);
create index on tc.follow_up (due) where done_at is null;
grant select, insert, update on tc.follow_up to tc_app;

-- "Merge a duplicate": the duplicate is closed and points at the business it went into.
alter table tc.business add column merged_into uuid references tc.business(id);
