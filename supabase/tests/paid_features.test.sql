-- Paid features are for test and admin users (ALL-94, decision 53).
begin;
\ir _helpers.psql
select plan(11);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select is(concierge.setting_int('capture_read_estimate_cents'), 2, 'reading a capture is estimated at 2 cents');

-- No account row yet: the flag is off.
select tests.act_as(:'a');
select is(concierge.has_paid_features(:'a'), false, 'no account row means no paid features');

-- A user can't give it to themselves, on insert or update.
select throws_ok(
  format($q$insert into concierge.accounts (user_id, paid_features) values (%L, true)$q$, :'a'),
  '42501', null, 'a user cannot insert the flag'
);
insert into concierge.accounts (user_id) values (:'a');
select is(concierge.has_paid_features(:'a'), false, 'the flag defaults to off');
select throws_ok(
  format($q$update concierge.accounts set paid_features = true where user_id = %L$q$, :'a'),
  '42501', null, 'a user cannot update the flag'
);
select lives_ok(
  format($q$update concierge.accounts set over_budget_pct = 10 where user_id = %L$q$, :'a'),
  'a user can still change their own settings'
);
select tests.act_as_anon();
select throws_ok(
  format($q$select concierge.has_paid_features(%L)$q$, :'a'),
  '42501', null, 'anon cannot run the check'
);

-- An admin turns it on with the server's access; editing settings leaves it on.
select tests.reset_role();
update concierge.accounts set paid_features = true where user_id = :'a';
select tests.act_as(:'a');
select is(concierge.has_paid_features(:'a'), true, 'the user sees their own flag');
update concierge.accounts set over_budget_pct = 20 where user_id = :'a';
select is(concierge.has_paid_features(:'a'), true, 'changing settings keeps the flag');

-- One user can't read another's.
select tests.act_as(:'b');
select is(concierge.has_paid_features(:'a'), false, 'another user reads as off');

-- The server can check any user (the idea engine will).
select tests.reset_role();
set local role service_role;
select is(concierge.has_paid_features(:'a'), true, 'the server sees any user''s flag');

select * from finish();
rollback;
