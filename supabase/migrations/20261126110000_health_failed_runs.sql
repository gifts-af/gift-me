-- The health snapshot also counts idea runs that failed in the last day (ALL-35), so ideas can't
-- fail with no word to the owner. Same signature and grants; everything else is unchanged.
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
       where outcome = 'no_credit' and started_at >= p_now - interval '1 day' and started_at <= p_now),

    -- New (ALL-35): the heartbeat doesn't count a failed idea run, so it's counted here.
    'failed_runs', (
      select count(*) from concierge.idea_runs
       where outcome = 'failed' and started_at >= p_now - interval '1 day' and started_at <= p_now),

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

    'weekly', (
      select jsonb_build_object(
        'waiting_address', count(*) filter (where r.status = 'needs_address'
                                               or (r.status = 'needs_attention' and r.attention_reason = 'address')),
        'waiting_funds', count(*) filter (where r.status = 'needs_attention' and r.attention_reason = 'funds'),
        'waiting_setup', count(*) filter (where r.status = 'needs_attention' and r.attention_reason = 'setup'),
        'waiting_approval', count(*) filter (where r.status = 'awaiting_approval'),
        'no_ideas', (
          select count(*) from concierge.gift_rounds s
           where s.status = 'skipped' and s.updated_at >= p_now - interval '7 days' and s.updated_at <= p_now
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
