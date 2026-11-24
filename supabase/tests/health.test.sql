-- The owner health email's database side: the tick's heartbeat row, the
-- health settings, idea runs that ended because the AI credit ran out (outcome
-- no_credit), which no runs rule counts, and health_snapshot, which lists what
-- needs the owner by id only.
begin;
\ir _helpers.psql
select plan(49);

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
        concierge.setting_int('ai_credit_low_cents'), concierge.setting_int('zinc_app_balance_low_cents'),
        concierge.setting_int('health_vendor_timeout_ms')],
  array[1, 1, 500, 500, 10000],
  'the five health settings exist with their defaults');
select is(
  (select count(*)::int from concierge.app_settings
    where key in ('health_email_enabled', 'health_all_clear_weekday', 'ai_credit_low_cents', 'zinc_app_balance_low_cents',
                  'health_vendor_timeout_ms')
      and coalesce(description, '') <> ''),
  5,
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


-- ─── health_snapshot ─────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'concierge.health_snapshot(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.health_snapshot(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'concierge.health_snapshot(timestamptz)', 'execute'),
  'anon and authenticated can''t execute health_snapshot');

-- The local database is shared, so rows other tests left behind may be open
-- rounds: lists are checked by fixture id, and status counts against a baseline.
-- p_now is Tuesday 2030-03-12, 14:00 UTC; hold_final_days is 2, so the
-- deadline cutoff is 2030-03-14.
select concierge.setting_int('round_max_attempts') as max_attempts \gset
select concierge.health_snapshot('2030-03-12 14:00Z') as baseline \gset

-- The fixture holds a name, an email, a street and a gift title, so the
-- privacy test can look for them in the snapshot.
select tests.create_user('jordan@example.com', 'Jordan') as j \gset
insert into concierge.accounts (user_id, paid_features) values (:'j', true);

-- A round for a fresh person, with the status, reason, deadline and attempts given.
create function tests.hs_round(p_user_id uuid, p_status concierge.round_status, p_reason text, p_ship_by date,
                               p_attempts integer default 0, p_closed_at timestamptz default null,
                               p_updated_at timestamptz default now())
returns uuid
language plpgsql
as $$
declare
  v_person uuid;
  v_occasion uuid;
  v_round uuid;
begin
  insert into public.people (user_id, name, relationship, address_line1, city, state, zip)
  values (p_user_id, 'Jordan Smith', 'friend', '12 Elm Street', 'Dayton', 'OH', '45402') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user_id, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, attention_reason, attempts, closed_at, updated_at)
  values (p_user_id, v_person, v_occasion, 2030, '2030-12-25', p_ship_by, 5000, p_status, p_reason, p_attempts,
          p_closed_at, p_updated_at)
  returning id into v_round;
  return v_round;
end;
$$;

-- An idea on a round, titled after the gift the privacy test looks for.
create function tests.hs_idea(p_round_id uuid, p_status text default 'selected')
returns uuid
language sql
as $$
  insert into concierge.gift_ideas (user_id, person_id, round_id, title, price_cents, est_total_cents, rank, status)
  select r.user_id, r.person_id, r.id, 'Lego castle', 4000, 4500, 1, p_status
    from concierge.gift_rounds r where r.id = p_round_id
  returning id;
$$;

-- An order on its own idea, with the status, hold reason and times given; it
-- was last changed when it was created unless p_updated_at says otherwise.
create function tests.hs_order(p_round_id uuid, p_status text, p_hold_reason text, p_created_at timestamptz,
                               p_updated_at timestamptz default null)
returns uuid
language sql
as $$
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status,
                                hold_reason, ship_to, ship_city, ship_state, created_at, updated_at)
  select r.user_id, r.id, tests.hs_idea(r.id), 'zinc_wallet', 4500, 100, p_status, p_hold_reason,
         'recipient', 'Dayton', 'OH', p_created_at, coalesce(p_updated_at, p_created_at)
    from concierge.gift_rounds r where r.id = p_round_id
  returning id;
$$;

-- How many entries in the snapshot's list p_list have p_field = p_id.
create function tests.hs_count(p_snapshot jsonb, p_list text, p_field text, p_id uuid)
returns integer
language sql
as $$
  select count(*)::int from jsonb_array_elements(p_snapshot -> p_list) e where e ->> p_field = p_id::text;
$$;

