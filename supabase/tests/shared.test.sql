-- Shared tables in `public`: profiles and people (design §3, T19, T25).
begin;
\ir _helpers.psql
select plan(19);

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
select is(
  (select timezone from public.profiles where id = :'a'),
  null,
  'timezone starts unknown rather than assumed'
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

-- The profile's email follows the account's email.
update auth.users set email = 'a2@example.com' where id = :'a';
select is((select email from public.profiles where id = :'a'), 'a2@example.com', 'a changed account email updates the profile');

-- A's people are A's alone.
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent');
select is((select count(*)::int from public.people), 1, 'A sees their own person');
select is((select count(*)::int from public.profiles), 1, 'A sees only their own profile');

-- A edits their own name and timezone, but not their email.
update public.profiles set display_name = 'A', timezone = 'America/Chicago';
select is((select timezone from public.profiles), 'America/Chicago', 'A can set their timezone');
select throws_ok(
  $q$update public.profiles set email = 'victim@example.com'$q$,
  '42501', null, 'A cannot change the email we send to'
);

-- Only the server links a person to someone's account.
select throws_ok(
  format('update public.people set linked_user_id = %L', :'b'),
  '42501', null, 'A cannot link a person to another account'
);
select throws_ok(
  format('insert into public.people (name, relationship, linked_user_id) values (%L, %L, %L)', 'X', 'friend', :'b'),
  '42501', null, 'A cannot create a person linked to another account'
);

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
  '42501', null, 'A cannot create a person owned by B'
);

-- The backfill is for the server only.
select throws_ok('select public.backfill_profiles()', '42501', null, 'signed-in users cannot run the backfill');

-- Signed-out visitors see nothing.
select tests.act_as_anon();
select throws_ok('select * from public.people', '42501', null, 'anon cannot read people');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');

select tests.reset_role();
select is((select count(*)::int from public.people), 2, 'both people still exist');

-- Deleting an account removes its profile and people, with nothing in the way.
delete from auth.users where id = :'a';
select is(
  (select count(*)::int from public.profiles where id = :'a') + (select count(*)::int from public.people where user_id = :'a'),
  0,
  'deleting an account removes its profile and people'
);

select * from finish();
rollback;
