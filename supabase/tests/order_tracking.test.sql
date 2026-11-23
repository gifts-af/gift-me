-- Order tracking: order moves only go forward, store cancels, the delivered
-- round, the news candidates and the tracking-number prune (ALL-33).
begin;
\ir _helpers.psql
select plan(27);

select tests.create_user('tracking@example.com') as u \gset
select tests.create_user('tracking-other@example.com') as u2 \gset
insert into public.people (user_id, name, relationship) values (:'u', 'Sam', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset

-- A round with one order per status given. Ship-by is p_ship_in days from
-- today, the occasion a week after that.
create function tests.ot_round(p_user uuid, p_person uuid, p_occasion uuid, p_year integer, p_ship_in integer,
                               p_statuses text[])
returns uuid language plpgsql as $$
declare
  v_round uuid;
  v_idea uuid;
begin
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at)
  values (p_user, p_person, p_occasion, p_year, current_date + p_ship_in + 7, current_date + p_ship_in, 9000, 'ordered',
          (current_date + p_ship_in)::timestamp at time zone 'utc')
  returning id into v_round;
  for i in 1..array_length(p_statuses, 1) loop
    insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, handling_days_max, delivery_days_max)
    values (p_user, v_round, 'Gift ' || i, 4000, 4500, i, 2, 5) returning id into v_idea;
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
    values (p_user, v_round, v_idea, 'zinc_wallet', 4500, 100, p_statuses[i], 'recipient', 'Dayton', 'OH');
  end loop;
  return v_round;
end;
$$;
create function tests.ot_order(p_round uuid, p_rank integer) returns uuid language sql as $$
  select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
   where o.round_id = p_round and i.rank = p_rank;
$$;
grant execute on all functions in schema tests to service_role;

select tests.act_as_server();

-- ─── record_tracking ────────────────────────────────────────────────────────
select tests.ot_round(:'u', :'p', :'o', 2030, 20, array['placed']) as r1 \gset
select tests.ot_order(:'r1', 1) as o1 \gset
select now() - interval '1 hour' as t1 \gset

select concierge.record_tracking(:'u', :'o1', true, '[{"tracking_number":"1Z1","carrier":"UPS","status":"in_transit"}]',
                                 current_date + 10, :'t1') as rt \gset
select ok(:'rt' = 'shipped' and (select status = 'shipped'
                                        and packages = '[{"tracking_number":"1Z1","carrier":"UPS","status":"in_transit"}]'::jsonb
                                        and est_delivery_date = current_date + 10
                                        and tracking_event_at = :'t1'::timestamptz
                                   from concierge.orders where id = :'o1'),
  'record_tracking placed → shipped saves packages and estimate');

select row_to_json(x)::text as before1 from (select status, packages, est_delivery_date, tracking_event_at, updated_at
                                                from concierge.orders where id = :'o1') x \gset
select concierge.record_tracking(:'u', :'o1', true, '[{"tracking_number":"1Z1","carrier":"UPS","status":"in_transit"}]',
                                 current_date + 10, :'t1') as rt2 \gset
select ok(:'rt2' = 'shipped' and (select row_to_json(x)::text = :'before1'
                                    from (select status, packages, est_delivery_date, tracking_event_at, updated_at
                                            from concierge.orders where id = :'o1') x),
  'record_tracking twice in one transaction is a no-op the second time');

select tests.ot_round(:'u', :'p', :'o', 2031, 20, array['delivered', 'failed', 'cancelled']) as r2 \gset
select bool_and(concierge.record_tracking(:'u', o.id, true, '[{"tracking_number":"9"}]', current_date, now()) = o.status) as same2
  from concierge.orders o where o.round_id = :'r2' \gset
select ok(:'same2'::boolean
      and (select bool_and(packages = '[]'::jsonb and est_delivery_date is null and tracking_event_at is null)
             from concierge.orders where round_id = :'r2')
      and (select array_agg(status order by status) from concierge.orders where round_id = :'r2')
          = array['cancelled', 'delivered', 'failed'],
  'record_tracking on delivered/failed/cancelled changes nothing');

