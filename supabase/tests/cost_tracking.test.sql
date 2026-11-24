-- The cost ledger: what each AI and lookup call cost, the monthly bills, and
-- the cost-per-gift averages worked out from them. Server only.
-- Dates are in 2090 so rows already in the shared local database never fall in
-- a window, and every row here rolls back with the transaction.
begin;
\ir _helpers.psql
select plan(72);

select tests.create_user('cost-a@example.com') as a \gset
select tests.create_user('cost-qa@example.com') as q \gset
select tests.create_user('cost-none@example.com') as n \gset
insert into concierge.accounts (user_id) values (:'a');
insert into concierge.accounts (user_id, costs_excluded) values (:'q', true);
-- :'n' has no accounts row on purpose.

insert into public.people (user_id, name, relationship) values (:'a', 'Sam', 'friend') returning id as pa \gset
insert into public.people (user_id, name, relationship) values (:'q', 'Sam', 'friend') returning id as pq \gset
insert into public.people (user_id, name, relationship) values (:'n', 'Sam', 'friend') returning id as pn \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'pa', 'christmas') returning id as oa \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'q', :'pq', 'christmas') returning id as oq \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'n', :'pn', 'christmas') returning id as onn \gset

create function tests.ct_round(p_user uuid, p_person uuid, p_occasion uuid) returns uuid language sql as $$
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
  values (p_user, p_person, p_occasion, 2091, '2091-12-25', '2091-12-15', 5000) returning id;
$$;
-- One order, with its own idea.
create function tests.ct_order(p_user uuid, p_round uuid, p_status text, p_placed timestamptz) returns uuid
language plpgsql as $$
declare
  v_idea uuid;
  v_order uuid;
begin
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
  values (p_user, p_round, 'Gift', 4000, 4500, 1) returning id into v_idea;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, placed_at, ship_to, ship_city, ship_state)
  values (p_user, p_round, v_idea, 'zinc_wallet', 4500, 100, p_status, p_placed, 'recipient', 'Dayton', 'OH') returning id into v_order;
  return v_order;
end;
$$;
create function tests.ct_cost(p_kind text, p_cents numeric, p_estimated boolean, p_excluded boolean, p_at timestamptz) returns void
language sql as $$
  insert into concierge.cost_events (kind, cents, estimated, excluded, created_at) values (p_kind, p_cents, p_estimated, p_excluded, p_at);
$$;
grant execute on all functions in schema tests to service_role;

-- ─── Only the service role ───────────────────────────────────────────────────
select tests.act_as(:'a');
select throws_ok($$select * from concierge.cost_events$$, '42501', null, 'a signed-in user cannot read cost_events');
select throws_ok($$insert into concierge.cost_events (kind, cents, estimated) values ('ai_ideas', 1, false)$$, '42501', null, 'a signed-in user cannot write cost_events');
select throws_ok($$select * from concierge.monthly_bills$$, '42501', null, 'a signed-in user cannot read monthly_bills');
select throws_ok($$insert into concierge.monthly_bills (month, vendor, cents) values ('2090-01-01', 'x', 1)$$, '42501', null, 'a signed-in user cannot write monthly_bills');
select throws_ok(format($q$select concierge.record_cost(%L, 'ai_ideas', 1, false)$q$, :'a'), '42501', null, 'a signed-in user cannot call record_cost');
select throws_ok($$select concierge.cost_per_gift(now())$$, '42501', null, 'a signed-in user cannot call cost_per_gift');
select tests.act_as_anon();
select throws_ok($$select * from concierge.cost_events$$, '42501', null, 'anon cannot read cost_events');
select throws_ok($$insert into concierge.cost_events (kind, cents, estimated) values ('ai_ideas', 1, false)$$, '42501', null, 'anon cannot write cost_events');
select throws_ok($$select * from concierge.monthly_bills$$, '42501', null, 'anon cannot read monthly_bills');
select throws_ok($$insert into concierge.monthly_bills (month, vendor, cents) values ('2090-01-01', 'x', 1)$$, '42501', null, 'anon cannot write monthly_bills');
select throws_ok(format($q$select concierge.record_cost(%L, 'ai_ideas', 1, false)$q$, :'a'), '42501', null, 'anon cannot call record_cost');
select throws_ok($$select concierge.cost_per_gift(now())$$, '42501', null, 'anon cannot call cost_per_gift');

