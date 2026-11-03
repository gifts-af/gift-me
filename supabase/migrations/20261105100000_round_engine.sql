-- Round engine (ALL-28): settings, heads-up date, send records, and the
-- database functions that claim rounds with a lease so two ticks never work
-- the same round. Server-only: service_role runs them, nobody else.

insert into concierge.app_settings (key, value, description) values
  ('round_engine_enabled', '0', 'Master switch for the round engine: 1 lets the daily tick start and advance rounds, 0 stops it.'),
  ('round_lock_minutes', '10', 'Minutes a claimed round stays leased to one engine run before another may take it.'),
  ('round_max_attempts', '3', 'Failed attempts on a round before the engine logs it as stuck.')
on conflict (key) do nothing;

-- The day the heads-up email went out (or is due); null until it is sent.
alter table concierge.gift_rounds add column heads_up_on date;

-- One row per email step already sent for a round, so a retry can't send twice.
create table concierge.round_sends (
  round_id uuid not null,
  user_id uuid not null,
  step text not null,
  created_at timestamptz not null default now(),
  primary key (round_id, step),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade
);

alter table concierge.round_sends enable row level security;
revoke all on concierge.round_sends from public, anon, authenticated;
grant all on concierge.round_sends to service_role;

-- Every enabled, live occasion of a live person, with the budget resolved:
-- the person's own budget for that kind, else the user's default for the
-- person's relationship, else null. Year matching and dedupe are the caller's
-- job (insert on conflict on the rounds' unique key); p_today is kept for the
-- engine's call signature.
create function concierge.round_candidates(p_today date)
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
    coalesce(b.amount_cents, d.base_amount_cents)
  from concierge.occasions o
  join public.people p on p.id = o.person_id and p.user_id = o.user_id
  left join concierge.budgets b on b.person_id = o.person_id and b.occasion_kind = o.kind
  left join concierge.budget_defaults d on d.user_id = o.user_id and d.relationship = p.relationship
  where o.enabled
    and o.deleted_at is null
    and p.deleted_at is null;
$$;

create function concierge.claim_due_rounds(p_now timestamptz)
returns setof concierge.gift_rounds
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id from concierge.gift_rounds
    where next_action_at <= p_now
      and status not in ('complete', 'skipped', 'ordered', 'delivered')
      and (locked_until is null or locked_until < p_now)
    order by next_action_at
    for update skip locked
  )
  update concierge.gift_rounds r
     set locked_until = p_now + make_interval(mins => concierge.setting_int('round_lock_minutes')),
         attempts = r.attempts + 1
    from due
   where r.id = due.id
  returning r.*;
$$;

create function concierge.claim_round(p_round_id uuid, p_now timestamptz)
returns concierge.gift_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row concierge.gift_rounds;
begin
  update concierge.gift_rounds r
     set locked_until = p_now + make_interval(mins => concierge.setting_int('round_lock_minutes')),
         attempts = r.attempts + 1
   where r.id = (
           select id from concierge.gift_rounds
           where id = p_round_id
             and next_action_at <= p_now
             and status not in ('complete', 'skipped', 'ordered', 'delivered')
             and (locked_until is null or locked_until < p_now)
           for update skip locked
         )
  returning r.* into v_row;
  if not found then
    return null;
  end if;
  return v_row;
end;
$$;

create function concierge.finish_round(
  p_round_id uuid,
  p_lock timestamptz,
  p_status concierge.round_status,
  p_next_action_at timestamptz,
  p_heads_up_on date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update concierge.gift_rounds
     set status = p_status,
         next_action_at = p_next_action_at,
         heads_up_on = coalesce(p_heads_up_on, heads_up_on),
         locked_until = null,
         attempts = 0
   where id = p_round_id and locked_until = p_lock;
  return found;
end;
$$;

revoke all on function concierge.round_candidates(date) from public, anon, authenticated;
revoke all on function concierge.claim_due_rounds(timestamptz) from public, anon, authenticated;
revoke all on function concierge.claim_round(uuid, timestamptz) from public, anon, authenticated;
revoke all on function concierge.finish_round(uuid, timestamptz, concierge.round_status, timestamptz, date) from public, anon, authenticated;
grant execute on function concierge.round_candidates(date) to service_role;
grant execute on function concierge.claim_due_rounds(timestamptz) to service_role;
grant execute on function concierge.claim_round(uuid, timestamptz) to service_role;
grant execute on function concierge.finish_round(uuid, timestamptz, concierge.round_status, timestamptz, date) to service_role;
