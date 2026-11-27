-- Paying by card through Zinc Connect (planning 59 and 61, revising T16 and T56). A card
-- buyer saves a card on our Stripe account once; each order then sends Zinc a payment
-- object, and Zinc charges that card the goods plus one GiftsAF fee: our margin, Zinc's
-- order fee and the card fee on the whole charge. All of it is off until
-- connect_enabled is 1, and nobody pays by card until an account's funding_mode is
-- 'connect', which this migration doesn't change for anyone.
--
-- Card orders save the four fee inputs they were approved with, the most the card can
-- be charged (max_charge_cents) and the card itself (payment_method_id). An order is
-- only ever sent on that card: when the card is removed, declined or replaced, its
-- waiting gifts end as the failure card_needed, which the buyer fixes by adding a card
-- and tapping Buy again. Saving a card never buys anything.
--
-- Copied functions start from their latest definitions: approve_round,
-- replace_failed_order and begin_placing from 20261124100000_order_address_owner.sql,
-- fail_order_row from 20261113100000_order_address_source.sql, record_outcomes from
-- 20261109100000_zinc_wallet.sql, gate_held_orders from 20261109120000_zinc_gate_held.sql,
-- settle_order from 20261124110000_order_tracking.sql, save_ideas from
-- 20261127120000_moved_dates.sql and cost_per_gift from 20261125100000_cost_tracking.sql.
-- Only the lines marked New, and the ones they need, differ. Same signatures, so
-- create or replace keeps their grants. Wallet orders behave exactly as before.
-- Expand-only (E7).

-- ─── accounts: the buyer's Stripe customer and saved card ─────────────────────
-- Ids only: no card number, brand or last four (T42). Server only: no grant to
-- signed-in users, whose column grants are listed one by one (T56).
alter table concierge.accounts
  add column stripe_customer_id text,
  add column stripe_payment_method_id text,
  add constraint accounts_card_needs_customer check (stripe_payment_method_id is null or stripe_customer_id is not null);
comment on column concierge.accounts.stripe_customer_id is
  'The buyer''s Stripe customer on our account, kept when the card is removed. Server only.';
comment on column concierge.accounts.stripe_payment_method_id is
  'The saved card''s Stripe id; null when there is none. Server only.';

-- ─── orders: what a card order was approved with ──────────────────────────────
alter table concierge.orders
  add column margin_cents integer check (margin_cents >= 0),
  add column zinc_fee_cents integer check (zinc_fee_cents >= 0),
  add column card_fee_bps integer check (card_fee_bps >= 0 and card_fee_bps < 10000),
  add column card_fee_fixed_cents integer check (card_fee_fixed_cents >= 0),
  add column max_charge_cents integer check (max_charge_cents >= 0),
  add column final_charge_cents integer check (final_charge_cents >= 0),
  add column payment_method_id text,
  -- NOT VALID: no existing row is a card order, and this skips re-reading them all.
  add constraint orders_connect_has_fees check (
    funding_mode <> 'connect'
    or (margin_cents is not null and zinc_fee_cents is not null and card_fee_bps is not null
        and card_fee_fixed_cents is not null and max_charge_cents is not null and payment_method_id is not null)) not valid;
comment on column concierge.orders.max_charge_cents is
  'Card orders: the most the card can be charged (goods cap plus every fee), as shown at approval.';
comment on column concierge.orders.final_charge_cents is
  'Card orders: what the card was charged, from Zinc, or worked out from the saved fees when Zinc did not say.';
comment on column concierge.orders.payment_method_id is
  'Card orders: the Stripe card the order was approved with; it is only ever sent on this card. Server only.';

-- ─── gift_ideas: the goods alone ──────────────────────────────────────────────
-- est_total_cents is a wallet total, which includes Zinc's fee. A card buyer's charge
-- is worked out from the goods (price, shipping and tax) instead.
alter table concierge.gift_ideas add column goods_cents integer check (goods_cents >= 0);
do $$
begin
  if concierge.setting_int('zinc_order_fee_cents') is null then
    raise exception 'card payments: missing setting zinc_order_fee_cents';
  end if;
end $$;
update concierge.gift_ideas
   set goods_cents = greatest(0, est_total_cents - concierge.setting_int('zinc_order_fee_cents'))
 where goods_cents is null;

-- ─── failure type card_needed ─────────────────────────────────────────────────
alter table concierge.orders drop constraint orders_failure_type_check;
alter table concierge.orders
  add constraint orders_failure_type_check check (failure_type in (
    'failed', 'price_up', 'out_of_stock', 'invalid_shipping_address', 'too_late',
    'address_withdrawn', 'address_rejected', 'held_expired', 'cancelled', 'round_closed',
    'store_cancelled',
    'card_needed' -- New.
  ));

