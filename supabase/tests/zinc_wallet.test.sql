-- Zinc wallet (ALL-32, ALL-30): the money-path database layer. Every
-- function records what happened to an order, then reconcile_round works
-- out the round's status from its orders under the round row lock.
-- The two-connection races are in apps/web/modules/concierge/__tests__/placing-race.test.ts.
begin;
\ir _helpers.psql
select plan(131);

-- ─── fixtures ───────────────────────────────────────────────────────────────

-- A user with a concierge account: paid features on, connected and with a
-- phone unless told otherwise.
create function tests.zw_user(p_email text, p_paid boolean default true, p_connected boolean default true)
returns uuid language plpgsql as $$
declare v_user uuid := tests.create_user(p_email);
begin
  insert into concierge.accounts (user_id, paid_features, buyer_phone, zinc_connected_at, zinc_api_key_secret_id, zinc_env)
  values (v_user, p_paid,
          case when p_connected then '5555550100' end,
          case when p_connected then now() end,
          case when p_connected then gen_random_uuid() end,
          case when p_connected then 'test' end);
  return v_user;
end $$;

-- A round for a new person, so each round has its own person and occasion.
create function tests.zw_round(p_user uuid, p_status concierge.round_status default 'awaiting_approval',
                               p_deadline date default current_date + 30)
returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
  values (p_user, v_person, v_occasion, 2030, p_deadline + 7, p_deadline, 5000, p_status, now())
  returning id into v_round;
  return v_round;
end $$;

create function tests.zw_idea(p_round uuid, p_list_item uuid default null)
returns uuid language sql as $$
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id)
  select r.user_id, r.id, 'Mug', 4000, 4500, 1, case when p_list_item is null then 'generated' else 'list' end, p_list_item
    from concierge.gift_rounds r where r.id = p_round
  returning id;
$$;

-- An order in the given state, with its address snapshot.
create function tests.zw_order(p_round uuid, p_status text, p_hold text default null, p_failure text default null,
                               p_idea uuid default null)
returns uuid language plpgsql as $$
declare v_order uuid; v_user uuid;
begin
  select user_id into v_user from concierge.gift_rounds where id = p_round;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                                failure_type, ship_to, ship_city, ship_state)
  values (v_user, p_round, coalesce(p_idea, tests.zw_idea(p_round)), 'zinc_wallet', 4500, 100, p_status, p_hold,
          p_failure, 'recipient', 'Dayton', 'OH')
  returning id into v_order;
  insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
  values (v_order, v_user, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US');
  return v_order;
end $$;

-- Takes the round's lease the way the engine would; returns the lock value.
create function tests.zw_lease(p_round uuid)
returns timestamptz language sql as $$
  update concierge.gift_rounds set locked_until = now() + interval '10 minutes' where id = p_round returning locked_until;
$$;

create function tests.zw_state(p_round uuid)
returns text language sql as $$
  select status::text || '/' || coalesce(attention_reason, '-') from concierge.gift_rounds where id = p_round;
$$;

create function tests.zw_tomorrow()
returns timestamptz language sql as $$
  select ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';

select tests.zw_user('a@example.com') as a \gset
select tests.zw_user('b@example.com') as b \gset

-- ─── schema, settings and grants ────────────────────────────────────────────

select has_table('concierge', 'zinc_connect_attempts', 'connect attempts are kept server-side');
select results_eq(
  $q$select key, value::text from concierge.app_settings
      where key in ('order_price_margin_pct', 'funding_lookahead_days', 'funding_topup_suggest_cents', 'zinc_timeout_ms',
                    'zinc_poll_claim_seconds', 'placing_stale_minutes', 'zinc_place_budget_ms', 'zinc_retry_attempts',
                    'zinc_retry_base_ms', 'hold_reminder_days', 'hold_final_days')
      order by key$q$,
  $q$values ('funding_lookahead_days', '21'), ('funding_topup_suggest_cents', '10000'), ('hold_final_days', '2'),
            ('hold_reminder_days', '7'), ('order_price_margin_pct', '10'), ('placing_stale_minutes', '30'),
            ('zinc_place_budget_ms', '45000'), ('zinc_poll_claim_seconds', '30'), ('zinc_retry_attempts', '3'),
            ('zinc_retry_base_ms', '1000'), ('zinc_timeout_ms', '15000')$q$,
  'the Zinc settings rows are there (T23)');
select ok(exists (select 1 from concierge.app_settings where key = 'zinc_ordering_enabled'), 'the ordering kill switch is a setting');

select tests.act_as(:'a');
select throws_ok('select * from concierge.zinc_connect_attempts', '42501', null, 'users can''t read connect attempts');
select throws_ok('select buyer_phone from concierge.accounts', '42501', null, 'users can''t read buyer_phone');
select throws_ok('select zinc_webhook_id from concierge.accounts', '42501', null, 'users can''t read the webhook id');
select lives_ok('select attention_reason, hold_count from concierge.gift_rounds', 'users read why their round needs them');
select throws_ok('select last_emailed_reason from concierge.gift_rounds', '42501', null, 'users can''t read the other new round columns');
select throws_ok('select hold_reason from concierge.orders', '42501', null, 'users can''t read hold_reason');
select lives_ok('select over_budget_pct, paid_features from concierge.accounts', 'users still read their own settings');
select lives_ok('select id, status, budget_cents from concierge.gift_rounds', 'users still read their rounds');
select throws_ok($q$update concierge.accounts set buyer_phone = '5555550199'$q$, '42501', null, 'users can''t set buyer_phone');
select throws_ok('delete from concierge.accounts', '42501', null, 'users can''t delete their account row (it would drop the Vault secrets)');
select tests.reset_role();

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'concierge' and p.proname in ('reconcile_round', 'release_round', 'claim_round_now', 'approve_round',
            'begin_placing', 'record_outcomes', 'settle_order', 'fail_order', 'hold_orders', 'mark_unconfirmed', 'cancel_held',
            'reapprove_order', 'zinc_forget', 'zinc_store_secrets', 'zinc_secrets', 'zinc_secret_by_webhook', 'zinc_claim_poll',
            'zinc_drop_attempt', 'held_rounds_for_user', 'order_by_reference', 'stale_placing_orders', 'lookahead_rounds',
            'set_seen_balance', 'set_emailed_balance', 'set_last_emailed_reason'))
       or (n.nspname = 'lists' and p.proname in ('claim_for_order', 'release_for_order'))),
  27, 'all 27 new functions exist');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ((n.nspname = 'concierge' and p.proname in ('reconcile_round', 'release_round', 'claim_round_now', 'approve_round',
            'begin_placing', 'record_outcomes', 'settle_order', 'fail_order', 'hold_orders', 'mark_unconfirmed', 'cancel_held',
            'reapprove_order', 'zinc_forget', 'zinc_store_secrets', 'zinc_secrets', 'zinc_secret_by_webhook', 'zinc_claim_poll',
            'zinc_drop_attempt', 'held_rounds_for_user', 'order_by_reference', 'stale_placing_orders', 'lookahead_rounds',
            'set_seen_balance', 'set_emailed_balance', 'set_last_emailed_reason', 'fail_order_row', 'remove_zinc_secrets'))
       or (n.nspname = 'lists' and p.proname in ('claim_for_order', 'release_for_order')))
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'signed-in users and visitors can''t call any of them');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ((n.nspname = 'concierge' and p.proname in ('reconcile_round', 'begin_placing', 'zinc_secrets', 'zinc_forget', 'settle_order'))
       or (n.nspname = 'lists' and p.proname = 'claim_for_order'))
      and has_function_privilege('service_role', p.oid, 'execute') and p.prosecdef),
  6, 'the server can call them, and they run as their owner');
