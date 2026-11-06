-- Connecting Zinc from Settings (ALL-32, Task 4): the poll hold and the top-up fee settings.
begin;
\ir _helpers.psql
select plan(8);

select tests.create_user('zc@example.com') as a \gset

select is(concierge.setting_int('zinc_topup_fee_bps'), 290, 'the card top-up fee is 2.9%');
select is(concierge.setting_int('zinc_topup_fee_fixed_cents'), 30, 'plus 30 cents');

insert into concierge.zinc_connect_attempts (user_id, device_code, user_code, verification_url, interval_sec, expires_at)
values (:'a', 'dev-old', 'ABCD-EFGH', 'https://zinc.example/verify', 5, now() + interval '10 minutes');

select tests.act_as_server();
select concierge.zinc_release_poll(:'a', 'dev-old', 10);
select tests.reset_role();
select is((select interval_sec from concierge.zinc_connect_attempts where user_id = :'a'), 10, 'the interval is saved');
select ok((select polling_until > now() + interval '8 seconds' and polling_until <= now() + interval '10 seconds'
             from concierge.zinc_connect_attempts where user_id = :'a'), 'the next poll is held for one interval from now');

-- A newer attempt (new device code) is not touched by an old poll finishing late.
update concierge.zinc_connect_attempts set device_code = 'dev-new', interval_sec = 5, polling_until = null where user_id = :'a';
select tests.act_as_server();
select concierge.zinc_release_poll(:'a', 'dev-old', 30);
select tests.reset_role();
select is((select polling_until from concierge.zinc_connect_attempts where user_id = :'a'), null, 'an old poll leaves a newer attempt alone');
select is((select interval_sec from concierge.zinc_connect_attempts where user_id = :'a'), 5, 'and its interval');

select tests.act_as(:'a');
select throws_ok(format($q$select concierge.zinc_release_poll(%L, 'dev-new', 5)$q$, :'a'), '42501', null, 'signed-in users can''t call it');
select tests.reset_role();
select ok(not has_function_privilege('anon', 'concierge.zinc_release_poll(uuid, text, integer)', 'execute'), 'visitors can''t either');

select * from finish();
rollback;