-- ─── card_sessions: one Stripe card-saving visit ──────────────────────────────
-- Written when the buyer leaves for Stripe's page and used once when they come back,
-- so an old or someone else's return link saves nothing. Where they came from is
-- stored here, never taken from the return link. No round means Settings.
create table concierge.card_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_session_id text not null unique,
  stripe_customer_id text not null,
  round_id uuid references concierge.gift_rounds (id) on delete cascade,
  idea_ids uuid[],
  failed_order_id uuid references concierge.orders (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
comment on table concierge.card_sessions is
  'One visit to Stripe''s card-saving page: whose it is, the customer, and where to send the buyer back. Used once. Server only.';
create index card_sessions_user_id on concierge.card_sessions (user_id);
create index card_sessions_round_id on concierge.card_sessions (round_id) where round_id is not null;
create index card_sessions_failed_order_id on concierge.card_sessions (failed_order_id) where failed_order_id is not null;
alter table concierge.card_sessions enable row level security;
revoke all on concierge.card_sessions from public, anon, authenticated;
grant select, insert, update, delete on concierge.card_sessions to service_role;

-- ─── cost_events: what card orders paid ───────────────────────────────────────
alter table concierge.cost_events drop constraint cost_events_kind_check;
alter table concierge.cost_events
  add constraint cost_events_kind_check check (kind in (
    'ai_ideas', 'lookup_ideas', 'ai_capture', 'lookup_price_check',
    'zinc_order_fee', 'card_fee' -- New.
  ));
-- Counted once per order, whichever of the webhook and the sweep settles it first.
create unique index cost_events_card_order_once on concierge.cost_events (order_id, kind)
  where kind in ('zinc_order_fee', 'card_fee');

-- ─── settings ─────────────────────────────────────────────────────────────────
-- Planning 61: a $2.00 fixed part (Zinc's $1.00, plus our $1.00 margin, which is AI
-- suggestions $0.65 and running the service $0.35), and the card fee on top. The margin
-- is always the sum of its two parts, so the (i) breakdown can't disagree with the charge.
-- zinc_fee_cents is separate from the wallet's zinc_order_fee_cents: both are Zinc's $1
-- today, but Zinc sets each and they may differ.
insert into concierge.app_settings (key, value, description) values
  ('connect_enabled', '0', 'Switch for paying by card: 1 lets card buyers add a card and buy, 0 places no card order and hides Add a card. Orders already sent still settle.'),
  ('zinc_fee_cents', '100', 'Zinc''s fee per card order, in cents, as Zinc adds it to the card charge.'),
  ('card_fee_bps', '290', 'The card fee''s percentage part on the whole charge, in basis points (290 = 2.9%).'),
  ('card_fee_fixed_cents', '30', 'The card fee''s fixed part per charge, in cents.'),
  ('fee_part_ai_cents', '65', 'Our margin per card order, part 1: AI suggestions, in cents (planning 61). The margin sent to Zinc is this plus fee_part_running_cents.'),
  ('fee_part_running_cents', '35', 'Our margin per card order, part 2: running the service, in cents (planning 61).'),
  ('stripe_timeout_ms', '10000', 'How long a call to Stripe may take before it is given up on, in milliseconds.'),
  ('card_session_minutes', '60', 'How long a visit to Stripe''s card-saving page stays usable, in minutes.')
on conflict (key) do nothing;

insert into concierge.app_settings (key, value, description) values
  ('fee_label', '"GiftsAF fee"', 'The fee line''s name on the buy page, emails and receipts.'),
  ('fee_pricing_note', '"Launch pricing: at cost"', 'The line under the fee breakdown.')
on conflict (key) do nothing;

-- ─── card_margin_cents: our part of the fee, from its two parts ──────────────
create function concierge.card_margin_cents()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select concierge.setting_int('fee_part_ai_cents') + concierge.setting_int('fee_part_running_cents');
$$;

-- ─── card_charge_cents: the whole charge for some goods ──────────────────────
-- The same rounding as chargeCents in packages/core: up, so the charge shown is never
-- below what the card is charged.
create function concierge.card_charge_cents(p_goods_cents integer, p_margin integer, p_zinc_fee integer,
                                            p_bps integer, p_fixed integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ceil(((p_goods_cents + p_margin + p_zinc_fee + p_fixed)::numeric * 10000) / (10000 - p_bps))::integer;
$$;

-- ─── check_card_order: may this card buyer approve these orders? ─────────────
-- Raised with the caller's name, so the app reads them as it does every other refusal.
-- connect_off: card payments are switched off. no_card: no saved card or phone.
-- fees_changed: the fees the buyer was shown aren't today's.
create function concierge.check_card_order(a concierge.accounts, p_orders jsonb, p_caller text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(concierge.setting_int('connect_enabled'), 0) <> 1 then
    raise exception '%: connect_off', p_caller using errcode = 'P0001';
  end if;
  if a.stripe_customer_id is null or a.stripe_payment_method_id is null or a.buyer_phone is null then
    raise exception '%: no_card', p_caller using errcode = 'P0001';
  end if;
  if concierge.card_margin_cents() is null or concierge.setting_int('zinc_fee_cents') is null
     or concierge.setting_int('card_fee_bps') is null or concierge.setting_int('card_fee_fixed_cents') is null then
    raise exception '%: missing a card fee setting', p_caller;
  end if;
  if exists (select 1 from jsonb_array_elements(p_orders) e
              where (e ->> 'margin_cents')::integer is distinct from concierge.card_margin_cents()
                 or (e ->> 'zinc_fee_cents')::integer is distinct from concierge.setting_int('zinc_fee_cents')
                 or (e ->> 'card_fee_bps')::integer is distinct from concierge.setting_int('card_fee_bps')
                 or (e ->> 'card_fee_fixed_cents')::integer is distinct from concierge.setting_int('card_fee_fixed_cents')) then
    raise exception '%: fees_changed', p_caller using errcode = 'P0001';
  end if;
end;
$$;

-- ─── approve_round ─────────────────────────────────────────────────────────────
create or replace function concierge.approve_round(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_orders jsonb)
returns setof concierge.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_el jsonb;
  v_order concierge.orders;
  v_ids uuid[] := '{}';
  v_item uuid;
  a concierge.accounts; -- New.
  v_mode text; -- New.
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id then
    raise exception 'approve_round: round not found' using errcode = 'P0001';
  end if;
  -- New: who pays comes from the account, under its lock (after the round's), never
  -- from the caller. No account row pays by wallet, as before.
  select * into a from concierge.accounts where user_id = p_user_id for update;
  v_mode := coalesce(a.funding_mode, 'zinc_wallet');
  if r.locked_until is distinct from p_lock then
    raise exception 'approve_round: lease not held' using errcode = 'P0001';
  end if;
  if r.status <> 'awaiting_approval' or r.closed_at is not null then
    raise exception 'approve_round: round is % (closed: %)', r.status, r.closed_at is not null using errcode = 'P0001';
  end if;
  -- Never on or after the ship-by deadline (the engine's UTC day), so a gift
  -- can't be approved into a round the deadline step is closing.
  if (now() at time zone 'utc')::date >= r.ship_by_deadline then
    raise exception 'approve_round: past the ship-by deadline' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'approve_round: no orders' using errcode = 'P0001';
  end if;
  -- New: a card buyer needs card payments on, a saved card and a phone, and the
  -- fees the buyer was shown must still be today's.
  if v_mode = 'connect' then
    perform concierge.check_card_order(a, p_orders, 'approve_round');
  end if;
  if exists (select 1 from concierge.orders
              where round_id = p_round_id and status <> 'cancelled' and not (status = 'failed' and resolved)) then
    raise exception 'approve_round: round already has a live order' using errcode = 'P0001';
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_orders) e
        where not exists (select 1 from concierge.gift_ideas i
                           where i.id = (e ->> 'idea_id')::uuid and i.round_id = p_round_id and i.user_id = p_user_id))
     or (select count(distinct e ->> 'idea_id') from jsonb_array_elements(p_orders) e) <> jsonb_array_length(p_orders) then
    raise exception 'approve_round: an idea isn''t this round''s' using errcode = 'P0001';
  end if;
  -- Only ideas still on offer; a rejected or selected one was replaced (an old
  -- "Buy this" link, a stale tab).
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
              where i.status <> 'proposed') then
    raise exception 'approve_round: replaced' using errcode = 'P0001';
  end if;
  -- A list gift only while the round's person is still linked to the list it's on.
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
              where i.list_item_id is not null
                and not lists.item_shared(i.list_item_id, r.person_id)) then
    raise exception 'approve_round: not_shared' using errcode = 'P0001';
  end if;
  -- A list gift already on one of this buyer's live orders, in any round, isn't
  -- bought again: the same rule as excluded_offers (order_is_given).
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
               join concierge.gift_ideas i2 on i2.user_id = p_user_id and i2.list_item_id = i.list_item_id
               join concierge.orders o on o.idea_id = i2.id
              where i.list_item_id is not null
                and concierge.order_is_given(o.status, o.resolved))
     -- Nor twice in one approval: neither order exists yet, and the second claim
     -- reads as the buyer's own.
     or (select count(i.list_item_id) <> count(distinct i.list_item_id)
           from jsonb_array_elements(p_orders) e
           join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid) then
    raise exception 'approve_round: already_bought' using errcode = 'P0001';
  end if;
  -- A list pick someone else already claimed isn't bought too, read through
  -- lists.claim_holder (T19).
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
              where i.list_item_id is not null
                and lists.claim_holder(i.list_item_id, p_user_id) = 'other') then
    raise exception 'approve_round: claimed' using errcode = 'P0001';
  end if;
  -- A shared address only from the owner the person links to now, so the
  -- order records who the buyer chose (T88). An owner sent as null never matches.
  -- A caller that sends no owner at all (the app before this change, during a
  -- deploy or rollback) gets the current link owner recorded instead.
  if exists (select 1
               from jsonb_array_elements(p_orders) e
              where e ->> 'address_source' = 'shared'
                and (not exists (select 1 from lists.active_link(r.person_id))
                     or (e ? 'address_owner_id'
                         and ((e ->> 'address_owner_id') is null
                              or (e ->> 'address_owner_id') is distinct from
                                 (select l.owner_id::text from lists.active_link(r.person_id) l))))) then
    raise exception 'approve_round: address changed' using errcode = 'P0001';
  end if;

  for v_el in select * from jsonb_array_elements(p_orders) loop
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                  status, hold_reason, ship_to, ship_city, ship_state, address_source,
                                  address_owner_id,
                                  margin_cents, zinc_fee_cents, card_fee_bps, card_fee_fixed_cents, -- New.
                                  max_charge_cents, payment_method_id) -- New.
    values (p_user_id, p_round_id, (v_el ->> 'idea_id')::uuid, v_mode, (v_el ->> 'max_price_cents')::integer,
            case when v_mode = 'connect'
                 then concierge.card_charge_cents((v_el ->> 'max_price_cents')::integer, (v_el ->> 'margin_cents')::integer, (v_el ->> 'zinc_fee_cents')::integer,
                                                        (v_el ->> 'card_fee_bps')::integer, (v_el ->> 'card_fee_fixed_cents')::integer) - (v_el ->> 'max_price_cents')::integer
                 else (v_el ->> 'fee_cents')::integer end,
            v_el ->> 'gift_message', 'held', 'retry', v_el ->> 'ship_to',
            v_el -> 'address' ->> 'city', v_el -> 'address' ->> 'state',
            v_el ->> 'address_source',
            case when v_el ->> 'address_source' = 'shared'
                 then coalesce((v_el ->> 'address_owner_id')::uuid,
                               (select l.owner_id from lists.active_link(r.person_id) l)) end,
            -- New: a card order saves the fees it was approved with (the ones the buyer
            -- saw, checked against today's settings above), the most the card can be
            -- charged, and the card itself; it is only ever sent on that card.
            case when v_mode = 'connect' then (v_el ->> 'margin_cents')::integer end,
            case when v_mode = 'connect' then (v_el ->> 'zinc_fee_cents')::integer end,
            case when v_mode = 'connect' then (v_el ->> 'card_fee_bps')::integer end,
            case when v_mode = 'connect' then (v_el ->> 'card_fee_fixed_cents')::integer end,
            case when v_mode = 'connect' then concierge.card_charge_cents((v_el ->> 'max_price_cents')::integer, (v_el ->> 'margin_cents')::integer, (v_el ->> 'zinc_fee_cents')::integer,
                                                        (v_el ->> 'card_fee_bps')::integer, (v_el ->> 'card_fee_fixed_cents')::integer) end,
            case when v_mode = 'connect' then a.stripe_payment_method_id end)
    returning * into v_order;
    insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                           address_line2, city, state, zip, country, phone)
    values (v_order.id, p_user_id, v_el -> 'address' ->> 'recipient_first_name', v_el -> 'address' ->> 'recipient_last_name',
            v_el -> 'address' ->> 'address_line1', v_el -> 'address' ->> 'address_line2', v_el -> 'address' ->> 'city',
            v_el -> 'address' ->> 'state', v_el -> 'address' ->> 'zip', v_el -> 'address' ->> 'country',
            v_el -> 'address' ->> 'phone');
    update concierge.gift_ideas set status = 'selected' where id = v_order.idea_id
    returning list_item_id into v_item;
    -- A friend's claim that landed after the check above wins; the buyer's own
    -- claim (another pick or order of theirs on the same item) is fine.
    if v_item is not null
       and not lists.claim_for_order(v_item, p_user_id)
       and lists.claim_holder(v_item, p_user_id) <> 'mine' then
      raise exception 'approve_round: claimed' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_order.id;
  end loop;

  update concierge.gift_rounds set approved_at = now() where id = p_round_id;
  perform concierge.reconcile_round(p_round_id);
  return query select * from concierge.orders where id = any (v_ids);
