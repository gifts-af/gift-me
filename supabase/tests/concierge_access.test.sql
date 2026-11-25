-- Concierge access per account: who is let in, the daily cap on requests, and
-- the settings that go with it. Only the server claims, releases or turns off.
begin;
\ir _helpers.psql
select plan(52);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select tests.create_user('c@example.com') as c \gset
select tests.create_user('d@example.com') as d \gset
select tests.create_user('t@example.com') as t \gset
select tests.create_user('x@example.com') as x \gset

-- ─── Reading ─────────────────────────────────────────────────────────────────

select tests.act_as(:'a');
select is(concierge.has_concierge_access(:'a'), false, 'no account row means no access');
insert into concierge.accounts (user_id) values (:'a');
select is(concierge.has_concierge_access(:'a'), false, 'a new row defaults to no access');
select is(
  (select access_requested_at from concierge.accounts where user_id = :'a'), null,
  'a user reads their own request date, empty to start'
);

select tests.reset_role();
update concierge.accounts set concierge_access = true where user_id = :'a';
select tests.act_as(:'a');
select is(concierge.has_concierge_access(:'a'), true, 'a user sees their own flag');
select is(
  (select concierge_access from concierge.accounts where user_id = :'a'), true,
  'a user reads their own flag from the table'
);
select tests.act_as(:'b');
select is(concierge.has_concierge_access(:'a'), false, 'another user reads as none');
select tests.act_as_anon();
select throws_ok(
  format($q$select concierge.has_concierge_access(%L)$q$, :'a'),
  '42501', null, 'anon cannot run the check'
);

-- ─── A user can't change it, or call the server's functions ─────────────────

select tests.act_as(:'b');
select throws_ok(
  format($q$insert into concierge.accounts (user_id, concierge_access) values (%L, true)$q$, :'b'),
  '42501', null, 'a user cannot insert the flag'
);
select throws_ok(
  format($q$insert into concierge.accounts (user_id, access_requested_at) values (%L, now())$q$, :'b'),
  '42501', null, 'a user cannot insert the request date'
);
insert into concierge.accounts (user_id) values (:'b');
select throws_ok(
  format($q$update concierge.accounts set concierge_access = true where user_id = %L$q$, :'b'),
  '42501', null, 'a user cannot update the flag'
);
select throws_ok(
  format($q$update concierge.accounts set access_requested_at = now() where user_id = %L$q$, :'b'),
  '42501', null, 'a user cannot update the request date'
);
select throws_ok(
  format($q$select concierge.claim_access_request(%L)$q$, :'b'),
  '42501', null, 'a user cannot claim a request'
);
select throws_ok(
  format($q$select concierge.release_access_request(%L)$q$, :'b'),
  '42501', null, 'a user cannot release a request'
);
select throws_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'b'),
  '42501', null, 'a user cannot turn access off'
);

select tests.act_as_anon();
select throws_ok(
  format($q$select concierge.claim_access_request(%L)$q$, :'b'),
  '42501', null, 'anon cannot claim a request'
);
select throws_ok(
  format($q$select concierge.release_access_request(%L)$q$, :'b'),
  '42501', null, 'anon cannot release a request'
);
select throws_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'b'),
  '42501', null, 'anon cannot turn access off'
);

-- ─── Claiming a request ──────────────────────────────────────────────────────

-- Other request dates in the database would count toward the cap, so start clean.
select tests.reset_role();
update concierge.accounts set access_requested_at = null;
set local role service_role;
select is(concierge.claim_access_request(:'b'), 'claimed', 'the first claim works');
select is(concierge.claim_access_request(:'b'), 'already', 'a second claim finds the date set');
select is(concierge.claim_access_request(:'a'), 'already', 'a claim with access on finds it already');
select is(
  (select access_requested_at is null from concierge.accounts where user_id = :'a'), true,
  'a claim with access on leaves the date alone'
);
select is(concierge.claim_access_request(:'c'), 'claimed', 'a user with no row gets one and claims');
select is(
  (select access_requested_at is not null from concierge.accounts where user_id = :'c'), true,
  'the claim sets the date'
);

-- Release leaves the date alone once access is on.
select tests.reset_role();
update concierge.accounts set access_requested_at = now() where user_id = :'a';
set local role service_role;
select concierge.release_access_request(:'a');
select is(
  (select access_requested_at is not null from concierge.accounts where user_id = :'a'), true,
  'a release with access on leaves the date'
);
select tests.reset_role();
update concierge.accounts set access_requested_at = null where user_id = :'a';
set local role service_role;

select concierge.release_access_request(:'c');
select is(
  (select access_requested_at is null from concierge.accounts where user_id = :'c'), true,
  'a release clears the date'
);
select is(concierge.claim_access_request(:'c'), 'claimed', 'after a release the user can claim again');

-- Another user can't read b's flag or date straight from the table.
select tests.act_as(:'c');
select is(
  (select count(*) from concierge.accounts where user_id = :'b'), 0::bigint,
  'another user reads none of the flag or date from the table'
);
select tests.reset_role();