select tests.reset_role();
select ok(
  (select relrowsecurity from pg_class where oid = 'concierge.cost_events'::regclass)
  and (select relrowsecurity from pg_class where oid = 'concierge.monthly_bills'::regclass),
  'both tables have RLS on');
select tests.act_as_server();
select lives_ok($$select * from concierge.cost_events$$, 'the service role can read cost_events');
select lives_ok($$select * from concierge.monthly_bills$$, 'the service role can read monthly_bills');
select lives_ok($$select concierge.cost_per_gift(now())$$, 'the service role can call cost_per_gift');

-- ─── record_cost ─────────────────────────────────────────────────────────────
select concierge.record_cost(:'a', 'ai_ideas', 12.3456, true);
select is((select cents from concierge.cost_events order by id desc limit 1), 12.3456::numeric,
  'record_cost keeps a fraction of a cent');
select is((select estimated from concierge.cost_events order by id desc limit 1), true, 'record_cost keeps the estimate mark');
select throws_ok(format($q$select concierge.record_cost(%L, 'order_fee', 1, false)$q$, :'a'), '23514', null, 'a kind outside the list is refused');
select throws_ok(format($q$select concierge.record_cost(%L, 'ai_ideas', -1, false)$q$, :'a'), '23514', null, 'negative cents are refused');

select concierge.record_cost(:'q', 'ai_capture', 2, true);
select is((select excluded from concierge.cost_events order by id desc limit 1), true, 'a flagged account writes a row marked excluded');
select concierge.record_cost(:'a', 'ai_capture', 2, true);
select is((select excluded from concierge.cost_events order by id desc limit 1), false, 'an ordinary account writes a row not excluded');
select concierge.record_cost(:'n', 'ai_capture', 2, true);
select is((select excluded from concierge.cost_events order by id desc limit 1), false, 'a user with no accounts row is recorded, not excluded');
select concierge.record_cost(gen_random_uuid(), 'lookup_price_check', 1, true);
select is((select excluded from concierge.cost_events order by id desc limit 1), false, 'an unknown user id is recorded, not excluded');

-- Flipping the flag later leaves old rows alone.
select tests.ct_cost('ai_ideas', 5, false, true, '2090-02-01 00:00+00');
select tests.reset_role();
update concierge.accounts set costs_excluded = false where user_id = :'q';
select is((select count(*)::int from concierge.cost_events where excluded and created_at = '2090-02-01 00:00+00'), 1, 'clearing the flag does not change an old row');
update concierge.accounts set costs_excluded = true where user_id = :'q';
delete from concierge.cost_events where created_at = '2090-02-01 00:00+00';

-- ─── Users can't flag themselves ─────────────────────────────────────────────
select tests.act_as(:'a');
select throws_ok(format($q$update concierge.accounts set costs_excluded = true where user_id = %L$q$, :'a'), '42501', null, 'a user cannot update costs_excluded');
select throws_ok(format($q$insert into concierge.accounts (user_id, costs_excluded) values (%L, true)$q$, :'n'), '42501', null, 'a user cannot insert costs_excluded');
select lives_ok(format($q$update concierge.accounts set over_budget_pct = 10 where user_id = %L$q$, :'a'), 'a user can still change their own settings');
select tests.reset_role();

-- ─── Links cleared when the idea run or order is deleted ─────────────────────
insert into concierge.idea_runs (user_id, person_id) values (:'a', :'pa') returning id as run1 \gset
select tests.ct_round(:'a', :'pa', :'oa') as ra \gset
select tests.ct_order(:'a', :'ra', 'placed', '2090-01-10 00:00+00') as ord1 \gset
select tests.act_as_server();
select concierge.record_cost(:'a', 'ai_ideas', 3, false, :'run1', :'ord1');
select tests.reset_role();
select is((select count(*)::int from concierge.cost_events where idea_run_id = :'run1' and order_id = :'ord1'), 1, 'the row links its run and order');
delete from concierge.idea_runs where id = :'run1';
select is((select count(*)::int from concierge.cost_events where cents = 3 and idea_run_id is null and order_id = :'ord1'), 1, 'deleting an idea run keeps the cost row, link cleared');
delete from concierge.orders where id = :'ord1';
select is((select count(*)::int from concierge.cost_events where cents = 3 and idea_run_id is null and order_id is null), 1, 'deleting an order keeps the cost row, link cleared');

