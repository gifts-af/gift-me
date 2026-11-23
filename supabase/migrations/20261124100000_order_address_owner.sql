-- Whose shared address an order ships to (T88, narrowing T61). An order approved to a
-- list owner's shared address records that owner's account id, and only ever ships to
-- that same owner. If the person is relinked to someone else's list, the owner is
-- missing, or their account is deleted, placing refuses and the app ends the order as
-- address_withdrawn: nothing bought, the address never sent.
--
-- address_owner_id: set only when address_source is 'shared'. Server-only, like
-- address_source: no grant. A deleted account leaves it null, which never matches.
--
-- approve_round and replace_failed_order are copied from 20261122160000_approval.sql,
-- begin_placing from 20261113100000_order_address_source.sql, and
-- shared_address_for_person from 20261101180000_list_links_follow_sharing.sql. No later
-- migration changed them. Only the lines marked New, and the ones they need, differ.
-- Same signatures, so create or replace keeps their grants (service_role only).
-- reapprove_order (unused, T81) and fail_order_row don't copy the owner: a shared order
-- they write fails closed. Expand-only (E7).

alter table concierge.orders
  add column address_owner_id uuid references auth.users (id) on delete set null,
  add constraint orders_address_owner_shared check (address_owner_id is null or address_source = 'shared');

-- Keeps the "set null" on deleting an account cheap; only shared orders have one.
create index orders_address_owner_id on concierge.orders (address_owner_id) where address_owner_id is not null;

-- ─── shared_address_for_person: the address and its owner, in one read ──────
-- Reading the owner separately would leave a window where the address is one
-- owner's and the id another's.
create or replace function public.shared_address_for_person(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recipient_first_name', a.recipient_first_name,
    'recipient_last_name', a.recipient_last_name,
    'address_line1', a.address_line1,
    'address_line2', a.address_line2,
    'city', a.city,
    'state', a.state,
    'zip', a.zip,
    'country', a.country,
    'phone', a.phone,
    'owner_id', link.owner_id -- New.
  )
    from public.people p
    cross join lists.active_link(p.id) link
    join public.account_addresses a on a.user_id = link.owner_id
   where p.id = p_person_id and p.deleted_at is null and a.share_for_gifts;
$$;

-- ─── approve_round ──────────────────────────────────────────────────────────
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
  -- Never on or after the ship-by deadline (the engine's UTC day), so a gift
  -- can't be approved into a round the deadline step is closing.
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
  -- New: a shared address only from the owner the person links to now, so the
  -- order records who the buyer chose (T88). A missing owner never matches.
  if exists (select 1
               from jsonb_array_elements(p_orders) e
              where e ->> 'address_source' = 'shared'
                and ((e ->> 'address_owner_id') is null
                     or (e ->> 'address_owner_id') is distinct from
                        (select l.owner_id::text from lists.active_link(r.person_id) l))) then
    raise exception 'approve_round: address changed' using errcode = 'P0001';
  end if;

  for v_el in select * from jsonb_array_elements(p_orders) loop
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                  status, hold_reason, ship_to, ship_city, ship_state, address_source,
                                  address_owner_id) -- New.
    values (p_user_id, p_round_id, (v_el ->> 'idea_id')::uuid, 'zinc_wallet', (v_el ->> 'max_price_cents')::integer,
            (v_el ->> 'fee_cents')::integer, v_el ->> 'gift_message', 'held', 'retry', v_el ->> 'ship_to',
            v_el -> 'address' ->> 'city', v_el -> 'address' ->> 'state',
            v_el ->> 'address_source',
            case when v_el ->> 'address_source' = 'shared' then (v_el ->> 'address_owner_id')::uuid end) -- New.
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

-- ─── replace_failed_order ───────────────────────────────────────────────────
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
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'replace_failed_order: lease not held' using errcode = 'P0001';
  end if;
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
     or (v_same and v_old.failure_type not in ('price_up', 'address_withdrawn', 'address_rejected'))
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

  -- New: a shared address only from the owner the person links to now, as
  -- approve_round (T88).
  if p_order ->> 'address_source' = 'shared'
     and ((p_order ->> 'address_owner_id') is null
          or (p_order ->> 'address_owner_id') is distinct from
             (select l.owner_id::text from lists.active_link(r.person_id) l)) then
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

  update concierge.orders set resolved = true where id = v_old.id;
  -- placeRound's cap re-check follows the new price.
  if v_same and v_old.failure_type = 'price_up' then
    update concierge.gift_ideas
       set est_total_cents = v_new_total,
           -- A round with no budget has nothing to be over.
           over_budget = coalesce(v_new_total > r.budget_cents, false)
     where id = v_idea.id;
  end if;

  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                status, hold_reason, ship_to, ship_city, ship_state, address_source,
                                address_owner_id) -- New.
  values (p_user_id, p_round_id, v_idea.id, 'zinc_wallet', (p_order ->> 'max_price_cents')::integer,
          (p_order ->> 'fee_cents')::integer, p_order ->> 'gift_message', 'held', 'retry', p_order ->> 'ship_to',
          p_order -> 'address' ->> 'city', p_order -> 'address' ->> 'state', p_order ->> 'address_source',
          case when p_order ->> 'address_source' = 'shared' then (p_order ->> 'address_owner_id')::uuid end) -- New.
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

-- ─── begin_placing ──────────────────────────────────────────────────────────
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
  v_owner uuid; -- New.
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

  -- New: a shared order ships only to the owner it was approved for, while the
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
      -- What it's about to ship to, in the same write as the address. New: a
      -- stored shared order keeps its source and owner; any other records the
      -- owner of a shared address read fresh (checked above), or the current
      -- link's when an older caller sends none.
      update concierge.orders
         set ship_city = v_el -> 'address' ->> 'city', ship_state = v_el -> 'address' ->> 'state',
             address_source = case when address_source = 'shared' then address_source -- New.
                                   else coalesce(v_el ->> 'address_source', address_source) end,
             address_owner_id = case when address_source = 'shared' then address_owner_id -- New.
                                     when v_el ->> 'address_source' = 'shared'
                                       then coalesce((v_el ->> 'address_owner_id')::uuid, v_owner) end
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
