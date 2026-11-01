-- People v1.2 (ALL-21): birth year, profile photos, one occasion per kind,
-- and add_person, which saves a person and their occasions together.
begin;
\ir _helpers.psql
select plan(32);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- ─── add_person ─────────────────────────────────────────────────────────────

select tests.act_as(:'a');
select concierge.add_person('Mom', 'parent', array['christmas', 'mothers_day'], null, null, null, null, null) as mom \gset

select is((select count(*)::int from public.people where id = :'mom' and name = 'Mom' and relationship = 'parent'), 1,
  'add_person saves a person with only a name and relationship');
select is((select array_agg(kind order by kind) from concierge.occasions where person_id = :'mom'),
  array['christmas', 'mothers_day'], 'add_person adds one occasion per kind');
select is((select count(*)::int from concierge.occasions where person_id = :'mom' and enabled), 2,
  'those occasions are enabled');
select is((select user_id from public.people where id = :'mom'), :'a'::uuid, 'the person belongs to the caller');

select concierge.add_person('Sam', 'friend', array['birthday', 'anniversary'], 3, 14, 1985, 6, 1) as sam \gset
select is((select month * 100 + day from concierge.occasions where person_id = :'sam' and kind = 'birthday'), 314,
  'the birthday month and day go on the birthday occasion');
select is((select month * 100 + day from concierge.occasions where person_id = :'sam' and kind = 'anniversary'), 601,
  'the anniversary month and day go on the anniversary occasion');
select is((select birth_year from public.people where id = :'sam')::int, 1985, 'the birth year is saved');

select throws_ok(
  $$select concierge.add_person('Pat', 'friend', array['birthday'], null, null, null, null, null)$$,
  '23514', null, 'a birthday kind without a month and day is refused');
select is((select count(*)::int from public.people where name = 'Pat'), 0,
  'and the person is not left behind (one transaction)');

-- The optional dates default to null, so a call can name just what it has.
select concierge.add_person(p_name => 'Lee', p_relationship => 'friend', p_kinds => array['christmas']) as lee \gset
select is((select count(*)::int from public.people where id = :'lee' and birth_year is null), 1,
  'add_person works with only a name, relationship and kinds, by named arguments');
select is((select count(*)::int from concierge.occasions where person_id = :'lee' and kind = 'christmas' and enabled), 1,
  'and still adds the occasion');

-- ─── one occasion per kind ──────────────────────────────────────────────────

select throws_ok(
  format('insert into concierge.occasions (person_id, kind) values (%L, %L)', :'mom', 'christmas'),
  '23505', null, 'two enabled occasions of one kind for a person are refused');

select tests.reset_role();
update concierge.occasions set deleted_at = now() where person_id = :'mom' and kind = 'christmas';
select tests.act_as(:'a');
select lives_ok(
  format('insert into concierge.occasions (person_id, kind) values (%L, %L)', :'mom', 'christmas'),
  'a soft-deleted occasion does not block a new one of that kind');

-- ─── birth year and photo path ──────────────────────────────────────────────

select throws_ok(
  format('update public.people set birth_year = 1899 where id = %L', :'sam'),
  '23514', null, 'a birth year of 1899 is refused');
select throws_ok(
  format('update public.people set birth_year = 2101 where id = %L', :'sam'),
  '23514', null, 'a birth year of 2101 is refused');
select lives_ok(
  format('update public.people set birth_year = 1900, photo_path = %L where id = %L', :'a' || '/' || :'sam' || '/x.jpg', :'sam'),
  'birth year 1900 and a photo path can be saved');
select throws_ok(
  format('update public.people set linked_user_id = %L where id = %L', :'a', :'sam'),
  '42501', null, 'users still cannot set linked_user_id');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'people' and column_name = 'birthday'), 0,
  'people.birthday is gone');

-- ─── another user can do nothing with it ────────────────────────────────────

select tests.act_as(:'b');
select is((select count(*)::int from public.people), 0, 'another user cannot see the person');
select is((select count(*)::int from concierge.occasions), 0, 'another user cannot see its occasions');

with u as (update public.people set name = 'Hacked' where id = :'mom' returning 1)
select is((select count(*)::int from u), 0, 'another user updating the person changes 0 rows');
select throws_ok(
  format('insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (%L, %L, 100)', :'mom', 'christmas'),
  null, null, 'another user adding a budget for the person is refused');
with u as (update concierge.occasions set enabled = false where person_id = :'mom' returning 1)
select is((select count(*)::int from u), 0, 'another user updating its occasions changes 0 rows');

select concierge.add_person('Mine', 'friend', array['christmas'], null, null, null, null, null) as mine \gset
select is((select user_id from public.people where id = :'mine'), :'b'::uuid,
  'add_person always creates rows owned by the caller');
select tests.reset_role();
select is((select count(*)::int from public.people where user_id = :'a' and name = 'Mine'), 0,
  'and never for someone else');

-- ─── signed-out visitors ────────────────────────────────────────────────────

select tests.act_as_anon();
select throws_ok(
  $$select concierge.add_person('X', 'friend', array['christmas'], null, null, null, null, null)$$,
  '42501', null, 'a signed-out visitor cannot call add_person');

-- ─── person-photos bucket ───────────────────────────────────────────────────

select tests.reset_role();
select is((select public from storage.buckets where id = 'person-photos'), false, 'the person-photos bucket is private');

select tests.act_as(:'a');
select lives_ok(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'person-photos', :'a' || '/' || :'sam' || '/a.jpg'),
  'a user can store a photo in their own folder');
select throws_ok(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'person-photos', :'b' || '/' || :'sam' || '/a.jpg'),
  '42501', null, 'but not in another user''s folder');
select tests.act_as(:'b');
select is((select count(*)::int from storage.objects where bucket_id = 'person-photos'), 0,
  'another user selects 0 photo rows');

-- ─── settings ───────────────────────────────────────────────────────────────

select tests.act_as(:'a');
select is(concierge.setting_int('person_photo_max_upload_bytes'), 10485760, 'the upload size setting is readable');
select is(concierge.setting_int('person_photo_px'), 512, 'the stored photo size setting is readable');

select * from finish();
rollback;
