-- When a search finds nothing: no second search without a new fact (round_idea_state,
-- start_idea_run), the sheet's answer (runs_after_rejection), and the earlier ideas coming back
-- (restore_rejected_ideas and what reject_round_ideas saves for it).
begin;
\ir _helpers.psql
select plan(84);

update concierge.app_settings set value = '1000' where key = 'idea_round_runs_per_day';
update concierge.app_settings set value = '1'
 where key in ('idea_engine_enabled', 'round_engine_enabled', 'restore_rejected_ideas_enabled');
update concierge.app_settings set value = '2' where key = 'idea_round_runs_max';
update concierge.app_settings set value = '2' where key = 'safety_buffer_days';

select tests.create_user('nn-buyer@example.com', 'Buyer') as a \gset
select tests.create_user('nn-mom@example.com', 'Mom') as mom \gset
insert into concierge.accounts (user_id, paid_features) values (:'a', true);
insert into lists.lists (owner_id, title) values (:'mom', 'Birthday') returning id as list_id, share_token as token \gset

-- A generating round under a lease, for a person of its own, 30 days before its ship-by day and
-- 37 before the occasion. "None of these" rejected ideas A ($45) and B ($45) 90 minutes ago, after
-- a run; the second and last run ended 'none' 30 minutes ago. The person's one fact is older than both.
create table tests.nn (label text primary key, round_id uuid, person_id uuid, user_id uuid, a uuid, b uuid, lock timestamptz);
grant select on tests.nn to service_role;

create function tests.nn_make(p_label text, p_user uuid)
returns void language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid; v_a uuid; v_b uuid; v_lock timestamptz := now() + interval '10 minutes';
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'Nora', 'friend') returning id into v_person;
  insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at)
  values (p_user, v_person, 'interest', 'Fishing', 'note', now() - interval '1 day');
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, v_person, v_occasion, 2030, current_date + 37, current_date + 30, 5000, 'generating', now(), v_lock)
  returning id into v_round;
  insert into concierge.gift_ideas (user_id, round_id, person_id, title, retailer, retailer_product_id, price_cents, est_total_cents,
                                    handling_days_max, delivery_days_min, delivery_days_max, rank, status)
  values (p_user, v_round, v_person, 'Fly rod', 'amazon', 'NN-A-' || p_label, 4000, 4500, 2, 3, 5, 1, 'rejected') returning id into v_a;
  insert into concierge.gift_ideas (user_id, round_id, person_id, title, retailer, retailer_product_id, price_cents, est_total_cents,
                                    handling_days_max, delivery_days_min, delivery_days_max, rank, status)
  values (p_user, v_round, v_person, 'Reel', 'amazon', 'NN-B-' || p_label, 4000, 4500, 2, 3, 5, 2, 'rejected') returning id into v_b;
  insert into concierge.rejections (user_id, round_id, idea_id, reason_code, created_at)
  values (p_user, v_round, v_a, 'not_style', now() - interval '90 minutes'), (p_user, v_round, v_b, 'not_style', now() - interval '90 minutes');
  insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
  values (p_user, v_person, v_round, now() - interval '2 hours', now() - interval '2 hours', 'saved'),
         (p_user, v_person, v_round, now() - interval '30 minutes', now() - interval '30 minutes', 'none');
  insert into tests.nn values (p_label, v_round, v_person, p_user, v_a, v_b, v_lock);
end $$;

-- Restores. "2 none proposed proposed": how many came back, why, and the status of A and of B.
create function tests.nn_restore(p_label text)
returns text language plpgsql as $$
declare n tests.nn; v_n integer; v_why text;
begin
  select * into n from tests.nn where label = p_label;
  select r.restored, r.outcome into v_n, v_why from concierge.restore_rejected_ideas(n.round_id, n.lock, now()) r;
  return format('%s %s %s %s', v_n, coalesce(v_why, '-'),
                (select status from concierge.gift_ideas where id = n.a), (select status from concierge.gift_ideas where id = n.b));
end $$;

create function tests.nn_do(p_label text, p_change text)
returns void language plpgsql as $$
declare n tests.nn; v text := p_change;
begin
  select * into n from tests.nn where label = p_label;
  v := replace(v, '$round', quote_literal(n.round_id));
  v := replace(v, '$person', quote_literal(n.person_id));
  v := replace(v, '$user', quote_literal(n.user_id));
  v := replace(v, '$a', quote_literal(n.a));
  v := replace(v, '$b', quote_literal(n.b));
  v := replace(v, '%label', p_label);
  execute v;
