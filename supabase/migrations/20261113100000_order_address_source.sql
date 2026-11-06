-- Orders to a list owner's shared address (ALL-112, T61). An order remembers which
-- address it was approved against. If a shared address can't be used, the order ends
-- with nothing bought: the buyer's own hidden entry is never used in its place, and
-- nothing retries by itself.
--
-- address_source: 'shared' or 'own'. Null on older orders and on anything not shipping
-- to the recipient, and null counts as own. Server-only, like hold_reason: no grant.
--
-- approve_round is copied from 20261111100000_approve_round_guards.sql, fail_order_row
-- from 20261111120000_late_failure_notice.sql, and begin_placing and reapprove_order
-- from 20261109100000_zinc_wallet.sql. No later migration changed them. Only the lines
-- marked New, and the ones they need, differ. Same signatures, so create or replace
-- keeps their grants (service_role only). Expand-only (E7).

alter table concierge.orders add column address_source text check (address_source in ('shared', 'own'));

-- The daily tick's to-do list stays cheap, as in 20261111130000_rounds_missing_late_failure_email.sql.
create index orders_address_rejected on concierge.orders (round_id) where failure_type = 'address_rejected';

insert into concierge.app_settings (key, value, description) values
  ('check_address_link_days', '30', 'How long the "check your saved address" email''s link lasts, in days.'),
  ('check_address_retry_days', '7', 'How many days to keep trying that email if it''s refused, before deleting the rejected address.')
on conflict (key) do nothing;

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
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id then
    raise exception 'approve_round: round not found' using errcode = 'P0001';
  end if;
  if r.locked_until is distinct from p_lock then
    raise exception 'approve_round: lease not held' using errcode = 'P0001';
  end if;
  if r.status <> 'awaiting_approval' or r.closed_at is not null then
    raise exception 'approve_round: round is % (closed: %)', r.status, r.closed_at is not null using errcode = 'P0001';
  end if;
  -- New (N6): never on or after the ship-by deadline (the engine's UTC day), so a
  -- gift can't be approved into a round the deadline step is closing.
  if (now() at time zone 'utc')::date >= r.ship_by_deadline then
    raise exception 'approve_round: past the ship-by deadline' using errcode = 'P0001';
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
  -- A list pick someone else already claimed isn't bought too (AC-28).
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
               join lists.gift_claims c on c.item_id = i.list_item_id
              where c.claimer_id is distinct from p_user_id) then
    raise exception 'approve_round: claimed' using errcode = 'P0001';
  end if;

  for v_el in select * from jsonb_array_elements(p_orders) loop
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                  status, hold_reason, ship_to, ship_city, ship_state, address_source)
    values (p_user_id, p_round_id, (v_el ->> 'idea_id')::uuid, 'zinc_wallet', (v_el ->> 'max_price_cents')::integer,
            (v_el ->> 'fee_cents')::integer, v_el ->> 'gift_message', 'held', 'retry', v_el ->> 'ship_to',
            v_el -> 'address' ->> 'city', v_el -> 'address' ->> 'state',
            v_el ->> 'address_source') -- New.
    returning * into v_order;
    insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1,
                                           address_line2, city, state, zip, country, phone)
    values (v_order.id, p_user_id, v_el -> 'address' ->> 'recipient_first_name', v_el -> 'address' ->> 'recipient_last_name',
            v_el -> 'address' ->> 'address_line1', v_el -> 'address' ->> 'address_line2', v_el -> 'address' ->> 'city',
            v_el -> 'address' ->> 'state', v_el -> 'address' ->> 'zip', v_el -> 'address' ->> 'country',
            v_el -> 'address' ->> 'phone');
    update concierge.gift_ideas set status = 'selected' where id = v_order.idea_id
    returning list_item_id into v_item;
    -- New (S5): a friend's claim that landed after the check above wins; the buyer's
    -- own claim (another pick or order of theirs on the same item) is fine.
    if v_item is not null
       and not lists.claim_for_order(v_item, p_user_id)
       and not exists (select 1 from lists.gift_claims c where c.item_id = v_item and c.claimer_id = p_user_id) then
      raise exception 'approve_round: claimed' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_order.id;
  end loop;

  update concierge.gift_rounds set approved_at = now() where id = p_round_id;
  perform concierge.reconcile_round(p_round_id);
  return query select * from concierge.orders where id = any (v_ids);