select throws_ok(
  format($q$update concierge.accounts set buyer_phone = '555-0100' where user_id = %L$q$, :'a'),
  '23514', null, 'buyer_phone is 10 digits');

-- The unique index treats held and unconfirmed orders as live.
select tests.zw_round(:'a', 'needs_attention') as r_idx \gset
select tests.zw_idea(:'r_idx') as idx_idea \gset
select tests.zw_order(:'r_idx', 'unconfirmed', p_idea => :'idx_idea') as idx_order \gset
select throws_ok(format($q$select tests.zw_order(%L, 'held', 'retry', p_idea => %L)$q$, :'r_idx', :'idx_idea'),
  '23505', null, 'an unconfirmed order blocks a second live order for the idea');
select throws_ok(
  format($q$update concierge.orders set hold_reason = 'unconfirmed' where id = %L$q$, :'idx_order'),
  '23514', null, 'unconfirmed is not an order hold');

-- ─── connect attempts ──────────────────────────────────────────────────────

insert into concierge.zinc_connect_attempts (user_id, device_code, user_code, verification_url, interval_sec, expires_at)
values (:'a', 'dev-code', 'ABCD-EFGH', 'https://zinc.example/verify', 5, now() + interval '10 minutes');
select tests.act_as_server();
select isnt((concierge.zinc_claim_poll(:'a', now())).device_code, null, 'the first poll claims the attempt');
select is((concierge.zinc_claim_poll(:'a', now() + interval '5 seconds')).device_code, null, 'a second poll within 30 s gets nothing');
select isnt((concierge.zinc_claim_poll(:'a', now() + interval '31 seconds')).device_code, null, 'after the claim lapses it can poll again');
select concierge.zinc_drop_attempt(:'a');
select tests.reset_role();
select is((select count(*)::int from concierge.zinc_connect_attempts where user_id = :'a'), 0, 'dropping the attempt removes it');

-- ─── reconcile_round ───────────────────────────────────────────────────────

select tests.act_as_server();

