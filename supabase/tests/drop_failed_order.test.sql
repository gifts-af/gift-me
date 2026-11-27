-- "Pick a different gift" (ALL-185): drop_failed_order resolves a failed
-- order and puts its round back to choosing, under the round's lease, only
-- when that order is the round's only one still in play.
begin;
\ir _helpers.psql
select plan(29);

select tests.create_user('drop-buyer@example.com', 'Buyer') as a \gset
select tests.create_user('drop-mom@example.com', 'Mom') as mom \gset
insert into concierge.accounts (user_id, paid_features) values (:'a', true);

insert into lists.lists (owner_id, title) values (:'mom', 'Birthday') returning id as list_id, share_token as token \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 0, 'Vase', 4000) returning id as i_vase \gset

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'mother') returning id as p_mom \gset
select lists.link_person(:'token', :'p_mom');
insert into public.people (name, relationship) values ('Pat', 'friend') returning id as p_pat \gset
select tests.reset_role();

-- A round needing attention for one failed order of an idea (a list gift when
-- p_item is given), under a lease, plus a proposed idea to pick instead.
create function tests.df_round(p_user uuid, p_person uuid, p_failure text, p_item uuid default null)
returns table (round_id uuid, failed_idea uuid, failed_order uuid, other_idea uuid, lock timestamptz) language plpgsql as $$
declare v_occasion uuid; v_round uuid; v_idea uuid; v_other uuid; v_order uuid;
begin
  select id into v_occasion from concierge.occasions where person_id = p_person and kind = 'christmas';
  if v_occasion is null then
    insert into concierge.occasions (user_id, person_id, kind) values (p_user, p_person, 'christmas') returning id into v_occasion;
  end if;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, p_person, v_occasion, 2030 + (select count(*)::int from concierge.gift_rounds where person_id = p_person),
          current_date + 37, current_date + 30, 5000, 'awaiting_approval', now(), now() + interval '10 minutes')
  returning id into v_round;
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id, status)
  values (p_user, v_round, 'Mouse pad', 2000, 2259, 1, case when p_item is null then 'generated' else 'list' end, p_item, 'selected')
  returning id into v_idea;
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, status)
  values (p_user, v_round, 'Mug', 1500, 1700, 2, 'generated', 'proposed')
  returning id into v_other;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status,
                                failure_type, ship_to, ship_city, ship_state)
  values (p_user, v_round, v_idea, 'zinc_wallet', 2300, 100, 'failed', p_failure, 'recipient', 'Dayton', 'OH')
  returning id into v_order;
  if p_item is not null then
    perform lists.claim_for_order(p_item, p_user);
  end if;
  perform concierge.reconcile_round(v_round);
  return query select v_round, v_idea, v_order, v_other, r.locked_until from concierge.gift_rounds r where r.id = v_round;
end $$;

create function tests.df_sql(p_round uuid, p_user uuid, p_lock timestamptz, p_order uuid)
returns text language sql as $$
  select format($q$select concierge.drop_failed_order(%L, %L, %L, %L)$q$, p_round, p_user, p_lock, p_order);
$$;

create function tests.df_orders(p_idea uuid)
returns jsonb language sql as $$
  select format('[{"idea_id": "%s", "max_price_cents": 1700, "fee_cents": 100, "ship_to": "recipient",
                   "address": {"recipient_first_name": "Pat", "recipient_last_name": "Allen", "address_line1": "12 Oak St",
                               "city": "Dayton", "state": "OH", "zip": "45402", "country": "US"}}]', p_idea)::jsonb;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ─── A price rise, dropped ───────────────────────────────────────────────────
select * from tests.df_round(:'a', :'p_pat', 'price_up') \gset d1_
select is((select array[status::text, attention_reason] from concierge.gift_rounds where id = :'d1_round_id'),
  array['needs_attention', 'price_up'], 'the fixture round needs attention for the price rise');
-- Told about the failure, the engine left it waiting for its deadline (holdAction).
update concierge.gift_rounds set next_action_at = ship_by_deadline::timestamptz where id = :'d1_round_id';

select tests.act_as_server();
select lives_ok(tests.df_sql(:'d1_round_id', :'a', :'d1_lock', :'d1_failed_order'),
  'the server drops a failed order that is the round''s only one');
