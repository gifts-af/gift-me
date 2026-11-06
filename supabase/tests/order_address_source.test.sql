-- Orders to a shared address (ALL-112, T61). An order remembers whether it was
-- approved against a list owner's shared address. If that address can't be used
-- the order ends with nothing bought: no replacement, no retry, and its address
-- is cleared.
begin;
\ir _helpers.psql
select plan(33);

create function tests.as_round(p_user uuid)
returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
  values (p_user, v_person, v_occasion, 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now())
  returning id into v_round;
  return v_round;
end $$;

create function tests.as_idea(p_round uuid)
returns uuid language sql as $$
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source)
  select r.user_id, r.id, 'Mug', 4000, 4500, 1, 'generated' from concierge.gift_rounds r where r.id = p_round
  returning id;
$$;

-- An order in the given state with its snapshot, on a round that's waiting on it.
create function tests.as_order(p_round uuid, p_status text, p_source text, p_hold text default null, p_failure text default null)
returns uuid language plpgsql as $$
declare v_order uuid; v_user uuid;
begin
  select user_id into v_user from concierge.gift_rounds where id = p_round;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                                failure_type, ship_to, ship_city, ship_state, address_source)
  values (v_user, p_round, tests.as_idea(p_round), 'zinc_wallet', 4500, 100, p_status, p_hold, p_failure,
          'recipient', 'Dayton', 'OH', p_source)
  returning id into v_order;
  insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
  values (v_order, v_user, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US');
  return v_order;
end $$;

create function tests.as_state(p_round uuid)
returns text language sql as $$
  select status::text || '/' || coalesce(attention_reason, '-') from concierge.gift_rounds where id = p_round;
$$;

create function tests.as_snapshots(p_order uuid)
returns integer language sql as $$
  select count(*)::integer from concierge.order_addresses where order_id = p_order;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.create_user('buyer@example.com') as buyer \gset
select tests.create_user('owner@example.com') as owner_id \gset
insert into concierge.accounts (user_id, paid_features, buyer_phone, zinc_connected_at, zinc_api_key_secret_id, zinc_env)
values (:'buyer', true, '5555550100', now(), gen_random_uuid(), 'test');
update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';

-- ─── the column and the setting ──────────────────────────────────

select has_column('concierge', 'orders', 'address_source', 'an order remembers which address was approved');
select col_is_null('concierge', 'orders', 'address_source', 'older orders have none');
select throws_ok(
  format($$insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state, address_source)
           values (%L, %L, %L, 'zinc_wallet', 1, 1, 'held', 'retry', 'recipient', 'X', 'Y', 'other')$$,
         :'buyer', tests.as_round(:'buyer'), gen_random_uuid()),
  '23514', null, 'only shared or own'
);
select is((select value::integer from concierge.app_settings where key = 'check_address_link_days'), 30, 'the owner''s link lifetime is a setting');
select tests.act_as(:'buyer');
select throws_ok('select address_source from concierge.orders', '42501', null, 'buyers can''t read it');
select tests.reset_role();

-- ─── approve_round records it ────────────────────────────────────

select tests.as_round(:'buyer') as r1 \gset
select tests.as_idea(:'r1') as r1_idea \gset
update concierge.gift_rounds set locked_until = now() + interval '10 minutes' where id = :'r1' returning locked_until as r1_lock \gset
select concierge.approve_round(:'r1', :'buyer', :'r1_lock', jsonb_build_array(jsonb_build_object(
  'idea_id', :'r1_idea', 'max_price_cents', 4500, 'fee_cents', 100, 'ship_to', 'recipient', 'address_source', 'shared',
  'address', jsonb_build_object('recipient_first_name', 'Mary', 'recipient_last_name', 'Allen', 'address_line1', '12 Oak St',
                                'city', 'Dayton', 'state', 'OH', 'zip', '45402', 'country', 'US'))));