-- Rounds.
select tests.hs_round(:'j', 'scheduled', null, '2030-12-15', :max_attempts) as r_stuck \gset
select tests.hs_round(:'j', 'needs_attention', 'unconfirmed', '2030-12-15', :max_attempts) as r_unconf \gset
select tests.hs_round(:'j', 'ordered', null, '2030-12-15') as r_orders \gset
select tests.hs_round(:'j', 'needs_address', null, '2030-04-01') as r_far \gset
select tests.hs_round(:'j', 'needs_address', null, '2030-03-14') as r_near \gset
select tests.hs_round(:'j', 'needs_attention', 'funds', '2030-12-15') as r_funds \gset
select tests.hs_round(:'j', 'needs_attention', 'setup', '2030-12-15') as r_setup \gset
select tests.hs_round(:'j', 'needs_attention', 'address', '2030-03-13') as r_attn_address \gset
select tests.hs_round(:'j', 'complete', null, '2030-12-15', :max_attempts) as r_complete \gset
select tests.hs_round(:'j', 'delivered', null, '2030-12-15', :max_attempts) as r_delivered \gset
select tests.hs_round(:'j', 'awaiting_approval', null, '2030-12-15') as r_approval \gset
select tests.hs_round(:'j', 'needs_address', null, '2030-03-13', 0, '2030-03-01') as r_closed \gset
select tests.hs_round(:'j', 'skipped', null, '2030-12-15', :max_attempts) as r_skipped \gset
select tests.hs_round(:'j', 'generating', null, '2030-03-13') as r_gen_empty \gset
select tests.hs_round(:'j', 'generating', null, '2030-03-13') as r_gen_proposed \gset
select tests.hs_idea(:'r_gen_proposed', 'proposed');
select tests.hs_round(:'j', 'generating', null, '2030-12-15') as r_gen_far \gset
select tests.hs_round(:'j', 'generating', null, '2030-03-13') as r_gen_rejected \gset
select tests.hs_idea(:'r_gen_rejected', 'rejected');
select tests.hs_round(:'j', 'skipped', null, '2030-12-15', 0, null, '2030-03-10') as r_noideas \gset
select tests.hs_round(:'j', 'skipped', null, '2030-12-15', 0, null, '2030-03-04') as r_noideas_old \gset
-- Skipped after p_now, so not yet this week's.
select tests.hs_round(:'j', 'skipped', null, '2030-12-15', 0, null, '2030-03-13') as r_noideas_future \gset
insert into concierge.round_sends (user_id, round_id, step) values
  (:'j', :'r_noideas', 'no_ideas_again'),
  (:'j', :'r_noideas_old', 'no_ideas'),
  (:'j', :'r_noideas_future', 'no_ideas');

-- Orders.
select tests.hs_order(:'r_unconf', 'unconfirmed', null, '2030-03-10') as o_unconf \gset
select tests.hs_order(:'r_orders', 'placing', null, '2030-03-12 11:00Z') as o_stale \gset
select tests.hs_order(:'r_orders', 'placing', null, '2030-03-12 12:30Z') as o_after \gset
select tests.hs_order(:'r_orders', 'placing', null, '2030-03-20 13:45Z') as o_young \gset
select tests.hs_order(:'r_orders', 'held', 'retry', '2030-03-10') as o_retry \gset
select tests.hs_order(:'r_orders', 'held', 'paused', '2030-03-10') as o_paused \gset
select tests.hs_order(:'r_orders', 'held', 'funds', '2030-03-10') as o_funds \gset
select tests.hs_order(:'r_orders', 'held', 'not_allowed', '2030-03-10') as o_not_allowed \gset
-- Held for days, then moved to placing by today's tick.
select tests.hs_order(:'r_orders', 'placing', null, '2030-03-01', '2030-03-12 12:30Z') as o_moved \gset

-- Idea runs: one no_credit run in the last day, one older, one after p_now, and a saved one; failed runs the same.
insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
select user_id, person_id, id, t, t, o
  from concierge.gift_rounds,
       (values ('2030-03-12 12:00Z'::timestamptz, 'no_credit'), ('2030-03-11 12:00Z', 'no_credit'),
               ('2030-03-12 15:00Z', 'no_credit'), ('2030-03-12 13:00Z', 'saved'),
               ('2030-03-12 12:30Z', 'failed'), ('2030-03-11 13:30Z', 'failed'), ('2030-03-11 12:30Z', 'failed'),
               ('2030-03-12 15:30Z', 'failed'), ('2030-03-11 13:15Z', 'no_credit')) v (t, o)
 where id = :'r_stuck';
-- Started before the window, finished inside it.
insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
select user_id, person_id, id, '2030-03-11 12:50Z', '2030-03-11 13:10Z', 'failed' from concierge.gift_rounds where id = :'r_stuck';