end;
$$;


-- ─── replace_failed_order ──────────────────────────────────────────────────────
create or replace function concierge.replace_failed_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz,
                                                          p_failed_order_id uuid, p_order jsonb)
returns setof concierge.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_old concierge.orders;
  v_idea concierge.gift_ideas;
  v_found boolean;
  v_same boolean;
  v_old_item uuid;
  v_new_total integer := (p_order ->> 'new_total_cents')::integer;
  v_order concierge.orders;
  a concierge.accounts; -- New.
  v_mode text; -- New.
  v_new_goods integer := (p_order ->> 'new_goods_cents')::integer; -- New.
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'replace_failed_order: lease not held' using errcode = 'P0001';
  end if;
  -- New: who pays, from the account under its lock, as approve_round.
  select * into a from concierge.accounts where user_id = p_user_id for update;
  v_mode := coalesce(a.funding_mode, 'zinc_wallet');
  -- Open, and before the ship-by deadline (the engine's UTC day), as approve_round.
  if r.closed_at is not null or r.status <> 'needs_attention'
     or (now() at time zone 'utc')::date >= r.ship_by_deadline then
    raise exception 'replace_failed_order: not open' using errcode = 'P0001';
  end if;
  select * into v_old from concierge.orders
   where id = p_failed_order_id and round_id = p_round_id and user_id = p_user_id
     and status = 'failed' and not resolved
     for update;
  if not found then
    raise exception 'replace_failed_order: not current' using errcode = 'P0001';
  end if;

  -- Only an idea still on offer, or the failed order's own one when the gift
  -- itself was fine: a price rise or an address failure.
  select * into v_idea from concierge.gift_ideas
   where id = (p_order ->> 'idea_id')::uuid and round_id = p_round_id and user_id = p_user_id;
  v_found := found;
  v_same := v_found and v_idea.id = v_old.idea_id;
  if not v_found
     or (v_same and v_old.failure_type not in ('price_up', 'address_withdrawn', 'address_rejected', 'card_needed')) -- New: card_needed.
     or (not v_same and v_idea.status <> 'proposed') then
    raise exception 'replace_failed_order: replaced' using errcode = 'P0001';
  end if;

  -- A price-up re-buy, once per gift, at the price the buyer saw.
  if v_same and v_old.failure_type = 'price_up' then
    if exists (select 1 from concierge.orders o
                where o.idea_id = v_idea.id and o.id <> v_old.id
                  and o.status = 'failed' and o.failure_type = 'price_up' and o.resolved) then
      raise exception 'replace_failed_order: once' using errcode = 'P0001';
    end if;
    if v_new_total is null or v_new_total <= 0 then
      raise exception 'replace_failed_order: no new total' using errcode = 'P0001';
    end if;
  end if;

  -- An address failure ships to a fixed address with its snapshot saved, never
  -- re-read from the recipient.
  if v_old.failure_type in ('address_withdrawn', 'address_rejected')
     and not coalesce(p_order ->> 'ship_to' in ('buyer', 'other') and p_order ->> 'address_source' = 'own', false) then
    raise exception 'replace_failed_order: fixed address' using errcode = 'P0001';
  end if;

  -- New: a card buyer's replacement passes the same card checks as approving.
  if v_mode = 'connect' then
    perform concierge.check_card_order(a, jsonb_build_array(p_order), 'replace_failed_order');
  end if;

  -- A shared address only from the owner the person links to now, as
  -- approve_round, including its rule for a caller that sends no owner (T88).
  if p_order ->> 'address_source' = 'shared'
     and (not exists (select 1 from lists.active_link(r.person_id))
          or (p_order ? 'address_owner_id'
              and ((p_order ->> 'address_owner_id') is null
                   or (p_order ->> 'address_owner_id') is distinct from
                      (select l.owner_id::text from lists.active_link(r.person_id) l)))) then
    raise exception 'replace_failed_order: address changed' using errcode = 'P0001';
  end if;

  -- The list checks, as approve_round's, through the lists product's functions (T19).
  if v_idea.list_item_id is not null then
    if not lists.item_shared(v_idea.list_item_id, r.person_id) then
      raise exception 'replace_failed_order: not_shared' using errcode = 'P0001';
    end if;
    -- On another of this buyer's live orders, in any round (order_is_given).
    -- The failed order being replaced doesn't count.
    if exists (select 1
                 from concierge.gift_ideas i2
                 join concierge.orders o on o.idea_id = i2.id
                where i2.user_id = p_user_id and i2.list_item_id = v_idea.list_item_id
                  and o.id <> v_old.id
                  and concierge.order_is_given(o.status, o.resolved)) then
      raise exception 'replace_failed_order: already_bought' using errcode = 'P0001';
    end if;
    if lists.claim_holder(v_idea.list_item_id, p_user_id) = 'other' then
      raise exception 'replace_failed_order: claimed' using errcode = 'P0001';
    end if;
  end if;

  if v_new_goods is null and v_new_total > 0 and concierge.setting_int('zinc_order_fee_cents') is null then
    raise exception 'replace_failed_order: missing setting zinc_order_fee_cents'; -- New.
  end if;
  update concierge.orders set resolved = true where id = v_old.id;
  -- placeRound's cap re-check follows the new price. New: so does a card gift
  -- bought again at today's price, and the goods move with the total.
  if v_same and (v_old.failure_type = 'price_up' or (v_old.failure_type = 'card_needed' and v_new_total > 0)) then
    update concierge.gift_ideas
       set est_total_cents = v_new_total,
           -- New: a caller that sends only the total sent a wallet total, which includes Zinc's fee.
           goods_cents = coalesce(v_new_goods, v_new_total - concierge.setting_int('zinc_order_fee_cents')), -- New.
           -- A round with no budget has nothing to be over.
           over_budget = coalesce(v_new_total > r.budget_cents, false)
     where id = v_idea.id;
  end if;

  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                status, hold_reason, ship_to, ship_city, ship_state, address_source,
                                address_owner_id,
                                margin_cents, zinc_fee_cents, card_fee_bps, card_fee_fixed_cents, -- New.
                                max_charge_cents, payment_method_id) -- New.
  values (p_user_id, p_round_id, v_idea.id, v_mode, (p_order ->> 'max_price_cents')::integer,
          case when v_mode = 'connect'
               then concierge.card_charge_cents((p_order ->> 'max_price_cents')::integer, (p_order ->> 'margin_cents')::integer, (p_order ->> 'zinc_fee_cents')::integer,
                                                        (p_order ->> 'card_fee_bps')::integer, (p_order ->> 'card_fee_fixed_cents')::integer) - (p_order ->> 'max_price_cents')::integer
               else (p_order ->> 'fee_cents')::integer end,
          p_order ->> 'gift_message', 'held', 'retry', p_order ->> 'ship_to',
          p_order -> 'address' ->> 'city', p_order -> 'address' ->> 'state', p_order ->> 'address_source',
          case when p_order ->> 'address_source' = 'shared'
               then coalesce((p_order ->> 'address_owner_id')::uuid,
                             (select l.owner_id from lists.active_link(r.person_id) l)) end,
          -- New: today's fees (as checked) and card, as approve_round.
          case when v_mode = 'connect' then (p_order ->> 'margin_cents')::integer end,
          case when v_mode = 'connect' then (p_order ->> 'zinc_fee_cents')::integer end,
          case when v_mode = 'connect' then (p_order ->> 'card_fee_bps')::integer end,
          case when v_mode = 'connect' then (p_order ->> 'card_fee_fixed_cents')::integer end,
          case when v_mode = 'connect' then concierge.card_charge_cents((p_order ->> 'max_price_cents')::integer, (p_order ->> 'margin_cents')::integer, (p_order ->> 'zinc_fee_cents')::integer,
                                                        (p_order ->> 'card_fee_bps')::integer, (p_order ->> 'card_fee_fixed_cents')::integer) end,
          case when v_mode = 'connect' then a.stripe_payment_method_id end)
  returning * into v_order;
  insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                         address_line2, city, state, zip, country, phone)
  values (v_order.id, p_user_id, p_order -> 'address' ->> 'recipient_first_name', p_order -> 'address' ->> 'recipient_last_name',
          p_order -> 'address' ->> 'address_line1', p_order -> 'address' ->> 'address_line2', p_order -> 'address' ->> 'city',
          p_order -> 'address' ->> 'state', p_order -> 'address' ->> 'zip', p_order -> 'address' ->> 'country',
          p_order -> 'address' ->> 'phone');
  update concierge.gift_ideas set status = 'selected' where id = v_idea.id;
  -- Another idea replaced a list gift: its claim goes back to the list unless
  -- the gift is still on another of this buyer's live orders, as
  -- reconcile_round guards its release.
  if not v_same then
    select i.list_item_id into v_old_item from concierge.gift_ideas i where i.id = v_old.idea_id;
    if v_old_item is not null
       and not exists (select 1
                         from concierge.gift_ideas i2
                         join concierge.orders o on o.idea_id = i2.id
                        where i2.user_id = p_user_id and i2.list_item_id = v_old_item
                          and concierge.order_is_given(o.status, o.resolved)) then
      perform lists.release_for_order(v_old_item, p_user_id);
    end if;
  end if;
  -- A friend's claim that landed after the check above wins; the buyer's own is fine.
  if v_idea.list_item_id is not null
     and not lists.claim_for_order(v_idea.list_item_id, p_user_id)
     and lists.claim_holder(v_idea.list_item_id, p_user_id) <> 'mine' then
    raise exception 'replace_failed_order: claimed' using errcode = 'P0001';
  end if;

  perform concierge.reconcile_round(p_round_id);
  return next v_order;
