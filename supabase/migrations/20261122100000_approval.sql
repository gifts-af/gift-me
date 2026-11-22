-- The approval screen (ALL-29). Expand-only (E7): a column, an index, two
-- settings and new functions (item_shared, claim_holder, order_is_given,
-- excluded_offers, replace_failed_order, runs_after_rejection,
-- reject_round_ideas, set_round_budget) are added; start_idea_run,
-- save_ideas and approve_round are re-created with the same signatures, so
-- they keep their grants (service_role only). excluded_products and
-- reapprove_order stay, unused, until a later contract migration.
--
-- Only the lines marked New, and the ones they need, differ from the copies
-- named above each function.

-- ─── gift_ideas.image_url (AC-17) ────────────────────────────────────────────
-- The product's photo, from Zinc only, https only. Signed-in owners read it
-- like every other gift_ideas column (the table has no column grants).
alter table concierge.gift_ideas
  add column image_url text check (image_url is null or image_url ~ '^https://');

-- A round offers each list gift once, so one approval can't buy it twice (AC-30).
create unique index gift_ideas_round_list_item_key on concierge.gift_ideas (round_id, list_item_id)
  where list_item_id is not null;

-- ─── settings (AC-27, AC-28) ─────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('idea_list_lookups_max', '10', 'The most Zinc lookups of the person''s list gifts in one idea run.'),
  ('idea_list_min', '3', 'With fewer list gifts than this qualifying in a run, the AI brainstorm adds ideas; with this many or more it doesn''t run.')
on conflict (key) do nothing;

-- ─── the lists product's interface to the concierge (T19) ────────────────────
-- The concierge never reads gift_claims or person_links itself; it asks these.

-- Whether a list gift is on the list the person is linked to right now
-- (lists.active_link: the link's share token is still the list's).
create function lists.item_shared(p_item_id uuid, p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from lists.active_link(p_person_id) a
      join lists.list_items i on i.list_id = a.list_id
     where i.id = p_item_id
  );
$$;

-- Who holds the claim on a list gift, as seen by p_user_id: 'none', 'mine',
-- or 'other' (anyone else, including a claim made without signing in).
create function lists.claim_holder(p_item_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when c.claimer_id = p_user_id then 'mine' else 'other' end
       from lists.gift_claims c where c.item_id = p_item_id),
    'none');
$$;

revoke all on function lists.item_shared(uuid, uuid) from public, anon, authenticated;
revoke all on function lists.claim_holder(uuid, uuid) from public, anon, authenticated;
grant execute on function lists.item_shared(uuid, uuid) to service_role;
grant execute on function lists.claim_holder(uuid, uuid) to service_role;