-- failed, then deadline → skipped
select tests.zw_round(:'a', 'needs_attention') as r1 \gset
select tests.zw_order(:'r1', 'failed', p_failure => 'out_of_stock') as r1_o \gset
select is(concierge.reconcile_round(:'r1')::text, 'needs_attention', 'an unresolved failure needs attention');
select is(tests.zw_state(:'r1'), 'needs_attention/out_of_stock', '... with the failure as the reason');
select is(concierge.cancel_held(:'r1', 'deadline')::text, 'skipped', 'failed then the deadline → skipped');
select is((select resolved from concierge.orders where id = :'r1_o'), true, 'the deadline resolves the failure');
select is((select next_action_at from concierge.gift_rounds where id = :'r1'), null, 'a skipped round has nothing left to do');

-- placed plus failed, then deadline → ordered
select tests.zw_round(:'a', 'needs_attention') as r2 \gset
select tests.zw_order(:'r2', 'placed') as r2_placed \gset
select tests.zw_order(:'r2', 'failed', p_failure => 'price_up') as r2_failed \gset
select is(concierge.reconcile_round(:'r2')::text, 'needs_attention', 'a failure next to a placed order still needs attention');
select is(concierge.cancel_held(:'r2', 'deadline')::text, 'ordered', 'placed plus failed, then the deadline → ordered');
select is((select next_action_at from concierge.gift_rounds where id = :'r2'),
  (select ship_by_deadline::timestamp at time zone 'utc' from concierge.gift_rounds where id = :'r2'),
  'an ordered round is next looked at on its deadline');

-- unconfirmed is never cancelled
select tests.zw_round(:'a', 'ordered') as r3 \gset
select tests.zw_order(:'r3', 'unconfirmed') as r3_o \gset
select is(concierge.cancel_held(:'r3', 'deadline')::text, 'needs_attention', 'unconfirmed then the deadline is not skipped');
select is(tests.zw_state(:'r3'), 'needs_attention/unconfirmed', '... it waits as unconfirmed');
select is(concierge.cancel_held(:'r3', 'cancel')::text, 'needs_attention', 'a cancel doesn''t touch it either');
select is((select status from concierge.orders where id = :'r3_o'), 'unconfirmed', 'the unconfirmed order is untouched');

-- final statuses never move
select tests.zw_round(:'a', 'delivered') as r4 \gset
select tests.zw_order(:'r4', 'held', 'funds') as r4_o \gset
select is(concierge.cancel_held(:'r4', 'deadline')::text, 'delivered', 'a delivered round is never moved');
select is((select status from concierge.orders where id = :'r4_o'), 'held', '... and its orders are left alone');

-- hold_count: funds → retry → funds sends no new notice
select tests.zw_round(:'a', 'needs_attention') as r5 \gset
select tests.zw_order(:'r5', 'held', 'funds') as r5_o \gset
select concierge.reconcile_round(:'r5');
select is((select hold_count from concierge.gift_rounds where id = :'r5'), 1, 'the first emailed hold is hold 1');
select is((select next_action_at from concierge.gift_rounds where id = :'r5'), now(), 'its notice is unsent, so it is due now');
select concierge.set_last_emailed_reason(:'r5', 'funds');
insert into concierge.round_sends (round_id, user_id, step) values (:'r5', :'a', 'hold:1:notice');
select is(concierge.hold_orders(:'r5', 'retry')::text, 'needs_attention', 'a retry hold');
select is(tests.zw_state(:'r5'), 'needs_attention/retry', '... with reason retry');
select is((select next_action_at from concierge.gift_rounds where id = :'r5'), tests.zw_tomorrow(), 'retry waits for tomorrow''s tick');
select concierge.hold_orders(:'r5', 'funds');
select is((select hold_count from concierge.gift_rounds where id = :'r5'), 1, 'funds → retry → funds doesn''t bump hold_count');
select is((select next_action_at from concierge.gift_rounds where id = :'r5'), tests.zw_tomorrow(), 'its notice was sent, so tomorrow');

-- a reason change setup → funds bumps hold_count
select tests.zw_round(:'a', 'needs_attention') as r6 \gset
select tests.zw_order(:'r6', 'held', 'setup') as r6_o \gset
select concierge.reconcile_round(:'r6');
select concierge.set_last_emailed_reason(:'r6', 'setup');
select concierge.reconcile_round(:'r6');
select is((select hold_count from concierge.gift_rounds where id = :'r6'), 1, 'reconciling again doesn''t bump hold_count');
select concierge.hold_orders(:'r6', 'funds');
select is((select hold_count from concierge.gift_rounds where id = :'r6'), 2, 'setup → funds bumps hold_count');

-- ─── approve_round ─────────────────────────────────────────────────────────

select tests.reset_role();
insert into lists.lists (owner_id, title) values (:'b', 'B''s list') returning id as list_id \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 0, 'Vase', 4000) returning id as item \gset
select tests.zw_round(:'a', 'awaiting_approval') as r7 \gset
select tests.zw_idea(:'r7', :'item') as r7_list_idea \gset
select tests.zw_idea(:'r7') as r7_idea \gset
select tests.zw_lease(:'r7') as r7_lock \gset
select tests.zw_round(:'b', 'awaiting_approval') as rb \gset
select tests.zw_idea(:'rb') as b_idea \gset
select tests.act_as_server();

