-- The idea engine's database side (ALL-27): on-demand ideas, run limits,
-- saving ideas, exclusions, the fact trigger and paid-only rounds.
begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select tests.create_user('c@example.com') as c \gset
insert into concierge.accounts (user_id, paid_features) values (:'a', true), (:'c', true);

-- One person per scenario, so runs started in one test never block another.
insert into public.people (user_id, name, relationship) values (:'a', 'Gone', 'friend') returning id as p_gone \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Busy', 'friend') returning id as p_busy \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Done', 'friend') returning id as p_done \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Lim', 'friend') returning id as p_lim \gset
insert into public.people (user_id, name, relationship) values (:'a', 'On', 'friend') returning id as p_on \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Kill', 'friend') returning id as p_kill \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Save', 'friend') returning id as p_save \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Excl', 'friend') returning id as p_excl \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Fact', 'friend') returning id as p_fact \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Gone2', 'friend') returning id as p_gone2 \gset
insert into public.people (user_id, name, relationship) values (:'b', 'Unpaid', 'friend') returning id as p_b \gset
insert into public.people (user_id, name, relationship) values (:'c', 'Other', 'friend') returning id as p_c \gset

-- One occasion per person; rounds differ by year where a person needs several.
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_done', 'christmas') returning id as o_done \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_lim', 'christmas') returning id as o_lim \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_on', 'christmas') returning id as o_on \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_kill', 'christmas') returning id as o_kill \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_save', 'christmas') returning id as o_save \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_excl', 'christmas') returning id as o_excl \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_fact', 'christmas') returning id as o_fact \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'b', :'p_b', 'christmas') returning id as o_b \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'c', :'p_c', 'christmas') returning id as o_c \gset

insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_done', :'o_done', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_done \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_lim', :'o_lim', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_lim \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_on', :'o_on', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_on \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_kill', :'o_kill', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_kill \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_save', :'o_save', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_save \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_excl', :'o_excl', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_excl \gset

select now() - interval '1 day' as base \gset

-- ─── Ownership and access ────────────────────────────────────────────────────
select tests.act_as_server();
select throws_ok(
  $q$insert into concierge.gift_ideas (user_id, title, price_cents, est_total_cents, rank) values (gen_random_uuid(), 'x', 1, 1, 1)$q$,
  '23514', null, 'an on-demand idea needs a person'
);

select tests.reset_role();
insert into concierge.idea_runs (user_id, person_id, started_at) values (:'a', :'p_busy', :'base'), (:'c', :'p_c', :'base');
select tests.act_as(:'a');
select is((select count(*)::int from concierge.idea_runs), 1, 'a user reads only their own runs');
select ok(
  not has_table_privilege('authenticated', 'concierge.idea_runs', 'insert')
  and not has_table_privilege('authenticated', 'concierge.idea_runs', 'update')
  and not has_table_privilege('authenticated', 'concierge.idea_runs', 'delete'),
  'a user can''t insert or update runs'
);
select tests.reset_role();
delete from concierge.idea_runs;

