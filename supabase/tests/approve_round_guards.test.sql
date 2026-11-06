-- approve_round's last-moment guards (ALL-32 final review S5, N6):
-- a friend's claim on a list gift that lands after approve_round's check
-- (claim_for_order returns false) refuses the approval instead of buying a
-- second copy; and a round on or after its ship-by deadline can't be approved.
begin;
\ir _helpers.psql
select plan(6);

select tests.create_user('buyer@example.com') as a \gset
select tests.create_user('friend@example.com') as b \gset

insert into lists.lists (owner_id, title) values (:'b', 'Wish list') returning id as list_id \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 0, 'Vase', 4000) returning id as item \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list_id', 1, 'Lamp', 3000) returning id as item2 \gset

create function tests.ag_round(p_user uuid, p_deadline date)
returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at, locked_until)
  values (p_user, v_person, v_occasion, 2030, p_deadline + 7, p_deadline, 5000, 'awaiting_approval', now(),
          now() + interval '10 minutes')
  returning id into v_round;
  return v_round;
end $$;

create function tests.ag_idea(p_round uuid, p_item uuid)
returns uuid language sql as $$
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source, list_item_id)
  select r.user_id, r.id, 'Vase', 4000, 4500, 1, case when p_item is null then 'generated' else 'list' end, p_item
    from concierge.gift_rounds r where r.id = p_round
  returning id;
$$;

create function tests.ag_orders(p_idea uuid)
returns jsonb language sql as $$
  select format('[{"idea_id": "%s", "max_price_cents": 4500, "fee_cents": 100, "ship_to": "recipient",
                   "address": {"recipient_first_name": "Mary", "recipient_last_name": "Allen", "address_line1": "12 Oak St",
                               "city": "Dayton", "state": "OH", "zip": "45402", "country": "US"}}]', p_idea)::jsonb;
$$;

-- The friend's claim lands after approve_round's check and before its own
-- claim, the way a concurrent claim from another connection would: a trigger
-- on the idea's move to 'selected', which approve_round writes in between.
create function tests.ag_friend_claims() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'selected' and new.list_item_id is not null then
    insert into lists.gift_claims (item_id, claimer_id, claimer_name)
    values (new.list_item_id, (select owner_id from lists.lists l join lists.list_items i on i.list_id = l.id where i.id = new.list_item_id), 'Friend')
    on conflict (item_id) do nothing;
  end if;
  return new;
end $$;
create trigger ag_friend_claims after update on concierge.gift_ideas
  for each row execute function tests.ag_friend_claims();

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- S5: the friend's claim wins the race.
select tests.ag_round(:'a', current_date + 30) as r1 \gset
select tests.ag_idea(:'r1', :'item') as r1_idea \gset
select locked_until as r1_lock from concierge.gift_rounds where id = :'r1' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r1', :'a', :'r1_lock', tests.ag_orders(:'r1_idea')),
  'P0001', 'approve_round: claimed', 'a friend''s claim that lands mid-approval refuses the approval');
select tests.reset_role();
select is((select count(*)::int from concierge.orders where round_id = :'r1'), 0, '... and no order is written');

drop trigger ag_friend_claims on concierge.gift_ideas;

-- The buyer's own claim on the item (an earlier order of theirs) still approves.
insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order) values (:'item2', :'a', 'Buyer', true);
select tests.ag_round(:'a', current_date + 30) as r2 \gset
select tests.ag_idea(:'r2', :'item2') as r2_idea \gset
select locked_until as r2_lock from concierge.gift_rounds where id = :'r2' \gset
select tests.act_as_server();
select is((select count(*)::int from concierge.approve_round(:'r2', :'a', :'r2_lock', tests.ag_orders(:'r2_idea'))), 1,
  'the buyer''s own claim doesn''t refuse the approval');
select tests.reset_role();

-- N6: on or after the ship-by deadline (the engine's UTC day), no approval.
select tests.ag_round(:'a', (now() at time zone 'utc')::date) as r3 \gset
select tests.ag_idea(:'r3', null) as r3_idea \gset
select locked_until as r3_lock from concierge.gift_rounds where id = :'r3' \gset
select tests.ag_round(:'a', (now() at time zone 'utc')::date + 1) as r4 \gset
select tests.ag_idea(:'r4', null) as r4_idea \gset
select locked_until as r4_lock from concierge.gift_rounds where id = :'r4' \gset
select tests.act_as_server();
select throws_ok(
  format($q$select * from concierge.approve_round(%L, %L, %L, %L)$q$, :'r3', :'a', :'r3_lock', tests.ag_orders(:'r3_idea')),
  'P0001', 'approve_round: past the ship-by deadline', 'a round on its deadline day can''t be approved');
select is((select count(*)::int from concierge.approve_round(:'r4', :'a', :'r4_lock', tests.ag_orders(:'r4_idea'))), 1,
  'the day before the deadline still approves');
select tests.reset_role();
select is((select count(*)::int from concierge.orders where round_id = :'r3'), 0, 'no order on the deadline-day round');

select * from finish();
rollback;
