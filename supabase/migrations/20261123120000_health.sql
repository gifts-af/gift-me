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
  ('zinc_app_balance_low_cents', '500', 'The health email warns when the Zinc app balance is below this many cents.')
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