select format('[{"idea_id": "%s", "max_price_cents": 4500, "fee_cents": 100, "gift_message": "Enjoy", "ship_to": "recipient",
                 "address": {"recipient_first_name": "Mary", "recipient_last_name": "Allen", "address_line1": "12 Oak St",
                             "city": "Dayton", "state": "OH", "zip": "45402", "country": "US"}}, %s]',
  :'r7_list_idea',
  format('{"idea_id": "%s", "max_price_cents": 3000, "fee_cents": 100, "ship_to": "buyer",
           "address": {"recipient_first_name": "Ann", "recipient_last_name": "A", "address_line1": "1 Elm",
                       "city": "Akron", "state": "OH", "zip": "44301", "country": "US"}}', :'r7_idea')) as r7_orders \gset

select throws_ok(format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r7', :'a', now(), :'r7_orders'),
  'P0001', null, 'approve_round refuses without the lease');
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r7', :'a', :'r7_lock',
    format('[{"idea_id": "%s", "max_price_cents": 1, "fee_cents": 100, "ship_to": "buyer", "address": {}}]', :'b_idea')),
  'P0001', null, 'approve_round refuses another user''s idea');
select is((select count(*)::int from concierge.approve_round(:'r7', :'a', :'r7_lock', :'r7_orders')), 2, 'approve_round writes one order per idea');
select is(tests.zw_state(:'r7'), 'needs_attention/retry', 'the approved round waits as needs_attention/retry');
select is((select next_action_at from concierge.gift_rounds where id = :'r7'), tests.zw_tomorrow(),
  'tomorrow''s tick is only the crash fallback');
select results_eq(
  format($q$select o.status, o.hold_reason, o.max_price_cents, o.ship_city, a.address_line1
              from concierge.orders o join concierge.order_addresses a on a.order_id = o.id
             where o.round_id = %L order by o.max_price_cents$q$, :'r7'),
  $q$values ('held'::text, 'retry'::text, 3000, 'Akron'::text, '1 Elm'::text), ('held', 'retry', 4500, 'Dayton', '12 Oak St')$q$,
  'orders are held for retry with their address snapshots');
select is((select count(*)::int from concierge.gift_ideas where round_id = :'r7' and status = 'selected'), 2, 'the ideas are selected');
select is((select claimer_id from lists.gift_claims where item_id = :'item'), :'a'::uuid, 'the list pick is claimed at approval');
select throws_ok(format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r7', :'a', :'r7_lock', :'r7_orders'),
  'P0001', null, 'approve_round refuses a round that already has a live order');
-- a list claim is released on the deadline
select is(concierge.cancel_held(:'r7', 'deadline')::text, 'skipped', 'held orders at the deadline → skipped');
select is((select count(*)::int from lists.gift_claims where item_id = :'item'), 0, 'the list claim is released on the deadline');
select is((select count(*)::int from concierge.orders where round_id = :'r7' and status = 'cancelled' and failure_type = 'held_expired'),
  2, 'held orders are cancelled as held_expired');

-- ─── begin_placing ─────────────────────────────────────────────────────────

-- The kill switch at 0 → paused
select tests.zw_round(:'a', 'needs_attention') as r8 \gset
select tests.zw_order(:'r8', 'held', 'retry') as r8_o \gset
select concierge.reconcile_round(:'r8');
select tests.zw_lease(:'r8') as r8_lock \gset
select format('[{"id": "%s", "max_price_cents": 4500}]', :'r8_o') as r8_orders \gset
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled';
select tests.act_as_server();
select is((select count(*)::int from concierge.begin_placing(:'r8', :'r8_lock', current_date, :'r8_orders')), 0,
  'the kill switch at 0 places nothing');
select is(tests.zw_state(:'r8'), 'needs_attention/paused', '... and the round is paused');
select is((select status || '/' || hold_reason from concierge.orders where id = :'r8_o'), 'held/paused', '... with the order held, not placing');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';
update concierge.accounts set paid_features = false where user_id = :'a';
select tests.act_as_server();
select is((select count(*)::int from concierge.begin_placing(:'r8', :'r8_lock', current_date, :'r8_orders')), 0,
  'no paid features places nothing');
select is(tests.zw_state(:'r8'), 'needs_attention/not_allowed', '... and the hold is not_allowed');
select tests.reset_role();
update concierge.accounts set paid_features = true, buyer_phone = null where user_id = :'a';
select tests.act_as_server();
select is((select count(*)::int from concierge.begin_placing(:'r8', :'r8_lock', current_date, :'r8_orders')), 0,
  'no phone places nothing');
select is(tests.zw_state(:'r8'), 'needs_attention/setup', '... and the hold is setup');
select tests.reset_role();
update concierge.accounts set buyer_phone = '5555550100' where user_id = :'a';
select tests.act_as_server();
select is((select count(*)::int from concierge.begin_placing(:'r8', :'r8_lock',
    (select ship_by_deadline from concierge.gift_rounds where id = :'r8'), :'r8_orders')), 0,
  'the deadline day places nothing');