select tests.act_as_server();
update public.people set deleted_at = now() where id in (:'p_gone', :'p_gone2');
select is((select refusal from concierge.start_idea_run(:'a', :'p_gone', null, :'base')), 'not_found', 'start_idea_run refuses a deleted person');
select is((select refusal from concierge.start_idea_run(:'a', :'p_c', null, :'base')), 'not_found', 'start_idea_run refuses another user''s person');
select is((select refusal from concierge.start_idea_run(:'b', :'p_b', null, :'base')), 'not_paid', 'start_idea_run refuses without paid features');
select ok(
  not has_function_privilege('anon', 'concierge.start_idea_run(uuid, uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.start_idea_run(uuid, uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'concierge.save_ideas(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.save_ideas(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'concierge.excluded_products(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.excluded_products(uuid)', 'execute')
  and not has_function_privilege('anon', 'concierge.round_idea_state(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.round_idea_state(uuid)', 'execute')
  and has_function_privilege('service_role', 'concierge.start_idea_run(uuid, uuid, uuid, timestamptz)', 'execute'),
  'anon and authenticated can''t execute the new functions'
);

-- ─── Run limits ──────────────────────────────────────────────────────────────
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'a', :'r_done', 'Existing', 1000, 1100, 1);
select is((select refusal from concierge.start_idea_run(:'a', :'p_done', :'r_done', :'base')), 'done', 'start_idea_run refuses a round that has ideas');

select run_id as busy1 from concierge.start_idea_run(:'a', :'p_busy', null, :'base') \gset
select is((select refusal from concierge.start_idea_run(:'a', :'p_busy', null, (:'base'::timestamptz + interval '1 minute'))), 'busy',
  'a second on-demand run inside the lease is busy');
select ok((select refusal is null and run_id is not null from concierge.start_idea_run(:'a', :'p_busy', null, (:'base'::timestamptz + interval '11 minutes'))),
  'after the lease it starts');

-- An old fact, so nothing counts as new since the runs.
insert into concierge.profile_facts (user_id, person_id, category, value, source, updated_at)
values (:'a', :'p_lim', 'interest', 'chess', 'note', now() - interval '10 days');
select ok((select run_id is not null from concierge.start_idea_run(:'a', :'p_lim', :'r_lim', :'base')), 'first round run starts');
select ok((select run_id is not null from concierge.start_idea_run(:'a', :'p_lim', :'r_lim', (:'base'::timestamptz + interval '1 hour'))), 'second round run starts');
select is((select refusal from concierge.start_idea_run(:'a', :'p_lim', :'r_lim', (:'base'::timestamptz + interval '2 hours'))), 'limit',
  'a round gets two runs, then limit');
insert into concierge.profile_facts (user_id, person_id, category, value, source)
values (:'a', :'p_lim', 'interest', 'tea', 'note');
select ok((select run_id is not null from concierge.start_idea_run(:'a', :'p_lim', :'r_lim', (:'base'::timestamptz + interval '2 hours'))),
  'a fact added after the last run allows a third');
select is((select refusal from concierge.start_idea_run(:'a', :'p_lim', :'r_lim', (:'base'::timestamptz + interval '3 hours'))), 'limit',
  'never a fourth');

insert into concierge.profile_facts (user_id, person_id, category, value, source, active, updated_at)
values (:'a', :'p_on', 'dislike', 'wool', 'note', false, now() - interval '10 days') returning id as f_off \gset
select run_id from concierge.start_idea_run(:'a', :'p_on', :'r_on', :'base') \gset
select run_id from concierge.start_idea_run(:'a', :'p_on', :'r_on', (:'base'::timestamptz + interval '1 hour')) \gset
select is((select refusal from concierge.start_idea_run(:'a', :'p_on', :'r_on', (:'base'::timestamptz + interval '2 hours'))), 'limit', 'a second round is also capped');
update concierge.profile_facts set active = true where id = :'f_off';
select ok((select run_id is not null from concierge.start_idea_run(:'a', :'p_on', :'r_on', (:'base'::timestamptz + interval '2 hours'))),
  'turning a fact back on allows a third');

-- Two runs that were killed (never finished) still count.
insert into concierge.idea_runs (user_id, person_id, round_id, started_at)
values (:'a', :'p_kill', :'r_kill', :'base'), (:'a', :'p_kill', :'r_kill', (:'base'::timestamptz + interval '1 hour'));
select is((select refusal from concierge.start_idea_run(:'a', :'p_kill', :'r_kill', (:'base'::timestamptz + interval '2 hours'))), 'limit', 'a killed run counts');

-- ─── Saving and exclusions ───────────────────────────────────────────────────
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'a', :'r_save', 'Round idea', 1000, 1100, 1);
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values (:'a', :'p_save', :'r_save', :'base') returning id as run_round \gset
select is(concierge.save_ideas(:'run_round', '[{"title":"X","price_cents":100,"est_total_cents":110,"rank":1}]'::jsonb), 0,
  'save_ideas saves nothing for a round that has ideas');

insert into concierge.idea_runs (user_id, person_id, started_at) values (:'a', :'p_busy', :'base') returning id as run_od1 \gset
insert into concierge.idea_runs (user_id, person_id, started_at) values (:'a', :'p_busy', :'base') returning id as run_od2 \gset
insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, rank)
values (:'a', :'r_done', :'p_busy', 'Not mine to touch', 1, 1, 1);
select concierge.save_ideas(:'run_od1',
  '[{"title":"A","price_cents":100,"est_total_cents":110,"rank":1},{"title":"B","price_cents":100,"est_total_cents":110,"rank":2}]'::jsonb) as n1 \gset
select concierge.save_ideas(:'run_od2', '[{"title":"C","price_cents":100,"est_total_cents":110,"rank":1,"retailer_product_id":"B0C"}]'::jsonb) as n2 \gset
select is(
  (select array_agg(title order by title) from concierge.gift_ideas where person_id = :'p_busy' and round_id is null)
    || (select array_agg(title) from concierge.gift_ideas where person_id = :'p_busy' and round_id is not null),
  array['C', 'Not mine to touch'],
  'save_ideas replaces the previous on-demand set and leaves round ideas alone'
);

