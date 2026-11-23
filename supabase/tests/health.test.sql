-- The owner health email's database side (ALL-35): the tick's heartbeat row,
-- the health settings, and idea runs that ended because the AI credit ran out
-- (outcome no_credit), which no runs rule counts.
begin;
\ir _helpers.psql
select plan(21);

-- Rounds here need new ideas to be possible (runs_after_rejection); both engines ship off.
update concierge.app_settings set value = '1' where key in ('idea_engine_enabled', 'round_engine_enabled');
select concierge.setting_int('idea_round_runs_max') as runs_max \gset

select tests.create_user('a@example.com') as a \gset
insert into concierge.accounts (user_id, paid_features) values (:'a', true);

-- A round for a fresh person, so runs and facts in one test never touch another.
create function tests.h_round(p_user_id uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_person uuid;
  v_occasion uuid;
  v_round uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user_id, p_name, 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user_id, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
  values (p_user_id, v_person, v_occasion, 2030, '2030-12-25', '2030-12-15', 5000) returning id into v_round;
  return v_round;
end;
$$;

-- p_count finished runs for a round, an hour apart from p_from, each with p_outcome.
create function tests.h_runs(p_round_id uuid, p_count integer, p_from timestamptz, p_outcome text)
returns void
language sql
as $$
  insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
  select r.user_id, r.person_id, r.id, p_from + make_interval(hours => g), p_from + make_interval(hours => g), p_outcome
    from concierge.gift_rounds r, generate_series(0, p_count - 1) g
   where r.id = p_round_id;
$$;

select now() - interval '2 days' as base \gset

-- ─── Regression guard: a failed run still counts ─────────────────────────────
select tests.h_round(:'a', 'Failed') as r_failed \gset
select tests.h_runs(:'r_failed', :runs_max - 1, :'base', 'saved');
select tests.h_runs(:'r_failed', 1, :'base'::timestamptz + interval '1 day', 'failed');
select is((select runs_left from concierge.round_idea_state(:'r_failed')), false, 'a failed run still counts');

-- ─── tick_heartbeats: server only ────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'concierge.tick_heartbeats'::regclass), 'tick_heartbeats has RLS on');
select ok(
  not has_table_privilege('anon', 'concierge.tick_heartbeats', 'select')
  and not has_table_privilege('authenticated', 'concierge.tick_heartbeats', 'select'),
  'anon and authenticated can''t select tick_heartbeats');
select ok(has_table_privilege('service_role', 'concierge.tick_heartbeats', 'select'), 'service_role can select tick_heartbeats');