-- ─── order_is_given: the one "given" rule (AC-30, AC-31) ────────────────────
-- An order counts as given unless it's cancelled, refunded, or failed and
-- resolved. A failure not yet resolved may still be replaced, so it counts.
-- excluded_offers and approve_round's already_bought both use it, so the
-- engine never offers a gift that approval would refuse as already bought.
create function concierge.order_is_given(p_status text, p_resolved boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status not in ('failed', 'cancelled', 'refunded') or (p_status = 'failed' and not p_resolved);
$$;

revoke all on function concierge.order_is_given(text, boolean) from public, anon, authenticated;
grant execute on function concierge.order_is_given(text, boolean) to service_role;

-- ─── excluded_offers (AC-31) ─────────────────────────────────────────────────
-- What not to offer this person again: ideas rejected, or given
-- (order_is_given). A product is matched on retailer and product id; a list
-- gift on its list_item_id. Ideas saved before 20261117100000_idea_engine.sql
-- have no person_id, so the person is found through the round too (S9), as
-- excluded_products does.
create function concierge.excluded_offers(p_person_id uuid)
returns table (retailer text, product_id text, list_item_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.retailer, i.retailer_product_id, i.list_item_id
    from concierge.gift_ideas i
    left join concierge.gift_rounds r on r.id = i.round_id
   where coalesce(i.person_id, r.person_id) = p_person_id
     and (i.retailer_product_id is not null or i.list_item_id is not null)
     and (
       i.status = 'rejected'
       or exists (select 1 from concierge.rejections j where j.idea_id = i.id)
       or exists (select 1 from concierge.orders o
                   where o.idea_id = i.id and concierge.order_is_given(o.status, o.resolved))
     );
$$;

revoke all on function concierge.excluded_offers(uuid) from public, anon, authenticated;
grant execute on function concierge.excluded_offers(uuid) to service_role;

-- ─── start_idea_run: rejected ideas don't count (AC-12a) ─────────────────────
-- From 20261121140000_round_fanout.sql.
create or replace function concierge.start_idea_run(p_user_id uuid, p_person_id uuid, p_round_id uuid, p_now timestamptz)
returns table (run_id uuid, refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lease_ms integer := concierge.setting_int('idea_run_lease_ms');
  v_runs_max integer := concierge.setting_int('idea_round_runs_max');
  v_per_day integer;
  v_day timestamptz;
begin
  -- The limits guard AI spend: a missing setting stops the run, never allows it.
  if v_lease_ms is null or v_runs_max is null then
    raise exception 'Idea run settings are missing';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_person_id::text));

  perform 1 from public.people p
   where p.id = p_person_id and p.user_id = p_user_id and p.deleted_at is null;
  if not found then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;
  if p_round_id is not null then
    perform 1 from concierge.gift_rounds r
     where r.id = p_round_id and r.user_id = p_user_id and r.person_id = p_person_id;
    if not found then
      return query select null::uuid, 'not_found'::text;
      return;
    end if;
  end if;

  if not concierge.has_paid_features(p_user_id) then
    return query select null::uuid, 'not_paid'::text;
    return;
  end if;

  -- New: a round whose ideas were all rejected runs again.
  if p_round_id is not null
     and exists (select 1 from concierge.gift_ideas i where i.round_id = p_round_id and i.status <> 'rejected') then
    return query select null::uuid, 'done'::text;
    return;
  end if;

  if exists (
    select 1 from concierge.idea_runs u
     where u.person_id = p_person_id and u.finished_at is null
       and u.started_at > p_now - make_interval(secs => v_lease_ms / 1000.0)
  ) then
    return query select null::uuid, 'busy'::text;
    return;
  end if;

  if p_round_id is not null
     and not (select s.runs_left from concierge.round_idea_state(p_round_id) s) then
    return query select null::uuid, 'limit'::text;
    return;
  end if;

  if p_round_id is not null then
    v_per_day := concierge.setting_int('idea_round_runs_per_day');
    if v_per_day is null then
      raise exception 'Idea run settings are missing';
    end if;
    perform pg_advisory_xact_lock(hashtext('concierge.idea_round_runs_per_day'), 0);
    v_day := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
    if (select count(*) from concierge.idea_runs u
         where u.round_id is not null
           and u.started_at >= v_day and u.started_at < v_day + interval '1 day') >= v_per_day then
      return query select null::uuid, 'daily_limit'::text;
      return;
    end if;
  end if;

  insert into concierge.idea_runs (user_id, person_id, round_id, started_at)
  values (p_user_id, p_person_id, p_round_id, p_now)
  returning id into v_id;
  return query select v_id, null::text;
end;
$$;

-- ─── save_ideas: rejected ideas don't count; photos and list gifts ───────────
-- From 20261117100000_idea_engine.sql. Each element may now carry image_url,
-- source ('generated' when left out) and list_item_id; a 'list' idea without a
-- list_item_id fails gift_ideas_list_item_matches_source (23514).
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
  -- New: only ideas that aren't rejected count.
  if v_run.round_id is not null
     and exists (select 1 from concierge.gift_ideas i where i.round_id = v_run.round_id and i.status <> 'rejected') then
    return 0;
  end if;

  if v_run.round_id is null then
    delete from concierge.gift_ideas i
     where i.person_id = v_run.person_id and i.user_id = v_run.user_id and i.round_id is null;
  end if;

  insert into concierge.gift_ideas (
    user_id, person_id, round_id, source, list_item_id, image_url, status, title, retailer, product_url,
    retailer_product_id, offer_id, seller_name, first_party, price_cents, est_shipping_cents, est_tax_cents,
    est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, arrive_by, reason, over_budget, rank)
  select
    v_run.user_id, v_run.person_id, v_run.round_id,
    coalesce(r.source, 'generated'), r.list_item_id, r.image_url, -- New.
    'proposed', r.title, r.retailer, r.product_url,
    r.retailer_product_id, r.offer_id, r.seller_name, r.first_party, r.price_cents,
    coalesce(r.est_shipping_cents, 0), coalesce(r.est_tax_cents, 0), r.est_total_cents,
    r.handling_days_max, r.delivery_days_min, r.delivery_days_max, r.arrive_by, r.reason,
    coalesce(r.over_budget, false), r.rank
  from jsonb_populate_recordset(null::concierge.gift_ideas, p_ideas) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─── approve_round: replaced, not shared, already bought (AC-12b, AC-30, AC-30a)
-- From 20261113100000_order_address_source.sql. Claims are read through
-- lists.claim_holder instead of lists.gift_claims (T19, S3).
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
  -- New (AC-12b): only ideas still on offer; a rejected or selected one was
  -- replaced (an old "Buy this" link, a stale tab).
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
              where i.status <> 'proposed') then
    raise exception 'approve_round: replaced' using errcode = 'P0001';
  end if;
  -- New (AC-30a, B2): a list gift only while the round's person is still linked
  -- to the list it's on.
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
              where i.list_item_id is not null
                and not lists.item_shared(i.list_item_id, r.person_id)) then
    raise exception 'approve_round: not_shared' using errcode = 'P0001';
  end if;
  -- New (AC-30, S2): a list gift already on one of this buyer's live orders, in
  -- any round, isn't bought again: the same rule as excluded_offers (order_is_given).
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
  -- A list pick someone else already claimed isn't bought too (AC-28).
  -- New (S3): through lists.claim_holder.
  if exists (select 1
               from jsonb_array_elements(p_orders) e
               join concierge.gift_ideas i on i.id = (e ->> 'idea_id')::uuid
              where i.list_item_id is not null
                and lists.claim_holder(i.list_item_id, p_user_id) = 'other') then
    raise exception 'approve_round: claimed' using errcode = 'P0001';
  end if;

  for v_el in select * from jsonb_array_elements(p_orders) loop
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                  status, hold_reason, ship_to, ship_city, ship_state, address_source)
    values (p_user_id, p_round_id, (v_el ->> 'idea_id')::uuid, 'zinc_wallet', (v_el ->> 'max_price_cents')::integer,
            (v_el ->> 'fee_cents')::integer, v_el ->> 'gift_message', 'held', 'retry', v_el ->> 'ship_to',
            v_el -> 'address' ->> 'city', v_el -> 'address' ->> 'state',
            v_el ->> 'address_source')
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
    -- New (S3): through lists.claim_holder.
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

