-- Card payments: an account refusal's key, and the health email (planning 59 and 61).
-- Expand-only (E7).
--
-- record_outcomes, copied from 20261130120000_card_payments.sql, takes a new outcome,
-- paused: a card order our own Zinc account refused (card_verification_required,
-- stripe_error and the other account codes) is held paused with a fresh idempotency key,
-- as a funds 402 is for a wallet order. Before, it was held on its old key, so once the
-- account was fixed Zinc could answer the retry with the refusal it had stored.
--
-- health_snapshot, copied from 20261127120000_moved_dates.sql, lists the card orders
-- charged over their approved maximum in the last day, for the owner's health email.
--
-- Left as it is: store_cancel_order. A card order the store cancels after settling keeps
-- its zinc_order_fee and card_fee cost rows (cost_events is insert-only). What Zinc
-- refunds on a cancel isn't known until a real one happens (assumption A5, runbook
-- design/operations.md > Card payments > After a store cancel), so the costs stay as
-- recorded until then rather than guessing which of them come back.
--
-- Only the lines marked New differ from the copied definitions. Same signatures, so
-- create or replace keeps their grants.


-- ─── record_outcomes ───────────────────────────────────────────────────────────
create or replace function concierge.record_outcomes(p_round_id uuid, p_results jsonb)
returns concierge.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_el jsonb;
  v_order concierge.orders;
  v_closed boolean;
begin
  select closed_at is not null into v_closed from concierge.gift_rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;

  -- declines first, so a sibling left unsent sees the card already cleared.
  for v_el in select e from jsonb_array_elements(p_results) e
               order by (e ->> 'failure_type') is not distinct from 'card_declined' desc loop
    select * into v_order from concierge.orders
     where id = (v_el ->> 'order_id')::uuid and round_id = p_round_id and status = 'placing'
       for update;
    continue when not found;

    case v_el ->> 'outcome'
      when 'sent' then
        update concierge.orders
           set provider_order_id = coalesce(v_el ->> 'provider_order_id', provider_order_id)
         where id = v_order.id;
      when 'insufficient', 'unsent' then
        if v_closed then
          -- Nothing was bought, and the round was cancelled or closed meanwhile:
          -- the order is never held again.
          update concierge.orders set status = 'cancelled', failure_type = 'round_closed' where id = v_order.id;
          continue;
        end if;
        -- a card order is never held for funds. A 402 there is the app's mistake, so
        -- the order ends with nothing bought rather than undoing the rest of the batch.
        if v_el ->> 'outcome' = 'insufficient' and v_order.funding_mode = 'connect' then
          perform concierge.fail_order_row(v_order, 'failed');
          continue;
        end if;
        -- an unsent card order whose card is no longer the saved one is never sent on it.
        if v_el ->> 'outcome' = 'unsent' and v_order.funding_mode = 'connect'
           and v_order.payment_method_id is distinct from
               (select a.stripe_payment_method_id from concierge.accounts a where a.user_id = v_order.user_id) then
          perform concierge.fail_order_row(v_order, 'card_needed');
          continue;
        end if;
        if v_el ->> 'outcome' = 'unsent' then
          -- Never POSTed, so it keeps its key.
          update concierge.orders set status = 'held', hold_reason = 'retry' where id = v_order.id;
          continue;
        end if;
        -- A 402 created nothing at Zinc, so a fresh key keeps a cached 402 from blocking the retry.
        update concierge.orders
           set status = 'held', hold_reason = 'funds', idempotency_key = gen_random_uuid()
         where id = v_order.id;
        if v_el ? 'available_cents' then
          update concierge.gift_rounds set seen_balance_cents = (v_el ->> 'available_cents')::integer where id = p_round_id;
        end if;
      -- New: our own Zinc account refused a card order (an account code). It's held paused
      -- for the owner, with a fresh key: the refusal created nothing at Zinc, and Zinc could
      -- answer a retry on the old key with its stored refusal once the account is fixed.
      when 'paused' then
        if v_closed then
          update concierge.orders set status = 'cancelled', failure_type = 'round_closed' where id = v_order.id;
          continue;
        end if;
        update concierge.orders
           set status = 'held', hold_reason = 'paused', idempotency_key = gen_random_uuid()
         where id = v_order.id;
      when 'rejected' then
        perform concierge.fail_order_row(v_order, coalesce(v_el ->> 'failure_type', 'failed'));
      when 'unknown' then
        null; -- Timed out: it may exist at Zinc. Stays placing until the sweep looks it up.
      else
        raise exception 'Unknown outcome %', v_el ->> 'outcome' using errcode = '22023';
    end case;
  end loop;

  return concierge.reconcile_round(p_round_id);
end;
$$;



