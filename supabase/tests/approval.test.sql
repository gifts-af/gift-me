-- The approval screen's database side (ALL-29): rejected ideas don't count
-- as a round's ideas, ideas keep their photo and list fields, list gifts are
-- checked through the lists product's own functions (T19), approve_round
-- refuses ideas that were replaced, list gifts no longer shared, and list
-- gifts the buyer already has on a live order, and replace_failed_order
-- replaces a failed order under the round lease (Task 2); "None of these"
-- rejects a round's ideas or saves only the reason, and an open round gets
-- its budget (Task 3).
begin;
\ir _helpers.psql
select plan(80);

-- This file starts several round runs on one day; the daily limit has its own test (round_fanout).
update concierge.app_settings set value = '1000' where key = 'idea_round_runs_per_day';

select tests.create_user('buyer@example.com', 'Buyer') as a \gset
select tests.create_user('mom@example.com', 'Mom') as mom \gset
select tests.create_user('friend@example.com', 'Friend') as friend \gset
select tests.create_user('stranger@example.com', 'Stranger') as stranger \gset
insert into concierge.accounts (user_id, paid_features) values (:'a', true);

-- Mom's list, which the buyer links "Mom" to. A stranger's list nobody links.
insert into lists.lists (owner_id, title) values (:'mom', 'Birthday') returning id as list_id, share_token as token \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 0, 'Vase', 4000) returning id as i_claimed \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 1, 'Lamp', 3000) returning id as i_bought \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 2, 'Mug', 2000) returning id as i_cut \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 3, 'Book', 1500) returning id as i_mine \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 4, 'Scarf', 2500) returning id as i_free \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 5, 'Hat', 1000) returning id as i_refund \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 6, 'Pen', 1000) returning id as i_cancel \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 7, 'Cup', 1000) returning id as i_failed \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 8, 'Bag', 1000) returning id as i_dup \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 9, 'Kit', 1000) returning id as i_unres \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 10, 'Rug', 1000) returning id as i_rf_claimed \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 11, 'Fan', 1000) returning id as i_rf_cut \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 12, 'Owl', 1000) returning id as i_rf_rebuy \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 13, 'Jar', 1000) returning id as i_rf_old \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 14, 'Bowl', 1000) returning id as i_rf_keep \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 15, 'Tray', 1000) returning id as i_rf_both \gset
insert into lists.lists (owner_id, title) values (:'stranger', 'Other') returning id as other_list \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'other_list', 0, 'Kite', 1000) returning id as i_other \gset

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as p_mom \gset
select lists.link_person(:'token', :'p_mom');
insert into public.people (name, relationship) values ('Run', 'friend') returning id as p_run \gset
insert into public.people (name, relationship) values ('Done', 'friend') returning id as p_done \gset
insert into public.people (name, relationship) values ('Save', 'friend') returning id as p_save \gset
insert into public.people (name, relationship) values ('Excl', 'friend') returning id as p_excl \gset
insert into public.people (name, relationship) values ('Unres', 'friend') returning id as p_unres \gset
insert into public.people (name, relationship) values ('Fix', 'friend') returning id as p_fix \gset
select tests.reset_role();

-- A round awaiting approval under a lease, an idea in it, and approve_round's orders.
create function tests.ap_round(p_user uuid, p_person uuid)
returns uuid language plpgsql as $$
declare v_occasion uuid; v_round uuid;
begin
  -- One occasion per person and kind; each round for the person takes the next year.
  select id into v_occasion from concierge.occasions where person_id = p_person and kind = 'christmas';
  if v_occasion is null then
    insert into concierge.occasions (user_id, person_id, kind) values (p_user, p_person, 'christmas') returning id into v_occasion;
  end if;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, p_person, v_occasion, 2030 + (select count(*)::int from concierge.gift_rounds where person_id = p_person),
          current_date + 37, current_date + 30, 5000, 'awaiting_approval', now(), now() + interval '10 minutes')
  returning id into v_round;
  return v_round;
end $$;

create function tests.ap_idea(p_round uuid, p_item uuid, p_status text default 'proposed')
returns uuid language sql as $$
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id, status)
  select r.user_id, r.id, 'Gift', 4000, 4500, 1, case when p_item is null then 'generated' else 'list' end, p_item, p_status
    from concierge.gift_rounds r where r.id = p_round
  returning id;
$$;

create function tests.ap_orders(p_idea uuid)
returns jsonb language sql as $$
  select format('[{"idea_id": "%s", "max_price_cents": 4500, "fee_cents": 100, "ship_to": "recipient",
                   "address": {"recipient_first_name": "Mary", "recipient_last_name": "Allen", "address_line1": "12 Oak St",
                               "city": "Dayton", "state": "OH", "zip": "45402", "country": "US"}}]', p_idea)::jsonb;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ─── Regression guards (pass before and after) ───────────────────────────────

-- A round with one proposed idea among rejected ones still has its ideas.
insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_done', 'christmas') returning id as o_done \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_done', :'o_done', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_done \gset
select tests.ap_idea(:'r_done', null, 'rejected');
select tests.ap_idea(:'r_done', null, 'proposed');
select is((select refusal from concierge.start_idea_run(:'a', :'p_done', :'r_done', now())), 'done',
  'start_idea_run still says done when one idea is proposed');

-- A friend's claim on the linked list refuses the approval.
select tests.act_as(:'friend');
select lists.claim_gift(:'token', :'i_claimed', null);
select lists.claim_gift(:'token', :'i_rf_claimed', null);
select tests.reset_role();
select tests.ap_round(:'a', :'p_mom') as r_claimed \gset
select tests.ap_idea(:'r_claimed', :'i_claimed') as r_claimed_idea \gset
select locked_until as r_claimed_lock from concierge.gift_rounds where id = :'r_claimed' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_claimed', :'a', :'r_claimed_lock', tests.ap_orders(:'r_claimed_idea')),
  'P0001', 'approve_round: claimed', 'approve_round still refuses a gift a friend claimed');
select tests.reset_role();

-- ─── Rejected ideas don't count (AC-12a) ─────────────────────────────────────

insert into concierge.occasions (user_id, person_id, kind) values (:'a', :'p_run', 'christmas') returning id as o_run \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
values (:'a', :'p_run', :'o_run', 2030, '2030-12-25', '2030-12-15', 5000) returning id as r_run \gset
select tests.ap_idea(:'r_run', null, 'rejected');
select tests.ap_idea(:'r_run', null, 'rejected');