end;
$$;

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

  -- Gates, in order: the kill switch, paid features, then setup.
  if coalesce(concierge.setting_int('zinc_ordering_enabled'), 0) <> 1 then
    v_gate := 'paused';
  elsif not concierge.has_paid_features(r.user_id) then
    v_gate := 'not_allowed';
  elsif a.user_id is null or a.zinc_connected_at is null or a.zinc_api_key_secret_id is null or a.buyer_phone is null then
    v_gate := 'setup';
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
         set ship_city = v_el -> 'address' ->> 'city', ship_state = v_el -> 'address' ->> 'state',
             -- New: what it's about to ship to, in the same write as the address.
             address_source = coalesce(v_el ->> 'address_source', address_source)
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

create or replace function concierge.fail_order_row(p_order concierge.orders, p_failure_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid;
  -- New: a shared address Zinc rejected ends the order. Only its owner could fix it,
  -- so there's no replacement waiting on the buyer (T61).
  v_type text := case when p_failure_type = 'invalid_shipping_address' and p_order.address_source = 'shared'
                      then 'address_rejected' else p_failure_type end;
begin
  update concierge.orders
     set status = 'failed',
         failure_type = v_type,
         hold_reason = null,
         resolved = (v_type = 'invalid_shipping_address'),
         -- New: the round already closed, so the engine won't tell the buyer; the app does.
         failed_after_close = exists (select 1 from concierge.gift_rounds where id = p_order.round_id and closed_at is not null)
   where id = p_order.id;

  -- New: a share that was withdrawn leaves nothing of the address on the order, in
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

create or replace function concierge.reapprove_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_order_id uuid,
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
  if r.closed_at is not null then
    raise exception 'reapprove_order: round is closed' using errcode = 'P0001';
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
                                fee_cents, status, hold_reason, ship_to, ship_city, ship_state, address_source)
  values (v_old.user_id, v_old.round_id, v_old.idea_id, v_old.provider, v_old.funding_mode, p_max_price_cents, v_old.is_gift,
          v_old.gift_message, v_old.fee_cents, 'held', 'retry', v_old.ship_to, v_old.ship_city, v_old.ship_state,
          v_old.address_source) -- New.
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

-- ─── telling the owner, then cleaning up ────────────────────────────────────
-- The rounds with a rejected shared address still to deal with. A snapshot still
-- existing is what marks that step as not done.
create function concierge.rounds_with_rejected_addresses()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct o.round_id
    from concierge.orders o
    join concierge.order_addresses x on x.order_id = o.id
   where o.failure_type = 'address_rejected';
$$;

-- Who to ask to check their address: the account the round's person links to, only
-- while the address it shares now is the one Zinc rejected. Phone doesn't count, as
-- it isn't sent as part of the address. Null when there's no one to tell, including
-- an owner with no email.
create function concierge.shared_address_owner_to_tell(p_round_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from concierge.gift_rounds r
    join public.people p on p.id = r.person_id
    join auth.users u on u.id = p.linked_user_id and u.email is not null
    cross join lateral (
      select x.*
        from concierge.orders o
        join concierge.order_addresses x on x.order_id = o.id
       where o.round_id = r.id and o.failure_type = 'address_rejected'
       order by o.created_at desc
       limit 1
    ) x
    cross join lateral (select public.shared_address_for_person(r.person_id) as a) s
   where r.id = p_round_id
     and s.a ->> 'recipient_first_name' = x.recipient_first_name
     and s.a ->> 'recipient_last_name' = x.recipient_last_name
     and s.a ->> 'address_line1' = x.address_line1
     and (s.a ->> 'address_line2') is not distinct from x.address_line2
     and s.a ->> 'city' = x.city
     and s.a ->> 'state' = x.state
     and s.a ->> 'zip' = x.zip
     and s.a ->> 'country' = x.country;
$$;

-- Removes what's left of a rejected address once the owner step is done (T42, decision 43).
create function concierge.clear_rejected_addresses(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from concierge.order_addresses x
   using concierge.orders o
   where x.order_id = o.id and o.round_id = p_round_id and o.failure_type = 'address_rejected';
  update concierge.orders
     set ship_city = '', ship_state = ''
   where round_id = p_round_id and failure_type = 'address_rejected';
end;
$$;

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'concierge.rounds_with_rejected_addresses()',
    'concierge.shared_address_owner_to_tell(uuid)',
    'concierge.clear_rejected_addresses(uuid)'
  ]::regprocedure[] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
