-- Gift rounds and everything that hangs off them (design §3, §5, T26).
-- Rounds, ideas, orders and messages are written by the server (service
-- role); users only read them.
begin;
\ir _helpers.psql
select plan(24);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- The round statuses match packages/core/src/rounds.ts, in order.
select is(
  enum_range(null::concierge.round_status)::text,
  '{scheduled,generating,awaiting_approval,ordered,delivered,complete,needs_address,needs_attention,skipped}',
  'round statuses match ROUND_STATUSES'
);

-- A sets up Mom and Dad and their occasions.
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent'), ('Dad', 'parent');
select id as mom from public.people where name = 'Mom' \gset
select id as dad from public.people where name = 'Dad' \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset
insert into concierge.occasions (person_id, kind) values (:'dad', 'fathers_day') returning id as fday \gset

-- The server creates a round for each, with an idea, order and reaction on Mom's.
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
values (:'a', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, now())
returning id as round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
values (:'a', :'dad', :'fday', 2027, '2027-06-20', '2027-06-11', 8000, now())
returning id as dad_round \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'a', :'round', 'Garden kneeler', 3500, 4200, 1)
returning id as idea \gset
insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode)
values (:'a', :'round', :'idea', 5000, 100, 'zinc_wallet')
returning id as order_id \gset
insert into concierge.rejections (user_id, round_id, reason_code) values (:'a', :'round', 'already_owns');
insert into concierge.reactions (user_id, round_id, rating, source) values (:'a', :'round', 'loved', 'web');
insert into concierge.notifications (user_id, round_id, kind) values (:'a', :'round', 'heads_up');
insert into concierge.inbound_messages (user_id, from_address, subject, body, matched_person_id)
values (:'a', 'a@example.com', 'Mom', 'She wants gloves', :'mom');

select is((select status::text from concierge.gift_rounds where id = :'round'), 'scheduled', 'a round starts scheduled');
select is((select attempts from concierge.gift_rounds where id = :'round'), 0, 'a round starts with no attempts');
select isnt((select idempotency_key from concierge.orders), null, 'every order gets an idempotency key');

-- A reads their rounds but can't write anything on them.
select tests.act_as(:'a');
select is((select count(*)::int from concierge.gift_rounds), 2, 'A sees their own rounds');
select throws_ok(
  format($q$insert into concierge.gift_rounds (person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
           values (%L, %L, 2028, '2028-03-14', '2028-03-05', 10000)$q$, :'mom', :'bday'),
  '42501', null, 'A cannot create rounds'
);
select throws_ok(
  format($q$update concierge.gift_rounds set status = 'complete', locked_until = null where id = %L$q$, :'round'),
  '42501', null, 'A cannot move a round or touch the engine''s fields'
);
select throws_ok(
  format($q$update concierge.orders set status = 'delivered' where id = %L$q$, :'order_id'),
  '42501', null, 'A cannot change an order'
);
select throws_ok(
  format($q$insert into concierge.gift_ideas (round_id, title, price_cents, est_total_cents, rank) values (%L, 'x', 1, 1, 1)$q$, :'round'),
  '42501', null, 'A cannot add ideas'
);
select throws_ok(
  format($q$insert into concierge.notifications (round_id, kind) values (%L, 'fake')$q$, :'round'),
  '42501', null, 'A cannot write notifications'
);

-- B sees none of it.
select tests.act_as(:'b');
select is(
  (select count(*)::int from concierge.gift_rounds) + (select count(*)::int from concierge.gift_ideas)
    + (select count(*)::int from concierge.orders) + (select count(*)::int from concierge.rejections)
    + (select count(*)::int from concierge.reactions) + (select count(*)::int from concierge.notifications)
    + (select count(*)::int from concierge.inbound_messages),
  0,
  'B sees none of A''s rounds, ideas, orders, rejections, reactions, notifications or messages'
);

select tests.act_as_anon();
select throws_ok('select * from concierge.gift_rounds', '42501', null, 'anon cannot read rounds');

-- Even server code can't cross owners or mix rounds up.
select tests.reset_role();
select throws_ok(
  format($q$insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank) values (%L, %L, 'x', 1, 1, 1)$q$, :'b', :'round'),
  '23503', null, 'an idea can''t belong to someone other than its round''s owner'
);
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'a', :'round', 'Seed kit', 2000, 2600, 2)
returning id as idea2 \gset
select throws_ok(
  format($q$insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode) values (%L, %L, %L, 1, 100, 'zinc_wallet')$q$, :'a', :'dad_round', :'idea2'),
  '23503', null, 'an order can''t use an idea from a different round'
);

-- One live order per idea, so a retry or double approval can't buy twice.
select throws_ok(
  format($q$insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode) values (%L, %L, %L, 5000, 100, 'zinc_wallet')$q$, :'a', :'round', :'idea'),
  '23505', null, 'a second live order for the same idea is refused'
);
update concierge.orders set status = 'failed' where id = :'order_id';
select lives_ok(
  format($q$insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode) values (%L, %L, %L, 5000, 100, 'zinc_wallet')$q$, :'a', :'round', :'idea'),
  'after an order fails, the same idea can be ordered again'
);

-- One round per person, occasion and year (the tick relies on it).
select throws_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
           values (%L, %L, %L, 2027, '2027-03-14', '2027-03-05', 10000)$q$, :'a', :'mom', :'bday'),
  '23505', null, 'a second round for the same person, occasion and year is refused'
);
select lives_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
           values (%L, %L, %L, 2028, '2028-03-14', '2028-03-05', 10000)$q$, :'a', :'mom', :'bday'),
  'next year''s round for the same occasion is fine'
);

-- Values outside the rules are refused.
select throws_ok(
  format($q$update concierge.gift_rounds set status = 'purchasing' where id = %L$q$, :'round'),
  '22P02', null, 'status must be one of the 9 round statuses'
);
select throws_ok(
  format($q$update concierge.orders set status = 'lost' where id = %L$q$, :'order_id'),
  '23514', null, 'order status must be one of the 7 order statuses'
);
select throws_ok(
  format($q$update concierge.gift_ideas set price_cents = -1 where id = %L$q$, :'idea'),
  '23514', null, 'money can''t be negative'
);

-- Deleting Mom removes her rounds and everything on them; Dad's round stays.
delete from public.people where id = :'mom';
select is(
  (select count(*)::int from concierge.gift_ideas) + (select count(*)::int from concierge.orders)
    + (select count(*)::int from concierge.rejections) + (select count(*)::int from concierge.reactions)
    + (select count(*)::int from concierge.notifications),
  0,
  'deleting a person removes their rounds'' ideas, orders, rejections, reactions and notifications'
);
select is((select count(*)::int from concierge.gift_rounds), 1, 'other people''s rounds stay');
select is(
  (select user_id from concierge.inbound_messages where matched_person_id is null),
  :'a'::uuid,
  'an emailed note survives its person being deleted, unmatched'
);

select * from finish();
rollback;
