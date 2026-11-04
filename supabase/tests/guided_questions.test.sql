-- Guided questions and fact deletes (ALL-26, T53, D51).
begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select is(concierge.setting_int('guided_questions_max'), 5, 'up to 5 questions at a time');
select is(concierge.setting_int('guided_answer_max_facts'), 20, 'one answer makes at most 20 facts');
select is(concierge.setting_int('readiness_points_interests'), 30, 'interests are worth the most');
select is(concierge.setting_int('readiness_points_own_list'), 40, 'their own list counts');
select is(concierge.setting_int('readiness_ready_pct'), 60, 'ready from 60');
select is(concierge.setting_int('readiness_meter_enabled'), 1, 'the meter is on');

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Dad', 'parent');
select id as dad from public.people where name = 'Dad' \gset

-- Answering: facts, marked as the buyer's own, and no raw text kept.
select is(
  concierge.answer_questions(:'dad', '[{"key":"interests","prompt":"What are they into right now?","category":"interest","values":["fly fishing","crime podcasts"]}]'::jsonb),
  2, 'an answer saves one fact per value');
select is(
  (select count(*)::int from concierge.profile_facts where person_id = :'dad' and source = 'question' and confirmed and active),
  2, 'the facts are source=question, confirmed and active');
select is(
  (select source_id from concierge.profile_facts where person_id = :'dad' and value = 'fly fishing'),
  (select id from concierge.questions where person_id = :'dad' and question_key = 'interests'),
  'a fact points at its question');
select is(
  (select answer from concierge.questions where person_id = :'dad' and question_key = 'interests'),
  null::text, 'the raw answer is not kept (D51)');

-- Answering again: one question row; a turned-off fact comes back, not doubled.
update concierge.profile_facts set active = false, confirmed = false where value = 'fly fishing';
select is(
  concierge.answer_questions(:'dad', '[{"key":"interests","prompt":"What are they into right now?","category":"interest","values":["Fly  Fishing"]}]'::jsonb),
  1, 'answering again counts the value');
select is(
  (select count(*)::int from concierge.questions where person_id = :'dad' and question_key = 'interests'),
  1, 'one row per question');
select ok(
  (select active and confirmed from concierge.profile_facts where value = 'fly fishing'),
  'an answer matching a turned-off fact turns it back on');

select throws_ok(
  format($q$select concierge.answer_questions(%L, '[{"key":"x","prompt":"p","category":"mood","values":["v"]}]'::jsonb)$q$, :'dad'),
  '23514', null, 'an unknown category is refused');

-- Another user: can't answer about my person, can't delete my fact.
select tests.act_as(:'b');
select throws_ok(
  format($q$select concierge.answer_questions(%L, '[{"key":"wants","prompt":"p","category":"wants","values":["v"]}]'::jsonb)$q$, :'dad'),
  'P0002', null, 'someone else''s person is refused');
delete from concierge.profile_facts where value = 'crime podcasts';

select tests.act_as(:'a');
select is(
  (select count(*)::int from concierge.profile_facts where value = 'crime podcasts'),
  1, 'another user''s delete removes nothing');

-- Delete is real for the owner.
delete from concierge.profile_facts where value = 'crime podcasts';
select is(
  (select count(*)::int from concierge.profile_facts where value = 'crime podcasts'),
  0, 'the owner''s delete erases the fact');

-- A deleted person can't take answers.
select public.delete_person(:'dad');
select throws_ok(
  format($q$select concierge.answer_questions(%L, '[{"key":"wants","prompt":"p","category":"wants","values":["v"]}]'::jsonb)$q$, :'dad'),
  'P0002', null, 'a deleted person is refused');

select tests.reset_role();
select ok(
  not has_function_privilege('anon', 'concierge.answer_questions(uuid, jsonb)', 'execute'),
  'signed-out visitors can''t call it');

select * from finish();
rollback;
