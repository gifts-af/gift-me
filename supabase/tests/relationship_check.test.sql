-- Relationships are checked in the database: people and budget_defaults only
-- take the keys the app knows, so a base budget can't silently stop matching.
begin;
\ir _helpers.psql
select plan(12);

select tests.create_user('a@example.com') as a \gset

select has_function('public', 'is_relationship', array['text'], 'is_relationship exists');
select volatility_is('public', 'is_relationship', array['text'], 'immutable',
  'is_relationship is immutable, so a check can use it');
select col_has_check('public', 'people', 'relationship', 'people.relationship has a check');
select col_has_check('concierge', 'budget_defaults', 'relationship', 'budget_defaults.relationship has a check');

select tests.act_as(:'a');

-- ─── people ─────────────────────────────────────────────────────────────────

select lives_ok(
  $$insert into public.people (name, relationship)
    select 'P ' || r, r from unnest(array[
      'aunt', 'best_friend', 'boyfriend', 'brother', 'brother_in_law', 'daughter', 'daughter_in_law',
      'father', 'father_in_law', 'friend', 'girlfriend', 'grandfather', 'grandmother', 'husband',
      'mother', 'mother_in_law', 'partner', 'sister', 'sister_in_law', 'son', 'son_in_law', 'uncle',
      'wife', 'other']) as r$$,
  'every relationship the app offers is accepted');

select throws_ok(
  $$insert into public.people (name, relationship) values ('Mom', 'parent')$$,
  '23514', null, 'a relationship the app doesn''t know is refused');

select throws_ok(
  $$insert into public.people (name, relationship) values ('Mom', 'Mother')$$,
  '23514', null, 'the readable label is refused; the key is what is stored');

select throws_ok(
  $$select concierge.add_person(p_name => 'Mom', p_relationship => 'parent', p_kinds => array['christmas'])$$,
  '23514', null, 'add_person refuses an unknown relationship too');

select throws_ok(
  format('update public.people set relationship = %L where name = %L', 'mom', 'P mother'),
  '23514', null, 'changing a person to an unknown relationship is refused');
select is((select relationship from public.people where name = 'P mother'), 'mother',
  'and the person keeps the old one');

-- ─── budget_defaults ────────────────────────────────────────────────────────

select lives_ok(
  $$insert into concierge.budget_defaults (relationship, base_amount_cents) values ('friend', 5000)$$,
  'a default for a known relationship is saved');

select throws_ok(
  $$insert into concierge.budget_defaults (relationship, base_amount_cents) values ('parent', 10000)$$,
  '23514', null, 'a default for an unknown relationship is refused');

select * from finish();
rollback;
