-- rounds_missing_late_failure_email (ALL-32 re-review): only rounds with an
-- order that failed after its round closed and whose 'late_fail:<order id>'
-- email isn't recorded, so the tick's retry doesn't read every late failure
-- ever. Server-only.
begin;
\ir _helpers.psql
select plan(4);

select tests.create_user('missing@example.com') as u \gset
insert into public.people (user_id, name, relationship) values (:'u', 'P', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'u', :'p', :'o', 2030, current_date + 7, current_date, 5000, 'skipped', null) returning id as r \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'u', :'r', 'Mug', 4000, 4500, 1) returning id as i \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, failure_type, resolved,
                              failed_after_close, ship_to, ship_city, ship_state)
values (:'u', :'r', :'i', 'zinc_wallet', 4500, 100, 'failed', 'out_of_stock', true, true, 'recipient', 'Dayton', 'OH') returning id as ord \gset

select tests.act_as_server();
select ok(exists (select 1 from concierge.rounds_missing_late_failure_email() r where r = :'r'), 'a late failure with no email is listed');
select tests.reset_role();
insert into concierge.round_sends (round_id, user_id, step) values (:'r', :'u', 'late_fail:' || :'ord');
select tests.act_as_server();
select ok(not exists (select 1 from concierge.rounds_missing_late_failure_email() r where r = :'r'), '... and not once its email is recorded');
select tests.reset_role();

select tests.act_as(:'u');
select throws_ok('select * from concierge.rounds_missing_late_failure_email()', '42501', null, 'signed-in users can''t call it');
select tests.reset_role();
select ok(not has_function_privilege('anon', 'concierge.rounds_missing_late_failure_email()', 'execute'), 'visitors can''t either');

select * from finish();
rollback;
