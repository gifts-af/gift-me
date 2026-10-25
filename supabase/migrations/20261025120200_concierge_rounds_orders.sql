-- Gift rounds and what hangs off them: ideas, rejections, orders, reactions,
-- notifications, plus inbound email (design §3, §5, §6). Order fields follow
-- the W1-2 checkout spike. Every child row points at its round and owner
-- together, so it can never attach to another user's round.

-- ─── gift_rounds ────────────────────────────────────────────────────────────

-- Same list and order as ROUND_STATUSES in packages/core/src/rounds.ts (T14).
create type concierge.round_status as enum (
  'scheduled',
  'generating',
  'awaiting_approval',
  'ordered',
  'delivered',
  'complete',
  'needs_address',
  'needs_attention',
  'skipped'
);

create table concierge.gift_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  occasion_id uuid not null,
  occasion_year integer not null check (occasion_year between 2000 and 2999),
  occasion_date date not null,
  ship_by_deadline date not null,
  budget_cents integer not null check (budget_cents >= 0),
  status concierge.round_status not null default 'scheduled',
  -- Started after its normal start date, so the heads-up says so (§4.1).
  late boolean not null default false,
  -- Round engine (§5.1): when to look at it next, who holds it, retries.
  next_action_at timestamptz,
  locked_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- One round per person per occasion per year: a repeated tick can't duplicate it.
  unique (person_id, occasion_id, occasion_year),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade,
  foreign key (occasion_id, user_id) references concierge.occasions (id, user_id) on delete cascade
);
-- What the daily tick scans: rounds that still have something to do.
create index gift_rounds_due_idx on concierge.gift_rounds (next_action_at)
  where status not in ('complete', 'skipped');
select concierge.enable_owner_rls('concierge.gift_rounds');

-- ─── gift_ideas ─────────────────────────────────────────────────────────────

create table concierge.gift_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round_id uuid not null,
  title text not null,
  retailer text,
  -- The exact size or color variant to buy.
  product_url text,
  retailer_product_id text,
  offer_id text,
  seller_name text,
  first_party boolean,
  price_cents integer not null check (price_cents >= 0),
  est_shipping_cents integer not null default 0 check (est_shipping_cents >= 0),
  est_tax_cents integer not null default 0 check (est_tax_cents >= 0),
  est_total_cents integer not null check (est_total_cents >= 0),
  handling_days_max integer check (handling_days_max >= 0),
  delivery_days_min integer check (delivery_days_min >= 0),
  delivery_days_max integer check (delivery_days_max >= 0),
  -- Slowest-case arrival.
  arrive_by date,
  reason text,
  over_budget boolean not null default false,
  rank integer not null,
  status text not null default 'proposed' check (status in ('proposed', 'selected', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade
);
create index gift_ideas_round_id_idx on concierge.gift_ideas (round_id);
select concierge.enable_owner_rls('concierge.gift_ideas');

-- Why the user turned ideas down (G-3). Also becomes profile facts.
create table concierge.rejections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round_id uuid not null,
  idea_id uuid,
  reason_code text not null,
  reason_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade,
  foreign key (idea_id, user_id) references concierge.gift_ideas (id, user_id) on delete cascade
);
select concierge.enable_owner_rls('concierge.rejections');

-- ─── orders ─────────────────────────────────────────────────────────────────
-- One per selected idea. Zinc's own status stops at "placed"; shipping
-- progress is per package, and one order can ship as several packages.

create table concierge.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round_id uuid not null,
  idea_id uuid not null,
  provider text not null default 'zinc',
  provider_order_id text,
  -- Sent with the order request, so a retry never buys twice (§5).
  idempotency_key uuid not null unique default gen_random_uuid(),
  funding_mode text not null check (funding_mode in ('zinc_wallet', 'connect')),
  max_price_cents integer not null check (max_price_cents >= 0),
  is_gift boolean not null default true,
  gift_message text check (char_length(gift_message) <= 240),
  subtotal_cents integer check (subtotal_cents >= 0),
  shipping_cents integer check (shipping_cents >= 0),
  tax_cents integer check (tax_cents >= 0),
  total_cents integer check (total_cents >= 0),
  -- The order fee actually charged (T23: the expected fee is an app setting).
  fee_cents integer not null check (fee_cents >= 0),
  status text not null default 'placing'
    check (status in ('placing', 'placed', 'failed', 'shipped', 'delivered', 'cancelled', 'refunded')),
  failure_type text,
  merchant_order_id text,
  -- [{ carrier, tracking_number, status, estimated_delivery_date, proof_of_delivery_url }]
  packages jsonb not null default '[]'::jsonb,
  -- Latest estimate across packages.
  est_delivery_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade,
  foreign key (idea_id, user_id) references concierge.gift_ideas (id, user_id) on delete cascade
);
create index orders_round_id_idx on concierge.orders (round_id);
select concierge.enable_owner_rls('concierge.orders');

-- How the recipient liked the gift (D-2).
create table concierge.reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round_id uuid not null,
  rating text not null check (rating in ('loved', 'liked', 'meh', 'returned')),
  note text,
  source text not null check (source in ('email', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade
);
select concierge.enable_owner_rls('concierge.reactions');

-- ─── messages ───────────────────────────────────────────────────────────────

-- Every message sent, plus reminder escalation state (§6.4).
create table concierge.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round_id uuid,
  kind text not null,
  channel text not null default 'email',
  sent_at timestamptz,
  -- One-time action links are stored hashed.
  action_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade
);
select concierge.enable_owner_rls('concierge.notifications');

-- Emailed notes (N-2, C-5). Placeholder fields until the email spike (W1-4).
create table concierge.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_address text,
  subject text,
  body text,
  attachments jsonb not null default '[]'::jsonb,
  matched_person_id uuid,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (matched_person_id, user_id) references public.people (id, user_id)
    on delete set null (matched_person_id)
);
select concierge.enable_owner_rls('concierge.inbound_messages');