select tests.act_as_server();
select ok(s.run_id is not null and s.refusal is null, 'start_idea_run starts a round whose ideas were all rejected')
  from concierge.start_idea_run(:'a', :'p_run', :'r_run', now()) s;
select coalesce((select id from concierge.idea_runs where round_id = :'r_run'), gen_random_uuid()) as run_rej \gset
select is(concierge.save_ideas(:'run_rej', '[
  {"title":"A","price_cents":100,"est_total_cents":110,"rank":1},
  {"title":"B","price_cents":100,"est_total_cents":110,"rank":2},
  {"title":"C","price_cents":100,"est_total_cents":110,"rank":3}
]'::jsonb), 3, 'save_ideas saves into a round whose ideas were all rejected');

-- ─── List ideas and photos (AC-17, AC-27) ────────────────────────────────────

select run_id as run_save from concierge.start_idea_run(:'a', :'p_save', null, now()) \gset
select concierge.save_ideas(:'run_save', format('[
  {"title":"Vase","price_cents":4000,"est_total_cents":4400,"rank":1,"source":"list","list_item_id":"%s",
   "image_url":"https://images.example.com/vase.jpg"},
  {"title":"Hat","price_cents":2000,"est_total_cents":2200,"rank":2}
]', :'i_free')::jsonb);
select results_eq(
  format($q$select title, source, list_item_id, image_url from concierge.gift_ideas
             where person_id = %L and round_id is null order by rank$q$, :'p_save'),
  format($q$values ('Vase', 'list', %L::uuid, 'https://images.example.com/vase.jpg'),
                   ('Hat', 'generated', null::uuid, null::text)$q$, :'i_free'),
  'save_ideas keeps image_url, source and list_item_id');

select throws_ok(
  format($q$select concierge.save_ideas(%L, '[{"title":"X","price_cents":1,"est_total_cents":1,"rank":1,"source":"list"}]')$q$, :'run_save'),
  '23514', null, 'save_ideas refuses a list idea with no list_item_id');
select tests.reset_role();

select throws_ok(
  format($q$insert into concierge.gift_ideas (user_id, person_id, title, price_cents, est_total_cents, rank, image_url)
            values (%L, %L, 'X', 1, 1, 1, 'http://images.example.com/x.jpg')$q$, :'a', :'p_save'),
  '23514', null, 'image_url refuses http://');

-- ─── approve_round refuses replaced ideas (AC-12b) ───────────────────────────

select tests.ap_round(:'a', :'p_excl') as r_rej \gset
select tests.ap_idea(:'r_rej', null, 'rejected') as r_rej_idea \gset
select locked_until as r_rej_lock from concierge.gift_rounds where id = :'r_rej' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_rej', :'a', :'r_rej_lock', tests.ap_orders(:'r_rej_idea')),
  'P0001', 'approve_round: replaced', 'approve_round refuses a rejected idea');
select tests.reset_role();

select tests.ap_round(:'a', :'p_excl') as r_sel \gset
select tests.ap_idea(:'r_sel', null, 'selected') as r_sel_idea \gset
select locked_until as r_sel_lock from concierge.gift_rounds where id = :'r_sel' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_sel', :'a', :'r_sel_lock', tests.ap_orders(:'r_sel_idea')),
  'P0001', 'approve_round: replaced', 'approve_round refuses a selected idea');
select tests.reset_role();

-- ─── A list gift the buyer already has on a live order (AC-30, S2) ───────────

select tests.ap_round(:'a', :'p_mom') as r_first \gset
select tests.ap_idea(:'r_first', :'i_bought', 'selected') as r_first_idea \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
values (:'a', :'r_first', :'r_first_idea', 'zinc_wallet', 4500, 100, 'placed', 'recipient', 'Dayton', 'OH');
select tests.ap_round(:'a', :'p_mom') as r_again \gset
select tests.ap_idea(:'r_again', :'i_bought') as r_again_idea \gset
select locked_until as r_again_lock from concierge.gift_rounds where id = :'r_again' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_again', :'a', :'r_again_lock', tests.ap_orders(:'r_again_idea')),
  'P0001', 'approve_round: already_bought',
  'approve_round refuses a list item already on this buyer''s live order in another round');
select tests.reset_role();

-- An earlier order in another round, in the given state, then a new round
-- offering the same list item again.
create function tests.ap_retry(p_user uuid, p_person uuid, p_item uuid, p_status text, p_resolved boolean)
returns table (round_id uuid, idea_id uuid, lock timestamptz) language plpgsql as $$
declare v_round uuid; v_idea uuid;
begin
  v_round := tests.ap_round(p_user, p_person);
  v_idea := tests.ap_idea(v_round, p_item, 'selected');
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, resolved,
                                ship_to, ship_city, ship_state)
  values (p_user, v_round, v_idea, 'zinc_wallet', 4500, 100, p_status, p_resolved, 'recipient', 'Dayton', 'OH');
  v_round := tests.ap_round(p_user, p_person);
  v_idea := tests.ap_idea(v_round, p_item);
  return query select v_round, v_idea, r.locked_until from concierge.gift_rounds r where r.id = v_round;
end $$;

-- Given means an order that isn't failed, cancelled or refunded (AC-31), so a
-- refunded or cancelled one doesn't stop buying the gift again. An unresolved
-- failure still does, as approve_round treats it within a round: it may yet be replaced.
select round_id as r_refund, idea_id as r_refund_idea, lock as r_refund_lock
  from tests.ap_retry(:'a', :'p_mom', :'i_refund', 'refunded', false) \gset
select round_id as r_cancel, idea_id as r_cancel_idea, lock as r_cancel_lock
  from tests.ap_retry(:'a', :'p_mom', :'i_cancel', 'cancelled', false) \gset
select round_id as r_failed, idea_id as r_failed_idea, lock as r_failed_lock
  from tests.ap_retry(:'a', :'p_mom', :'i_failed', 'failed', false) \gset
select tests.act_as_server();
select is((select count(*)::int from concierge.approve_round(:'r_refund', :'a', :'r_refund_lock', tests.ap_orders(:'r_refund_idea'))), 1,
  'approve_round buys a list item again after its earlier order was refunded');
