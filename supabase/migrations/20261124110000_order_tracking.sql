-- Order tracking (ALL-33): where a bought gift is, whether it may be late, the
-- store cancelling it, and the round moving to delivered.
--
-- - Order status only moves forward: placing/unconfirmed → placed → shipped →
--   delivered. A store cancel moves placed or shipped to failed/store_cancelled.
--   Anything else (a cancel on a delivered gift, a delivered on a placed one by
--   the buyer) changes nothing. An older Zinc event can only add package numbers
--   never seen before; it changes no estimate, status or known package.
-- - Every writer here locks the round, then the order, like settle_order, so a
--   webhook and the buyer's "It arrived" tap run one after the other.
-- - reconcile_round stays the one writer of round status (T14) and learns one
--   move: ordered → delivered once every given order is delivered.
-- - A store cancel on or after the ship-by date, or on a closed round, is
--   resolved at once and told by the daily news run (cancel_late:<id>), never
--   by the "we couldn't buy it" email, because the gift was bought (T89). No
--   close hands a store cancel to that email either, whichever way it closes.
-- - A store cancel keeps Zinc's own refund amount (refund_cents), so the
--   emails say what actually came back, or no amount when Zinc didn't say.
-- - Only whitelisted package fields are stored, whatever the caller sends, and
--   tracking numbers are cleared tracking_prune_days after delivery, or after
--   the occasion for a gift never marked delivered (T42).

-- ─── settings (T23, E7) ─────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('order_tracking_enabled', '1', 'Zinc tracking, shipped, estimate and delivered events, and the buyer''s "It arrived" button. 0 logs and ignores them; store cancellations are always handled.'),
  ('zinc_tracking_fetch_enabled', '1', 'Fetch the order from Zinc (Get Order) on a tracking event to read its delivery estimate. 0 saves only what the event carries.'),
  ('late_check_enabled', '1', 'The daily late and back-on-time check and its emails. 0 turns them off; late store cancellations are still told.'),
  ('tracking_prune_days', '30', 'Days after an order is delivered (or failed, or its occasion passed without a delivery) before the daily run clears its tracking numbers. 0 or below turns the prune off; a missing value stops the prune with an error.')
on conflict (key) do nothing;

-- ─── columns ────────────────────────────────────────────────────────────────
alter table concierge.orders
  -- When Zinc placed it; the late check counts the store's own range from here.
  add column placed_at timestamptz,
  add column delivered_at timestamptz,
  -- Who said it arrived: Zinc's delivered event or the buyer's tap.
  add column delivered_by text check (delivered_by in ('zinc', 'buyer')),
  -- The newest Zinc event applied, so an older one can't bring back a stale estimate.
  add column tracking_event_at timestamptz,
  -- What Zinc refunded when the store cancelled (its refund_amount); null when it didn't say.
  add column refund_cents integer check (refund_cents >= 0);

update concierge.orders set placed_at = updated_at
 where status in ('placed', 'shipped', 'delivered') and placed_at is null;
-- Without delivered_at, an already-delivered order would never be pruned.
update concierge.orders set delivered_at = updated_at
 where status = 'delivered' and delivered_at is null;

-- Order columns are granted one by one (T56).
grant select (placed_at, delivered_at, delivered_by, refund_cents) on concierge.orders to authenticated;

-- ─── code columns ───────────────────────────────────────────────────────────
alter table concierge.orders drop constraint orders_failure_type_check;
alter table concierge.orders
  add constraint orders_failure_type_check check (failure_type in (
    'failed', 'price_up', 'out_of_stock', 'invalid_shipping_address', 'too_late',
    'address_withdrawn', 'address_rejected', 'held_expired', 'cancelled', 'round_closed',
    'store_cancelled'
  ));

