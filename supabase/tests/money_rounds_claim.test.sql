-- claim_due_money_rounds (ALL-32 final review S6, owner): with the round
-- engine switched off, the tick still settles and tells buyers about rounds
-- on the money path. It claims, like claim_due_rounds, only due rounds that
-- need attention (a hold or a failure); nothing else is touched.
begin;
\ir _helpers.psql
select plan(5);

select tests.create_user('money@example.com') as u \gset
insert into public.people (user_id, name, relationship) values (:'u', 'P', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'valentines_day') returning id as o2 \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents,
                                   status, attention_reason, next_action_at)
values (:'u', :'p', :'o', 2030, current_date + 37, current_date + 30, 5000, 'needs_attention', 'funds', now() - interval '1 minute')
returning id as held \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents,
                                   status, next_action_at, heads_up_on)
values (:'u', :'p', :'o2', 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now() - interval '1 minute', current_date)
returning id as waiting \gset

select tests.act_as_server();
select ok(exists (select 1 from concierge.claim_due_money_rounds(now()) where id = :'held'), 'a due held round is claimed');
select tests.reset_role();
select ok((select locked_until is not null from concierge.gift_rounds where id = :'held'), '... with a lease');
select ok((select locked_until is null and attempts = 0 from concierge.gift_rounds where id = :'waiting'),
  'a round awaiting approval is left alone');

select tests.act_as(:'u');
select throws_ok($q$select * from concierge.claim_due_money_rounds(now())$q$, '42501', null, 'signed-in users can''t call it');
select tests.reset_role();
select ok(not has_function_privilege('anon', 'concierge.claim_due_money_rounds(timestamptz)', 'execute'), 'visitors can''t either');

select * from finish();
rollback;
