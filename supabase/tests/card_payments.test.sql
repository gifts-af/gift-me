-- Paying by card (planning 59, 61): what card orders save at approval, that each is only
-- ever sent on the card it was approved with, what a declined, removed or replaced card
-- does, the switch, settling, saving and removing a card, and who can read any of it.
begin;
\ir _helpers.psql
select plan(123);

update concierge.app_settings set value = '1' where key in ('zinc_ordering_enabled', 'connect_enabled', 'cost_tracking_enabled');

-- A round waiting on approval with one idea per title given, goods 2259 each.
create function tests.cp_round(p_user uuid, p_titles text[] default array['Mouse pad'])
returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid; t text; n int := 0;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, v_person, v_occasion, 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now(),
          now() + interval '10 minutes')
  returning id into v_round;
  foreach t in array p_titles loop
    n := n + 1;
    insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, goods_cents, rank, source, status)
    values (p_user, v_round, t, 2000, 2359, 2259, n, 'generated', 'proposed');
  end loop;
  return v_round;
end $$;

create function tests.cp_lock(p_round uuid)
returns timestamptz language sql as $$ select locked_until from concierge.gift_rounds where id = p_round; $$;

create function tests.cp_idea(p_round uuid, p_title text default 'Mouse pad')
returns uuid language sql as $$ select id from concierge.gift_ideas where round_id = p_round and title = p_title; $$;

-- An approve_round element with today's launch fees.
create function tests.cp_el(p_idea uuid, p_fees jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('idea_id', p_idea, 'max_price_cents', 2485, 'fee_cents', 100, 'ship_to', 'recipient',
                            'address_source', 'own',
                            'address', jsonb_build_object('recipient_first_name', 'Mary', 'recipient_last_name', 'Allen',
                                                          'address_line1', '12 Oak St', 'city', 'Dayton', 'state', 'OH',
                                                          'zip', '45402', 'country', 'US'),
                            'margin_cents', 100, 'zinc_fee_cents', 100, 'card_fee_bps', 290, 'card_fee_fixed_cents', 30)
         || p_fees;
$$;

create function tests.cp_approve(p_round uuid, p_els jsonb)
returns setof concierge.orders language sql as $$
  select * from concierge.approve_round(p_round, (select user_id from concierge.gift_rounds where id = p_round),
                                        tests.cp_lock(p_round), p_els);
$$;

-- Approves every idea of the round and returns how many orders were written.
create function tests.cp_approve_all(p_round uuid)
returns integer language sql as $$
  select count(*)::integer from tests.cp_approve(p_round,
    (select jsonb_agg(tests.cp_el(i.id) order by i.rank) from concierge.gift_ideas i where i.round_id = p_round));
$$;

-- begin_placing for every held order of the round; how many it moved to placing.
create function tests.cp_place(p_round uuid)
returns integer language sql as $$
  select count(*)::integer from concierge.begin_placing(p_round, tests.cp_lock(p_round), current_date,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'max_price_cents', o.max_price_cents))
                from concierge.orders o where o.round_id = p_round and o.status = 'held'), '[]'::jsonb));
$$;

create function tests.cp_order(p_round uuid, p_title text default 'Mouse pad')
returns concierge.orders language sql as $$
  select o.* from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
   where o.round_id = p_round and i.title = p_title
   -- One transaction gives every row the same created_at: the live one is the one not resolved.
   order by (o.status = 'failed' and o.resolved), o.created_at desc limit 1;
$$;

create function tests.cp_state(p_round uuid, p_title text default 'Mouse pad')
returns text language sql as $$
  select o.status || '/' || coalesce(o.failure_type, o.hold_reason, '-') from tests.cp_order(p_round, p_title) o;
$$;

create function tests.cp_card(p_user uuid)
returns text language sql as $$
  select coalesce(stripe_payment_method_id, '-') from concierge.accounts where user_id = p_user;
$$;

