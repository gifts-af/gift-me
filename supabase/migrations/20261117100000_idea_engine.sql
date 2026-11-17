-- The idea engine (ALL-27). Expand-only (E7): everything here adds to what
-- live code uses, except round_candidates, which now leaves out users without
-- paid features (decision 53, so the engine and the rounds it feeds stay paid).
--
-- Ideas can belong to a person on demand, with no round (AC-18). Each try at
-- finding ideas is an idea_runs row, so limits and cost are counted in the
-- database. Every function here is server only.

-- ─── gift_ideas: on-demand ideas ─────────────────────────────────────────────
alter table concierge.gift_ideas
  alter column round_id drop not null,
  add column person_id uuid,
  add constraint gift_ideas_person_fkey foreign key (person_id, user_id)
    references public.people (id, user_id) on delete cascade,
  add constraint gift_ideas_has_owner check (round_id is not null or person_id is not null);

create index gift_ideas_on_demand_idx on concierge.gift_ideas (person_id) where round_id is null;

-- ─── idea_runs ───────────────────────────────────────────────────────────────
create table concierge.idea_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid not null,
  round_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_cents integer not null default 0,
  stage text,
  outcome text check (outcome in ('saved', 'none', 'failed', 'cost_cap', 'deadline')),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade,
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade
);
create index idea_runs_person_idx on concierge.idea_runs (person_id, started_at desc);
create index idea_runs_round_idx on concierge.idea_runs (round_id) where round_id is not null;

-- Owners read their own runs; only the server writes.
alter table concierge.idea_runs enable row level security;
create policy "Owner can read" on concierge.idea_runs
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on concierge.idea_runs from authenticated;

-- ─── settings ────────────────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('idea_engine_enabled', '0', 'Switch for the idea engine: 1 finds ideas, 0 is off. Ships off; turn on once testing is done.'),
  ('idea_candidates', '8', 'How many product ideas the AI is asked for in one run.'),
  ('idea_max_searches', '3', 'How many searches the AI may run for one person in one run.'),
  ('idea_ai_max_tokens', '6000', 'The most tokens one AI answer may use.'),
  ('idea_keep_min', '3', 'The fewest ideas worth saving for a person; fewer than this counts as none.'),
  ('idea_keep_max', '5', 'The most ideas saved for one person in one run.'),
  ('idea_ai_timeout_ms', '60000', 'How long to wait for the AI, in milliseconds.'),
  ('idea_zinc_timeout_ms', '15000', 'How long to wait for one Zinc lookup, in milliseconds.'),
  ('idea_tax_estimate_pct', '8', 'The tax percentage added to an idea''s estimated total.'),
  ('idea_run_estimate_cents', '40', 'The rough cost of one idea run, in cents, used to check the wallet first.'),
  ('idea_run_max_cents', '100', 'A run stops once it has cost this much, in cents.'),
  ('idea_round_runs_max', '2', 'How many runs a round gets, before new facts about the person earn one more (never more than one extra).'),
  ('idea_rounds_per_tick', '1', 'How many rounds the daily tick looks for ideas in each time it runs.'),
  ('idea_run_lease_ms', '600000', 'How long an unfinished run blocks another run for the same person, in milliseconds.'),
  ('tick_deadline_ms', '270000', 'How long the daily tick may work before it stops and leaves the rest, in milliseconds.'),
  ('zinc_lookup_cents', '1', 'The cost of one Zinc product lookup, in cents.'),
  ('zinc_requests_per_second', '10', 'The most Zinc requests we send each second.')
on conflict (key) do nothing;

-- ─── the limits ──────────────────────────────────────────────────────────────
-- What start_idea_run uses, readable on its own for the round screen. A round
-- can run idea_round_runs_max times. After that one more run is allowed if an
-- active fact changed since the last run started (adding, editing or turning
-- on a fact all touch updated_at), and never more than one extra.
create function concierge.round_idea_state(p_round_id uuid)
returns table (has_facts boolean, runs_left boolean)
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
    end
  from concierge.gift_rounds r
  cross join lateral (
    select count(*) as runs, max(u.started_at) as last_started
      from concierge.idea_runs u where u.round_id = r.id
  ) n
  where r.id = p_round_id;
$$;

