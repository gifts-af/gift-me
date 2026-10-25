-- Shared tables in `public`: profiles and people (design §3, T19).
begin;
\ir _helpers.psql
select plan(11);

select tests.create_user('a@example.com', 'Aaron') as a \gset
select tests.create_user('b@example.com') as b \gset

-- A profile is created at sign-up, with the display name from sign-up.
select is(
  (select display_name from public.profiles where id = :'a'),
  'Aaron',
  'sign-up creates a profile with the display name'
);
select is(
  (select email from public.profiles where id = :'b'),
  'b@example.com',
  'sign-up copies the email into the profile'
);

-- Users who signed up before profiles existed get one from the backfill.
-- (Simulated by removing a fresh user's profile, since tests can't switch
-- off triggers on Supabase's auth tables.)
select tests.create_user('old@example.com', 'Old') as old \gset
delete from public.profiles where id = :'old';
select public.backfill_profiles();
select is(
  (select display_name from public.profiles where id = :'old'),
  'Old',
  'the backfill gives an existing user a profile'
);

-- A's people are A's alone.
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent');
select is((select count(*)::int from public.people), 1, 'A sees their own person');
select is((select count(*)::int from public.profiles), 1, 'A sees only their own profile');

select tests.act_as(:'b');
insert into public.people (name, relationship) values ('Jim', 'child');
select is((select count(*)::int from public.people where name = 'Mom'), 0, 'B cannot see A''s people');

-- Updates and deletes of someone else's row do nothing.
update public.people set name = 'Hacked' where name = 'Mom';
delete from public.people where name = 'Mom';
select tests.act_as(:'a');
select is((select name from public.people), 'Mom', 'B cannot change or delete A''s person');

-- Rows can't be created for someone else.
select throws_ok(
  format('insert into public.people (user_id, name, relationship) values (%L, %L, %L)', :'b', 'Fake', 'friend'),
  '42501',
  null,
  'A cannot create a person owned by B'
);

-- Signed-out visitors see nothing.
select tests.act_as_anon();
select throws_ok('select * from public.people', '42501', null, 'anon cannot read people');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');

select tests.reset_role();
select is((select count(*)::int from public.people), 2, 'both people still exist');

select * from finish();
rollback;