select is((select address_source from concierge.orders where round_id = :'r1'), 'shared', 'approve_round saves the source');

-- ─── begin_placing writes it, beside a fresh snapshot ────────────

select id as r1_order from concierge.orders where round_id = :'r1' \gset
select is_empty(
  format($$select 1 from concierge.orders where id = %L and address_source = 'own'$$, :'r1_order'),
  'not own yet'
);
select concierge.begin_placing(:'r1', :'r1_lock', current_date, jsonb_build_array(jsonb_build_object(
  'id', :'r1_order', 'max_price_cents', 4500, 'address_source', 'own',
  'address', jsonb_build_object('recipient_first_name', 'Mary', 'recipient_last_name', 'Allen', 'address_line1', '9 Elm St',
                                'city', 'Akron', 'state', 'OH', 'zip', '44301', 'country', 'US'))));
select is((select status || '/' || address_source || '/' || ship_city from concierge.orders where id = :'r1_order'),
  'placing/own/Akron', 'begin_placing saves the source with the fresh address');

-- ─── reapprove_order keeps it ────────────────────────────────────

select tests.as_round(:'buyer') as r2 \gset
select tests.as_order(:'r2', 'failed', 'shared', null, 'price_up') as r2_old \gset
update concierge.gift_rounds set locked_until = now() + interval '10 minutes' where id = :'r2' returning locked_until as r2_lock \gset
select concierge.reapprove_order(:'r2', :'buyer', :'r2_lock', :'r2_old', 4600);
select is((select address_source from concierge.orders where round_id = :'r2' and status = 'held'), 'shared',
  'a re-approved order keeps the source, so a later withdrawal still ends it');

-- ─── a rejected shared address ends the order ────────────────────

select tests.as_round(:'buyer') as r3 \gset
select tests.as_order(:'r3', 'placing', 'shared') as r3_o \gset
select concierge.settle_order(:'buyer', :'r3_o', 'failed', 'invalid_shipping_address', null);
select is((select status || '/' || failure_type || '/' || resolved from concierge.orders where id = :'r3_o'),
  'failed/address_rejected/false', 'settle_order: ended, and it needs the buyer');
select is((select count(*)::integer from concierge.orders where round_id = :'r3'), 1, 'no replacement order');
select is(tests.as_state(:'r3'), 'needs_attention/failed', 'the round tells the buyer');
select is(concierge.round_fail_count(:'r3'), 1, 'it counts, so a new failure notice goes out');
select is(tests.as_snapshots(:'r3_o'), 1, 'the snapshot stays until the owner step has used it');
select concierge.settle_order(:'buyer', :'r3_o', 'failed', 'invalid_shipping_address', null);
select is(concierge.round_fail_count(:'r3'), 1, 'a second report changes nothing');

select tests.as_round(:'buyer') as r4 \gset
select tests.as_order(:'r4', 'placing', 'shared') as r4_o \gset
select concierge.record_outcomes(:'r4', jsonb_build_array(jsonb_build_object(
  'order_id', :'r4_o', 'outcome', 'rejected', 'failure_type', 'invalid_shipping_address')));
select is((select failure_type || '/' || resolved from concierge.orders where id = :'r4_o'),
  'address_rejected/false', 'record_outcomes: the same');
select is((select count(*)::integer from concierge.orders where round_id = :'r4'), 1, 'and no replacement');

select tests.as_round(:'buyer') as r5 \gset
select tests.as_order(:'r5', 'held', 'shared', 'retry') as r5_o \gset
select concierge.fail_order(:'r5_o', 'invalid_shipping_address');
select is((select failure_type || '/' || resolved from concierge.orders where id = :'r5_o'),
  'address_rejected/false', 'fail_order: the same');

-- ─── other orders are exactly as before ──────────────────────────

