-- When a search finds nothing. A round whose last search found nothing isn't searched again until
-- the buyer gives a new fact (T68), and when "None of these" brought nothing new and no search is
-- left, the rejected ideas come back (T85). Additive: the code already running keeps working (E7).

-- ─── the switch ──────────────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('restore_rejected_ideas_enabled', '1',
   'When "None of these" finds nothing new and no search is left, bring the rejected ideas back (1 = on, 0 = off: the no-ideas email goes instead).');

-- ─── rejections.owned ────────────────────────────────────────────────────────
-- "Already has one" named this idea, so it never comes back. A list gift's title is never saved as
-- a fact (T42), so this is how it's remembered.
alter table concierge.rejections add column owned boolean not null default false;
-- Rows from before it don't say which gift they have. An AI idea's title is in an owns fact; for a
-- list gift, count every one rejected that way.
update concierge.rejections j set owned = true
  from concierge.gift_ideas i
 where i.id = j.idea_id and i.list_item_id is not null and j.reason_code = 'has_it' and not j.owned;

-- ─── the too-late email's key ────────────────────────────────────────────────
-- A round told on its last tick that no gift can arrive in time (no_ideas_late) is told once, and its
-- close isn't emailed again. As in 20261127100000_late_again.sql, with that key added.
alter table concierge.round_sends drop constraint round_sends_step_check;
alter table concierge.round_sends
  add constraint round_sends_step_check check (
    step ~ '^(heads_up|reminder_[12]|final_notice|skipped|address_request|address_reminder_[12]|address_final_notice|hold_trouble|missed_on_us|held_cancelled|shared_address|no_ideas|no_ideas_again|no_ideas_late|delivered|reaction_prompt)$'
    or step ~ '^(heads_up|reminder_[12]|final_notice|no_ideas|no_ideas_again)@[0-9]+$'
    or step ~ '^hold:[0-9]+:(notice|reminder|final|deadline)$'
    or step ~ '^hold:[0-9]+:short:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or step ~ '^fail:[0-9]+:notice$'
    or step ~ '^(fail|ordered|late_fail):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or step ~ '^(late|ontime|cancel_late):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or step ~ '^(late|ontime):([2-9]|[1-9][0-9]+):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- ─── profile_facts.changed_at ────────────────────────────────────────────────
-- When a fact was added, last reworded, or turned back on. updated_at also moves when a fact is only
-- touched (confirmed, or saved again as it was), and the search would read the same facts.
alter table concierge.profile_facts add column changed_at timestamptz not null default now();
-- Not a change to any fact, so it mustn't look like one to updated_at.
alter table concierge.profile_facts disable trigger set_updated_at;
update concierge.profile_facts set changed_at = updated_at;
alter table concierge.profile_facts enable trigger set_updated_at;

create function concierge.keep_fact_changed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.changed_at := new.updated_at;
  elsif new.category is distinct from old.category or new.value is distinct from old.value
        or (new.active and not old.active) then
    new.changed_at := now();
  else
    new.changed_at := old.changed_at;
  end if;
  return new;
end;
$$;

revoke all on function concierge.keep_fact_changed_at() from public, anon, authenticated;

create trigger keep_fact_changed_at before insert or update on concierge.profile_facts
  for each row execute function concierge.keep_fact_changed_at();

-- ─── round_idea_state ────────────────────────────────────────────────────────
-- As before (20261123120000_health.sql), except after a search that found nothing ('none', the last
-- counted run) another one is left only with an active fact added, changed or turned on since its
-- start (changed_at), however many runs remain: the same inputs would be paid for twice. A failed,
-- capped or cut-off run still retries, and its extra run goes by updated_at as before.
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
      when n.runs >= concierge.setting_int('idea_round_runs_max') or n.last_outcome = 'none' then exists (
        select 1 from concierge.profile_facts f
         where f.person_id = r.person_id and f.user_id = r.user_id and f.active
           and case when n.last_outcome = 'none' then f.changed_at else f.updated_at end > n.last_started)
      else true
    end,
    concierge.has_paid_features(r.user_id)
  from concierge.gift_rounds r
  cross join lateral (
    select count(*) as runs, max(u.started_at) as last_started,
           (array_agg(u.outcome order by u.started_at desc, u.id desc))[1] as last_outcome
      from concierge.idea_runs u
     where u.round_id = r.id and u.outcome is distinct from 'no_credit'
  ) n
  where r.id = p_round_id;
$$;

-- ─── runs_after_rejection ────────────────────────────────────────────────────
-- As before (20261123120000_health.sql), except a fact this choice would save can earn a search
-- while runs remain too (<=, was =): after a search that found nothing, the runs rule above says no
-- until that fact is saved. It must then be one the person doesn't have, as saving one they have
-- changes nothing. So the sheet and reject_round_ideas give the same answer.
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
            or (n.runs <= concierge.setting_int('idea_round_runs_max')
                and n.last_started < p_now
                and case when n.last_outcome = 'none' then nf.any_added else nf.any_new end))
      from concierge.gift_rounds r
      cross join lateral concierge.round_idea_state(r.id) s
      cross join lateral (
        select count(*) as runs, max(u.started_at) as last_started,
               (array_agg(u.outcome order by u.started_at desc, u.id desc))[1] as last_outcome
          from concierge.idea_runs u
         where u.round_id = r.id and u.outcome is distinct from 'no_credit'
      ) n
      -- A fact in p_facts that would end up active, and one the person doesn't have yet.
      cross join lateral (
        select coalesce(bool_or(k.active is distinct from false), false) as any_new,
               coalesce(bool_or(k.active is null), false) as any_added
          from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) e
          left join concierge.profile_facts k
            on k.person_id = r.person_id
           and k.category = e ->> 'category'
           -- profile_facts.value_key's expression.
           and k.value_key = lower(regexp_replace(btrim(e ->> 'value'), '\s+', ' ', 'g'))
      ) nf
     where r.id = p_round_id), false);
