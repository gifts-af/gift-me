-- Launch step 1 (planning 66): only the owner's account moves to paying by card, and only
-- when nothing of theirs is still on the wallet path. Everyone else, and the column default,
-- stays on the wallet. The switch is concierge.switch_account_to_card, which the launch
-- migration calls once; here it is called against made-up accounts.
begin;
\ir _helpers.psql
select plan(12);

create function tests.lo_account(p_email text, p_connected boolean default false)
returns uuid language plpgsql as $$
declare v uuid := tests.create_user(p_email);
begin
  insert into concierge.accounts (user_id, paid_features, buyer_phone, zinc_connected_at)
  values (v, true, '5555550100', case when p_connected then now() end);
  return v;
end $$;

-- A wallet order of the given status on a fresh round for the user.
create function tests.lo_order(p_user uuid, p_status text, p_resolved boolean default false)
returns void language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid; v_idea uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline,
                                     budget_cents, status, next_action_at)
  values (p_user, v_person, v_occasion, 2030, current_date + 37, current_date + 30, 5000, 'ordered', now())
  returning id into v_round;
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, status)
  values (p_user, v_round, 'Loaf pan', 2000, 2100, 1, 'selected') returning id into v_idea;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason,
                                failure_type, resolved, ship_to, ship_city, ship_state)
  values (p_user, v_round, v_idea, 'zinc_wallet', 2100, 100, p_status,
          case when p_status = 'held' then 'retry' end,
          case when p_status = 'failed' then 'failed' end, p_resolved, 'recipient', 'Dayton', 'OH');
end $$;

create function tests.lo_mode(p_user uuid)
returns text language sql as $$ select funding_mode from concierge.accounts where user_id = p_user; $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Ready: disconnected, its wallet gift delivered.
select tests.lo_account('owner-ready@example.com') as ready \gset
select tests.lo_order(:'ready', 'delivered');
select tests.lo_account('someone-else@example.com') as other \gset

select is(concierge.switch_account_to_card('owner-ready@example.com'), 'switched', 'a ready owner account is switched');
select is(tests.lo_mode(:'ready'), 'connect', 'and pays by card');
select is(tests.lo_mode(:'other'), 'zinc_wallet', 'nobody else is switched');
select is((select column_default from information_schema.columns
            where table_schema = 'concierge' and table_name = 'accounts' and column_name = 'funding_mode'),
          '''zinc_wallet''::text', 'new accounts still start on the wallet');
select is(concierge.switch_account_to_card('owner-ready@example.com'), 'already', 'running it again changes nothing');

-- Each thing that keeps the owner on the wallet.
select tests.lo_account('owner-connected@example.com', true) as c \gset
select is(concierge.switch_account_to_card('owner-connected@example.com'), 'still_connected', 'still connected to Zinc: not switched');
select is(tests.lo_mode(:'c'), 'zinc_wallet', 'and stays on the wallet');

select tests.lo_account('owner-held@example.com') as h \gset
select tests.lo_order(:'h', 'held');
select is(concierge.switch_account_to_card('owner-held@example.com'), 'wallet_order_open', 'a held wallet gift: not switched');

select tests.lo_account('owner-placing@example.com') as p \gset
select tests.lo_order(:'p', 'unconfirmed');
select is(concierge.switch_account_to_card('owner-placing@example.com'), 'wallet_order_open', 'an unconfirmed wallet gift: not switched');

select tests.lo_account('owner-failed@example.com') as f \gset
select tests.lo_order(:'f', 'failed');
select is(concierge.switch_account_to_card('owner-failed@example.com'), 'wallet_order_open', 'an unresolved wallet failure: not switched');

select is(concierge.switch_account_to_card('nobody@example.com'), 'no_account', 'no such account: nothing happens');

select tests.act_as(:'other');
select throws_ok($$select concierge.switch_account_to_card('someone-else@example.com')$$, '42501', null, 'a signed-in user can''t call it');
select tests.reset_role();

select * from finish();
rollback;
