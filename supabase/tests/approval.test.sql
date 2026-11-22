-- The approval screen's database side (ALL-29, Task 1): rejected ideas don't
-- count as a round's ideas, ideas keep their photo and list fields, list
-- gifts are checked through the lists product's own functions (T19), and
-- approve_round refuses ideas that were replaced, list gifts no longer
-- shared, and list gifts the buyer already has on a live order.
begin;
\ir _helpers.psql
select plan(22);

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
insert into lists.lists (owner_id, title) values (:'stranger', 'Other') returning id as other_list \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'other_list', 0, 'Kite', 1000) returning id as i_other \gset

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as p_mom \gset
select lists.link_person(:'token', :'p_mom');
insert into public.people (name, relationship) values ('Run', 'friend') returning id as p_run \gset
insert into public.people (name, relationship) values ('Done', 'friend') returning id as p_done \gset
insert into public.people (name, relationship) values ('Save', 'friend') returning id as p_save \gset
insert into public.people (name, relationship) values ('Excl', 'friend') returning id as p_excl \gset
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

-- ─── After the link is cut (AC-30a, B2) ──────────────────────────────────────
-- Last, since resetting the share token cuts every link to Mom's list.

select tests.ap_round(:'a', :'p_mom') as r_cut \gset
select tests.ap_idea(:'r_cut', :'i_cut') as r_cut_idea \gset
select locked_until as r_cut_lock from concierge.gift_rounds where id = :'r_cut' \gset
update lists.lists set share_token = gen_random_uuid() where id = :'list_id';
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r_cut', :'a', :'r_cut_lock', tests.ap_orders(:'r_cut_idea')),
  'P0001', 'approve_round: not_shared', 'approve_round refuses a list idea after the link is cut');
select tests.reset_role();
select is((select count(*)::int from concierge.orders where round_id = :'r_cut'), 0, '... and no order is written');

select * from finish();
rollback;
