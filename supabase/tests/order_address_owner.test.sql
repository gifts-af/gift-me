-- Whose shared address an order ships to (T61, T88). An order approved to a list
-- owner's shared address records that owner's account id, and only ever ships to
-- that same owner: after a relink, a missing owner or a deleted account, placing
-- refuses and the order ends as address_withdrawn.
begin;
\ir _helpers.psql
select plan(41);

-- A round waiting on approval, for its own person, linked to p_list when given.
create function tests.oo_round(p_user uuid, p_list uuid)
returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, v_person, v_occasion, 2030, current_date + 37, current_date + 30, 5000, 'awaiting_approval', now(),
          now() + interval '10 minutes')
  returning id into v_round;
  if p_list is not null then
    perform tests.oo_link(v_person, p_list);
  end if;
  return v_round;
end $$;

-- Links (or relinks) a person to a list, as lists.link_person does.
create function tests.oo_link(p_person uuid, p_list uuid)
returns void language plpgsql as $$
begin
  insert into lists.person_links (person_id, buyer_id, list_id, share_token)
  select p.id, p.user_id, l.id, l.share_token from public.people p, lists.lists l where p.id = p_person and l.id = p_list
  on conflict (person_id) do update set list_id = excluded.list_id, share_token = excluded.share_token;
  update public.people set linked_user_id = (select owner_id from lists.lists where id = p_list) where id = p_person;
end $$;

create function tests.oo_person(p_round uuid)
returns uuid language sql as $$
  select person_id from concierge.gift_rounds where id = p_round;
$$;

create function tests.oo_lock(p_round uuid)
returns timestamptz language sql as $$
  select locked_until from concierge.gift_rounds where id = p_round;
$$;

create function tests.oo_idea(p_round uuid, p_status text default 'proposed')
returns uuid language sql as $$
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, status)
  select r.user_id, r.id, 'Mug', 4000, 4500, 1, 'generated', p_status from concierge.gift_rounds r where r.id = p_round
  returning id;
$$;

create function tests.oo_address(p_line1 text default '12 Oak St')
returns jsonb language sql as $$
  select jsonb_build_object('recipient_first_name', 'Mary', 'recipient_last_name', 'Allen', 'address_line1', p_line1,
                            'city', 'Dayton', 'state', 'OH', 'zip', '45402', 'country', 'US');
$$;

-- An approve_round element; the owner key only when given.
create function tests.oo_el(p_idea uuid, p_source text, p_owner uuid default null)
returns jsonb language sql as $$
  select jsonb_build_object('idea_id', p_idea, 'max_price_cents', 4500, 'fee_cents', 100, 'ship_to', 'recipient',
                            'address_source', p_source, 'address', tests.oo_address())
         || case when p_owner is null then '{}'::jsonb else jsonb_build_object('address_owner_id', p_owner) end;
$$;

-- A held order with its snapshot, on a round waiting on it.
create function tests.oo_held(p_round uuid, p_source text, p_owner uuid)
returns uuid language plpgsql as $$
declare v_order uuid; v_user uuid;
begin
  select user_id into v_user from concierge.gift_rounds where id = p_round;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                                ship_to, ship_city, ship_state, address_source, address_owner_id)
  values (v_user, p_round, tests.oo_idea(p_round, 'selected'), 'zinc_wallet', 4500, 100, 'held', 'retry',
          'recipient', 'Dayton', 'OH', p_source, p_owner)
  returning id into v_order;
  insert into concierge.order_addresses (order_id, user_id, recipient_first_name, recipient_last_name, address_line1, city, state, zip, country)
  values (v_order, v_user, 'Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', 'US');
  perform concierge.reconcile_round(p_round);
  return v_order;
end $$;

-- How many orders begin_placing moved to placing, given one order's element.
create function tests.oo_place(p_round uuid, p_el jsonb)
returns integer language sql as $$
  select count(*)::integer from concierge.begin_placing(p_round, tests.oo_lock(p_round), current_date, jsonb_build_array(p_el));
