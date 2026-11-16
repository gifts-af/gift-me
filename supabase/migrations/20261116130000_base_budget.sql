-- A base budget for each person (ALL-120, T73, planning decisions 4 and 36).
-- A person's base budget is a budgets row of kind 'any'. A round's budget is
-- the occasion's own amount, else the base, else the relationship default,
-- else none. A null occasion row now means the same as no row (revises T31):
-- the Budget screen never writes one, and existing ones are removed.

-- ─── budgets ─────────────────────────────────────────────────────────────────
-- Null rows mean the same as no row under the new order, so removing them
-- changes no round.
delete from concierge.budgets where amount_cents is null;

alter table concierge.budgets
  add constraint budgets_occasion_kind_check
    check (occasion_kind in ('any', 'birthday', 'anniversary', 'christmas', 'valentines_day', 'mothers_day', 'fathers_day')),
  add constraint budgets_base_has_amount check (occasion_kind <> 'any' or amount_cents is not null);

comment on column concierge.budgets.amount_cents is
  'The budget in cents. Kind ''any'' is the person''s base budget. Null (no longer written) means the same as no row; made not null once no live code writes it (E7).';

-- ─── round_candidates ────────────────────────────────────────────────────────
-- Every enabled, live occasion of a live person, with the budget resolved in
-- the owner's order. Same signature as before.
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
    and p.deleted_at is null;
$$;

-- ─── save_budgets ────────────────────────────────────────────────────────────
-- The Budget screen's one Save: the base ('any') and any occasion kinds, each
-- a whole number of cents or null (null removes that kind's own budget). All
-- or nothing. Runs as the caller, so the owner policies apply.
create function concierge.save_budgets(p_person_id uuid, p_amounts jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_kinds constant text[] := array['any', 'birthday', 'anniversary', 'christmas', 'valentines_day', 'mothers_day', 'fathers_day'];
begin
  perform 1 from public.people p where p.id = p_person_id and p.deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_amounts) is distinct from 'object' then
    raise exception 'Amounts must be an object' using errcode = '22023';
  end if;

  for v_key, v_value in select * from jsonb_each(p_amounts) loop
    if not (v_key = any (v_kinds)) then
      raise exception 'Unknown budget kind' using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_value) <> 'number'
       or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
       or (v_value #>> '{}')::numeric not between 0 and 2147483647 then
      raise exception 'A budget is a whole number of cents' using errcode = '22023';
    end if;
  end loop;

  delete from concierge.budgets b
   where b.person_id = p_person_id
     and b.occasion_kind in (select key from jsonb_each(p_amounts) where jsonb_typeof(value) = 'null');

  insert into concierge.budgets (person_id, occasion_kind, amount_cents)
  select p_person_id, key, (value #>> '{}')::integer
    from jsonb_each(p_amounts)
   where jsonb_typeof(value) = 'number'
  on conflict (person_id, occasion_kind) do update set amount_cents = excluded.amount_cents;
end;
$$;

revoke execute on function concierge.save_budgets(uuid, jsonb) from public, anon;
grant execute on function concierge.save_budgets(uuid, jsonb) to authenticated;