end;
$$;


-- ─── save_ideas ────────────────────────────────────────────────────────────────
create or replace function concierge.save_ideas(p_run_id uuid, p_ideas jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run concierge.idea_runs;
  v_count int;
begin
  select * into v_run from concierge.idea_runs where id = p_run_id;
  if not found then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_run.person_id::text));

  perform 1 from public.people p
   where p.id = v_run.person_id and p.user_id = v_run.user_id and p.deleted_at is null;
  if not found then
    return 0;
  end if;
  -- -1 when the round ended while the run was under way, so nothing is saved or sent for it.
  if v_run.round_id is not null then
    perform 1 from concierge.gift_rounds r
     where r.id = v_run.round_id and r.closed_at is null and r.status <> 'skipped'
       for update;
    if not found then
      return -1;
    end if;
  end if;
  -- Only ideas that aren't rejected count.
  if v_run.round_id is not null
     and exists (select 1 from concierge.gift_ideas i where i.round_id = v_run.round_id and i.status <> 'rejected') then
    return 0;
  end if;

  -- New: an old-shape idea's goods come from Zinc's wallet fee; never a silent $0.
  if exists (select 1 from jsonb_array_elements(p_ideas) e where not e ? 'goods_cents')
     and concierge.setting_int('zinc_order_fee_cents') is null then
    raise exception 'save_ideas: missing setting zinc_order_fee_cents';
  end if;

  if v_run.round_id is null then
    delete from concierge.gift_ideas i
     where i.person_id = v_run.person_id and i.user_id = v_run.user_id and i.round_id is null;
  end if;

  insert into concierge.gift_ideas (
    user_id, person_id, round_id, source, list_item_id, image_url, status, title, retailer, product_url,
    retailer_product_id, offer_id, seller_name, first_party, price_cents, est_shipping_cents, est_tax_cents,
    est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, arrive_by, reason, over_budget, rank,
    goods_cents) -- New.
  select
    v_run.user_id, v_run.person_id, v_run.round_id,
    coalesce(r.source, 'generated'), r.list_item_id, r.image_url,
    'proposed', r.title, r.retailer, r.product_url,
    r.retailer_product_id, r.offer_id, r.seller_name, r.first_party, r.price_cents,
    coalesce(r.est_shipping_cents, 0), coalesce(r.est_tax_cents, 0), r.est_total_cents,
    r.handling_days_max, r.delivery_days_min, r.delivery_days_max, r.arrive_by, r.reason,
    coalesce(r.over_budget, false), r.rank,
    -- New: price, shipping and tax without any fee. A caller that sends none (the app
    -- before card payments) saved a wallet total, which includes Zinc's fee.
    coalesce(r.goods_cents, greatest(0, r.est_total_cents - concierge.setting_int('zinc_order_fee_cents')))
  from jsonb_populate_recordset(null::concierge.gift_ideas, p_ideas) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ─── fail_order_row ────────────────────────────────────────────────────────────
