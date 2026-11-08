-- Every failed gift is told, once, and closing never hides one (ALL-116).
--
-- Before: a round's failure email was keyed by a running count (fail:<n>:notice,
-- n = round_fail_count) and named the "newest" failure by updated_at, so two
-- failures before one email, a failure next to an unconfirmed order, or a failure
-- on the ship-by day could go unmentioned or be named wrongly.
--
-- Now:
-- - Each failed order has its own key, fail:<order id>, and failed_at, set once.
-- - untold_failures(round) is the one rule for what the buyer hasn't heard yet.
--   A key written by older code (fail:<n>:notice) counts as telling every failure
--   that happened before it, so a deploy or rollback never repeats an email.
-- - claim_failure_notices / release_failure_notices take and give back those keys
--   under the round's lock, so a close (the cancel link, skip_open_rounds) can't
--   race the engine into losing or doubling one.
-- - Any close marks untold failures failed_after_close, so the late email
--   ("We couldn't buy it") tells them.
-- - reconcile_round ranks unconfirmed, then held, then failed: failures are told
--   outside the round's reason now, which only has to drive the holds.
--
-- reconcile_round is copied from 20261110100000_failure_notices.sql and
-- fail_order_row from 20261113100000_order_address_source.sql; no later migration
-- changed them. Only the lines marked New differ. Same signatures, so create or
-- replace keeps their grants (service_role only). Expand-only (E7):
-- round_fail_count stays until a later contract migration.

alter table concierge.orders add column failed_at timestamptz;
-- Older failures: when they were last touched is the closest we have. But never
-- after the round's last older-style failure email, so a round that already sent
-- one counts all its failures as told (owner, 2026-11-08: no repeats).
update concierge.orders o
   set failed_at = least(o.updated_at,
                         coalesce((select max(s.created_at) from concierge.round_sends s
                                    where s.round_id = o.round_id and s.step like 'fail:%:notice'), o.updated_at))
 where o.status = 'failed' and o.failed_at is null;
alter table concierge.orders add constraint orders_failed_at_set check (status <> 'failed' or failed_at is not null);

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
                      then 'address_rejected' else p_failure_type end;
begin
  update concierge.orders
     set status = 'failed',
         failure_type = v_type,
         hold_reason = null,
         resolved = (v_type = 'invalid_shipping_address'),
         -- New: when it failed, set once; later updates move updated_at, never this.
         -- clock_timestamp keeps two failures in one transaction in order.
         failed_at = clock_timestamp(),
         -- The round already closed, so the engine won't tell the buyer; the app does.
         failed_after_close = exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
   where id = p_order.id;

  -- A share that was withdrawn leaves nothing of the address on the order, in
  -- this same transaction (T42, decision 43).
  if v_type = 'address_withdrawn' then
    delete from concierge.order_addresses where order_id = p_order.id;
    update concierge.orders set ship_city = '', ship_state = '' where id = p_order.id;
  end if;

  if v_type = 'invalid_shipping_address'
     and not exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
     and not exists (select 1 from concierge.orders
                      where idea_id = p_order.idea_id and status not in ('failed', 'cancelled', 'refunded')) then
    insert into concierge.orders (user_id, round_id, idea_id, provider, funding_mode, max_price_cents, is_gift, gift_message,
                                  fee_cents, status, hold_reason, ship_to, ship_city, ship_state, address_source)
    values (p_order.user_id, p_order.round_id, p_order.idea_id, p_order.provider, p_order.funding_mode, p_order.max_price_cents,
            p_order.is_gift, p_order.gift_message, p_order.fee_cents, 'held', 'address', p_order.ship_to, p_order.ship_city,
            p_order.ship_state, p_order.address_source)
    returning id into v_new;
    -- No address snapshot: begin_placing needs a fresh, valid one before it sends.
  end if;
end;
$$;

