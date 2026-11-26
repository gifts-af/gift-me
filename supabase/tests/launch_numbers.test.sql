-- concierge.launch_numbers: counts for the owner's health email. Server only;
-- team and test accounts (metrics_excluded) left out; a list counts once it has
-- a gift; deleted people don't count; each day is after p_now - 1 day, up to p_now.
begin;
\ir _helpers.psql
select plan(18);

-- A fixed moment well after anything else in the database, so the day's counts are only ours.
select '2031-03-01 12:00:00+00'::timestamptz as now_ \gset
-- Totals include whatever else is in the database, so they're compared as a change from here.
select concierge.launch_numbers(:'now_') as before \gset

select tests.create_user('fan@example.com', 'Fan') as fan \gset
select tests.create_user('old@example.com', 'Old') as old \gset
select tests.create_user('team@example.com', 'Team') as team \gset
insert into concierge.accounts (user_id, metrics_excluded) values (:'team', true);
-- fan and team joined within the day (team is excluded), old two days before it.
update auth.users set created_at = :'now_'::timestamptz - interval '1 hour' where id in (:'fan', :'team');
update auth.users set created_at = :'now_'::timestamptz - interval '2 days' where id = :'old';

-- fan's list: first gift exactly on the window's edge. old's list has none. team's has one.
insert into lists.lists (owner_id, title) values (:'fan', 'Fan') returning id as fan_list \gset
insert into lists.lists (owner_id, title) values (:'old', 'Old') returning id as old_list \gset
insert into lists.lists (owner_id, title) values (:'team', 'Team') returning id as team_list \gset
insert into lists.list_items (list_id, position, name, price_cents, added_at) values
  (:'fan_list', 0, 'Mug', 1500, :'now_'::timestamptz - interval '2 hours'),
  (:'fan_list', 1, 'Scarf', 2500, :'now_'::timestamptz - interval '1 day'),
  (:'fan_list', 2, 'Book', 1200, :'now_'::timestamptz + interval '1 hour'),
  (:'team_list', 0, 'Lamp', 3000, :'now_'::timestamptz - interval '1 hour');

-- old adds a person (and a deleted one), saves fan's list to them, and claims fan's mug.
insert into public.people (user_id, name, relationship, created_at)
  values (:'old', 'Fan', 'friend', :'now_'::timestamptz - interval '3 hours') returning id as fan_person \gset
insert into public.people (user_id, name, relationship, created_at, deleted_at)
  values (:'old', 'Gone', 'friend', :'now_'::timestamptz - interval '3 hours', :'now_'::timestamptz - interval '2 hours');
insert into lists.person_links (person_id, buyer_id, list_id, share_token, created_at)
  select :'fan_person', :'old', l.id, l.share_token, :'now_'::timestamptz - interval '3 hours' from lists.lists l where l.id = :'fan_list';
insert into lists.gift_claims (item_id, claimer_id, claimer_name, claimed_at)
  select i.id, :'old', 'Old', :'now_'::timestamptz - interval '30 minutes' from lists.list_items i where i.list_id = :'fan_list' and i.name = 'Mug';
-- team claims too, which doesn't count.
insert into lists.gift_claims (item_id, claimer_id, claimer_name, claimed_at)
  select i.id, :'team', 'Team', :'now_'::timestamptz - interval '30 minutes' from lists.list_items i where i.list_id = :'fan_list' and i.name = 'Scarf';

select concierge.launch_numbers(:'now_') as after \gset
create function tests.ln_change(p_key text, p_part text, p_before jsonb, p_after jsonb) returns integer language sql
as $$ select (p_after -> p_key ->> p_part)::integer - (p_before -> p_key ->> p_part)::integer $$;

select is((:'after'::jsonb -> 'signups' ->> 'day')::integer, 1, 'signups: only fan joined in the day (team is excluded)');
select is(tests.ln_change('signups', 'total', :'before', :'after'), 2, 'signups: fan and old in all time, not team');
select is((:'after'::jsonb -> 'lists_started' ->> 'day')::integer, 0, 'lists started: a first gift exactly on the window''s edge is not the day');
select is(tests.ln_change('lists_started', 'total', :'before', :'after'), 1, 'lists started: fan''s list only (old''s is empty, team''s is excluded)');
select is((:'after'::jsonb -> 'gifts_added' ->> 'day')::integer, 1, 'gifts added: the mug only (the scarf is on the edge, the book after p_now)');
select is(tests.ln_change('gifts_added', 'total', :'before', :'after'), 2, 'gifts added: mug and scarf, not the book or team''s lamp');
select is((:'after'::jsonb -> 'lists_followed' ->> 'day')::integer, 1, 'friends'' lists saved: old saved fan''s');
select is(tests.ln_change('lists_followed', 'total', :'before', :'after'), 1, 'friends'' lists saved: one in all time');
select is((:'after'::jsonb -> 'gifts_claimed' ->> 'day')::integer, 1, 'gifts claimed: old''s claim, not team''s');
select is(tests.ln_change('gifts_claimed', 'total', :'before', :'after'), 1, 'gifts claimed: one in all time');
select is((:'after'::jsonb -> 'people_added' ->> 'day')::integer, 1, 'people added: the deleted one doesn''t count');
select is(tests.ln_change('people_added', 'total', :'before', :'after'), 1, 'people added: one in all time');

-- The flag can change later: unmarking counts an account again, marking takes it out.
update concierge.accounts set metrics_excluded = false where user_id = :'team';
select is((concierge.launch_numbers(:'now_') -> 'signups' ->> 'day')::integer, 2, 'unmarking team counts its signup again');
insert into concierge.accounts (user_id, metrics_excluded) values (:'fan', true);
select is((concierge.launch_numbers(:'now_') -> 'signups' ->> 'day')::integer, 1, 'marking fan takes their signup out');

-- Server only, and users can't set the flag.
select ok(not has_function_privilege('anon', 'concierge.launch_numbers(timestamptz)', 'execute'), 'anon can''t run launch_numbers');
select ok(not has_function_privilege('authenticated', 'concierge.launch_numbers(timestamptz)', 'execute'), 'authenticated can''t run launch_numbers');
select ok(has_function_privilege('service_role', 'concierge.launch_numbers(timestamptz)', 'execute'), 'service_role can run launch_numbers');
select ok(not has_column_privilege('authenticated', 'concierge.accounts', 'metrics_excluded', 'update'), 'users can''t set metrics_excluded');

select * from finish();
rollback;