-- b and c hold dates now; a cap of 2 is full, so another user waits.
select tests.reset_role();
update concierge.app_settings set value = '2' where key = 'concierge_requests_per_day';
set local role service_role;
select is(concierge.claim_access_request(:'d'), 'busy', 'at the cap, another user gets busy');
select is(
  (select count(*) from concierge.accounts where user_id = :'d' and access_requested_at is not null), 0::bigint,
  'a busy answer sets no date'
);
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'concierge_requests_per_day';
set local role service_role;
select is(concierge.claim_access_request(:'d'), 'busy', 'a cap of 0 is always busy');
select is(
  (select count(*) from concierge.accounts where user_id = :'d' and access_requested_at is not null), 0::bigint,
  'a cap of 0 sets no date'
);

-- A date older than 24 hours doesn't count.
select tests.reset_role();
update concierge.app_settings set value = '2' where key = 'concierge_requests_per_day';
update concierge.accounts set access_requested_at = now() - interval '25 hours' where user_id = :'c';
set local role service_role;
select is(concierge.claim_access_request(:'d'), 'claimed', 'a date older than a day makes room');

-- A missing setting raises rather than letting everyone in.
select tests.reset_role();
delete from concierge.app_settings where key = 'concierge_requests_per_day';
set local role service_role;
select throws_ok(
  format($q$select concierge.claim_access_request(%L)$q$, :'a'),
  'P0001', null, 'a missing cap setting raises'
);
select tests.reset_role();
insert into concierge.app_settings (key, value, description) values ('concierge_requests_per_day', '10', 'restored for the test');

-- ─── Turning access off ──────────────────────────────────────────────────────

insert into concierge.accounts (user_id, concierge_access, access_requested_at, paid_features) values (:'t', true, now(), true);
set local role service_role;
select throws_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'t'),
  'P0001', null, 'turn-off raises with paid features on'
);

select tests.reset_role();
update concierge.accounts set paid_features = false, zinc_api_key_secret_id = gen_random_uuid() where user_id = :'t';
set local role service_role;
select throws_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'t'),
  'P0001', null, 'turn-off raises with a saved Zinc key'
);

select tests.reset_role();
update concierge.accounts set zinc_api_key_secret_id = null where user_id = :'t';
select tests.act_as(:'t');
insert into public.people (name, relationship) values ('Mom', 'mother');
select id as mom from public.people where name = 'Mom' \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset
select tests.reset_role();
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status)
values (:'t', :'mom', :'bday', 2027, '2027-03-14', '2027-03-05', 10000, 'awaiting_approval') returning id as rnd \gset
set local role service_role;
select throws_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'t'),
  'P0001', null, 'turn-off raises with a round awaiting approval'
);
select is(
  (select concierge_access from concierge.accounts where user_id = :'t'), true,
  'a refused turn-off leaves access on'
);
select is(
  (select access_requested_at is not null from concierge.accounts where user_id = :'t'), true,
  'a refused turn-off leaves the date'
);

-- A skipped round is finished too.
select tests.reset_role();
update concierge.gift_rounds set status = 'skipped' where id = :'rnd';
set local role service_role;
select lives_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'t'),
  'turn-off works with only a skipped round'
);
select is(
  (select concierge_access from concierge.accounts where user_id = :'t'), false,
  'turn-off with a skipped round clears the flag'
);
select tests.reset_role();
update concierge.accounts set concierge_access = true, access_requested_at = now() where user_id = :'t';

select tests.reset_role();
update concierge.gift_rounds set status = 'complete' where id = :'rnd';
set local role service_role;
select lives_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'t'),
  'turn-off works with only a finished round'
);
select is(
  (select concierge_access from concierge.accounts where user_id = :'t'), false,
  'turn-off clears the flag'
);
select is(
  (select access_requested_at from concierge.accounts where user_id = :'t'), null,
  'turn-off clears the date'
);

-- An account with no row has nothing to turn off, and gets none made.
select lives_ok(
  format($q$select concierge.turn_off_concierge_access(%L)$q$, :'x'),
  'turn-off with no account row does nothing'
);
select is(
  (select count(*) from concierge.accounts where user_id = :'x'), 0::bigint,
  'turn-off with no account row makes none'
);
select tests.reset_role();

-- ─── The backfill ────────────────────────────────────────────────────────────

delete from concierge.accounts;
select tests.create_user('e@example.com') as e \gset
select tests.create_user('f@example.com') as f \gset
insert into concierge.accounts (user_id, over_budget_pct) values (:'f', 33);

insert into concierge.accounts (user_id, concierge_access)
select id, true from auth.users
on conflict (user_id) do update set concierge_access = true;

select is(concierge.has_concierge_access(:'e'), true, 'the backfill gives a user with no row access');
select is(concierge.has_concierge_access(:'f'), true, 'the backfill gives a user with a row access');
select is(
  (select over_budget_pct from concierge.accounts where user_id = :'f'), 33,
  'the backfill leaves an existing row''s other settings alone'
);

-- ─── Settings ────────────────────────────────────────────────────────────────

select is(concierge.setting_int('google_import_enabled'), 0, 'Google import is off');
select is(concierge.setting_int('concierge_requests_per_day'), 10, '10 requests a day');
select is(concierge.setting_int('amazon_paste_lookups_per_user_per_day'), 10, '10 Amazon lookups a day per person');
select is(concierge.setting_int('amazon_paste_lookups_per_day_total'), 200, '200 Amazon lookups a day across everyone');

select * from finish();
rollback;