select ok(
  not has_function_privilege('anon', 'concierge.start_tick(date, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.start_tick(date, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'concierge.finish_tick(date, timestamptz, text, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.finish_tick(date, timestamptz, text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'concierge.add_tick_counts(date, timestamptz, integer)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.add_tick_counts(date, timestamptz, integer)', 'execute'),
  'anon and authenticated can''t execute start_tick, finish_tick or add_tick_counts');
select ok(
  has_function_privilege('service_role', 'concierge.start_tick(date, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'concierge.finish_tick(date, timestamptz, text, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'concierge.add_tick_counts(date, timestamptz, integer)', 'execute'),
  'service_role can execute start_tick, finish_tick and add_tick_counts');

-- ─── start_tick, finish_tick, add_tick_counts ────────────────────────────────
select tests.act_as_server();
select concierge.start_tick('2030-01-01', '2030-01-01 12:00Z');
select concierge.finish_tick('2030-01-01', '2030-01-01 12:03Z', 'ok', 0, 0);
select tests.reset_role();
select is(
  (select array_agg(array[result, finished_at::text, rounds_failed::text, fanout_failed::text])
     from concierge.tick_heartbeats where day = '2030-01-01'),
  array[array['ok', '2030-01-01 12:03:00+00', '0', '0']],
  'start_tick then finish_tick records one ok row');

select tests.act_as_server();
select concierge.start_tick('2030-01-02', '2030-01-02 12:00Z');
select concierge.finish_tick('2030-01-02', '2030-01-02 12:03Z', 'failed', 2, 3);
select concierge.start_tick('2030-01-02', '2030-01-02 13:00Z');
select tests.reset_role();
select is(
  (select array[started_at::text, coalesce(finished_at::text, 'null'), coalesce(result, 'null'), rounds_failed::text, fanout_failed::text]
     from concierge.tick_heartbeats where day = '2030-01-02'),
  array['2030-01-02 13:00:00+00', 'null', 'null', '0', '0'],
  'a second start_tick the same day clears finished_at and the counts');

select tests.act_as_server();
select concierge.start_tick('2030-01-03', '2030-01-03 12:00Z');
select concierge.add_tick_counts('2030-01-03', '2030-01-03 12:01Z', 1);
select concierge.add_tick_counts('2030-01-03', '2030-01-03 12:02Z', 1);
select concierge.finish_tick('2030-01-03', '2030-01-03 12:03Z', 'ok', 1, 4);
select tests.reset_role();
select is(
  (select array[rounds_failed, fanout_failed] from concierge.tick_heartbeats where day = '2030-01-03'),
  array[3, 4],
  'finish_tick adds rounds_failed to what add_tick_counts already added');
select is(
  (select started_at from concierge.tick_heartbeats where day = '2030-01-03'),
  '2030-01-03 12:00Z'::timestamptz,
  'add_tick_counts leaves an existing row''s started_at alone');

select tests.act_as_server();
select concierge.add_tick_counts('2030-01-04', '2030-01-04 12:05Z', 2);
select tests.reset_role();
select is(
  (select array[started_at::text, coalesce(finished_at::text, 'null'), rounds_failed::text]
     from concierge.tick_heartbeats where day = '2030-01-04'),
  array['2030-01-04 12:05:00+00', 'null', '2'],
  'add_tick_counts creates the day''s row with started_at = p_at');

select tests.act_as_server();
select concierge.finish_tick('2030-01-05', '2030-01-05 12:05Z', 'failed', 1, 0);
select tests.reset_role();
select is(
  (select array[started_at::text, finished_at::text, result, rounds_failed::text]
     from concierge.tick_heartbeats where day = '2030-01-05'),
  array['2030-01-05 12:05:00+00', '2030-01-05 12:05:00+00', 'failed', '1'],
  'finish_tick with no row inserts one with started_at = p_at');

select throws_ok(
  $q$insert into concierge.tick_heartbeats (day, started_at, result) values ('2030-02-01', now(), 'maybe')$q$,
  '23514', null, 'tick_heartbeats refuses an unknown result');
select throws_ok(
  $q$insert into concierge.tick_heartbeats (day, started_at, fanout_failed) values ('2030-02-02', now(), -1)$q$,
  '23514', null, 'tick_heartbeats refuses a negative count');

-- ─── Settings ────────────────────────────────────────────────────────────────
select is(
  array[concierge.setting_int('health_email_enabled'), concierge.setting_int('health_all_clear_weekday'),
        concierge.setting_int('ai_credit_low_cents'), concierge.setting_int('zinc_app_balance_low_cents')],
  array[1, 1, 500, 500],
  'the four health settings exist with their defaults');
select is(
  (select count(*)::int from concierge.app_settings
    where key in ('health_email_enabled', 'health_all_clear_weekday', 'ai_credit_low_cents', 'zinc_app_balance_low_cents')
      and coalesce(description, '') <> ''),
  4,
  'each health setting has a description');

-- ─── no_credit runs don't count ──────────────────────────────────────────────
select tests.h_round(:'a', 'Accepts') as r_accepts \gset
select lives_ok(
  format($q$select tests.h_runs(%L, 1, now(), 'no_credit')$q$, :'r_accepts'),
  'idea_runs accepts outcome no_credit');
select throws_ok(
  format($q$select tests.h_runs(%L, 1, now(), 'broke')$q$, :'r_accepts'),
  '23514', null, 'idea_runs still refuses an unknown outcome');

-- idea_round_runs_max runs, one of them no_credit, and no facts.
select tests.h_round(:'a', 'Max') as r_max \gset
select tests.h_runs(:'r_max', :runs_max - 1, :'base', 'saved');
select tests.h_runs(:'r_max', 1, :'base'::timestamptz + interval '1 day', 'no_credit');
select is((select runs_left from concierge.round_idea_state(:'r_max')), true, 'a no_credit run doesn''t use up the round''s runs');

-- The maximum runs, then a newer active fact, then a later no_credit run (B1).
select tests.h_round(:'a', 'Extra') as r_extra \gset
select tests.h_runs(:'r_extra', :runs_max, :'base', 'saved');
insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at)
select user_id, person_id, 'interest', 'tea', 'note', :'base'::timestamptz + interval '1 day'
  from concierge.gift_rounds where id = :'r_extra';
select tests.h_runs(:'r_extra', 1, :'base'::timestamptz + interval '1 day 1 hour', 'no_credit');
select is((select runs_left from concierge.round_idea_state(:'r_extra')), true, 'a no_credit run after a new fact leaves the extra run available');

-- runs_after_rejection's own extra-run branch: the maximum runs, then a
-- no_credit run later than p_now, and a new fact in p_facts (B1). Counting
-- the no_credit run would make it max + 1, or put the last start after p_now.
select tests.h_round(:'a', 'Reject') as r_reject \gset
select tests.h_runs(:'r_reject', :runs_max, :'base', 'saved');
select tests.h_runs(:'r_reject', 1, now() + interval '1 minute', 'no_credit');
select tests.act_as_server();
select is(
  concierge.runs_after_rejection(:'r_reject', '[{"category": "avoid", "value": "Too generic: Gift"}]', now(), false),
  true,
  'runs_after_rejection''s extra-run branch ignores a newer no_credit run');
select tests.reset_role();

select * from finish();
rollback;
