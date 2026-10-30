-- Linking a buyer's person to that person's own gift list, and reading picks
-- from it (product decisions 37, 39 and 42, ALL-44). A buyer holding the
-- share link links right away; the concierge reads the list only through
-- lists.person_list (T19).
begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('mom@example.com', 'Mom') as mom \gset
select tests.create_user('buyer@example.com', 'Buyer') as buyer \gset
select tests.create_user('friend@example.com', 'Friend') as friend \gset
select tests.create_user('other@example.com', 'Other') as other \gset

-- Mom keeps a list with three gifts; a friend claims the kneeler.
select tests.act_as(:'mom');
select lists.save_list(null, 'Birthday', '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Mug set", "price_cents": 4200},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Herb planter", "price_cents": 6800},
  {"id": "aaaaaaaa-0000-4000-8000-000000000003", "name": "Kneeler", "price_cents": 3500}
]'::jsonb) as list_id \gset
select share_token as token from lists.lists where id = :'list_id' \gset
insert into public.people (name, relationship) values ('Me', 'self') returning id as mom_self \gset

select tests.act_as(:'friend');
select lists.claim_gift(:'token', 'aaaaaaaa-0000-4000-8000-000000000003', null);

-- The buyer links their "Mom" with the share link.
select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as person \gset
insert into public.people (name, relationship) values ('Gone', 'friend') returning id as gone \gset
select public.delete_person(:'gone');

select lives_ok(format('select lists.link_person(%L, %L)', :'token', :'person'), 'the buyer links Mom with her share link');
select is((select linked_user_id from public.people where id = :'person'), :'mom'::uuid, 'the person is now linked to Mom''s account');
select is(lists.person_list(:'person') ->> 'title', 'Birthday', 'the buyer reads picks from the list they linked through');
select is(jsonb_array_length(lists.person_list(:'person') -> 'items'), 3, 'all three gifts are offered');
select is(
  (select count(*)::int from jsonb_array_elements(lists.person_list(:'person') -> 'items') i where (i ->> 'claimed')::boolean),
  1,
  'the friend''s claim shows as claimed to the buyer'
);
select is(
  (select count(*)::int from jsonb_array_elements(lists.person_list(:'person') -> 'items') i where (i ->> 'claimed_by_me')::boolean),
  0,
  'and not as the buyer''s own claim'
);
select is(lists.person_list(:'person') -> 'items' -> 0 ->> 'name', 'Mug set', 'gifts come in list order');
select throws_ok('select * from lists.person_links', '42501', null, 'links are read only through functions');
select throws_ok(format('select lists.link_person(%L, %L)', :'token', :'gone'), 'P0002', null, 'a deleted person can''t be linked');
select throws_ok(
  format('select lists.link_person(%L, %L)', 'ffffffff-0000-4000-8000-000000000000', :'person'),
  'P0002', null,
  'an unknown share link is refused'
);

-- Nobody else reads the buyer's picks, and Mom can't link to herself.
select tests.act_as(:'other');
select throws_ok(format('select lists.person_list(%L)', :'person'), 'P0002', null, 'someone else can''t read the buyer''s picks');
select throws_ok(format('select lists.link_person(%L, %L)', :'token', :'person'), 'P0002', null, 'someone else can''t link the buyer''s person');
select tests.act_as(:'mom');
select throws_ok(format('select lists.link_person(%L, %L)', :'token', :'mom_self'), '22023', null, 'Mom can''t link a person to her own list');
-- The owner still never sees claims (decision 39; ALL-20's rule, unchanged).
select is(
  (select count(*)::int from jsonb_array_elements(lists.get_shared_list(:'token') -> 'items') i where i -> 'claim' <> 'null'::jsonb),
  0,
  'Mom still sees no claims on her own list'
);
select tests.act_as_anon();
select throws_ok(format('select lists.link_person(%L, %L)', :'token', :'person'), '42501', null, 'signed-out visitors can''t link');

-- The server (idea engine) reads picks with no signed-in user.
select tests.act_as_server();
select is(jsonb_array_length(lists.person_list(:'person') -> 'items'), 3, 'the server reads the picks');

-- Unlinking clears the link; a deleted list leaves no picks.
select tests.act_as(:'buyer');
select ok(lists.unlink_person(:'person'), 'the buyer unlinks Mom');
select is((select linked_user_id from public.people where id = :'person'), null, 'the person is no longer linked');

select lives_ok(format('select lists.link_person(%L, %L)', :'token', :'person'), 'the buyer links Mom again');
select tests.act_as(:'mom');
delete from lists.lists where id = :'list_id';
select tests.act_as(:'buyer');
select is(lists.person_list(:'person'), null, 'once Mom deletes the list, there are no picks');
select is((select linked_user_id from public.people where id = :'person'), null, 'and the person is no longer linked to her account');

-- Deleting the list also ends address sharing for everyone who linked through it.
select tests.act_as(:'mom');
insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
values ('Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', true);
select tests.act_as(:'buyer');
select is(public.shared_city_for_person(:'person'), null, 'after the list is deleted, the buyer no longer sees her city');

-- A linked person who is then deleted shows nothing.
select tests.act_as(:'mom');
select lists.save_list(null, 'New list', '[{"name": "Scarf", "price_cents": 2000}]'::jsonb) as list2 \gset
select share_token as token2 from lists.lists where id = :'list2' \gset
select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Mom 2', 'parent') returning id as person2 \gset
select lists.link_person(:'token2', :'person2');
select public.delete_person(:'person2');
select throws_ok(format('select lists.person_list(%L)', :'person2'), 'P0002', null, 'a deleted person has no picks');
select throws_ok(format('select public.shared_city_for_person(%L)', :'person2'), 'P0002', null, 'or city');

-- When Mom deletes her account, the link goes with it.
insert into public.people (name, relationship) values ('Mom 3', 'parent') returning id as person3 \gset
select lists.link_person(:'token2', :'person3');
select tests.reset_role();
delete from auth.users where id = :'mom';
select tests.act_as(:'buyer');
select is(lists.person_list(:'person3'), null, 'once Mom deletes her account, there are no picks');

-- An admin hard delete of a linked person still works (the link goes too).
insert into public.people (name, relationship) values ('Linked', 'friend') returning id as person4 \gset
select tests.act_as(:'other');
select lists.save_list(null, 'Other list', '[]'::jsonb) as list3 \gset
select share_token as token3 from lists.lists where id = :'list3' \gset
select tests.act_as(:'buyer');
select lists.link_person(:'token3', :'person4');
select tests.act_as_server();
select lives_ok(format($$select admin.hard_delete_person(%L, 'test', 'test')$$, :'person4'), 'an admin can hard-delete a linked person');

select * from finish();
rollback;
