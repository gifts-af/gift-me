-- The owner health email. Expand-only (E7): a new table, functions, settings
-- and run outcome; round_idea_state and runs_after_rejection keep their
-- signatures and only stop counting no_credit runs.
--
-- The daily tick writes one heartbeat row per UTC day, so the health check can
-- tell whether yesterday's tick finished and how many rounds failed in it.
-- An idea run that ended because the AI credit ran out (no_credit) bought no
-- reply, so it must not use up the round's runs.

-- ─── tick_heartbeats ─────────────────────────────────────────────────────────
create table concierge.tick_heartbeats (
  day date primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  result text check (result in ('ok', 'failed')),
  rounds_failed integer not null default 0 check (rounds_failed >= 0),
  fanout_failed integer not null default 0 check (fanout_failed >= 0)
);
comment on table concierge.tick_heartbeats is
  'One row per daily tick (UTC day): when it started and finished, and how many rounds and fan-out steps failed. Counts and times only, no personal data.';

-- Server only: RLS on with no policies, and only the service role has rights.
alter table concierge.tick_heartbeats enable row level security;
revoke all on concierge.tick_heartbeats from public, anon, authenticated;
grant select, insert, update on concierge.tick_heartbeats to service_role;

-- ─── settings ────────────────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('health_email_enabled', '1', 'Switch for the owner''s daily health email: 1 sends it, 0 is off.'),
  ('health_all_clear_weekday', '1', 'The weekday the health email is sent even when all is well, as Date.getUTCDay() numbers it (0 is Sunday, 1 is Monday). Other days it is sent only when something needs attention.'),
  ('ai_credit_low_cents', '500', 'The health email warns when the AI Gateway credit is below this many cents, before ideas pause for lack of credit.'),
  ('zinc_app_balance_low_cents', '500', 'The health email warns when the Zinc app balance is below this many cents.'),
  ('health_vendor_timeout_ms', '10000', 'How long the daily health check waits for each vendor balance (AI Gateway credit, Zinc app wallet), in milliseconds. Kept well under the health route''s 60 s limit so a hung vendor can''t stop the email.')
on conflict (key) do nothing;