select tests.reset_role();
select is(
  (select array[(select resolved::text from concierge.orders where id = :'d1_failed_order'), r.status::text,
                coalesce(r.attention_reason, 'none'), (r.closed_at is null)::text]
     from concierge.gift_rounds r where r.id = :'d1_round_id'),
  array['true', 'awaiting_approval', 'none', 'true'],
  'the failed order is resolved and the round is back to choosing, still open');
select ok((select next_action_at <= now() from concierge.gift_rounds where id = :'d1_round_id'),
  'and due now, so the next tick plans its reminders again');
select ok(exists (select 1 from concierge.round_sends where round_id = :'d1_round_id' and step = 'fail:' || :'d1_failed_order'),
  'the dropped failure counts as told: no later email about it');
select is((select status::text from concierge.gift_ideas where id = :'d1_failed_idea'), 'selected',
  'after a price rise the failed gift stays listed but can''t be bought again at its old price');

-- Every other idea can be bought again: approve_round accepts the round now.
select tests.act_as_server();
select lives_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'d1_round_id', :'a', :'d1_lock', tests.df_orders(:'d1_other_idea')),
  'approve_round buys another idea in the round afterwards');
select tests.reset_role();

-- ─── An address failure: the same gift can be picked again ───────────────────
select * from tests.df_round(:'a', :'p_pat', 'address_withdrawn') \gset d2_
select tests.act_as_server();
select tests.df_sql(:'d2_round_id', :'a', :'d2_lock', :'d2_failed_order') as d2_sql \gset
select lives_ok(:'d2_sql', 'an address failure can be dropped');
select tests.reset_role();
select is((select status::text from concierge.gift_ideas where id = :'d2_failed_idea'), 'proposed',
  'after an address failure the same gift is on offer again');
select * from tests.df_round(:'a', :'p_pat', 'card_needed') \gset d5_
select tests.act_as_server();
select tests.df_sql(:'d5_round_id', :'a', :'d5_lock', :'d5_failed_order') as d5_sql \gset
select lives_ok(:'d5_sql', 'a card failure can be dropped');
select tests.reset_role();
select is((select status::text from concierge.gift_ideas where id = :'d5_failed_idea'), 'proposed',
  'after a card failure the same gift is on offer again');

-- ─── A list gift: its claim goes back to the list ────────────────────────────
select * from tests.df_round(:'a', :'p_mom', 'out_of_stock', :'i_vase') \gset d3_
select is(lists.claim_holder(:'i_vase', :'a'), 'mine', 'the fixture buyer holds the list gift''s claim');
select tests.act_as_server();
select tests.df_sql(:'d3_round_id', :'a', :'d3_lock', :'d3_failed_order') as d3_sql \gset
select lives_ok(:'d3_sql', 'a failed list gift can be dropped');
select tests.reset_role();
select is(lists.claim_holder(:'i_vase', :'a'), 'none', 'dropping it gives the claim back to the list');

-- ─── Refusals ────────────────────────────────────────────────────────────────
-- Not under the lease.
select * from tests.df_round(:'a', :'p_pat', 'price_up') \gset d4_
select tests.act_as_server();
select throws_ok(tests.df_sql(:'d4_round_id', :'a', now() + interval '1 hour', :'d4_failed_order'),
  'P0001', 'drop_failed_order: lease not held', 'refused without the round''s lease');
select throws_ok(tests.df_sql(:'d4_round_id', :'mom', :'d4_lock', :'d4_failed_order'),
  'P0001', 'drop_failed_order: lease not held', 'refused for someone else''s round');
select tests.reset_role();
-- On the ship-by day, as approve_round.
select * from tests.df_round(:'a', :'p_pat', 'price_up') \gset d6_
update concierge.gift_rounds set ship_by_deadline = (now() at time zone 'utc')::date where id = :'d6_round_id';
select tests.act_as_server();
select throws_ok(tests.df_sql(:'d6_round_id', :'a', :'d6_lock', :'d6_failed_order'),
  'P0001', 'drop_failed_order: not open', 'refused from the ship-by day on');
-- Already resolved (dropped once already, then bought again): not current.
select throws_ok(tests.df_sql(:'d1_round_id', :'a', :'d1_lock', :'d1_failed_order'),
  'P0001', 'drop_failed_order: not current', 'refused for an order that is already resolved');
select tests.reset_role();

-- Another failure still to fix in the same round.
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status,
                              failure_type, ship_to, ship_city, ship_state)
