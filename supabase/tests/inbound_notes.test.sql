-- Inbound email notes (ALL-31): a Resend email id is claimed once, the four
-- settings exist, one-time account flags are claimed once, a note asking
-- "Who is this about?" is filed at most once and never to a deleted person,
-- and only the server can do any of it.
begin;
\ir _helpers.psql
select plan(37);

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
select is(concierge.setting_int('inbound_prune_days'), 7, 'inbound_prune_days is 7');

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

-- ─── the daily clear-out ────────────────────────────────────────────────────
-- Seven asking messages: expired buttons (cleared), a live button, a used
-- button, one live and one expired (kept), no buttons and young, no buttons
-- and old (cleared). Plus a filed message, which is never touched.
delete from concierge.inbound_messages where user_id = :'a';
select tests.act_as_server();
insert into concierge.inbound_messages (user_id, subject, body, image_path, image_type, created_at)
values (:'a', 's', 'b', :'a' || '/expired.png', 'image/png', now() - interval '5 days') returning id as x_exp \gset
insert into concierge.inbound_messages (user_id, subject, body, image_path, image_type)
values (:'a', 's', 'b', :'a' || '/live.png', 'image/png') returning id as x_live \gset
insert into concierge.inbound_messages (user_id, subject, body, image_path, image_type)
values (:'a', 's', 'b', :'a' || '/used.png', 'image/png') returning id as x_used \gset
insert into concierge.inbound_messages (user_id, subject, body, image_path, image_type)
values (:'a', 's', 'b', :'a' || '/mixed.png', 'image/png') returning id as x_mixed \gset
insert into concierge.inbound_messages (user_id, subject, body, created_at)
values (:'a', 's', 'b', now() - interval '1 hour') returning id as x_young \gset
insert into concierge.inbound_messages (user_id, subject, body, image_path, image_type, created_at)
values (:'a', 's', 'b', :'a' || '/old.png', 'image/png', now() - interval '5 days') returning id as x_old \gset
insert into concierge.inbound_messages (user_id, status, image_path, image_type, capture_id)
values (:'a', 'filed', :'a' || '/filed.png', 'image/png', :'c1') returning id as x_filed \gset

insert into concierge.action_links (user_id, action, token_hash, expires_at, inbound_message_id, person_id) values
  (:'a', 'file_note', 'h1', now() - interval '1 hour', :'x_exp', :'dad'),
  (:'a', 'file_note', 'h2', now() + interval '1 hour', :'x_live', :'dad'),
  (:'a', 'file_note', 'h3', now() - interval '1 hour', :'x_mixed', :'dad'),
  (:'a', 'file_note', 'h4', now() + interval '1 hour', :'x_mixed', :'dad');
insert into concierge.action_links (user_id, action, token_hash, expires_at, used_at, inbound_message_id, person_id)
values (:'a', 'file_note', 'h5', now() - interval '1 hour', now() - interval '2 hours', :'x_used', :'dad');
insert into concierge.action_links (user_id, action, token_hash, expires_at, inbound_message_id, person_id)
values (:'a', 'file_note', 'h6', now() - interval '1 hour', :'x_filed', :'dad');

insert into concierge.inbound_seen (provider_email_id, created_at) values ('old_em', now() - interval '8 days'), ('new_em', now() - interval '6 days');
delete from concierge.inbound_events;
insert into concierge.inbound_events (user_id, created_at) values (:'a', now() - interval '8 days'), (:'a', now() - interval '6 days');

select is((select array_agg(image_path order by image_path) from concierge.clear_unfiled_inbound()),
  array[:'a' || '/expired.png', :'a' || '/old.png'],
  'the clear-out returns the image paths of the messages it cleared');
select tests.reset_role();

select is((select array_agg(id::text order by id) from concierge.inbound_messages where user_id = :'a' and subject is null and status = 'asking'),
  (select array_agg(i::text order by i) from unnest(array[:'x_exp'::uuid, :'x_old'::uuid]) i),
  'only the expired-button message and the old button-less message are cleared');
select is((select row(subject, body, image_path, image_type)::text from concierge.inbound_messages where id = :'x_exp'),
  row(null::text, null::text, null::text, null::text)::text, 'a cleared message has no subject, body or image');
select is((select count(*)::int from concierge.inbound_messages where id in (:'x_live', :'x_used', :'x_mixed', :'x_young') and subject = 's' and body = 'b'),
  4, 'a live button, a used button, a mix, or a young button-less message keeps its content');
select is((select image_path from concierge.inbound_messages where id = :'x_live'), :'a' || '/live.png', 'a kept message keeps its image');
select is((select image_path from concierge.inbound_messages where id = :'x_filed'), :'a' || '/filed.png',
  'a filed message keeps its image: it is the capture''s screenshot');
select is((select array_agg(provider_email_id) from concierge.inbound_seen where provider_email_id in ('old_em', 'new_em')), array['new_em'],
  'seen ids older than 7 days are pruned');
select is((select count(*)::int from concierge.inbound_events), 1, 'events older than 7 days are pruned');
select tests.act_as_server();
select is((select count(*)::int from concierge.clear_unfiled_inbound()), 0, 'running it again clears nothing');
select tests.reset_role();
select ok(not has_function_privilege('authenticated', 'concierge.clear_unfiled_inbound()', 'execute')
      and not has_function_privilege('anon', 'concierge.clear_unfiled_inbound()', 'execute'),
  'signed-in users and visitors can''t run the clear-out');

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
