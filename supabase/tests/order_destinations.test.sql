-- Where an order ships (product decision 38, ALL-44): to the recipient, to
-- the buyer, or to another address. The buyer sees where it went by city;
-- the full address snapshot is server-only, so a shared address never
-- reaches the buyer through their own order. Ideas can come from a person's
-- own list (decision 37).
begin;
\ir _helpers.psql
select plan(8);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as mom \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset

-- The server builds a round with one idea from Mom's list, and orders it.
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', null)
returning id as round \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id)
values (:'a', :'round', 'Mug set', 4200, 4800, 1, 'list', 'aaaaaaaa-0000-4000-8000-000000000001')
returning id as idea \gset
insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode, ship_to, ship_city, ship_state)
values (:'a', :'round', :'idea', 4700, 100, 'zinc_wallet', 'recipient', 'Dayton', 'OH')
returning id as order_id \gset
select throws_ok(
  format($$insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
           values (%L, %L, 'X', 'Y', '1 St', 'Town', 'OH', '00000', 'US')$$, :'order_id', :'b'),
  '23503', null,
  'an address can''t attach to someone else''s order'
);
select lives_ok(
  format($$insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
           values (%L, %L, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US')$$, :'order_id', :'a'),
  'the server snapshots the address an order ships to'
);

select throws_ok(
  format($$insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode, ship_to, ship_city, ship_state)
           values (%L, %L, %L, 4700, 100, 'zinc_wallet', 'friend', 'X', 'OH')$$, :'a', :'round', :'idea'),
  '23514', null,
  'an order ships to the recipient, the buyer or another address, nothing else'
);
select throws_ok(
  format($$insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source)
           values (%L, %L, 'x', 1, 1, 2, 'list')$$, :'a', :'round'),
  '23514', null,
  'an idea from a list names the list gift'
);
select throws_ok(
  format($$insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, list_item_id)
           values (%L, %L, 'x', 1, 1, 2, 'aaaaaaaa-0000-4000-8000-000000000002')$$, :'a', :'round'),
  '23514', null,
  'a generated idea has no list gift'
);

-- The buyer sees where it went, but not the street address.
select tests.act_as(:'a');
select is(
  (select ship_to || ': ' || ship_city || ', ' || ship_state from concierge.orders where id = :'order_id'),
  'recipient: Dayton, OH',
  'the buyer sees who it ships to and the city'
);
select is((select source from concierge.gift_ideas where id = :'idea'), 'list', 'the buyer sees the idea came from Mom''s list');
select throws_ok('select * from concierge.order_addresses', '42501', null, 'the buyer can''t read the full ship-to address');

select * from finish();
rollback;
