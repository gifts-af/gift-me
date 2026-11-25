-- Your own birthday, month and day (ALL-182). Only you read or write the row.
-- A signed-in holder of your list's current link gets it through
-- lists.owner_birthday, to fill in the Add form; the list itself never has it.
begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('sam@example.com', 'Sam') as sam \gset
select tests.create_user('buyer@example.com') as buyer \gset

select tests.act_as(:'sam');
select (lists.save_list_checked(null, 'My list', '[]'::jsonb, null) ->> 'id')::uuid as list \gset
select share_token as token from lists.lists where id = :'list' \gset

select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), null, 'nothing before Sam saves one');

-- ─── the row ────────────────────────────────────────────────────────────────
select tests.act_as(:'sam');
select throws_ok('insert into public.account_birthdays (month, day) values (2, 30)', '23514', null, 'Feb 30 is refused');
select throws_ok('insert into public.account_birthdays (month, day) values (4, 31)', '23514', null, 'Apr 31 is refused');
select throws_ok('insert into public.account_birthdays (month, day) values (13, 1)', '23514', null, 'month 13 is refused');
select throws_ok('insert into public.account_birthdays (month, day) values (1, 0)', '23514', null, 'day 0 is refused');
select throws_ok('insert into public.account_birthdays (month) values (1)', '23502', null, 'half a date is refused');
select lives_ok('insert into public.account_birthdays (month, day) values (2, 29)', 'Feb 29 is fine');
select lives_ok('update public.account_birthdays set month = 3, day = 14', 'Sam changes it');
select hasnt_column('public', 'account_birthdays', 'year', 'there is no year');

select tests.act_as(:'buyer');
select is((select count(*)::int from public.account_birthdays), 0, 'the buyer reads no row');
select throws_ok(
  format('insert into public.account_birthdays (user_id, month, day) values (%L, 1, 1)', :'sam'),
  '42501', null, 'the buyer can''t write one for Sam'
);
update public.account_birthdays set month = 1;
delete from public.account_birthdays;
select tests.reset_role();
select is((select month::int from public.account_birthdays where user_id = :'sam'), 3, 'or change or delete Sam''s');
select tests.act_as_anon();
select throws_ok('select * from public.account_birthdays', '42501', null, 'signed-out visitors can''t read it');

-- ─── through the link ───────────────────────────────────────────────────────
select throws_ok(format('select lists.owner_birthday(%L)', :'token'), '42501', null, 'or ask with the link');
select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), '{"month": 3, "day": 14}'::jsonb, 'a signed-in link holder gets month and day only');
select is(lists.owner_birthday(gen_random_uuid()), null, 'a wrong link gives nothing');
select is(position('birthday' in lists.get_shared_list(:'token')::text), 0, 'the list carries no birthday');
select is(position('birthday' in lists.share_preview(:'token')::text), 0, 'nor does its preview');
select tests.act_as(:'sam');
select is(lists.owner_birthday(:'token'), null, 'the owner gets nothing from their own link');

-- ─── switches ───────────────────────────────────────────────────────────────
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'list_birthday_enabled';
select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), null, 'off at 0');
select tests.reset_role();
update concierge.app_settings set value = '2' where key = 'list_birthday_enabled';
select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), null, 'off at anything but 1');
select tests.reset_role();
delete from concierge.app_settings where key = 'list_birthday_enabled';
select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), null, 'off when missing');
select tests.reset_role();
insert into concierge.app_settings (key, value, description) values ('list_birthday_enabled', '1', 'restored');
update concierge.app_settings set value = '0' where key = 'list_link_card_enabled';
select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), null, 'off with the list card off');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'list_link_card_enabled';

-- ─── the link changes, the birthday goes ────────────────────────────────────
update lists.lists set share_token = gen_random_uuid() where id = :'list';
select tests.act_as(:'buyer');
select is(lists.owner_birthday(:'token'), null, 'an old link gives nothing');
select tests.act_as(:'sam');
select lives_ok('delete from public.account_birthdays', 'Sam removes it');
insert into public.account_birthdays (month, day) values (3, 14);
select tests.reset_role();
delete from auth.users where id = :'sam';
select is((select count(*)::int from public.account_birthdays where user_id = :'sam'), 0, 'deleting the account deletes it');

select * from finish();
rollback;
