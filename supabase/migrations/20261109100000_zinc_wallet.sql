-- Each user's own Zinc wallet buys their approved gifts (ALL-32, ALL-30).
-- Plan: design/plans/ALL-32-zinc-connection.md, Task 2.
--
-- One rule for round state. Every money-path function below only records
-- what happened to an ORDER, then calls reconcile_round, which works out the
-- round's status, reason, hold_count and next_action_at from the round's
-- orders under the round row lock. Nothing else sets a round's status on
-- these paths, so no two writers can race.
--
-- Lock order, everywhere: the round row first (several rounds by id), then
-- orders, then the account. Person and occasion rows are only read.
--
-- Everything here is server-only: security definer, search_path '', and
-- executable by service_role alone. Expand-only (E7): finish_round and
-- claim_round are untouched; claim_due_rounds and skip_open_rounds keep
-- their signatures.

-- ─── settings (T23) ─────────────────────────────────────────────────────────
-- zinc_ordering_enabled ships 0, so `db push` never turns ordering on.
-- supabase/seed.sql turns it on for local; dev is switched on by hand, and
-- production stays 0 until the owner's live test.

insert into concierge.app_settings (key, value, description) values
  ('order_price_margin_pct', '10', 'Percent above an idea''s estimated total that an order''s max price may reach (ALL-30, AC-15).'),
  ('funding_lookahead_days', '21', 'Days ahead the Settings look-ahead and heads-up warning count upcoming gifts (ALL-32).'),
  ('funding_topup_suggest_cents', '10000', 'The auto top-up amount the Settings guide suggests, in cents (ALL-32).'),
  ('zinc_ordering_enabled', '0', 'Kill switch for buying: 1 lets orders be sent to Zinc, 0 holds them as paused (E7, AC-17).'),
  ('zinc_timeout_ms', '15000', 'How long one Zinc API call may take before it counts as timed out.'),
  ('zinc_poll_claim_seconds', '30', 'How long one browser tab holds the Zinc connect poll before another may poll (AC-3).'),
  ('placing_stale_minutes', '30', 'Minutes an order may stay placing before the sweep looks it up at Zinc.'),
  ('zinc_place_budget_ms', '45000', 'Time one placing run may spend starting Zinc orders; later ones are retried.'),
  ('zinc_retry_attempts', '3', 'Quick retries of a Zinc call that failed with a network error or 5xx.'),
  ('zinc_retry_base_ms', '1000', 'First quick-retry delay; it doubles each time, with jitter.')
on conflict (key) do nothing;

-- ─── orders ─────────────────────────────────────────────────────────────────
-- held: approved, not yet sent to Zinc (hold_reason says why).
-- unconfirmed: sent, but Zinc can't find it; live until the owner settles it.
-- Both count as live for orders_one_live_per_idea (its predicate only leaves
-- out failed, cancelled and refunded), so a held gift can't be bought twice.

alter table concierge.orders drop constraint orders_status_check;
alter table concierge.orders add constraint orders_status_check check (status in (
  'held', 'placing', 'unconfirmed', 'placed', 'failed', 'shipped', 'delivered', 'cancelled', 'refunded'));

alter table concierge.orders
  -- HoldReason in packages/core/src/round-plan.ts.
  add column hold_reason text check (hold_reason in ('funds', 'setup', 'address', 'paused', 'not_allowed', 'retry')),
  -- A failure someone has dealt with (re-approved, replaced or expired); no longer needs attention.
  add column resolved boolean not null default false,
  add constraint orders_held_has_reason check (status <> 'held' or hold_reason is not null);

-- ─── gift_rounds ────────────────────────────────────────────────────────────

alter table concierge.gift_rounds
  -- AttentionReason in packages/core/src/round-plan.ts.
  add column attention_reason text check (attention_reason in (
    'funds', 'setup', 'address', 'paused', 'not_allowed', 'retry',
    'price_up', 'out_of_stock', 'too_late', 'failed', 'unconfirmed')),
  -- Numbers the hold emails (hold:<n>:notice), so a second hold is emailed too.
  add column hold_count integer not null default 0 check (hold_count >= 0),
  -- The emailed reason of the last hold email sent; a return to it sends no new notice.
  add column last_emailed_reason text check (last_emailed_reason in ('funds', 'setup', 'address', 'unconfirmed')),
  -- The wallet balance the last check saw, and the one the user was last emailed about.
  add column seen_balance_cents integer check (seen_balance_cents >= 0),
  add column emailed_balance_cents integer check (emailed_balance_cents >= 0);

-- ─── accounts ───────────────────────────────────────────────────────────────