select is((select status from concierge.orders where id = :'r8_o'), 'held', '... and the order stays held');
select is((select count(*)::int from concierge.begin_placing(:'r8', :'r8_lock', current_date,
    format('[{"id": "%s", "max_price_cents": 9999}]', :'r8_o')::jsonb)), 1, 'with every gate open it places the held order');
select is((select status || '/' || max_price_cents from concierge.orders where id = :'r8_o'), 'placing/4500',
  '... placing, and the cap never goes up');
select is(tests.zw_state(:'r8'), 'ordered/-', '... and the round is ordered');
select is((select count(*)::int from concierge.begin_placing(:'r8', :'r8_lock', current_date, :'r8_orders')), 0,
  'zero held orders → nothing');

-- ─── record_outcomes ───────────────────────────────────────────────────────

select tests.zw_round(:'a', 'ordered') as r9 \gset
select tests.zw_order(:'r9', 'placing') as o_unknown \gset
select tests.zw_order(:'r9', 'placing') as o_unsent \gset
select tests.zw_order(:'r9', 'placing') as o_short \gset
select tests.zw_order(:'r9', 'placing') as o_sent \gset
select tests.reset_role();
select idempotency_key as k_unknown from concierge.orders where id = :'o_unknown' \gset
select idempotency_key as k_unsent from concierge.orders where id = :'o_unsent' \gset
select idempotency_key as k_short from concierge.orders where id = :'o_short' \gset
select tests.act_as_server();
select is(concierge.record_outcomes(:'r9', jsonb_build_array(
    jsonb_build_object('order_id', :'o_sent', 'outcome', 'sent', 'provider_order_id', 'zn_1'),
    jsonb_build_object('order_id', :'o_unknown', 'outcome', 'unknown'),
    jsonb_build_object('order_id', :'o_unsent', 'outcome', 'unsent'),
    jsonb_build_object('order_id', :'o_short', 'outcome', 'insufficient', 'available_cents', 1200)))::text,
  'needs_attention', 'a hold next to a placing order needs attention at once');
select is((select status || '/' || (idempotency_key = :'k_unknown') from concierge.orders where id = :'o_unknown'), 'placing/true',
  'unknown stays placing with its key');
select is((select status || '/' || hold_reason || '/' || (idempotency_key = :'k_unsent') from concierge.orders where id = :'o_unsent'),
  'held/retry/true', 'unsent → retry with the same key');
select is((select status || '/' || hold_reason || '/' || (idempotency_key = :'k_short') from concierge.orders where id = :'o_short'),
  'held/funds/false', 'insufficient → funds with a new key');
select is((select seen_balance_cents from concierge.gift_rounds where id = :'r9'), 1200, 'the balance Zinc reported is saved');
select is((select status || '/' || provider_order_id from concierge.orders where id = :'o_sent'), 'placing/zn_1', 'sent saves the Zinc id');

-- one sent plus one insufficient → needs_attention/funds at once, so the customer is told
select tests.zw_round(:'a', 'ordered') as r10 \gset
select tests.zw_order(:'r10', 'placing') as r10_sent \gset
select tests.zw_order(:'r10', 'placing') as r10_short \gset
select is(concierge.record_outcomes(:'r10', jsonb_build_array(
    jsonb_build_object('order_id', :'r10_sent', 'outcome', 'sent', 'provider_order_id', 'zn_2'),
    jsonb_build_object('order_id', :'r10_short', 'outcome', 'insufficient', 'available_cents', 0)))::text,
  'needs_attention', 'one sent plus one insufficient → needs_attention');
select is(tests.zw_state(:'r10'), 'needs_attention/funds', '... with reason funds, before any webhook');
select is((select next_action_at from concierge.gift_rounds where id = :'r10'), now(), '... and the hold email is due now');
select is((select status from concierge.orders where id = :'r10_sent'), 'placing', 'the sent one is untouched');
select is(concierge.settle_order(:'a', :'r10_sent', 'placed', null, '{"total_cents": 4300}')::text, 'needs_attention',
  'once the sent one is placed the round still waits on the funds hold');
select is((select status || '/' || total_cents from concierge.orders where id = :'r10_sent'), 'placed/4300', 'the placed one is untouched');
select is(concierge.record_outcomes(:'r10', jsonb_build_array(
    jsonb_build_object('order_id', :'r10_sent', 'outcome', 'insufficient'))) ::text, 'needs_attention',
  'record_outcomes only touches orders still placing');
select is((select status from concierge.orders where id = :'r10_sent'), 'placed', '... so a placed order stays placed');

-- placing + held/funds: begin_placing moves only the held one; all placed → ordered
select tests.zw_round(:'a', 'ordered') as r17 \gset
select tests.zw_order(:'r17', 'placing') as r17_placing \gset
select tests.zw_order(:'r17', 'held', 'funds') as r17_held \gset
select concierge.reconcile_round(:'r17');
select is(tests.zw_state(:'r17'), 'needs_attention/funds', 'placing + held/funds → needs_attention/funds');
select tests.zw_lease(:'r17') as r17_lock \gset
select results_eq(
  format($q$select id from concierge.begin_placing(%L, %L, current_date, %L)$q$, :'r17', :'r17_lock',
         format('[{"id": "%s", "max_price_cents": 4500}]', :'r17_held')),
  format($q$values (%L::uuid)$q$, :'r17_held'),
  'begin_placing moves only the held order');
