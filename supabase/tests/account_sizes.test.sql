-- Your sizes and favorite color. Only you read or write the row. Anyone holding
-- your list's current link, signed in or not, gets the shared ones through
-- lists.owner_sizes; the list itself never has them.
begin;
\ir _helpers.psql
select plan(28);

select tests.create_user('sam@example.com', 'Sam') as sam \gset
select tests.create_user('buyer@example.com') as buyer \gset

select tests.act_as(:'sam');
select (lists.save_list_checked(null, 'My list', '[]'::jsonb, null) ->> 'id')::uuid as list \gset
select share_token as token from lists.lists where id = :'list' \gset

select tests.act_as(:'buyer');
select is(lists.owner_sizes(:'token'), null, 'nothing before Sam saves any');

-- ─── the row ────────────────────────────────────────────────────────────────
select tests.act_as(:'sam');
select throws_ok('insert into public.account_sizes (top_shared) values (true)', '23514', null, 'sharing without a value is refused');
select throws_ok($q$insert into public.account_sizes (top, top_shared) values (null, true)$q$, '23514', null, 'sharing a null is refused');
select throws_ok($q$insert into public.account_sizes (top) values (repeat('a', 31))$q$, '23514', null, '31 characters are refused');
select throws_ok($q$insert into public.account_sizes (top) values (E'M\nL')$q$, '23514', null, 'a newline is refused');
select throws_ok($q$insert into public.account_sizes (top) values (E'M\x7fL')$q$, '23514', null, 'DEL is refused');
select throws_ok($q$insert into public.account_sizes (top) values ('')$q$, '23514', null, 'an empty value is refused');
select throws_ok($q$insert into public.account_sizes (top) values (' M')$q$, '23514', null, 'an untrimmed value is refused');
select lives_ok($q$insert into public.account_sizes (top) values (repeat('😀', 30))$q$, '30 emoji are fine');
select lives_ok($q$delete from public.account_sizes$q$, 'cleared');

select lives_ok(
  $q$insert into public.account_sizes (top, top_shared, pants, dress, dress_shared, shoe, shoe_shared, ring, hat, hat_shared, color, color_shared)
     values ('M', true, '32x30', 'unshared dress', false, '9.5', true, '7', 'S', true, 'Teal', true)$q$,
  'Sam saves some'
);
select lives_ok($q$update public.account_sizes set pants = '34x30'$q$, 'Sam changes one');

select tests.act_as(:'buyer');
select is((select count(*)::int from public.account_sizes), 0, 'the buyer reads no row');
select throws_ok(
  format('insert into public.account_sizes (user_id, top) values (%L, ''S'')', :'sam'),
  '42501', null, 'the buyer can''t write one for Sam'
);
update public.account_sizes set top = 'XS';
delete from public.account_sizes;
select tests.reset_role();
select is((select top from public.account_sizes where user_id = :'sam'), 'M', 'or change or delete Sam''s');
select tests.act_as_anon();
select throws_ok('select * from public.account_sizes', '42501', null, 'signed-out visitors can''t read the table');

-- ─── through the link ───────────────────────────────────────────────────────
select is(
  lists.owner_sizes(:'token'),
  '[{"kind":"top","value":"M"},{"kind":"shoe","value":"9.5"},{"kind":"hat","value":"S"},{"kind":"color","value":"Teal"}]'::jsonb,
  'a signed-out holder of the link gets the shared ones, in order'
);
select tests.act_as(:'buyer');
select is(
  (select jsonb_array_length(lists.owner_sizes(:'token'))), 4, 'a signed-in stranger gets the same'
);
select is(position('Teal' in lists.get_shared_list(:'token')::text), 0, 'the list carries no sizes');
select is(position('Teal' in lists.share_preview(:'token')::text), 0, 'nor does its preview');
select is(lists.owner_sizes(gen_random_uuid()), null, 'a wrong link gives nothing');
select tests.act_as(:'sam');
select is(lists.owner_sizes(:'token'), null, 'the owner gets nothing from their own link');

-- ─── nothing shared ─────────────────────────────────────────────────────────
update public.account_sizes set top_shared = false, shoe_shared = false, hat_shared = false, color_shared = false;
select tests.act_as_anon();
select is(lists.owner_sizes(:'token'), null, 'nothing shared gives null, not an empty list');
select tests.act_as(:'sam');
update public.account_sizes set top_shared = true, shoe_shared = true, hat_shared = true, color_shared = true;

-- ─── switches ───────────────────────────────────────────────────────────────
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'list_sizes_enabled';
select tests.act_as_anon();
select is(lists.owner_sizes(:'token'), null, 'off at 0');
select tests.reset_role();
update concierge.app_settings set value = '2' where key = 'list_sizes_enabled';
select tests.act_as_anon();
select is(lists.owner_sizes(:'token'), null, 'off at anything but 1');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'list_sizes_enabled';
update concierge.app_settings set value = '0' where key = 'list_link_card_enabled';
select tests.act_as_anon();
select is(lists.owner_sizes(:'token'), null, 'off with the list card off');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'list_link_card_enabled';

-- ─── the link changes, the sizes go ─────────────────────────────────────────
update lists.lists set share_token = gen_random_uuid() where id = :'list';
select tests.act_as_anon();
select is(lists.owner_sizes(:'token'), null, 'an old link gives nothing');

select tests.reset_role();
delete from auth.users where id = :'sam';
select is((select count(*)::int from public.account_sizes where user_id = :'sam'), 0, 'deleting the account deletes it');

select * from finish();
rollback;