-- ─── replace_failed_order (AC-14, AC-15, AC-15a, AC-12b, AC-30) ──────────────
-- Replaces one unresolved failed order, under the round lease, in one
-- transaction: the failure is resolved and a held order (hold_reason 'retry')
-- takes its place, for placeRound to send. p_order is an approve_round element
-- (idea_id, max_price_cents, fee_cents, gift_message, ship_to, address_source,
-- address) plus new_total_cents for a price-up re-buy. The idea is a proposed
-- one, or the failed order's own after a price rise (once, S2) or an address
-- failure (to a fixed address, B2). The caller checked the cap against the
-- budget (approveAndBuy's rule). reapprove_order stays, unused, until a later
-- contract migration (E7).
create function concierge.replace_failed_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz,
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

  -- Only an idea still on offer (AC-12b), or the failed order's own one when
  -- the gift itself was fine: a price rise or an address failure.
  select * into v_idea from concierge.gift_ideas
   where id = (p_order ->> 'idea_id')::uuid and round_id = p_round_id and user_id = p_user_id;
  v_found := found;
  v_same := v_found and v_idea.id = v_old.idea_id;
  if not v_found
     or (v_same and v_old.failure_type not in ('price_up', 'address_withdrawn', 'address_rejected'))
     or (not v_same and v_idea.status <> 'proposed') then
    raise exception 'replace_failed_order: replaced' using errcode = 'P0001';
  end if;

  -- A price-up re-buy, once per gift (S2), at the price the buyer saw.
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
  -- re-read from the recipient (AC-15a, B2).
  if v_old.failure_type in ('address_withdrawn', 'address_rejected')
     and not coalesce(p_order ->> 'ship_to' in ('buyer', 'other') and p_order ->> 'address_source' = 'own', false) then
    raise exception 'replace_failed_order: fixed address' using errcode = 'P0001';
  end if;

  -- The list checks, as approve_round's (AC-30, AC-30a), through the lists
  -- product's functions (T19).
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
  -- placeRound's cap re-check follows the new price (B1).
  if v_same and v_old.failure_type = 'price_up' then
    update concierge.gift_ideas
       set est_total_cents = v_new_total,
           over_budget = v_new_total > r.budget_cents
     where id = v_idea.id;
  end if;

  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message,
                                status, hold_reason, ship_to, ship_city, ship_state, address_source)
  values (p_user_id, p_round_id, v_idea.id, 'zinc_wallet', (p_order ->> 'max_price_cents')::integer,
          (p_order ->> 'fee_cents')::integer, p_order ->> 'gift_message', 'held', 'retry', p_order ->> 'ship_to',
          p_order -> 'address' ->> 'city', p_order -> 'address' ->> 'state', p_order ->> 'address_source')
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
  -- reconcile_round guards its release (AC-30).
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

