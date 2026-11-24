-- The cost ledger: what each AI and lookup call cost, the monthly bills, and
-- the cost-per-gift averages worked out from them. Expand-only (E7): two new
-- tables, one account flag, new settings and two functions.
--
-- A cost row holds no buyer, person or round link (T42): the averages don't
-- need them. It keeps the idea run or order it came from, where there is one,
-- for checking. Only the service role reads or writes any of this.

-- ─── Accounts left out of the averages ───────────────────────────────────────
-- Set by hand for the QA live-check account, like paid_features. Users can't
-- set it: accounts' column grants don't include it.
alter table concierge.accounts
  add column costs_excluded boolean not null default false;
comment on column concierge.accounts.costs_excluded is
  'Left out of the cost averages (the QA live-check account). Set by hand with the server''s access; users cannot change it. Its costs are still recorded, marked excluded, and its orders are not completed gifts.';

-- ─── cost_events ─────────────────────────────────────────────────────────────
-- ALL-98 widens the kind list for Zinc's order fee and card fees.
create table concierge.cost_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null
    constraint cost_events_kind_check check (kind in ('ai_ideas', 'lookup_ideas', 'ai_capture', 'lookup_price_check')),
  -- Fractions of a cent are kept; the averages add them up before rounding.
  cents numeric(12, 4) not null check (cents >= 0),
  estimated boolean not null,
  -- Fixed when the row is written, so changing the account's flag later leaves old rows alone.
  excluded boolean not null default false,
  -- No user to pair these with (T26 (3)), so single-column links that clear when the row they point at goes.
  idea_run_id uuid references concierge.idea_runs (id) on delete set null,
  order_id uuid references concierge.orders (id) on delete set null
);
comment on table concierge.cost_events is
  'One row per costed call: kind, cents (fractions kept), whether it is an estimate, whether it is left out of the averages, and the idea run or order it came from. No buyer, person or round link. Server only.';
create index cost_events_created_at_idx on concierge.cost_events (created_at);
create index cost_events_idea_run_id_idx on concierge.cost_events (idea_run_id) where idea_run_id is not null;
create index cost_events_order_id_idx on concierge.cost_events (order_id) where order_id is not null;

-- ─── monthly_bills ───────────────────────────────────────────────────────────
create table concierge.monthly_bills (
  month date not null check (month = date_trunc('month', month)::date),
  vendor text not null check (btrim(vendor) <> ''),
  cents integer not null check (cents >= 0),
  primary key (month, vendor)
);
comment on table concierge.monthly_bills is
  'What running the service cost each month, one row per vendor, entered by hand. A second bill for the same month and vendor replaces the first. Yearly bills are entered as one-twelfth each month. Server only.';

-- Server only: RLS on with no policies, and only the service role has rights.
alter table concierge.cost_events enable row level security;
alter table concierge.monthly_bills enable row level security;
revoke all on concierge.cost_events from public, anon, authenticated;
revoke all on concierge.monthly_bills from public, anon, authenticated;
grant select, insert on concierge.cost_events to service_role;
grant select, insert, update, delete on concierge.monthly_bills to service_role;

-- ─── settings ────────────────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('cost_tracking_enabled', '1', 'Switch for cost tracking: 1 records costs and works out the cost per gift, 0 records nothing. After an off period, set cost_tracking_since again, because nothing was recorded meanwhile.'),
  ('cost_window_days', '90', 'How many days back the cost-per-gift averages look.'),
  ('cost_record_timeout_ms', '3000', 'How long recording a cost may take before it is given up on and logged, in milliseconds. A slow write must never hold up the user''s action.')
on conflict (key) do nothing;

-- Counting starts when tracking does: orders from before it have no costs
-- behind them. Set to the moment this migration runs, as a UTC timestamp.
insert into concierge.app_settings (key, value, description)
select 'cost_tracking_since', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
       'When cost counting starts (UTC timestamp). Orders, costs and bill months before it are left out of the averages. After turning cost_tracking_enabled back on from an off period, set this to now again.'
on conflict (key) do nothing;