$$;

-- A begin_placing element: the cap, plus whatever's given (a fresh address, its source and owner).
create function tests.oo_pel(p_order uuid, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('id', p_order, 'max_price_cents', 4500) || p_extra;
$$;

create function tests.oo_order(p_order uuid)
returns text language sql as $$
  select o.status || '/' || coalesce(o.address_source, '-') || '/' || coalesce(o.address_owner_id::text, '-') || '/'
         || coalesce(x.address_line1, '-')
    from concierge.orders o left join concierge.order_addresses x on x.order_id = o.id
   where o.id = p_order;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.create_user('buyer@example.com') as buyer \gset
select tests.create_user('owner-a@example.com') as owner_a \gset
select tests.create_user('owner-b@example.com') as owner_b \gset
insert into concierge.accounts (user_id, paid_features, buyer_phone, zinc_connected_at, zinc_api_key_secret_id, zinc_env)
values (:'buyer', true, '5555550100', now(), gen_random_uuid(), 'test');
update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';

-- Two list owners, each sharing an address through a list.
select tests.act_as(:'owner_a');
insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
values ('Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402', true);
select (lists.save_list_checked(null, 'A list', '[]'::jsonb, null) ->> 'id')::uuid as list_a \gset
select tests.act_as(:'owner_b');
insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state, zip, share_for_gifts)
values ('Sam', 'Stone', '9 Elm St', 'Akron', 'OH', '44301', true);
select (lists.save_list_checked(null, 'B list', '[]'::jsonb, null) ->> 'id')::uuid as list_b \gset
select tests.reset_role();

-- ─── the column ──────────────────────────────────────────────────

select has_column('concierge', 'orders', 'address_owner_id', 'an order records whose shared address it ships to');
select col_is_null('concierge', 'orders', 'address_owner_id', 'none when it doesn''t ship to a shared address');
select fk_ok('concierge', 'orders', 'address_owner_id', 'auth', 'users', 'id', 'it''s an account id');
select throws_ok(
  format($$insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state, address_source, address_owner_id)
           values (%L, %L, %L, 'zinc_wallet', 1, 1, 'held', 'retry', 'recipient', 'X', 'Y', 'own', %L)$$,
         :'buyer', tests.oo_round(:'buyer', null), gen_random_uuid(), :'owner_a'),
  '23514', null, 'only a shared order has an owner'
);
select tests.act_as(:'buyer');
select throws_ok('select address_owner_id from concierge.orders', '42501', null, 'buyers can''t read it');
select tests.reset_role();

-- ─── reading the owner ───────────────────────────────────────────

select tests.oo_round(:'buyer', :'list_a') as r0 \gset
select tests.act_as_server();
select is(public.shared_address_for_person(tests.oo_person(:'r0')) ->> 'owner_id', :'owner_a',
  'the shared address comes with its owner, in one read');
select tests.reset_role();

-- ─── approve_round (AC-1) ────────────────────────────────────────

select tests.oo_round(:'buyer', :'list_a') as a1 \gset
select tests.oo_idea(:'a1') as a1_idea \gset
select concierge.approve_round(:'a1', :'buyer', tests.oo_lock(:'a1'),
  jsonb_build_array(tests.oo_el(:'a1_idea', 'shared', :'owner_a')));
select is((select address_owner_id::text from concierge.orders where round_id = :'a1'), :'owner_a', 'approve_round records the owner');

select tests.oo_round(:'buyer', :'list_a') as a2 \gset
select tests.oo_idea(:'a2') as a2_idea \gset
select concierge.approve_round(:'a2', :'buyer', tests.oo_lock(:'a2'),
  jsonb_build_array(tests.oo_el(:'a2_idea', 'own', :'owner_a')));
select is((select address_source || '/' || coalesce(address_owner_id::text, '-') from concierge.orders where round_id = :'a2'),
  'own/-', 'an order not going to a shared address records no owner');