select is(tests.zw_state(:'r17'), 'ordered/-', '... and with both placing the round is ordered');
select concierge.settle_order(:'a', :'r17_placing', 'placed', null, null);
select is(concierge.settle_order(:'a', :'r17_held', 'placed', null, null)::text, 'ordered', 'all placed → ordered');

-- rejected → failed with its failure type
select tests.zw_round(:'a', 'ordered') as r11 \gset
select tests.zw_order(:'r11', 'placing') as r11_o \gset
select concierge.record_outcomes(:'r11', jsonb_build_array(
  jsonb_build_object('order_id', :'r11_o', 'outcome', 'rejected', 'failure_type', 'out_of_stock')));
select is((select status || '/' || failure_type from concierge.orders where id = :'r11_o'), 'failed/out_of_stock', 'rejected → failed');

-- ─── settle_order ──────────────────────────────────────────────────────────

-- a failed price_up on a funds round: the held gift decides the reason (ALL-116), so it's
-- still emailed and placed; the failure is told by its own key.
select tests.zw_round(:'a', 'needs_attention') as r12 \gset
select tests.zw_order(:'r12', 'held', 'funds') as r12_held \gset
select tests.zw_order(:'r12', 'placing') as r12_placing \gset
select is(concierge.settle_order(:'b', :'r12_placing', 'failed', 'price_up', null)::text, null,
  'another user''s webhook can''t settle the order');
select is((select status from concierge.orders where id = :'r12_placing'), 'placing', '... it is untouched');
select concierge.settle_order(:'a', :'r12_placing', 'failed', 'price_up', null);
select is(tests.zw_state(:'r12'), 'needs_attention/funds', 'a failed price_up on a funds round stays funds (ALL-116)');

-- invalid_shipping_address twice → one replacement
select tests.zw_round(:'a', 'ordered') as r13 \gset
select tests.zw_order(:'r13', 'placing') as r13_o \gset
select concierge.settle_order(:'a', :'r13_o', 'failed', 'invalid_shipping_address', null);
select concierge.settle_order(:'a', :'r13_o', 'failed', 'invalid_shipping_address', null);
select results_eq(
  format($q$select status, coalesce(hold_reason, '-'), resolved from concierge.orders where round_id = %L order by created_at, status$q$, :'r13'),
  $q$values ('failed'::text, '-'::text, true), ('held', 'address', false)$q$,
  'a bad address resolves the order and adds one held/address replacement');
select is(tests.zw_state(:'r13'), 'needs_attention/address', 'the round waits for an address');

-- reapprove after price_up
select tests.zw_round(:'a', 'needs_attention') as r14 \gset
select tests.zw_order(:'r14', 'failed', p_failure => 'price_up') as r14_o \gset
select concierge.reconcile_round(:'r14');
select tests.zw_lease(:'r14') as r14_lock \gset
select is((select max_price_cents from concierge.reapprove_order(:'r14', :'a', :'r14_lock', :'r14_o', 5200)), 5200,
  're-approving writes a replacement with the new cap');
select is(tests.zw_state(:'r14'), 'needs_attention/retry', '... held for retry, the failure resolved');

-- ─── cancel_held and skip_open_rounds ──────────────────────────────────────

select tests.zw_round(:'a', 'needs_attention') as r15 \gset
select tests.zw_order(:'r15', 'placed') as r15_placed \gset
select tests.zw_order(:'r15', 'held', 'funds') as r15_held \gset
select is(concierge.cancel_held(:'r15', 'cancel')::text, 'ordered', 'cancel with one placed and one held → ordered');
select is((select status from concierge.orders where id = :'r15_held'), 'cancelled', '... the held one is cancelled');

select tests.zw_round(:'a', 'needs_attention') as r16 \gset
select tests.zw_order(:'r16', 'placed') as r16_placed \gset
select tests.zw_order(:'r16', 'held', 'funds') as r16_held \gset
select person_id as p16 from concierge.gift_rounds where id = :'r16' \gset
select concierge.skip_open_rounds(:'p16', null);
select is(tests.zw_state(:'r16'), 'ordered/-', 'skip_open_rounds with one placed and one held → ordered');
select is((select status from concierge.orders where id = :'r16_held'), 'cancelled', '... the held one is cancelled');

-- ─── a closed round stays closed ───────────────────────────────────────────