end $$;

-- Makes the round, runs p_change with its ids filled in, then restores.
create function tests.nn_case(p_label text, p_user uuid, p_change text)
returns text language plpgsql as $$
begin
  perform tests.nn_make(p_label, p_user);
  perform tests.nn_do(p_label, p_change);
  return tests.nn_restore(p_label);
end $$;

-- ─── No second search without a new fact (AC-11, AC-12, AC-13) ──────────────

create function tests.nn_left(p_label text) returns boolean language sql as $$
  select s.runs_left from tests.nn n, concierge.round_idea_state(n.round_id) s where n.label = p_label;
$$;
-- The round's runs, replaced by these outcomes, oldest first, the last 30 minutes ago.
create function tests.nn_runs(p_label text, p_outcomes text[]) returns void language sql as $$
  delete from concierge.idea_runs where round_id = (select round_id from tests.nn where label = p_label);
  insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
  select n.user_id, n.person_id, n.round_id, t.at, t.at, o.outcome
    from tests.nn n
    cross join unnest(p_outcomes) with ordinality o (outcome, i)
    cross join lateral (select now() - interval '30 minutes' - make_interval(mins => (array_length(p_outcomes, 1) - o.i)::int) as at) t
   where n.label = p_label;
$$;

select tests.nn_make('runs', :'a');
select tests.nn_runs('runs', array['none']);
select is(tests.nn_left('runs'), false, 'AC-11: after a run that found nothing, no run is left without a newer fact');
select is((select s.refusal from tests.nn n, concierge.start_idea_run(n.user_id, n.person_id, n.round_id, now()) s where n.label = 'runs'),
  'limit', 'AC-11: start_idea_run refuses it');
select tests.nn_runs('runs', array['none', 'no_credit']);
select is(tests.nn_left('runs'), false, 'AC-11: a no_credit run after it changes nothing');
select tests.nn_do('runs', $$insert into concierge.profile_facts (user_id, person_id, category, value, source, active) values ($user, $person, 'interest', 'Off', 'note', false)$$);
select tests.nn_runs('runs', array['none']);
select is(tests.nn_left('runs'), false, 'AC-11: a newer fact that is turned off doesn''t count');
select tests.nn_runs('runs', array['failed']);
select is(tests.nn_left('runs'), true, 'AC-13: after failed, a run is left');
select tests.nn_runs('runs', array['deadline']);
select is(tests.nn_left('runs'), true, 'AC-13: after deadline, a run is left');
select tests.nn_runs('runs', array['cost_cap']);
select is(tests.nn_left('runs'), true, 'AC-13: after cost_cap, a run is left');
update concierge.app_settings set value = '3' where key = 'idea_round_runs_max';
select tests.nn_runs('runs', array['failed', 'none']);
select is(tests.nn_left('runs'), false, 'AC-11: the last counted run decides');
select tests.nn_runs('runs', array['none', 'failed']);
select is(tests.nn_left('runs'), true, 'AC-13: ... either way');
update concierge.app_settings set value = '2' where key = 'idea_round_runs_max';
select tests.nn_do('runs', $$insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($user, $person, 'interest', 'New', 'note')$$);
select tests.nn_runs('runs', array['none', 'none']);
select is(tests.nn_left('runs'), true, 'AC-12: a newer fact earns the one extra run');
select tests.nn_runs('runs', array['none', 'none', 'none']);
select is(tests.nn_left('runs'), false, 'AC-12: never more than idea_round_runs_max and its one extra');
select tests.nn_runs('runs', array['none']);
select is(tests.nn_left('runs'), true, 'AC-12: with a newer fact, a run is left after none');
select ok((select s.run_id is not null from tests.nn n, concierge.start_idea_run(n.user_id, n.person_id, n.round_id, now()) s where n.label = 'runs'),
  'AC-12: start_idea_run starts it');

-- ─── The sheet's answer (AC-15) ─────────────────────────────────────────────

create function tests.nn_sheet(p_label text, p_facts jsonb) returns boolean language sql as $$
  select concierge.runs_after_rejection(n.round_id, p_facts, now(), true) from tests.nn n where n.label = p_label;
