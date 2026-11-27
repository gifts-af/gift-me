-- A failed gift's ways out besides buying (ALL-185, T102). Until now a failed
-- gift could only be fixed by buying (replace_failed_order), so a buyer who
-- wanted none of what the fix page offered was stuck until the ship-by day.
--
-- drop_failed_order ("Pick a different gift") resolves the failed order and
-- puts the round back to choosing (awaiting_approval), so every other idea can
-- be bought and "None of these" works. skip_failed_round ("Skip") closes the
-- round through the cancel link's own close, cancel_held(round, 'cancel').
-- Both run under the round's lease, as replace_failed_order does, so a buy
-- from another tab can't land in between.
--
-- Rules:
--   * Only on an open round needing attention. Dropping also needs a failed
--     order that isn't resolved yet, before the ship-by day.
--   * Dropping only when that order is the round's only one still in play: no
--     other failure to fix, no gift held, being ordered or on its way.
--     approve_round and "None of these" both refuse a round with any of those,
--     so going back to choosing would help nothing; each gift is fixed instead.
--   * Skipping only while nothing is held, being ordered, on its way or bought
--     (a refunded order counts as bought, as in reconcile_round), so "nothing
--     will be bought" is true.
--   * The failed gift stays among the ideas. It can be picked again when the
--     gift itself was fine (an address or card problem). After a price rise
--     it can't: buying it again at the old price would fail the same way, and
--     the fix page's "Check today's price" is the one way to re-buy it
--     (replace_failed_order's once rule). Out of stock, too late and the rest
--     can't be bought either, as replace_failed_order already says.
--   * A list gift's claim goes back to the list, as when another idea replaces
--     it, unless it's still on another of this buyer's live orders.
--   * The buyer saw the failure on the page and acted on it, so neither way
--     out sends a later email about it: each records the failure's own
--     fail:<order id> key, the one claim_failure_notices writes, so
--     untold_failures skips it, the close doesn't mark it failed_after_close,
--     and rounds_missing_late_failure_email never picks it up.
--
-- Expand-only (E7): new functions; nothing existing changes.

create function concierge.drop_failed_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_failed_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_old concierge.orders;
  v_item uuid;
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'drop_failed_order: lease not held' using errcode = 'P0001';
  end if;
  -- Open, and before the ship-by deadline (the engine's UTC day), as replace_failed_order.
  if r.closed_at is not null or r.status <> 'needs_attention'
     or (now() at time zone 'utc')::date >= r.ship_by_deadline then
    raise exception 'drop_failed_order: not open' using errcode = 'P0001';
  end if;
  select * into v_old from concierge.orders
   where id = p_failed_order_id and round_id = p_round_id and user_id = p_user_id
     and status = 'failed' and not resolved
     for update;
  if not found then
    raise exception 'drop_failed_order: not current' using errcode = 'P0001';
  end if;
  -- Anything else still in play, as approve_round counts a live order.
  if exists (select 1 from concierge.orders
              where round_id = p_round_id and id <> v_old.id
                and status <> 'cancelled' and not (status = 'failed' and resolved)) then
    raise exception 'drop_failed_order: other gifts' using errcode = 'P0001';
  end if;

  -- Seen: no later email about it.
  insert into concierge.round_sends (round_id, user_id, step)
  values (p_round_id, p_user_id, 'fail:' || v_old.id)
  on conflict (round_id, step) do nothing;
  update concierge.orders set resolved = true where id = v_old.id;
  if v_old.failure_type in ('address_withdrawn', 'address_rejected', 'card_needed') then
    update concierge.gift_ideas set status = 'proposed' where id = v_old.idea_id and status = 'selected';
  end if;

  select i.list_item_id into v_item from concierge.gift_ideas i where i.id = v_old.idea_id;
  if v_item is not null
     and not exists (select 1
                       from concierge.gift_ideas i2
                       join concierge.orders o on o.idea_id = i2.id
                      where i2.user_id = p_user_id and i2.list_item_id = v_item
                        and concierge.order_is_given(o.status, o.resolved)) then
    perform lists.release_for_order(v_item, p_user_id);
  end if;

  -- Back to choosing, due now: a failure left the round waiting for its
  -- deadline, so the next tick plans the approval steps again. Reminders
  -- already sent stay sent; the latest one that came due goes out, and the
  -- deadline still closes the round.
  update concierge.gift_rounds
     set status = 'awaiting_approval', attention_reason = null, next_action_at = now()
   where id = p_round_id;
end;
$$;

-- "Skip": closes the round for good, as the cancel link does. Returns the
-- round's status after the close ('skipped').
create function concierge.skip_failed_round(p_round_id uuid, p_user_id uuid, p_lock timestamptz)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'skip_failed_round: lease not held' using errcode = 'P0001';
  end if;
  if r.closed_at is not null or r.status <> 'needs_attention' then
    raise exception 'skip_failed_round: not open' using errcode = 'P0001';
  end if;
  -- Held, being ordered, on its way or bought (refunded included, as reconcile_round counts it).
  if exists (select 1 from concierge.orders
              where round_id = p_round_id and status not in ('cancelled', 'failed')) then
    raise exception 'skip_failed_round: on its way' using errcode = 'P0001';
  end if;

  -- Seen: every failure still open here was on the page the buyer skipped from.
  insert into concierge.round_sends (round_id, user_id, step)
  select p_round_id, p_user_id, 'fail:' || o.id
    from concierge.orders o
   where o.round_id = p_round_id and o.status = 'failed' and not o.resolved
  on conflict (round_id, step) do nothing;
  return concierge.cancel_held(p_round_id, 'cancel');
end;
$$;

-- Server only, as replace_failed_order.
revoke all on function concierge.drop_failed_order(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function concierge.drop_failed_order(uuid, uuid, timestamptz, uuid) to service_role;
revoke all on function concierge.skip_failed_round(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function concierge.skip_failed_round(uuid, uuid, timestamptz) to service_role;