-- The buyer cancels while some orders are in flight; their outcomes then come back.
select tests.zw_round(:'a', 'needs_attention') as r18 \gset
select tests.zw_order(:'r18', 'placing') as r18_short \gset
select tests.zw_order(:'r18', 'placing') as r18_unsent \gset
select tests.zw_order(:'r18', 'placing') as r18_badaddr \gset
select tests.zw_order(:'r18', 'held', 'funds') as r18_held \gset
select is(concierge.cancel_held(:'r18', 'cancel')::text, 'ordered', 'a cancel with orders in flight → ordered');
select concierge.record_outcomes(:'r18', jsonb_build_array(
  jsonb_build_object('order_id', :'r18_short', 'outcome', 'insufficient', 'available_cents', 0),
  jsonb_build_object('order_id', :'r18_unsent', 'outcome', 'unsent')));
select concierge.settle_order(:'a', :'r18_badaddr', 'failed', 'invalid_shipping_address', null);
select is((select count(*)::int from concierge.orders where round_id = :'r18' and status = 'held'), 0,
  'after a cancel, a 402, an unsent order or a bad address never re-holds anything');
select is((select count(*)::int from concierge.orders where round_id = :'r18'), 4, '... and no replacement order is added');
select results_eq(
  format($q$select failure_type from concierge.orders where id in (%L, %L)$q$, :'r18_short', :'r18_unsent'),
  $q$values ('round_closed'::text), ('round_closed')$q$,
  'the late 402 and the unsent order are cancelled as round_closed');
select is(tests.zw_state(:'r18'), 'skipped/-', 'nothing got past held, so the round is skipped with no hold reason');

-- The person is deleted while an order is placing; then Zinc answers 402.
select tests.zw_round(:'a', 'ordered') as r19 \gset
select tests.zw_order(:'r19', 'placing') as r19_o \gset
select person_id as p19 from concierge.gift_rounds where id = :'r19' \gset
select tests.reset_role();
update public.people set deleted_at = now() where id = :'p19';
select tests.act_as_server();
select is(tests.zw_state(:'r19'), 'ordered/-', 'deleting the person leaves an in-flight round ordered');
select isnt((select closed_at from concierge.gift_rounds where id = :'r19'), null, '... but closes it');
select concierge.record_outcomes(:'r19', jsonb_build_array(
  jsonb_build_object('order_id', :'r19_o', 'outcome', 'insufficient', 'available_cents', 0)));
select is((select status || '/' || failure_type from concierge.orders where id = :'r19_o'), 'cancelled/round_closed',
  'person deleted, then a 402 → cancelled, not held');
select is(tests.zw_state(:'r19'), 'skipped/-', '... and the round is skipped with no hold');

-- Nothing places, approves or re-approves on a closed round.
select tests.zw_round(:'a', 'needs_attention') as r20 \gset
select tests.zw_order(:'r20', 'held', 'retry') as r20_o \gset
select concierge.reconcile_round(:'r20');
select tests.zw_lease(:'r20') as r20_lock \gset
select tests.reset_role();
update concierge.gift_rounds set closed_at = now() where id = :'r20';
select tests.act_as_server();
select is((select count(*)::int from concierge.begin_placing(:'r20', :'r20_lock', current_date,
    format('[{"id": "%s", "max_price_cents": 4500}]', :'r20_o')::jsonb)), 0, 'begin_placing refuses a closed round');
select tests.zw_round(:'a', 'awaiting_approval') as r21 \gset
select tests.zw_idea(:'r21') as r21_idea \gset
select tests.zw_lease(:'r21') as r21_lock \gset
select tests.reset_role();
update concierge.gift_rounds set closed_at = now() where id = :'r21';
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r21', :'a', :'r21_lock',
    format('[{"idea_id": "%s", "max_price_cents": 1, "fee_cents": 100, "ship_to": "buyer", "address": {}}]', :'r21_idea')),
  'P0001', null, 'approve_round refuses a closed round');

-- ─── gate precedence and claimed list picks ────────────────────────────────

select tests.zw_round(:'a', 'needs_attention') as r22 \gset
select tests.zw_order(:'r22', 'held', 'address') as r22_o \gset
select concierge.reconcile_round(:'r22');
select tests.zw_lease(:'r22') as r22_lock \gset
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled';
select tests.act_as_server();
select is((select count(*)::int from concierge.begin_placing(:'r22', :'r22_lock', current_date,
    format('[{"id": "%s", "max_price_cents": 4500}]', :'r22_o')::jsonb)), 0, 'the kill switch places nothing');
select is(tests.zw_state(:'r22'), 'needs_attention/address', 'an address hold stays address when the kill switch is off');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';

insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 1, 'Lamp', 3000) returning id as item2 \gset
insert into lists.gift_claims (item_id, claimer_id, claimer_name) values (:'item2', :'b', 'Bea');
select tests.zw_round(:'a', 'awaiting_approval') as r23 \gset
select tests.zw_idea(:'r23', :'item2') as r23_idea \gset
select tests.zw_lease(:'r23') as r23_lock \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r23', :'a', :'r23_lock',
    format('[{"idea_id": "%s", "max_price_cents": 3000, "fee_cents": 100, "ship_to": "buyer",
              "address": {"recipient_first_name": "A", "recipient_last_name": "B", "address_line1": "1 Elm",
                          "city": "Akron", "state": "OH", "zip": "44301", "country": "US"}}]', :'r23_idea')),
  'P0001', 'approve_round: claimed', 'approve_round refuses a list pick someone else claimed');