create or replace function concierge.fail_order_row(p_order concierge.orders, p_failure_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  -- A shared address Zinc rejected ends the order. Only its owner could fix it,
  -- so there's no replacement waiting on the buyer (T61).
  v_type text := case when p_failure_type = 'invalid_shipping_address' and p_order.address_source = 'shared'
                      then 'address_rejected'
                      -- New: a card the bank refused ends a card order with nothing bought; a
                      -- wallet order has no card of ours, so it's an ordinary failure.
                      when p_failure_type = 'card_declined' and p_order.funding_mode = 'connect' then 'card_needed'
                      when p_failure_type = 'card_declined' then 'failed'
                      else p_failure_type end;
begin
  update concierge.orders
     set status = 'failed',
         failure_type = v_type,
         hold_reason = null,
         resolved = (v_type = 'invalid_shipping_address'),
         -- The round already closed, so the engine won't tell the buyer; the app does.
         failed_after_close = exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
   where id = p_order.id;

  -- A share that was withdrawn leaves nothing of the address on the order, in
  -- this same transaction (T42, decision 43).
  if v_type = 'address_withdrawn' then
    delete from concierge.order_addresses where order_id = p_order.id;
    update concierge.orders set ship_city = '', ship_state = '' where id = p_order.id;
  end if;

  -- New: a declined card is cleared from the account if it's still the saved one, so
  -- every gift waiting on it stops at begin_placing too. A card saved since stays.
  if p_failure_type = 'card_declined' and p_order.funding_mode = 'connect' then
    update concierge.accounts set stripe_payment_method_id = null
     where user_id = p_order.user_id and stripe_payment_method_id = p_order.payment_method_id;
  end if;

  if v_type = 'invalid_shipping_address'
     and not exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
     and not exists (select 1 from concierge.orders
                      where idea_id = p_order.idea_id and status not in ('failed', 'cancelled', 'refunded')) then
    insert into concierge.orders (user_id, round_id, idea_id, provider, funding_mode, max_price_cents, is_gift, gift_message,
                                  fee_cents, status, hold_reason, ship_to, ship_city, ship_state, address_source,
                                  address_owner_id, margin_cents, zinc_fee_cents, card_fee_bps, card_fee_fixed_cents, -- New.
                                  max_charge_cents, payment_method_id) -- New.
    values (p_order.user_id, p_order.round_id, p_order.idea_id, p_order.provider, p_order.funding_mode, p_order.max_price_cents,
            p_order.is_gift, p_order.gift_message, p_order.fee_cents, 'held', 'address', p_order.ship_to, p_order.ship_city,
            p_order.ship_state, p_order.address_source,
            p_order.address_owner_id, p_order.margin_cents, p_order.zinc_fee_cents, p_order.card_fee_bps, -- New.
            p_order.card_fee_fixed_cents, p_order.max_charge_cents, p_order.payment_method_id)
    returning id into v_new;
    -- No address snapshot: begin_placing needs a fresh, valid one before it sends.
  end if;
end;
$$;


-- ─── record_outcomes ───────────────────────────────────────────────────────────
create or replace function concierge.record_outcomes(p_round_id uuid, p_results jsonb)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_el jsonb;
  v_order concierge.orders;
  v_closed boolean;
begin
  select closed_at is not null into v_closed from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;

  -- New: declines first, so a sibling left unsent sees the card already cleared.
  for v_el in select e from jsonb_array_elements(p_results) e
               order by (e ->> 'failure_type') is not distinct from 'card_declined' desc loop
    select * into v_order from concierge.orders
     where id = (v_el ->> 'order_id')::uuid and round_id = p_round_id and status = 'placing'
       for update;
    continue when not found;

    case v_el ->> 'outcome'
      when 'sent' then
        update concierge.orders
           set provider_order_id = coalesce(v_el ->> 'provider_order_id', provider_order_id)
         where id = v_order.id;
      when 'insufficient', 'unsent' then
        if v_closed then
          -- Nothing was bought, and the round was cancelled or closed meanwhile:
          -- the order is never held again.
          update concierge.orders set status = 'cancelled', failure_type = 'round_closed' where id = v_order.id;
          continue;
        end if;
        -- New: a card order is never held for funds. A 402 there is the app's mistake, so
        -- the order ends with nothing bought rather than undoing the rest of the batch.
        if v_el ->> 'outcome' = 'insufficient' and v_order.funding_mode = 'connect' then
          perform concierge.fail_order_row(v_order, 'failed');
          continue;
        end if;
        -- New: an unsent card order whose card is no longer the saved one is never sent on it.
        if v_el ->> 'outcome' = 'unsent' and v_order.funding_mode = 'connect'
           and v_order.payment_method_id is distinct from
               (select a.stripe_payment_method_id from concierge.accounts a where a.user_id = v_order.user_id) then
          perform concierge.fail_order_row(v_order, 'card_needed');
          continue;
        end if;
        if v_el ->> 'outcome' = 'unsent' then
          -- Never POSTed, so it keeps its key.
          update concierge.orders set status = 'held', hold_reason = 'retry' where id = v_order.id;
          continue;
        end if;
        -- A 402 created nothing at Zinc, so a fresh key keeps a cached 402 from blocking the retry.
        update concierge.orders
           set status = 'held', hold_reason = 'funds', idempotency_key = gen_random_uuid()
         where id = v_order.id;
        if v_el ? 'available_cents' then
          update concierge.gift_rounds set seen_balance_cents = (v_el ->> 'available_cents')::integer where id = p_round_id;
        end if;
      when 'rejected' then
        perform concierge.fail_order_row(v_order, coalesce(v_el ->> 'failure_type', 'failed'));
      when 'unknown' then
        null; -- Timed out: it may exist at Zinc. Stays placing until the sweep looks it up.
      else
        raise exception 'Unknown outcome %', v_el ->> 'outcome' using errcode = '22023';
    end case;
  end loop;

  return concierge.reconcile_round(p_round_id);
end;
$$;


-- ─── gate_held_orders ──────────────────────────────────────────────────────────
create or replace function concierge.gate_held_orders(p_round_id uuid, p_reason text)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('paused', 'not_allowed', 'setup') then
    raise exception 'gate_held_orders takes paused, not_allowed or setup' using errcode = '22023';
  end if;
  perform 1 from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;
  update concierge.orders
     set hold_reason = p_reason
   where round_id = p_round_id and status = 'held'
     and (array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], hold_reason)
            > array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], p_reason)
          -- New: a paused card order reads paused whatever it waited on, so nobody is
          -- asked to fix something while buying is off.
          or (p_reason = 'paused' and funding_mode = 'connect'));
  return concierge.reconcile_round(p_round_id);
end;
$$;
revoke all on function concierge.gate_held_orders(uuid, text) from public, anon, authenticated;
grant execute on function concierge.gate_held_orders(uuid, text) to service_role;


