-- Opening someone's list link to add or link its owner (ALL-123). The shared
-- list says whose it is (the owner's display name only, never an email) and
-- which of the viewer's people it is linked to; a guarded link never replaces
-- an existing link, because a link decides where held gifts ship (T26, T61);
-- add_person can create a person and link the list in one transaction; and
-- the link preview carries only the owner's name and a gift count.
begin;
\ir _helpers.psql
select plan(63);

select tests.create_user('sam@example.com', 'Sam Lee') as sam \gset
select tests.create_user('pat@example.com', 'Pat') as pat \gset
select tests.create_user('noname@example.com') as noname \gset
select tests.create_user('buyer@example.com', 'Buyer') as buyer \gset
select tests.create_user('other@example.com', 'Other') as other \gset
select tests.create_user('friend@example.com', 'Friend') as friend \gset

-- Sam keeps a list with three gifts, one claimed by a friend. Pat and a user
-- with no display name keep lists too.
select tests.act_as(:'sam');
select lists.save_list(null, 'My list', '[
  {"id": "bbbbbbbb-0000-4000-8000-000000000001", "name": "Mug set", "price_cents": 4200},
  {"id": "bbbbbbbb-0000-4000-8000-000000000002", "name": "Herb planter", "price_cents": 6800},
  {"id": "bbbbbbbb-0000-4000-8000-000000000003", "name": "Kneeler", "price_cents": 3500}
]'::jsonb) as list_a \gset
select share_token as token_a from lists.lists where id = :'list_a' \gset
insert into public.people (name, relationship) values ('Me', 'self') returning id as sam_self \gset

select tests.act_as(:'pat');
select lists.save_list(null, 'Pat''s list', '[]'::jsonb) as list_b \gset
select share_token as token_b from lists.lists where id = :'list_b' \gset

select tests.act_as(:'noname');
select lists.save_list(null, 'My list', '[]'::jsonb) as list_n \gset
select share_token as token_n from lists.lists where id = :'list_n' \gset

select tests.act_as(:'friend');
select lists.claim_gift(:'token_a', 'bbbbbbbb-0000-4000-8000-000000000003', null);

-- ─── owner_name (AC-1, AC-2) ────────────────────────────────────────────────

select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_a') ->> 'owner_name', 'Sam Lee', 'the owner''s display name heads the list');
select is(lists.get_shared_list(:'token_n') -> 'owner_name', 'null'::jsonb, 'an owner with no display name has a null owner_name');
select ok(
  position('noname@example.com' in lists.get_shared_list(:'token_n')::text) = 0,
  'the owner''s email is never sent, even with no display name'
);

select tests.reset_role();
update public.profiles set display_name = '   ' where id = :'noname';
select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_n') -> 'owner_name', 'null'::jsonb, 'a blank display name is a null owner_name');

select tests.reset_role();
update public.profiles set display_name = '  Sam Lee  ' where id = :'sam';
select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_a') ->> 'owner_name', 'Sam Lee', 'the owner''s name is trimmed');

select tests.act_as_anon();
select is(lists.get_shared_list(:'token_a') ->> 'owner_name', 'Sam Lee', 'a signed-out visitor sees the owner''s name');
select is(lists.get_shared_list(:'token_a') -> 'linked_person', 'null'::jsonb, 'a signed-out visitor has no linked person');
select is(lists.get_shared_list(:'token_a') -> 'card_enabled', 'true'::jsonb, 'a signed-out visitor is told the card is on');

-- ─── link_unlinked_person ───────────────────────────────────────────────────

select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as mom \gset
insert into public.people (name, relationship) values ('Mother', 'parent') returning id as mother \gset
insert into public.people (name, relationship) values ('Gone', 'friend') returning id as gone \gset
select public.delete_person(:'gone');

select is(lists.get_shared_list(:'token_a') -> 'linked_person', 'null'::jsonb, 'no linked person before linking');

select is(
  lists.link_unlinked_person(:'token_a', :'mom'),
  jsonb_build_object('status', 'linked', 'list_id', :'list_a'::uuid),
  'Mom is linked to Sam''s list'
);
select is((select linked_user_id from public.people where id = :'mom'), :'sam'::uuid, 'Mom''s person now points at Sam''s account');
select is(
  lists.get_shared_list(:'token_a') -> 'linked_person',
  jsonb_build_object('id', :'mom'::uuid, 'name', 'Mom'),
  'the shared list shows the buyer''s linked person'
);
select is(lists.person_share_token(:'mom'), :'token_a'::uuid, 'person_share_token returns the active link''s token');
select is(lists.person_share_token(:'mother'), null, 'person_share_token is null for an unlinked person');

select is(
  lists.link_unlinked_person(:'token_a', :'mom'),
  '{"status": "person_has_list"}'::jsonb,
  'linking Mom again reports she already has a list'
);
select is(
  lists.link_unlinked_person(:'token_a', :'mother'),
  jsonb_build_object('status', 'list_has_person', 'person_id', :'mom'::uuid),
  'a second person on the same list gets list_has_person, naming the linked one (AC-21)'
);
select is((select linked_user_id from public.people where id = :'mother'), null, 'the second person stays unlinked');

select tests.reset_role();
select created_at as mom_linked_at from lists.person_links where person_id = :'mom' \gset
select tests.act_as(:'buyer');
select is(
  lists.link_unlinked_person(:'token_b', :'mom'),
  '{"status": "person_has_list"}'::jsonb,
  'Mom, already linked to Sam''s list, can''t be moved to Pat''s (AC-20)'
);
select is(lists.person_share_token(:'mom'), :'token_a'::uuid, 'Mom stays linked to Sam''s list');
select is((select linked_user_id from public.people where id = :'mom'), :'sam'::uuid, 'Mom still points at Sam''s account');
select tests.reset_role();
select is(
  (select list_id from lists.person_links where person_id = :'mom'),
  :'list_a'::uuid,
  'the existing link row is untouched'
);
select is(
  (select created_at from lists.person_links where person_id = :'mom'),
  :'mom_linked_at'::timestamptz,
  'and its created_at is unchanged'
);

select tests.act_as(:'buyer');
select throws_ok(
  format('select lists.link_unlinked_person(%L, %L)', 'ffffffff-0000-4000-8000-000000000000', :'mother'),
  'P0002', null, 'an unknown share link is refused'
);
select throws_ok(format('select lists.link_unlinked_person(%L, %L)', :'token_b', :'gone'), 'P0002', null, 'a deleted person can''t be linked');
select tests.act_as(:'other');
select throws_ok(format('select lists.link_unlinked_person(%L, %L)', :'token_b', :'mother'), 'P0002', null, 'someone else''s person can''t be linked');
select is(lists.person_share_token(:'mom'), null, 'someone else gets no token for the buyer''s person');
select tests.act_as(:'sam');
select throws_ok(format('select lists.link_unlinked_person(%L, %L)', :'token_a', :'sam_self'), '22023', null, 'Sam can''t link a person to her own list');
select is(lists.get_shared_list(:'token_a') -> 'linked_person', 'null'::jsonb, 'the owner never has a linked person');

-- ─── linked_person only on an active link ───────────────────────────────────
-- The token-reset and soft-delete triggers already delete links; turn them off
-- here so these tests check get_shared_list's own guard.

select tests.reset_role();
alter table lists.lists disable trigger on_share_token_changed;
update lists.lists set share_token = gen_random_uuid() where id = :'list_a';
alter table lists.lists enable trigger on_share_token_changed;
select share_token as token_a2 from lists.lists where id = :'list_a' \gset
select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_a2') -> 'linked_person', 'null'::jsonb, 'after a token reset, the old link isn''t shown');
select is(lists.person_share_token(:'mom'), null, 'and person_share_token is null');
select is(
  lists.link_unlinked_person(:'token_a2', :'mother'),
  jsonb_build_object('status', 'linked', 'list_id', :'list_a'::uuid),
  'a revoked link doesn''t block linking someone else with the new token'
);
select is(
  lists.get_shared_list(:'token_a2') -> 'linked_person',
  jsonb_build_object('id', :'mother'::uuid, 'name', 'Mother'),
  'the new link is the linked person'
);

select tests.reset_role();
alter table public.people disable trigger on_linked_person_deleted;
update public.people set deleted_at = now() where id = :'mother';
alter table public.people enable trigger on_linked_person_deleted;
select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_a2') -> 'linked_person', 'null'::jsonb, 'a soft-deleted person is never the linked person');
select is(lists.person_share_token(:'mother'), null, 'and has no share token');

-- With two links on one list (only the old paste path can make that), the
-- most recent one wins.
insert into public.people (name, relationship) values ('Pat A', 'friend') returning id as pat_a \gset
insert into public.people (name, relationship) values ('Pat B', 'friend') returning id as pat_b \gset
select lists.link_person(:'token_b', :'pat_a');
select tests.reset_role();
update lists.person_links set created_at = now() - interval '1 day' where person_id = :'pat_a';
select tests.act_as(:'buyer');
select lists.link_person(:'token_b', :'pat_b');
select is(
  lists.get_shared_list(:'token_b') -> 'linked_person' ->> 'id',
  :'pat_b',
  'the most recently linked person is shown'
);

-- ─── add_person with a share token (AC-8, AC-9, AC-21) ──────────────────────

select count(*) as people_before from public.people \gset
select concierge.add_person(
  p_name => 'Sam', p_relationship => 'friend', p_kinds => array['birthday'],
  p_birthday_month => 3, p_birthday_day => 4, p_share_token => :'token_n'
) as added \gset
select is((select name from public.people where id = :'added'), 'Sam', 'add_person with a token creates the person');
select is(lists.person_share_token(:'added'), :'token_n'::uuid, 'and links them to the list');
select is((select count(*)::int from concierge.occasions where person_id = :'added'), 1, 'with their occasions');

select count(*) as people_before from public.people \gset
select throws_ok(
  format('select concierge.add_person(p_name => %L, p_relationship => %L, p_kinds => null, p_share_token => %L)',
         'Again', 'friend', :'token_n'),
  'P0001', 'list_has_person', 'adding a second person for the same list is refused'
);
select is((select count(*) from public.people), :'people_before'::bigint, 'and nobody is created');

-- The error's detail names the person already linked, so the app can send the
-- buyer there.
create function pg_temp.add_detail(p_token uuid) returns text language plpgsql as $$
declare v_detail text;
begin
  perform concierge.add_person(p_name => 'Again', p_relationship => 'friend', p_kinds => null, p_share_token => p_token);
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
select is(pg_temp.add_detail(:'token_n'), :'added'::text, 'the error detail is the linked person''s id');

select throws_ok(
  format('select concierge.add_person(p_name => %L, p_relationship => %L, p_kinds => null, p_share_token => %L)',
         'Old', 'friend', :'token_a'),
  'P0002', null, 'a reset share link is refused'
);
select throws_ok(
  format('select concierge.add_person(p_name => %L, p_relationship => %L, p_kinds => null, p_share_token => %L)',
         'Ghost', 'friend', 'ffffffff-0000-4000-8000-000000000000'),
  'P0002', null, 'an unknown share link is refused'
);
select is((select count(*) from public.people), :'people_before'::bigint, 'and nobody is created');

select tests.act_as(:'sam');
select count(*) as sam_people from public.people \gset
select throws_ok(
  format('select concierge.add_person(p_name => %L, p_relationship => %L, p_kinds => null, p_share_token => %L)',
         'Me again', 'self', :'token_a2'),
  '22023', null, 'the owner can''t add-and-link from her own list'
);
select is((select count(*) from public.people), :'sam_people'::bigint, 'and nothing is created for her');

-- The full 17-argument call store.createPerson makes still works.
select tests.act_as(:'buyer');
select lives_ok(
  $q$select concierge.add_person(
    p_name => 'Grandpa', p_relationship => 'grandparent', p_kinds => array['birthday', 'anniversary'],
    p_birthday_month => 1, p_birthday_day => 2, p_birth_year => 1940,
    p_anniversary_month => 5, p_anniversary_day => 6, p_google_contact_id => 'people/c123',
    p_recipient_first_name => 'Gramps', p_recipient_last_name => 'Lee', p_address_line1 => '1 Main St',
    p_address_line2 => 'Apt 2', p_city => 'Springfield', p_state => 'IL', p_zip => '62701', p_country => 'US'
  )$q$,
  'the 17-named-argument call still works'
);
select is(
  (select linked_user_id from public.people where name = 'Grandpa'),
  null,
  'and links nothing'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'concierge' and p.proname = 'add_person'),
  1,
  'only one add_person exists, so PostgREST calls aren''t ambiguous'
);

