-- Soft deletes for people and occasions, and the admin hard delete for
-- requests such as GDPR erasure (T26).
begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- A has Mom (with a birthday) and Dad (with Father's Day).
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent'), ('Dad', 'parent');
select id as mom from public.people where name = 'Mom' \gset
select id as dad from public.people where name = 'Dad' \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset
insert into concierge.occasions (person_id, kind) values (:'dad', 'fathers_day') returning id as fday \gset

-- The server has an open round and last year's finished round for Mom, with an order.
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, 'awaiting_approval', now()) returning id as open_round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2026, '2026-03-14', '2026-03-05', 10000, 'complete') returning id as old_round \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'a', :'old_round', 'Garden kneeler', 3500, 4200, 1) returning id as idea \gset
insert into concierge.orders (user_id, round_id, idea_id, max_price_cents, fee_cents, funding_mode, status)
values (:'a', :'old_round', :'idea', 5000, 100, 'zinc_wallet', 'delivered');
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'dad', :'fday', 2027, '2027-06-20', '2027-06-11', 8000, 'scheduled', now()) returning id as dad_round \gset

-- Users can't hard-delete people or occasions.
select tests.act_as(:'a');
select throws_ok(format('delete from public.people where id = %L', :'mom'), '42501', null, 'A cannot hard-delete a person');
select throws_ok(format('delete from concierge.occasions where id = %L', :'fday'), '42501', null, 'A cannot hard-delete an occasion');

-- B can't delete A's person.
select tests.act_as(:'b');
select throws_ok(format('select public.delete_person(%L)', :'mom'), 'P0002', null, 'B cannot delete A''s person');

-- A deletes Mom: she's hidden, her open round is skipped, history stays.
select tests.act_as(:'a');
select public.delete_person(:'mom');
select is((select count(*)::int from public.people where id = :'mom'), 0, 'a deleted person is hidden from their user');
select is((select count(*)::int from concierge.occasions where person_id = :'mom'), 0, 'a deleted person''s occasions are hidden too');

select tests.reset_role();
select isnt((select deleted_at from public.people where id = :'mom'), null, 'the person row is kept, marked deleted');
select is((select status::text from concierge.gift_rounds where id = :'open_round'), 'skipped', 'an open round for a deleted person is skipped');
select is((select next_action_at from concierge.gift_rounds where id = :'open_round'), null, 'the round engine has nothing left to do for it');
select is((select status::text from concierge.gift_rounds where id = :'old_round'), 'complete', 'finished rounds are left as they were');
select is((select count(*)::int from concierge.orders where round_id = :'old_round'), 1, 'order history is kept');

-- No new round can start for a deleted person.
select throws_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
           values (%L, %L, %L, 2028, '2028-03-14', '2028-03-05', 10000)$q$, :'a', :'mom', :'bday'),
  'P0001', null, 'no round can be created for a deleted person'
);

-- A deletes Father's Day: hidden, and Dad's open round is skipped.
select tests.act_as(:'a');
select concierge.delete_occasion(:'fday');
select is((select count(*)::int from concierge.occasions), 0, 'a deleted occasion is hidden');
select tests.reset_role();
select is((select status::text from concierge.gift_rounds where id = :'dad_round'), 'skipped', 'an open round for a deleted occasion is skipped');

-- Hard delete is for admins (the server) only.
select tests.act_as(:'a');
select throws_ok(format($q$select admin.hard_delete_person(%L, 'a', 'test')$q$, :'mom'), '42501', null, 'users cannot hard-delete');

set local role service_role;
select admin.hard_delete_person(:'mom', 'owner@example.com', 'GDPR erasure request');
select is(
  (select count(*)::int from public.people where id = :'mom')
    + (select count(*)::int from concierge.gift_rounds where person_id = :'mom')
    + (select count(*)::int from concierge.orders where round_id = :'old_round'),
  0,
  'a hard delete removes the person, their rounds and their orders'
);
select is(
  (select reason from admin.deletion_log where target_id = :'mom'),
  'GDPR erasure request',
  'the hard delete is logged with its reason'
);

select admin.hard_delete_account(:'a', 'owner@example.com', 'Account closed');
select tests.reset_role();
select is(
  (select count(*)::int from auth.users where id = :'a') + (select count(*)::int from public.people where user_id = :'a'),
  0,
  'an account hard delete removes the account and everything in it'
);
select is((select kind from admin.deletion_log where target_id = :'a'), 'account', 'the account deletion is logged');
select is(
  (select user_id from admin.deletion_log where target_id = :'mom'),
  :'a'::uuid,
  'the log keeps whose data it was, as an id only'
);

select * from finish();
rollback;