select is((select count(*)::int from concierge.approve_round(:'r_cancel', :'a', :'r_cancel_lock', tests.ap_orders(:'r_cancel_idea'))), 1,
  'approve_round buys a list item again after its earlier order was cancelled');
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_failed', :'a', :'r_failed_lock', tests.ap_orders(:'r_failed_idea')),
  'P0001', 'approve_round: already_bought', 'approve_round still refuses a list item whose earlier order failed and isn''t resolved');
select tests.reset_role();

-- ─── One list item once per round and per approval ───────────────────────────

select tests.ap_round(:'a', :'p_mom') as r_dup \gset
select tests.ap_idea(:'r_dup', :'i_dup') as r_dup_idea \gset
select throws_ok(format($q$select tests.ap_idea(%L, %L)$q$, :'r_dup', :'i_dup'),
  '23505', null, 'a round can''t hold the same list item twice');

-- Without the index (as for a round saved before it), one approval still can't buy it twice.
drop index concierge.gift_ideas_round_list_item_key;
select tests.ap_idea(:'r_dup', :'i_dup') as r_dup_idea2 \gset
select locked_until as r_dup_lock from concierge.gift_rounds where id = :'r_dup' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_dup', :'a', :'r_dup_lock',
    tests.ap_orders(:'r_dup_idea') || tests.ap_orders(:'r_dup_idea2')),
  'P0001', 'approve_round: already_bought', 'approve_round refuses one list item twice in one approval');
select tests.reset_role();
select is((select count(*)::int from concierge.orders where round_id = :'r_dup'), 0, '... and no order is written');

-- ─── The lists product's interface (T19) ─────────────────────────────────────

insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order) values (:'i_mine', :'a', 'Buyer', true);
select tests.act_as_server();
select is(
  array[lists.item_shared(:'i_free', :'p_mom'), lists.item_shared(:'i_other', :'p_mom'), lists.item_shared(:'i_free', :'p_run')]
    || array[lists.claim_holder(:'i_free', :'a') = 'none', lists.claim_holder(:'i_mine', :'a') = 'mine',
             lists.claim_holder(:'i_claimed', :'a') = 'other'],
  array[true, false, false, true, true, true],
  'item_shared and claim_holder answer for the linked list only');
select tests.reset_role();
select ok(
  not has_function_privilege('anon', 'lists.item_shared(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'lists.item_shared(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'lists.claim_holder(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'lists.claim_holder(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'lists.item_shared(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'lists.claim_holder(uuid, uuid)', 'execute'),
  'anon and authenticated can''t execute them');

-- ─── excluded_offers (AC-31) ─────────────────────────────────────────────────

select tests.ap_round(:'a', :'p_excl') as r_ex \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id, status)
values (:'a', :'r_ex', 'Mug', 2000, 2200, 1, 'list', :'i_cut', 'rejected');
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, retailer, retailer_product_id, status)
values (:'a', :'r_ex', 'Clock', 3000, 3300, 2, 'walmart', 'W1', 'selected') returning id as given_idea \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, retailer, retailer_product_id, status)
values (:'a', :'r_ex', 'Pen', 1000, 1100, 3, 'amazon', 'B0FAILED', 'selected') returning id as failed_idea \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, retailer, retailer_product_id)
values (:'a', :'r_ex', 'Cup', 1000, 1100, 4, 'amazon', 'B0OPEN');
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
values (:'a', :'r_ex', :'given_idea', 'zinc_wallet', 3300, 100, 'delivered', 'recipient', 'Dayton', 'OH'),
       (:'a', :'r_ex', :'failed_idea', 'zinc_wallet', 1100, 100, 'failed', 'recipient', 'Dayton', 'OH');
-- The failed order is resolved, so it isn't given (an unresolved one is; see below).
update concierge.orders set resolved = true where idea_id = :'failed_idea';
select tests.act_as_server();
select set_eq(
  format($q$select retailer, product_id, list_item_id from concierge.excluded_offers(%L)$q$, :'p_excl'),
  format($q$values (null::text, null::text, %L::uuid), ('walmart', 'W1', null)$q$, :'i_cut'),
  'excluded_offers lists a rejected list item and a given Walmart product with its retailer');
select tests.reset_role();
select ok(
  not has_function_privilege('anon', 'concierge.excluded_offers(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.excluded_offers(uuid)', 'execute'),
  'excluded_offers is server only');

-- An unresolved failure may still be replaced, so it counts as given, exactly
-- as approve_round's already_bought counts it; resolved, it no longer does.
select tests.ap_round(:'a', :'p_unres') as r_unres \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id, status)
values (:'a', :'r_unres', 'Kit', 1000, 1100, 1, 'list', :'i_unres', 'selected') returning id as unres_list_idea \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, retailer, retailer_product_id, status)
values (:'a', :'r_unres', 'Lamp', 3000, 3300, 2, 'amazon', 'B0UNRES', 'selected') returning id as unres_idea \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, resolved, ship_to, ship_city, ship_state)
values (:'a', :'r_unres', :'unres_list_idea', 'zinc_wallet', 1100, 100, 'failed', false, 'recipient', 'Dayton', 'OH'),
       (:'a', :'r_unres', :'unres_idea', 'zinc_wallet', 3300, 100, 'failed', false, 'recipient', 'Dayton', 'OH');
select tests.act_as_server();
select set_eq(
  format($q$select retailer, product_id, list_item_id from concierge.excluded_offers(%L)$q$, :'p_unres'),
  format($q$values (null::text, null::text, %L::uuid), ('amazon', 'B0UNRES', null)$q$, :'i_unres'),
  'excluded_offers lists a list item and a product whose only order failed and isn''t resolved');
select tests.reset_role();
update concierge.orders set resolved = true where round_id = :'r_unres';
select tests.act_as_server();
select is_empty(
  format($q$select * from concierge.excluded_offers(%L)$q$, :'p_unres'),
  '... and stops listing them once that failure is resolved');
select tests.reset_role();

-- ─── replace_failed_order (AC-14, AC-15, AC-15a, AC-12b, AC-30) ──────────────