select is(concierge.record_tracking(:'u2', :'o1', true, '[]', current_date, now()), null,
  'record_tracking for another user''s order returns null');

-- ─── mark_delivered ─────────────────────────────────────────────────────────
select tests.ot_round(:'u', :'p', :'o', 2032, 20, array['placed']) as r3 \gset
select tests.ot_order(:'r3', 1) as o3 \gset

select concierge.mark_delivered(:'u', :'o3', 'buyer') as md3 \gset
select ok(:'md3' = 'ordered'
      and (select status = 'placed' and delivered_at is null from concierge.orders where id = :'o3'),
  'mark_delivered by buyer refused on placed');

select concierge.mark_delivered(:'u', :'o3', 'zinc') as md \gset
select ok((select status = 'delivered' and delivered_by = 'zinc' and delivered_at = now() from concierge.orders where id = :'o3'),
  'mark_delivered by zinc on placed sets delivered');

select ok(:'md' = 'delivered' and (select status = 'delivered' and next_action_at is null from concierge.gift_rounds where id = :'r3'),
  'last given order delivered moves round to delivered');

select tests.ot_round(:'u', :'p', :'o', 2033, 20, array['shipped', 'shipped']) as r4 \gset
-- Each call goes in its own statement: a check in the same statement can't see its writes.
select concierge.mark_delivered(:'u', tests.ot_order(:'r4', 1), 'buyer') as md4 \gset
select ok(:'md4' = 'ordered'
      and (select status = 'delivered' and delivered_by = 'buyer' from concierge.orders where id = tests.ot_order(:'r4', 1)),
  'one of two delivered keeps round ordered');

-- ─── store_cancel_order ─────────────────────────────────────────────────────
select tests.ot_round(:'u', :'p', :'o', 2034, 20, array['placed']) as r5 \gset
select tests.ot_order(:'r5', 1) as o5 \gset
select concierge.store_cancel_order(:'u', :'o5', current_date) as sc5 \gset
select ok(:'sc5' = 'needs_attention'
      and (select status = 'failed' and failure_type = 'store_cancelled' and not resolved and failed_at is not null
             from concierge.orders where id = :'o5'),
  'store_cancel_order before ship-by → needs_attention, unresolved');

-- Ship-by is today.
select tests.ot_round(:'u', :'p', :'o', 2035, 0, array['placed', 'shipped']) as r6 \gset
select tests.ot_order(:'r6', 1) as o6 \gset
select concierge.store_cancel_order(:'u', :'o6', current_date) as sc6 \gset
select ok(:'sc6' = 'ordered'
      and (select status = 'failed' and failure_type = 'store_cancelled' and resolved and not failed_after_close
             from concierge.orders where id = :'o6'),
  'store_cancel_order after ship-by with another given order → ordered, resolved');

select tests.ot_round(:'u', :'p', :'o', 2036, 0, array['shipped']) as r7 \gset
select tests.ot_order(:'r7', 1) as o7 \gset
select concierge.store_cancel_order(:'u', :'o7', current_date) as sc7 \gset
select ok(:'sc7' = 'skipped'
      and (select resolved and not failed_after_close from concierge.orders where id = :'o7')
      and (select status = 'skipped' and closed_at is not null from concierge.gift_rounds where id = :'r7'),
  'store_cancel_order after ship-by, only gift → skipped, resolved, closed_at set');

select tests.ot_round(:'u', :'p', :'o', 2037, 20, array['delivered', 'placed']) as r8 \gset
select concierge.store_cancel_order(:'u', tests.ot_order(:'r8', 1), current_date) as sc8 \gset
select ok(:'sc8' = 'ordered'
      and (select status = 'delivered' and failure_type is null from concierge.orders where id = tests.ot_order(:'r8', 1)),
  'store_cancel_order on a delivered order changes nothing');