-- ─── Tracking off ────────────────────────────────────────────────────────────
select count(*)::int as before_off from concierge.cost_events \gset
update concierge.app_settings set value = '0' where key = 'cost_tracking_enabled';
select tests.act_as_server();
select concierge.record_cost(:'a', 'ai_ideas', 9, false);
select tests.reset_role();
select is((select count(*)::int from concierge.cost_events), :before_off, 'record_cost writes nothing when tracking is off');
select tests.act_as_server();
select is(concierge.cost_per_gift('2090-06-30 12:00+00'), null::jsonb, 'cost_per_gift returns null when tracking is off');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'cost_tracking_enabled';

-- ─── The averages ────────────────────────────────────────────────────────────
-- p_now is 2090-06-30 12:00 UTC, so a 90-day window starts 2090-04-01 12:00.
update concierge.app_settings set value = to_jsonb('2090-01-01T00:00:00Z'::text) where key = 'cost_tracking_since';
update concierge.app_settings set value = '90' where key = 'cost_window_days';
delete from concierge.cost_events where created_at >= '2090-01-01';

select tests.ct_round(:'q', :'pq', :'oq') as rq \gset
select tests.ct_round(:'n', :'pn', :'onn') as rn \gset
-- Counted: o1, o2, o3, o5, o12.
select tests.ct_order(:'a', :'ra', 'placed',    '2090-05-10 00:00+00');
select tests.ct_order(:'a', :'ra', 'shipped',   '2090-05-20 00:00+00');
select tests.ct_order(:'a', :'ra', 'delivered', '2090-06-10 00:00+00');
select tests.ct_order(:'a', :'ra', 'placed',    '2090-06-30 12:00+00');  -- exactly p_now: counted
select tests.ct_order(:'n', :'rn', 'placed',    '2090-05-25 00:00+00');  -- no accounts row: counted
-- Not counted.
select tests.ct_order(:'a', :'ra', 'placed',    '2090-04-01 12:00+00');  -- exactly the window start
select tests.ct_order(:'a', :'ra', 'placed',    '2090-06-30 12:00:01+00');
select tests.ct_order(:'a', :'ra', 'placed',    '2089-12-31 00:00+00');  -- before cost_tracking_since
select tests.ct_order(:'a', :'ra', 'failed',    '2090-05-11 00:00+00');
select tests.ct_order(:'a', :'ra', 'placing',   '2090-05-12 00:00+00');
select tests.ct_order(:'a', :'ra', 'cancelled', '2090-05-13 00:00+00');
select tests.ct_order(:'a', :'ra', 'refunded',  '2090-05-14 00:00+00');
select tests.ct_order(:'q', :'rq', 'placed',    '2090-05-15 00:00+00');  -- excluded account

select tests.ct_cost('ai_ideas',          10.5, false, false, '2090-05-01 00:00+00');
select tests.ct_cost('ai_capture',        4.25, true,  false, '2090-05-02 00:00+00');
select tests.ct_cost('lookup_ideas',      3,    true,  false, '2090-05-03 00:00+00');
select tests.ct_cost('lookup_price_check', 2,   true,  false, '2090-06-01 00:00+00');
select tests.ct_cost('ai_ideas',          1,    false, false, '2090-06-30 12:00+00');  -- exactly p_now: counted
select tests.ct_cost('ai_ideas',          100,  false, true,  '2090-05-04 00:00+00');  -- excluded
select tests.ct_cost('ai_ideas',          50,   false, false, '2090-03-01 00:00+00');  -- before the window
select tests.ct_cost('ai_ideas',          7,    false, false, '2090-04-01 12:00+00');  -- exactly the window start
select tests.ct_cost('ai_capture',        999,  false, false, '2090-06-30 12:00:01+00');