$$;
-- Every idea_round_runs_max, number of runs and last outcome: without a fact the sheet says what
-- round_idea_state says now; with a new one, the rejection does what the sheet said.
create function tests.nn_agree(p_user uuid) returns setof text language plpgsql as $$
declare v_max int; v_runs int; v_last text; v_label text; v_new boolean; v_done text;
begin
  for v_max in 0..3 loop
    update concierge.app_settings set value = to_jsonb(v_max) where key = 'idea_round_runs_max';
    for v_runs in 0..5 loop
      foreach v_last in array array['none', 'failed', 'saved'] loop
        v_label := format('agree %s %s %s', v_max, v_runs, v_last);
        perform tests.nn_make(v_label, p_user);
        if v_runs = 0 then
          perform tests.nn_do(v_label, 'delete from concierge.idea_runs where round_id = $round');
        else
          perform tests.nn_runs(v_label, array_fill('saved'::text, array[v_runs - 1]) || v_last);
        end if;
        perform tests.nn_do(v_label, $q$update concierge.gift_rounds set status = 'awaiting_approval' where id = $round$q$);
        perform tests.nn_do(v_label, $q$update concierge.gift_ideas set status = 'proposed' where id in ($a, $b)$q$);
        v_new := tests.nn_sheet(v_label, '[{"category": "avoid", "value": "Plastic"}]');
        if tests.nn_sheet(v_label, '[]') is distinct from tests.nn_left(v_label) then
          return next v_label || ' without a fact';
        end if;
        v_done := 'ok';
        begin
          perform concierge.reject_round_ideas(n.round_id, n.user_id, n.lock, 'not_style', 'Plastic',
                    '[{"category": "avoid", "value": "Plastic"}]', v_new, true)
             from tests.nn n where n.label = v_label;
        exception when sqlstate 'P0001' then
          v_done := sqlerrm;
        end;
        if v_done <> 'ok' then return next v_label || ' ' || v_done; end if;
      end loop;
    end loop;
  end loop;
  update concierge.app_settings set value = '2' where key = 'idea_round_runs_max';
end $$;
select is_empty(format('select * from tests.nn_agree(%L)', :'a'), 'AC-15: the sheet and the rejection agree for every idea_round_runs_max');

select tests.nn_make('sheet', :'a');
select tests.nn_runs('sheet', array['none']);
select is(array[tests.nn_sheet('sheet', '[{"category": "avoid", "value": "Plastic"}]'), tests.nn_sheet('sheet', '[]')],
  array[true, false], 'AC-15: one run of two ended none: a search only with a new fact');
select tests.nn_runs('sheet', array['none', 'none']);
select is(array[tests.nn_sheet('sheet', '[{"category": "avoid", "value": "Plastic"}]'), tests.nn_sheet('sheet', '[]')],
  array[true, false], 'AC-15: both runs used: the extra one, only with a new fact');

-- ─── reject_round_ideas marks the gift they already have (AC-4) ─────────────

-- A round awaiting approval with both ideas on offer and no run yet.
create function tests.nn_open(p_label text, p_user uuid) returns void language plpgsql as $$
begin
  perform tests.nn_make(p_label, p_user);
  perform tests.nn_do(p_label, $q$update concierge.gift_rounds set status = 'awaiting_approval' where id = $round$q$);
  perform tests.nn_do(p_label, $q$update concierge.gift_ideas set status = 'proposed' where round_id = $round$q$);
  perform tests.nn_do(p_label, $q$delete from concierge.rejections where round_id = $round$q$);
  perform tests.nn_do(p_label, $q$delete from concierge.idea_runs where round_id = $round$q$);
end $$;
create function tests.nn_owned(p_label text) returns text[] language sql as $$
  select array_agg(j.owned::text order by i.rank)
    from concierge.rejections j join concierge.gift_ideas i on i.id = j.idea_id
    join tests.nn n on n.round_id = j.round_id where n.label = p_label;
$$;

select tests.nn_open('own', :'a');
select tests.nn_do('own', $$select concierge.reject_round_ideas($round, $user, (select lock from tests.nn where label = 'own'),
  'has_it', null, '[]', true, false, p_owned_idea_id => $a)$$);
select is(tests.nn_owned('own'), array['true', 'false'], 'AC-4: only the gift they already have is marked owned');

select tests.nn_open('other reason', :'a');
select tests.nn_do('other reason', $$select concierge.reject_round_ideas($round, $user, (select lock from tests.nn where label = 'other reason'),
  'too_pricey', null, '[]', true, false, p_owned_idea_id => $a)$$);
select is(tests.nn_owned('other reason'), array['false', 'false'], '... and only for "Already has one"');

-- No search left: the reason is only noted, with the gift they have.
select tests.nn_open('noted', :'a');
select tests.nn_runs('noted', array['saved', 'saved', 'saved']);
select tests.nn_do('noted', $$select concierge.reject_round_ideas($round, $user, (select lock from tests.nn where label = 'noted'),
  'has_it', null, '[]', false, false, p_owned_idea_id => $a)$$);