select tests.oo_round(:'buyer', :'list_a') as a3 \gset
select tests.oo_idea(:'a3') as a3_idea \gset
select throws_ok(format('select concierge.approve_round(%L, %L, %L, %L)', :'a3', :'buyer', tests.oo_lock(:'a3'),
    jsonb_build_array(tests.oo_el(:'a3_idea', 'shared'))),
  'P0001', 'approve_round: address changed', 'approve_round refuses a shared order with no owner');
select throws_ok(format('select concierge.approve_round(%L, %L, %L, %L)', :'a3', :'buyer', tests.oo_lock(:'a3'),
    jsonb_build_array(tests.oo_el(:'a3_idea', 'shared', :'owner_b'))),
  'P0001', 'approve_round: address changed', '... or one whose owner isn''t the person''s current link');

-- ─── replace_failed_order (AC-1) ─────────────────────────────────

select tests.oo_round(:'buyer', :'list_a') as f1 \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, failure_type,
                              ship_to, ship_city, ship_state)
values (:'buyer', :'f1', tests.oo_idea(:'f1', 'selected'), 'zinc_wallet', 4500, 100, 'failed', 'out_of_stock', 'recipient', 'Dayton', 'OH')
returning id as f1_failed \gset
select concierge.reconcile_round(:'f1');
select tests.oo_idea(:'f1') as f1_next \gset
select tests.act_as_server();
select throws_ok(format('select * from concierge.replace_failed_order(%L, %L, %L, %L, %L)', :'f1', :'buyer', tests.oo_lock(:'f1'),
    :'f1_failed', tests.oo_el(:'f1_next', 'shared')),
  'P0001', 'replace_failed_order: address changed', 'replace_failed_order refuses a shared order with no owner');
select throws_ok(format('select * from concierge.replace_failed_order(%L, %L, %L, %L, %L)', :'f1', :'buyer', tests.oo_lock(:'f1'),
    :'f1_failed', tests.oo_el(:'f1_next', 'shared', :'owner_b')),
  'P0001', 'replace_failed_order: address changed', '... or with the wrong owner');
select id as f1_new from concierge.replace_failed_order(:'f1', :'buyer', tests.oo_lock(:'f1'), :'f1_failed',
  tests.oo_el(:'f1_next', 'shared', :'owner_a')) \gset
select tests.reset_role();
select is((select address_owner_id::text from concierge.orders where id = :'f1_new'), :'owner_a', 'replace_failed_order records the owner');

-- A price-up re-buy of a shared order, as the same idea.
select tests.oo_round(:'buyer', :'list_a') as f2 \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, failure_type,
                              ship_to, ship_city, ship_state, address_source, address_owner_id)
values (:'buyer', :'f2', tests.oo_idea(:'f2', 'selected'), 'zinc_wallet', 4500, 100, 'failed', 'price_up', 'recipient',
        'Dayton', 'OH', 'shared', :'owner_a')
returning id as f2_failed, idea_id as f2_idea \gset
select concierge.reconcile_round(:'f2');
select tests.oo_link(tests.oo_person(:'f2'), :'list_b');
select tests.act_as_server();
select throws_ok(format('select * from concierge.replace_failed_order(%L, %L, %L, %L, %L)', :'f2', :'buyer', tests.oo_lock(:'f2'),
    :'f2_failed', tests.oo_el(:'f2_idea', 'shared', :'owner_a') || '{"new_total_cents": 4700}'),
  'P0001', 'replace_failed_order: address changed', 'a price-up re-buy to the old owner is refused after a relink');
select tests.reset_role();
select tests.oo_link(tests.oo_person(:'f2'), :'list_a');
select tests.act_as_server();
select id as f2_new from concierge.replace_failed_order(:'f2', :'buyer', tests.oo_lock(:'f2'), :'f2_failed',
  tests.oo_el(:'f2_idea', 'shared', :'owner_a') || '{"new_total_cents": 4700}') \gset
select tests.reset_role();
select is((select address_owner_id::text from concierge.orders where id = :'f2_new'), :'owner_a',
  '... and goes through, recording the owner, while still linked to them');