select tests.as_round(:'buyer') as r6 \gset
select tests.as_order(:'r6', 'placing', 'own') as r6_o \gset
select concierge.settle_order(:'buyer', :'r6_o', 'failed', 'invalid_shipping_address', null);
select is((select failure_type || '/' || resolved from concierge.orders where id = :'r6_o'),
  'invalid_shipping_address/true', 'source own keeps today''s path');
select is((select status || '/' || hold_reason from concierge.orders where round_id = :'r6' and id <> :'r6_o'),
  'held/address', 'with its replacement waiting on an address');

select tests.as_round(:'buyer') as r7 \gset
select tests.as_order(:'r7', 'placing', null) as r7_o \gset
select concierge.settle_order(:'buyer', :'r7_o', 'failed', 'invalid_shipping_address', null);
select is((select failure_type || '/' || resolved from concierge.orders where id = :'r7_o'),
  'invalid_shipping_address/true', 'an older order with no source too');

-- ─── a withdrawn share clears the address with the failure ───────

select tests.as_round(:'buyer') as r8 \gset
select tests.as_order(:'r8', 'held', 'shared', 'funds') as r8_o \gset
select concierge.fail_order(:'r8_o', 'address_withdrawn');
select is((select status || '/' || failure_type || '/' || resolved || '/' || ship_city || '/' || ship_state from concierge.orders where id = :'r8_o'),
  'failed/address_withdrawn/false//', 'ended, with its city and state blanked');
select is(tests.as_snapshots(:'r8_o'), 0, 'and its snapshot gone');
select is(tests.as_state(:'r8'), 'needs_attention/failed', 'and the buyer is told');
select is((select count(*)::integer from concierge.orders where round_id = :'r8'), 1, 'no replacement');

-- ─── finding the owner to tell, then cleaning up ─────────────────

-- The owner shares through a list the buyer's person is linked to.
select tests.act_as(:'owner_id');
insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
values ('Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', true);
select lists.save_list(null, 'Birthday', '[]'::jsonb) as list_id \gset
select share_token as token from lists.lists where id = :'list_id' \gset
select tests.reset_role();
select tests.as_round(:'buyer') as r9 \gset
select person_id as r9_person from concierge.gift_rounds where id = :'r9' \gset
select tests.as_order(:'r9', 'placing', 'shared') as r9_o \gset
select tests.act_as(:'buyer');
select lists.link_person(:'token', :'r9_person');
select tests.reset_role();
select concierge.settle_order(:'buyer', :'r9_o', 'failed', 'invalid_shipping_address', null);

select tests.act_as_server();
select is(concierge.shared_address_owner_to_tell(:'r9')::text, :'owner_id', 'the same address is still shared: tell its owner');
select ok(:'r9' in (select concierge.rounds_with_rejected_addresses()), 'the round is on the to-do list');
select tests.reset_role();

update public.account_addresses set phone = '5555550199' where user_id = :'owner_id';
select tests.act_as_server();
select is(concierge.shared_address_owner_to_tell(:'r9')::text, :'owner_id', 'a changed phone isn''t a changed address');
select tests.reset_role();

update public.account_addresses set address_line2 = 'Apt 3' where user_id = :'owner_id';
select tests.act_as_server();
select is(concierge.shared_address_owner_to_tell(:'r9'), null, 'the owner already changed it: no one to tell');
select tests.reset_role();

update public.account_addresses set address_line2 = null, share_for_gifts = false where user_id = :'owner_id';
select tests.act_as_server();
select is(concierge.shared_address_owner_to_tell(:'r9'), null, 'the owner stopped sharing: no one to tell');

select concierge.clear_rejected_addresses(:'r9');
select is(tests.as_snapshots(:'r9_o'), 0, 'clearing deletes the snapshot');
select is((select ship_city || '/' || ship_state from concierge.orders where id = :'r9_o'), '/', 'and blanks the city and state');
select ok(:'r9' not in (select concierge.rounds_with_rejected_addresses()), 'and it comes off the to-do list');

select * from finish();
rollback;
