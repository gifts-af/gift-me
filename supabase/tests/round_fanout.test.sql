-- ALL-125: the fan-out settings, the read-only due_rounds, and the daily limit
-- on round idea runs. Every date is 2031-06-15 or the days beside it, which no
-- other test uses.
begin;
\ir _helpers.psql
select plan(18);

select tests.create_user('fan-a@example.com') as a \gset
insert into concierge.accounts (user_id, paid_features) values (:'a', true);

-- A person and round for each scenario, so runs in one never touch another.
insert into public.people (user_id, name, relationship) values (:'a', 'Due', 'friend') returning id as p_due \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Leased', 'friend') returning id as p_leased \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Future', 'friend') returning id as p_future \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Done', 'friend') returning id as p_done \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim1', 'friend') returning id as p_l1 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim2', 'friend') returning id as p_l2 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim3', 'friend') returning id as p_l3 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim4', 'friend') returning id as p_l4 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim5', 'friend') returning id as p_l5 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim6', 'friend') returning id as p_l6 \gset

insert into concierge.occasions (user_id, person_id, kind) select :'a', p, 'christmas'
  from unnest(array[:'p_due', :'p_leased', :'p_future', :'p_done', :'p_l1', :'p_l2', :'p_l3', :'p_l4', :'p_l5', :'p_l6']::uuid[]) p;

create function pg_temp.mk_round(p_person uuid, p_status concierge.round_status, p_next timestamptz, p_locked timestamptz)
returns uuid language sql as $$
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  select o.user_id, o.person_id, o.id, 2031, '2031-12-25', '2031-12-15', 5000, p_status, p_next, p_locked
    from concierge.occasions o where o.person_id = p_person
  returning id;
$$;

select pg_temp.mk_round(:'p_due', 'scheduled', '2031-06-15 06:00+00', null) as r_due \gset
select pg_temp.mk_round(:'p_leased', 'scheduled', '2031-06-15 06:00+00', '2031-06-15 13:00+00') as r_leased \gset
select pg_temp.mk_round(:'p_future', 'scheduled', '2031-06-16 06:00+00', null) as r_future \gset
select pg_temp.mk_round(:'p_done', 'complete', '2031-06-15 06:00+00', null) as r_done \gset
select pg_temp.mk_round(:'p_l1', 'scheduled', '2031-06-15 06:00+00', null) as r_l1 \gset
select pg_temp.mk_round(:'p_l2', 'scheduled', '2031-06-15 06:00+00', null) as r_l2 \gset
select pg_temp.mk_round(:'p_l3', 'scheduled', '2031-06-15 06:00+00', null) as r_l3 \gset
select pg_temp.mk_round(:'p_l4', 'scheduled', '2031-06-15 06:00+00', null) as r_l4 \gset
select pg_temp.mk_round(:'p_l5', 'scheduled', '2031-06-15 06:00+00', null) as r_l5 \gset
select pg_temp.mk_round(:'p_l6', 'scheduled', '2031-06-15 06:00+00', null) as r_l6 \gset

-- ─── settings ────────────────────────────────────────────────────────────────
select is(concierge.setting_int('round_fanout_enabled'), 0, 'round_fanout_enabled ships off');
select ok(concierge.setting_int('idea_round_runs_per_day') > 0, 'idea_round_runs_per_day exists and is a positive integer');
select is(concierge.setting_int('idea_busy_retry_seconds'), 300, 'idea_busy_retry_seconds is 300');
select is(concierge.setting_int('idea_busy_retries_max'), 3, 'idea_busy_retries_max is 3');

-- ─── due_rounds ──────────────────────────────────────────────────────────────
select tests.act_as_server();
select is((select count(*)::int from concierge.due_rounds('2031-06-15 12:00+00') where id = :'r_due'), 1, 'due_rounds returns a due, unleased round');
select is((select count(*)::int from concierge.due_rounds('2031-06-15 12:00+00') where id = :'r_leased'), 0, 'due_rounds skips a leased round');
select is((select count(*)::int from concierge.due_rounds('2031-06-15 12:00+00') where id = :'r_future'), 0, 'due_rounds skips a future round');
select is((select count(*)::int from concierge.due_rounds('2031-06-15 12:00+00') where id = :'r_done'), 0, 'due_rounds skips a finished round');
select is((select locked_until from concierge.gift_rounds where id = :'r_due'), null, 'due_rounds leaves locked_until alone');
select is((select attempts from concierge.gift_rounds where id = :'r_due'), 0, 'due_rounds leaves attempts alone');

select tests.act_as_anon();
select throws_ok($q$select * from concierge.due_rounds(now())$q$, '42501', null, 'anon can''t run due_rounds');
select tests.act_as(:'a');
select throws_ok($q$select * from concierge.due_rounds(now())$q$, '42501', null, 'a signed-in user can''t run due_rounds');

-- ─── the daily limit ─────────────────────────────────────────────────────────
select tests.reset_role();
update concierge.app_settings set value = '2' where key = 'idea_round_runs_per_day';
-- Two round runs on the 15th (one at each end of the UTC day), one the day
-- before and one the day after, which don't count.
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values
  (:'a', :'p_l1', :'r_l1', '2031-06-15 00:00:00+00'),
  (:'a', :'p_l2', :'r_l2', '2031-06-15 23:59:59+00'),
  (:'a', :'p_l3', :'r_l3', '2031-06-14 23:59:59+00'),
  (:'a', :'p_l4', :'r_l4', '2031-06-16 00:00:00+00');
select tests.act_as_server();
select is((select refusal from concierge.start_idea_run(:'a', :'p_l5', :'r_l5', '2031-06-15 12:00+00')), 'daily_limit',
  'a third round run that day is refused');
select is((select count(*)::int from concierge.idea_runs where person_id = :'p_l5'), 0, 'the refused run added no row');
select ok((select run_id is not null from concierge.start_idea_run(:'a', :'p_l6', null, '2031-06-15 12:00+00')),
  'an on-demand run is allowed at the limit');
select is((select refusal from concierge.start_idea_run(:'a', :'p_l5', :'r_l5', '2031-06-15 13:00+00')), 'daily_limit',
  'the on-demand run did not count toward the limit');

-- ─── the setting missing ─────────────────────────────────────────────────────
select tests.reset_role();
delete from concierge.app_settings where key = 'idea_round_runs_per_day';
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.start_idea_run(%L, %L, %L, '2031-06-15 14:00+00')$q$, :'a', :'p_l5', :'r_l5'),
  'P0001', 'Idea run settings are missing', 'a round run raises when the daily limit setting is missing');

select ok((select run_id is not null from concierge.start_idea_run(:'a', :'p_l6', null, '2031-06-15 15:00+00')),
  'an on-demand run still starts when the setting is missing');

select * from finish();
rollback;