-- Not to a shared address: a stray owner key records nothing.
select tests.oo_round(:'buyer', :'list_a') as f3 \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, failure_type,
                              ship_to, ship_city, ship_state)
values (:'buyer', :'f3', tests.oo_idea(:'f3', 'selected'), 'zinc_wallet', 4500, 100, 'failed', 'out_of_stock', 'recipient', 'Dayton', 'OH')
returning id as f3_failed \gset
select concierge.reconcile_round(:'f3');
select tests.oo_idea(:'f3') as f3_next \gset
select tests.act_as_server();
select id as f3_new from concierge.replace_failed_order(:'f3', :'buyer', tests.oo_lock(:'f3'), :'f3_failed',
  tests.oo_el(:'f3_next', 'own', :'owner_a') || '{"ship_to": "buyer"}') \gset
select tests.reset_role();
select is((select ship_to || '/' || address_source || '/' || coalesce(address_owner_id::text, '-') from concierge.orders where id = :'f3_new'),
  'buyer/own/-', 'a replacement to the buyer records no owner');

-- ─── begin_placing: still the same owner (AC-5) ──────────────────

select tests.oo_round(:'buyer', :'list_a') as p1 \gset
select tests.oo_held(:'p1', 'shared', :'owner_a') as p1_o \gset
select is(tests.oo_place(:'p1', tests.oo_pel(:'p1_o')), 1, 'AC-5: still linked to the owner, it places on its snapshot');

select tests.oo_round(:'buyer', :'list_a') as p2 \gset
select tests.oo_held(:'p2', 'shared', :'owner_a') as p2_o \gset
select is(tests.oo_place(:'p2', tests.oo_pel(:'p2_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', :'owner_a',
                                                                          'address', tests.oo_address('14 Oak St')))),
  1, 'AC-5: with the owner''s fresh address');
select is(tests.oo_order(:'p2_o'), 'placing/shared/' || :'owner_a' || '/14 Oak St', '... saved with the same owner');

select tests.oo_round(:'buyer', :'list_a') as p3 \gset
select tests.oo_held(:'p3', 'shared', :'owner_a') as p3_o \gset
select is(tests.oo_place(:'p3', tests.oo_pel(:'p3_o', jsonb_build_object('address_source', 'shared', 'address', tests.oo_address('16 Oak St')))),
  1, 'older code that sends no owner still places, checked against the stored one');
select is(tests.oo_order(:'p3_o'), 'placing/shared/' || :'owner_a' || '/16 Oak St', '... and the owner stays');

-- ─── begin_placing refuses (AC-4, AC-6, AC-7) ────────────────────

select tests.oo_round(:'buyer', :'list_a') as p4 \gset
select tests.oo_held(:'p4', 'shared', :'owner_a') as p4_o \gset
select tests.oo_link(tests.oo_person(:'p4'), :'list_b');
select is(tests.oo_place(:'p4', tests.oo_pel(:'p4_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', :'owner_a',
                                                                          'address', tests.oo_address('9 Elm St')))),
  0, 'AC-4: relinked to another owner, it refuses');
select is(tests.oo_order(:'p4_o'), 'held/shared/' || :'owner_a' || '/12 Oak St', '... before writing anything');
select is(tests.oo_place(:'p4', tests.oo_pel(:'p4_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', :'owner_b',
                                                                          'address', tests.oo_address('9 Elm St')))),
  0, 'AC-4: the new owner''s address is refused too');

select tests.oo_round(:'buyer', :'list_a') as p4b \gset
select tests.oo_held(:'p4b', 'shared', :'owner_a') as p4b_o \gset
select tests.oo_link(tests.oo_person(:'p4b'), :'list_b');
select is(tests.oo_place(:'p4b', tests.oo_pel(:'p4b_o')), 0, 'AC-4: relinked, it refuses on its snapshot too');
select is(tests.oo_order(:'p4b_o'), 'held/shared/' || :'owner_a' || '/12 Oak St', '... and stays held');