select is((select array_agg(j.idea_id = n.a and j.owned and i.status = 'proposed') from concierge.rejections j join tests.nn n on n.round_id = j.round_id
            join concierge.gift_ideas i on i.id = j.idea_id where n.label = 'noted'),
  array[true], 'AC-4: noted only, the gift they already have is still marked owned, and stays on offer');
select tests.nn_open('noted other', :'a');
select tests.nn_runs('noted other', array['saved', 'saved', 'saved']);
select tests.nn_do('noted other', $$select concierge.reject_round_ideas($round, $user, (select lock from tests.nn where label = 'noted other'),
  'too_pricey', null, '[]', false, false, p_owned_idea_id => $a)$$);
select is((select array_agg(j.idea_id is null and not j.owned) from concierge.rejections j join tests.nn n on n.round_id = j.round_id where n.label = 'noted other'),
  array[true], '... and any other reason names no gift');
select tests.nn_open('noted stranger', :'a');
select tests.nn_runs('noted stranger', array['saved', 'saved', 'saved']);
select tests.nn_do('noted stranger', $$select concierge.reject_round_ideas($round, $user, (select lock from tests.nn where label = 'noted stranger'),
  'has_it', null, '[]', false, false, p_owned_idea_id => (select a from tests.nn where label = 'noted'))$$);
select is((select array_agg(j.idea_id is null and not j.owned) from concierge.rejections j join tests.nn n on n.round_id = j.round_id where n.label = 'noted stranger'),
  array[true], '... nor does one that isn''t this round''s');

select tests.nn_open('old call', :'a');
select tests.act_as_server();
select lives_ok(format($q$select concierge.reject_round_ideas(p_round_id => %L, p_user_id => %L, p_lock => %L, p_reason_code => 'has_it',
  p_reason_text => null, p_facts => '[]', p_expect_more => true, p_list_gifts => false)$q$, n.round_id, n.user_id, n.lock),
  'E7: the call the live code makes, without the owned idea, still works')
  from tests.nn n where n.label = 'old call';
select tests.reset_role();
select is(tests.nn_owned('old call'), array['false', 'false'], '... and marks nothing owned');
select is((select count(*)::int from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'concierge' and p.proname = 'reject_round_ideas'), 1, 'E7: there is one reject_round_ideas, so no call is ambiguous');

-- A list gift whose rejection doesn't say which gift they have (the live code's call, and rows
-- from before `owned`) counts as owned: it could be the one.
select tests.nn_open('old list call', :'a');
select tests.nn_do('old list call', $$update concierge.gift_ideas set source = 'list', list_item_id = gen_random_uuid() where id = $a$$);
select tests.nn_do('old list call', $$select concierge.reject_round_ideas($round, $user, (select lock from tests.nn where label = 'old list call'),
  'has_it', null, '[]', true, false)$$);
select is(tests.nn_owned('old list call'), array['true', 'false'], 'AC-4: the live code''s "Already has one" marks every list gift owned');
-- The migration's backfill, word for word.
select tests.nn_make('backfill', :'a');
select tests.nn_do('backfill', $$update concierge.gift_ideas set source = 'list', list_item_id = gen_random_uuid() where id = $a$$);
select tests.nn_do('backfill', $$update concierge.rejections set reason_code = 'has_it' where round_id = $round$$);
select tests.nn_make('backfill other', :'a');
select tests.nn_do('backfill other', $$update concierge.gift_ideas set source = 'list', list_item_id = gen_random_uuid() where id = $a$$);
update concierge.rejections j set owned = true
  from concierge.gift_ideas i
 where i.id = j.idea_id and i.list_item_id is not null and j.reason_code = 'has_it' and not j.owned;
select is(tests.nn_owned('backfill'), array['true', 'false'], 'AC-4: the backfill marks list gifts rejected as "Already has one"');
select is(tests.nn_owned('backfill other'), array['false', 'false'], '... and not ones rejected for another reason');

-- ─── the too-late email's key ───────────────────────────────────────────────

select lives_ok(format($q$insert into concierge.round_sends (round_id, user_id, step) values (%L, %L, 'no_ideas_late')$q$,
    (select round_id from tests.nn where label = 'own'), :'a'), 'round_sends takes no_ideas_late');

-- ─── restore_rejected_ideas: the ideas come back ────────────────────────────