-- ─── share_preview (AC-16, AC-17, AC-26) ────────────────────────────────────

select tests.act_as_anon();
select is(
  lists.share_preview(:'token_a2'),
  '{"owner_name": "Sam Lee", "item_count": 3}'::jsonb,
  'the preview has exactly the owner''s name and the gift count, and no claim information'
);
select is(lists.share_preview(:'token_a'), null, 'a reset token has no preview');
select is(lists.share_preview('ffffffff-0000-4000-8000-000000000000'), null, 'an unknown token has no preview');

-- ─── grants ─────────────────────────────────────────────────────────────────

select tests.reset_role();
select ok(not has_function_privilege('anon', 'lists.link_unlinked_person(uuid, uuid)', 'execute'), 'anon can''t run link_unlinked_person');
select ok(not has_function_privilege('anon', 'lists.person_share_token(uuid)', 'execute'), 'anon can''t run person_share_token');
select ok(
  not has_function_privilege('anon',
    'concierge.add_person(text, text, text[], int, int, int, int, int, text, text, text, text, text, text, text, text, text, uuid)',
    'execute'),
  'anon can''t run add_person'
);
select ok(has_function_privilege('authenticated', 'lists.link_unlinked_person(uuid, uuid)', 'execute'), 'signed-in users can run link_unlinked_person');
select ok(has_function_privilege('anon', 'lists.share_preview(uuid)', 'execute'), 'anon can fetch a preview');

-- ─── off switch (AC-25) ─────────────────────────────────────────────────────

select tests.reset_role();
select is(
  (select value from concierge.app_settings where key = 'list_link_card_enabled'),
  '1'::jsonb,
  'the card is on by default'
);
select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_a2') -> 'card_enabled', 'true'::jsonb, 'a signed-in buyer is told the card is on');
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'list_link_card_enabled';
select tests.act_as(:'buyer');
select is(lists.get_shared_list(:'token_a2') -> 'owner_name', 'null'::jsonb, 'with the switch off, the shared list has no owner name');
select is(lists.get_shared_list(:'token_a2') -> 'card_enabled', 'false'::jsonb, 'with the switch off, the card is off');
select tests.act_as_anon();
select is(lists.get_shared_list(:'token_a2') -> 'card_enabled', 'false'::jsonb, 'and off for a signed-out visitor too');
select is(
  lists.share_preview(:'token_a2'),
  '{"owner_name": null, "item_count": 3}'::jsonb,
  'and neither does the preview'
);

select * from finish();
rollback;
