-- Amazon paste lookups through Zinc (ALL-141): the settings, and the daily
-- allowance lists.take_amazon_lookup() hands out per signed-in person.
begin;
\ir _helpers.psql
select plan(25);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- ─── Settings ───────────────────────────────────────────────────────────────

select is(concierge.setting_int('amazon_paste_lookup_enabled'), 1, 'Amazon paste lookups are on');
select is(concierge.setting_int('amazon_paste_lookups_per_user_per_day'), 30, '30 lookups a day per person');
select is(concierge.setting_int('amazon_paste_lookup_timeout_ms'), 10000, 'a lookup waits up to 10 s');

-- ─── Who can call it ────────────────────────────────────────────────────────

select function_privs_are('lists', 'take_amazon_lookup', array[]::text[], 'anon', array[]::text[], 'anon can''t take a lookup');
select function_privs_are('lists', 'take_amazon_lookup', array[]::text[], 'authenticated', array['EXECUTE'], 'signed-in people can');
select is((select prosecdef from pg_proc where oid = 'lists.take_amazon_lookup()'::regprocedure), true, 'it runs as its owner');

select tests.act_as_anon();
select throws_ok('select lists.take_amazon_lookup()', '42501', null, 'anon is refused');
select tests.reset_role();

-- Signed in as no one (a token with no sub): refused too.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('role', 'authenticated', true);
select throws_ok('select lists.take_amazon_lookup()', '42501', 'Not authenticated', 'no user, no lookup');
select tests.reset_role();

-- ─── The table is the server's alone ────────────────────────────────────────

select table_privs_are('lists', 'amazon_lookups', 'authenticated', array[]::text[], 'signed-in people can''t touch the table');
select table_privs_are('lists', 'amazon_lookups', 'anon', array[]::text[], 'anon can''t touch the table');
select is((select relrowsecurity from pg_class where oid = 'lists.amazon_lookups'::regclass), true, 'row level security is on');

-- ─── The allowance ──────────────────────────────────────────────────────────

update concierge.app_settings set value = '3' where key = 'amazon_paste_lookups_per_user_per_day';

-- A used two lookups yesterday-and-a-bit ago: they don't count, and go. B's
-- old lookup goes too (T42: nobody's rows linger past a day).
insert into lists.amazon_lookups (user_id, created_at) values
  (:'a', now() - interval '25 hours'),
  (:'a', now() - interval '3 days'),
  (:'b', now() - interval '2 days');

select tests.act_as(:'a');
select is(lists.take_amazon_lookup(), true, 'first lookup');
select is(lists.take_amazon_lookup(), true, 'second lookup');
select is(lists.take_amazon_lookup(), true, 'third lookup, the limit');
select is(lists.take_amazon_lookup(), false, 'the fourth is over the limit');
select is(lists.take_amazon_lookup(), false, 'and stays over');
select tests.reset_role();

select is((select count(*)::int from lists.amazon_lookups where user_id = :'a'), 3, 'refused lookups aren''t recorded');
select is(
  (select count(*)::int from lists.amazon_lookups where user_id = :'a' and created_at < now() - interval '1 day'),
  0,
  'A''s rows older than a day were deleted'
);
select is((select count(*)::int from lists.amazon_lookups where user_id = :'b'), 0, 'B''s old row was deleted by A''s lookup');
select has_index('lists', 'amazon_lookups', 'amazon_lookups_created_idx', array['created_at'], 'old rows are found by created_at');

-- B has their own allowance.
select tests.act_as(:'b');
select is(lists.take_amazon_lookup(), true, 'B''s first lookup is allowed');
select tests.reset_role();
select is((select count(*)::int from lists.amazon_lookups where user_id = :'b'), 1, 'B''s lookup is counted for B');

-- A row from just under a day ago still counts.
update concierge.app_settings set value = '4' where key = 'amazon_paste_lookups_per_user_per_day';
update lists.amazon_lookups set created_at = now() - interval '23 hours' where user_id = :'a';
select tests.act_as(:'a');
select is(lists.take_amazon_lookup(), true, 'a higher limit allows one more');
select is(lists.take_amazon_lookup(), false, 'rows from 23 hours ago still count');
select tests.reset_role();

-- No limit setting means no lookup, never no limit.
delete from concierge.app_settings where key = 'amazon_paste_lookups_per_user_per_day';
select tests.act_as(:'b');
select throws_ok('select lists.take_amazon_lookup()', '22023', null, 'a missing limit refuses the lookup');
select tests.reset_role();

select * from finish();
rollback;