create function tests.cp_session(p_user uuid, p_session text, p_customer text default 'cus_1')
returns void language sql as $$
  insert into concierge.card_sessions (user_id, stripe_session_id, stripe_customer_id) values (p_user, p_session, p_customer);
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.create_user('card-buyer@example.com') as u \gset
insert into concierge.accounts (user_id, paid_features, buyer_phone, funding_mode, stripe_customer_id, stripe_payment_method_id)
values (:'u', true, '5555550100', 'connect', 'cus_1', 'pm_1');
select tests.create_user('wallet-buyer@example.com') as w \gset
insert into concierge.accounts (user_id, paid_features, buyer_phone, zinc_connected_at, zinc_api_key_secret_id, zinc_env)
values (:'w', true, '5555550101', now(), gen_random_uuid(), 'test');
select tests.create_user('other@example.com') as other \gset

-- ─── columns, settings and privacy ──────────────────────────────

select has_column('concierge', 'accounts', c, 'accounts.' || c) from unnest(array['stripe_customer_id', 'stripe_payment_method_id']) c;
select has_column('concierge', 'orders', c, 'orders.' || c)
  from unnest(array['margin_cents', 'zinc_fee_cents', 'card_fee_bps', 'card_fee_fixed_cents', 'max_charge_cents',
                    'final_charge_cents', 'payment_method_id']) c;