-- ─── settle_order ──────────────────────────────────────────────────────────────
create or replace function concierge.settle_order(p_user_id uuid, p_order_id uuid, p_status text, p_failure_type text, p_price jsonb)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
  v_order concierge.orders;
  v_price jsonb := coalesce(p_price, '{}'::jsonb);
  v_placed concierge.orders; -- New.
  v_final integer; -- New.
  v_estimated boolean; -- New.
  v_excluded boolean; -- New.
begin
  if p_status not in ('placed', 'failed') then
    raise exception 'Unknown order status %', p_status using errcode = '22023';
  end if;
  select round_id into v_round from concierge.orders where id = p_order_id and user_id = p_user_id;
  if v_round is null then
    return null;
  end if;
  perform 1 from concierge.gift_rounds where id = v_round for update;

  select * into v_order from concierge.orders
   where id = p_order_id and user_id = p_user_id and status in ('placing', 'unconfirmed')
     for update;
  if found then
    if p_status = 'placed' then
      update concierge.orders
         set status = 'placed',
             -- When Zinc placed it, kept from the first time it was set.
             placed_at = coalesce(placed_at, now()),
             subtotal_cents = coalesce((v_price ->> 'subtotal_cents')::integer, subtotal_cents),
             shipping_cents = coalesce((v_price ->> 'shipping_cents')::integer, shipping_cents),
             tax_cents = coalesce((v_price ->> 'tax_cents')::integer, tax_cents),
             total_cents = coalesce((v_price ->> 'total_cents')::integer, total_cents),
             provider_order_id = coalesce(v_price ->> 'provider_order_id', provider_order_id),
             merchant_order_id = coalesce(v_price ->> 'merchant_order_id', merchant_order_id)
       where id = p_order_id
      returning * into v_placed;
      -- New: a card order records what the card was charged, and the fee is that
      -- minus the goods. Without Zinc's figure, it's worked out from the saved
      -- fees. With no goods total at all, the fee stays at the approved cap.
      -- Zinc's fee and the card fee are each counted once per order (the unique index),
      -- whichever of the webhook and the sweep settles it first; nothing while cost
      -- tracking is off. Above the approved maximum, the app alerts (it reads both).
      if v_placed.funding_mode = 'connect' then
        if v_placed.total_cents is not null then
          v_final := (v_price ->> 'final_charge_cents')::integer;
          v_estimated := v_final is null;
          v_final := coalesce(v_final, concierge.card_charge_cents(v_placed.total_cents, v_placed.margin_cents,
                                                                  v_placed.zinc_fee_cents, v_placed.card_fee_bps,
                                                                  v_placed.card_fee_fixed_cents));
          update concierge.orders
             set final_charge_cents = v_final,
                 fee_cents = greatest(0, v_final - v_placed.total_cents)
           where id = p_order_id;
        end if;
        if concierge.setting_int('cost_tracking_enabled') is null then
          raise exception 'settle_order: missing setting cost_tracking_enabled';
        end if;
        if concierge.setting_int('cost_tracking_enabled') = 1 then
          v_excluded := coalesce((select a.costs_excluded from concierge.accounts a where a.user_id = p_user_id), false);
          -- Zinc's fee is our saved setting, not a figure Zinc reported: estimated.
          insert into concierge.cost_events (kind, cents, estimated, excluded, order_id)
          values ('zinc_order_fee', v_placed.zinc_fee_cents, true, v_excluded, p_order_id)
          on conflict (order_id, kind) where kind in ('zinc_order_fee', 'card_fee') do nothing;
          -- The card fee needs the goods total; without it there's nothing to work it out from.
          if v_final is not null then
            insert into concierge.cost_events (kind, cents, estimated, excluded, order_id)
            values ('card_fee', greatest(0, v_final - v_placed.total_cents - v_placed.margin_cents - v_placed.zinc_fee_cents),
                    v_estimated, v_excluded, p_order_id)
            on conflict (order_id, kind) where kind in ('zinc_order_fee', 'card_fee') do nothing;
          end if;
        end if;
      end if;
    else
      perform concierge.fail_order_row(v_order, coalesce(p_failure_type, 'failed'));
    end if;
  end if;
  return concierge.reconcile_round(v_round);
end;
$$;