alter table concierge.accounts
  -- Routes our webhook URL to the account; the HMAC is the real check.
  add column zinc_webhook_id uuid unique,
  -- Zinc needs the buyer's phone on every order (AC-8).
  add column buyer_phone text check (buyer_phone ~ '^[0-9]{10}$'),
  -- Whether the stored key is a sandbox or live key, so a live deploy never uses a test key.
  add column zinc_env text check (zinc_env in ('test', 'live'));

-- ─── what signed-in users can read ──────────────────────────────────────────
-- The new columns are server-only. Signed-in users keep reading exactly the
-- columns they could before; select is now granted column by column, so a
-- column added later is hidden until a migration grants it.

revoke select on concierge.accounts from authenticated;
grant select (user_id, over_budget_pct, notification_prefs, funding_mode, zinc_api_key_secret_id, zinc_webhook_secret_id,
              zinc_connected_at, auto_topup_on, created_at, updated_at, paid_features)
  on concierge.accounts to authenticated;

revoke select on concierge.gift_rounds from authenticated;
grant select (id, user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, late,
              next_action_at, locked_until, attempts, approved_at, created_at, updated_at, heads_up_on)
  on concierge.gift_rounds to authenticated;

revoke select on concierge.orders from authenticated;
grant select (id, user_id, round_id, idea_id, provider, provider_order_id, idempotency_key, funding_mode, max_price_cents,
              is_gift, gift_message, subtotal_cents, shipping_cents, tax_cents, total_cents, fee_cents, status, failure_type,
              merchant_order_id, packages, est_delivery_date, created_at, updated_at, ship_to, ship_city, ship_state)
  on concierge.orders to authenticated;

-- ─── connect attempts ───────────────────────────────────────────────────────
-- The pending device-code login while a user clicks Allow at Zinc (AC-2).
-- device_code is a secret: never logged or sent to the browser.

create table concierge.zinc_connect_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  device_code text not null,
  user_code text not null,
  verification_url text not null,
  interval_sec integer not null check (interval_sec > 0),
  expires_at timestamptz not null,
  -- Set by zinc_claim_poll, so only one tab calls Zinc at a time.
  polling_until timestamptz,
  created_at timestamptz not null default now()
);
alter table concierge.zinc_connect_attempts enable row level security;
revoke all on concierge.zinc_connect_attempts from public, anon, authenticated;
grant all on concierge.zinc_connect_attempts to service_role;

-- ─── list picks (T19: the lists schema owns its tables) ─────────────────────
-- A pick from the recipient's list is claimed when the buyer approves it and
-- released if the gift is cancelled or expires (AC-28, owner 2026-11-06), so
-- friends don't buy it too. for_order marks claims made this way, so a
-- release never removes a claim someone made by hand.

alter table lists.gift_claims add column for_order boolean not null default false;

create function lists.claim_for_order(p_item_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- Named the way a signed-in claimer is (lists.viewer_display_name).
  select coalesce(left(nullif(trim(p.display_name), ''), 80), nullif(trim(p.email), ''), left(nullif(trim(u.email), ''), 80))
    into v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = p_user_id;
  if v_name is null or not exists (select 1 from lists.list_items where id = p_item_id) then
    return false;
  end if;
  insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order)
  values (p_item_id, p_user_id, v_name, true)
  on conflict (item_id) do nothing;
  return found;
end;
$$;

create function lists.release_for_order(p_item_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from lists.gift_claims
     where item_id = p_item_id and claimer_id = p_user_id and for_order
    returning 1
  )
  select exists (select 1 from gone);
$$;

