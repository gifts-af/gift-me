-- Old rows get cleaned up: the daily clear-out also prunes action links long
-- past expiry, and old notifications and idea runs whose round is finished for
-- good (or which have no round). Open and ordered rounds keep theirs, young rows
-- stay, and a missing age setting prunes nothing.
begin;
\ir _helpers.psql
select plan(18);

select tests.create_user('prune-a@example.com') as a \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Mom', 'mother') returning id as mom \gset
insert into concierge.occasions (user_id, person_id, kind, month, day) values (:'a', :'mom', 'birthday', 3, 14)
returning id as bday \gset

-- One round per status, each in its own year.
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2020, '2020-03-14', '2020-03-05', 5000, 'complete') returning id as r_complete \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2021, '2021-03-14', '2021-03-05', 5000, 'skipped') returning id as r_skipped \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2022, '2022-03-14', '2022-03-05', 5000, 'delivered') returning id as r_delivered \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2023, '2023-03-14', '2023-03-05', 5000, 'ordered') returning id as r_ordered \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'a', :'mom', :'bday', 2024, '2024-03-14', '2024-03-05', 5000, 'awaiting_approval') returning id as r_open \gset

-- ─── settings ───────────────────────────────────────────────────────────────
select is(concierge.setting_int('action_link_prune_days'), 30, 'action_link_prune_days is 30');
select is(concierge.setting_int('notification_prune_days'), 365, 'notification_prune_days is 365');
select is(concierge.setting_int('idea_run_prune_days'), 365, 'idea_run_prune_days is 365');

-- ─── notifications ──────────────────────────────────────────────────────────
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', null, 'test', now() - interval '400 days') returning id as n_none_old \gset
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', :'r_complete', 'heads_up', now() - interval '400 days') returning id as n_complete \gset
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', :'r_skipped', 'heads_up', now() - interval '400 days') returning id as n_skipped \gset
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', :'r_delivered', 'heads_up', now() - interval '400 days') returning id as n_delivered \gset
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', :'r_ordered', 'heads_up', now() - interval '400 days') returning id as n_ordered \gset
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', :'r_open', 'heads_up', now() - interval '400 days') returning id as n_open \gset
insert into concierge.notifications (user_id, round_id, kind, created_at) values
  (:'a', :'r_complete', 'heads_up', now() - interval '300 days') returning id as n_young \gset

-- ─── action links ───────────────────────────────────────────────────────────
insert into concierge.action_links (user_id, action, token_hash, expires_at) values
  (:'a', 'test', 'prune_old', now() - interval '31 days'),
  (:'a', 'test', 'prune_recent', now() - interval '29 days'),
  (:'a', 'test', 'prune_live', now() + interval '1 day');
insert into concierge.action_links (user_id, action, token_hash, expires_at, used_at) values
  (:'a', 'test', 'prune_used_old', now() - interval '31 days', now() - interval '32 days'),
  (:'a', 'test', 'prune_used_recent', now() - interval '1 day', now() - interval '2 days');
-- A kept link that names a notification about to be pruned.
insert into concierge.action_links (user_id, round_id, notification_id, action, token_hash, expires_at)
values (:'a', :'r_complete', :'n_complete', 'test', 'prune_names_notif', now() + interval '1 day');

-- ─── idea runs ──────────────────────────────────────────────────────────────
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values
  (:'a', :'mom', null, now() - interval '400 days') returning id as i_none_old \gset
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values
  (:'a', :'mom', :'r_complete', now() - interval '400 days') returning id as i_complete \gset
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values
  (:'a', :'mom', :'r_ordered', now() - interval '400 days') returning id as i_ordered \gset
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values
  (:'a', :'mom', :'r_open', now() - interval '400 days') returning id as i_open \gset
insert into concierge.idea_runs (user_id, person_id, round_id, started_at) values
  (:'a', :'mom', null, now() - interval '300 days') returning id as i_young \gset

-- What it already pruned keeps being pruned.
insert into concierge.inbound_seen (provider_email_id, created_at) values ('prune_old_em', now() - interval '8 days');

select tests.act_as_server();
select concierge.clear_unfiled_inbound();
select tests.reset_role();

-- ─── results ────────────────────────────────────────────────────────────────
select is((select array_agg(token_hash order by token_hash) from concierge.action_links where token_hash like 'prune%'),
  array['prune_live', 'prune_names_notif', 'prune_recent', 'prune_used_recent'],
  'links expired more than action_link_prune_days ago are deleted, used or not; the rest stay');
select is((select notification_id from concierge.action_links where token_hash = 'prune_names_notif'), null,
  'a kept link loses its pointer to a pruned notification');

select ok(not exists (select 1 from concierge.notifications where id = :'n_none_old'),
  'an old notification with no round is deleted');
select ok(not exists (select 1 from concierge.notifications where id in (:'n_complete', :'n_skipped', :'n_delivered')),
  'old notifications of complete, skipped and delivered rounds are deleted');
select ok(exists (select 1 from concierge.notifications where id = :'n_ordered'),
  'an ordered round keeps its old notifications: it can still fail late');
select ok(exists (select 1 from concierge.notifications where id = :'n_open'),
  'an open round keeps its old notifications');
select ok(exists (select 1 from concierge.notifications where id = :'n_young'),
  'a notification younger than notification_prune_days stays');

select ok(not exists (select 1 from concierge.idea_runs where id in (:'i_none_old', :'i_complete')),
  'old on-demand runs and old runs of a finished round are deleted');
select ok(exists (select 1 from concierge.idea_runs where id = :'i_ordered'),
  'an ordered round keeps its old runs');
select ok(exists (select 1 from concierge.idea_runs where id = :'i_open'),
  'an open round keeps its old runs, which count toward its run limit');
select ok(exists (select 1 from concierge.idea_runs where id = :'i_young'),
  'a run younger than idea_run_prune_days stays');

select ok(not exists (select 1 from concierge.inbound_seen where provider_email_id = 'prune_old_em'),
  'old inbound_seen rows are still pruned');

-- ─── a missing setting prunes nothing ───────────────────────────────────────
delete from concierge.app_settings
 where key in ('action_link_prune_days', 'notification_prune_days', 'idea_run_prune_days');
insert into concierge.action_links (user_id, action, token_hash, expires_at)
values (:'a', 'test', 'prune_unset', now() - interval '1000 days');
insert into concierge.notifications (user_id, kind, created_at) values (:'a', 'test', now() - interval '1000 days')
returning id as n_unset \gset
insert into concierge.idea_runs (user_id, person_id, started_at) values (:'a', :'mom', now() - interval '1000 days')
returning id as i_unset \gset

select tests.act_as_server();
select concierge.clear_unfiled_inbound();
select tests.reset_role();

select ok(exists (select 1 from concierge.action_links where token_hash = 'prune_unset'),
  'without action_link_prune_days no link is deleted');
select ok(exists (select 1 from concierge.notifications where id = :'n_unset'),
  'without notification_prune_days no notification is deleted');
select ok(exists (select 1 from concierge.idea_runs where id = :'i_unset'),
  'without idea_run_prune_days no run is deleted');

select * from finish();
rollback;
