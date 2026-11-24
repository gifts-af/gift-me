-- Moving a birthday or anniversary ends its open round when no gift is chosen, and frees its place
-- for the year, so the real date can have a round.
begin;
\ir _helpers.psql
select no_plan();

select tests.create_user('moved@example.com') as u \gset
select tests.create_user('moved-other@example.com') as other \gset

-- A Dec 28 occasion for a new person, with a round in p_status; returns the occasion.
create function tests.md_occasion(p_user uuid, p_status text, p_kind text default 'birthday') returns uuid language plpgsql as $$
declare
  v_person uuid;
  v_occasion uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind, month, day)
  values (p_user, v_person, p_kind, case when p_kind <> 'christmas' then 12 end, case when p_kind <> 'christmas' then 28 end)
  returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at, locked_until)
  values (p_user, v_person, v_occasion, 2030, '2030-12-28', current_date + 30, 9000, p_status::concierge.round_status, now(), now() + interval '5 minutes');
  return v_occasion;
end;
$$;
create function tests.md_round(p_occasion uuid) returns concierge.gift_rounds language sql as $$
  select r from concierge.gift_rounds r where r.occasion_id = p_occasion order by r.created_at, r.id limit 1;
$$;
create function tests.md_order(p_occasion uuid, p_status text, p_failure text default null) returns uuid language plpgsql as $$
declare
  r concierge.gift_rounds := tests.md_round(p_occasion);
  v_idea uuid;
  v_order uuid;
begin
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
  values (r.user_id, r.id, 'Gift', 4000, 4500, 1) returning id into v_idea;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, failure_type, ship_to, ship_city, ship_state)
  values (r.user_id, r.id, v_idea, 'zinc_wallet', 4500, 100, p_status, case when p_status = 'held' then 'funds' end, p_failure, 'recipient', 'Dayton', 'OH')
  returning id into v_order;
  return v_order;
end;
$$;
create function tests.md_move(p_occasion uuid, p_month integer, p_day integer) returns void language sql as $$
  update concierge.occasions set month = p_month, day = p_day where id = p_occasion;
$$;
-- Every column the same, so nothing touched the row.
create function tests.md_same(p_before concierge.gift_rounds) returns boolean language sql as $$
  select r is not distinct from p_before from concierge.gift_rounds r where r.id = p_before.id;
$$;

-- AC-1: an open round with no orders ends, in every open status.
create temp table md_open as
  select s as status, tests.md_occasion(:'u', s) as occasion
    from unnest(array['scheduled', 'generating', 'awaiting_approval', 'needs_address']) s;
select tests.md_move(occasion, 12, 27) from md_open;
select is((tests.md_round(occasion)).status::text, 'skipped', 'AC-1 ' || status || ': ends') from md_open;
select ok((tests.md_round(occasion)).occasion_year is null and (tests.md_round(occasion)).closed_at is not null
      and (tests.md_round(occasion)).locked_until is null and (tests.md_round(occasion)).next_action_at is null,
  'AC-1 ' || status || ': its place, lease and next step are gone') from md_open;
select is((select count(*)::int from concierge.round_sends s where s.round_id in (select (tests.md_round(occasion)).id from md_open)), 0, 'AC-1: nothing is recorded to send');

-- AC-1 through the owner's own client.
select tests.md_occasion(:'u', 'awaiting_approval') as mine \gset
select tests.act_as(:'u');
update concierge.occasions set month = 1, day = 5 where id = :'mine';
select tests.reset_role();
select is((tests.md_round(:'mine')).status::text, 'skipped', 'AC-1: the owner''s own update ends it');

-- AC-2: only failed orders.
select tests.md_occasion(:'u', 'needs_attention') as f \gset
select tests.md_order(:'f', 'failed', 'out_of_stock') as f1 \gset
select tests.md_order(:'f', 'failed', 'store_cancelled') as f2 \gset
select tests.md_move(:'f', 12, 20);
select ok((tests.md_round(:'f')).status = 'skipped' and (tests.md_round(:'f')).occasion_year is null, 'AC-2: a round with only failed orders ends');
select ok((select bool_and(resolved) from concierge.orders where id in (:'f1', :'f2')), 'AC-2: its failures are dealt with, so none can be replaced');
select is((select failed_after_close from concierge.orders where id = :'f1'), true, 'AC-2: an untold failure goes to the late email');
select is((select failed_after_close from concierge.orders where id = :'f2'), false, 'AC-2: a store cancel does not (the daily news tells it)');

-- AC-5: any live order, next to a failed one too, leaves everything as it was.
create temp table md_live as
  select s as status, tests.md_occasion(:'u', 'needs_attention') as occasion
    from unnest(array['held', 'placing', 'unconfirmed', 'placed', 'shipped', 'delivered', 'refunded', 'cancelled']) s;
select tests.md_order(occasion, status) from md_live;
select tests.md_order(occasion, 'failed', 'price_up') from md_live;
create temp table md_before as select status, tests.md_round(occasion) as r from md_live;
create temp table md_orders as select o from concierge.orders o where o.round_id in (select (b.r).id from md_before b);
select tests.md_move(occasion, 12, 20) from md_live;
select ok(tests.md_same(r), 'AC-5 ' || status || ': the round is unchanged') from md_before;
select is((select count(*)::int from concierge.orders o join md_orders m on (m.o).id = o.id where o is not distinct from m.o), 16, 'AC-5: no order changed, so a held one isn''t cancelled');

-- AC-5: rounds already ended, and one closed while it still needs attention.
create temp table md_ended as
  select s as status, tests.md_occasion(:'u', s) as occasion from unnest(array['skipped', 'ordered', 'delivered', 'complete']) s;
