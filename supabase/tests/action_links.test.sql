-- One-time email action links (ALL-23). Only the server (service role)
-- touches them; signed-in users get no access at all.
begin;
\ir _helpers.psql
select plan(14);

select tests.create_user('a@example.com') as a \gset
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent');
select id as mom from public.people where name = 'Mom' \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset

-- The server makes a round, a notification and links for A.
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, next_action_at)
values (:'a', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, now())
returning id as round \gset
insert into concierge.notifications (user_id, round_id, kind) values (:'a', :'round', 'heads_up')
returning id as notif \gset
insert into concierge.action_links (user_id, round_id, notification_id, action, token_hash, expires_at)
values (:'a', :'round', :'notif', 'approve', 'hash-1', now() + interval '1 day');
insert into concierge.action_links (user_id, action, token_hash, expires_at)
values (:'a', 'test', 'hash-expired', now() - interval '1 hour');

select is((select count(*)::int from concierge.action_links), 2, 'the server can insert links for A');

-- A can't see or change links, even their own.
select tests.act_as(:'a');
select throws_ok($q$select * from concierge.action_links$q$, '42501', null, 'A cannot read links');
select throws_ok(
  format($q$insert into concierge.action_links (user_id, action, token_hash, expires_at) values (%L, 'x', 'hash-x', now() + interval '1 day')$q$, :'a'),
  '42501', null, 'A cannot create links'
);
select throws_ok($q$update concierge.action_links set used_at = now()$q$, '42501', null, 'A cannot use up links');
select tests.reset_role();

-- Using a link: works once, then never again.
with u as (
  update concierge.action_links set used_at = now()
  where token_hash = 'hash-1' and used_at is null and expires_at > now() and user_id = :'a'
  returning 1
) select is((select count(*)::int from u), 1, 'a fresh link is used the first time');
with u as (
  update concierge.action_links set used_at = now()
  where token_hash = 'hash-1' and used_at is null and expires_at > now() and user_id = :'a'
  returning 1
) select is((select count(*)::int from u), 0, 'a used link does nothing the second time');
with u as (
  update concierge.action_links set used_at = now()
  where token_hash = 'hash-expired' and used_at is null and expires_at > now() and user_id = :'a'
  returning 1
) select is((select count(*)::int from u), 0, 'an expired link does nothing');

-- Token hashes are unique.
select throws_ok(
  format($q$insert into concierge.action_links (user_id, action, token_hash, expires_at) values (%L, 'x', 'hash-1', now())$q$, :'a'),
  '23505', null, 'a token hash can only exist once'
);

-- Deleting a notification keeps its link, unlinked.
delete from concierge.notifications where id = :'notif';
select is((select count(*)::int from concierge.action_links where token_hash = 'hash-1' and notification_id is null), 1,
  'deleting a notification leaves its link with no notification');

-- Deleting the round deletes its links.
delete from concierge.gift_rounds where id = :'round';
select is((select count(*)::int from concierge.action_links where token_hash = 'hash-1'), 0, 'deleting a round deletes its links');

-- notifications records the provider's message id and any error.
select has_column('concierge', 'notifications', 'provider_message_id', 'notifications has provider_message_id');
select has_column('concierge', 'notifications', 'error', 'notifications has error');
select hasnt_column('concierge', 'notifications', 'action_token_hash', 'notifications no longer holds a token hash');

select is(concierge.setting_int('test_action_link_hours'), 24, 'test links last 24 hours by default');

select * from finish();
rollback;