-- A round needing attention for one unresolved failed order of the idea
-- p_item (a list gift, or null), under a lease, plus a proposed idea
-- (p_next_item) to replace it with.
create function tests.rf_round(p_user uuid, p_person uuid, p_failure text, p_item uuid default null, p_next_item uuid default null)
returns table (round_id uuid, failed_idea uuid, failed_order uuid, next_idea uuid, lock timestamptz) language plpgsql as $$
declare v_round uuid; v_idea uuid; v_next uuid; v_order uuid;
begin
  v_round := tests.ap_round(p_user, p_person);
  v_idea := tests.ap_idea(v_round, p_item, 'selected');
  v_next := tests.ap_idea(v_round, p_next_item);
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, gift_message, status,
                                failure_type, ship_to, ship_city, ship_state)
  values (p_user, v_round, v_idea, 'zinc_wallet', 4600, 100, 'Old note', 'failed', p_failure, 'recipient', 'Dayton', 'OH')
  returning id into v_order;
  perform concierge.reconcile_round(v_round);
  return query select v_round, v_idea, v_order, v_next, r.locked_until from concierge.gift_rounds r where r.id = v_round;
end $$;

-- replace_failed_order's p_order: an approve_round element plus new_total_cents.
create function tests.rf_order(p_idea uuid, p_ship_to text default 'recipient', p_source text default null,
                               p_new_total integer default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'idea_id', p_idea, 'max_price_cents', 4500, 'fee_cents', 100, 'gift_message', 'Happy birthday',
    'ship_to', p_ship_to, 'address_source', p_source, 'new_total_cents', p_new_total,
    'address', jsonb_build_object('recipient_first_name', 'Mary', 'recipient_last_name', 'Allen',
                                  'address_line1', '12 Oak St', 'city', 'Dayton', 'state', 'OH', 'zip', '45402',
                                  'country', 'US'));
$$;

create function tests.rf_sql(p_round uuid, p_user uuid, p_lock timestamptz, p_order uuid, p_el jsonb)
returns text language sql as $$
  select format($q$select * from concierge.replace_failed_order(%L, %L, %L, %L, %L)$q$, p_round, p_user, p_lock, p_order, p_el);
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- An out_of_stock order, replaced with the next-best idea (AC-15).
select * from tests.rf_round(:'a', :'p_fix', 'out_of_stock') \gset rf1_
select tests.act_as_server();
select id as rf1_new from concierge.replace_failed_order(:'rf1_round_id', :'a', :'rf1_lock', :'rf1_failed_order',
  tests.rf_order(:'rf1_next_idea', 'buyer', 'own')) \gset
select tests.reset_role();
select is(
  (select array[(select resolved::text from concierge.orders where id = :'rf1_failed_order'), o.status::text, o.hold_reason,
                (o.idea_id = :'rf1_next_idea')::text, (select status::text from concierge.gift_ideas where id = :'rf1_next_idea')]
     from concierge.orders o where o.id = :'rf1_new'),
  array['true', 'held', 'retry', 'true', 'selected'],
  'replace_failed_order replaces an out_of_stock order with a proposed idea');
select is(
  (select array[o.gift_message, o.ship_to, o.address_source, o.ship_city, x.city, x.address_line1]
     from concierge.orders o join concierge.order_addresses x on x.order_id = o.id where o.id = :'rf1_new'),
  array['Happy birthday', 'buyer', 'own', 'Dayton', 'Dayton', '12 Oak St'],
  'the new order keeps the gift note and ship_to it was given');

-- A price_up re-buy of the same idea, once (AC-14, S2, B1).
select * from tests.rf_round(:'a', :'p_fix', 'price_up') \gset rf2_
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf2_round_id', :'a', :'rf2_lock', :'rf2_failed_order', tests.rf_order(:'rf2_failed_idea')),
  'P0001', 'replace_failed_order: no new total', 'a price_up re-buy needs the new total');
select throws_ok(tests.rf_sql(:'rf2_round_id', :'a', :'rf2_lock', :'rf2_failed_order', tests.rf_order(:'rf2_failed_idea', 'recipient', null, 0)),
  'P0001', 'replace_failed_order: no new total', '... and refuses a new total of zero');
select id as rf2_new from concierge.replace_failed_order(:'rf2_round_id', :'a', :'rf2_lock', :'rf2_failed_order',
  tests.rf_order(:'rf2_failed_idea', 'recipient', null, 5400)) \gset
select tests.reset_role();
select is((select array[est_total_cents::text, over_budget::text, status::text] from concierge.gift_ideas where id = :'rf2_failed_idea'),
  array['5400', 'true', 'selected'], 'a price_up re-buy saves the new total on the idea');
update concierge.orders set status = 'failed', failure_type = 'price_up', hold_reason = null where id = :'rf2_new';
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf2_round_id', :'a', :'rf2_lock', :'rf2_new', tests.rf_order(:'rf2_failed_idea', 'recipient', null, 5600)),
  'P0001', 'replace_failed_order: once', 'a second price_up re-buy of the same idea is refused');
select tests.reset_role();

-- The same re-buy on a round with no budget: nothing is over it (found by the browser journey, ALL-29 Task 13).
select * from tests.rf_round(:'a', :'p_fix', 'price_up') \gset rf2b_
update concierge.gift_rounds set budget_cents = null where id = :'rf2b_round_id';
select tests.act_as_server();
select lives_ok(tests.rf_sql(:'rf2b_round_id', :'a', :'rf2b_lock', :'rf2b_failed_order', tests.rf_order(:'rf2b_failed_idea', 'recipient', null, 5400)),
  'a price_up re-buy on a round with no budget goes through');
select tests.reset_role();
select is((select array[est_total_cents::text, over_budget::text] from concierge.gift_ideas where id = :'rf2b_failed_idea'),
  array['5400', 'false'], '... and the idea is not over a budget it doesn''t have');

-- Ideas that aren't on offer (AC-12b).
select * from tests.rf_round(:'a', :'p_fix', 'out_of_stock') \gset rf3_
select tests.ap_idea(:'rf3_round_id', null, 'rejected') as rf3_rejected \gset
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf3_round_id', :'a', :'rf3_lock', :'rf3_failed_order', tests.rf_order(:'rf3_failed_idea')),
  'P0001', 'replace_failed_order: replaced', 'an out_of_stock order can''t be re-bought as the same idea');
select throws_ok(tests.rf_sql(:'rf3_round_id', :'a', :'rf3_lock', :'rf3_failed_order', tests.rf_order(:'rf3_rejected')),
  'P0001', 'replace_failed_order: replaced', 'a rejected idea is refused');
