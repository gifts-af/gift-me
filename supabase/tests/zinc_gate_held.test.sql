-- The Node gates' hold (ALL-32 Task 6): gate_held_orders replaces only a
-- reason the gate outranks, like begin_placing, and is server-only.
begin;
\ir _helpers.psql
select plan(7);

select tests.create_user('gate@example.com') as u \gset
insert into public.people (user_id, name, relationship) values (:'u', 'P', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'u', :'p', :'o', 2030, current_date + 37, current_date + 30, 5000, 'needs_attention', now()) returning id as r \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'u', :'r', 'Mug', 4000, 4500, 1) returning id as i \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
values (:'u', :'r', :'i', 'zinc_wallet', 4500, 100, 'held', 'retry', 'recipient', 'Dayton', 'OH') returning id as ord \gset

select tests.act_as_server();
select is(concierge.gate_held_orders(:'r', 'paused')::text, 'needs_attention', 'returns the reconciled status');
select is((select hold_reason from concierge.orders where id = :'ord'), 'paused', 'paused outranks retry');
select is((select attention_reason from concierge.gift_rounds where id = :'r'), 'paused', 'the round says paused');

select concierge.hold_orders(:'r', 'address');
select concierge.gate_held_orders(:'r', 'setup');
select is((select hold_reason from concierge.orders where id = :'ord'), 'address', 'an address hold keeps its reason under a setup gate');

select throws_ok(format($q$select concierge.gate_held_orders(%L, 'funds')$q$, :'r'), '22023', null, 'only the gate reasons');
select tests.reset_role();

select tests.act_as(:'u');
select throws_ok(format($q$select concierge.gate_held_orders(%L, 'paused')$q$, :'r'), '42501', null, 'signed-in users can''t call it');
select tests.reset_role();
select ok(not has_function_privilege('anon', 'concierge.gate_held_orders(uuid, text)', 'execute'), 'visitors can''t either');

select * from finish();
rollback;