-- Refused before the gates, which would otherwise rewrite the hold reason.
update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled';
select is(tests.oo_place(:'p4b', tests.oo_pel(:'p4b_o')), 0, 'with ordering paused, still refused');
select is((select hold_reason from concierge.orders where id = :'p4b_o'), 'retry', '... before the pause gate touches it');
update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';

select tests.oo_round(:'buyer', :'list_a') as p5 \gset
select tests.oo_held(:'p5', 'shared', :'owner_a') as p5_o \gset
select is(tests.oo_place(:'p5', tests.oo_pel(:'p5_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', :'owner_b',
                                                                          'address', tests.oo_address()))),
  0, 'AC-4: the caller names a different owner');
select is(tests.oo_place(:'p5', tests.oo_pel(:'p5_o', jsonb_build_object('address_source', 'own', 'address', tests.oo_address()))),
  0, 'AC-4: the caller says the fresh address isn''t a shared one');
select is(tests.oo_order(:'p5_o'), 'held/shared/' || :'owner_a' || '/12 Oak St', '... and a stored shared order is left as it was');

select tests.oo_round(:'buyer', :'list_a') as p6 \gset
select tests.oo_held(:'p6', 'shared', null) as p6_o \gset
select is(tests.oo_place(:'p6', tests.oo_pel(:'p6_o')), 0, 'AC-6: a shared order with no owner refuses');

-- ─── an order read fresh as shared gains the owner (AC-2) ────────

select tests.oo_round(:'buyer', :'list_a') as p7 \gset
select tests.oo_held(:'p7', 'own', null) as p7_o \gset
select is(tests.oo_place(:'p7', tests.oo_pel(:'p7_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', :'owner_b',
                                                                          'address', tests.oo_address()))),
  0, 'an owner who isn''t the current link is refused');
select is(tests.oo_place(:'p7', tests.oo_pel(:'p7_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', null,
                                                                          'address', tests.oo_address()))),
  0, 'so is a shared address whose owner is sent as null');
select is(tests.oo_place(:'p7', tests.oo_pel(:'p7_o', jsonb_build_object('address_source', 'shared', 'address_owner_id', :'owner_a',
                                                                          'address', tests.oo_address('18 Oak St')))),
  1, 'AC-2: an own order whose fresh address is shared places');
select is(tests.oo_order(:'p7_o'), 'placing/shared/' || :'owner_a' || '/18 Oak St', '... recording the owner with the address');

select tests.oo_round(:'buyer', :'list_a') as p9 \gset
select tests.oo_held(:'p9', 'own', null) as p9_o \gset
select is(tests.oo_place(:'p9', tests.oo_pel(:'p9_o', jsonb_build_object('address_source', 'shared', 'address', tests.oo_address('20 Oak St')))),
  1, 'AC-2: older code that sends no owner places an own order whose fresh address is shared');
select is(tests.oo_order(:'p9_o'), 'placing/shared/' || :'owner_a' || '/20 Oak St', '... recording the current link''s owner');

select tests.oo_round(:'buyer', null) as p10 \gset
select tests.oo_held(:'p10', 'own', null) as p10_o \gset
select is(tests.oo_place(:'p10', tests.oo_pel(:'p10_o', jsonb_build_object('address_source', 'shared', 'address', tests.oo_address()))),
  0, 'a shared address with no owner sent and no current link is refused');

-- ─── the owner deletes their account (AC-7) ──────────────────────

select tests.oo_round(:'buyer', :'list_a') as p8 \gset
select tests.oo_held(:'p8', 'shared', :'owner_a') as p8_o \gset
delete from auth.users where id = :'owner_a';
select is((select address_owner_id from concierge.orders where id = :'p8_o'), null, 'AC-7: the recorded owner becomes null');
select is(tests.oo_place(:'p8', tests.oo_pel(:'p8_o')), 0, 'AC-7: and placing refuses');

select * from finish();
rollback;