-- ─── begin_placing ─────────────────────────────────────────────────────────────
create or replace function concierge.begin_placing(p_round_id uuid, p_lock timestamptz, p_today date, p_orders jsonb)
returns setof concierge.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  a concierge.accounts;
  v_gate text;
  v_el jsonb;
  v_owner uuid;
  v_mode text; -- New.
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return;
  end if;
  select * into a from concierge.accounts where user_id = r.user_id for update;

  if r.locked_until is distinct from p_lock
     or r.status <> 'needs_attention'
     or r.attention_reason is null
     or r.attention_reason not in ('funds', 'setup', 'address', 'paused', 'not_allowed', 'retry')
     or not exists (select 1 from concierge.orders where round_id = p_round_id and status = 'held')
     or exists (select 1 from public.people where id = r.person_id and deleted_at is not null)
     or not exists (select 1 from concierge.occasions where id = r.occasion_id and enabled and deleted_at is null)
     or not (p_today < r.ship_by_deadline)
     or r.closed_at is not null then
    return;
  end if;

  -- The caller must name exactly the held orders, each with a cap, and every
  -- one must end up with an address snapshot.
  if jsonb_typeof(p_orders) <> 'array'
     or (select count(distinct e ->> 'id') from jsonb_array_elements(p_orders) e) <> jsonb_array_length(p_orders)
     or exists (select 1 from jsonb_array_elements(p_orders) e
                 where (e ->> 'max_price_cents') is null
                    or not exists (select 1 from concierge.orders o
                                    where o.id = (e ->> 'id')::uuid and o.round_id = p_round_id and o.status = 'held'))
     or exists (select 1 from concierge.orders o
                 where o.round_id = p_round_id and o.status = 'held'
                   and not exists (select 1 from jsonb_array_elements(p_orders) e where (e ->> 'id')::uuid = o.id))
     or exists (select 1 from jsonb_array_elements(p_orders) e
                 where jsonb_typeof(e -> 'address') is distinct from 'object'
                   and not exists (select 1 from concierge.order_addresses x where x.order_id = (e ->> 'id')::uuid)) then
    return;
  end if;

  -- A shared order ships only to the owner it was approved for, while the
  -- person still links to them (T88). Checked under the round lock, before any
  -- write, so a relink after the app's own check can't slip through; the app then
  -- ends the order as address_withdrawn. A null (missing or deleted) owner never
  -- matches. Older callers send no owner: a stored shared order is checked
  -- against the one it stored.
  v_owner := (select l.owner_id from lists.active_link(r.person_id) l);
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.orders o on o.id = (e ->> 'id')::uuid
              where (o.address_source = 'shared'
                     and (o.address_owner_id is null
                          or o.address_owner_id is distinct from v_owner
                          or (jsonb_typeof(e -> 'address') = 'object'
                              and ((e ->> 'address_source') is distinct from 'shared'
                                   or (e ? 'address_owner_id'
                                       and (e ->> 'address_owner_id') is distinct from o.address_owner_id::text)))))
                 -- Any other order may turn out to ship to a shared address read
                 -- fresh, from the owner the person links to now. Older callers
                 -- send no owner key; they get the current link's owner below, so
                 -- rolling the app back still places these. That leaves a relink
                 -- between their read and this call unseen, but only while the
                 -- older code runs: newer callers always send the key.
                 or (o.address_source is distinct from 'shared'
                     and jsonb_typeof(e -> 'address') = 'object'
                     and e ->> 'address_source' = 'shared'
                     and (v_owner is null
                          or (e ? 'address_owner_id'
                              and ((e ->> 'address_owner_id') is null
                                   or (e ->> 'address_owner_id') is distinct from v_owner::text))))) then
    return;
  end if;

  -- New: the held orders say who pays.
  v_mode := (select min(o.funding_mode) from concierge.orders o where o.round_id = p_round_id and o.status = 'held');

  -- Gates, in order: the kill switch, paid features, then setup.
  if coalesce(concierge.setting_int('zinc_ordering_enabled'), 0) <> 1 then
    v_gate := 'paused';
  -- New: a round never mixes the two (an account with held wallet orders is never
  -- switched), so a mix is a bug: fail loudly, but only while ordering is on.
  elsif (select count(distinct o.funding_mode) from concierge.orders o
          where o.round_id = p_round_id and o.status = 'held') <> 1 then
    raise exception 'begin_placing: mixed funding modes' using errcode = 'P0001';
  -- New: card payments have their own switch.
  elsif v_mode = 'connect' and coalesce(concierge.setting_int('connect_enabled'), 0) <> 1 then
    v_gate := 'paused';
  elsif not concierge.has_paid_features(r.user_id) then
    v_gate := 'not_allowed';
  elsif v_mode = 'connect' and (a.user_id is null or a.buyer_phone is null) then -- New.
    v_gate := 'setup';
  elsif v_mode = 'zinc_wallet'
        and (a.user_id is null or a.zinc_connected_at is null or a.zinc_api_key_secret_id is null or a.buyer_phone is null) then
    v_gate := 'setup';
  end if;
  if v_gate = 'paused' and v_mode = 'connect' then
    -- New: a paused card order reads paused whatever it waited on (gate_held_orders).
    update concierge.orders set hold_reason = 'paused' where round_id = p_round_id and status = 'held';
    perform concierge.reconcile_round(p_round_id);
    return;
  end if;
  if v_gate is not null then
    -- Only a reason the gate outranks is replaced: an address or funds hold
    -- keeps telling the buyer what to fix (reconcile's hold order).
    update concierge.orders
       set hold_reason = v_gate
     where round_id = p_round_id and status = 'held'
       and array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], hold_reason)
         > array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], v_gate);
    perform concierge.reconcile_round(p_round_id);
    return;
  end if;

  -- New: a card order is only sent on the card it was approved with. One whose card
  -- was removed, declined or replaced ends as card_needed, and the buyer taps Buy
  -- again; the rest of the round places on a later try.
  if v_mode = 'connect'
     and exists (select 1 from concierge.orders o
                  where o.round_id = p_round_id and o.status = 'held'
                    and o.payment_method_id is distinct from a.stripe_payment_method_id) then
    perform concierge.fail_order_row(o, 'card_needed')
       from concierge.orders o
      where o.round_id = p_round_id and o.status = 'held'
        and o.payment_method_id is distinct from a.stripe_payment_method_id;
    perform concierge.reconcile_round(p_round_id);
    return;
  end if;

  for v_el in select * from jsonb_array_elements(p_orders) loop
    if jsonb_typeof(v_el -> 'address') = 'object' then
      insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                             address_line2, city, state, zip, country, phone)
      values ((v_el ->> 'id')::uuid, r.user_id, v_el -> 'address' ->> 'recipient_first_name',
              v_el -> 'address' ->> 'recipient_last_name', v_el -> 'address' ->> 'address_line1',
              v_el -> 'address' ->> 'address_line2', v_el -> 'address' ->> 'city', v_el -> 'address' ->> 'state',
              v_el -> 'address' ->> 'zip', v_el -> 'address' ->> 'country', v_el -> 'address' ->> 'phone')
      on conflict (order_id) do update
        set recipient_first_name = excluded.recipient_first_name, recipient_last_name = excluded.recipient_last_name,
            address_line1 = excluded.address_line1, address_line2 = excluded.address_line2, city = excluded.city,
            state = excluded.state, zip = excluded.zip, country = excluded.country, phone = excluded.phone;
      -- What it's about to ship to, in the same write as the address. New: a
      -- stored shared order keeps its source and owner; any other records the
      -- owner of a shared address read fresh (checked above), or the current
      -- link's when an older caller sends none.
      update concierge.orders
         set ship_city = v_el -> 'address' ->> 'city', ship_state = v_el -> 'address' ->> 'state',
             address_source = case when address_source = 'shared' then address_source
                                   else coalesce(v_el ->> 'address_source', address_source) end,
             address_owner_id = case when address_source = 'shared' then address_owner_id
                                     when v_el ->> 'address_source' = 'shared'
                                       then coalesce((v_el ->> 'address_owner_id')::uuid, v_owner) end
       where id = (v_el ->> 'id')::uuid;
    end if;
    update concierge.orders
       set max_price_cents = least(max_price_cents, (v_el ->> 'max_price_cents')::integer),
           status = 'placing',
           hold_reason = null
     where id = (v_el ->> 'id')::uuid and round_id = p_round_id and status = 'held';
    -- New: a lower cap lowers a card order's maximum charge and fee with it, from its saved fees.
    update concierge.orders
       set max_charge_cents = concierge.card_charge_cents(max_price_cents, margin_cents, zinc_fee_cents,
                                                          card_fee_bps, card_fee_fixed_cents),
           fee_cents = concierge.card_charge_cents(max_price_cents, margin_cents, zinc_fee_cents,
                                                   card_fee_bps, card_fee_fixed_cents) - max_price_cents
     where id = (v_el ->> 'id')::uuid and round_id = p_round_id and status = 'placing' and funding_mode = 'connect';
  end loop;

  perform concierge.reconcile_round(p_round_id);
  return query
    select * from concierge.orders
     where id in (select (e ->> 'id')::uuid from jsonb_array_elements(p_orders) e) and status = 'placing';
end;
$$;


