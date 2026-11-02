-- Fact categories and settings for capture extraction (ALL-25).
begin;
\ir _helpers.psql
select plan(10);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select is(concierge.setting_int('capture_fact_min_confidence_pct'), 60, 'confidence cut setting');
select is(concierge.setting_int('capture_extraction_enabled'), 1, 'extraction is on by default');
select is(concierge.setting_int('capture_extract_timeout_ms'), 40000, 'a model call gives up after 40 s');

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Dad', 'parent');
select id as dad from public.people where name = 'Dad' \gset

select lives_ok(
  format('insert into concierge.profile_facts (person_id, category, value, source) values (%L, %L, %L, %L)', :'dad', 'wants', 'rotary vise', 'capture'),
  'a wants fact can be saved');
select lives_ok(
  format('insert into concierge.profile_facts (person_id, category, value, source) values (%L, %L, %L, %L)', :'dad', 'constraint', 'prefers large-grip items', 'capture'),
  'a constraint fact can be saved');
select throws_ok(
  format('insert into concierge.profile_facts (person_id, category, value, source) values (%L, %L, %L, %L)', :'dad', 'mood', 'x', 'capture'),
  '23514', null, 'an unknown category is refused');

select throws_ok(
  format('insert into concierge.profile_facts (person_id, category, value, source) values (%L, %L, %L, %L)', :'dad', 'wants', '  Rotary   VISE ', 'capture'),
  '23505', null, 'the same fact twice for one person is refused, ignoring case and spacing');
select lives_ok(
  format('insert into concierge.profile_facts (person_id, category, value, source) values (%L, %L, %L, %L)', :'dad', 'owns', 'rotary vise', 'capture'),
  'the same value under another category is fine');

select tests.act_as(:'b');
select is((select count(*)::int from concierge.profile_facts), 0, 'B cannot see A''s facts');
update concierge.profile_facts set active = false;
select tests.act_as(:'a');
select is((select count(*)::int from concierge.profile_facts where active), 3, 'B cannot remove A''s facts');

select * from finish();
rollback;