create temp table md_ended_before as select status, tests.md_round(occasion) as r from md_ended;
select tests.md_move(occasion, 12, 20) from md_ended;
select ok(tests.md_same(r), 'AC-5 ended ' || status || ': unchanged') from md_ended_before;
select tests.md_occasion(:'u', 'needs_attention') as closed \gset
update concierge.gift_rounds set closed_at = now() where occasion_id = :'closed';
select tests.md_move(:'closed', 12, 20);
select is((tests.md_round(:'closed')).occasion_year, 2030, 'AC-5: a closed round keeps its place');

-- AC-6: two moves, then a round for the last date.
select tests.md_occasion(:'u', 'scheduled') as twice \gset
select tests.md_move(:'twice', 1, 5);
select tests.md_move(:'twice', 1, 6);
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
select user_id, person_id, id, 2030, '2030-01-06', '2029-12-28', 9000 from concierge.occasions where id = :'twice';
select is((select count(*)::int from concierge.gift_rounds where occasion_id = :'twice' and occasion_year is null), 1, 'AC-6: the ended round stays ended after a second move');
select is((select count(*)::int from concierge.gift_rounds where occasion_id = :'twice' and occasion_year = 2030), 1, 'AC-6: the same year can have a round again');

-- AC-7: leap days, and a date the checks allow but isn't real.
select tests.md_occasion(:'u', 'scheduled') as leap \gset
select lives_ok(format('select tests.md_move(%L, 2, 29)', :'leap'), 'AC-7: moved to Feb 29');
select is((tests.md_round(:'leap')).occasion_year, null, 'AC-7: and its round ends');
update concierge.gift_rounds set status = 'scheduled', closed_at = null, occasion_year = 2030 where occasion_id = :'leap';
select lives_ok(format('select tests.md_move(%L, 2, 31)', :'leap'), 'AC-7: from Feb 29 to a date that isn''t real');
select is((tests.md_round(:'leap')).occasion_year, null, 'AC-7: the rule still applies');

-- AC-14: the switch.
select tests.md_occasion(:'u', 'scheduled') as off \gset
update concierge.app_settings set value = '0' where key = 'moved_dates_close_rounds';
select tests.md_move(:'off', 12, 1);
select is((tests.md_round(:'off')).status::text, 'scheduled', 'AC-14: 0 leaves the round open');
delete from concierge.app_settings where key = 'moved_dates_close_rounds';
select tests.md_move(:'off', 12, 2);
select is((tests.md_round(:'off')).status::text, 'scheduled', 'AC-14: so does a missing setting');
insert into concierge.app_settings (key, value) values ('moved_dates_close_rounds', '1');

-- AC-15: anything else.
select tests.md_occasion(:'u', 'scheduled') as same \gset
select tests.md_move(:'same', 12, 28);
update concierge.occasions set updated_at = now() where id = :'same';
select is((tests.md_round(:'same')).status::text, 'scheduled', 'AC-15: an unchanged date changes nothing');
update concierge.occasions set kind = 'anniversary' where id = :'same';
select is((tests.md_round(:'same')).status::text, 'scheduled', 'AC-15: nor does its kind alone');
select lives_ok(format('update concierge.occasions set kind = ''christmas'', month = null, day = null where id = %L', :'same'), 'AC-15: changing it to a holiday saves');
select is((tests.md_round(:'same')).status::text, 'scheduled', 'AC-15: and ends nothing');
select tests.md_occasion(:'other', 'scheduled') as theirs \gset
select tests.act_as(:'u');
update concierge.occasions set month = 3 where id = :'theirs';
select tests.reset_role();
select is((tests.md_round(:'theirs')).status::text, 'scheduled', 'AC-15: another user can''t end a round');

-- Only a skipped round can lack a year.
select throws_ok(format('update concierge.gift_rounds set occasion_year = null where occasion_id = %L', :'off'), '23514', null, 'an open round always has a year');
select ok(not has_function_privilege('authenticated', 'concierge.handle_occasion_moved()', 'execute')
      and not has_function_privilege('anon', 'concierge.handle_occasion_moved()', 'execute'), 'nobody can call the trigger''s function');

-- AC-9: idea runs refuse a round that ended.
select (tests.md_round(:'mine')).id as ended, (tests.md_round(:'mine')).person_id as ended_person \gset
insert into concierge.accounts (user_id, paid_features) values (:'u', true) on conflict (user_id) do update set paid_features = true;
select is((select refusal from concierge.start_idea_run(:'u', :'ended_person', :'ended', now())), 'closed', 'AC-9: no run starts for it');
select is((select count(*)::int from concierge.idea_runs where round_id = :'ended'), 0, 'AC-9: and none is recorded');
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values (:'u', :'ended_person', :'ended', now()) returning id as run \gset
select is(concierge.save_ideas(:'run', '[{"title": "Mug", "price_cents": 100, "est_total_cents": 100, "rank": 1}]'), -1, 'AC-9: a run under way saves nothing');
select is((select count(*)::int from concierge.gift_ideas where round_id = :'ended'), 0, 'AC-9: no ideas');

-- AC-16: the weekly health count.
select (concierge.health_snapshot(now()) #>> '{weekly,no_ideas}')::int as before \gset
insert into concierge.round_sends (round_id, user_id, step) values (:'ended', :'u', 'no_ideas');
select is((concierge.health_snapshot(now()) #>> '{weekly,no_ideas}')::int, :before, 'AC-16: not counted under no_ideas');

select * from finish();
rollback;
