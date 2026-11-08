-- Every failed gift is told, once, and closing never hides one (ALL-116).
begin;
\ir _helpers.psql
select plan(29);

select tests.create_user('everyfail@example.com') as u \gset
insert into public.people (user_id, name, relationship) values (:'u', 'P', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset

-- A round with n ideas and one held order each; returns the round id.
create function tests.ef_round(p_user uuid, p_person uuid, p_occasion uuid, p_year integer, p_n integer)
returns uuid language plpgsql as $$
declare
  v_round uuid;
  v_idea uuid;
begin
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
  values (p_user, p_person, p_occasion, p_year, current_date + 37, current_date + 30, 9000, 'needs_attention', now() + interval '5 days')
  returning id into v_round;
  for i in 1..p_n loop
    insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
    values (p_user, v_round, 'Gift ' || i, 4000, 4500, i) returning id into v_idea;
    insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
    values (p_user, v_round, v_idea, 'zinc_wallet', 4500, 100, 'held', 'retry', 'recipient', 'Dayton', 'OH');
  end loop;
  return v_round;
end;
$$;
create function tests.ef_order(p_round uuid, p_rank integer) returns uuid language sql as $$
  select o.id from concierge.orders o join concierge.gift_ideas i on i.id = o.idea_id
   where o.round_id = p_round and i.rank = p_rank order by o.created_at desc limit 1;
$$;
create function tests.ef_untold(p_round uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(x), '{}') from concierge.untold_failures(p_round) x;
$$;
grant execute on all functions in schema tests to service_role;

select tests.act_as_server();

-- ─── failed_at ───
select tests.ef_round(:'u', :'p', :'o', 2030, 3) as r \gset
select tests.ef_order(:'r', 1) as a \gset
select tests.ef_order(:'r', 2) as b \gset
select tests.ef_order(:'r', 3) as c \gset
select concierge.fail_order(:'a', 'price_up');
select isnt((select failed_at from concierge.orders where id = :'a'), null, 'a failure sets failed_at');
select failed_at as a_at from concierge.orders where id = :'a' \gset
update concierge.orders set ship_city = '' where id = :'a';
select is((select failed_at from concierge.orders where id = :'a'), :'a_at'::timestamptz, 'later updates never move failed_at');

-- ─── untold, and the round's reason (held ranks above failed) ───
select concierge.fail_order(:'b', 'out_of_stock');
select is(tests.ef_untold(:'r'), array[:'a', :'b']::uuid[], 'both failures are untold, oldest first');
select is((select attention_reason from concierge.gift_rounds where id = :'r'), 'retry', 'a held gift decides the reason, not a failure');
select ok((select next_action_at <= now() from concierge.gift_rounds where id = :'r'), 'due now while a failure is untold, whatever the reason');

-- ─── claim and release, under the round's lock ───
select is((select array_agg(x) from concierge.claim_failure_notices(:'r') x), array[:'a', :'b']::uuid[], 'claim returns the untold failures');
select ok(exists (select 1 from concierge.round_sends where round_id = :'r' and step = 'fail:' || :'a')
      and exists (select 1 from concierge.round_sends where round_id = :'r' and step = 'fail:' || :'b'), 'and records fail:<id> for each');
select is((select count(*)::int from concierge.claim_failure_notices(:'r')), 0, 'a second claim gets nothing');
select is(tests.ef_untold(:'r'), '{}'::uuid[], 'nothing is untold once claimed');
select concierge.reconcile_round(:'r');
select is((select next_action_at from concierge.gift_rounds where id = :'r'),
          ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc', 'tomorrow once told');

select concierge.release_failure_notices(:'r', array[:'b']::uuid[]);
select is(tests.ef_untold(:'r'), array[:'b']::uuid[], 'a refused email gives back only its own keys');
select is((select failed_after_close from concierge.orders where id = :'b'), false, 'an open round leaves it to the round');

-- ─── any close hands untold failures to the late email ───
select is(concierge.cancel_held(:'r', 'deadline')::text, 'skipped', 'the deadline closes the round');
select is((select failed_after_close from concierge.orders where id = :'b'), true, 'the untold failure goes to the late email');
select is((select failed_after_close from concierge.orders where id = :'a'), false, 'the told one doesn''t');
select is((select count(*)::int from concierge.claim_failure_notices(:'r')), 0, 'a closed round claims nothing');

-- ─── release after a close: the late email tells it ───
select tests.ef_round(:'u', :'p', :'o', 2031, 2) as r2 \gset
select tests.ef_order(:'r2', 1) as d \gset
select concierge.fail_order(:'d', 'too_late');
select x as claimed from concierge.claim_failure_notices(:'r2') x \gset
select concierge.cancel_held(:'r2', 'cancel');
select is((select failed_after_close from concierge.orders where id = :'d'), false, 'claimed before the close, so the close leaves it');
select concierge.release_failure_notices(:'r2', array[:'d']::uuid[]);
select is((select failed_after_close from concierge.orders where id = :'d'), true, 'refused after the close: the late email tells it');
select ok(not exists (select 1 from concierge.round_sends where round_id = :'r2' and step = 'fail:' || :'d'), 'and its key is gone');

-- ─── skip_open_rounds (person deleted, occasion off) ───
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'valentines_day') returning id as o3 \gset
select tests.ef_round(:'u', :'p', :'o3', 2030, 2) as r3 \gset
select tests.ef_order(:'r3', 1) as e \gset
select concierge.fail_order(:'e', 'failed');
select concierge.skip_open_rounds(null, :'o3');
select is((select failed_after_close from concierge.orders where id = :'e'), true, 'turning the occasion off hands it to the late email');

-- ─── next to an unconfirmed order ───
select tests.ef_round(:'u', :'p', :'o', 2032, 2) as r4 \gset
select tests.ef_order(:'r4', 1) as f \gset
select tests.ef_order(:'r4', 2) as g \gset
update concierge.orders set status = 'unconfirmed', hold_reason = null where id = :'f';
insert into concierge.round_sends (round_id, user_id, step) values (:'r4', :'u', 'hold:1:notice');
update concierge.gift_rounds set hold_count = 1, last_emailed_reason = 'unconfirmed', attention_reason = 'unconfirmed' where id = :'r4';
select concierge.fail_order(:'g', 'out_of_stock');
select is((select attention_reason from concierge.gift_rounds where id = :'r4'), 'unconfirmed', 'unconfirmed still decides the reason');
select ok((select next_action_at <= now() from concierge.gift_rounds where id = :'r4'), 'but the untold failure is due now');

-- ─── older code's keys ───
select tests.ef_round(:'u', :'p', :'o', 2033, 2) as r5 \gset
select tests.ef_order(:'r5', 1) as h \gset
select tests.ef_order(:'r5', 2) as k \gset
select concierge.fail_order(:'h', 'price_up');
insert into concierge.round_sends (round_id, user_id, step, created_at) values (:'r5', :'u', 'fail:1:notice', clock_timestamp());
select is(tests.ef_untold(:'r5'), '{}'::uuid[], 'an older-style email sent after it failed counts as telling it');
select concierge.fail_order(:'k', 'out_of_stock');
select is(tests.ef_untold(:'r5'), array[:'k']::uuid[], 'a failure after that email is still untold');

-- ─── a hold next to a failure is still a new hold to tell (plan review B1) ───
select tests.ef_round(:'u', :'p', :'o', 2036, 2) as r8 \gset
select concierge.fail_order(tests.ef_order(:'r8', 1), 'price_up');
select concierge.hold_orders(:'r8', 'funds');
select is((select attention_reason || '/' || hold_count from concierge.gift_rounds where id = :'r8'), 'funds/1',
          'a funds hold next to a told-or-not failure becomes the reason, a new hold (hold_count 1)');
select ok((select next_action_at <= now() from concierge.gift_rounds where id = :'r8'), 'and its notice is due now');

-- ─── a failure written directly gets failed_at too (the trigger) ───
select tests.ef_round(:'u', :'p', :'o', 2035, 1) as r7 \gset
update concierge.orders set status = 'failed', failure_type = 'failed', hold_reason = null where round_id = :'r7';
select isnt((select failed_at from concierge.orders where round_id = :'r7'), null, 'a failure written directly gets failed_at');

-- ─── a bad address isn't a failure to tell ───
select tests.ef_round(:'u', :'p', :'o', 2034, 1) as r6 \gset
select concierge.fail_order(tests.ef_order(:'r6', 1), 'invalid_shipping_address');
select is(tests.ef_untold(:'r6'), '{}'::uuid[], 'a bad address is held for a new one, not told as a failure');
select tests.reset_role();

select ok(not has_function_privilege('authenticated', 'concierge.claim_failure_notices(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'concierge.release_failure_notices(uuid, uuid[])', 'execute')
      and not has_function_privilege('authenticated', 'concierge.untold_failures(uuid)', 'execute'), 'server only');

select * from finish();
rollback;
