-- Customers are told about a failed order at once (ALL-32 Task 7, owner rule):
-- reconcile_round makes the round due now while its fail:<n>:notice is unsent,
-- where n is round_fail_count (failed orders, not counting a bad address,
-- which is held for a new address instead). Emailed holds keep their rule.
begin;
\ir _helpers.psql
select plan(10);

select tests.create_user('failnotice@example.com') as u \gset
insert into public.people (user_id, name, relationship) values (:'u', 'P', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'u', :'p', :'o', 2030, current_date + 37, current_date + 30, 9000, 'needs_attention', now() + interval '5 days') returning id as r \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'u', :'r', 'Mug', 4000, 4500, 1) returning id as i1 \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'u', :'r', 'Apron', 3000, 3500, 2) returning id as i2 \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
values (:'u', :'r', :'i1', 'zinc_wallet', 4500, 100, 'held', 'retry', 'recipient', 'Dayton', 'OH') returning id as o1 \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
values (:'u', :'r', :'i2', 'zinc_wallet', 3500, 100, 'held', 'retry', 'recipient', 'Dayton', 'OH') returning id as o2 \gset

select tests.act_as_server();

-- A bad address doesn't count: it's held for a new one, not a failure to tell.
select concierge.fail_order(:'o1', 'invalid_shipping_address');
select is(concierge.round_fail_count(:'r'), 0, 'a bad address isn''t counted as a failure');

-- Back to a plain retry hold, so the next failure decides the round's reason.
select concierge.hold_orders(:'r', 'retry');
select concierge.fail_order(:'o2', 'too_late');
select is(concierge.round_fail_count(:'r'), 1, 'one failure');
-- ALL-116: a held gift (the bad address's replacement) decides the reason now; the
-- failure is told by its own key whatever the reason.
select is((select attention_reason from concierge.gift_rounds where id = :'r'), 'retry', 'the held gift decides the reason (ALL-116)');
select ok((select next_action_at <= now() from concierge.gift_rounds where id = :'r'), 'due now while the failure is untold');

-- An older-style key, sent after the failure (its own transaction in real life, so clock_timestamp here).
insert into concierge.round_sends (round_id, user_id, step, created_at) values (:'r', :'u', 'fail:1:notice', clock_timestamp());
select concierge.reconcile_round(:'r');
select is((select next_action_at from concierge.gift_rounds where id = :'r'),
          ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc', 'tomorrow once it was sent');

-- A second failure (the replacement held order) is a new notice.
select concierge.fail_order((select id from concierge.orders where round_id = :'r' and status = 'held'), 'out_of_stock');
select is(concierge.round_fail_count(:'r'), 2, 'two failures');
select ok((select next_action_at <= now() from concierge.gift_rounds where id = :'r'), 'due now again for fail:2:notice');

-- An emailed hold keeps its own rule.
select is(concierge.reconcile_round(:'r', 'deadline')::text, 'skipped', 'the deadline still skips it');
select is(concierge.round_fail_count(:'r'), 2, 'resolving failures doesn''t change the count');
select tests.reset_role();

select ok(not has_function_privilege('authenticated', 'concierge.round_fail_count(uuid)', 'execute'), 'server only');

select * from finish();
rollback;
