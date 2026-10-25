-- Gift rounds and everything that hangs off them (design §3, §5).
begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- The round statuses match packages/core/src/rounds.ts, in order.
select is(
  enum_range(null::concierge.round_status)::text,
  '{scheduled,generating,awaiting_approval,ordered,delivered,complete,needs_address,needs_attention,skipped}',
  'round statuses match ROUND_STATUSES'
);

-- A's Mom, her birthday, and one round with an idea, an order and a reaction.
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent'), ('Dad', 'parent');
select id as mom from public.people where name = 'Mom' \gset
select id as dad from public.people where name = 'Dad' \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset
insert into concierge.occasions (person_id, kind) values (:'dad', 'fathers_day') returning id as fday \gset

insert into concierge.gift_rounds (person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
values (:'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, now())
returning id as round \gset
insert into concierge.gift_rounds (person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
values (:'dad', :'fday', 2027, '2027-06-20', '2027-06-11', 8000, now());

insert into concierge.gift_ideas (round_id, title, price_cents, est_total_cents, rank)
values (:'round', 'Garden kneeler', 3500, 4200, 1)
returning id as idea \gset
insert into concierge.orders (round_id, idea_id, max_price_cents, fee_cents, funding_mode)
values (:'round', :'idea', 5000, 100, 'zinc_wallet');
insert into concierge.rejections (round_id, reason_code) values (:'round', 'already_owns');
insert into concierge.reactions (round_id, rating, source) values (:'round', 'loved', 'web');
insert into concierge.notifications (round_id, kind) values (:'round', 'heads_up');
insert into concierge.inbound_messages (from_address, subject, body) values ('a@example.com', 'Mom', 'She wants gloves');

select is((select status::text from concierge.gift_rounds where id = :'round'), 'scheduled', 'a round starts scheduled');
select is((select attempts from concierge.gift_rounds where id = :'round'), 0, 'a round starts with no attempts');
select isnt((select idempotency_key from concierge.orders), null, 'every order gets an idempotency key');

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

-- B can't hang their own rows off A's round or idea.
select throws_ok(
  format('insert into concierge.gift_ideas (round_id, title, price_cents, est_total_cents, rank) values (%L, %L, 1, 1, 1)', :'round', 'Spam'),
  '23503', null, 'B cannot add an idea to A''s round'
);
select throws_ok(
  format('insert into concierge.orders (round_id, idea_id, max_price_cents, fee_cents, funding_mode) values (%L, %L, 1, 100, %L)', :'round', :'idea', 'zinc_wallet'),
  '23503', null, 'B cannot order against A''s round'
);
select throws_ok(
  format('insert into concierge.reactions (round_id, rating, source) values (%L, %L, %L)', :'round', 'meh', 'web'),
  '23503', null, 'B cannot react on A''s round'
);

select tests.act_as_anon();
select throws_ok('select * from concierge.gift_rounds', '42501', null, 'anon cannot read rounds');

-- One round per person, occasion and year (the tick relies on it).
select tests.act_as(:'a');
select throws_ok(
  format($q$insert into concierge.gift_rounds (person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
           values (%L, %L, 2027, '2027-03-14', '2027-03-05', 10000, now())$q$, :'mom', :'bday'),
  '23505', null, 'a second round for the same person, occasion and year is refused'
);
select lives_ok(
  format($q$insert into concierge.gift_rounds (person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
           values (%L, %L, 2028, '2028-03-14', '2028-03-05', 10000, now())$q$, :'mom', :'bday'),
  'next year''s round for the same occasion is fine'
);

-- Values outside the rules are refused.
select throws_ok(
  format($q$update concierge.gift_rounds set status = 'purchasing' where id = %L$q$, :'round'),
  '22P02', null, 'status must be one of the 9 round statuses'
);
select throws_ok(
  format($q$update concierge.orders set gift_message = repeat('x', 241) where round_id = %L$q$, :'round'),
  '23514', null, 'a gift message is at most 240 characters'
);
select throws_ok(
  format($q$update concierge.orders set status = 'lost' where round_id = %L$q$, :'round'),
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

select * from finish();
rollback;