revoke all on function concierge.replace_failed_order(uuid, uuid, timestamptz, uuid, jsonb) from public, anon, authenticated;
grant execute on function concierge.replace_failed_order(uuid, uuid, timestamptz, uuid, jsonb) to service_role;

-- ─── runs_after_rejection: whether "None of these" brings new ideas (AC-13a) ──
-- For the sheet, before the buyer confirms: round_idea_state's runs rule, with
-- each fact in p_facts ({category, value}) counted as newer than the last run
-- only if it would end up active: a new fact, or an existing one that's on. A
-- duplicate of a turned-off fact stays off, so it doesn't count (B3). False
-- too when the next tick (p_now's UTC day plus one, T49) isn't before the
-- ship-by day, so new ideas couldn't be bought in time (S1). A missing
-- setting answers false (round_idea_state). With no facts it's exactly the
-- rule reject_round_ideas checks after saving its facts.
create function concierge.runs_after_rejection(p_round_id uuid, p_facts jsonb, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (p_now at time zone 'utc')::date + 1 < r.ship_by_deadline
       and (s.runs_left
            or (n.runs = concierge.setting_int('idea_round_runs_max')
                and n.last_started < p_now
                and exists (
                  select 1
                    from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) e
                   where not exists (
                     select 1 from concierge.profile_facts f
                      where f.person_id = r.person_id
                        and f.category = e ->> 'category'
                        -- profile_facts.value_key's expression.
                        and f.value_key = lower(regexp_replace(btrim(e ->> 'value'), '\s+', ' ', 'g'))
                        and not f.active))))
      from concierge.gift_rounds r
      cross join lateral concierge.round_idea_state(r.id) s
      cross join lateral (
        select count(*) as runs, max(u.started_at) as last_started
          from concierge.idea_runs u where u.round_id = r.id
      ) n
     where r.id = p_round_id), false);
$$;