alter table concierge.notifications drop constraint notifications_kind_check;
alter table concierge.notifications
  add constraint notifications_kind_check check (kind in (
    'test', 'heads_up', 'reminder', 'final_notice', 'needs_attention', 'reaction_prompt',
    'needs_address', 'skipped', 'hold_funds', 'hold_setup', 'hold_address', 'hold_trouble',
    'hold_unconfirmed', 'price_up', 'out_of_stock', 'too_late', 'missed_on_us', 'ordered',
    'failed_late', 'failed_several', 'check_your_address', 'notes_tip', 'who_is_this',
    'notes_not_read', 'notes_cant_cancel', 'no_ideas',
    'tracking_news', 'gift_late', 'gift_on_time', 'store_cancelled_late', 'delivered'
  ));

-- New: the delivered step, and late:/ontime:/cancel_late:<order id>.
alter table concierge.round_sends drop constraint round_sends_step_check;
alter table concierge.round_sends
  add constraint round_sends_step_check check (
    step ~ '^(heads_up|reminder_[12]|final_notice|skipped|address_request|address_reminder_[12]|address_final_notice|hold_trouble|missed_on_us|held_cancelled|shared_address|no_ideas|no_ideas_again|delivered)$'
    or step ~ '^(heads_up|reminder_[12]|final_notice|no_ideas|no_ideas_again)@[0-9]+$'
    or step ~ '^hold:[0-9]+:(notice|reminder|final|deadline)$'
    or step ~ '^hold:[0-9]+:short:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or step ~ '^fail:[0-9]+:notice$'
    or step ~ '^(fail|ordered|late_fail):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or step ~ '^(late|ontime|cancel_late):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- ─── settle_order: records placed_at ────────────────────────────────────────
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
             -- New: when Zinc placed it, kept from the first time it was set.
             placed_at = coalesce(placed_at, now()),
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

-- ─── release_failure_notices: never a store cancel to the late email ────────
-- Copied from 20261114100000_every_failure_told.sql; only the New line differs.
create or replace function concierge.release_failure_notices(p_round_id uuid, p_order_ids uuid[])
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
    -- New: a store cancel stays with the daily news, which tells it with the store wording.
    update concierge.orders set failed_after_close = true
     where round_id = p_round_id and id = any(p_order_ids) and status = 'failed'
       and failure_type is distinct from 'store_cancelled';
  end if;
end;
$$;

-- ─── reconcile_round: ordered → delivered ───────────────────────────────────
-- Copied from 20261114100000_every_failure_told.sql. A later migration that changes reconcile_round must copy this version, not the older one.
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
  v_delivered boolean;
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
    -- Any close (the deadline, the cancel link, skip_open_rounds) hands the
    -- failures the buyer hasn't heard about to the late email, before they're resolved.
    -- New: never a store cancel. The gift was bought and refunded, so "you haven't
    -- been charged" would be untrue; once resolved, the daily news tells it.
    update concierge.orders set failed_after_close = true
     where id in (select x from concierge.untold_failures(p_round_id) x)
       and failure_type is distinct from 'store_cancelled';
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
    coalesce(bool_or(o.status in ('placed', 'shipped', 'delivered', 'refunded')), false),
    -- New: at least one gift arrived, and every given order has.
    coalesce(bool_or(o.status = 'delivered'), false)
      and coalesce(bool_and(o.status = 'delivered') filter (where concierge.order_is_given(o.status, o.resolved)), false)
    into v_placing, v_unconfirmed, v_failed, v_held, v_placed, v_delivered
    from concierge.orders o
   where o.round_id = p_round_id
     and o.status <> 'cancelled'
     and not (o.status = 'failed' and o.resolved);

  -- Anything the customer must hear about comes before a gift on its way,
  -- so a hold next to a placing order is emailed at once (owner rule).
  -- Held before failed. Failures are told by their own keys whatever the
  -- reason, so the reason only has to drive the holds (emails and placing).
  if v_unconfirmed then
    v_status := 'needs_attention'; v_reason := 'unconfirmed';
  elsif v_held is not null then
    v_status := 'needs_attention'; v_reason := v_held;
  elsif v_failed is not null then
    v_status := 'needs_attention'; v_reason := v_failed;
  elsif v_delivered then
    v_status := 'delivered';
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

  if v_status in ('skipped', 'delivered') then
    v_next := null;
  elsif v_status = 'ordered' then
    v_next := r.ship_by_deadline::timestamp at time zone 'utc';
  elsif v_reason in ('funds', 'setup', 'address', 'unconfirmed')
        and not exists (select 1 from concierge.round_sends s
                         where s.round_id = p_round_id and s.step = 'hold:' || v_hold_count || ':notice') then
    v_next := now();
  -- An untold failure, whatever the round's reason, is told now.
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

-- ─── record_tracking ────────────────────────────────────────────────────────
-- A Zinc tracking, shipped or estimate event on a placed or shipped order.
-- Packages are merged by tracking number (added or updated, never removed); a
-- package without one is ignored. Each package keeps only carrier,
-- tracking_number, status, estimated_delivery_date and tracking_url (T42).
-- An event older than the last one applied only adds package numbers never
-- seen before: it changes no known package and no estimate, so it can't roll
-- anything back. A null estimate leaves the estimate as it is.
-- Returns the order's status after the call, or null when it isn't this user's.
create function concierge.record_tracking(p_user_id uuid, p_order_id uuid, p_shipped boolean, p_packages jsonb,
                                          p_est date, p_event_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
  v_order concierge.orders;
  v_newer boolean;
  v_status text;
  v_packages jsonb;
  v_est date;
  v_event_at timestamptz;
begin
  select round_id into v_round from concierge.orders where id = p_order_id and user_id = p_user_id;
  if v_round is null then
    return null;
  end if;
  perform 1 from concierge.gift_rounds where id = v_round for update;
  select * into v_order from concierge.orders where id = p_order_id for update;
  if v_order.status not in ('placed', 'shipped') then
    return v_order.status;
  end if;

  v_newer := v_order.tracking_event_at is null or p_event_at >= v_order.tracking_event_at;
  v_status := case when p_shipped then 'shipped' else v_order.status end;
  v_est := case when v_newer and p_est is not null then p_est else v_order.est_delivery_date end;
  v_event_at := case when v_newer then p_event_at else v_order.tracking_event_at end;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                              'carrier', m -> 'carrier',
                              'tracking_number', m -> 'tracking_number',
                              'status', m -> 'status',
                              'estimated_delivery_date', m -> 'estimated_delivery_date',
                              'tracking_url', m -> 'tracking_url'))
                            order by hn nulls last, gn), '[]'::jsonb)
    into v_packages
    from (
      -- A stale event only adds numbers never seen before.
      select coalesce(had.e, '{}'::jsonb)
               || case when v_newer or had.e is null then coalesce(got.e, '{}'::jsonb) else '{}'::jsonb end as m,
             had.n as hn, got.n as gn
        from (select e, n from jsonb_array_elements(v_order.packages) with ordinality t (e, n)) had
        full join (
          -- The last entry wins when one event names a package twice.
          select distinct on (e ->> 'tracking_number') e, n
            from jsonb_array_elements(coalesce(p_packages, '[]'::jsonb)) with ordinality t (e, n)
           where e ->> 'tracking_number' is not null
           order by e ->> 'tracking_number', n desc
        ) got on got.e ->> 'tracking_number' = had.e ->> 'tracking_number'
    ) merged;

  -- A repeated event leaves the row (and updated_at) alone.
  if (v_status, v_packages, v_est, v_event_at)
     is distinct from (v_order.status, v_order.packages, v_order.est_delivery_date, v_order.tracking_event_at) then
    update concierge.orders
       set status = v_status, packages = v_packages, est_delivery_date = v_est, tracking_event_at = v_event_at
     where id = p_order_id;
  end if;
  return v_status;