insert into concierge.monthly_bills (month, vendor, cents) values
  ('2090-04-01', 'vercel', 700),    -- starts before the counting start
  ('2090-05-01', 'vercel', 1000),
  ('2090-05-01', 'supabase', 500),
  ('2090-06-01', 'vercel', 900);    -- the current month, not over yet
-- 2090-03 has no bill at all.

select tests.act_as_server();
select concierge.cost_per_gift('2090-06-30 12:00+00') as r1 \gset
select tests.reset_role();

select is(
  (select array_agg(k order by k) from jsonb_object_keys(:'r1'::jsonb) k),
  array['aiCents', 'aiEstimated', 'aiRecords', 'billCents', 'billGifts', 'bills', 'excludedCents', 'gifts', 'lookupCents', 'orderFeeCents', 'since', 'windowDays'],
  'cost_per_gift returns exactly the CostPerGift keys');
select is((:'r1'::jsonb ->> 'gifts')::int, 5, 'gifts counts placed, shipped and delivered orders in the window, start excluded and p_now included, not excluded accounts');
select is((:'r1'::jsonb ->> 'windowDays')::int, 90, 'windowDays comes from the setting');
select is((:'r1'::jsonb ->> 'orderFeeCents')::int, concierge.setting_int('zinc_order_fee_cents'), 'orderFeeCents comes from the setting');
select is(:'r1'::jsonb ->> 'since', '2090-04-01T12:00:00.000Z', 'since is the window start when that is later than cost_tracking_since');
select is((:'r1'::jsonb ->> 'aiCents')::numeric, 15.75::numeric, 'aiCents adds ai_ideas and ai_capture in the window, not excluded, start excluded, p_now included');
select is((:'r1'::jsonb ->> 'lookupCents')::numeric, 5::numeric, 'lookupCents adds lookup_ideas and lookup_price_check');
select is((:'r1'::jsonb ->> 'aiRecords')::int, 3, 'aiRecords counts the AI rows counted');
select is((:'r1'::jsonb ->> 'aiEstimated')::int, 1, 'aiEstimated counts those marked estimated');
select is((:'r1'::jsonb ->> 'excludedCents')::numeric, 100::numeric, 'excluded rows are only in excludedCents');
select is((:'r1'::jsonb ->> 'billCents')::int, 1500, 'billCents counts only whole months that ended, started on or after the counting start, and have a bill');
select is((:'r1'::jsonb ->> 'billGifts')::int, 3, 'billGifts counts the gifts placed in the counted months');
select is(:'r1'::jsonb -> 'bills', '[{"month": "2090-05-01", "vendors": ["supabase", "vercel"]}]'::jsonb, 'each counted month lists its vendors');

-- A later cost_tracking_since moves the start: orders, costs and bill months before it drop out.
update concierge.app_settings set value = to_jsonb('2090-05-15T00:00:00Z'::text) where key = 'cost_tracking_since';
select tests.act_as_server();
select concierge.cost_per_gift('2090-06-30 12:00+00') as r2 \gset
select tests.reset_role();
select is(:'r2'::jsonb ->> 'since', '2090-05-15T00:00:00.000Z', 'since shows the later cost_tracking_since');
select is((:'r2'::jsonb ->> 'gifts')::int, 4, 'orders before cost_tracking_since are not counted, even inside the window');
select is((:'r2'::jsonb ->> 'aiCents')::numeric, 1::numeric, 'costs before cost_tracking_since are not counted');
select is((:'r2'::jsonb ->> 'lookupCents')::numeric, 2::numeric, 'lookup costs before cost_tracking_since are not counted');
select is((:'r2'::jsonb ->> 'aiRecords')::int, 1, 'aiRecords follows the counting start');
select is((:'r2'::jsonb ->> 'excludedCents')::numeric, 0::numeric, 'excluded costs before cost_tracking_since are not counted');
select is((:'r2'::jsonb ->> 'billCents')::int, 0, 'a bill month starting before cost_tracking_since is not counted');
select is(:'r2'::jsonb -> 'bills', '[]'::jsonb, 'no bill months are listed');
select is((:'r2'::jsonb ->> 'billGifts')::int, 0, 'no bill months means no billGifts');

