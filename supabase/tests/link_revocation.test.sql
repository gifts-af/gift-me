-- A link to someone's list lasts only while the list is shared (product
-- decision 43, ALL-44 review). Resetting the share link cuts off the list,
-- its claims, the owner's city and the full address. Also: deleting a person
-- ends their link, person_list knows the server by its role, and
-- unlink_person reports whether a link was removed.
begin;
\ir _helpers.psql
select plan(19);

select tests.create_user('mom@example.com', 'Mom') as mom \gset
select tests.create_user('buyer@example.com', 'Buyer') as buyer \gset
select tests.create_user('friend@example.com', 'Friend') as friend \gset

-- Mom keeps a list and shares her address; a friend claims a gift.
select tests.act_as(:'mom');
select lists.save_list(null, 'Birthday', '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Mug set", "price_cents": 4200}
]'::jsonb) as list_id \gset
select share_token as old_token from lists.lists where id = :'list_id' \gset
insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
values ('Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', true);
select tests.act_as(:'friend');
select lists.claim_gift(:'old_token', 'aaaaaaaa-0000-4000-8000-000000000001', null);

-- The buyer links "Mom" through the share link, and sees everything.
select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as person \gset
select lists.link_person(:'old_token', :'person');
select is(lists.person_list(:'person') ->> 'title', 'Birthday', 'while shared, the buyer sees the list');
select is(public.shared_city_for_person(:'person') ->> 'city', 'Dayton', 'and Mom''s city');

-- ─── Mom resets her share link ──────────────────────────────────────────────
select tests.reset_role();
update lists.lists set share_token = gen_random_uuid() where id = :'list_id';
select share_token as new_token from lists.lists where id = :'list_id' \gset

select tests.act_as(:'buyer');
select is(lists.person_list(:'person'), null, 'after a reset, the old link shows no list (or its claims)');
select is(public.shared_city_for_person(:'person'), null, 'or Mom''s city');
select is((select linked_user_id from public.people where id = :'person'), null, 'and the person is no longer linked to her account');
select tests.act_as_server();
select is(public.shared_address_for_person(:'person'), null, 'the server can no longer ship to her address');
select is(lists.person_list(:'person'), null, 'or read the list');

select tests.act_as(:'buyer');
select throws_ok(format('select lists.link_person(%L, %L)', :'old_token', :'person'), 'P0002', null, 'the old link can''t be used to link again');
select lives_ok(format('select lists.link_person(%L, %L)', :'new_token', :'person'), 'the current link works');
select is(public.shared_city_for_person(:'person') ->> 'city', 'Dayton', 'and shows her city again');

-- ─── the reads check the token themselves ───────────────────────────────────
-- Even if the cleanup trigger didn't run, a stale link shares nothing.
select tests.reset_role();
alter table lists.lists disable trigger on_share_token_changed;
update lists.lists set share_token = gen_random_uuid() where id = :'list_id';
alter table lists.lists enable trigger on_share_token_changed;

select tests.act_as(:'buyer');
select is(lists.person_list(:'person'), null, 'a stale link shows no list, even with the cleanup skipped');
select is(public.shared_city_for_person(:'person'), null, 'or city');
select tests.act_as_server();
select is(public.shared_address_for_person(:'person'), null, 'or full address');

-- ─── deleting a person ends the link ────────────────────────────────────────
select share_token as token3 from lists.lists where id = :'list_id' \gset
select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Mom 2', 'parent') returning id as person2 \gset
select lists.link_person(:'token3', :'person2');
select public.delete_person(:'person2');
select tests.reset_role();
select is((select count(*)::int from lists.person_links where person_id = :'person2'), 0, 'deleting a person removes their link');
select is((select linked_user_id from public.people where id = :'person2'), null, 'and clears linked_user_id');
update public.people set deleted_at = null where id = :'person2';
select tests.act_as(:'buyer');
select is(lists.person_list(:'person2'), null, 'restoring the person doesn''t bring the link back');

-- ─── unlink_person reports what it removed ──────────────────────────────────
select ok(not lists.unlink_person(:'person2'), 'unlinking a person with no link reports false');

-- ─── person_list knows the server by its role ───────────────────────────────
-- A signed-in request with no user id used to pass as the server.
select tests.reset_role();
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select lists.person_list(%L)', :'person'), 'P0002', null, 'a request with no user and no service role is refused');
select tests.act_as_server();
select lives_ok(format('select lists.person_list(%L)', :'person'), 'the service role still reads picks');

select * from finish();
rollback;
