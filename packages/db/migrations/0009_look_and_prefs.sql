-- Phase 3: the shop's look (OwnLook) and each person's date and time settings (OwnDateTime).

-- Card colour, one of the 12 prototype swatches (the API keeps to that list).
alter table tc.business add column brand_color text not null default '#222222' check (brand_color ~ '^#[0-9A-F]{6}$');

-- The shop logo, kept in the database so moving to the VPS stays a plain dump and restore.
-- The owner's phone resizes it to 400 x 400 before upload, so rows stay small.
create table tc.business_logo (
  business_id uuid primary key references tc.business(id),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) <= 300000),
  version int not null default 1,
  updated_by uuid references tc.person(id),
  updated_at timestamptz not null default now()
);
grant select, insert, update on tc.business_logo to tc_app;

-- How dates and times look for this person: {"calendar": "greg" | "eth", "clock": "24" | "12" | "eth"}.
alter table tc.person add column prefs jsonb not null default '{}';
