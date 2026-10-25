-- Concierge tables about the people a user buys for (design §3, T19, T24, D31).
begin;
\ir _helpers.psql
select plan(25);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- New accounts take their over-budget percent from app settings (T23).
update concierge.app_settings set value = '20' where key = 'default_over_budget_pct';

-- A sets up two people with one of everything for Mom.
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent'), ('Dad', 'parent');
select id as mom from public.people where name = 'Mom' \gset
select id as dad from public.people where name = 'Dad' \gset

insert into concierge.accounts (user_id) values (:'a');
insert into concierge.budget_defaults (relationship, base_amount_cents) values ('parent', 10000);
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14);
insert into concierge.occasions (person_id, kind) values (:'mom', 'mothers_day'), (:'dad', 'fathers_day');
insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (:'mom', 'birthday', 12000);
insert into concierge.captures (person_id, source_url, status) values (:'mom', 'https://example.com', 'pending');
insert into concierge.profile_facts (person_id, category, value, source) values (:'mom', 'interest', 'gardening', 'note');
insert into concierge.questions (person_id, prompt, status) values (:'mom', 'Favorite color?', 'open');

select is((select over_budget_pct from concierge.accounts), 20, 'a new account takes the over-budget default from app settings');
select is((select funding_mode from concierge.accounts), 'zinc_wallet', 'an account starts in Zinc wallet mode');
select is((select count(*)::int from concierge.occasions), 3, 'A sees their own occasions');

-- A changes their own preferences, but only the server sets money fields.
update concierge.accounts set over_budget_pct = 10, notification_prefs = '{"email": true}';
select is((select over_budget_pct from concierge.accounts), 10, 'A can change their over-budget percent');
select throws_ok(
  $q$update concierge.accounts set zinc_api_key_secret_id = gen_random_uuid()$q$,
  '42501', null, 'A cannot point their account at a Zinc key'
);
select throws_ok(
  $q$update concierge.accounts set funding_mode = 'connect'$q$,
  '42501', null, 'A cannot change how gifts are paid for'
);

-- B sees none of it.
select tests.act_as(:'b');
select throws_ok(
  format($q$insert into concierge.accounts (user_id, zinc_api_key_secret_id) values (%L, gen_random_uuid())$q$, :'b'),
  '42501', null, 'nobody can create their account with a Zinc key attached'
);
select is((select count(*)::int from concierge.accounts), 0, 'B cannot see A''s account');
select is((select count(*)::int from concierge.budget_defaults), 0, 'B cannot see A''s budget defaults');
select is((select count(*)::int from concierge.occasions), 0, 'B cannot see A''s occasions');
select is((select count(*)::int from concierge.budgets), 0, 'B cannot see A''s budgets');
select is((select count(*)::int from concierge.captures), 0, 'B cannot see A''s captures');
select is((select count(*)::int from concierge.profile_facts), 0, 'B cannot see A''s facts');
select is((select count(*)::int from concierge.questions), 0, 'B cannot see A''s questions');

-- B can't attach their own rows to A's person.
select throws_ok(
  format('insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (%L, %L, 5000)', :'mom', 'christmas'),
  '23503', null, 'B cannot add a budget to A''s person'
);
select throws_ok(
  format('insert into concierge.profile_facts (person_id, category, value, source) values (%L, %L, %L, %L)', :'mom', 'avoid', 'x', 'note'),
  '23503', null, 'B cannot add a fact to A''s person'
);

-- Occasion rules: birthdays need a month and day, holidays must not have one.
select tests.act_as(:'a');
select throws_ok(
  format('insert into concierge.occasions (person_id, kind) values (%L, %L)', :'dad', 'birthday'),
  '23514', null, 'a birthday needs a month and day'
);
select throws_ok(
  format('insert into concierge.occasions (person_id, kind, month, day) values (%L, %L, 12, 25)', :'dad', 'christmas'),
  '23514', null, 'a holiday takes its date from the rule, not a month and day'
);
select throws_ok(
  $q$update concierge.accounts set over_budget_pct = 150$q$,
  '23514', null, 'over-budget percent stays between 0 and 100'
);

-- Signed-out visitors can't reach the schema at all.
select tests.act_as_anon();
select throws_ok('select * from concierge.occasions', '42501', null, 'anon cannot read concierge tables');

-- Functions added to the schema later aren't callable by users unless granted.
select tests.reset_role();
create function concierge.probe() returns int language sql as 'select 1';
select ok(not has_function_privilege('authenticated', 'concierge.probe()', 'execute'), 'new concierge functions are not executable by users by default');
select ok(not has_function_privilege('authenticated', 'concierge.enable_owner_rls(regclass)', 'execute'), 'users cannot run the RLS helper');

-- Deleting Mom removes everything about her, and Dad keeps his occasion.
select tests.act_as(:'a');
delete from public.people where id = :'mom';
select is(
  (select count(*)::int from concierge.occasions) + (select count(*)::int from concierge.budgets)
    + (select count(*)::int from concierge.captures) + (select count(*)::int from concierge.profile_facts)
    + (select count(*)::int from concierge.questions),
  1,
  'deleting a person removes their occasions, budgets, captures, facts and questions'
);
select is((select kind from concierge.occasions), 'fathers_day', 'other people keep their data');
select is((select count(*)::int from concierge.budget_defaults), 1, 'budget defaults are per user, not per person');

select * from finish();
rollback;
