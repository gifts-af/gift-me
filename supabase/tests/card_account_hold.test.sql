-- Card orders paused for a problem with our own Zinc account (record_outcomes' paused outcome),
-- and the health email's list of card orders charged over their maximum (health_snapshot).
begin;
\ir _helpers.psql
select plan(13);

update concierge.app_settings set value = '1' where key in ('zinc_ordering_enabled', 'connect_enabled', 'cost_tracking_enabled');

-- A round waiting on approval with one idea per title given, goods 2259 each.
create function tests.ah_round(p_user uuid, p_titles text[] default array['Mouse pad'])
returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid; t text; n int := 0;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, v_person, v_occasion, 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now(),
          now() + interval '10 minutes')
  returning id into v_round;
  foreach t in array p_titles loop
    n := n + 1;
    insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, goods_cents, rank, source, status)
    values (p_user, v_round, t, 2000, 2359, 2259, n, 'generated', 'proposed');
  end loop;
  return v_round;
end $$;

create function tests.ah_lock(p_round uuid)
returns timestamptz language sql as $$ select locked_until from concierge.gift_rounds where id = p_round; $$;

-- Approves every idea of the round with today's launch fees, then moves them to placing.
create function tests.ah_placing(p_round uuid)
returns integer language sql as $$
  select count(*) from concierge.approve_round(p_round, (select user_id from concierge.gift_rounds where id = p_round), tests.ah_lock(p_round),
    (select jsonb_agg(jsonb_build_object('idea_id', i.id, 'max_price_cents', 2485, 'fee_cents', 100, 'ship_to', 'recipient',
                        'address_source', 'own',
                        'address', jsonb_build_object('recipient_first_name', 'Mary', 'recipient_last_name', 'Allen',
                                                      'address_line1', '12 Oak St', 'city', 'Dayton', 'state', 'OH',
                                                      'zip', '45402', 'country', 'US'),
                        'margin_cents', 100, 'zinc_fee_cents', 100, 'card_fee_bps', 290, 'card_fee_fixed_cents', 30) order by i.rank)
       from concierge.gift_ideas i where i.round_id = p_round));
  select count(*)::integer from concierge.begin_placing(p_round, tests.ah_lock(p_round), current_date,
    (select jsonb_agg(jsonb_build_object('id', o.id, 'max_price_cents', o.max_price_cents))
       from concierge.orders o where o.round_id = p_round and o.status = 'held'));
$$;

create function tests.ah_order(p_round uuid, p_title text default 'Mouse pad')
returns concierge.orders language sql as $$
  select o.* from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
   where o.round_id = p_round and i.title = p_title order by o.created_at desc limit 1;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.create_user('card-hold@example.com') as u \gset
insert into concierge.accounts (user_id, paid_features, buyer_phone, funding_mode, stripe_customer_id, stripe_payment_method_id)
values (:'u', true, '5555550100', 'connect', 'cus_1', 'pm_1');

-- ─── paused: an account code on a card order ─────────────────────

select tests.ah_round(:'u', array['A', 'B']) as r1 \gset
select is(tests.ah_placing(:'r1'), 2, 'two card orders are placing');
select (tests.ah_order(:'r1', 'A')).idempotency_key as key_a \gset
select (tests.ah_order(:'r1', 'B')).idempotency_key as key_b \gset
select concierge.record_outcomes(:'r1', jsonb_build_array(
  jsonb_build_object('order_id', (tests.ah_order(:'r1', 'A')).id, 'outcome', 'paused'),
  jsonb_build_object('order_id', (tests.ah_order(:'r1', 'B')).id, 'outcome', 'unsent')));
select is((select o.status || '/' || o.hold_reason from tests.ah_order(:'r1', 'A') o), 'held/paused',
          'an order refused for our own account is held paused');
select isnt((tests.ah_order(:'r1', 'A')).idempotency_key, :'key_a'::uuid,
            'with a fresh key: the refusal created nothing at Zinc, and a replayed one must not answer the retry');
select is((tests.ah_order(:'r1', 'B')).idempotency_key, :'key_b'::uuid, 'a sibling never sent keeps its key');
select is((select stripe_payment_method_id from concierge.accounts where user_id = :'u'), 'pm_1', 'the buyer''s card is kept');
select is((select attention_reason::text from concierge.gift_rounds where id = :'r1'), 'paused', 'the round waits paused');

-- The round closed meanwhile: nothing was bought, so the order is cancelled, never held again.
select tests.ah_round(:'u') as r2 \gset
select tests.ah_placing(:'r2');
update concierge.gift_rounds set closed_at = now() where id = :'r2';
select concierge.record_outcomes(:'r2', jsonb_build_array(jsonb_build_object('order_id', (tests.ah_order(:'r2')).id, 'outcome', 'paused')));
select is((select o.status || '/' || o.failure_type from tests.ah_order(:'r2') o), 'cancelled/round_closed', 'a closed round''s paused order is cancelled');

-- ─── health_snapshot: charged over the maximum ───────────────────

select tests.ah_round(:'u', array['Over', 'Under', 'Old']) as r3 \gset
select tests.ah_placing(:'r3');
update concierge.orders o set status = 'placed', placed_at = now() - interval '1 hour', total_cents = 2259,
       final_charge_cents = o.max_charge_cents + case i.title when 'Over' then 1 when 'Old' then 5 else 0 end
  from concierge.gift_ideas i where i.id = o.idea_id and o.round_id = :'r3';
update concierge.orders set placed_at = now() - interval '26 hours' where id = (tests.ah_order(:'r3', 'Old')).id;
select concierge.health_snapshot(now()) as snap \gset
select ok((:'snap'::jsonb -> 'over_max_charge') @> jsonb_build_array(jsonb_build_object(
            'order_id', (tests.ah_order(:'r3', 'Over')).id, 'round_id', :'r3', 'user_id', :'u',
            'charge_cents', (tests.ah_order(:'r3', 'Over')).final_charge_cents,
            'max_charge_cents', (tests.ah_order(:'r3', 'Over')).max_charge_cents)),
          'a card order charged a cent over its maximum is listed, with both amounts');
select ok(not (:'snap'::jsonb -> 'over_max_charge') @> jsonb_build_array(jsonb_build_object('order_id', (tests.ah_order(:'r3', 'Under')).id)),
          'one charged exactly its maximum is not');
select ok(not (:'snap'::jsonb -> 'over_max_charge') @> jsonb_build_array(jsonb_build_object('order_id', (tests.ah_order(:'r3', 'Old')).id)),
          'one placed more than a day ago was in an earlier email');
select is(jsonb_typeof(:'snap'::jsonb -> 'over_max_charge'), 'array', 'the list is always there');
select is((select jsonb_array_length(concierge.health_snapshot(now() + interval '3 days') -> 'over_max_charge')), 0,
          'an empty list once nothing new is over');
select ok(not has_function_privilege('authenticated', 'concierge.health_snapshot(timestamptz)', 'execute'),
          'the snapshot is still the server''s only');

select * from finish();
rollback;
