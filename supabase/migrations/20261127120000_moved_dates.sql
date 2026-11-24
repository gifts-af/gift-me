-- Moving a birthday or anniversary ends its open round when no gift is chosen, and frees its place
-- for the year, so the tick can start one for the real date. Rounds with a gift are left alone.
--
-- A round ended this way is skipped with no occasion_year. Nulls don't collide in the unique key
-- (person, occasion, year), and no other code writes one.
-- Deploying: the old code never reads occasion_year, so it runs on this (E7).

insert into concierge.app_settings (key, value, description) values
  ('moved_dates_close_rounds', '1', 'Changing a birthday or anniversary ends its open round when no gift is chosen. 0 leaves the round on its old date.')
on conflict (key) do nothing;

alter table concierge.gift_rounds
  alter column occasion_year drop not null,
  -- An open round without a year would escape the unique key, and every tick would add another.
  add constraint gift_rounds_year_or_skipped check (occasion_year is not null or status = 'skipped');

comment on column concierge.gift_rounds.occasion_year is
  'The year of the occasion, for one round a year. Null only on a round that ended because its date changed.';

create function concierge.handle_occasion_moved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- A missing setting leaves rounds alone.
  if concierge.setting_int('moved_dates_close_rounds') is distinct from 1 then
    return new;
  end if;
  for v_id in select id from concierge.gift_rounds where occasion_id = new.id order by id
  loop
    -- Open, read under the round's lock: an approval that got there first has an order by now.
    perform 1 from concierge.gift_rounds
     where id = v_id and closed_at is null
       and status in ('scheduled', 'generating', 'awaiting_approval', 'needs_address', 'needs_attention')
       for update;
    if not found or exists (select 1 from concierge.orders where round_id = v_id and status <> 'failed') then
      continue;
    end if;
    if concierge.reconcile_round(v_id, 'deadline') = 'skipped' then
      -- The lease goes too, so a step under way can't finish over it.
      update concierge.gift_rounds set occasion_year = null, locked_until = null where id = v_id;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function concierge.handle_occasion_moved() from public, anon, authenticated;

create trigger on_occasion_moved after update of month, day on concierge.occasions
  for each row when (
    old.kind in ('birthday', 'anniversary') and new.kind = old.kind
    and (old.month is distinct from new.month or old.day is distinct from new.day))
  execute function concierge.handle_occasion_moved();

-- ─── Idea runs refuse a round that ended ────────────────────────────────────
-- Same signatures and grants; only the lines marked New change.

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
  v_ended boolean;
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
    -- New: locked, so a date change waits for the run or is seen by it, and a round that ended
    -- buys nothing.
    select r.closed_at is not null or r.status = 'skipped' into v_ended
      from concierge.gift_rounds r
     where r.id = p_round_id and r.user_id = p_user_id and r.person_id = p_person_id
       for update;
    if not found then
      return query select null::uuid, 'not_found'::text;
      return;
    end if;
    if v_ended then
      return query select null::uuid, 'closed'::text;
      return;
    end if;
  end if;

  if not concierge.has_paid_features(p_user_id) then
    return query select null::uuid, 'not_paid'::text;
    return;
  end if;

  -- A round whose ideas were all rejected runs again.
  if p_round_id is not null
     and exists (select 1 from concierge.gift_ideas i where i.round_id = p_round_id and i.status <> 'rejected') then
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

create or replace function concierge.save_ideas(p_run_id uuid, p_ideas jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run concierge.idea_runs;
  v_count int;
begin
  select * into v_run from concierge.idea_runs where id = p_run_id;
  if not found then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_run.person_id::text));

  perform 1 from public.people p
   where p.id = v_run.person_id and p.user_id = v_run.user_id and p.deleted_at is null;
  if not found then
    return 0;
  end if;
  -- New: -1 when the round ended while the run was under way, so nothing is saved or sent for it.
  if v_run.round_id is not null then
    perform 1 from concierge.gift_rounds r
     where r.id = v_run.round_id and r.closed_at is null and r.status <> 'skipped'
       for update;
    if not found then
      return -1;
    end if;
  end if;
  -- Only ideas that aren't rejected count.
  if v_run.round_id is not null
     and exists (select 1 from concierge.gift_ideas i where i.round_id = v_run.round_id and i.status <> 'rejected') then
    return 0;
  end if;

  if v_run.round_id is null then
    delete from concierge.gift_ideas i
     where i.person_id = v_run.person_id and i.user_id = v_run.user_id and i.round_id is null;
  end if;

  insert into concierge.gift_ideas (
    user_id, person_id, round_id, source, list_item_id, image_url, status, title, retailer, product_url,
    retailer_product_id, offer_id, seller_name, first_party, price_cents, est_shipping_cents, est_tax_cents,
    est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, arrive_by, reason, over_budget, rank)
  select
    v_run.user_id, v_run.person_id, v_run.round_id,
    coalesce(r.source, 'generated'), r.list_item_id, r.image_url,
    'proposed', r.title, r.retailer, r.product_url,
    r.retailer_product_id, r.offer_id, r.seller_name, r.first_party, r.price_cents,
    coalesce(r.est_shipping_cents, 0), coalesce(r.est_tax_cents, 0), r.est_total_cents,
    r.handling_days_max, r.delivery_days_min, r.delivery_days_max, r.arrive_by, r.reason,
    coalesce(r.over_budget, false), r.rank
  from jsonb_populate_recordset(null::concierge.gift_ideas, p_ideas) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─── Health ─────────────────────────────────────────────────────────────────

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

    'weekly', (
      select jsonb_build_object(
        'waiting_address', count(*) filter (where r.status = 'needs_address'
                                               or (r.status = 'needs_attention' and r.attention_reason = 'address')),
        'waiting_funds', count(*) filter (where r.status = 'needs_attention' and r.attention_reason = 'funds'),
        'waiting_setup', count(*) filter (where r.status = 'needs_attention' and r.attention_reason = 'setup'),
        'waiting_approval', count(*) filter (where r.status = 'awaiting_approval'),
        'no_ideas', (
          select count(*) from concierge.gift_rounds s
           -- New: not a round a date change ended (no year): nobody was left without ideas.
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