$$;

-- ─── reject_round_ideas ──────────────────────────────────────────────────────
-- As before (20261122160000_approval.sql), except p_owned_idea_id marks the rejection of the gift
-- they already have. That holds when the reason is only noted too.
--   Dropped and created in one transaction, not overloaded: two versions would make a call with the
-- eight old arguments ambiguous. The default keeps that call working.
drop function concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean);

create function concierge.reject_round_ideas(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_reason_code text,
                                             p_reason_text text, p_facts jsonb, p_expect_more boolean,
                                             p_list_gifts boolean, p_owned_idea_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_facts jsonb := coalesce(p_facts, '[]'::jsonb);
  v_n integer;
  v_steps constant text[] := array['heads_up', 'reminder_1', 'reminder_2', 'final_notice', 'no_ideas', 'no_ideas_again'];
begin
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or r.user_id is distinct from p_user_id or r.locked_until is distinct from p_lock then
    raise exception 'reject_round_ideas: lease not held' using errcode = 'P0001';
  end if;
  if r.status <> 'awaiting_approval' or r.closed_at is not null then
    raise exception 'reject_round_ideas: not open' using errcode = 'P0001';
  end if;
  -- A live order, as approve_round counts one.
  if exists (select 1 from concierge.orders
              where round_id = p_round_id and status <> 'cancelled' and not (status = 'failed' and resolved)) then
    raise exception 'reject_round_ideas: live order' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code not in ('has_it', 'not_style', 'too_pricey', 'too_generic') then
    raise exception 'reject_round_ideas: unknown reason' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_facts) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_facts) e
                 where (e ->> 'category') is null or (e ->> 'category') not in ('owns', 'avoid')) then
    raise exception 'reject_round_ideas: fact category' using errcode = 'P0001';
  end if;

  -- The 500-character limit is profile_facts' own check (23514).
  insert into concierge.profile_facts (user_id, person_id, category, value, source)
  select r.user_id, r.person_id, e ->> 'category', e ->> 'value', 'rejection'
    from jsonb_array_elements(v_facts) e
  on conflict (person_id, category, value_key) do update set updated_at = now();

  if concierge.runs_after_rejection(p_round_id, '[]'::jsonb, now(), p_list_gifts) is distinct from p_expect_more then
    raise exception 'reject_round_ideas: changed' using errcode = 'P0001';
  end if;

  if not p_expect_more then
    -- New: the gift they have, if it's one on offer here, so it stays gone if the rest come back later.
    insert into concierge.rejections (user_id, round_id, idea_id, reason_code, reason_text, owned)
    select r.user_id, p_round_id, o.id, p_reason_code, p_reason_text, o.id is not null
      from (values (1)) one
      left join concierge.gift_ideas o
        on p_reason_code = 'has_it' and o.id = p_owned_idea_id and o.round_id = p_round_id
       and o.status in ('proposed', 'selected');
    return;
  end if;

  -- No live order is left (checked above), so every idea still on offer goes.
  insert into concierge.rejections (user_id, round_id, idea_id, reason_code, reason_text, owned)
  select r.user_id, p_round_id, i.id, p_reason_code, p_reason_text,
         -- New. A call that doesn't name the gift (code from before this) could mean any list gift.
         p_reason_code = 'has_it'
           and (i.id is not distinct from p_owned_idea_id
                or (p_owned_idea_id is null and i.list_item_id is not null))
    from concierge.gift_ideas i
   where i.round_id = p_round_id and i.status in ('proposed', 'selected');
  update concierge.gift_ideas set status = 'rejected'
   where round_id = p_round_id and status in ('proposed', 'selected');

  -- The next free <n>: one more than any earlier rename of these steps.
  select coalesce(max(split_part(s.step, '@', 2)::integer), 0) + 1 into v_n
    from concierge.round_sends s
   where s.round_id = p_round_id
     and split_part(s.step, '@', 1) = any (v_steps)
     and s.step ~ '@[0-9]+$';
  update concierge.round_sends
     set step = step || '@' || v_n
   where round_id = p_round_id and step = any (v_steps);

  update concierge.gift_rounds
     set status = 'generating', next_action_at = now()
   where id = p_round_id;
