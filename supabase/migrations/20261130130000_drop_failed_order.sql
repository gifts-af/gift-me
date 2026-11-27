-- "Pick a different gift" on a failed gift (ALL-185). Until now a failed gift
-- could only be fixed by buying (replace_failed_order), so a buyer who wanted
-- none of what the fix page offered was stuck until the ship-by day.
--
-- drop_failed_order resolves the failed order and puts the round back to
-- choosing (awaiting_approval), so every idea can be bought again and "None of
-- these" works. It runs under the round's lease, as replace_failed_order does.
--
-- Rules:
--   * Only on an open round needing attention, before the ship-by day, for a
--     failed order that isn't resolved yet.
--   * Only when that order is the round's only one still in play: no other
--     failure to fix, no gift held, being ordered or on its way. approve_round
--     and "None of these" both refuse a round with any of those, so going back
--     to choosing would help nothing; the buyer fixes each gift instead.
--   * The failed gift stays among the ideas. It can be picked again when the
--     gift itself was fine (an address or card problem). After a price rise
--     it can't: buying it again at the old price would fail the same way, and
--     the fix page's "Check today's price" is the one way to re-buy it
--     (replace_failed_order's once rule). Out of stock, too late and the rest
--     can't be bought either, as replace_failed_order already says.
--   * A list gift's claim goes back to the list, as when another idea replaces
--     it, unless it's still on another of this buyer's live orders.
--
-- Expand-only (E7): a new function; nothing existing changes.

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

  -- Back to choosing. The schedule keeps its place: reminders already sent
  -- stay sent, and the deadline still closes the round.
  update concierge.gift_rounds
     set status = 'awaiting_approval', attention_reason = null
   where id = p_round_id;
end;
$$;

-- Server only, as replace_failed_order.
revoke all on function concierge.drop_failed_order(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function concierge.drop_failed_order(uuid, uuid, timestamptz, uuid) to service_role;