-- A bill month with no gifts: billCents > 0, billGifts = 0.
update concierge.app_settings set value = to_jsonb('2090-01-01T00:00:00Z'::text) where key = 'cost_tracking_since';
insert into concierge.monthly_bills (month, vendor, cents) values ('2090-02-01', 'vercel', 300);
select tests.act_as_server();
select concierge.cost_per_gift('2090-03-15 12:00+00') as r3 \gset
select tests.reset_role();
select is((:'r3'::jsonb ->> 'gifts')::int, 0, 'no gifts before the first order');
select is((:'r3'::jsonb ->> 'billCents')::int, 300, 'a bill month with no gifts still counts in billCents');
select is((:'r3'::jsonb ->> 'billGifts')::int, 0, 'a bill month with no gifts gives billGifts 0');

-- ─── Bills: one per month and vendor ─────────────────────────────────────────
select throws_ok($$insert into concierge.monthly_bills (month, vendor, cents) values ('2090-05-01', 'vercel', 1)$$, '23505', null, 'a second bill for the same month and vendor is refused');
insert into concierge.monthly_bills (month, vendor, cents) values ('2090-05-01', 'vercel', 1234)
  on conflict (month, vendor) do update set cents = excluded.cents;
select is((select cents from concierge.monthly_bills where month = '2090-05-01' and vendor = 'vercel'), 1234, 'on conflict do update replaces the bill');
select throws_ok($$insert into concierge.monthly_bills (month, vendor, cents) values ('2090-05-02', 'x', 1)$$, '23514', null, 'a month must be the first of the month');
select throws_ok($$insert into concierge.monthly_bills (month, vendor, cents) values ('2090-07-01', '  ', 1)$$, '23514', null, 'a vendor cannot be blank');
select throws_ok($$insert into concierge.monthly_bills (month, vendor, cents) values ('2090-07-01', 'x', -1)$$, '23514', null, 'a bill cannot be negative');

-- ─── Settings ────────────────────────────────────────────────────────────────
select is(concierge.setting_int('cost_tracking_enabled'), 1, 'cost_tracking_enabled ships on');
select is(concierge.setting_int('cost_record_timeout_ms'), 3000, 'cost_record_timeout_ms is 3000');
select ok((select value from concierge.app_settings where key = 'cost_tracking_since') is not null
  and (select description from concierge.app_settings where key = 'cost_tracking_since') ~* 'again',
  'cost_tracking_since exists and its description says to set it again');
select is(concierge.setting_int('cost_window_days'), 90, 'cost_window_days is 90');

-- ─── A missing setting raises ────────────────────────────────────────────────
select tests.act_as_server();
select lives_ok($$select concierge.cost_per_gift('2090-06-30 12:00+00')$$, 'cost_per_gift runs with every setting present');
select tests.reset_role();
create function tests.ct_without(p_key text) returns text language plpgsql as $$
declare
  v_value jsonb;
begin
  select value into v_value from concierge.app_settings where key = p_key;
  delete from concierge.app_settings where key = p_key;
  begin
    perform concierge.cost_per_gift('2090-06-30 12:00+00');
    insert into concierge.app_settings (key, value) values (p_key, v_value);
    return 'no error';
  exception when others then
    insert into concierge.app_settings (key, value) values (p_key, v_value);
    return sqlerrm;
  end;
end;
$$;
select ok(tests.ct_without('cost_window_days') like '%cost_window_days%', 'a missing cost_window_days raises');
select ok(tests.ct_without('cost_tracking_since') like '%cost_tracking_since%', 'a missing cost_tracking_since raises');
select ok(tests.ct_without('zinc_order_fee_cents') like '%zinc_order_fee_cents%', 'a missing zinc_order_fee_cents raises');
select ok(tests.ct_without('cost_tracking_enabled') like '%cost_tracking_enabled%', 'a missing cost_tracking_enabled raises');

select * from finish();
rollback;