select is(tests.nn_case('none', :'a', 'select 1'), '2 none proposed proposed', 'AC-1: a search that found nothing brings the rejected ideas back');
select is((select r.status::text || ' ' || (r.locked_until = n.lock)::text from concierge.gift_rounds r join tests.nn n on n.round_id = r.id where n.label = 'none'),
  'generating true', 'AC-17: the round stays generating, under its lease');
select is(tests.nn_restore('none'), '0 - proposed proposed', 'AC-18: a second call brings nothing back');
select is(tests.nn_case('failed', :'a', $$update concierge.idea_runs set outcome = 'failed' where round_id = $round and outcome = 'none'$$),
  '2 failed proposed proposed', 'AC-2: failed');
select is(tests.nn_case('cost_cap', :'a', $$update concierge.idea_runs set outcome = 'cost_cap' where round_id = $round and outcome = 'none'$$),
  '2 cost_cap proposed proposed', 'AC-2: cost_cap');
select is(tests.nn_case('deadline', :'a', $$update concierge.idea_runs set outcome = 'deadline' where round_id = $round and outcome = 'none'$$),
  '2 deadline proposed proposed', 'AC-2: deadline');
select is(tests.nn_case('pricey', :'a', $$update concierge.rejections set reason_code = 'too_pricey' where round_id = $round$$),
  '2 none proposed proposed', 'AC-5: Too pricey ideas come back');
select is(tests.nn_case('eve', :'a', $$update concierge.gift_rounds set ship_by_deadline = current_date + 1 where id = $round$$),
  '2 none proposed proposed', 'AC-3: the day before ship-by too');
select is(tests.nn_case('eve failed', :'a', $$with r as (update concierge.gift_rounds set ship_by_deadline = current_date + 1 where id = $round),
    d as (delete from concierge.idea_runs where round_id = $round and outcome = 'saved')
    update concierge.idea_runs set outcome = 'failed' where round_id = $round and outcome = 'none'$$),
  '2 failed proposed proposed', 'AC-3: that day a retry has no tick left to run in, so a failed run brings them back');
select is(tests.nn_case('died', :'a', $$update concierge.idea_runs set outcome = null, finished_at = null where round_id = $round and outcome = 'none'$$),
  '2 failed proposed proposed', 'AC-2: a last run killed before it could end counts as failed once its lease is over');
select is(tests.nn_case('old unfinished', :'a', $$insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values ($user, $person, $round, now() - interval '3 hours')$$),
  '2 none proposed proposed', 'a run that died long ago doesn''t stop it');
select is(tests.nn_case('no_credit after', :'a', $$insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome) values ($user, $person, $round, now() - interval '9 minutes', now() - interval '9 minutes', 'no_credit')$$),
  '2 none proposed proposed', 'the last counted run decides: a no_credit one isn''t counted');

-- ─── restore_rejected_ideas: which ideas ────────────────────────────────────

select is(tests.nn_case('owned', :'a', $$update concierge.rejections set owned = true where idea_id = $a$$),
  '1 none rejected proposed', 'AC-4: a gift they already have stays rejected');
select is(tests.nn_case('owned fact', :'a', $$insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at)
    values ($user, $person, 'owns', 'fly  ROD', 'rejection', now() - interval '80 minutes')$$),
  '1 none rejected proposed', 'AC-4: an AI idea named by an active owns fact stays rejected');
select is(tests.nn_case('owned off', :'a', $$insert into concierge.profile_facts (user_id, person_id, category, value, source, active, updated_at)
    values ($user, $person, 'owns', 'Fly rod', 'rejection', false, now() - interval '80 minutes')$$),
  '2 none proposed proposed', '... a turned-off one doesn''t count');
select is(tests.nn_case('owned long', :'a', $$with t as (update concierge.gift_ideas set title = E'\n ' || repeat('x', 600) where id = $a)
    insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at)
    values ($user, $person, 'owns', repeat('x', 500), 'rejection', now() - interval '80 minutes')$$),
  '1 none rejected proposed', 'AC-4: a long title matches its fact, trimmed and cut at 500 characters');
select is(tests.nn_case('too slow', :'a', $$update concierge.gift_ideas set delivery_days_max = 34 where id = $a$$),
  '1 none rejected proposed', 'AC-5: an idea that can''t arrive in time from today stays rejected');
select is(tests.nn_case('just in time', :'a', $$update concierge.gift_ideas set delivery_days_max = 33 where id = $a$$),
  '2 none proposed proposed', 'AC-5: ... one that just can comes back (37 days less the 2-day buffer)');