-- ─── health_snapshot ───────────────────────────────────────────────────────────
create or replace function concierge.health_snapshot(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max_attempts integer := concierge.setting_int('round_max_attempts');
  v_stale_minutes integer := concierge.setting_int('placing_stale_minutes');
  v_final_days integer := concierge.setting_int('hold_final_days');
  v_today date := (p_now at time zone 'utc')::date;
  v_tick concierge.tick_heartbeats;
begin
  -- No fallback value (T23): a missing setting fails the check loudly.
  if v_max_attempts is null or v_stale_minutes is null or v_final_days is null then
    raise exception 'health_snapshot: missing setting';
  end if;

  select * into v_tick from concierge.tick_heartbeats where day = v_today;

  return jsonb_build_object(
    'tick', jsonb_build_object(
      'last_ok_finished_at', (
        select max(finished_at) from concierge.tick_heartbeats where result = 'ok' and finished_at <= p_now),
      'today', case when v_tick.day is null then null else jsonb_build_object(
        'started_at', v_tick.started_at, 'finished_at', v_tick.finished_at, 'result', v_tick.result,
        'rounds_failed', v_tick.rounds_failed, 'fanout_failed', v_tick.fanout_failed) end),

    'no_credit_runs', (
      select count(*) from concierge.idea_runs
       where outcome = 'no_credit' and finished_at >= p_now - interval '25 hours' and finished_at <= p_now),

    -- The heartbeat doesn't count a failed idea run, so it's counted here.
    'failed_runs', (
      select count(*) from concierge.idea_runs
       where outcome = 'failed' and finished_at >= p_now - interval '25 hours' and finished_at <= p_now),

    -- >= here while the engine's round_stuck uses >: the engine counts the
    -- claim it is making, and this reads the stored attempts between ticks, so
    -- both mean the same number of failed claims. A round waiting on an
    -- unconfirmed order is listed under unconfirmed instead.
    'stuck_rounds', coalesce((
      select jsonb_agg(jsonb_build_object('round_id', r.id, 'user_id', r.user_id, 'attempts', r.attempts)
                       order by r.ship_by_deadline, r.id)
        from concierge.gift_rounds r
       where r.closed_at is null and r.status not in ('skipped', 'complete', 'delivered')
         and r.attempts >= v_max_attempts
         and not (r.status = 'needs_attention' and r.attention_reason is not distinct from 'unconfirmed')), '[]'),

    'unconfirmed', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'round_id', o.round_id, 'user_id', o.user_id)
                       order by o.created_at, o.id)
        from concierge.orders o
       where o.status = 'unconfirmed'), '[]'),

    -- An order today's tick placed may still be in flight, so only one from
    -- before the tick started counts (any, if it hasn't started). Aged by
    -- updated_at, as the placing sweep is: a held order is moved to placing
    -- by an update, so its created_at can be days older than its placing.
    'placing_stale', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'round_id', o.round_id, 'user_id', o.user_id)
                       order by o.updated_at, o.id)
        from concierge.orders o
       where o.status = 'placing'
         and (v_tick.day is null or o.updated_at < v_tick.started_at)
         and o.updated_at < p_now - make_interval(mins => v_stale_minutes)), '[]'),

    -- Holds only Zinc can explain; funds, setup, address and paused wait on the user.
    'held_zinc', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'round_id', o.round_id, 'user_id', o.user_id,
                                          'hold_reason', o.hold_reason)
                       order by o.created_at, o.id)
        from concierge.orders o
       where o.status = 'held' and o.hold_reason in ('retry', 'not_allowed')), '[]'),

    'deadline_close', coalesce((
      select jsonb_agg(jsonb_build_object('round_id', r.id, 'user_id', r.user_id,
                                          'reason', case when r.status = 'needs_address' then 'address' else r.attention_reason end,
                                          'ship_by_deadline', r.ship_by_deadline)
                       order by r.ship_by_deadline, r.id)
        from concierge.gift_rounds r
       where r.closed_at is null and r.status not in ('skipped', 'complete', 'delivered')
         and (r.status = 'needs_address'
              or (r.status = 'needs_attention' and r.attention_reason in ('funds', 'setup', 'address')))
         and r.ship_by_deadline <= v_today + v_final_days), '[]'),

    'ideas_waiting', coalesce((
      select jsonb_agg(jsonb_build_object('round_id', r.id, 'user_id', r.user_id, 'ship_by_deadline', r.ship_by_deadline)
                       order by r.ship_by_deadline, r.id)
        from concierge.gift_rounds r
       where r.closed_at is null
         and r.status in ('scheduled', 'generating')
         and not exists (select 1 from concierge.gift_ideas i where i.round_id = r.id and i.status <> 'rejected')
         and r.ship_by_deadline <= v_today + v_final_days), '[]'),

    -- New: card orders charged more than the "Most you'll pay" shown at approval, once each:
    -- placed within the last day, like the idea-run counts. order.over_max_charge alerts at
    -- the time; this is the daily list (design/operations.md > Alerts).
    'over_max_charge', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'round_id', o.round_id, 'user_id', o.user_id,
                                          'charge_cents', o.final_charge_cents, 'max_charge_cents', o.max_charge_cents)
                       order by o.placed_at, o.id)
        from concierge.orders o
       where o.funding_mode = 'connect'
         and o.final_charge_cents > o.max_charge_cents
         and o.placed_at > p_now - interval '25 hours' and o.placed_at <= p_now), '[]'),

    'weekly', (
      select jsonb_build_object(
        'waiting_address', count(*) filter (where r.status = 'needs_address'
                                               or (r.status = 'needs_attention' and r.attention_reason = 'address')),
        'waiting_funds', count(*) filter (where r.status = 'needs_attention' and r.attention_reason = 'funds'),
        'waiting_setup', count(*) filter (where r.status = 'needs_attention' and r.attention_reason = 'setup'),
        'waiting_approval', count(*) filter (where r.status = 'awaiting_approval'),
        'no_ideas', (
          select count(*) from concierge.gift_rounds s
           -- not a round a date change ended (no year): nobody was left without ideas.
           where s.status = 'skipped' and s.occasion_year is not null and s.updated_at >= p_now - interval '7 days' and s.updated_at <= p_now
             and exists (select 1 from concierge.round_sends rs where rs.round_id = s.id and rs.step ~ '^no_ideas')),
        'rounds_failed', (
          select coalesce(sum(h.rounds_failed), 0) from concierge.tick_heartbeats h
           where h.day > v_today - 7 and h.day <= v_today),
        'failed_captures', (
          select count(*) from concierge.captures c
           where c.status = 'failed' and c.updated_at >= p_now - interval '7 days' and c.updated_at <= p_now))
        from concierge.gift_rounds r
       where r.closed_at is null and r.status not in ('skipped', 'complete', 'delivered')));
end;
$$;

