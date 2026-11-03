-- Round engine (ALL-28): settings, send records, claims, leases, candidates.
begin;
\ir _helpers.psql
select plan(23);

select tests.create_user('a@example.com') as a \gset
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent'), ('Pal', 'friend'), ('Gone', 'friend');
select id as mom from public.people where name = 'Mom' \gset
select id as pal from public.people where name = 'Pal' \gset
select id as gone from public.people where name = 'Gone' \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as m_bday \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'anniversary', 5, 1) returning id as m_anniv \gset
insert into concierge.occasions (person_id, kind) values (:'mom', 'christmas') returning id as m_xmas \gset
insert into concierge.occasions (person_id, kind, enabled) values (:'mom', 'mothers_day', false) returning id as m_off \gset
insert into concierge.occasions (person_id, kind) values (:'mom', 'fathers_day') returning id as m_del \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'pal', 'birthday', 7, 4) returning id as p_bday \gset
insert into concierge.occasions (person_id, kind) values (:'gone', 'christmas') returning id as g_xmas \gset
insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (:'mom', 'birthday', 7500);
insert into concierge.budget_defaults (relationship, base_amount_cents) values ('parent', 10000);

select tests.reset_role();
update concierge.occasions set deleted_at = now() where id = :'m_del';
update public.people set deleted_at = now() where id = :'gone';
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
values (:'a', :'mom', :'m_bday', 2027, '2027-03-14', '2027-03-05', 7500, '2027-01-01T00:00:00Z')
returning id as r1 \gset

-- Settings
select is((select value::text from concierge.app_settings where key = 'round_engine_enabled'), '0', 'engine ships off');
select is((select value::text from concierge.app_settings where key = 'round_lock_minutes'), '10', 'lock minutes');
select is((select value::text from concierge.app_settings where key = 'round_max_attempts'), '3', 'max attempts');

-- round_sends
select has_column('concierge', 'gift_rounds', 'heads_up_on', 'rounds have a heads-up date');
insert into concierge.round_sends (round_id, user_id, step) values (:'r1', :'a', 'reminder_1');
select throws_ok($q$insert into concierge.round_sends (round_id, user_id, step) values ('$q$ || :'r1' || $q$', '$q$ || :'a' || $q$', 'reminder_1')$q$,
  '23505', null, 'a step is recorded once per round');
select tests.act_as(:'a');
select throws_ok($q$select * from concierge.round_sends$q$, '42501', null, 'signed-in users cannot read sends');
select throws_ok($q$insert into concierge.round_sends (round_id, user_id, step) values (gen_random_uuid(), gen_random_uuid(), 'x')$q$,
  '42501', null, 'signed-in users cannot write sends');

-- Function access
select throws_ok($q$select * from concierge.claim_due_rounds(now())$q$, '42501', null, 'users cannot claim due rounds');
select throws_ok($q$select concierge.claim_round(gen_random_uuid(), now())$q$, '42501', null, 'users cannot claim a round');
select throws_ok($q$select concierge.finish_round(gen_random_uuid(), now(), 'complete', null, null)$q$, '42501', null, 'users cannot finish a round');
select throws_ok($q$select * from concierge.round_candidates(current_date)$q$, '42501', null, 'users cannot list candidates');

-- Claims
select tests.act_as_server();
select is((select count(*)::int from concierge.claim_due_rounds('2027-02-01T00:00:00Z')), 1, 'a due round is claimed');
select is((select count(*)::int from concierge.claim_due_rounds('2027-02-01T00:00:00Z')), 0, 'a leased round is not claimed again');
select is((select attempts from concierge.claim_due_rounds('2027-02-01T00:11:00Z')), 2, 'after the lease lapses it is claimed again, attempts 2');
select is(concierge.claim_round(:'r1', '2027-02-01T00:11:30Z'), null, 'claim_round is null while the lease is live');

-- finish_round
select is(concierge.finish_round(:'r1', '2020-01-01T00:00:00Z', 'complete', null, null), false, 'stale lease changes nothing');
select is((select status::text from concierge.gift_rounds where id = :'r1'), 'scheduled', 'status unchanged after stale finish');
select tests.reset_role();
select locked_until as lease from concierge.gift_rounds where id = :'r1' \gset
select tests.act_as_server();
select is(concierge.finish_round(:'r1', :'lease', 'awaiting_approval', '2027-02-02T00:00:00Z', '2027-02-01'), true, 'the lease holder can finish');
select tests.reset_role();
select results_eq(
  format($q$select status::text, locked_until is null, attempts, heads_up_on from concierge.gift_rounds where id = %L$q$, :'r1'),
  $q$values ('awaiting_approval'::text, true, 0, '2027-02-01'::date)$q$,
  'finish sets status, clears lock, resets attempts, sets heads-up date');

-- Candidates
select tests.act_as_server();
select is((select count(*)::int from concierge.round_candidates('2027-02-01')), 4,
  'candidates leave out disabled, deleted-occasion and deleted-person occasions');
select is((select budget_cents from concierge.round_candidates('2027-02-01') where occasion_id = :'m_bday'), 7500, 'person budget wins');
select is((select budget_cents from concierge.round_candidates('2027-02-01') where occasion_id = :'m_anniv'), 10000, 'relationship default next');
select is((select budget_cents from concierge.round_candidates('2027-02-01') where occasion_id = :'p_bday'), null, 'no budget is null');

select * from finish();
rollback;