select is(tests.nn_case('unknown days', :'a', $$with x as (update concierge.gift_ideas set delivery_days_max = null where id = $a)
    update concierge.gift_ideas set handling_days_max = null where id = $b$$),
  '0 - rejected rejected', 'AC-5: unknown delivery days count as can''t');
create function tests.nn_order(p_round uuid, p_idea uuid, p_user uuid, p_status text, p_resolved boolean) returns void language sql as $$
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, resolved, failure_type, ship_to, ship_city, ship_state)
  values (p_user, p_round, p_idea, 'zinc_wallet', 4500, 100, p_status, p_resolved, case when p_status = 'failed' then 'out_of_stock' end, 'recipient', 'Dayton', 'OH');
$$;
select is(tests.nn_case('cancelled', :'a', $$select tests.nn_order($round, $a, $user, 'cancelled', false)$$),
  '1 none rejected proposed', 'AC-5: an idea with a cancelled order stays rejected');
select is(tests.nn_case('failed order', :'a', $$select tests.nn_order($round, $a, $user, 'failed', true)$$),
  '1 none rejected proposed', 'AC-5: ... with a failed one');
select is(tests.nn_case('refunded', :'a', $$select tests.nn_order($round, $a, $user, 'refunded', false)$$),
  '1 none rejected proposed', 'AC-5: ... with a refunded one');
select is(tests.nn_case('live', :'a', $$select tests.nn_order($round, $a, $user, 'placed', false)$$),
  '1 none rejected proposed', 'AC-5: ... with a live one');

-- A round of the person's in another year, with an idea for the same product and an order for it.
create function tests.nn_elsewhere(p_round uuid, p_retailer text, p_product text, p_item uuid, p_status text) returns void language plpgsql as $$
declare r concierge.gift_rounds; v_round uuid; v_idea uuid;
begin
  select * into r from concierge.gift_rounds where id = p_round;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
  values (r.user_id, r.person_id, r.occasion_id, 2029, current_date + 37, current_date + 30, 'ordered') returning id into v_round;
  insert into concierge.gift_ideas (user_id, round_id, title, retailer, retailer_product_id, source, list_item_id, price_cents, est_total_cents, rank, status)
  values (r.user_id, v_round, 'Fly rod', p_retailer, p_product, case when p_item is null then 'generated' else 'list' end, p_item, 4000, 4500, 1, 'selected')
  returning id into v_idea;
  perform tests.nn_order(v_round, v_idea, r.user_id, p_status, false);
end $$;
select is(tests.nn_case('elsewhere', :'a', $$select tests.nn_elsewhere($round, 'Amazon', 'NN-A-elsewhere', null, 'delivered')$$),
  '1 none rejected proposed', 'AC-5: a product bought for the person in another round stays rejected');
select is(tests.nn_case('elsewhere cancelled', :'a', $$select tests.nn_elsewhere($round, 'amazon', 'NN-A-elsewhere cancelled', null, 'cancelled')$$),
  '2 none proposed proposed', '... but not one whose order there was cancelled');

insert into lists.list_items (list_id, position, name, price_cents)
select :'list_id', g, 'Item ' || g, 4000 from generate_series(0, 5) g;
-- Makes A the list's g-th gift, and links the person to the list unless told not to.
create function tests.nn_list(p_idea uuid, p_item text, p_link boolean default true) returns void language plpgsql as $$
begin
  update concierge.gift_ideas set source = 'list', list_item_id = (select id from lists.list_items where name = p_item) where id = p_idea;
  if p_link then
    insert into lists.person_links (person_id, buyer_id, list_id, share_token)
    select i.person_id, i.user_id, l.id, l.share_token
      from concierge.gift_ideas i, lists.lists l
     where i.id = p_idea and l.id = (select list_id from lists.list_items where name = p_item);
  end if;
