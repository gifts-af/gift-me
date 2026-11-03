-- Switching an occasion off stops its open round (ALL-28): the round is
-- skipped, the engine has nothing left to do for it, and its lease is cleared.
begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('a@example.com') as a \gset
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as mom \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset
insert into concierge.occasions (person_id, kind) values (:'mom', 'christmas') returning id as xmas \gset

-- The server has this year's open round (held by an engine run), an ordered one and a finished one.
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, locked_until)
values (:'a', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, 'awaiting_approval', now(), now() + interval '5 minutes') returning id as open_round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2026, '2026-03-14', '2026-03-05', 10000, 'ordered') returning id as ordered_round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2025, '2025-03-14', '2025-03-05', 10000, 'complete') returning id as old_round \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'mom', :'xmas', 2027, '2027-12-25', '2027-12-16', 10000, 'scheduled', now()) returning id as xmas_round \gset

-- Changing something else on the occasion leaves its round alone.
select tests.act_as(:'a');
update concierge.occasions set month = 3, day = 15 where id = :'bday';
select tests.reset_role();
select is((select status::text from concierge.gift_rounds where id = :'open_round'), 'awaiting_approval', 'editing an occasion leaves its round open');

-- A switches the birthday off.
select tests.act_as(:'a');
update concierge.occasions set enabled = false where id = :'bday';
select tests.reset_role();
select is((select status::text from concierge.gift_rounds where id = :'open_round'), 'skipped', 'switching an occasion off skips its open round');
select is((select next_action_at from concierge.gift_rounds where id = :'open_round'), null, 'the round engine has nothing left to do for it');
select is((select locked_until from concierge.gift_rounds where id = :'open_round'), null, 'its lease is cleared');
select is((select status::text from concierge.gift_rounds where id = :'ordered_round'), 'ordered', 'an ordered round is left as it was');
select is((select status::text from concierge.gift_rounds where id = :'old_round'), 'complete', 'a finished round is left as it was');
select is((select status::text from concierge.gift_rounds where id = :'xmas_round'), 'scheduled', 'the person''s other occasions keep their rounds');

-- No email: the skip is the database's, not the engine's.
select is((select count(*)::int from concierge.round_sends where round_id = :'open_round'), 0, 'nothing is recorded to send');

-- Switching it back on doesn't bring the round back.
select tests.act_as(:'a');
update concierge.occasions set enabled = true where id = :'bday';
select tests.reset_role();
select is((select status::text from concierge.gift_rounds where id = :'open_round'), 'skipped', 'switching it back on leaves the round skipped');

select * from finish();
rollback;