values (:'a', :'d4_round_id', :'d4_other_idea', 'zinc_wallet', 1800, 100, 'failed', 'out_of_stock', 'recipient', 'Dayton', 'OH');
select tests.act_as_server();
select throws_ok(tests.df_sql(:'d4_round_id', :'a', :'d4_lock', :'d4_failed_order'),
  'P0001', 'drop_failed_order: other gifts', 'refused while another gift in the round is still in play');
select tests.reset_role();

-- ─── skip_failed_round ───────────────────────────────────────────────────────
create function tests.sk_sql(p_round uuid, p_user uuid, p_lock timestamptz)
returns text language sql as $$
  select format($q$select concierge.skip_failed_round(%L, %L, %L)$q$, p_round, p_user, p_lock);
$$;
grant execute on function tests.sk_sql(uuid, uuid, timestamptz) to service_role;

-- An untold failure (no email yet), skipped from its page.
select * from tests.df_round(:'a', :'p_pat', 'out_of_stock') \gset s1_
select ok(exists (select 1 from concierge.untold_failures(:'s1_round_id') x where x = :'s1_failed_order'),
  'the fixture failure is untold');
select tests.act_as_server();
select is(concierge.skip_failed_round(:'s1_round_id', :'a', :'s1_lock')::text, 'skipped', 'the server skips a round whose only gift failed');
select tests.reset_role();
select is(
  (select array[r.status::text, (r.closed_at is not null)::text, o.resolved::text, o.failed_after_close::text]
     from concierge.gift_rounds r join concierge.orders o on o.id = :'s1_failed_order' where r.id = :'s1_round_id'),
  array['skipped', 'true', 'true', 'false'],
  'skipped and closed, the failure resolved and not handed to the late email');
select ok(not exists (select 1 from concierge.rounds_missing_late_failure_email() x where x = :'s1_round_id')
          and exists (select 1 from concierge.round_sends where round_id = :'s1_round_id' and step = 'fail:' || :'s1_failed_order'),
  'the skipped failure counts as told, so the late-email sweep leaves it alone');

-- Refusals: no lease, not waiting on a fix, a gift held or bought (refunded included).
select * from tests.df_round(:'a', :'p_pat', 'out_of_stock') \gset s2_
select tests.act_as_server();
select throws_ok(tests.sk_sql(:'s2_round_id', :'a', now() + interval '1 hour'),
  'P0001', 'skip_failed_round: lease not held', 'skip refused without the round''s lease');
select throws_ok(tests.sk_sql(:'d2_round_id', :'a', :'d2_lock'),
  'P0001', 'skip_failed_round: not open', 'skip refused on a round back to choosing');
select tests.reset_role();
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                              ship_to, ship_city, ship_state)
values (:'a', :'s2_round_id', :'s2_other_idea', 'zinc_wallet', 1800, 100, 'held', 'retry', 'recipient', 'Dayton', 'OH')
returning id as s2_held \gset
select tests.act_as_server();
select throws_ok(tests.sk_sql(:'s2_round_id', :'a', :'s2_lock'),
  'P0001', 'skip_failed_round: on its way', 'skip refused with a gift held to buy');
select tests.reset_role();
select is((select array[r.status::text, (r.closed_at is null)::text, o.status::text]
             from concierge.gift_rounds r join concierge.orders o on o.id = :'s2_held' where r.id = :'s2_round_id'),
  array['needs_attention', 'true', 'held'], '... and the held gift and the round are untouched');
update concierge.orders set status = 'refunded' where id = :'s2_held';
select tests.act_as_server();
select throws_ok(tests.sk_sql(:'s2_round_id', :'a', :'s2_lock'),
  'P0001', 'skip_failed_round: on its way', 'skip refused with a refunded gift, which counts as bought');
select tests.reset_role();

-- Server only.
select ok(not has_function_privilege('authenticated', 'concierge.drop_failed_order(uuid, uuid, timestamptz, uuid)', 'execute')
          and not has_function_privilege('anon', 'concierge.drop_failed_order(uuid, uuid, timestamptz, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'concierge.skip_failed_round(uuid, uuid, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'concierge.skip_failed_round(uuid, uuid, timestamptz)', 'execute'),
  'signed-in users and visitors can''t call drop_failed_order or skip_failed_round');

select * from finish();
rollback;