select tests.reset_role();

-- An address failure re-offers the same gift to a fixed address (AC-15a, B2).
select * from tests.rf_round(:'a', :'p_fix', 'address_rejected') \gset rf4_
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf4_round_id', :'a', :'rf4_lock', :'rf4_failed_order',
    tests.rf_order(:'rf4_failed_idea', 'recipient', 'shared')),
  'P0001', 'replace_failed_order: fixed address', 'an address_rejected order can''t ship to the recipient');
select throws_ok(tests.rf_sql(:'rf4_round_id', :'a', :'rf4_lock', :'rf4_failed_order', tests.rf_order(:'rf4_next_idea')),
  'P0001', 'replace_failed_order: fixed address',
  'after an address failure, a different proposed idea shipping to the recipient is refused');
select id as rf4_new from concierge.replace_failed_order(:'rf4_round_id', :'a', :'rf4_lock', :'rf4_failed_order',
  tests.rf_order(:'rf4_failed_idea', 'buyer', 'own')) \gset
select tests.reset_role();
select is((select array[ship_to, address_source, status::text, (idea_id = :'rf4_failed_idea')::text] from concierge.orders where id = :'rf4_new'),
  array['buyer', 'own', 'held', 'true'], 'an address_rejected order can go to the buyer');
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf4_round_id', :'a', :'rf4_lock', :'rf4_failed_order', tests.rf_order(:'rf4_failed_idea', 'buyer', 'own')),
  'P0001', 'replace_failed_order: not current', 'a second replace of the same failed order is refused');
select tests.reset_role();
select * from tests.rf_round(:'a', :'p_fix', 'address_withdrawn') \gset rfw_
select tests.act_as_server();
select id as rfw_new from concierge.replace_failed_order(:'rfw_round_id', :'a', :'rfw_lock', :'rfw_failed_order',
  tests.rf_order(:'rfw_failed_idea', 'other', 'own')) \gset
select tests.reset_role();
select is((select array[o.ship_to, o.address_source, o.status::text, (o.idea_id = :'rfw_failed_idea')::text, x.address_line1]
             from concierge.orders o join concierge.order_addresses x on x.order_id = o.id where o.id = :'rfw_new'),
  array['other', 'own', 'held', 'true', '12 Oak St'], 'an address_withdrawn order can go to another address');

-- The round: its lease, its owner, open and before the ship-by day (AC-15).
select * from tests.rf_round(:'a', :'p_fix', 'out_of_stock') \gset rf5_
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf5_round_id', :'a', now(), :'rf5_failed_order', tests.rf_order(:'rf5_next_idea')),
  'P0001', 'replace_failed_order: lease not held', 'without the lease it''s refused');
select throws_ok(tests.rf_sql(:'rf5_round_id', :'stranger', :'rf5_lock', :'rf5_failed_order', tests.rf_order(:'rf5_next_idea')),
  'P0001', 'replace_failed_order: lease not held', 'another user''s round is refused');
select tests.reset_role();
update concierge.gift_rounds set closed_at = now() where id = :'rf5_round_id';
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf5_round_id', :'a', :'rf5_lock', :'rf5_failed_order', tests.rf_order(:'rf5_next_idea')),
  'P0001', 'replace_failed_order: not open', 'a closed round is refused');
select tests.reset_role();
select * from tests.rf_round(:'a', :'p_fix', 'out_of_stock') \gset rf6_
update concierge.gift_rounds set ship_by_deadline = (now() at time zone 'utc')::date where id = :'rf6_round_id';
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf6_round_id', :'a', :'rf6_lock', :'rf6_failed_order', tests.rf_order(:'rf6_next_idea')),
  'P0001', 'replace_failed_order: not open', 'on the ship-by day it''s refused');
select tests.reset_role();

-- List gifts (AC-30).
select * from tests.rf_round(:'a', :'p_mom', 'out_of_stock', null, :'i_rf_claimed') \gset rf7_
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf7_round_id', :'a', :'rf7_lock', :'rf7_failed_order', tests.rf_order(:'rf7_next_idea')),
  'P0001', 'replace_failed_order: claimed', 'a list gift a friend claimed is refused');
select tests.reset_role();
-- i_bought is on a placed order in r_first.
select * from tests.rf_round(:'a', :'p_mom', 'out_of_stock', null, :'i_bought') \gset rf8_
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf8_round_id', :'a', :'rf8_lock', :'rf8_failed_order', tests.rf_order(:'rf8_next_idea')),
  'P0001', 'replace_failed_order: already_bought', 'a list gift on a live order in another round is refused');
select tests.reset_role();
select * from tests.rf_round(:'a', :'p_mom', 'price_up', :'i_rf_rebuy') \gset rf9_
select tests.act_as_server();
select is(lists.claim_holder(:'i_rf_rebuy', :'a'), 'none', 'a list gift whose order failed starts unclaimed here');
select count(*) from concierge.replace_failed_order(:'rf9_round_id', :'a', :'rf9_lock', :'rf9_failed_order',
  tests.rf_order(:'rf9_failed_idea', 'recipient', null, 4800));
select is(lists.claim_holder(:'i_rf_rebuy', :'a'), 'mine', 'a list gift re-bought is claimed for the buyer');
select tests.reset_role();

-- The failed order's own claim (AC-30): released when another idea replaces it,
-- kept when the same gift is re-bought or is still on another live order.
select * from tests.rf_round(:'a', :'p_mom', 'out_of_stock', :'i_rf_old') \gset rf11_
insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order) values (:'i_rf_old', :'a', 'Buyer', true);
select tests.act_as_server();
select count(*) from concierge.replace_failed_order(:'rf11_round_id', :'a', :'rf11_lock', :'rf11_failed_order',
  tests.rf_order(:'rf11_next_idea'));
select is(lists.claim_holder(:'i_rf_old', :'a'), 'none', 'a list gift replaced by another idea is released');
select tests.reset_role();
select * from tests.rf_round(:'a', :'p_mom', 'price_up', :'i_rf_keep') \gset rf12_
insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order) values (:'i_rf_keep', :'a', 'Buyer', true);
select tests.act_as_server();
select count(*) from concierge.replace_failed_order(:'rf12_round_id', :'a', :'rf12_lock', :'rf12_failed_order',
  tests.rf_order(:'rf12_failed_idea', 'recipient', null, 4800));