-- List claims are written only through the definer functions.
select tests.reset_role();
select is(
  (select count(*)::int from (values ('anon'), ('authenticated')) r(role),
          (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
    where has_table_privilege(r.role, 'lists.gift_claims', p.priv)),
  0, 'visitors and signed-in users can''t write list claims (or set for_order)');
select ok(not has_column_privilege('authenticated', 'lists.gift_claims', 'for_order', 'UPDATE')
          and not has_column_privilege('anon', 'lists.gift_claims', 'for_order', 'INSERT'), '... column by column either');
select tests.act_as_server();

-- ─── lookups ───────────────────────────────────────────────────────────────

select is((select id from concierge.order_by_reference(:'a', :'r16_placed')), :'r16_placed'::uuid, 'an order is found by our reference');
select is((select count(*)::int from concierge.order_by_reference(:'b', :'r16_placed')), 0, '... only for its own user');
-- r12 has a funds hold next to a failure: still placeable (ALL-116). r11 has only a failure.
select ok(not exists (select 1 from concierge.held_rounds_for_user(:'a') where id = :'r11')
          and exists (select 1 from concierge.held_rounds_for_user(:'a') where id = :'r12')
          and exists (select 1 from concierge.held_rounds_for_user(:'a') where id = :'r5'), 'held rounds are the placeable ones');

-- held rounds are claimed first
select tests.reset_role();
update concierge.gift_rounds set next_action_at = '2000-01-01', locked_until = null where user_id in (:'a', :'b');
update concierge.gift_rounds set ship_by_deadline = current_date + 1 where id = :'rb';
select tests.act_as_server();
select is((select id from concierge.claim_due_rounds(now()) where id in (:'r5', :'rb') limit 1), :'r5'::uuid,
  'held rounds are claimed before earlier-deadline ones');

-- ─── zinc_forget and Vault ─────────────────────────────────────────────────

select tests.zw_user('c@example.com') as c \gset
select concierge.zinc_store_secrets(:'c', 'key-1', 'whsec-1', 'aaaaaaaa-0000-4000-8000-00000000000c', 'test');
select is((select api_key || '/' || webhook_secret || '/' || zinc_env from concierge.zinc_secrets(:'c')), 'key-1/whsec-1/test',
  'the key and webhook secret are stored in Vault');
select is((select user_id from concierge.zinc_secret_by_webhook('aaaaaaaa-0000-4000-8000-00000000000c')), :'c'::uuid,
  'the webhook id finds its account');
select tests.reset_role();
select zinc_api_key_secret_id as old_key from concierge.accounts where user_id = :'c' \gset
select tests.act_as_server();
select concierge.zinc_store_secrets(:'c', 'key-2', 'whsec-2', 'aaaaaaaa-0000-4000-8000-00000000000c', 'test');
select tests.reset_role();
select is((select count(*)::int from vault.secrets where id = :'old_key'), 0, 'storing new secrets deletes the old ones');
select tests.act_as_server();

select tests.zw_round(:'c', 'ordered') as rc \gset
select tests.zw_order(:'rc', 'placing') as rc_placing \gset
select tests.zw_round(:'c', 'needs_attention') as rc2 \gset
select tests.zw_order(:'rc2', 'held', 'funds') as rc2_held \gset
select is(concierge.zinc_forget(:'c'), 'placing', 'disconnect is refused while an order is placing');
select is((select api_key from concierge.zinc_secrets(:'c')), 'key-2', '... and nothing is cleared');
select concierge.settle_order(:'c', :'rc_placing', 'placed', null, null);
select tests.reset_role();
select zinc_api_key_secret_id as k2, zinc_webhook_secret_id as w2 from concierge.accounts where user_id = :'c' \gset
select tests.act_as_server();
select is(concierge.zinc_forget(:'c'), 'ok', 'disconnect works once nothing is placing');
select tests.reset_role();
select is((select count(*)::int from vault.secrets where id in (:'k2', :'w2')), 0, 'the Vault secrets are deleted');
select is((select row(zinc_api_key_secret_id, zinc_webhook_secret_id, zinc_webhook_id, zinc_connected_at, buyer_phone, zinc_env)::text
             from concierge.accounts where user_id = :'c'), '(,,,,,)', 'the Zinc columns and phone are cleared');
select is(tests.zw_state(:'rc2'), 'needs_attention/setup', 'held orders now wait for setup');

-- an account delete removes the Vault rows
select tests.act_as_server();
select concierge.zinc_store_secrets(:'c', 'key-3', 'whsec-3', 'aaaaaaaa-0000-4000-8000-00000000000d', 'test');
select tests.reset_role();
select zinc_api_key_secret_id as k3, zinc_webhook_secret_id as w3 from concierge.accounts where user_id = :'c' \gset
delete from auth.users where id = :'c';
select is((select count(*)::int from vault.secrets where id in (:'k3', :'w3')), 0, 'deleting the account removes its Vault secrets');

select * from finish();
rollback;