end;
$$;

revoke all on function concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid) from public, anon, authenticated;
grant execute on function concierge.reject_round_ideas(uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid) to service_role;

-- ─── restore_rejected_ideas ──────────────────────────────────────────────────
-- Brings the round's latest rejected set back on offer, when the search after "None of these" found
-- nothing and no other can run. It only flips the ideas: the round stays generating, under its
-- lease, and the engine sends the heads-up and then finishes it, so a death in between loses no
-- email. Returns how many came back and how that search ended; 0 and null when nothing did.
--   p_now is the engine's clock, as in runs_after_rejection. A run counts as left only if a tick is
-- still to come before the ship-by day, the same day rule.
create function concierge.restore_rejected_ideas(p_round_id uuid, p_lock timestamptz, p_now timestamptz)
returns table (restored integer, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r concierge.gift_rounds;
  v_today date := (p_now at time zone 'utc')::date;
  v_outcome text;
  v_started timestamptz;
  v_set timestamptz;
  v_count integer;
begin
  select * into r from concierge.gift_rounds where id = p_round_id;
  -- The person's lock first, as start_idea_run and save_ideas take it, so a run can't start or
  -- save in between; then the round's row.
  if found then
    perform pg_advisory_xact_lock(hashtext(r.person_id::text));
  end if;
  select * into r from concierge.gift_rounds where id = p_round_id for update;
  if not found or p_lock is null or r.locked_until is distinct from p_lock then
    raise exception 'restore_rejected_ideas: lease not held' using errcode = 'P0001';
  end if;

  if concierge.setting_int('restore_rejected_ideas_enabled') is distinct from 1
     or concierge.setting_int('round_engine_enabled') is distinct from 1
     or concierge.setting_int('idea_engine_enabled') is distinct from 1
     or r.status <> 'generating' or r.closed_at is not null
     or v_today >= r.ship_by_deadline
     or exists (select 1 from concierge.gift_ideas i where i.round_id = p_round_id and i.status <> 'rejected')
     -- A run still going; one whose lease ran out has died. Without the setting we can't tell.
     or concierge.setting_int('idea_run_lease_ms') is null
     or exists (select 1 from concierge.idea_runs u
                 where u.round_id = p_round_id and u.finished_at is null
                   and u.started_at > p_now - make_interval(secs => concierge.setting_int('idea_run_lease_ms') / 1000.0))
     or not exists (
       select 1 from concierge.round_idea_state(p_round_id) s
        where s.paid and (not s.runs_left or v_today + 1 >= r.ship_by_deadline)) then
    return query select 0, null::text;
    return;
  end if;

  -- A run with no outcome, past its lease (checked above), was killed: it failed.
  select coalesce(u.outcome, 'failed'), u.started_at into v_outcome, v_started
    from concierge.idea_runs u
   where u.round_id = p_round_id and u.outcome is distinct from 'no_credit'
   order by u.started_at desc, u.id desc
   limit 1;
  -- One "None of these" saves its rejections in one transaction, so they share a created_at. Not a
  -- row that only notes a gift still on offer.
  select max(j.created_at) into v_set
    from concierge.rejections j
    join concierge.gift_ideas i on i.id = j.idea_id
   where j.round_id = p_round_id and i.status = 'rejected';
  if v_outcome is null or v_outcome not in ('none', 'failed', 'cost_cap', 'deadline')
     -- A search must have run since that set was rejected.
     or v_set is null or v_started <= v_set then
    return query select 0, null::text;
    return;
  end if;

  update concierge.gift_ideas i
     set status = 'proposed',
         -- The budget may have been set or changed since.
         over_budget = coalesce(i.est_total_cents > r.budget_cents, false)
   where i.round_id = p_round_id and i.status = 'rejected'
     and exists (select 1 from concierge.rejections j where j.idea_id = i.id and j.created_at = v_set)
     -- They already have it: named in "Already has one", or an AI idea an active fact names (the
     -- only record of rejections made before `owned`). The fact's value is the title, trimmed and
     -- cut at 500 characters (rejectionFacts).
     and not exists (select 1 from concierge.rejections j where j.idea_id = i.id and j.owned)
     and not (i.source = 'generated' and exists (
       select 1 from concierge.profile_facts f
        where f.person_id = r.person_id and f.user_id = r.user_id and f.category = 'owns' and f.active
          and f.value_key = lower(regexp_replace(btrim(left(regexp_replace(i.title, '^\s+|\s+$', '', 'g'), 500)), '\s+', ' ', 'g'))))
     -- Ordered before, whatever came of it.
     and not exists (select 1 from concierge.orders o where o.idea_id = i.id)
     -- The same product given to the person elsewhere, matched as excluded_offers does (an idea
     -- saved without a retailer is Amazon's).
     and not exists (
       select 1
         from concierge.gift_ideas g
         left join concierge.gift_rounds gr on gr.id = g.round_id
         join concierge.orders o on o.idea_id = g.id
        where coalesce(g.person_id, gr.person_id) = r.person_id
          and concierge.order_is_given(o.status, o.resolved)
          and g.retailer_product_id = i.retailer_product_id
          and lower(coalesce(g.retailer, 'amazon')) = lower(coalesce(i.retailer, 'amazon')))
     -- A list gift on any of this buyer's orders, or claimed, or no longer shared: approve_round
     -- would refuse it.
     and (i.list_item_id is null
          or (lists.item_shared(i.list_item_id, r.person_id)
              and lists.claim_holder(i.list_item_id, r.user_id) = 'none'
              and not exists (
                select 1
                  from concierge.gift_ideas g
                  join concierge.orders o on o.idea_id = g.id
                 where g.user_id = r.user_id and g.list_item_id = i.list_item_id
                   and concierge.order_is_given(o.status, o.resolved))))
     -- canArriveInTime, ordered today. Unknown days, or a missing setting, count as can't.
     and v_today + i.handling_days_max + i.delivery_days_max <= r.occasion_date - concierge.setting_int('safety_buffer_days');
  get diagnostics v_count = row_count;

  return query select v_count, case when v_count > 0 then v_outcome end;
end;
$$;

revoke all on function concierge.restore_rejected_ideas(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function concierge.restore_rejected_ideas(uuid, timestamptz, timestamptz) to service_role;