revoke all on function concierge.runs_after_rejection(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function concierge.runs_after_rejection(uuid, jsonb, timestamptz) to service_role;

-- ─── reject_round_ideas: "None of these" (AC-12, AC-13, AC-13a) ──────────────
-- Under the round lease, for a round awaiting approval with no live order.
-- The facts ({category, value}, owns or avoid) are saved first with source
-- 'rejection'; one that already exists keeps its active flag and has its
-- updated_at bumped, so it counts as new for the extra run. Then the runs
-- rule is read again in this transaction: if it no longer matches what the
-- sheet showed (p_expect_more), 'changed' rolls everything back (B3).
--   A search left: a rejections row per idea still on offer (proposed, or
--   selected with its order cancelled or resolved), those ideas rejected, the
--   round's sent approval emails renamed to <step>@<n> so the new ideas get
--   their own (S5), and the round back to generating, due now.
--   None left: one rejections row with no idea; the ideas stay buyable and
--   the round stays awaiting approval (decision b).
create function concierge.reject_round_ideas(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_reason_code text,
                                             p_reason_text text, p_facts jsonb, p_expect_more boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_facts jsonb := coalesce(p_facts, '[]'::jsonb);
  v_n integer;
  v_steps constant text[] := array['heads_up', 'reminder_1', 'reminder_2', 'final_notice', 'no_ideas', 'no_ideas_again'];
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'reject_round_ideas: lease not held' using errcode = 'P0001';
  end if;
  if r.status <> 'awaiting_approval' or r.closed_at is not null then
    raise exception 'reject_round_ideas: not open' using errcode = 'P0001';
  end if;
  -- A live order, as approve_round counts one.
  if exists (select 1 from concierge.orders
              where round_id = p_round_id and status <> 'cancelled' and not (status = 'failed' and resolved)) then
    raise exception 'reject_round_ideas: live order' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code not in ('has_it', 'not_style', 'too_pricey', 'too_generic') then
    raise exception 'reject_round_ideas: unknown reason' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_facts) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_facts) e
                 where (e ->> 'category') is null or (e ->> 'category') not in ('owns', 'avoid')) then
    raise exception 'reject_round_ideas: fact category' using errcode = 'P0001';
  end if;

  -- The 500-character limit is profile_facts' own check (23514).
  insert into concierge.profile_facts (user_id, person_id, category, value, source)
  select r.user_id, r.person_id, e ->> 'category', e ->> 'value', 'rejection'
    from jsonb_array_elements(v_facts) e
  on conflict (person_id, category, value_key) do update set updated_at = now();

  if concierge.runs_after_rejection(p_round_id, '[]'::jsonb, now()) is distinct from p_expect_more then
    raise exception 'reject_round_ideas: changed' using errcode = 'P0001';
  end if;

  if not p_expect_more then
    insert into concierge.rejections (user_id, round_id, idea_id, reason_code, reason_text)
    values (r.user_id, p_round_id, null, p_reason_code, p_reason_text);
    return;
  end if;

  -- No live order is left (checked above), so every idea still on offer goes.
  insert into concierge.rejections (user_id, round_id, idea_id, reason_code, reason_text)
  select r.user_id, p_round_id, i.id, p_reason_code, p_reason_text
    from concierge.gift_ideas i
   where i.round_id = p_round_id and i.status in ('proposed', 'selected');
  update concierge.gift_ideas set status = 'rejected'
   where round_id = p_round_id and status in ('proposed', 'selected');

  -- The next free <n>: one more than any earlier rename of these steps.
  select coalesce(max(split_part(s.step, '@', 2)::integer), 0) + 1 into v_n
    from concierge.round_sends s
   where s.round_id = p_round_id
     and split_part(s.step, '@', 1) = any (v_steps)
     and s.step ~ '@[0-9]+$';
  update concierge.round_sends
     set step = step || '@' || v_n
   where round_id = p_round_id and step = any (v_steps);

  update concierge.gift_rounds
     set status = 'generating', next_action_at = now()
   where id = p_round_id;
end;
$$;

revoke all on function concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean) to service_role;

-- ─── set_round_budget: an open round's budget (AC-9) ─────────────────────────
-- Under the round lease, for a round awaiting approval that has no budget yet
-- (revises T73's "a round copies its budget when it starts" for this case).
-- The caller saves the person's budget too (save_budgets). Each idea still on
-- offer is marked over the new budget or not.
create function concierge.set_round_budget(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_budget_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'set_round_budget: lease not held' using errcode = 'P0001';
  end if;
  if r.status <> 'awaiting_approval' or r.closed_at is not null then
    raise exception 'set_round_budget: not open' using errcode = 'P0001';
  end if;
  if r.budget_cents is not null then
    raise exception 'set_round_budget: already set' using errcode = 'P0001';
  end if;
  if p_budget_cents is null or p_budget_cents < 0 then
    raise exception 'set_round_budget: negative' using errcode = 'P0001';
  end if;

  update concierge.gift_rounds set budget_cents = p_budget_cents where id = p_round_id;
  update concierge.gift_ideas
     set over_budget = est_total_cents > p_budget_cents
   where round_id = p_round_id and status = 'proposed';
end;
$$;

revoke all on function concierge.set_round_budget(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function concierge.set_round_budget(uuid, uuid, timestamptz, integer) to service_role;