-- The failures the buyer hasn't been told about while the round was open, in the
-- order they failed. Not a bad address (held for a new one instead), not one that failed after
-- the round closed (the late email tells it), and not one already resolved.
create function concierge.untold_failures(p_round_id uuid)
returns setof concierge.orders
language sql
stable
security definer
set search_path = ''
as $$
  select o.*
    from concierge.orders o
   where o.round_id = p_round_id
     and o.status = 'failed'
     and not o.resolved
     and not o.failed_after_close
     and o.failure_type is distinct from 'invalid_shipping_address'
     and not exists (
       select 1 from concierge.round_sends s
        where s.round_id = o.round_id
          and (s.step = 'fail:' || o.id
               -- Older code's key: it went out after this failed, so this one counts as told.
               or (s.step like 'fail:%:notice' and s.created_at >= o.failed_at)))
   order by o.failed_at, o.id;
$$;

-- Takes the untold failures for one email, under the round's lock: records
-- fail:<order id> for each and returns them. Nothing once the round has closed
-- (the late email tells them instead).
create function concierge.claim_failure_notices(p_round_id uuid)
returns setof concierge.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_order concierge.orders;
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.closed_at is not null then
    return;
  end if;
  for v_order in select * from concierge.untold_failures(p_round_id) loop
    insert into concierge.round_sends (round_id, user_id, step) values (p_round_id, r.user_id, 'fail:' || v_order.id);
    return next v_order;
  end loop;
end;
$$;

-- The email for claimed failures was refused: gives the keys back, under the
-- round's lock. If the round closed meanwhile, the late email tells them instead.
create function concierge.release_failure_notices(p_round_id uuid, p_order_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed boolean;
begin
  select closed_at is not null into v_closed from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return;
  end if;
  delete from concierge.round_sends
   where round_id = p_round_id and step in (select 'fail:' || x from unnest(p_order_ids) x);
  if v_closed then
    update concierge.orders set failed_after_close = true
     where round_id = p_round_id and id = any(p_order_ids) and status = 'failed';
  end if;
end;
$$;

create or replace function concierge.reconcile_round(p_round_id uuid, p_context text default null)
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
  v_ctx text;
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

  -- A closed round is always reconciled as closing: a hold that turns up
  -- after the close (it shouldn't) is cancelled, never emailed or placed.
  v_ctx := coalesce(p_context, case when r.closed_at is not null then 'closed' end);

  if v_ctx is not null then
    -- New: any close (the deadline, the cancel link, skip_open_rounds) hands the
    -- failures the buyer hasn't heard about to the late email, before they're resolved.
    update concierge.orders set failed_after_close = true
     where id in (select id from concierge.untold_failures(p_round_id));
    update concierge.orders
       set status = 'cancelled',
           failure_type = case v_ctx when 'deadline' then 'held_expired' when 'cancel' then 'cancelled' else 'round_closed' end
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

  -- Anything the customer must hear about comes before a gift on its way,
  -- so a hold next to a placing order is emailed at once (owner rule).
  -- New: held before failed. Failures are told by their own keys whatever the
  -- reason, so the reason only has to drive the holds (emails and placing).
  if v_unconfirmed then
    v_status := 'needs_attention'; v_reason := 'unconfirmed';
  elsif v_held is not null then
    v_status := 'needs_attention'; v_reason := v_held;
  elsif v_failed is not null then
    v_status := 'needs_attention'; v_reason := v_failed;
  elsif v_placing then
    v_status := 'ordered';
  elsif v_placed then
    v_status := 'ordered';
  elsif v_ctx is not null then
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
  -- New: an untold failure, whatever the round's reason, is told now.
  elsif exists (select 1 from concierge.untold_failures(p_round_id)) then
    v_next := now();
  else
    v_next := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  end if;

  update concierge.gift_rounds
     set status = v_status,
         attention_reason = v_reason,
         hold_count = v_hold_count,
         next_action_at = v_next,
         closed_at = case when p_context is not null then coalesce(closed_at, now()) else closed_at end
   where id = p_round_id;
  return v_status;
end;
$$;

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'concierge.untold_failures(uuid)',
    'concierge.claim_failure_notices(uuid)',
    'concierge.release_failure_notices(uuid, uuid[])'
  ]::regprocedure[] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
