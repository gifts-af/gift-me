-- The buying path's gates, checked in Node before any Zinc call (ALL-32 Task 6):
-- the kill switch (paused), paid features (not_allowed) and setup. A failed
-- gate holds the round's orders the same way begin_placing does under its
-- lock: only a reason the gate outranks is replaced, so an address or funds
-- hold keeps telling the buyer what to fix. hold_orders replaces every
-- reason, which is right for Node's fresh address and funds checks but not
-- for a gate checked before them.

create function concierge.gate_held_orders(p_round_id uuid, p_reason text)
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
     and array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], hold_reason)
       > array_position(array['address', 'setup', 'funds', 'not_allowed', 'paused', 'retry'], p_reason);
  return concierge.reconcile_round(p_round_id);
end;
$$;

revoke all on function concierge.gate_held_orders(uuid, text) from public, anon, authenticated;
grant execute on function concierge.gate_held_orders(uuid, text) to service_role;
