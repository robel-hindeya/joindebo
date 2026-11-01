-- Phase 7: printed stands. Items with prices and stock, orders with their lines and
-- history, stock moves, and the owner inbox link to an order.

-- ---------------------------------------------------------------- items (AdminStandsPrices / AdminStandsStock)
create table tc.stand_item (
  id text primary key,
  name jsonb not null,          -- {"en": "...", "am": "...", "om": "..."}
  description jsonb not null,
  price_birr numeric(12, 2) not null check (price_birr > 0),
  visible boolean not null default true,
  -- Counted by hand; never below zero (Phase 7 acceptance).
  stock integer not null default 0 check (stock >= 0),
  low_at integer not null default 0 check (low_at >= 0),
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

create table tc.stand_stock_move (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references tc.stand_item(id),
  change integer not null check (change <> 0),
  stock_after integer not null check (stock_after >= 0),
  reason text not null,
  admin_id uuid references tc.admin_user(id),
  at timestamptz not null default now()
);
create index on tc.stand_stock_move (item_id, at);
create trigger stand_stock_move_append_only before update or delete on tc.stand_stock_move for each row execute function tc.refuse_change();
create trigger stand_stock_move_no_truncate before truncate on tc.stand_stock_move for each statement execute function tc.refuse_change();

-- ---------------------------------------------------------------- orders (OwnStandCart → AdminReqStand)
create sequence tc.stand_order_no start 2001;

create table tc.stand_order (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('ST-' || nextval('tc.stand_order_no')),
  business_id uuid not null references tc.business(id),
  branch_id uuid not null references tc.branch(id),
  person_id uuid not null references tc.person(id),
  phone text not null,
  print_language text not null check (print_language in ('en', 'am', 'om', 'all')),
  total_birr numeric(12, 2) not null check (total_birr > 0),
  stage text not null default 'placed' check (stage in ('placed', 'confirmed', 'printing', 'way', 'delivered')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  -- The owner's answer to "Did your order arrive?"; cleared when a replacement is sent.
  received text check (received in ('ok', 'problem')),
  received_at timestamptz,
  received_condition text check (received_condition in ('ok', 'missing', 'damaged')),
  received_pay text check (received_pay in ('cash', 'telebirr')),
  received_note text,
  cash_received_birr numeric(12, 2),
  result text,
  request_id uuid references tc.request(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tc.stand_order (business_id, created_at);
create index on tc.stand_order (status, stage);

create table tc.stand_order_line (
  order_id uuid not null references tc.stand_order(id),
  item_id text not null references tc.stand_item(id),
  qty integer not null check (qty between 1 and 20),
  -- The price when the order was placed; later price changes do not touch it.
  price_birr numeric(12, 2) not null check (price_birr > 0),
  primary key (order_id, item_id)
);
create trigger stand_order_line_append_only before update or delete on tc.stand_order_line for each row execute function tc.refuse_change();
create trigger stand_order_line_no_truncate before truncate on tc.stand_order_line for each statement execute function tc.refuse_change();

-- What happened to an order, in order: the owner's and the team's steps.
create table tc.stand_order_event (
  id bigint generated always as identity primary key,
  order_id uuid not null references tc.stand_order(id),
  kind text not null check (kind in ('placed', 'stage', 'received', 'problem', 'replacement', 'reminded', 'closed', 'cancelled')),
  stage text,
  note text,
  actor_type text not null check (actor_type in ('owner', 'admin')),
  actor_id uuid not null,
  at timestamptz not null default now()
);
create index on tc.stand_order_event (order_id, id);
create trigger stand_order_event_append_only before update or delete on tc.stand_order_event for each row execute function tc.refuse_change();
create trigger stand_order_event_no_truncate before truncate on tc.stand_order_event for each statement execute function tc.refuse_change();

-- ---------------------------------------------------------------- inbox link to an order ("See my order")
alter table tc.admin_message drop constraint if exists admin_message_action_check;
alter table tc.admin_message add constraint admin_message_action_check check (action in ('plan', 'standorder'));
alter table tc.admin_message add column action_ref uuid;

grant select, insert, update on tc.stand_item, tc.stand_order to tc_app;
grant select, insert on tc.stand_stock_move, tc.stand_order_line, tc.stand_order_event to tc_app;
grant usage on sequence tc.stand_order_no to tc_app;

-- The board's five items and example prices (phase-7.md, unclear 1); stock is counted in by the team.
insert into tc.stand_item (id, name, description, price_birr, low_at, sort) values
  ('table', '{"en": "Table stand", "am": "የጠረጴዛ ማቆሚያ", "om": "Dhaabbii minjaalaa"}',
   '{"en": "A5, acrylic, stands on the table", "am": "A5፣ አክሪሊክ፣ ጠረጴዛ ላይ ይቆማል", "om": "A5, akriilikii, minjaala irra dhaabata"}', 350, 10, 1),
  ('counter', '{"en": "Counter poster stand", "am": "የሽያጭ ጠረጴዛ ፖስተር ማቆሚያ", "om": "Dhaabbii poostarii minjaala gabaa"}',
   '{"en": "A4 poster in a metal frame", "am": "A4 ፖስተር በብረት ፍሬም", "om": "Poostarii A4 fireemii sibiilaa keessa"}', 650, 5, 2),
  ('stickers', '{"en": "QR sticker pack", "am": "የQR ተለጣፊ ጥቅል", "om": "Kuusaa maxxansaa QR"}',
   '{"en": "10 stickers, 10 cm, for doors and tills", "am": "10 ተለጣፊዎች፣ 10 ሴ.ሜ፣ ለበር እና ለካሽ", "om": "Maxxansaa 10, 10 cm, balbalaa fi kaashiiroof"}', 120, 20, 3),
  ('wall', '{"en": "Wall poster", "am": "የግድግዳ ፖስተር", "om": "Poostarii dhaabaa"}',
   '{"en": "A3, printed on thick paper", "am": "A3፣ በወፍራም ወረቀት የታተመ", "om": "A3, waraqaa jabaa irratti maxxanfame"}', 180, 8, 4),
  ('window', '{"en": "Window sticker", "am": "የመስኮት ተለጣፊ", "om": "Maxxansaa foddaa"}',
   '{"en": "30 cm, weatherproof", "am": "30 ሴ.ሜ፣ ዝናብና ፀሐይ የማይጎዳው", "om": "30 cm, rooba fi aduu hin sodaatu"}', 220, 6, 5)
on conflict (id) do nothing;