-- ─── reconcile_round ────────────────────────────────────────────────────────
-- How it decides (plan, "How reconcile_round decides"):
-- 1. skipped, delivered and complete never move.
-- 2. With p_context 'cancel' or 'deadline', held orders are cancelled and
--    unresolved failures resolved first; placing, unconfirmed and placed
--    orders are left alone, and released list picks are released.
-- 3. First match wins among live orders (not cancelled, not failed-and-resolved):
--    placing → ordered; unconfirmed → needs_attention/unconfirmed;
--    unresolved failed → needs_attention/<failure>; held →
--    needs_attention/<highest hold>; placed or later → ordered;
--    none → unchanged, or skipped with a context.
-- 4. hold_count goes up when an emailed reason (funds, setup, address,
--    unconfirmed) is new: not the reason last emailed, and not already the
--    round's reason.
-- 5. next_action_at: now while an emailed hold's notice is unsent; tomorrow
--    (UTC midnight, like the engine's dates) for other needs_attention; the
--    deadline for ordered; null for skipped.
-- It never touches locked_until.

create function concierge.reconcile_round(p_round_id uuid, p_context text default null)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_item uuid;
  v_status concierge.round_status;
  v_reason text;
  v_hold_count integer;
  v_next timestamptz;
  v_placing boolean;
  v_unconfirmed boolean;
  v_failed text;
  v_held text;
  v_placed boolean;
begin
  if p_context is not null and p_context not in ('cancel', 'deadline') then
    raise exception 'Unknown reconcile context %', p_context using errcode = '22023';
  end if;

  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;
  if r.status in ('skipped', 'delivered', 'complete') then
    return r.status;
  end if;

  if p_context is not null then
    update concierge.orders
       set status = 'cancelled',
           failure_type = case p_context when 'deadline' then 'held_expired' else 'cancelled' end
     where round_id = p_round_id and status = 'held';
    update concierge.orders
       set resolved = true
     where round_id = p_round_id and status = 'failed' and not resolved;
    -- List picks of this round with no live order left, here or in another
    -- of the user's rounds that picked the same list gift.
    for v_item in
      select distinct i.list_item_id
        from concierge.gift_ideas i
       where i.round_id = p_round_id
         and i.list_item_id is not null
         and not exists (
           select 1
             from concierge.gift_ideas i2
             join concierge.orders o on o.idea_id = i2.id
            where i2.user_id = r.user_id and i2.list_item_id = i.list_item_id
              and o.status <> 'cancelled' and not (o.status = 'failed' and o.resolved))
    loop
      perform lists.release_for_order(v_item, r.user_id);
    end loop;
  end if;

  select
    coalesce(bool_or(o.status = 'placing'), false),
    coalesce(bool_or(o.status = 'unconfirmed'), false),
    (array_agg(case o.failure_type when 'price_up' then 'price_up' when 'out_of_stock' then 'out_of_stock'
                                   when 'too_late' then 'too_late' else 'failed' end
               order by case o.failure_type when 'price_up' then 1 when 'out_of_stock' then 2 when 'too_late' then 3 else 4 end)
       filter (where o.status = 'failed'))[1],
    (array_agg(o.hold_reason
               order by array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], o.hold_reason))
       filter (where o.status = 'held'))[1],
    coalesce(bool_or(o.status in ('placed', 'shipped', 'delivered', 'refunded')), false)
    into v_placing, v_unconfirmed, v_failed, v_held, v_placed
    from concierge.orders o
   where o.round_id = p_round_id
     and o.status <> 'cancelled'
     and not (o.status = 'failed' and o.resolved);

  if v_placing then
    v_status := 'ordered';
  elsif v_unconfirmed then
    v_status := 'needs_attention'; v_reason := 'unconfirmed';
  elsif v_failed is not null then
    v_status := 'needs_attention'; v_reason := v_failed;
  elsif v_held is not null then
    v_status := 'needs_attention'; v_reason := v_held;
  elsif v_placed then
    v_status := 'ordered';
  elsif p_context is not null then
    v_status := 'skipped';
  else
    -- Nothing on the money path yet (or any more): leave the round as it is.
    return r.status;
  end if;

  v_hold_count := r.hold_count;
  if v_reason in ('funds', 'setup', 'address', 'unconfirmed')
     and v_reason is distinct from r.last_emailed_reason
     and not (r.status = 'needs_attention' and r.attention_reason is not distinct from v_reason) then
    v_hold_count := v_hold_count + 1;
  end if;

  if v_status = 'skipped' then
    v_next := null;
  elsif v_status = 'ordered' then
    v_next := r.ship_by_deadline::timestamp at time zone 'utc';
  elsif v_reason in ('funds', 'setup', 'address', 'unconfirmed')
        and not exists (select 1 from concierge.round_sends s
                         where s.round_id = p_round_id and s.step = 'hold:' || v_hold_count || ':notice') then
    v_next := now();
  else
    v_next := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  end if;

  update concierge.gift_rounds
     set status = v_status,
         attention_reason = v_reason,
         hold_count = v_hold_count,
         next_action_at = v_next
   where id = p_round_id;
  return v_status;
end;
$$;

-- ─── leases ─────────────────────────────────────────────────────────────────

-- Whoever claimed the lease gives it back (the engine never calls
-- finish_round after placing).
create function concierge.release_round(p_round_id uuid, p_lock timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update concierge.gift_rounds
     set locked_until = null, attempts = 0
   where id = p_round_id and locked_until = p_lock;
  return found;
end;
$$;

-- Like claim_round, for approving and placing right now: ignores
-- next_action_at, and only claims a round awaiting approval or needing attention.
create function concierge.claim_round_now(p_round_id uuid, p_now timestamptz)
returns concierge.gift_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row concierge.gift_rounds;
begin
  update concierge.gift_rounds r
     set locked_until = p_now + make_interval(mins => concierge.setting_int('round_lock_minutes')),
         attempts = r.attempts + 1
   where r.id = (
           select id from concierge.gift_rounds
            where id = p_round_id
              and status in ('awaiting_approval', 'needs_attention')
              and (locked_until is null or locked_until < p_now)
            for update skip locked
         )
  returning r.* into v_row;
  if not found then
    return null;
  end if;
  return v_row;
end;
$$;

-- Same signature as before. Held rounds (needing attention for a hold the
-- engine can retry) come first, then the earliest deadline (AC-21, AC-23).
create or replace function concierge.claim_due_rounds(p_now timestamptz)
returns setof concierge.gift_rounds
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id from concierge.gift_rounds
    where next_action_at <= p_now
      and status not in ('complete', 'skipped', 'ordered', 'delivered')
      and (locked_until is null or locked_until < p_now)
    for update skip locked
  ),
  claimed as (
    update concierge.gift_rounds r
       set locked_until = p_now + make_interval(mins => concierge.setting_int('round_lock_minutes')),
           attempts = r.attempts + 1
      from due
     where r.id = due.id
    returning r.*
  )
  select * from claimed c
   order by (c.status = 'needs_attention'
             and c.attention_reason in ('funds', 'setup', 'address', 'paused', 'not_allowed', 'retry')) desc,
            c.ship_by_deadline,
            c.next_action_at;