select ok((select not concierge.order_is_given(status, resolved) from concierge.orders where id = :'o6'),
  'a resolved store_cancelled order is not given');

-- ─── settle_order ───────────────────────────────────────────────────────────
select tests.ot_round(:'u', :'p', :'o', 2038, 20, array['placing']) as r9 \gset
select tests.ot_order(:'r9', 1) as o9 \gset
select concierge.settle_order(:'u', :'o9', 'placed', null, null);
select placed_at = now() as first_set from concierge.orders where id = :'o9' \gset
update concierge.orders set status = 'unconfirmed', placed_at = '2030-01-01 00:00:00+00' where id = :'o9';
select concierge.settle_order(:'u', :'o9', 'placed', null, null);
select ok(:'first_set'::boolean and (select placed_at = '2030-01-01 00:00:00+00' from concierge.orders where id = :'o9'),
  'settle_order placed sets placed_at once');

-- ─── more record_tracking ───────────────────────────────────────────────────
select concierge.record_tracking(:'u', :'o1', false,
  '[{"tracking_number":"1Z1","status":"delivered"},{"tracking_number":"1Z2","carrier":"UPS"}]', current_date + 12, now());
select concierge.record_tracking(:'u', :'o1', false, '[{"tracking_number":"1Z2","status":"in_transit"}]', null, now());
select is((select packages from concierge.orders where id = :'o1'),
  '[{"tracking_number":"1Z1","carrier":"UPS","status":"delivered"},{"tracking_number":"1Z2","carrier":"UPS","status":"in_transit"}]'::jsonb,
  'record_tracking merges packages by tracking number');

select concierge.record_tracking(:'u', :'o1', false, null, current_date + 30, now() - interval '2 hours');
select ok((select est_delivery_date = current_date + 12 and tracking_event_at = now() from concierge.orders where id = :'o1'),
  'an older event does not overwrite a newer estimate');

-- ─── more store_cancel_order and reconcile ──────────────────────────────────
select tests.ot_round(:'u', :'p', :'o', 2039, 20, array['placed', 'placed']) as r10 \gset
update concierge.gift_rounds set closed_at = now() where id = :'r10';
select concierge.store_cancel_order(:'u', tests.ot_order(:'r10', 1), current_date) as sc10 \gset
select ok(:'sc10' = 'ordered'
      and (select resolved and not failed_after_close from concierge.orders where id = tests.ot_order(:'r10', 1)),
  'store_cancel_order on a closed ordered round leaves failed_after_close false');

select tests.ot_round(:'u', :'p', :'o', 2040, 20, array['placing']) as r11 \gset
select tests.ot_order(:'r11', 1) as o11 \gset
select concierge.store_cancel_order(:'u', :'o11', current_date);
select ok((select status = 'failed' and failure_type = 'store_cancelled' and placed_at is not null
             from concierge.orders where id = :'o11'),
  'store_cancel_order on placing settles placed first');

select tests.ot_round(:'u', :'p', :'o', 2041, 20, array['cancelled', 'cancelled']) as r12 \gset
select is(concierge.reconcile_round(:'r12')::text, 'ordered', 'a round with only cancelled orders is not moved to delivered');

-- ─── delivered rounds and news candidates ───────────────────────────────────
select exists (select 1 from concierge.delivered_rounds_untold() d where d.round_id = :'r3' and d.user_id = :'u') as listed \gset
insert into concierge.round_sends (round_id, user_id, step) values (:'r3', :'u', 'delivered');
select ok(:'listed'::boolean and not exists (select 1 from concierge.delivered_rounds_untold() d where d.round_id = :'r3'),
  'delivered_rounds_untold lists a delivered round until its delivered step exists');

