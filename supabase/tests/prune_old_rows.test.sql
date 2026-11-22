-- Spent emailed buttons get cleaned up: prune_expired_action_links deletes links
-- whose expires_at passed more than action_link_prune_days ago, used or not,
-- returns how many it deleted, and does nothing when the setting is 0 or unset.
-- Only the server can run it.
begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('prune-a@example.com') as a \gset

-- ─── settings ───────────────────────────────────────────────────────────────
select is(concierge.setting_int('action_link_prune_days'), 30, 'action_link_prune_days is 30');

-- ─── who can run it ─────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'concierge.prune_expired_action_links()', 'execute')
      and not has_function_privilege('authenticated', 'concierge.prune_expired_action_links()', 'execute'),
  'anon and signed-in users cannot run the prune');
select ok(has_function_privilege('service_role', 'concierge.prune_expired_action_links()', 'execute'),
  'the server can run the prune');

-- ─── links ──────────────────────────────────────────────────────────────────
-- Earlier links would make the count depend on what else is in the database.
delete from concierge.action_links where expires_at < now() - interval '30 days';

insert into concierge.action_links (user_id, action, token_hash, expires_at) values
  (:'a', 'test', 'prune_old', now() - interval '31 days'),
  (:'a', 'test', 'prune_recent', now() - interval '29 days'),
  (:'a', 'test', 'prune_live', now() + interval '1 day');
insert into concierge.action_links (user_id, action, token_hash, expires_at, used_at) values
  (:'a', 'test', 'prune_used_old', now() - interval '31 days', now() - interval '32 days'),
  (:'a', 'test', 'prune_used_recent', now() - interval '1 day', now() - interval '2 days');

select tests.act_as_server();
select is(concierge.prune_expired_action_links(), 2, 'it returns how many links it deleted');
select tests.reset_role();

select is((select array_agg(token_hash order by token_hash) from concierge.action_links where token_hash like 'prune%'),
  array['prune_live', 'prune_recent', 'prune_used_recent'],
  'links expired more than action_link_prune_days ago are deleted, used or not; the rest stay');

-- ─── 0 or unset turns it off ────────────────────────────────────────────────
insert into concierge.action_links (user_id, action, token_hash, expires_at)
values (:'a', 'test', 'prune_off', now() - interval '1000 days');

update concierge.app_settings set value = '0' where key = 'action_link_prune_days';
select tests.act_as_server();
select is(concierge.prune_expired_action_links(), 0, 'with action_link_prune_days at 0 it deletes nothing');
select tests.reset_role();
select ok(exists (select 1 from concierge.action_links where token_hash = 'prune_off'),
  'with action_link_prune_days at 0 an old link stays');

delete from concierge.app_settings where key = 'action_link_prune_days';
select tests.act_as_server();
select is(concierge.prune_expired_action_links(), 0, 'without action_link_prune_days it deletes nothing');
select tests.reset_role();
select ok(exists (select 1 from concierge.action_links where token_hash = 'prune_off'),
  'without action_link_prune_days an old link stays');

select * from finish();
rollback;