$$;

-- ─── approve ────────────────────────────────────────────────────────────────
-- p_orders: [{ idea_id, max_price_cents, fee_cents, gift_message?, ship_to,
--   address: { recipient_first_name, recipient_last_name, address_line1,
--              address_line2?, city, state, zip, country, phone? } }]
-- The caller computed each cap (AC-15). Orders start held for retry, so a
-- crash before placing leaves the round for the next tick (review focus 6).
-- Refusals raise P0001, so nothing is half-written.

create function concierge.approve_round(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_orders jsonb)
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
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id then
    raise exception 'approve_round: round not found' using errcode = 'P0001';
  end if;
  if r.locked_until is distinct from p_lock then
    raise exception 'approve_round: lease not held' using errcode = 'P0001';
  end if;
  if r.status <> 'awaiting_approval' then
    raise exception 'approve_round: round is %', r.status using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'approve_round: no orders' using errcode = 'P0001';
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

  for v_el in select * from jsonb_array_elements(p_orders) loop
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                  status, hold_reason, ship_to, ship_city, ship_state)
    values (p_user_id, p_round_id, (v_el ->> 'idea_id')::uuid, 'zinc_wallet', (v_el ->> 'max_price_cents')::integer,
            (v_el ->> 'fee_cents')::integer, v_el ->> 'gift_message', 'held', 'retry', v_el ->> 'ship_to',
            v_el -> 'address' ->> 'city', v_el -> 'address' ->> 'state')
    returning * into v_order;
    insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                           address_line2, city, state, zip, country, phone)
    values (v_order.id, p_user_id, v_el -> 'address' ->> 'recipient_first_name', v_el -> 'address' ->> 'recipient_last_name',
            v_el -> 'address' ->> 'address_line1', v_el -> 'address' ->> 'address_line2', v_el -> 'address' ->> 'city',
            v_el -> 'address' ->> 'state', v_el -> 'address' ->> 'zip', v_el -> 'address' ->> 'country',
            v_el -> 'address' ->> 'phone');
    update concierge.gift_ideas set status = 'selected' where id = v_order.idea_id
    returning list_item_id into v_item;
    if v_item is not null then
      perform lists.claim_for_order(v_item, p_user_id);
    end if;
    v_ids := v_ids || v_order.id;
  end loop;

  update concierge.gift_rounds set approved_at = now() where id = p_round_id;
  perform concierge.reconcile_round(p_round_id);
  return query select * from concierge.orders where id = any (v_ids);
end;
$$;

-- ─── place ──────────────────────────────────────────────────────────────────
-- The last word before any POST (AC-18, AC-21). Locks the round, then the
-- account. p_orders: [{ id, max_price_cents, address? }], one per held order:
-- the re-checked cap (never raised above the saved one) and, when refreshed,
-- the address snapshot. Returns the orders now placing, which the caller
-- then sends; returns nothing when it must not place.

create function concierge.begin_placing(p_round_id uuid, p_lock timestamptz, p_today date, p_orders jsonb)
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
     or not (p_today < r.ship_by_deadline) then
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

  -- Gates, in order: the kill switch, paid features, then setup.
  if coalesce(concierge.setting_int('zinc_ordering_enabled'), 0) <> 1 then
    v_gate := 'paused';
  elsif not concierge.has_paid_features(r.user_id) then
    v_gate := 'not_allowed';
  elsif a.user_id is null or a.zinc_connected_at is null or a.zinc_api_key_secret_id is null or a.buyer_phone is null then
    v_gate := 'setup';
  end if;
  if v_gate is not null then
    update concierge.orders set hold_reason = v_gate where round_id = p_round_id and status = 'held';
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
      update concierge.orders
         set ship_city = v_el -> 'address' ->> 'city', ship_state = v_el -> 'address' ->> 'state'
       where id = (v_el ->> 'id')::uuid;
    end if;
    update concierge.orders
       set max_price_cents = least(max_price_cents, (v_el ->> 'max_price_cents')::integer),
           status = 'placing',
           hold_reason = null
     where id = (v_el ->> 'id')::uuid and round_id = p_round_id and status = 'held';
  end loop;

  perform concierge.reconcile_round(p_round_id);
  return query
    select * from concierge.orders
     where id in (select (e ->> 'id')::uuid from jsonb_array_elements(p_orders) e) and status = 'placing';