-- ─── start_idea_run ──────────────────────────────────────────────────────────
-- Refusals in this order: not_found, not_paid, done, busy, limit. The advisory
-- lock makes two starts for one person wait their turn.
create function concierge.start_idea_run(p_user_id uuid, p_person_id uuid, p_round_id uuid, p_now timestamptz)
returns table (run_id uuid, refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lease_ms integer := concierge.setting_int('idea_run_lease_ms');
  v_runs_max integer := concierge.setting_int('idea_round_runs_max');
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

  insert into concierge.idea_runs (user_id, person_id, round_id, started_at)
  values (p_user_id, p_person_id, p_round_id, p_now)
  returning id into v_id;
  return query select v_id, null::text;
end;
$$;

-- ─── save_ideas ──────────────────────────────────────────────────────────────
-- p_ideas is an array of objects named like gift_ideas columns. Returns how
-- many were saved. An on-demand run replaces the person's earlier on-demand
-- set; round ideas are never touched.
create function concierge.save_ideas(p_run_id uuid, p_ideas jsonb)
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
  if v_run.round_id is not null
     and exists (select 1 from concierge.gift_ideas i where i.round_id = v_run.round_id) then
    return 0;
  end if;

  if v_run.round_id is null then
    delete from concierge.gift_ideas i
     where i.person_id = v_run.person_id and i.user_id = v_run.user_id and i.round_id is null;
  end if;

  insert into concierge.gift_ideas (
    user_id, person_id, round_id, source, status, title, retailer, product_url, retailer_product_id,
    offer_id, seller_name, first_party, price_cents, est_shipping_cents, est_tax_cents, est_total_cents,
    handling_days_max, delivery_days_min, delivery_days_max, arrive_by, reason, over_budget, rank)
  select
    v_run.user_id, v_run.person_id, v_run.round_id, 'generated', 'proposed', r.title, r.retailer, r.product_url,
    r.retailer_product_id, r.offer_id, r.seller_name, r.first_party, r.price_cents,
    coalesce(r.est_shipping_cents, 0), coalesce(r.est_tax_cents, 0), r.est_total_cents,
    r.handling_days_max, r.delivery_days_min, r.delivery_days_max, r.arrive_by, r.reason,
    coalesce(r.over_budget, false), r.rank
  from jsonb_populate_recordset(null::concierge.gift_ideas, p_ideas) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─── excluded_products ───────────────────────────────────────────────────────
-- Products not to suggest again for this person: ordered (an order that isn't
-- failed, cancelled or refunded) or rejected. Ideas saved before this change
-- have no person_id, so the person is found through the round too (S9).
create function concierge.excluded_products(p_person_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct i.retailer_product_id
    from concierge.gift_ideas i
    left join concierge.gift_rounds r on r.id = i.round_id
   where coalesce(i.person_id, r.person_id) = p_person_id
     and i.retailer_product_id is not null
     and (
       i.status = 'rejected'
       or exists (select 1 from concierge.rejections j where j.idea_id = i.id)
       or exists (select 1 from concierge.orders o
                   where o.idea_id = i.id and o.status not in ('failed', 'cancelled', 'refunded'))
     );
$$;

-- ─── the fact trigger ────────────────────────────────────────────────────────
-- A fact that ends up active brings that person's waiting rounds forward, so
-- the tick looks at them again with the new fact.
create function concierge.fact_wakes_rounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active then
    update concierge.gift_rounds r
       set next_action_at = now()
     where r.person_id = new.person_id and r.user_id = new.user_id
       and r.status in ('scheduled', 'needs_address', 'generating')
       and r.next_action_at > now();
  end if;
  return null;
end;
$$;

create trigger profile_fact_wakes_rounds
  after insert or update of value, active on concierge.profile_facts
  for each row execute function concierge.fact_wakes_rounds();

-- ─── round_candidates: paid only ─────────────────────────────────────────────
-- From 20261116130000_base_budget.sql, with the paid check added.
create or replace function concierge.round_candidates(p_today date)
returns table (
  user_id uuid,
  person_id uuid,
  occasion_id uuid,
  kind text,
  month int,
  day int,
  budget_cents int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.user_id,
    o.person_id,
    o.id,
    o.kind,
    o.month,
    o.day,
    coalesce(b.amount_cents, base.amount_cents, d.base_amount_cents)
  from concierge.occasions o
  join public.people p on p.id = o.person_id and p.user_id = o.user_id
  left join concierge.budgets b on b.person_id = o.person_id and b.occasion_kind = o.kind
  left join concierge.budgets base on base.person_id = o.person_id and base.occasion_kind = 'any'
  left join concierge.budget_defaults d on d.user_id = o.user_id and d.relationship = p.relationship
  where o.enabled
    and o.deleted_at is null
    and p.deleted_at is null
    and concierge.has_paid_features(o.user_id);
$$;

-- ─── who may run what ────────────────────────────────────────────────────────
revoke all on function concierge.round_idea_state(uuid) from public, anon, authenticated;
revoke all on function concierge.start_idea_run(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function concierge.save_ideas(uuid, jsonb) from public, anon, authenticated;
revoke all on function concierge.excluded_products(uuid) from public, anon, authenticated;
revoke all on function concierge.fact_wakes_rounds() from public, anon, authenticated;
grant execute on function concierge.round_idea_state(uuid) to service_role;
grant execute on function concierge.start_idea_run(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function concierge.save_ideas(uuid, jsonb) to service_role;
grant execute on function concierge.excluded_products(uuid) to service_role;
