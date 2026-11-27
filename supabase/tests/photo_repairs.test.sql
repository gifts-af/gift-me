-- The daily photo repair's table, functions and grants: only the server reads or writes
-- them; has_photo may turn on but never off.
begin;
\ir _helpers.psql
select plan(15);

select tests.create_user('repair-a@example.com') as a \gset

select has_table('lists', 'photo_repairs', 'photo_repairs exists');
select col_is_pk('lists', 'photo_repairs', 'item_id', 'one row per gift');
select is((select relrowsecurity from pg_class where oid = 'lists.photo_repairs'::regclass), true, 'row security is on');

select is(concierge.setting_int('photo_repair_enabled'), 1, 'on by default');
select is(concierge.setting_int('photo_repair_per_run'), 20, 'per run');
select is(concierge.setting_int('photo_repair_max_attempts'), 4, 'max attempts');
select is(concierge.setting_int('amazon_paste_lookups_per_user_per_day'), 30, 'per-person paste lookups in step with prod');

-- A gift to work with, written as the server.
insert into lists.lists (id, owner_id) values ('00000000-0000-4000-8000-0000000000a1', :'a');
insert into lists.list_items (id, list_id, position, name, price_cents, product_url)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 0, 'Gift', 100, 'https://shop.test/p');
insert into lists.photo_repairs (item_id, attempts) values ('00000000-0000-4000-8000-0000000000b1', 1);

select tests.act_as(:'a');
select throws_ok($$select * from lists.photo_repairs$$, '42501', null, 'a signed-in user cannot read photo_repairs');
select throws_ok($$select * from lists.photo_repair_candidates(10, 60, 15)$$, '42501', null, 'nor list the candidates');
select throws_ok($$select lists.save_repaired_photo('00000000-0000-4000-8000-0000000000b1', 'https://shop.test/p', null, 'https://x.test/a.jpg')$$, '42501', null, 'nor save a repaired photo');
select throws_ok($$select lists.take_repair_amazon_lookup()$$, '42501', null, 'nor take a repair lookup');

select tests.act_as_server();
select is((select attempts from lists.photo_repairs where item_id = '00000000-0000-4000-8000-0000000000b1'), 1, 'the server reads photo_repairs');
select tests.reset_role();

update lists.list_items set has_photo = true where id = '00000000-0000-4000-8000-0000000000b1';
select is((select has_photo from lists.list_items where id = '00000000-0000-4000-8000-0000000000b1'), true, 'has_photo can turn on');
select throws_ok($$update lists.list_items set has_photo = false where id = '00000000-0000-4000-8000-0000000000b1'$$, '42501', null, 'but never off');

update lists.list_items set image_url = 'https://shop.test/new.jpg' where id = '00000000-0000-4000-8000-0000000000b1';
select is((select count(*)::int from lists.photo_repairs where item_id = '00000000-0000-4000-8000-0000000000b1'), 0, 'an edited photo starts the gift over');

select * from finish();
rollback;