-- ─── cost_per_gift ─────────────────────────────────────────────────────────────
create or replace function concierge.cost_per_gift(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled integer := concierge.setting_int('cost_tracking_enabled');
  v_days integer;
  v_fee integer;
  v_since timestamptz;
  v_start timestamptz;
  v_result jsonb;
begin
  if v_enabled is null then
    raise exception 'cost_per_gift: missing setting cost_tracking_enabled';
  end if;
  if v_enabled = 0 then
    return null;
  end if;

  v_days := concierge.setting_int('cost_window_days');
  v_fee := concierge.setting_int('zinc_order_fee_cents');
  select (s.value #>> '{}')::timestamptz into v_since from concierge.app_settings s where s.key = 'cost_tracking_since';
  if v_days is null then
    raise exception 'cost_per_gift: missing setting cost_window_days';
  end if;
  if v_since is null then
    raise exception 'cost_per_gift: missing setting cost_tracking_since';
  end if;
  if v_fee is null then
    raise exception 'cost_per_gift: missing setting zinc_order_fee_cents';
  end if;

  v_start := greatest(p_now - make_interval(days => v_days), v_since);

  with gifts as (
    select o.placed_at
      from concierge.orders o
     where o.status in ('placed', 'shipped', 'delivered')
       and o.placed_at > v_start and o.placed_at <= p_now
       and not coalesce((select a.costs_excluded from concierge.accounts a where a.user_id = o.user_id), false)
  ),
  costs as (
    select c.kind, c.cents, c.estimated, c.excluded
      from concierge.cost_events c
     where c.created_at > v_start and c.created_at <= p_now
       and c.kind in ('ai_ideas', 'ai_capture', 'lookup_ideas', 'lookup_price_check')
  ),
  -- New: what card orders actually paid Zinc and the card company, per order.
  card_costs as (
    select c.kind, c.cents
      from concierge.cost_events c
     where c.created_at > v_start and c.created_at <= p_now and not c.excluded
       and c.kind in ('zinc_order_fee', 'card_fee')
  ),
  months as (
    select b.month, array_agg(b.vendor order by b.vendor) as vendors, sum(b.cents) as cents
      from concierge.monthly_bills b
     where (b.month::timestamp at time zone 'utc') >= v_start
       and ((b.month + interval '1 month') at time zone 'utc') <= p_now
     group by b.month
  )
  select jsonb_build_object(
    'since', to_char(v_start at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'windowDays', v_days,
    'gifts', (select count(*) from gifts),
    'aiCents', (select coalesce(sum(cents), 0) from costs where not excluded and kind in ('ai_ideas', 'ai_capture')),
    'lookupCents', (select coalesce(sum(cents), 0) from costs where not excluded and kind in ('lookup_ideas', 'lookup_price_check')),
    'aiRecords', (select count(*) from costs where not excluded and kind in ('ai_ideas', 'ai_capture')),
    'aiEstimated', (select count(*) from costs where not excluded and estimated and kind in ('ai_ideas', 'ai_capture')),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM-DD'), 'vendors', to_jsonb(m.vendors)) order by m.month)
                         from months m), '[]'::jsonb),
    'billCents', (select coalesce(sum(cents), 0) from months),
    'billGifts', (select count(*) from gifts g
                   where exists (select 1 from months m
                                  where (g.placed_at at time zone 'utc') >= m.month
                                    and (g.placed_at at time zone 'utc') < m.month + interval '1 month')),
    'orderFeeCents', v_fee,
    -- New: card gifts carry their own Zinc and card fees; orderFeeCents stays the wallet setting.
    'cardGifts', (select count(*) from card_costs where kind = 'zinc_order_fee'),
    'zincFeeCents', (select coalesce(sum(cents), 0) from card_costs where kind = 'zinc_order_fee'),
    'cardFeeCents', (select coalesce(sum(cents), 0) from card_costs where kind = 'card_fee'),
    'excludedCents', (select coalesce(sum(cents), 0) from costs where excluded))
  into v_result;

  return v_result;
end;
$$;
revoke all on function concierge.cost_per_gift(timestamptz) from public, anon, authenticated;
grant execute on function concierge.record_cost(uuid, text, numeric, boolean, uuid, uuid) to service_role;
grant execute on function concierge.cost_per_gift(timestamptz) to service_role;


-- ─── save_card: a card back from Stripe's page ────────────────────────────────
-- 'ok', 'used' (this visit already saved a card, or it's too old) or 'not_yours' (another
-- user's visit, or a customer that isn't the visit's or the account's). The app has
-- already read the visit back from Stripe; this checks it against what we stored, once,
-- under the account lock. Saving a card changes no order: nothing is bought until the
-- buyer taps Buy.
create function concierge.save_card(p_user_id uuid, p_session_id text, p_customer text, p_payment_method text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s concierge.card_sessions;
  a concierge.accounts;
  v_minutes integer := concierge.setting_int('card_session_minutes');
begin
  if v_minutes is null then
    raise exception 'save_card: missing setting card_session_minutes';
  end if;
  insert into concierge.accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into a from concierge.accounts where user_id = p_user_id for update;
  select * into s from concierge.card_sessions where stripe_session_id = p_session_id for update;
  if not found or s.user_id is distinct from p_user_id then
    return 'not_yours';
  end if;
  if s.used_at is not null or s.created_at < now() - make_interval(mins => v_minutes) then
    return 'used';
  end if;
  if p_customer is distinct from s.stripe_customer_id
     or (a.stripe_customer_id is not null and a.stripe_customer_id is distinct from p_customer)
     or p_payment_method is null then
    return 'not_yours';
  end if;
  update concierge.card_sessions set used_at = now() where id = s.id;
  update concierge.accounts
     set stripe_customer_id = p_customer, stripe_payment_method_id = p_payment_method
   where user_id = p_user_id;
  return 'ok';
end;
$$;

-- ─── start_card_session: leaving for Stripe's page ────────────────────────────
-- Saves the buyer's Stripe customer on the account the first time, under its lock, so a
-- buyer who comes back days later reuses it rather than leaving a second customer at
-- Stripe (T42). 'ok', 'other_customer' when the account already has a different one, or
-- 'not_yours' when the round, ideas or failed order aren't this buyer's.
create function concierge.start_card_session(p_user_id uuid, p_session_id text, p_customer text, p_round_id uuid,
                                             p_idea_ids uuid[], p_failed_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a concierge.accounts;
begin
  insert into concierge.accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into a from concierge.accounts where user_id = p_user_id for update;
  if a.stripe_customer_id is not null and a.stripe_customer_id is distinct from p_customer then
    return 'other_customer';
  end if;
  -- Where the buyer goes back to must be theirs: the return link is built from these.
  if (p_round_id is not null
      and not exists (select 1 from concierge.gift_rounds where id = p_round_id and user_id = p_user_id))
     or (p_failed_order_id is not null
         and not exists (select 1 from concierge.orders where id = p_failed_order_id and user_id = p_user_id
                                                         and round_id is not distinct from p_round_id))
     or exists (select 1 from unnest(coalesce(p_idea_ids, '{}')) x
                 where not exists (select 1 from concierge.gift_ideas i
                                    where i.id = x and i.user_id = p_user_id and i.round_id is not distinct from p_round_id)) then
    return 'not_yours';
  end if;
  update concierge.accounts set stripe_customer_id = p_customer where user_id = p_user_id and stripe_customer_id is null;
  insert into concierge.card_sessions (user_id, stripe_session_id, stripe_customer_id, round_id, idea_ids, failed_order_id)
  values (p_user_id, p_session_id, p_customer, p_round_id, p_idea_ids, p_failed_order_id);
  return 'ok';
end;
$$;

-- ─── remove_card: Settings > Remove ───────────────────────────────────────────
-- 'ok', or 'placing' while any order is being sent or unconfirmed, so a card isn't
-- taken away under a send. begin_placing takes the same account lock, so a send can't
-- start in between. Keeps the customer for the next card. Changes no order: waiting
-- gifts end as card_needed at their next placing try.
create function concierge.remove_card(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from concierge.accounts where user_id = p_user_id for update;
  if not found then
    return 'ok';
  end if;
  if exists (select 1 from concierge.orders
              where user_id = p_user_id and status in ('placing', 'unconfirmed')) then
    return 'placing';
  end if;
  update concierge.accounts set stripe_payment_method_id = null where user_id = p_user_id;
  return 'ok';
end;
$$;

-- ─── grants: server only ──────────────────────────────────────────────────────
revoke all on function concierge.card_charge_cents(integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function concierge.check_card_order(concierge.accounts, jsonb, text) from public, anon, authenticated;
revoke all on function concierge.save_card(uuid, text, text, text) from public, anon, authenticated;
revoke all on function concierge.start_card_session(uuid, text, text, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function concierge.card_margin_cents() from public, anon, authenticated;
revoke all on function concierge.remove_card(uuid) from public, anon, authenticated;
grant execute on function concierge.card_charge_cents(integer, integer, integer, integer, integer) to service_role;
grant execute on function concierge.check_card_order(concierge.accounts, jsonb, text) to service_role;
grant execute on function concierge.save_card(uuid, text, text, text) to service_role;
grant execute on function concierge.start_card_session(uuid, text, text, uuid, uuid[], uuid) to service_role;
grant execute on function concierge.card_margin_cents() to service_role;
grant execute on function concierge.remove_card(uuid) to service_role;