select is(lists.claim_holder(:'i_rf_keep', :'a'), 'mine', 're-buying the same list gift keeps its claim');
select tests.reset_role();
-- i_rf_both is also on a placed order in an earlier round.
select tests.ap_round(:'a', :'p_mom') as r_both \gset
select tests.ap_idea(:'r_both', :'i_rf_both', 'selected') as r_both_idea \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
values (:'a', :'r_both', :'r_both_idea', 'zinc_wallet', 4500, 100, 'placed', 'recipient', 'Dayton', 'OH');
select * from tests.rf_round(:'a', :'p_mom', 'out_of_stock', :'i_rf_both') \gset rf13_
insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order) values (:'i_rf_both', :'a', 'Buyer', true);
select tests.act_as_server();
select count(*) from concierge.replace_failed_order(:'rf13_round_id', :'a', :'rf13_lock', :'rf13_failed_order',
  tests.rf_order(:'rf13_next_idea'));
select is(lists.claim_holder(:'i_rf_both', :'a'), 'mine', '... but not while the gift is on another live order');
select tests.reset_role();

select ok(
  not has_function_privilege('anon', 'concierge.replace_failed_order(uuid, uuid, timestamptz, uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.replace_failed_order(uuid, uuid, timestamptz, uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'concierge.replace_failed_order(uuid, uuid, timestamptz, uuid, jsonb)', 'execute'),
  'anon and authenticated can''t execute it');

-- ─── None of these (AC-12, AC-13, AC-13a) ────────────────────────────────────

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Rej', 'friend') returning id as p_rej \gset
insert into public.people (name, relationship) values ('Max', 'friend') returning id as p_max \gset
insert into public.people (name, relationship) values ('Sel', 'friend') returning id as p_sel \gset
insert into public.people (name, relationship) values ('Fact', 'friend') returning id as p_fact \gset
insert into public.people (name, relationship) values ('Late', 'friend') returning id as p_late \gset
insert into public.people (name, relationship) values ('Bud', 'friend') returning id as p_bud \gset
select tests.reset_role();
select concierge.setting_int('idea_round_runs_max') as runs_max \gset

-- reject_round_ideas, with the reason text 'Not for her'.
create function tests.rj_sql(p_round uuid, p_user uuid, p_lock timestamptz, p_code text, p_facts jsonb, p_expect boolean)
returns text language sql as $$
  select format($q$select concierge.reject_round_ideas(%L, %L, %L, %L, 'Not for her', %L, %L)$q$,
                p_round, p_user, p_lock, p_code, p_facts, p_expect);
$$;

-- p_n finished idea runs of the round, all over an hour ago.
create function tests.rj_runs(p_round uuid, p_n int)
returns void language sql as $$
  insert into concierge.idea_runs (user_id, person_id, round_id, started_at, finished_at, outcome)
  select r.user_id, r.person_id, r.id, now() - make_interval(hours => 1 + g), now() - interval '1 hour', 'saved'
    from concierge.gift_rounds r cross join generate_series(1, p_n) g
   where r.id = p_round;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- A search left: every idea rejected, the round back to generating (AC-12, AC-13).
select tests.ap_round(:'a', :'p_rej') as rj1 \gset
select tests.ap_idea(:'rj1', null) as rj1_a \gset
select tests.ap_idea(:'rj1', null) as rj1_b \gset
select locked_until as rj1_lock from concierge.gift_rounds where id = :'rj1' \gset
insert into concierge.round_sends (round_id, user_id, step)
values (:'rj1', :'a', 'heads_up'), (:'rj1', :'a', 'reminder_1'), (:'rj1', :'a', 'hold:1:notice');
select tests.act_as_server();
select concierge.reject_round_ideas(:'rj1', :'a', :'rj1_lock', 'not_style', 'Not for her',
  '[{"category": "avoid", "value": "Not their style: Gift"}]', true);
select tests.reset_role();
select is(
  array[(select count(*) from concierge.rejections
          where round_id = :'rj1' and idea_id in (:'rj1_a', :'rj1_b') and reason_code = 'not_style' and reason_text = 'Not for her')::text,
        (select count(*) from concierge.gift_ideas where round_id = :'rj1' and status = 'rejected')::text,
        (select status::text from concierge.gift_rounds where id = :'rj1'),
        (select (next_action_at = now())::text from concierge.gift_rounds where id = :'rj1')],
  array['2', '2', 'generating', 'true'],
  'with a search left, reject saves a rejection per idea, marks them rejected and sends the round back to generating, due now');
select is(
  (select array[f.category, f.value, f.source, f.active::text, (f.user_id = :'a')::text]
     from concierge.profile_facts f where f.person_id = :'p_rej'),
  array['avoid', 'Not their style: Gift', 'rejection', 'true', 'true'],
  'the rejection''s fact is saved as the buyer''s, with source rejection');
select set_eq(
  format($q$select step from concierge.round_sends where round_id = %L$q$, :'rj1'),
  $$values ('heads_up@1'), ('reminder_1@1'), ('hold:1:notice')$$,
  'the sent heads_up and reminder_1 become heads_up@1 and reminder_1@1');

-- New ideas and a new heads-up, then a second rejection.
update concierge.gift_rounds set status = 'awaiting_approval' where id = :'rj1';
select tests.ap_idea(:'rj1', null);
insert into concierge.round_sends (round_id, user_id, step) values (:'rj1', :'a', 'heads_up');
select tests.act_as_server();
select concierge.reject_round_ideas(:'rj1', :'a', :'rj1_lock', 'too_generic', null, '[]', true);
select tests.reset_role();
select set_eq(
  format($q$select step from concierge.round_sends where round_id = %L$q$, :'rj1'),
  $$values ('heads_up@1'), ('heads_up@2'), ('reminder_1@1'), ('hold:1:notice')$$,
  'a second rejection makes @2');

-- The runs rule (AC-13a): max runs, then one more after a new fact.
select tests.ap_round(:'a', :'p_max') as rmax \gset
select tests.rj_runs(:'rmax', :runs_max);
select tests.ap_round(:'a', :'p_max') as rmax1 \gset
select tests.rj_runs(:'rmax1', :runs_max + 1);
select tests.ap_idea(:'rmax1', null) as rmax1_idea \gset
select locked_until as rmax_lock from concierge.gift_rounds where id = :'rmax' \gset
select locked_until as rmax1_lock from concierge.gift_rounds where id = :'rmax1' \gset
select tests.act_as_server();
select is(
  array[concierge.runs_after_rejection(:'rmax', '[{"category": "avoid", "value": "Too generic: Gift"}]', now()),
        concierge.runs_after_rejection(:'rmax', '[]', now())],
  array[true, false],
  'runs_after_rejection: after idea_round_runs_max runs, true with a new fact, false without');
select is(
  array[concierge.runs_after_rejection(:'rmax1', '[{"category": "avoid", "value": "Too generic: Gift"}]', now()),
        concierge.runs_after_rejection(:'rmax1', '[]', now())],
  array[false, false],
  'after max + 1 runs, false either way');
select concierge.reject_round_ideas(:'rmax1', :'a', :'rmax1_lock', 'too_pricey', null, '[]', false);
select tests.reset_role();
select is(
  array[(select count(*) from concierge.rejections where round_id = :'rmax1' and idea_id is null and reason_code = 'too_pricey')::text,
        (select count(*) from concierge.rejections where round_id = :'rmax1')::text,
        (select status from concierge.gift_ideas where id = :'rmax1_idea'),
        (select status::text from concierge.gift_rounds where id = :'rmax1')],
  array['1', '1', 'proposed', 'awaiting_approval'],
  'with no search left, reject saves one reason and leaves the ideas proposed and the round awaiting_approval');

-- A fact that duplicates a turned-off one doesn't end up active (B3).
insert into concierge.profile_facts (user_id, person_id, category, value, source, active, updated_at)
values (:'a', :'p_max', 'avoid', 'Loud toys', 'note', false, now() - interval '1 day');
select tests.act_as_server();
select is(concierge.runs_after_rejection(:'rmax', '[{"category": "avoid", "value": "  loud   TOYS "}]', now()), false,
  'at max runs, a fact that duplicates a turned-off one doesn''t count');
select throws_ok(tests.rj_sql(:'rmax', :'a', :'rmax_lock', 'not_style', '[{"category": "avoid", "value": "loud toys"}]', true),
  'P0001', 'reject_round_ideas: changed', '... and a reject expecting a search is changed');
select tests.reset_role();
select is(
  array[(select count(*) from concierge.rejections where round_id = :'rmax')::text,
        (select (updated_at < now())::text from concierge.profile_facts where person_id = :'p_max' and value = 'Loud toys')],
  array['0', 'true'],
  '... and saves nothing');

-- The next tick isn't before the ship-by day (S1).
select tests.ap_round(:'a', :'p_late') as rlate \gset
select tests.ap_idea(:'rlate', null) as rlate_idea \gset
select locked_until as rlate_lock from concierge.gift_rounds where id = :'rlate' \gset
update concierge.gift_rounds set ship_by_deadline = (now() at time zone 'utc')::date + 2 where id = :'rlate';
select tests.act_as_server();
select is(concierge.runs_after_rejection(:'rlate', '[]', now()), true, 'two days before the ship-by day there''s a new search');
select tests.reset_role();
update concierge.gift_rounds set ship_by_deadline = (now() at time zone 'utc')::date + 1 where id = :'rlate';
select tests.act_as_server();
select is(concierge.runs_after_rejection(:'rlate', '[]', now()), false, 'the day before the ship-by day there''s no new search');
select concierge.reject_round_ideas(:'rlate', :'a', :'rlate_lock', 'has_it', null, '[]', false);
select tests.reset_role();
select is(
  array[(select count(*) from concierge.rejections where round_id = :'rlate' and idea_id is null)::text,
        (select status from concierge.gift_ideas where id = :'rlate_idea'),
        (select status::text from concierge.gift_rounds where id = :'rlate')],
  array['1', 'proposed', 'awaiting_approval'],
  '... so reject keeps the ideas');

-- A selected idea whose order was cancelled (AC-12a).
select tests.ap_round(:'a', :'p_sel') as rsel \gset
select tests.ap_idea(:'rsel', null, 'selected') as rsel_idea \gset
select tests.ap_idea(:'rsel', null) as rsel_other \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
values (:'a', :'rsel', :'rsel_idea', 'zinc_wallet', 4500, 100, 'cancelled', 'recipient', 'Dayton', 'OH');
select locked_until as rsel_lock from concierge.gift_rounds where id = :'rsel' \gset
select tests.act_as_server();
select concierge.reject_round_ideas(:'rsel', :'a', :'rsel_lock', 'too_generic', null, '[]', true);
select ok(s.run_id is not null and s.refusal is null
          and (select count(*) from concierge.gift_ideas where round_id = :'rsel' and status = 'rejected') = 2,
  'a selected idea with a cancelled order is rejected too, so the next run starts')
  from concierge.start_idea_run(:'a', :'p_sel', :'rsel', now()) s;
select tests.reset_role();

-- A fact that already exists (AC-12).
select tests.ap_round(:'a', :'p_fact') as rfact \gset
select tests.ap_idea(:'rfact', null);
select locked_until as rfact_lock from concierge.gift_rounds where id = :'rfact' \gset
insert into concierge.profile_facts (user_id, person_id, category, value, source, active, updated_at)
values (:'a', :'p_fact', 'owns', 'Gift', 'note', false, now() - interval '1 day');
select tests.act_as_server();
select concierge.reject_round_ideas(:'rfact', :'a', :'rfact_lock', 'has_it', null, '[{"category": "owns", "value": "gift"}]', true);
select tests.reset_role();
select is(
  (select array[count(*)::text, bool_and(updated_at = now())::text, bool_or(active)::text, min(source)]
     from concierge.profile_facts where person_id = :'p_fact'),
  array['1', 'true', 'false', 'note'],
  'a fact that already exists has its updated_at bumped and stays inactive if it was off');

-- Refusals.
select tests.ap_round(:'a', :'p_rej') as rbad \gset
select tests.ap_idea(:'rbad', null, 'selected') as rbad_idea \gset
select locked_until as rbad_lock from concierge.gift_rounds where id = :'rbad' \gset
select tests.act_as_server();
select throws_ok(tests.rj_sql(:'rbad', :'a', :'rbad_lock', 'not_style', jsonb_build_array(jsonb_build_object('category', 'avoid', 'value', repeat('x', 501))), true),
  '23514', null, 'a 501-character fact is refused');
select throws_ok(tests.rj_sql(:'rbad', :'a', :'rbad_lock', 'too_ugly', '[]', true),
  'P0001', 'reject_round_ideas: unknown reason', 'an unknown reason code is refused');
select throws_ok(tests.rj_sql(:'rbad', :'a', :'rbad_lock', 'not_style', '[{"category": "interest", "value": "Dogs"}]', true),
  'P0001', 'reject_round_ideas: fact category', 'a fact other than owns or avoid is refused');
select throws_ok(tests.rj_sql(:'rbad', :'a', now(), 'not_style', '[]', true),
  'P0001', 'reject_round_ideas: lease not held', 'without the lease reject is refused');
select throws_ok(tests.rj_sql(:'rbad', :'stranger', :'rbad_lock', 'not_style', '[]', true),
  'P0001', 'reject_round_ideas: lease not held', 'another user''s round is refused');
select tests.reset_role();
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
values (:'a', :'rbad', :'rbad_idea', 'zinc_wallet', 4500, 100, 'placed', 'recipient', 'Dayton', 'OH');
select tests.act_as_server();
select throws_ok(tests.rj_sql(:'rbad', :'a', :'rbad_lock', 'not_style', '[]', true),
  'P0001', 'reject_round_ideas: live order', 'a round with a live order can''t be rejected');
select tests.reset_role();
update concierge.gift_rounds set status = 'needs_attention' where id = :'rbad';
select tests.act_as_server();
select throws_ok(tests.rj_sql(:'rbad', :'a', :'rbad_lock', 'not_style', '[]', true),
  'P0001', 'reject_round_ideas: not open', 'a needs_attention round can''t be rejected');
select tests.reset_role();

-- ─── An open round's budget (AC-9) ───────────────────────────────────────────

select tests.ap_round(:'a', :'p_bud') as rbud \gset
update concierge.gift_rounds set budget_cents = null where id = :'rbud';
select tests.ap_idea(:'rbud', null) as rbud_hi \gset
select tests.ap_idea(:'rbud', null) as rbud_lo \gset
update concierge.gift_ideas set est_total_cents = 6000 where id = :'rbud_hi';
update concierge.gift_ideas set est_total_cents = 4000 where id = :'rbud_lo';
select locked_until as rbud_lock from concierge.gift_rounds where id = :'rbud' \gset
select tests.act_as_server();
select throws_ok(format($q$select concierge.set_round_budget(%L, %L, %L, 5000)$q$, :'rbud', :'a', now()),
  'P0001', 'set_round_budget: lease not held', 'without the lease set_round_budget is refused');
select throws_ok(format($q$select concierge.set_round_budget(%L, %L, %L, -1)$q$, :'rbud', :'a', :'rbud_lock'),
  'P0001', 'set_round_budget: negative', 'set_round_budget refuses a negative amount');
select concierge.set_round_budget(:'rbud', :'a', :'rbud_lock', 5000);
select tests.reset_role();
select is(
  array[(select budget_cents from concierge.gift_rounds where id = :'rbud')::text,
        (select over_budget from concierge.gift_ideas where id = :'rbud_hi')::text,
        (select over_budget from concierge.gift_ideas where id = :'rbud_lo')::text],
  array['5000', 'true', 'false'],
  'set_round_budget sets the budget and marks ideas over it');
select tests.act_as_server();
select throws_ok(format($q$select concierge.set_round_budget(%L, %L, %L, 9000)$q$, :'rbud', :'a', :'rbud_lock'),
  'P0001', 'set_round_budget: already set', 'set_round_budget refuses a round that already has a budget');
select tests.reset_role();

select ok(
  not has_function_privilege('anon', 'concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean)', 'execute')
  and not has_function_privilege('anon', 'concierge.runs_after_rejection(uuid, jsonb, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.runs_after_rejection(uuid, jsonb, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'concierge.set_round_budget(uuid, uuid, timestamptz, integer)', 'execute')
  and not has_function_privilege('authenticated', 'concierge.set_round_budget(uuid, uuid, timestamptz, integer)', 'execute')
  and has_function_privilege('service_role', 'concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean)', 'execute')
  and has_function_privilege('service_role', 'concierge.runs_after_rejection(uuid, jsonb, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'concierge.set_round_budget(uuid, uuid, timestamptz, integer)', 'execute'),
  'anon and authenticated can''t execute them');

-- ─── After the link is cut (AC-30a, B2) ──────────────────────────────────────
-- Last, since resetting the share token cuts every link to Mom's list.

select tests.ap_round(:'a', :'p_mom') as r_cut \gset
select tests.ap_idea(:'r_cut', :'i_cut') as r_cut_idea \gset
select locked_until as r_cut_lock from concierge.gift_rounds where id = :'r_cut' \gset
select * from tests.rf_round(:'a', :'p_mom', 'out_of_stock', null, :'i_rf_cut') \gset rf10_
update lists.lists set share_token = gen_random_uuid() where id = :'list_id';
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_cut', :'a', :'r_cut_lock', tests.ap_orders(:'r_cut_idea')),
  'P0001', 'approve_round: not_shared', 'approve_round refuses a list idea after the link is cut');
select tests.reset_role();
select is((select count(*)::int from concierge.orders where round_id = :'r_cut'), 0, '... and no order is written');
select tests.act_as_server();
select throws_ok(tests.rf_sql(:'rf10_round_id', :'a', :'rf10_lock', :'rf10_failed_order', tests.rf_order(:'rf10_next_idea')),
  'P0001', 'replace_failed_order: not_shared', 'a list gift whose link was cut is refused');
select tests.reset_role();

-- ─── What the round screen reads (AC-14, AC-18) ──────────────────────────────
select ok(
  has_column_privilege('authenticated', 'concierge.orders', 'resolved', 'select')
  and has_column_privilege('authenticated', 'concierge.gift_rounds', 'closed_at', 'select')
  and not has_column_privilege('anon', 'concierge.orders', 'resolved', 'select')
  and not has_column_privilege('anon', 'concierge.gift_rounds', 'closed_at', 'select'),
  'signed-in owners read orders.resolved and gift_rounds.closed_at');

select * from finish();
rollback;