insert into concierge.idea_runs (user_id, person_id, started_at) values (:'a', :'p_gone2', :'base') returning id as run_gone \gset
select is(concierge.save_ideas(:'run_gone', '[{"title":"X","price_cents":100,"est_total_cents":110,"rank":1}]'::jsonb), 0,
  'save_ideas saves nothing once the person is deleted');

-- Exclusions: p_excl's round ideas have no person_id (as before this change).
insert into concierge.gift_ideas (user_id, round_id, title, retailer_product_id, price_cents, est_total_cents, rank, status) values
  (:'a', :'r_excl', 'ordered', 'B0ORD', 1, 1, 1, 'selected'),
  (:'a', :'r_excl', 'rejected', 'B0REJ', 1, 1, 2, 'rejected'),
  (:'a', :'r_excl', 'rejected by row', 'B0ROW', 1, 1, 3, 'proposed'),
  (:'a', :'r_excl', 'failed order', 'B0FAIL', 1, 1, 4, 'proposed'),
  (:'a', :'r_excl', 'plain', 'B0PLAIN', 1, 1, 5, 'proposed');
insert into concierge.gift_ideas (user_id, person_id, title, retailer_product_id, price_cents, est_total_cents, rank, status)
values (:'a', :'p_excl', 'on demand rejected', 'B0OD', 1, 1, 1, 'rejected');
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, ship_to, ship_city, ship_state, status)
select :'a', :'r_excl', id, 'zinc_wallet', 100, 0, 'recipient', 'Town', 'CA', case title when 'ordered' then 'placed' else 'failed' end
  from concierge.gift_ideas where round_id = :'r_excl' and title in ('ordered', 'failed order');
insert into concierge.rejections (user_id, round_id, idea_id, reason_code)
select :'a', :'r_excl', id, 'nope' from concierge.gift_ideas where title = 'rejected by row';
-- Another person's ordered product never shows up here.
insert into concierge.gift_ideas (user_id, round_id, title, retailer_product_id, price_cents, est_total_cents, rank)
values (:'a', :'r_save', 'someone else', 'B0ELSE', 1, 1, 9) returning id as other_idea \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, ship_to, ship_city, ship_state, status)
values (:'a', :'r_save', :'other_idea', 'zinc_wallet', 100, 0, 'recipient', 'Town', 'CA', 'placed');
select is(
  (select array_agg(x order by x) from concierge.excluded_products(:'p_excl') x),
  array['B0OD', 'B0ORD', 'B0REJ', 'B0ROW'],
  'excluded_products lists ordered and rejected products for that person only'
);
select ok(
  'B0ORD' in (select concierge.excluded_products(:'p_excl')) and (select person_id is null from concierge.gift_ideas where retailer_product_id = 'B0ORD'),
  'excluded_products includes an old round idea with no person_id'
);

-- ─── Rounds ──────────────────────────────────────────────────────────────────
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'p_fact', :'o_fact', 2030, '2030-12-25', '2030-12-15', 5000, 'scheduled', now() + interval '10 days') returning id as f_sched \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'a', :'p_fact', :'o_fact', 2031, '2031-12-25', '2031-12-15', 5000, 'awaiting_approval', now() + interval '10 days') returning id as f_wait \gset
select tests.act_as(:'a');
insert into concierge.profile_facts (person_id, category, value, source) values (:'p_fact', 'interest', 'jazz', 'note');
select tests.reset_role();
select ok(
  (select next_action_at = now() from concierge.gift_rounds where id = :'f_sched')
  and (select next_action_at > now() from concierge.gift_rounds where id = :'f_wait'),
  'a user''s fact save moves their waiting round to now and leaves awaiting_approval alone'
);

select tests.act_as_server();
select ok(
  exists (select 1 from concierge.round_candidates('2027-01-01') where person_id = :'p_c')
  and not exists (select 1 from concierge.round_candidates('2027-01-01') where person_id = :'p_b'),
  'round_candidates leaves out users without paid features'
);

select tests.reset_role();
insert into concierge.budgets (user_id, person_id, occasion_kind, amount_cents)
values (:'c', :'p_c', 'christmas', 12000), (:'c', :'p_c', 'any', 7500), (:'a', :'p_lim', 'any', 7500);
select tests.act_as_server();
select ok(
  (select budget_cents from concierge.round_candidates('2027-01-01') where person_id = :'p_c') = 12000
  and (select budget_cents from concierge.round_candidates('2027-01-01') where person_id = :'p_lim') = 7500,
  'round_candidates keeps the base budget order'
);

select * from finish();
rollback;