-- r5's store cancel was told through the fix page, then the deadline closed the round.
insert into concierge.round_sends (round_id, user_id, step) values (:'r5', :'u', 'fail:' || :'o5');
select concierge.cancel_held(:'r5', 'deadline');
select ok((select resolved and not failed_after_close from concierge.orders where id = :'o5')
      and not exists (select 1 from concierge.tracking_candidates(current_date) c where c.order_id = :'o5')
      and exists (select 1 from concierge.tracking_candidates(current_date) c where c.order_id = :'o7'),
  'tracking_candidates skips a store cancel already told as a failure');

-- ─── grants on the new columns ──────────────────────────────────────────────
select tests.act_as(:'u');
select is((select delivered_by from concierge.orders where id = :'o3' and placed_at is null and delivered_at is not null), 'zinc',
  'authenticated can read placed_at, delivered_at, delivered_by on its own orders');
select tests.act_as_server();

-- ─── pruning ────────────────────────────────────────────────────────────────
select tests.ot_round(:'u', :'p', :'o', 2042, 20, array['delivered', 'delivered', 'failed', 'failed']) as r13 \gset
update concierge.orders set packages = '[{"tracking_number":"P"}]' where round_id = :'r13';
update concierge.orders set delivered_at = now() - interval '31 days' where id = tests.ot_order(:'r13', 1);
update concierge.orders set delivered_at = now() - interval '29 days' where id = tests.ot_order(:'r13', 2);
update concierge.orders set failed_at = now() - interval '31 days' where id = tests.ot_order(:'r13', 3);
update concierge.orders set failed_at = now() - interval '29 days' where id = tests.ot_order(:'r13', 4);
select concierge.prune_tracking_numbers() as pruned \gset
select ok(:'pruned'::integer >= 2
      and (select packages = '[]'::jsonb from concierge.orders where id = tests.ot_order(:'r13', 1))
      and (select packages <> '[]'::jsonb from concierge.orders where id = tests.ot_order(:'r13', 2)),
  'prune_tracking_numbers clears packages 30 days after delivered_at, not before');
select ok((select packages = '[]'::jsonb from concierge.orders where id = tests.ot_order(:'r13', 3))
      and (select packages <> '[]'::jsonb from concierge.orders where id = tests.ot_order(:'r13', 4)),
  'prune clears a failed order''s packages by failed_at');

update concierge.app_settings set value = '0' where key = 'tracking_prune_days';
update concierge.orders set delivered_at = now() - interval '60 days' where id = tests.ot_order(:'r13', 2);
select concierge.prune_tracking_numbers() as pruned0 \gset
select ok(:'pruned0'::integer = 0
      and (select packages <> '[]'::jsonb from concierge.orders where id = tests.ot_order(:'r13', 2)),
  'prune is off at 0');

-- ─── check values ───────────────────────────────────────────────────────────
select lives_ok(format($$insert into concierge.round_sends (round_id, user_id, step) values
  (%1$L, %2$L, 'late:' || %3$L), (%1$L, %2$L, 'ontime:' || %3$L), (%1$L, %2$L, 'cancel_late:' || %3$L), (%1$L, %2$L, 'delivered')$$,
  :'r1', :'u', :'o1'),
  'round_sends accepts late:/ontime:/cancel_late:<uuid> and delivered');

-- ─── grants ─────────────────────────────────────────────────────────────────
select tests.reset_role();
select ok(not bool_or(has_function_privilege(r, f, 'execute')) and bool_and(has_function_privilege('service_role', f, 'execute')),
  'authenticated cannot execute the new functions')
  from unnest(array['authenticated', 'anon']) r,
       unnest(array[
         'concierge.record_tracking(uuid, uuid, boolean, jsonb, date, timestamptz)',
         'concierge.mark_delivered(uuid, uuid, text)',
         'concierge.store_cancel_order(uuid, uuid, date)',
         'concierge.delivered_rounds_untold()',
         'concierge.tracking_candidates(date)',
         'concierge.prune_tracking_numbers()'
       ]) f;

select * from finish();
rollback;