end $$;
select is(tests.nn_case('list', :'a', $$select tests.nn_list($a, 'Item 0')$$), '2 none proposed proposed', 'a list gift still shared and unclaimed comes back');
select is(tests.nn_case('unshared', :'a', $$select tests.nn_list($a, 'Item 0', false)$$), '1 none rejected proposed', 'AC-5: a list gift no longer shared stays rejected');
insert into lists.gift_claims (item_id, claimer_id, claimer_name) select id, null, 'Bea' from lists.list_items where name = 'Item 1';
select is(tests.nn_case('claimed', :'a', $$select tests.nn_list($a, 'Item 1')$$), '1 none rejected proposed', 'AC-5: a claimed list gift stays rejected');
insert into lists.gift_claims (item_id, claimer_id, claimer_name) select id, :'a', 'Buyer' from lists.list_items where name = 'Item 2';
select is(tests.nn_case('claimed mine', :'a', $$select tests.nn_list($a, 'Item 2')$$), '1 none rejected proposed', 'AC-5: ... by the buyer too');
select is(tests.nn_case('list elsewhere', :'a', $$with x as (select tests.nn_list($a, 'Item 3')), y as (select count(*) from x)
    select tests.nn_elsewhere($round, null, null, (select id from lists.list_items where name = 'Item 3'), 'delivered') from y$$),
  '1 none rejected proposed', 'AC-5: a list gift bought in another round stays rejected');
select is(tests.nn_case('owned list', :'a', $$with x as (update concierge.rejections set owned = true where idea_id = $a) select tests.nn_list($a, 'Item 4')$$),
  '1 none rejected proposed', 'AC-4: a list gift they already have stays rejected');
select is(tests.nn_case('noted list', :'a', $$with x as (insert into concierge.rejections (user_id, round_id, idea_id, reason_code, owned, created_at)
    values ($user, $round, $a, 'has_it', true, now() - interval '100 minutes')) select tests.nn_list($a, 'Item 4')$$),
  '1 none rejected proposed', 'AC-4: a list gift noted as one they have, then rejected with the rest, never comes back');
select is(tests.nn_case('named list', :'a', $$with x as (insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at)
    values ($user, $person, 'owns', 'Fly rod', 'note', now() - interval '1 day')) select tests.nn_list($a, 'Item 4')$$),
  '2 none proposed proposed', 'AC-4: a list gift is matched by owned only, never by its title');
select is(tests.nn_case('sets', :'a', $$update concierge.rejections set created_at = now() - interval '5 hours' where idea_id = $a$$),
  '1 none rejected proposed', 'AC-6: only the latest rejected set comes back');
select tests.nn_case('budget', :'a', $$with x as (update concierge.gift_rounds set budget_cents = 4400 where id = $round)
    update concierge.gift_ideas set est_total_cents = 4400, over_budget = true where id = $b$$);
select is((select array_agg(over_budget::text order by rank) from concierge.gift_ideas i join tests.nn n on n.round_id = i.round_id where n.label = 'budget'),
  array['true', 'false'], 'AC-7: each is marked over the budget, or not, again');

-- ─── restore_rejected_ideas: nothing comes back ─────────────────────────────

update concierge.app_settings set value = '0' where key = 'restore_rejected_ideas_enabled';
select is(tests.nn_case('switch', :'a', 'select 1'), '0 - rejected rejected', 'AC-19: switched off, nothing comes back');
update concierge.app_settings set value = '1' where key = 'restore_rejected_ideas_enabled';
update concierge.app_settings set value = '0' where key = 'idea_engine_enabled';
select is(tests.nn_case('engine', :'a', 'select 1'), '0 - rejected rejected', 'AC-9: with the idea engine off, nothing comes back');
update concierge.app_settings set value = '1' where key = 'idea_engine_enabled';
update concierge.app_settings set value = '0' where key = 'round_engine_enabled';
select is(tests.nn_case('rounds', :'a', 'select 1'), '0 - rejected rejected', 'AC-9: with the round engine off, nothing comes back');
update concierge.app_settings set value = '1' where key = 'round_engine_enabled';
update concierge.accounts set paid_features = false where user_id = :'a';
select is(tests.nn_case('unpaid', :'a', 'select 1'), '0 - rejected rejected', 'AC-9: for a buyer who isn''t paid, nothing comes back');
update concierge.accounts set paid_features = true where user_id = :'a';
select is(tests.nn_case('run left', :'a', $$insert into concierge.profile_facts (user_id, person_id, category, value, source) values ($user, $person, 'interest', 'New', 'note')$$),
  '0 - rejected rejected', 'AC-9: while a run is allowed, nothing comes back');
select is(tests.nn_case('never', :'a', $$delete from concierge.rejections where round_id = $round$$),
  '0 - rejected rejected', 'AC-9: a round that was never rejected gets nothing back');
select is(tests.nn_case('only noted', :'a', $$update concierge.rejections set idea_id = null where round_id = $round$$),
  '0 - rejected rejected', 'AC-9: a rejection that only noted a reason has no set to bring back');
select is(tests.nn_case('saved', :'a', $$update concierge.idea_runs set outcome = 'saved' where round_id = $round and outcome = 'none'$$),
  '0 - rejected rejected', 'the last counted run saved ideas: nothing comes back');