-- ─── record_cost ─────────────────────────────────────────────────────────────
-- Writes one row, marked excluded when the user's account is flagged. A user
-- with no accounts row is recorded and not excluded. Writes nothing while
-- tracking is off. No fallback value (T23): a missing switch fails loudly.
create function concierge.record_cost(
  p_user_id uuid, p_kind text, p_cents numeric, p_estimated boolean,
  p_idea_run_id uuid default null, p_order_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled integer := concierge.setting_int('cost_tracking_enabled');
begin
  if v_enabled is null then
    raise exception 'record_cost: missing setting cost_tracking_enabled';
  end if;
  if v_enabled = 0 then
    return;
  end if;
  insert into concierge.cost_events (kind, cents, estimated, excluded, idea_run_id, order_id)
  values (p_kind, p_cents, p_estimated,
          coalesce((select a.costs_excluded from concierge.accounts a where a.user_id = p_user_id), false),
          p_idea_run_id, p_order_id);
end;
$$;

-- ─── cost_per_gift ───────────────────────────────────────────────────────────
-- The numbers behind the Monday email, as of p_now. Null when tracking is off.
-- The keys are CostPerGift's (modules/concierge/health/costs.ts). Dates are UTC.
--
--  * A completed gift: an order placed, shipped or delivered, with placed_at
--    after the counting start and up to p_now, from an account not left out.
--  * Counting starts at the later of the window's start and cost_tracking_since.
--  * AI suggestions add ai_ideas and ai_capture; lookups add lookup_ideas and
--    lookup_price_check. Kinds are named, so later kinds (order and card fees)
--    never land in these.
--  * A bill month counts when it starts on or after the counting start, has
--    ended by p_now and has a bill. billGifts are the gifts placed in those
--    months, so a month with no bills never understates the cost.
create function concierge.cost_per_gift(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled integer := concierge.setting_int('cost_tracking_enabled');
  v_days integer;
  v_fee integer;
  v_since timestamptz;
  v_start timestamptz;
  v_result jsonb;
begin
  if v_enabled is null then
    raise exception 'cost_per_gift: missing setting cost_tracking_enabled';
  end if;
  if v_enabled = 0 then
    return null;
  end if;

  v_days := concierge.setting_int('cost_window_days');
  v_fee := concierge.setting_int('zinc_order_fee_cents');
  select (s.value #>> '{}')::timestamptz into v_since from concierge.app_settings s where s.key = 'cost_tracking_since';
  if v_days is null then
    raise exception 'cost_per_gift: missing setting cost_window_days';
  end if;
  if v_since is null then
    raise exception 'cost_per_gift: missing setting cost_tracking_since';
  end if;
  if v_fee is null then
    raise exception 'cost_per_gift: missing setting zinc_order_fee_cents';
  end if;

  v_start := greatest(p_now - make_interval(days => v_days), v_since);

  with gifts as (
    select o.placed_at
      from concierge.orders o
     where o.status in ('placed', 'shipped', 'delivered')
       and o.placed_at > v_start and o.placed_at <= p_now
       and not coalesce((select a.costs_excluded from concierge.accounts a where a.user_id = o.user_id), false)
  ),
  costs as (
    select c.kind, c.cents, c.estimated, c.excluded
      from concierge.cost_events c
     where c.created_at > v_start and c.created_at <= p_now
       and c.kind in ('ai_ideas', 'ai_capture', 'lookup_ideas', 'lookup_price_check')
  ),
  months as (
    select b.month, array_agg(b.vendor order by b.vendor) as vendors, sum(b.cents) as cents
      from concierge.monthly_bills b
     where (b.month::timestamp at time zone 'utc') >= v_start
       and ((b.month + interval '1 month') at time zone 'utc') <= p_now
     group by b.month
  )
  select jsonb_build_object(
    'since', to_char(v_start at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'windowDays', v_days,
    'gifts', (select count(*) from gifts),
    'aiCents', (select coalesce(sum(cents), 0) from costs where not excluded and kind in ('ai_ideas', 'ai_capture')),
    'lookupCents', (select coalesce(sum(cents), 0) from costs where not excluded and kind in ('lookup_ideas', 'lookup_price_check')),
    'aiRecords', (select count(*) from costs where not excluded and kind in ('ai_ideas', 'ai_capture')),
    'aiEstimated', (select count(*) from costs where not excluded and estimated and kind in ('ai_ideas', 'ai_capture')),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM-DD'), 'vendors', to_jsonb(m.vendors)) order by m.month)
                         from months m), '[]'::jsonb),
    'billCents', (select coalesce(sum(cents), 0) from months),
    'billGifts', (select count(*) from gifts g
                   where exists (select 1 from months m
                                  where (g.placed_at at time zone 'utc') >= m.month
                                    and (g.placed_at at time zone 'utc') < m.month + interval '1 month')),
    'orderFeeCents', v_fee,
    'excludedCents', (select coalesce(sum(cents), 0) from costs where excluded))
  into v_result;

  return v_result;
end;
$$;

revoke all on function concierge.record_cost(uuid, text, numeric, boolean, uuid, uuid) from public, anon, authenticated;
revoke all on function concierge.cost_per_gift(timestamptz) from public, anon, authenticated;
grant execute on function concierge.record_cost(uuid, text, numeric, boolean, uuid, uuid) to service_role;
grant execute on function concierge.cost_per_gift(timestamptz) to service_role;