-- ─── start_tick, finish_tick, add_tick_counts ────────────────────────────────
-- The counts belong to the latest run of the day and the jobs it starts, so a
-- re-run the same day starts them again from nothing.
create function concierge.start_tick(p_day date, p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into concierge.tick_heartbeats (day, started_at) values (p_day, p_at)
  on conflict (day) do update
    set started_at = excluded.started_at,
        finished_at = null,
        result = null,
        rounds_failed = 0,
        fanout_failed = 0;
$$;

-- rounds_failed is added, not set: the round jobs may have added theirs first.
-- A missing row (start_tick's write failed) is created rather than lost.
create function concierge.finish_tick(p_day date, p_at timestamptz, p_result text, p_rounds_failed integer, p_fanout_failed integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into concierge.tick_heartbeats (day, started_at, finished_at, result, rounds_failed, fanout_failed)
  values (p_day, p_at, p_at, p_result, p_rounds_failed, p_fanout_failed)
  on conflict (day) do update
    set finished_at = excluded.finished_at,
        result = excluded.result,
        rounds_failed = concierge.tick_heartbeats.rounds_failed + excluded.rounds_failed,
        fanout_failed = excluded.fanout_failed;
$$;

-- For the round jobs. One statement, so jobs finishing together don't lose a count.
create function concierge.add_tick_counts(p_day date, p_at timestamptz, p_rounds_failed integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into concierge.tick_heartbeats (day, started_at, rounds_failed) values (p_day, p_at, p_rounds_failed)
  on conflict (day) do update
    set rounds_failed = concierge.tick_heartbeats.rounds_failed + excluded.rounds_failed;
$$;

revoke all on function concierge.start_tick(date, timestamptz) from public, anon, authenticated;
revoke all on function concierge.finish_tick(date, timestamptz, text, integer, integer) from public, anon, authenticated;
revoke all on function concierge.add_tick_counts(date, timestamptz, integer) from public, anon, authenticated;
grant execute on function concierge.start_tick(date, timestamptz) to service_role;
grant execute on function concierge.finish_tick(date, timestamptz, text, integer, integer) to service_role;
grant execute on function concierge.add_tick_counts(date, timestamptz, integer) to service_role;

-- ─── idea_runs: the no_credit outcome ────────────────────────────────────────
alter table concierge.idea_runs drop constraint idea_runs_outcome_check;
alter table concierge.idea_runs add constraint idea_runs_outcome_check
  check (outcome in ('saved', 'none', 'failed', 'cost_cap', 'deadline', 'no_credit'));

-- ─── round_idea_state ────────────────────────────────────────────────────────
-- As before, except a no_credit run counts toward neither the runs nor the
-- last start, so a fact added before it still earns the extra run. A failed
-- run still counts: it may have paid for an AI reply. start_idea_run's
-- idea_round_runs_per_day still counts no_credit runs, as an app-wide spend guard.
create or replace function concierge.round_idea_state(p_round_id uuid)
returns table (has_facts boolean, runs_left boolean, paid boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from concierge.profile_facts f
             where f.person_id = r.person_id and f.user_id = r.user_id and f.active),
    -- A missing setting means no runs left: refuse, never allow.
    case
      when concierge.setting_int('idea_round_runs_max') is null then false
      when n.runs >= concierge.setting_int('idea_round_runs_max') + 1 then false
      when n.runs >= concierge.setting_int('idea_round_runs_max') then exists (
        select 1 from concierge.profile_facts f
         where f.person_id = r.person_id and f.user_id = r.user_id and f.active
           and f.updated_at > n.last_started)
      else true
    end,
    concierge.has_paid_features(r.user_id)
  from concierge.gift_rounds r
  cross join lateral (
    select count(*) as runs, max(u.started_at) as last_started
      from concierge.idea_runs u
     where u.round_id = r.id and u.outcome is distinct from 'no_credit'
  ) n
  where r.id = p_round_id;
$$;

-- ─── runs_after_rejection ────────────────────────────────────────────────────
-- As before (see 20261122160000_approval.sql for the whole rule), except its
-- extra-run branch skips no_credit runs, the same way round_idea_state does.
create or replace function concierge.runs_after_rejection(p_round_id uuid, p_facts jsonb, p_now timestamptz, p_list_gifts boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (p_now at time zone 'utc')::date + 1 < r.ship_by_deadline
       and concierge.setting_int('round_engine_enabled') = 1
       and concierge.setting_int('idea_engine_enabled') = 1
       and s.paid
       and (s.has_facts or nf.any_new or coalesce(p_list_gifts, false))
       and (s.runs_left
            or (n.runs = concierge.setting_int('idea_round_runs_max')
                and n.last_started < p_now
                and nf.any_new))
      from concierge.gift_rounds r
      cross join lateral concierge.round_idea_state(r.id) s
      cross join lateral (
        select count(*) as runs, max(u.started_at) as last_started
          from concierge.idea_runs u
         where u.round_id = r.id and u.outcome is distinct from 'no_credit'
      ) n
      -- A fact in p_facts that would end up active.
      cross join lateral (
        select exists (
          select 1
            from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) e
           where not exists (
             select 1 from concierge.profile_facts f
              where f.person_id = r.person_id
                and f.category = e ->> 'category'
                -- profile_facts.value_key's expression.
                and f.value_key = lower(regexp_replace(btrim(e ->> 'value'), '\s+', ' ', 'g'))
                and not f.active)) as any_new
      ) nf
     where r.id = p_round_id), false);
$$;

-- ─── health_snapshot ─────────────────────────────────────────────────────────
-- What the owner's health email reports, as of p_now. Each rule is written
-- once, here. Ids, counts, reasons and dates only (E6, T42): no names, emails,
-- addresses or gift titles.
--
-- An open round has closed_at null and isn't finished. closed_at is only set on
-- the money path (a cancelled hold, a removed person or occasion), so a round
-- finish_round moved to skipped keeps it null and needs its status checked too.
-- "Today" is p_now's UTC day, as on the tick. "The last day" and "this week"
-- are true constants: one day between daily checks, and 7 days.
create function concierge.health_snapshot(p_now timestamptz)
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

revoke all on function concierge.health_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function concierge.health_snapshot(timestamptz) to service_role;