-- Captures: one failed this week, one failed earlier, one failed after p_now, one extracted this week.
insert into concierge.captures (user_id, person_id, page_title, status, updated_at)
select user_id, person_id, 'Lego castle', s, u
  from concierge.gift_rounds,
       (values ('failed', '2030-03-10'::timestamptz), ('failed', '2030-03-01'), ('failed', '2030-03-13'), ('extracted', '2030-03-10')) v (s, u)
 where id = :'r_stuck';

-- Heartbeats: 7 days ago (outside the week), 6 days ago, a failed yesterday,
-- an ok today, an ok one after p_now, and a failed one a week on with nothing ok after it.
insert into concierge.tick_heartbeats (day, started_at, finished_at, result, rounds_failed, fanout_failed) values
  ('2030-03-05', '2030-03-05 12:00Z', '2030-03-05 12:03Z', 'ok', 10, 0),
  ('2030-03-06', '2030-03-06 12:00Z', '2030-03-06 12:03Z', 'ok', 2, 0),
  ('2030-03-11', '2030-03-11 12:00Z', '2030-03-11 12:03Z', 'failed', 1, 0),
  ('2030-03-12', '2030-03-12 12:00Z', '2030-03-12 12:04Z', 'ok', 0, 1),
  ('2030-03-15', '2030-03-15 12:00Z', '2030-03-15 12:03Z', 'ok', 0, 0),
  ('2030-03-19', '2030-03-19 12:00Z', '2030-03-19 12:03Z', 'failed', 0, 0);

select tests.act_as_server();
select concierge.health_snapshot('2030-03-12 14:00Z') as snap \gset
-- A week on, with no heartbeat row that day.
select concierge.health_snapshot('2030-03-20 14:00Z') as snap_later \gset
select tests.reset_role();

select is(
  array[tests.hs_count(:'snap', 'stuck_rounds', 'round_id', :'r_stuck'),
        tests.hs_count(:'snap', 'unconfirmed', 'order_id', :'o_unconf'),
        tests.hs_count(:'snap', 'placing_stale', 'order_id', :'o_stale'),
        tests.hs_count(:'snap', 'held_zinc', 'order_id', :'o_retry')],
  array[1, 1, 1, 1],
  'AC-1: a round at round_max_attempts, an unconfirmed order, a placing order from before the tick, a held retry order: each listed once by id');
select is(
  (select e from jsonb_array_elements(:'snap'::jsonb -> 'held_zinc') e where e ->> 'order_id' = :'o_retry'),
  jsonb_build_object('order_id', :'o_retry'::uuid, 'round_id', :'r_orders'::uuid, 'user_id', :'j'::uuid, 'hold_reason', 'retry'),
  'held_zinc carries the order, round, user and hold reason');
select is(tests.hs_count(:'snap', 'stuck_rounds', 'round_id', :'r_unconf'), 0, 'the unconfirmed order''s round isn''t also a stuck round');
select is(tests.hs_count(:'snap', 'placing_stale', 'order_id', :'o_after'), 0, 'a placing order created after today''s tick started isn''t listed');
select is(tests.hs_count(:'snap', 'placing_stale', 'order_id', :'o_moved'), 0, 'an old order moved to placing after today''s tick started isn''t listed');
select is(
  array[tests.hs_count(:'snap_later', 'placing_stale', 'order_id', :'o_young'),
        tests.hs_count(:'snap_later', 'placing_stale', 'order_id', :'o_after')],
  array[0, 1],
  'a placing order younger than placing_stale_minutes isn''t listed');
select is(
  tests.hs_count(:'snap', 'held_zinc', 'order_id', :'o_paused') + tests.hs_count(:'snap', 'held_zinc', 'order_id', :'o_funds'),
  0,
  'a held paused or funds order isn''t in held_zinc');
select is(
  (select e ->> 'hold_reason' from jsonb_array_elements(:'snap'::jsonb -> 'held_zinc') e where e ->> 'order_id' = :'o_not_allowed'),
  'not_allowed',
  'a held not_allowed order is in held_zinc');

select is(tests.hs_count(:'snap', 'deadline_close', 'round_id', :'r_far'), 0, 'AC-2: a needs_address round 20 days out isn''t deadline_close');
select is(
  (select e from jsonb_array_elements(:'snap'::jsonb -> 'deadline_close') e where e ->> 'round_id' = :'r_near'),
  jsonb_build_object('round_id', :'r_near'::uuid, 'user_id', :'j'::uuid, 'reason', 'address', 'ship_by_deadline', '2030-03-14'),
  'AC-4: one within hold_final_days is');
select is(tests.hs_count(:'snap', 'deadline_close', 'round_id', :'r_closed'), 0, 'a closed round isn''t deadline_close');
select is(
  (select e ->> 'reason' from jsonb_array_elements(:'snap'::jsonb -> 'deadline_close') e where e ->> 'round_id' = :'r_attn_address'),
  'address',
  'a needs_attention address round within hold_final_days is deadline_close');