select is(concierge.card_margin_cents(), 100, 'the margin is the sum of its breakdown parts, $0.65 + $0.35');
select ok(not exists (select 1 from concierge.app_settings where key = 'margin_cents'), 'the margin has no setting of its own to drift');
select is(concierge.setting_int('connect_enabled'), 1, 'the switch can be turned on (seeded off)');
select is((select value #>> '{}' from concierge.app_settings where key = 'fee_label'), 'GiftsAF fee', 'the fee''s name is a setting');

select tests.act_as(:'u');
select throws_ok('select stripe_customer_id from concierge.accounts', '42501', null, 'a buyer can''t read their customer id');
select throws_ok('select stripe_payment_method_id from concierge.accounts', '42501', null, 'a buyer can''t read their card id');
select throws_ok($$update concierge.accounts set stripe_payment_method_id = 'pm_x'$$, '42501', null, 'a buyer can''t set a card');
select throws_ok(format('select %I from concierge.orders', c), '42501', null, 'a buyer can''t read orders.' || c)
  from unnest(array['margin_cents', 'zinc_fee_cents', 'card_fee_bps', 'card_fee_fixed_cents', 'max_charge_cents',
                    'final_charge_cents', 'payment_method_id']) c;
select throws_ok(format('update concierge.orders set %I = null', c), '42501', null, 'a buyer can''t set orders.' || c)
  from unnest(array['margin_cents', 'zinc_fee_cents', 'card_fee_bps', 'card_fee_fixed_cents', 'max_charge_cents',
                    'final_charge_cents', 'payment_method_id']) c;
select throws_ok('select concierge.start_card_session(auth.uid(), ''s'', ''c'', null, null, null)', '42501', null,
  'a buyer can''t call start_card_session');
select throws_ok('select * from concierge.card_sessions', '42501', null, 'a buyer can''t read card sessions');
select throws_ok('select concierge.save_card(auth.uid(), ''s'', ''c'', ''p'')', '42501', null, 'a buyer can''t call save_card');
select throws_ok('select concierge.remove_card(auth.uid())', '42501', null, 'a buyer can''t call remove_card');
select tests.reset_role();

-- ─── the charge, the same math as chargeCents (N1) ──────────────

select is(concierge.card_charge_cents(5000, 250, 100, 290, 30), 5541, 'Zinc''s example: $50 goods, $2.50 margin, $1 fee');
select is(concierge.card_charge_cents(2259, 100, 100, 290, 30), 2564, '$22.59 goods charge $25.64');
select is(concierge.card_charge_cents(2349, 100, 100, 290, 30), 2657, '$23.49 goods charge $26.57');

-- ─── approving ───────────────────────────────────────────────────

select tests.cp_round(:'u') as r1 \gset
select is(tests.cp_approve_all(:'r1'), 1, 'a card buyer approves');
select is((select funding_mode from tests.cp_order(:'r1')), 'connect', 'the order is a card order: the mode comes from the account, not the caller');
select is((select array[margin_cents, zinc_fee_cents, card_fee_bps, card_fee_fixed_cents] from tests.cp_order(:'r1')),
          array[100, 100, 290, 30], 'it saves the fees it was approved with');
select is((select max_charge_cents from tests.cp_order(:'r1')), concierge.card_charge_cents(2485, 100, 100, 290, 30),
          'and the most the card can be charged at the cap');
select is((select fee_cents from tests.cp_order(:'r1')), concierge.card_charge_cents(2485, 100, 100, 290, 30) - 2485,
          'fee_cents is the whole fee at the cap, so committed spend is the most charged');
select is((select payment_method_id from tests.cp_order(:'r1')), 'pm_1', 'and the card it was approved with');
update concierge.accounts set funding_mode = 'zinc_wallet' where user_id = :'u';
select is((select funding_mode from tests.cp_order(:'r1')), 'connect', 'a held order keeps its mode when the account''s changes (case 1)');
update concierge.accounts set funding_mode = 'connect' where user_id = :'u';

-- The fees changed after the page loaded.
select tests.cp_round(:'u') as r2 \gset
select throws_ok(format('select tests.cp_approve(%L, jsonb_build_array(tests.cp_el(tests.cp_idea(%L), ''{"margin_cents": 50}'')))', :'r2', :'r2'),
  'P0001', 'approve_round: fees_changed', 'fees other than today''s are refused');
select is((select count(*)::int from concierge.orders where round_id = :'r2'), 0, 'and nothing is written');

-- The switch is off.
update concierge.app_settings set value = '0' where key = 'connect_enabled';
select throws_ok(format('select tests.cp_approve(%L, jsonb_build_array(tests.cp_el(tests.cp_idea(%L))))', :'r2', :'r2'),
  'P0001', 'approve_round: connect_off', 'no card order while card payments are off');
update concierge.app_settings set value = '1' where key = 'connect_enabled';

-- No card (case 2).
update concierge.accounts set stripe_payment_method_id = null where user_id = :'u';
select throws_ok(format('select tests.cp_approve(%L, jsonb_build_array(tests.cp_el(tests.cp_idea(%L))))', :'r2', :'r2'),
  'P0001', 'approve_round: no_card', 'no approval without a saved card');
select is((select count(*)::int from concierge.orders where round_id = :'r2'), 0, 'and nothing is written');
update concierge.accounts set stripe_payment_method_id = 'pm_1' where user_id = :'u';

-- A wallet buyer, and a buyer with no account row, approve as before (case 11, 13).
select tests.cp_round(:'w') as rw \gset
select is(tests.cp_approve_all(:'rw'), 1, 'a wallet buyer approves');
select is((select funding_mode || '/' || fee_cents || '/' || coalesce(max_charge_cents::text, '-') from tests.cp_order(:'rw')),
          'zinc_wallet/100/-', 'a wallet order is as before: the sent fee, no card columns');
select tests.cp_round(:'other') as ro \gset
select is(tests.cp_approve_all(:'ro'), 1, 'a buyer with no account row approves');
select is((select funding_mode from tests.cp_order(:'ro')), 'zinc_wallet', 'and pays by wallet, as before');

-- A card order can't be written without its fees.
select throws_ok(format($$insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
                          values (%L, %L, %L, 'connect', 1, 1, 'held', 'retry', 'recipient', 'X', 'Y')$$, :'u', :'r2', tests.cp_idea(:'r2')),
  '23514', null, 'a card order without its fee inputs is refused');

-- ─── placing ─────────────────────────────────────────────────────

select is(tests.cp_place(:'r1'), 1, 'a held card order with its card places');
select is(tests.cp_state(:'r1'), 'placing/-', 'and is placing');

-- The switch is off: held, paused whatever it waited on (case 7).
select tests.cp_round(:'u') as r3 \gset
select tests.cp_approve_all(:'r3');
update concierge.orders set hold_reason = 'setup' where round_id = :'r3';
update concierge.app_settings set value = '0' where key = 'connect_enabled';
select is(tests.cp_place(:'r3'), 0, 'nothing places while card payments are off');
select is(tests.cp_state(:'r3'), 'held/paused', 'and a setup hold reads paused');
select is((select attention_reason from concierge.gift_rounds where id = :'r3'), 'paused', 'so nobody is asked for anything');
update concierge.app_settings set value = '1' where key = 'connect_enabled';
select concierge.gate_held_orders(:'r3', 'paused');
select is(tests.cp_state(:'r3'), 'held/paused', 'gate_held_orders pauses a card order whatever it waited on');

-- Removed, then a new card saved: the waiting gift is never bought on either (case 3).
select tests.cp_round(:'u') as r4 \gset
select tests.cp_approve_all(:'r4');
select is(concierge.remove_card(:'u'), 'placing', 'remove is refused while an order is placing (case 6)');
update concierge.orders set status = 'unconfirmed' where round_id = :'r1';
select is(concierge.remove_card(:'u'), 'ok', 'but not while one is only unconfirmed: the hold is already on the card');
update concierge.accounts set stripe_payment_method_id = 'pm_1' where user_id = :'u';
select is(tests.cp_card(:'u'), 'pm_1', 'and the card stays');
update concierge.orders set status = 'placed' where round_id = :'r1';
select is(concierge.remove_card(:'u'), 'ok', 'remove works once nothing is placing');
select is(tests.cp_card(:'u'), '-', 'the card is gone');
select is((select stripe_customer_id from concierge.accounts where user_id = :'u'), 'cus_1', 'the customer is kept');
select is(tests.cp_state(:'r4'), 'held/retry', 'removing changes no order');
select tests.cp_session(:'u', 'cs_1');
select is(concierge.save_card(:'u', 'cs_1', 'cus_1', 'pm_2'), 'ok', 'a new card is saved');
select is(tests.cp_state(:'r4'), 'held/retry', 'saving a card buys nothing');
select is(tests.cp_place(:'r4'), 0, 'the waiting gift isn''t sent on the new card');
select is(tests.cp_state(:'r4'), 'failed/card_needed', 'it ends as card_needed, for a Buy again tap');
select is((select resolved from tests.cp_order(:'r4')), false, 'and waits on the buyer');

-- Leaving for Stripe: the customer is kept on the account at once.
select tests.create_user('new-card@example.com') as nc \gset
select is(concierge.start_card_session(:'nc', 'cs_n1', 'cus_n', null, null, null), 'ok', 'a first visit to Stripe''s page is recorded');
select is((select stripe_customer_id from concierge.accounts where user_id = :'nc'), 'cus_n', 'and the customer is saved on the account straight away');
select is(concierge.start_card_session(:'nc', 'cs_n2', 'cus_other', null, null, null), 'other_customer', 'a second customer is refused');
select is((select count(*)::int from concierge.card_sessions where user_id = :'nc'), 1, 'and no visit is recorded for it');
select is(concierge.start_card_session(:'nc', 'cs_n3', 'cus_n', :'r1', null, null), 'not_yours', 'a round that isn''t theirs is refused');

-- Saving a card: once, only your own (case 15).
select is(concierge.save_card(:'u', 'cs_1', 'cus_1', 'pm_3'), 'used', 'the same visit twice saves nothing');
select tests.cp_session(:'other', 'cs_other');
select is(concierge.save_card(:'u', 'cs_other', 'cus_1', 'pm_3'), 'not_yours', 'another user''s visit saves nothing');
select tests.cp_session(:'u', 'cs_2', 'cus_9');
select is(concierge.save_card(:'u', 'cs_2', 'cus_9', 'pm_3'), 'not_yours', 'a customer other than the account''s saves nothing');
select tests.cp_session(:'u', 'cs_3');
update concierge.card_sessions set created_at = now() - interval '2 hours' where stripe_session_id = 'cs_3';
select is(concierge.save_card(:'u', 'cs_3', 'cus_1', 'pm_3'), 'used', 'an old visit saves nothing');
select is(tests.cp_card(:'u'), 'pm_2', 'the card is still the one saved');

-- ─── declines ────────────────────────────────────────────────────

-- Sent on card 2, card 3 saved since, then card 2 declines: only that order fails (case 4).
select tests.cp_round(:'u') as r5 \gset
select tests.cp_approve_all(:'r5');
select tests.cp_place(:'r5');
update concierge.accounts set stripe_payment_method_id = 'pm_3' where user_id = :'u';
select concierge.record_outcomes(:'r5', jsonb_build_array(jsonb_build_object(
  'order_id', (select id from tests.cp_order(:'r5')), 'outcome', 'rejected', 'failure_type', 'card_declined')));
select is(tests.cp_state(:'r5'), 'failed/card_needed', 'a declined card order is card_needed');
select is(tests.cp_card(:'u'), 'pm_3', 'a card saved since stays');

-- Two rounds; round A's card declines while still saved (case 5).
select tests.cp_round(:'u', array['A1', 'A2']) as ra \gset
select tests.cp_round(:'u') as rb \gset
select tests.cp_approve_all(:'ra');
select tests.cp_approve_all(:'rb');
select tests.cp_place(:'ra');
select concierge.record_outcomes(:'ra', jsonb_build_array(
  jsonb_build_object('order_id', (select id from tests.cp_order(:'ra', 'A2')), 'outcome', 'unsent'),
  jsonb_build_object('order_id', (select id from tests.cp_order(:'ra', 'A1')), 'outcome', 'rejected', 'failure_type', 'card_declined')));
select is(tests.cp_state(:'ra', 'A1'), 'failed/card_needed', 'the declined gift is card_needed');
select is(tests.cp_card(:'u'), '-', 'the declined card is cleared');
select is(tests.cp_state(:'ra', 'A2'), 'failed/card_needed', 'an unsent sibling is card_needed at once, even listed first');
select is(tests.cp_state(:'rb'), 'held/retry', 'the other round is untouched');
select tests.cp_session(:'u', 'cs_4');
select concierge.save_card(:'u', 'cs_4', 'cus_1', 'pm_4') as saved \gset
select is(tests.cp_place(:'rb'), 0, 'after a new card, the other round''s gift isn''t sent');
select is(tests.cp_state(:'rb'), 'failed/card_needed', 'it is card_needed too');

-- A 402 on a card order is a mistake, never a funds hold.
select tests.cp_round(:'u') as r6 \gset
select tests.cp_approve_all(:'r6');
select tests.cp_place(:'r6');
select concierge.record_outcomes(:'r6', jsonb_build_array(jsonb_build_object('order_id', (select id from tests.cp_order(:'r6')), 'outcome', 'insufficient')));
select is(tests.cp_state(:'r6'), 'failed/failed', 'insufficient on a card order ends it with nothing bought, never a funds hold');
select is(tests.cp_card(:'u'), 'pm_4', 'and leaves the card alone');
select tests.cp_round(:'u') as r6 \gset
select tests.cp_approve_all(:'r6');
select tests.cp_place(:'r6');

-- A wallet order "declined" is a plain failure.
select tests.cp_place(:'rw');
select concierge.settle_order(:'w', (select id from tests.cp_order(:'rw')), 'failed', 'card_declined', null);
select is(tests.cp_state(:'rw'), 'failed/failed', 'a wallet order is never card_needed');

-- settle_order with a decline (the sweep and the event).
select concierge.settle_order(:'u', (select id from tests.cp_order(:'r6')), 'failed', 'card_declined', null);
select is(tests.cp_state(:'r6'), 'failed/card_needed', 'settle_order fails a declined card order as card_needed');
select is(tests.cp_card(:'u'), '-', 'and clears the card it was sent on');

-- ─── settling ────────────────────────────────────────────────────

select concierge.cost_per_gift(now() + interval '1 minute') as costs_before \gset
select tests.cp_session(:'u', 'cs_5');
select concierge.save_card(:'u', 'cs_5', 'cus_1', 'pm_5') as saved \gset
select tests.cp_round(:'u') as r7 \gset
select tests.cp_approve_all(:'r7');
select tests.cp_place(:'r7');
-- Goods 2349, no charge from Zinc (case 9).
select concierge.settle_order(:'u', (select id from tests.cp_order(:'r7')), 'placed', null,
                              '{"total_cents": 2349, "subtotal_cents": 2000}');
select is((select final_charge_cents from tests.cp_order(:'r7')), 2657, 'the charge is worked out from the saved fees');
select is((select fee_cents from tests.cp_order(:'r7')), 308, 'and the fee is the charge minus the goods');
select is((select count(*)::int from concierge.cost_events where order_id = (select id from tests.cp_order(:'r7'))), 2,
          'Zinc''s fee and the card fee are recorded');
select is((select estimated from concierge.cost_events where order_id = (select id from tests.cp_order(:'r7')) and kind = 'card_fee'), true,
          'the card fee is marked estimated without Zinc''s figure');
select is((select cents::int from concierge.cost_events where order_id = (select id from tests.cp_order(:'r7')) and kind = 'card_fee'), 108,
          'the card fee is the fee less our margin and Zinc''s');
select is((select estimated from concierge.cost_events where order_id = (select id from tests.cp_order(:'r7')) and kind = 'zinc_order_fee'), true,
          'Zinc''s fee is our saved figure, so it''s marked estimated');
-- Settled again with another price, as the webhook after the sweep (case 8).
select concierge.settle_order(:'u', (select id from tests.cp_order(:'r7')), 'placed', null,
                              '{"total_cents": 2349, "final_charge_cents": 2700}');
select is((select count(*)::int from concierge.cost_events where order_id = (select id from tests.cp_order(:'r7'))), 2,
          'a second settle records no second cost row');
select is((select final_charge_cents from tests.cp_order(:'r7')), 2657, 'and the first charge is kept');

-- With Zinc's charge.
select tests.cp_round(:'u') as r8 \gset
select tests.cp_approve_all(:'r8');
select tests.cp_place(:'r8');
select concierge.settle_order(:'u', (select id from tests.cp_order(:'r8')), 'placed', null,
                              '{"total_cents": 2259, "final_charge_cents": 2563}');
select is((select final_charge_cents || '/' || fee_cents from tests.cp_order(:'r8')), '2563/304', 'Zinc''s own charge wins');

-- No total at all (case 12).
select tests.cp_round(:'u') as r9 \gset
select tests.cp_approve_all(:'r9');
select tests.cp_place(:'r9');
select (select fee_cents from tests.cp_order(:'r9')) as fee9 \gset
select concierge.settle_order(:'u', (select id from tests.cp_order(:'r9')), 'placed', null, null);
select is((select status || '/' || fee_cents from tests.cp_order(:'r9')), 'placed/' || :'fee9', 'with no prices, the fee stays at the cap');
select is((select string_agg(kind, ',') from concierge.cost_events where order_id = (select id from tests.cp_order(:'r9'))), 'zinc_order_fee',
          'Zinc''s fee is still counted; the card fee needs a total');

-- A cap lowered at placing lowers the card's maximum with it.
select tests.cp_round(:'u') as r9b \gset
select tests.cp_approve_all(:'r9b');
select count(*) from concierge.begin_placing(:'r9b', tests.cp_lock(:'r9b'), current_date,
  jsonb_build_array(jsonb_build_object('id', (select id from tests.cp_order(:'r9b')), 'max_price_cents', 2259))) \gset placed_
select is((select max_charge_cents || '/' || fee_cents from tests.cp_order(:'r9b')), '2564/305', 'a lower cap lowers the maximum charge and fee');

-- The cost report leaves card costs out of the AI and lookup averages, and counts them on their own.
select concierge.cost_per_gift(now() + interval '1 minute') as costs_after \gset
select is((:'costs_after'::jsonb ->> 'cardGifts')::int - (:'costs_before'::jsonb ->> 'cardGifts')::int, 3, 'card gifts are counted');
select is((:'costs_after'::jsonb ->> 'zincFeeCents')::numeric - (:'costs_before'::jsonb ->> 'zincFeeCents')::numeric, 300::numeric,
          'Zinc''s fee once per card gift');
select is(array[:'costs_after'::jsonb ->> 'aiCents', :'costs_after'::jsonb ->> 'lookupCents'],
          array[:'costs_before'::jsonb ->> 'aiCents', :'costs_before'::jsonb ->> 'lookupCents'],
          'card and Zinc fees never land in the AI or lookup figures');

-- ─── buying again after card_needed (case 10, 14) ────────────────

select tests.cp_round(:'u') as r10 \gset
select tests.cp_approve_all(:'r10');
update concierge.accounts set stripe_payment_method_id = 'pm_6' where user_id = :'u';
select tests.cp_place(:'r10');
select is(tests.cp_state(:'r10'), 'failed/card_needed', 'a replaced card leaves the gift card_needed');
select (select id from tests.cp_order(:'r10')) as f1 \gset
select (select idempotency_key from tests.cp_order(:'r10')) as k1 \gset
update concierge.app_settings set value = '55' where key = 'fee_part_running_cents';
select is((select count(*)::int from concierge.replace_failed_order(:'r10', :'u', tests.cp_lock(:'r10'), :'f1',
             tests.cp_el(tests.cp_idea(:'r10'), '{"margin_cents": 120, "new_total_cents": 2459, "new_goods_cents": 2359}'))), 1,
          'Buy again makes a new order');
select isnt((select idempotency_key::text from tests.cp_order(:'r10')), :'k1', 'with a new idempotency key');
select is((select margin_cents || '/' || payment_method_id from tests.cp_order(:'r10')), '120/pm_6', 'at today''s fees, on today''s card');
select is((select resolved from concierge.orders where id = :'f1'), true, 'the failed one is resolved');
select is((select goods_cents from concierge.gift_ideas where id = tests.cp_idea(:'r10')), 2359, 'the goods follow today''s price');
-- Declined again: a second replacement.
select tests.cp_place(:'r10');
select concierge.record_outcomes(:'r10', jsonb_build_array(jsonb_build_object(
  'order_id', (select id from tests.cp_order(:'r10')), 'outcome', 'rejected', 'failure_type', 'card_declined')));
select (select id from tests.cp_order(:'r10')) as f2 \gset
update concierge.accounts set stripe_payment_method_id = 'pm_7' where user_id = :'u';
select is((select count(*)::int from concierge.replace_failed_order(:'r10', :'u', tests.cp_lock(:'r10'), :'f2',
             tests.cp_el(tests.cp_idea(:'r10'), '{"margin_cents": 120, "new_total_cents": 2559}'))), 1, 'a second decline can be bought again too');
select is((select goods_cents from concierge.gift_ideas where id = tests.cp_idea(:'r10')), 2459,
          'a re-quote sent as a wallet total moves the goods too (case 13)');
update concierge.app_settings set value = '35' where key = 'fee_part_running_cents';

-- Past ship-by, never.
select tests.cp_round(:'u') as r11 \gset
select tests.cp_approve_all(:'r11');
update concierge.accounts set stripe_payment_method_id = 'pm_8' where user_id = :'u';
select tests.cp_place(:'r11');
update concierge.gift_rounds set ship_by_deadline = current_date where id = :'r11';
select throws_ok(format('select concierge.replace_failed_order(%L, %L, tests.cp_lock(%L), %L, tests.cp_el(tests.cp_idea(%L)))',
                        :'r11', :'u', :'r11', (select id from tests.cp_order(:'r11')), :'r11'),
  'P0001', 'replace_failed_order: not open', 'no Buy again past ship-by');

-- ─── save_ideas: the goods ───────────────────────────────────────

select tests.cp_round(:'u', array[]::text[]) as r12 \gset
insert into concierge.idea_runs (user_id, person_id, round_id)
select user_id, person_id, id from concierge.gift_rounds where id = :'r12' returning id as run \gset
select concierge.save_ideas(:'run', '[{"title": "Old", "price_cents": 2000, "est_total_cents": 2459, "rank": 1},
                                      {"title": "New", "price_cents": 2000, "est_total_cents": 2459, "goods_cents": 2300, "rank": 2}]');
select is((select goods_cents from concierge.gift_ideas where round_id = :'r12' and title = 'Old'), 2359,
          'an old-shape idea gets its goods: the total less Zinc''s wallet fee');
select is((select goods_cents from concierge.gift_ideas where round_id = :'r12' and title = 'New'), 2300, 'a new one keeps what it sent');

-- ─── code columns ────────────────────────────────────────────────

select lives_ok(format($$insert into concierge.cost_events (kind, cents, estimated, order_id) values ('card_fee', 1, true, %L)$$,
                       (select id from tests.cp_order(:'r1'))), 'a card fee cost row is saved');
select throws_ok(format($$insert into concierge.cost_events (kind, cents, estimated, order_id) values ('card_fee', 1, true, %L)$$,
                        (select id from tests.cp_order(:'r1'))), '23505', null, 'a second card fee for one order is refused');

select * from finish();
rollback;
