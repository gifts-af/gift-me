-- Where an order ships (product decision 38, revises PRD A-3, ALL-44): to
-- the recipient, to the buyer, or to another address. Ideas can also come
-- from a person's own gift list (decision 37).
--
-- Orders are written only by the server, before any order exists (ALL-30
-- places the first ones), so the new required columns need no backfill.

-- ─── orders ─────────────────────────────────────────────────────────────────
-- The buyer reads where an order went by city and state. The street address
-- is kept in order_addresses, which only the server reads, because a
-- recipient's shared address must never reach the buyer (decision 38).

alter table concierge.orders
  add column ship_to text not null check (ship_to in ('recipient', 'buyer', 'other')),
  add column ship_city text not null,
  add column ship_state text not null,
  add constraint orders_id_user_id_key unique (id, user_id);

-- The exact address each order was sent to, as it was at the time.
create table concierge.order_addresses (
  order_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  recipient_first_name text not null,
  recipient_last_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  zip text not null,
  country text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, user_id) references concierge.orders (id, user_id) on delete cascade
);

create trigger set_updated_at before update on concierge.order_addresses
  for each row execute function public.set_updated_at();

-- Server only: RLS on with no policies, and no grants to signed-in users.
alter table concierge.order_addresses enable row level security;
revoke all on concierge.order_addresses from authenticated;

-- ─── gift_ideas ─────────────────────────────────────────────────────────────
-- An idea is generated, or picked from the person's own list. list_item_id
-- names the list gift; it has no foreign key, since products don't reach
-- into each other's tables (T19).

alter table concierge.gift_ideas
  add column source text not null default 'generated' check (source in ('generated', 'list')),
  add column list_item_id uuid,
  add constraint gift_ideas_list_item_matches_source check ((source = 'list') = (list_item_id is not null));
