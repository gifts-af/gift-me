-- Customers are always told what happened to their purchase (owner rule,
-- ALL-32 Task 7). A failed order (price_up, out_of_stock, too_late, failed)
-- now gets an email at once, like an emailed hold: reconcile_round makes the
-- round due now while its notice, round_sends step 'fail:<n>:notice', is
-- unsent. n is round_fail_count: the round's failed orders, not counting a
-- bad address (that one is held for a new address and emailed as a hold).
-- Orders never leave 'failed', so n only grows and each new failure gets its
-- own key in round_sends (primary key round_id, step).
--
-- reconcile_round is copied from 20261109100000_zinc_wallet.sql (no later
-- migration changed it); the only change is the failure branch in step 5.
-- Expand-only (E7): same signature, same callers.

create function concierge.round_fail_count(p_round_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from concierge.orders
   where round_id = p_round_id
     and status = 'failed'
     and failure_type is distinct from 'invalid_shipping_address';
$$;

revoke all on function concierge.round_fail_count(uuid) from public, anon, authenticated;
grant execute on function concierge.round_fail_count(uuid) to service_role;

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
  if v_unconfirmed then
    v_status := 'needs_attention'; v_reason := 'unconfirmed';
  elsif v_failed is not null then
    v_status := 'needs_attention'; v_reason := v_failed;
  elsif v_held is not null then
    v_status := 'needs_attention'; v_reason := v_held;
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
  -- New in this migration: a failure's notice is unsent, so tell the buyer now.
  elsif v_reason in ('price_up', 'out_of_stock', 'too_late', 'failed')
        and not exists (select 1 from concierge.round_sends s
                         where s.round_id = p_round_id
                           and s.step = 'fail:' || concierge.round_fail_count(p_round_id) || ':notice') then
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

-- create or replace keeps the grants from 20261109100000 (service_role only).