end;
$$;

-- ─── mark_delivered ─────────────────────────────────────────────────────────
-- Zinc's delivered event ('zinc', on placed or shipped) or the buyer's "It
-- arrived" tap ('buyer', shipped only: on a placed gift a mistaken tap could
-- hide a later store cancel). Anything else changes nothing. Returns the
-- round's status and whether the move applied, so the caller can log a no-op;
-- (null, false) when the order isn't this user's.
create function concierge.mark_delivered(p_user_id uuid, p_order_id uuid, p_by text)
returns table (round_status concierge.round_status, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round concierge.gift_rounds;
  v_round_id uuid;
begin
  if p_by is null or p_by not in ('zinc', 'buyer') then
    raise exception 'Unknown delivered_by %', p_by using errcode = '22023';
  end if;
  select o.round_id into v_round_id from concierge.orders o where o.id = p_order_id and o.user_id = p_user_id;
  if v_round_id is null then
    return query select null::concierge.round_status, false;
    return;
  end if;
  select * into v_round from concierge.gift_rounds where id = v_round_id for update;

  perform 1 from concierge.orders
   where id = p_order_id
     and status = any (case p_by when 'buyer' then array['shipped'] else array['placed', 'shipped'] end)
     for update;
  if not found then
    return query select v_round.status, false;
    return;
  end if;

  update concierge.orders
     set status = 'delivered', delivered_at = now(), delivered_by = p_by
   where id = p_order_id;
  return query select concierge.reconcile_round(v_round_id), true;
end;
$$;

-- ─── store_cancel_order ─────────────────────────────────────────────────────
-- Zinc's order.cancelled: the store cancelled after placing and refunded the
-- wallet. A placing or unconfirmed order means order.placed was lost, so it's
-- settled placed first. Only placed or shipped orders are cancelled; anything
-- else changes nothing.
-- Before the ship-by date on an open round, it's an ordinary failure the buyer
-- can replace. On or after it, or on a closed round, nothing can be bought in
-- time: it's resolved at once and told by the daily news, not as "we couldn't
-- buy it" (failed_after_close stays false), and the round is skipped only if
-- no given order is left.
-- p_refund_cents is Zinc's refund_amount from the event, kept for the emails;
-- null (or anything below 0) when Zinc didn't say.
-- Returns the round's status and whether the cancel applied, so the caller can
-- log a no-op; (null, false) when the order isn't this user's.
create function concierge.store_cancel_order(p_user_id uuid, p_order_id uuid, p_today date, p_refund_cents integer)
returns table (round_status concierge.round_status, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_round_id uuid;
  v_order concierge.orders;
begin
  select o.round_id into v_round_id from concierge.orders o where o.id = p_order_id and o.user_id = p_user_id;
  if v_round_id is null then
    return query select null::concierge.round_status, false;
    return;
  end if;
  select * into r from concierge.gift_rounds where id = v_round_id for update;
  select * into v_order from concierge.orders where id = p_order_id for update;

  if v_order.status in ('placing', 'unconfirmed') then
    update concierge.orders set status = 'placed', placed_at = coalesce(placed_at, now())
     where id = p_order_id
    returning * into v_order;
  end if;
  if v_order.status not in ('placed', 'shipped') then
    return query select r.status, false;
    return;
  end if;

  perform concierge.fail_order_row(v_order, 'store_cancelled');
  update concierge.orders set refund_cents = case when p_refund_cents >= 0 then p_refund_cents end
   where id = p_order_id;

  if p_today >= r.ship_by_deadline or r.closed_at is not null then
    update concierge.orders set resolved = true, failed_after_close = false where id = p_order_id;
    if not exists (select 1 from concierge.orders o
                    where o.round_id = v_round_id and concierge.order_is_given(o.status, o.resolved)) then
      return query select concierge.reconcile_round(v_round_id, 'deadline'), true;
      return;
    end if;
  end if;
  return query select concierge.reconcile_round(v_round_id), true;
end;
$$;

-- ─── delivered_rounds_untold ────────────────────────────────────────────────
-- Delivered rounds whose delivered email hasn't been recorded, for the tick's retry.
create function concierge.delivered_rounds_untold()
returns table (round_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.user_id
    from concierge.gift_rounds g
   where g.status = 'delivered'
     and not exists (select 1 from concierge.round_sends s where s.round_id = g.id and s.step = 'delivered');
$$;

-- ─── tracking_candidates ────────────────────────────────────────────────────
-- What the daily news run looks at: placed or shipped gifts whose occasion is
-- today or later (late / back on time), and store cancels resolved at once
-- that no email has told yet. A cancel told through the fix page (fail:<id>)
-- or handed to the late email (failed_after_close) is left out.
-- sent_steps are the round's keys for this order (late:, ontime:, ...).
create function concierge.tracking_candidates(p_today date)
returns table (user_id uuid, round_id uuid, order_id uuid, person_name text, occasion_kind text, occasion_date date,
               title text, status text, est_delivery_date date, placed_at timestamptz, handling_days_max integer,
               delivery_days_max integer, refund_cents integer, failure_type text, resolved boolean, sent_steps text[])
language sql
stable
security definer
set search_path = ''
as $$
  select o.user_id, o.round_id, o.id, p.name, oc.kind, g.occasion_date, i.title, o.status, o.est_delivery_date,
         o.placed_at, i.handling_days_max, i.delivery_days_max, o.refund_cents, o.failure_type, o.resolved,
         coalesce((select array_agg(s.step order by s.step) from concierge.round_sends s
                    where s.round_id = o.round_id and s.step like '%:' || o.id), '{}')
    from concierge.orders o
    join concierge.gift_rounds g on g.id = o.round_id
    join concierge.gift_ideas i on i.id = o.idea_id
    join public.people p on p.id = g.person_id
    join concierge.occasions oc on oc.id = g.occasion_id
   where (o.status in ('placed', 'shipped') and g.occasion_date >= p_today)
      or (o.status = 'failed' and o.failure_type = 'store_cancelled' and o.resolved and not o.failed_after_close
          and not exists (select 1 from concierge.round_sends s
                           where s.round_id = o.round_id and s.step in ('fail:' || o.id, 'cancel_late:' || o.id)));
$$;

-- ─── prune_tracking_numbers ─────────────────────────────────────────────────
-- Clears the packages (tracking numbers) of orders delivered, or failed, more
-- than tracking_prune_days ago, and of placed or shipped ones whose occasion is
-- that far past: Zinc's delivered event can be late or never come, and the
-- buyer may never tap "It arrived". Returns how many orders it cleared; 0 when the
-- setting is 0 or below (E7). No fallback value (T23): a missing setting fails
-- loudly instead of quietly stopping a privacy clean-up.
create function concierge.prune_tracking_numbers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := concierge.setting_int('tracking_prune_days');
  v_cleared integer;
begin
  if v_days is null then
    raise exception 'prune_tracking_numbers: missing setting';
  end if;
  if v_days <= 0 then
    return 0;
  end if;

  update concierge.orders o
     set packages = '[]'::jsonb
    from concierge.gift_rounds g
   where g.id = o.round_id
     and o.packages <> '[]'::jsonb
     and ((o.status = 'delivered' and o.delivered_at < now() - make_interval(days => v_days))
          or (o.status = 'failed' and o.failed_at < now() - make_interval(days => v_days))
          or (o.status in ('placed', 'shipped') and g.occasion_date < current_date - v_days));
  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

-- ─── grants: the server only ────────────────────────────────────────────────
revoke all on function concierge.record_tracking(uuid, uuid, boolean, jsonb, date, timestamptz) from public, anon, authenticated;
revoke all on function concierge.mark_delivered(uuid, uuid, text) from public, anon, authenticated;
revoke all on function concierge.store_cancel_order(uuid, uuid, date, integer) from public, anon, authenticated;
revoke all on function concierge.delivered_rounds_untold() from public, anon, authenticated;
revoke all on function concierge.tracking_candidates(date) from public, anon, authenticated;
revoke all on function concierge.prune_tracking_numbers() from public, anon, authenticated;
grant execute on function concierge.record_tracking(uuid, uuid, boolean, jsonb, date, timestamptz) to service_role;
grant execute on function concierge.mark_delivered(uuid, uuid, text) to service_role;
grant execute on function concierge.store_cancel_order(uuid, uuid, date, integer) to service_role;
grant execute on function concierge.delivered_rounds_untold() to service_role;
grant execute on function concierge.tracking_candidates(date) to service_role;
grant execute on function concierge.prune_tracking_numbers() to service_role;