select is(tests.nn_case('has ideas', :'a', $$update concierge.gift_ideas set status = 'proposed' where id = $b$$),
  '0 - rejected proposed', 'a round with an idea that isn''t rejected gets nothing back');
select is(tests.nn_case('running', :'a', $$insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values ($user, $person, $round, now() - interval '1 second')$$),
  '0 - rejected rejected', 'while a run is going, nothing comes back');
select is(tests.nn_case('before', :'a', $$update concierge.idea_runs set started_at = now() - interval '91 minutes' where round_id = $round and outcome = 'none'$$),
  '0 - rejected rejected', 'no search ran since the set was rejected: nothing comes back');
select is(tests.nn_case('not generating', :'a', $$update concierge.gift_rounds set status = 'awaiting_approval' where id = $round$$),
  '0 - rejected rejected', 'only a generating round gets ideas back');
select is(tests.nn_case('closed', :'a', $$update concierge.gift_rounds set closed_at = now() where id = $round$$),
  '0 - rejected rejected', 'a closed round gets nothing back');
select is(tests.nn_case('ship-by', :'a', $$update concierge.gift_rounds set ship_by_deadline = current_date where id = $round$$),
  '0 - rejected rejected', 'on the ship-by day nothing comes back');
-- A round whose occasion's date moved (handle_occasion_moved) ended, and its lease went with it.
select tests.nn_make('moved', :'a');
update concierge.app_settings set value = '1' where key = 'moved_dates_close_rounds';
select tests.nn_do('moved', $$update concierge.occasions set kind = 'birthday', month = 3, day = 14 where person_id = $person$$);
select tests.nn_do('moved', $$update concierge.occasions set day = 15 where person_id = $person$$);
select is((select r.status::text from concierge.gift_rounds r join tests.nn n on n.round_id = r.id where n.label = 'moved'), 'skipped', 'the date moved, so the round ended');
select throws_ok($$select tests.nn_restore('moved')$$, 'P0001', 'restore_rejected_ideas: lease not held', 'AC-9: a round its moved date ended gets nothing back: its lease is gone');
select tests.nn_do('moved', $$update concierge.gift_rounds set locked_until = (select lock from tests.nn where label = 'moved') where id = $round$$);
select is(tests.nn_restore('moved'), '0 - rejected rejected', '... nor with a lease');
select tests.nn_make('lease', :'a');
select throws_ok(format('select * from concierge.restore_rejected_ideas(%L, now(), now())', (select round_id from tests.nn where label = 'lease')),
  'P0001', 'restore_rejected_ideas: lease not held', 'AC-18: only the run holding the lease brings ideas back');
select ok(not has_function_privilege('anon', 'concierge.restore_rejected_ideas(uuid, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'concierge.restore_rejected_ideas(uuid, timestamptz, timestamptz)', 'execute')
      and has_function_privilege('service_role', 'concierge.restore_rejected_ideas(uuid, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid)', 'execute')
      and has_function_privilege('service_role', 'concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid)', 'execute'),
  'only the server can call restore_rejected_ideas and reject_round_ideas');

-- ─── What came back buys like any idea (AC-16) ──────────────────────────────

select tests.nn_case('buy', :'a', $$update concierge.rejections set owned = true where idea_id = $a$$);
select tests.nn_do('buy', $$update concierge.gift_rounds set status = 'awaiting_approval' where id = $round$$);
create function tests.nn_approve(p_label text, p_idea uuid) returns int language plpgsql as $$
declare n tests.nn; v int;
begin
  select * into n from tests.nn where label = p_label;
  select count(*) into v from concierge.approve_round(n.round_id, n.user_id, n.lock,
    format('[{"idea_id": "%s", "max_price_cents": 4500, "fee_cents": 100, "ship_to": "recipient",
              "address": {"recipient_first_name": "Mary", "recipient_last_name": "Allen", "address_line1": "12 Oak St",
                          "city": "Dayton", "state": "OH", "zip": "45402", "country": "US"}}]', p_idea)::jsonb);
  return v;
end $$;
select throws_ok(format('select tests.nn_approve(''buy'', %L)', (select a from tests.nn where label = 'buy')),
  'P0001', 'approve_round: replaced', 'AC-16: an idea that stayed rejected is still refused');
select is((select tests.nn_approve('buy', b) from tests.nn where label = 'buy'), 1, 'AC-16: one that came back can be bought');

select * from finish();
rollback;