select is(
  tests.hs_count(:'snap', 'stuck_rounds', 'round_id', :'r_skipped') + tests.hs_count(:'snap', 'stuck_rounds', 'round_id', :'r_noideas'),
  0,
  'a skipped round with closed_at null is not open');
select is(
  tests.hs_count(:'snap', 'stuck_rounds', 'round_id', :'r_complete') + tests.hs_count(:'snap', 'stuck_rounds', 'round_id', :'r_delivered'),
  0,
  'a complete or delivered round at round_max_attempts isn''t a stuck round');

-- Address: r_far and r_near (needs_address) and r_attn_address (needs_attention);
-- r_closed is closed. Funds: r_funds.
select is(
  array[(:'snap'::jsonb #>> '{weekly,waiting_address}')::int - (:'baseline'::jsonb #>> '{weekly,waiting_address}')::int,
        (:'snap'::jsonb #>> '{weekly,waiting_funds}')::int - (:'baseline'::jsonb #>> '{weekly,waiting_funds}')::int],
  array[3, 1],
  'AC-3 counts: one waiting on an address, one on funds');
select is(
  array[(:'snap'::jsonb #>> '{weekly,waiting_setup}')::int - (:'baseline'::jsonb #>> '{weekly,waiting_setup}')::int,
        (:'snap'::jsonb #>> '{weekly,waiting_approval}')::int - (:'baseline'::jsonb #>> '{weekly,waiting_approval}')::int],
  array[1, 1],
  'a setup round and an awaiting_approval round each add one to their weekly count');

select is(
  array[tests.hs_count(:'snap', 'ideas_waiting', 'round_id', :'r_gen_empty'),
        tests.hs_count(:'snap', 'ideas_waiting', 'round_id', :'r_gen_proposed'),
        tests.hs_count(:'snap', 'ideas_waiting', 'round_id', :'r_gen_far'),
        tests.hs_count(:'snap', 'ideas_waiting', 'round_id', :'r_gen_rejected')],
  array[1, 0, 0, 1],
  'ideas_waiting lists a generating round with no ideas within hold_final_days, not one with proposed ideas or one further out; rejected ideas don''t count');

select is((:'snap'::jsonb ->> 'no_credit_runs')::int, 2, 'no_credit_runs counts the last 25 hours only');
select is((:'snap'::jsonb ->> 'failed_runs')::int, 3, 'failed_runs counts runs that finished in the last 25 hours, as a check can start an hour later than the day before');
select is((:'snap'::jsonb #>> '{weekly,rounds_failed}')::int, 3, 'weekly rounds_failed sums the last 7 days of heartbeat rows');
select is((:'snap'::jsonb #>> '{weekly,no_ideas}')::int, 1, 'no_ideas counts a round skipped this week after a no_ideas send, not one from 8 days ago');
select is((:'snap'::jsonb #>> '{weekly,failed_captures}')::int, 1, 'failed_captures counts the last 7 days only');
select is(
  array[(:'snap'::jsonb ->> 'no_credit_runs')::int, (:'snap'::jsonb #>> '{weekly,no_ideas}')::int,
        (:'snap'::jsonb #>> '{weekly,failed_captures}')::int],
  array[2, 1, 1],
  'a run, skipped round or capture after p_now isn''t counted');

select is(
  :'snap'::jsonb -> 'tick',
  jsonb_build_object(
    'last_ok_finished_at', '2030-03-12T12:04:00+00:00',
    'today', jsonb_build_object('started_at', '2030-03-12T12:00:00+00:00', 'finished_at', '2030-03-12T12:04:00+00:00',
                                'result', 'ok', 'rounds_failed', 0, 'fanout_failed', 1)),
  'tick holds today''s row and the latest ok finish up to p_now');
select is(
  :'snap_later'::jsonb -> 'tick',
  jsonb_build_object('last_ok_finished_at', '2030-03-15T12:03:00+00:00', 'today', null),
  'today is null when the tick hasn''t started; last_ok_finished_at skips a failed row');

select ok(
  not (:'snap'::text ~ 'Jordan|jordan@|Elm Street|Lego'),
  'the snapshot''s text holds no name, email, street or gift title from the fixture');

delete from concierge.app_settings where key = 'placing_stale_minutes';
select throws_ok(
  $q$select concierge.health_snapshot('2030-03-12 14:00Z')$q$,
  'P0001', null, 'health_snapshot raises when a setting it reads is missing');

select * from finish();
rollback;
