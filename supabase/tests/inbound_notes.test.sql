-- Inbound email notes (ALL-31): a Resend email id is claimed once, the four
-- settings exist, one-time account flags are claimed once, a note asking
-- "Who is this about?" is filed at most once and never to a deleted person,
-- and only the server can do any of it.
begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('notes-a@example.com') as a \gset
select tests.create_user('notes-b@example.com') as b \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Dad', 'parent') returning id as dad \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Gone', 'friend') returning id as gone \gset
update public.people set deleted_at = now() where id = :'gone';

-- ─── inbound_seen ───────────────────────────────────────────────────────────
select tests.act_as_server();
select isnt_empty($q$insert into concierge.inbound_seen (provider_email_id) values ('em_1')
                     on conflict do nothing returning provider_email_id$q$,
  'the first delivery of an email id is claimed');
select is_empty($q$insert into concierge.inbound_seen (provider_email_id) values ('em_1')
                   on conflict do nothing returning provider_email_id$q$,
  'a second delivery of the same id claims nothing');
select tests.reset_role();

-- ─── settings ───────────────────────────────────────────────────────────────
select is(concierge.setting_int('inbound_email_enabled'), 1, 'inbound_email_enabled is 1');
select is(concierge.setting_int('inbound_match_max_choices'), 5, 'inbound_match_max_choices is 5');
select is(concierge.setting_int('inbound_max_per_user_per_day'), 20, 'inbound_max_per_user_per_day is 20');
select is(concierge.setting_int('inbound_link_hours'), 72, 'inbound_link_hours is 72');
select is(concierge.setting_int('inbound_thread_lookup_max'), 10, 'inbound_thread_lookup_max is 10');
select is(concierge.setting_int('inbound_thread_lookup_days'), 60, 'inbound_thread_lookup_days is 60');

-- ─── one-time account flags ─────────────────────────────────────────────────
insert into concierge.accounts (user_id) values (:'b');
select ok((select notes_tip_sent_at is null and notes_unpaid_reply_sent_at is null
             from concierge.accounts where user_id = :'b'), 'account flags start empty');

select tests.act_as_server();
select is(concierge.claim_inbound_flag(:'a', 'notes_tip_sent_at'), true,
  'claiming a flag for a user with no account row succeeds');
select tests.reset_role();
select ok((select notes_tip_sent_at is not null and notes_unpaid_reply_sent_at is null
             from concierge.accounts where user_id = :'a'), '... creating the row and setting only that flag');
select tests.act_as_server();
select is(concierge.claim_inbound_flag(:'a', 'notes_tip_sent_at'), false, 'claiming it again returns false');
select is(concierge.claim_inbound_flag(:'a', 'notes_unpaid_reply_sent_at'), true, 'the other flag is claimed on its own');
select throws_ok($q$select concierge.claim_inbound_flag(gen_random_uuid(), 'paid_features')$q$,
  null, null, 'an unknown flag is refused');

-- ─── daily count ────────────────────────────────────────────────────────────
insert into concierge.inbound_events (user_id) values (:'a'), (:'a');
insert into concierge.inbound_events (user_id, created_at) values (:'a', now() - interval '2 days');
insert into concierge.inbound_events (user_id) values (:'b');
select is(concierge.inbound_count_today(:'a'), 2, 'the daily count is today''s events for that user only');

-- ─── filing an asking message ───────────────────────────────────────────────
insert into concierge.inbound_messages (user_id, subject, body, image_path, image_type)
values (:'a', 'Fly rods', 'He wants a new fly rod', :'a' || '/m1.png', 'image/png')
returning id as m1 \gset
insert into concierge.inbound_messages (user_id, subject, body) values (:'a', 'Socks', 'No more socks')
returning id as m2 \gset

select is(concierge.file_inbound_message(:'a', :'m2', :'gone'), null, 'a deleted person can''t be picked');
select is(concierge.file_inbound_message(:'b', :'m1', :'dad'), null, 'another user can''t file the message');
select concierge.file_inbound_message(:'a', :'m1', :'dad') as c1 \gset
select ok(nullif(:'c1', '') is not null, 'the first tap files the message and returns the capture id');
select is(concierge.file_inbound_message(:'a', :'m1', :'dad'), null, 'a second tap files nothing');
select tests.reset_role();

select is((select row(person_id, page_title, text_excerpt, screenshot_path, screenshot_type, source_url, status)::text
             from concierge.captures where id = :'c1'),
  row(:'dad'::uuid, 'Fly rods', 'He wants a new fly rod', :'a' || '/m1.png', 'image/png', null::text, 'pending')::text,
  'the capture carries the subject, text and stored image');
select is((select row(status, capture_id, subject, body)::text from concierge.inbound_messages where id = :'m1'),
  row('filed', :'c1'::uuid, null::text, null::text)::text, 'the message is filed with its subject and body cleared');
select is((select count(*)::int from concierge.captures where user_id = :'a'), 1, 'exactly one capture exists');
select is((select status from concierge.inbound_messages where id = :'m2'), 'asking', 'a refused message stays asking');

-- ─── who can do it ──────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'concierge.claim_inbound_flag(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'concierge.file_inbound_message(uuid, uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'concierge.inbound_count_today(uuid)', 'execute')
      and not has_function_privilege('anon', 'concierge.file_inbound_message(uuid, uuid, uuid)', 'execute'),
  'signed-in users and visitors can''t run the server functions');

select ok(not has_table_privilege('authenticated', 'concierge.inbound_seen', 'select')
      and not has_table_privilege('authenticated', 'concierge.inbound_events', 'select,insert'),
  'signed-in users can''t touch the seen ids or the daily events');

select tests.act_as(:'b');
select is((select count(*)::int from concierge.inbound_messages), 0, 'another user can''t see the messages');
select tests.reset_role();

select * from finish();
rollback;
