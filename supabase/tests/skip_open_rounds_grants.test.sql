-- Only the server can call concierge.skip_open_rounds directly (ALL-28 ruling 15).
-- The user paths that use it (deleting a person or an occasion, switching an
-- occasion off) still skip their open round.
begin;
\ir _helpers.psql
select plan(8);

select tests.create_user('a@example.com') as a \gset
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as mom \gset
insert into public.people (name, relationship) values ('Dad', 'parent') returning id as dad \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset
insert into concierge.occasions (person_id, kind) values (:'dad', 'fathers_day') returning id as fday \gset
insert into concierge.occasions (person_id, kind) values (:'dad', 'christmas') returning id as xmas \gset

select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, 'awaiting_approval', now()) returning id as mom_round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'dad', :'fday', 2027, '2027-06-20', '2027-06-11', 10000, 'scheduled', now()) returning id as fday_round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'dad', :'xmas', 2027, '2027-12-25', '2027-12-16', 10000, 'scheduled', now()) returning id as xmas_round \gset

-- Nobody but the server can call it.
select tests.act_as(:'a');
select throws_ok(format('select concierge.skip_open_rounds(%L, null)', :'mom'), '42501', null, 'a signed-in user cannot call skip_open_rounds');
select tests.act_as_anon();
select throws_ok(format('select concierge.skip_open_rounds(%L, null)', :'mom'), '42501', null, 'anon cannot call skip_open_rounds');
select tests.reset_role();
select is((select status::text from concierge.gift_rounds where id = :'mom_round'), 'awaiting_approval', 'the refused calls skipped nothing');
select ok(has_function_privilege('service_role', 'concierge.skip_open_rounds(uuid, uuid)', 'execute'), 'the server can call it');

-- The user paths still work.
select tests.act_as(:'a');
select public.delete_person(:'mom');
select concierge.delete_occasion(:'fday');
update concierge.occasions set enabled = false where id = :'xmas';
select tests.reset_role();
select is((select status::text from concierge.gift_rounds where id = :'mom_round'), 'skipped', 'deleting a person still skips their open round');
select is((select status::text from concierge.gift_rounds where id = :'fday_round'), 'skipped', 'deleting an occasion still skips its open round');
select is((select status::text from concierge.gift_rounds where id = :'xmas_round'), 'skipped', 'switching an occasion off still skips its open round');
select is((select count(*)::int from concierge.gift_rounds where status = 'skipped' and user_id = :'a'), 3, 'only those rounds were skipped');

select * from finish();
rollback;
