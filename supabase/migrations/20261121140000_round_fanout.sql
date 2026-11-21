-- Fan out the daily round tick (ALL-125). Expand-only (E7): two settings, one
-- read-only function, and start_idea_run gains one more refusal, daily_limit.

-- ─── settings ────────────────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('round_fanout_enabled', '0', 'Switch for the fan-out: 1 has the daily tick hand each due round to its own function call, 0 keeps the single tick. Ships off; turn on once testing is done.'),
  ('idea_round_runs_per_day', '5', 'The most idea runs for rounds that may start in one UTC day, across everyone. A round that hits it waits for the next tick. On-demand runs do not count.')
on conflict (key) do nothing;

-- ─── due_rounds ──────────────────────────────────────────────────────────────
-- The rounds claim_due_rounds would claim, without claiming them: the same
-- where and order by, no row locks, no writes. The fan-out reads it to know
-- what to hand out; each round is still claimed on its own later.
create function concierge.due_rounds(p_now timestamptz)
returns table (id uuid, user_id uuid, status concierge.round_status, attention_reason text, ship_by_deadline date)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.user_id, r.status, r.attention_reason, r.ship_by_deadline
    from concierge.gift_rounds r
   where r.next_action_at <= p_now
     and r.status not in ('complete', 'skipped', 'ordered', 'delivered')
     and (r.locked_until is null or r.locked_until < p_now)
   order by (r.status = 'needs_attention'
             and r.attention_reason in ('funds', 'setup', 'address', 'paused', 'not_allowed', 'retry')) desc,
            r.ship_by_deadline,
            r.next_action_at;
$$;

revoke all on function concierge.due_rounds(timestamptz) from public, anon, authenticated;
grant execute on function concierge.due_rounds(timestamptz) to service_role;

-- ─── start_idea_run: the daily limit ─────────────────────────────────────────
-- From 20261117100000_idea_engine.sql, with one more refusal after 'limit': a
-- round run is refused once idea_round_runs_per_day round runs have started in
-- the UTC day of p_now. The count is serialized by a lock of its own (the
-- two-argument form, a separate keyspace from the per-person locks), taken
-- after the person lock. Nothing else takes it, so no lock-order cycle.
create or replace function concierge.start_idea_run(p_user_id uuid, p_person_id uuid, p_round_id uuid, p_now timestamptz)
returns table (run_id uuid, refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lease_ms integer := concierge.setting_int('idea_run_lease_ms');
  v_runs_max integer := concierge.setting_int('idea_round_runs_max');
  v_per_day integer;
  v_day timestamptz;
begin
  -- The limits guard AI spend: a missing setting stops the run, never allows it.
  if v_lease_ms is null or v_runs_max is null then
    raise exception 'Idea run settings are missing';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_person_id::text));

  perform 1 from public.people p
   where p.id = p_person_id and p.user_id = p_user_id and p.deleted_at is null;
  if not found then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;
  if p_round_id is not null then
    perform 1 from concierge.gift_rounds r
     where r.id = p_round_id and r.user_id = p_user_id and r.person_id = p_person_id;
    if not found then
      return query select null::uuid, 'not_found'::text;
      return;
    end if;
  end if;

  if not concierge.has_paid_features(p_user_id) then
    return query select null::uuid, 'not_paid'::text;
    return;
  end if;

  if p_round_id is not null and exists (select 1 from concierge.gift_ideas i where i.round_id = p_round_id) then
    return query select null::uuid, 'done'::text;
    return;
  end if;

  if exists (
    select 1 from concierge.idea_runs u
     where u.person_id = p_person_id and u.finished_at is null
       and u.started_at > p_now - make_interval(secs => v_lease_ms / 1000.0)
  ) then
    return query select null::uuid, 'busy'::text;
    return;
  end if;

  if p_round_id is not null
     and not (select s.runs_left from concierge.round_idea_state(p_round_id) s) then
    return query select null::uuid, 'limit'::text;
    return;
  end if;

  if p_round_id is not null then
    v_per_day := concierge.setting_int('idea_round_runs_per_day');
    if v_per_day is null then
      raise exception 'Idea run settings are missing';
    end if;
    perform pg_advisory_xact_lock(hashtext('concierge.idea_round_runs_per_day'), 0);
    v_day := date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC';
    if (select count(*) from concierge.idea_runs u
         where u.round_id is not null
           and u.started_at >= v_day and u.started_at < v_day + interval '1 day') >= v_per_day then
      return query select null::uuid, 'daily_limit'::text;
      return;
    end if;
  end if;

  insert into concierge.idea_runs (user_id, person_id, round_id, started_at)
  values (p_user_id, p_person_id, p_round_id, p_now)
  returning id into v_id;
  return query select v_id, null::text;
end;
$$;