end;
$$;

-- ─── failures ───────────────────────────────────────────────────────────────
-- Shared by record_outcomes, settle_order and fail_order. The caller holds
-- the round lock and has checked the order's status. A bad address keeps the
-- approval: the order is resolved and one held/address replacement takes its
-- place with a new key (AC-26), unless the idea already has a live order.

create function concierge.fail_order_row(p_order concierge.orders, p_failure_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
begin
  update concierge.orders
     set status = 'failed',
         failure_type = p_failure_type,
         hold_reason = null,
         resolved = (p_failure_type = 'invalid_shipping_address')
   where id = p_order.id;

  if p_failure_type = 'invalid_shipping_address'
     and not exists (select 1 from concierge.orders
                      where idea_id = p_order.idea_id and status not in ('failed', 'cancelled', 'refunded')) then
    insert into concierge.orders (user_id, round_id, idea_id, provider, funding_mode, max_price_cents, is_gift, gift_message,
                                  fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
    values (p_order.user_id, p_order.round_id, p_order.idea_id, p_order.provider, p_order.funding_mode, p_order.max_price_cents,
            p_order.is_gift, p_order.gift_message, p_order.fee_cents, 'held', 'address', p_order.ship_to, p_order.ship_city,
            p_order.ship_state)
    returning id into v_new;
    -- No address snapshot: begin_placing needs a fresh, valid one before it sends.
  end if;
end;
$$;

-- For Node's own checks on a held order, such as a gift that can no longer
-- arrive in time (too_late). Not resolved, so the round asks for attention.
create function concierge.fail_order(p_order_id uuid, p_failure_type text)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
  v_order concierge.orders;
begin
  select round_id into v_round from concierge.orders where id = p_order_id;
  if v_round is null then
    return null;
  end if;
  perform 1 from concierge.gift_rounds where id = v_round for update;
  select * into v_order from concierge.orders where id = p_order_id and status = 'held' for update;
  if found then
    perform concierge.fail_order_row(v_order, p_failure_type);
  end if;
  return concierge.reconcile_round(v_round);
end;
$$;

-- What the POSTs did (no lease needed). p_results:
-- [{ order_id, outcome: sent | insufficient | unsent | rejected | unknown,
--    provider_order_id?, available_cents?, failure_type? }]
-- Only orders still placing are touched, so a webhook that got there first wins.
create function concierge.record_outcomes(p_round_id uuid, p_results jsonb)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_el jsonb;
  v_order concierge.orders;
begin
  perform 1 from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;

  for v_el in select * from jsonb_array_elements(p_results) loop
    select * into v_order from concierge.orders
     where id = (v_el ->> 'order_id')::uuid and round_id = p_round_id and status = 'placing'
       for update;
    continue when not found;

    case v_el ->> 'outcome'
      when 'sent' then
        update concierge.orders
           set provider_order_id = coalesce(v_el ->> 'provider_order_id', provider_order_id)
         where id = v_order.id;
      when 'insufficient' then
        -- A 402 created nothing at Zinc, so a fresh key keeps a cached 402 from blocking the retry.
        update concierge.orders
           set status = 'held', hold_reason = 'funds', idempotency_key = gen_random_uuid()
         where id = v_order.id;
        if v_el ? 'available_cents' then
          update concierge.gift_rounds set seen_balance_cents = (v_el ->> 'available_cents')::integer where id = p_round_id;
        end if;
      when 'unsent' then
        -- Never POSTed, so it keeps its key.
        update concierge.orders set status = 'held', hold_reason = 'retry' where id = v_order.id;
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

-- A Zinc order event (webhook or sweep lookup). Only moves an order of this
-- user that is placing or unconfirmed, so duplicates and late events change
-- nothing (AC-14). Works whatever the round's status. p_price may carry
-- subtotal_cents, shipping_cents, tax_cents, total_cents, provider_order_id
-- and merchant_order_id. Returns the round's status, or null when no order
-- of this user matched.
create function concierge.settle_order(p_user_id uuid, p_order_id uuid, p_status text, p_failure_type text, p_price jsonb)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
  v_order concierge.orders;
  v_price jsonb := coalesce(p_price, '{}'::jsonb);
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
             subtotal_cents = coalesce((v_price ->> 'subtotal_cents')::integer, subtotal_cents),
             shipping_cents = coalesce((v_price ->> 'shipping_cents')::integer, shipping_cents),
             tax_cents = coalesce((v_price ->> 'tax_cents')::integer, tax_cents),
             total_cents = coalesce((v_price ->> 'total_cents')::integer, total_cents),
             provider_order_id = coalesce(v_price ->> 'provider_order_id', provider_order_id),
             merchant_order_id = coalesce(v_price ->> 'merchant_order_id', merchant_order_id)
       where id = p_order_id;
    else
      perform concierge.fail_order_row(v_order, coalesce(p_failure_type, 'failed'));
    end if;
  end if;
  return concierge.reconcile_round(v_round);
end;
$$;

-- Moves the round's held orders to a new reason (setup, known-short funds, address).
create function concierge.hold_orders(p_round_id uuid, p_reason text)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;
  update concierge.orders set hold_reason = p_reason where round_id = p_round_id and status = 'held';
  return concierge.reconcile_round(p_round_id);
end;
$$;

-- The sweep couldn't find a placing order at Zinc. It is never resent; the
-- owner settles it, and the customer hears "still confirming".
create function concierge.mark_unconfirmed(p_order_id uuid)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
begin
  select round_id into v_round from concierge.orders where id = p_order_id;
  if v_round is null then
    return null;
  end if;
  perform 1 from concierge.gift_rounds where id = v_round for update;
  update concierge.orders set status = 'unconfirmed' where id = p_order_id and status = 'placing';
  return concierge.reconcile_round(v_round);
end;
$$;

-- The buyer cancels a held gift ('cancel'), or the deadline passes, or the
-- person or occasion goes away ('deadline'). Never skips a round with a gift
-- on its way (AC-24, AC-25, T27).
create function concierge.cancel_held(p_round_id uuid, p_context text)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_context is null or p_context not in ('cancel', 'deadline') then
    raise exception 'cancel_held needs the cancel or deadline context' using errcode = '22023';
  end if;
  return concierge.reconcile_round(p_round_id, p_context);
end;
$$;

-- One-tap re-approve after price_up (ALL-29, AC-19). The caller checked the
-- new cap against the budget rule. Returns the replacement order.
create function concierge.reapprove_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_order_id uuid,
                                          p_max_price_cents integer)
returns setof concierge.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_old concierge.orders;
  v_new concierge.orders;
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'reapprove_order: lease not held' using errcode = 'P0001';
  end if;
  select * into v_old from concierge.orders
   where id = p_order_id and round_id = p_round_id and user_id = p_user_id
     and status = 'failed' and failure_type = 'price_up' and not resolved
     for update;
  if not found then
    raise exception 'reapprove_order: no unresolved price_up order' using errcode = 'P0001';
  end if;

  update concierge.orders set resolved = true where id = v_old.id;
  insert into concierge.orders (user_id, round_id, idea_id, provider, funding_mode, max_price_cents, is_gift, gift_message,
                                fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
  values (v_old.user_id, v_old.round_id, v_old.idea_id, v_old.provider, v_old.funding_mode, p_max_price_cents, v_old.is_gift,
          v_old.gift_message, v_old.fee_cents, 'held', 'retry', v_old.ship_to, v_old.ship_city, v_old.ship_state)
  returning * into v_new;
  insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                         address_line2, city, state, zip, country, phone)
  select v_new.id, x.user_id, x.recipient_first_name, x.recipient_last_name, x.address_line1, x.address_line2, x.city,
         x.state, x.zip, x.country, x.phone
    from concierge.order_addresses x where x.order_id = v_old.id;

  perform concierge.reconcile_round(p_round_id);
  return next v_new;
end;
$$;

-- Same signature as before; now runs each open round through the money-path
-- rule, by id, under its lock. Held orders are cancelled; a round with a gift
-- on its way becomes ordered instead of skipped. An ordered round is only
-- looked at when it still has held orders (one sent, one waiting), and is
-- otherwise left as it was. A skipped round's lease is cleared as before, so
-- an engine run that held it can't finish over the skip.
create or replace function concierge.skip_open_rounds(p_person_id uuid, p_occasion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from concierge.gift_rounds
     where (person_id = p_person_id or occasion_id = p_occasion_id)
       and (status in ('scheduled', 'generating', 'awaiting_approval', 'needs_address', 'needs_attention')
            or (status = 'ordered'
                and exists (select 1 from concierge.orders o where o.round_id = gift_rounds.id and o.status = 'held')))
     order by id
  loop
    if concierge.cancel_held(v_id, 'deadline') = 'skipped' then
      update concierge.gift_rounds set locked_until = null where id = v_id;
    end if;
  end loop;
end;
$$;

-- ─── Vault ──────────────────────────────────────────────────────────────────
-- The Zinc key and webhook secret live in Supabase Vault; the account keeps
-- only their secret ids (§6.5a, T16). Read only through these functions,
-- granted to the server (AC-6).

create function concierge.remove_zinc_secrets(p_api_key_secret_id uuid, p_webhook_secret_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where id in (p_api_key_secret_id, p_webhook_secret_id);
$$;

-- Saves a fresh connection: deletes the old secrets first.
create function concierge.zinc_store_secrets(p_user_id uuid, p_api_key text, p_webhook_secret text, p_webhook_id uuid,
                                             p_zinc_env text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a concierge.accounts;
begin
  insert into concierge.accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into a from concierge.accounts where user_id = p_user_id for update;
  perform concierge.remove_zinc_secrets(a.zinc_api_key_secret_id, a.zinc_webhook_secret_id);
  update concierge.accounts
     set zinc_api_key_secret_id = vault.create_secret(p_api_key),
         zinc_webhook_secret_id = vault.create_secret(p_webhook_secret),
         zinc_webhook_id = p_webhook_id,
         zinc_env = p_zinc_env,
         zinc_connected_at = now()
   where user_id = p_user_id;
end;
$$;

create function concierge.zinc_secrets(p_user_id uuid)
returns table (api_key text, webhook_secret text, zinc_env text, webhook_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select k.decrypted_secret, w.decrypted_secret, a.zinc_env, a.zinc_webhook_id
    from concierge.accounts a
    left join vault.decrypted_secrets k on k.id = a.zinc_api_key_secret_id
    left join vault.decrypted_secrets w on w.id = a.zinc_webhook_secret_id
   where a.user_id = p_user_id and a.zinc_api_key_secret_id is not null;
$$;

create function concierge.zinc_secret_by_webhook(p_webhook_id uuid)
returns table (user_id uuid, webhook_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, w.decrypted_secret
    from concierge.accounts a
    join vault.decrypted_secrets w on w.id = a.zinc_webhook_secret_id
   where a.zinc_webhook_id = p_webhook_id;
$$;

-- Deleting an account (or the user, by cascade) deletes its secrets (AC-7).
create function concierge.handle_account_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform concierge.remove_zinc_secrets(old.zinc_api_key_secret_id, old.zinc_webhook_secret_id);
  return old;
end;
$$;

create trigger on_account_deleted after delete on concierge.accounts
  for each row execute function concierge.handle_account_deleted();

-- Disconnect (AC-5). Refused ('placing') while any order is placing or
-- unconfirmed. Otherwise the secrets and Zinc columns go, and held orders
-- wait for setup.
create function concierge.zinc_forget(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  a concierge.accounts;
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from (select id from concierge.gift_rounds
           where user_id = p_user_id and status not in ('skipped', 'delivered', 'complete')
           order by id
             for update) locked;
  select * into a from concierge.accounts where user_id = p_user_id for update;

  if exists (select 1 from concierge.orders where user_id = p_user_id and status in ('placing', 'unconfirmed')) then
    return 'placing';
  end if;

  perform concierge.remove_zinc_secrets(a.zinc_api_key_secret_id, a.zinc_webhook_secret_id);
  update concierge.accounts
     set zinc_api_key_secret_id = null,
         zinc_webhook_secret_id = null,
         zinc_webhook_id = null,
         zinc_connected_at = null,
         zinc_env = null,
         auto_topup_on = null,
         buyer_phone = null
   where user_id = p_user_id;
  delete from concierge.zinc_connect_attempts where user_id = p_user_id;

  update concierge.orders set hold_reason = 'setup' where user_id = p_user_id and status = 'held';
  foreach v_id in array v_ids loop
    if exists (select 1 from concierge.orders where round_id = v_id and status = 'held') then
      perform concierge.reconcile_round(v_id);
    end if;
  end loop;
  return 'ok';
end;
$$;

-- ─── connect ────────────────────────────────────────────────────────────────

-- Claims the next device-token poll for zinc_poll_claim_seconds, so two tabs
-- never call Zinc at once (AC-3). Null when another poll holds it.
create function concierge.zinc_claim_poll(p_user_id uuid, p_now timestamptz)
returns concierge.zinc_connect_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row concierge.zinc_connect_attempts;
begin
  update concierge.zinc_connect_attempts
     set polling_until = p_now + make_interval(secs => concierge.setting_int('zinc_poll_claim_seconds'))
   where user_id = p_user_id and (polling_until is null or polling_until < p_now)
  returning * into v_row;
  if not found then
    return null;
  end if;
  return v_row;
end;
$$;

create function concierge.zinc_drop_attempt(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from concierge.zinc_connect_attempts where user_id = p_user_id;
$$;

-- ─── lookups and small setters ──────────────────────────────────────────────

-- Rounds the user's wallet could now place: needing attention for a hold the engine retries.
create function concierge.held_rounds_for_user(p_user_id uuid)
returns setof concierge.gift_rounds
language sql
stable
security definer
set search_path = ''
as $$
  select * from concierge.gift_rounds
   where user_id = p_user_id
     and status = 'needs_attention'
     and attention_reason in ('funds', 'setup', 'address', 'paused', 'not_allowed', 'retry')
   order by ship_by_deadline, id;
$$;

-- Our reference sent to Zinc is orders.id (metadata.order_id); the
-- idempotency key is the fallback. Never by provider_order_id alone (AC-14).
create function concierge.order_by_reference(p_user_id uuid, p_order_id uuid)
returns setof concierge.orders
language sql
stable
security definer
set search_path = ''
as $$
  select * from concierge.orders
   where user_id = p_user_id and (id = p_order_id or idempotency_key = p_order_id)
   order by (id = p_order_id) desc
   limit 1;
$$;

create function concierge.stale_placing_orders(p_now timestamptz)
returns setof concierge.orders
language sql
stable
security definer
set search_path = ''
as $$
  select * from concierge.orders
   where status = 'placing'
     and updated_at <= p_now - make_interval(mins => concierge.setting_int('placing_stale_minutes'))
   order by updated_at;
$$;

-- Open rounds due by p_until, with their held orders' caps and fees (null
-- when none), for lookaheadCents in packages/core (AC-10).
create function concierge.lookahead_rounds(p_user_id uuid, p_until date)
returns table (round_id uuid, status concierge.round_status, ship_by_deadline date, budget_cents integer, orders jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.status, r.ship_by_deadline, r.budget_cents,
         (select jsonb_agg(jsonb_build_object('max_price_cents', o.max_price_cents, 'fee_cents', o.fee_cents) order by o.id)
            from concierge.orders o where o.round_id = r.id and o.status = 'held')
    from concierge.gift_rounds r
   where r.user_id = p_user_id
     and r.ship_by_deadline <= p_until
     and r.status not in ('ordered', 'delivered', 'complete', 'skipped')
   order by r.ship_by_deadline, r.id;
$$;

create function concierge.set_seen_balance(p_round_id uuid, p_cents integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update concierge.gift_rounds set seen_balance_cents = p_cents where id = p_round_id;
$$;

create function concierge.set_emailed_balance(p_round_id uuid, p_cents integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update concierge.gift_rounds set emailed_balance_cents = p_cents where id = p_round_id;
$$;

-- Set after a hold email goes out (rule 4 of reconcile_round).
create function concierge.set_last_emailed_reason(p_round_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update concierge.gift_rounds set last_emailed_reason = p_reason where id = p_round_id;
$$;

-- ─── grants: the server only ────────────────────────────────────────────────

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'lists.claim_for_order(uuid, uuid)',
    'lists.release_for_order(uuid, uuid)',
    'concierge.reconcile_round(uuid, text)',
    'concierge.release_round(uuid, timestamptz)',
    'concierge.claim_round_now(uuid, timestamptz)',
    'concierge.claim_due_rounds(timestamptz)',
    'concierge.approve_round(uuid, uuid, timestamptz, jsonb)',
    'concierge.begin_placing(uuid, timestamptz, date, jsonb)',
    'concierge.fail_order(uuid, text)',
    'concierge.record_outcomes(uuid, jsonb)',
    'concierge.settle_order(uuid, uuid, text, text, jsonb)',
    'concierge.hold_orders(uuid, text)',
    'concierge.mark_unconfirmed(uuid)',
    'concierge.cancel_held(uuid, text)',
    'concierge.reapprove_order(uuid, uuid, timestamptz, uuid, integer)',
    'concierge.skip_open_rounds(uuid, uuid)',
    'concierge.zinc_store_secrets(uuid, text, text, uuid, text)',
    'concierge.zinc_secrets(uuid)',
    'concierge.zinc_secret_by_webhook(uuid)',
    'concierge.zinc_forget(uuid)',
    'concierge.zinc_claim_poll(uuid, timestamptz)',
    'concierge.zinc_drop_attempt(uuid)',
    'concierge.held_rounds_for_user(uuid)',
    'concierge.order_by_reference(uuid, uuid)',
    'concierge.stale_placing_orders(timestamptz)',
    'concierge.lookahead_rounds(uuid, date)',
    'concierge.set_seen_balance(uuid, integer)',
    'concierge.set_emailed_balance(uuid, integer)',
    'concierge.set_last_emailed_reason(uuid, text)'
  ]::regprocedure[] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Internal helpers: nobody calls these directly.
revoke all on function concierge.fail_order_row(concierge.orders, text) from public, anon, authenticated, service_role;
revoke all on function concierge.remove_zinc_secrets(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function concierge.handle_account_deleted() from public, anon, authenticated, service_role;
