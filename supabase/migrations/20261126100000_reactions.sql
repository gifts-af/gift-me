-- Reactions: how each delivered gift went over, the facts that teaches, when
-- the buyer is asked, and the round's last move, delivered → complete.
-- Expand-only (E7): four columns, two keys, a trigger, settings and new functions.
--
-- - One reaction per order, and it carries the order's own round and user.
-- - save_reaction and close_reacted_rounds are the only writers of `complete`
--   (T91). Both lock the round first, like every writer of round status (T14),
--   set status and next_action_at together and leave closed_at alone.
--   reconcile_round already leaves delivered and complete rounds as they are.
-- - The close follows the round's dates, not whether an email went, so a
--   refused email can't leave a round open forever.

-- ─── settings (T23, E7) ─────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('reactions_enabled', '1', 'Asking how gifts went over, saving the answers and closing rounds. 0 asks nothing, closes nothing and refuses answers; gift history still shows. Turning it back on after a long gap closes the waiting rounds without asking.'),
  ('reaction_prompt_after_days', '1', 'How many days after the latest of the occasion, the last gift arriving and the round becoming delivered the buyer is asked how it went.'),
  ('reaction_close_days', '7', 'How many days after that a delivered round closes, answered or not.'),
  ('reaction_note_max_chars', '500', 'The longest note a buyer can leave with an answer, in characters.')
on conflict (key) do nothing;

-- ─── columns ────────────────────────────────────────────────────────────────
alter table concierge.orders add constraint orders_id_round_id_user_id_key unique (id, round_id, user_id);

alter table concierge.reactions
  -- Nullable for rows from before answers were per gift.
  add column order_id uuid unique,
  -- The fact this reaction wrote, exactly as written, so a changed rating can
  -- tell whether the buyer has touched it since. Null when it wrote none.
  add column fact_category text,
  add column fact_value text,
  add constraint reactions_fact_both_or_neither check ((fact_category is null) = (fact_value is null)),
  -- A reaction can't pair one round with another's order.
  add foreign key (order_id, round_id, user_id) references concierge.orders (id, round_id, user_id) on delete cascade;

-- ─── gift_rounds.delivered_at ───────────────────────────────────────────────
-- When the round became delivered. That can be later than its last delivery: the
-- store can cancel a gift after the others arrived. Null on rounds delivered
-- before this column. A trigger sets it, whoever writes the status, and
-- gift_rounds is granted column by column, so users can't read or write it.
alter table concierge.gift_rounds add column delivered_at timestamptz;

create function concierge.set_round_delivered_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status <> 'delivered') then
    new.delivered_at := now();
  end if;
  return new;
end;
$$;
revoke all on function concierge.set_round_delivered_at() from public, anon, authenticated;

create trigger set_delivered_at before insert or update of status on concierge.gift_rounds
  for each row execute function concierge.set_round_delivered_at();

-- ─── round_sends: the reaction_prompt step ──────────────────────────────────
-- Copied from 20261124110000_order_tracking.sql; only reaction_prompt is new.
alter table concierge.round_sends drop constraint round_sends_step_check;
alter table concierge.round_sends
  add constraint round_sends_step_check check (
    step ~ '^(heads_up|reminder_[12]|final_notice|skipped|address_request|address_reminder_[12]|address_final_notice|hold_trouble|missed_on_us|held_cancelled|shared_address|no_ideas|no_ideas_again|delivered|reaction_prompt)$'
    or step ~ '^(heads_up|reminder_[12]|final_notice|no_ideas|no_ideas_again)@[0-9]+$'
    or step ~ '^hold:[0-9]+:(notice|reminder|final|deadline)$'
    or step ~ '^hold:[0-9]+:short:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or step ~ '^fail:[0-9]+:notice$'
    or step ~ '^(fail|ordered|late_fail):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or step ~ '^(late|ontime|cancel_late):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- ─── what the functions below share ─────────────────────────────────────────
-- The day the buyer is asked: reaction_prompt_after_days after the latest of the
-- occasion, the UTC day the last gift arrived and the UTC day the round became
-- delivered. Null without the setting.
create function concierge.reaction_asked_on(p_round_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(g.occasion_date,
                  (g.delivered_at at time zone 'utc')::date,
                  (select max((o.delivered_at at time zone 'utc')::date)
                     from concierge.orders o
                    where o.round_id = g.id and o.status = 'delivered'))
         + concierge.setting_int('reaction_prompt_after_days')
    from concierge.gift_rounds g
   where g.id = p_round_id;
$$;

create function concierge.has_unanswered_gift(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from concierge.orders o
     where o.round_id = p_round_id and o.status = 'delivered'
       and not exists (select 1 from concierge.reactions x where x.order_id = o.id));
$$;

-- ─── save_reaction ──────────────────────────────────────────────────────────
-- Saves one gift's answer, or changes it, and returns the round's status after.
-- Closes a delivered round once every delivered gift has an answer.
--
-- The fact (category and value, or both null) is used only when the rating is
-- new or changed, so a note edit or a repeat save can't bring back a fact the
-- buyer turned off, deleted or edited. A changed rating removes the old fact
-- only if it's still exactly as this reaction wrote it. A fact the person
-- already has is left as it is, and isn't this reaction's to remove later.
--
-- The checks here raise P0001 'save_reaction: ...'. A fact over the length limit
-- is refused by profile_facts' own check (23514). Either way nothing is written.
create function concierge.save_reaction(p_user_id uuid, p_order_id uuid, p_rating text, p_note text,
                                        p_fact_category text, p_fact_value text, p_today date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled integer := concierge.setting_int('reactions_enabled');
  v_note_max integer := concierge.setting_int('reaction_note_max_chars');
  v_note text := nullif(btrim(p_note, E' \t\r\n'), '');
  v_round_id uuid;
  r concierge.gift_rounds;
  v_old concierge.reactions;
  v_reaction_id uuid;
begin
  if v_enabled is null then
    raise exception 'save_reaction: missing setting reactions_enabled';
  end if;
  if v_note_max is null then
    raise exception 'save_reaction: missing setting reaction_note_max_chars';
  end if;
  if v_enabled <> 1 then
    raise exception 'save_reaction: off' using errcode = 'P0001';
  end if;
  if p_rating is null or p_rating not in ('loved', 'liked', 'meh', 'returned') then
    raise exception 'save_reaction: bad rating' using errcode = 'P0001';
  end if;
  if char_length(v_note) > v_note_max then
    raise exception 'save_reaction: note too long' using errcode = 'P0001';
  end if;
  if (p_fact_category is null) <> (p_fact_value is null) or p_fact_category not in ('loved', 'avoid') then
    raise exception 'save_reaction: bad fact' using errcode = 'P0001';
  end if;

  select o.round_id into v_round_id from concierge.orders o where o.id = p_order_id and o.user_id = p_user_id;
  if v_round_id is null then
    raise exception 'save_reaction: not found' using errcode = 'P0001';
  end if;
  select * into r from concierge.gift_rounds where id = v_round_id for update;
  if not exists (select 1 from concierge.orders o where o.id = p_order_id and o.status = 'delivered') then
    raise exception 'save_reaction: not delivered' using errcode = 'P0001';
  end if;
  if p_today is null or p_today < r.occasion_date then
    raise exception 'save_reaction: before the occasion' using errcode = 'P0001';
  end if;

  -- The round's lock makes a double tap run one after the other.
  select * into v_old from concierge.reactions x where x.order_id = p_order_id;
  if v_old.rating = p_rating then
    update concierge.reactions set note = v_note, source = 'web' where id = v_old.id;
  else
    if v_old.id is null then
      insert into concierge.reactions (user_id, round_id, order_id, rating, note, source)
      values (p_user_id, v_round_id, p_order_id, p_rating, v_note, 'web')
      returning id into v_reaction_id;
    else
      v_reaction_id := v_old.id;
      delete from concierge.profile_facts f
       where f.person_id = r.person_id and f.source = 'reaction' and f.source_id = v_old.id and f.active
         and f.category = v_old.fact_category and f.value = v_old.fact_value;
      update concierge.reactions
         set rating = p_rating, note = v_note, source = 'web', fact_category = null, fact_value = null
       where id = v_old.id;
    end if;

    if p_fact_category is not null
       and exists (select 1 from public.people p where p.id = r.person_id and p.deleted_at is null) then
      insert into concierge.profile_facts (user_id, person_id, category, value, source, source_id, confirmed)
      values (p_user_id, r.person_id, p_fact_category, p_fact_value, 'reaction', v_reaction_id, true)
      on conflict (person_id, category, value_key) do nothing;
      if found then
        update concierge.reactions set fact_category = p_fact_category, fact_value = p_fact_value where id = v_reaction_id;
      end if;
    end if;
  end if;

  if r.status = 'delivered' and not concierge.has_unanswered_gift(v_round_id) then
    update concierge.gift_rounds set status = 'complete', next_action_at = null where id = v_round_id;
    return 'complete';
  end if;
  return r.status::text;
end;
$$;

-- ─── reactions_due ──────────────────────────────────────────────────────────
-- The rounds to ask about today: from the asked-on day until the close date,
-- once each. A removed occasion is still asked about; a removed person isn't.
create function concierge.reactions_due(p_today date)
returns table (round_id uuid, user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled integer := concierge.setting_int('reactions_enabled');
  v_close_days integer := concierge.setting_int('reaction_close_days');
begin
  if v_enabled is null then
    raise exception 'reactions_due: missing setting reactions_enabled';
  end if;
  if concierge.setting_int('reaction_prompt_after_days') is null then
    raise exception 'reactions_due: missing setting reaction_prompt_after_days';
  end if;
  if v_close_days is null then
    raise exception 'reactions_due: missing setting reaction_close_days';
  end if;
  if v_enabled <> 1 then
    return;
  end if;

  return query
  select g.id, g.user_id
    from concierge.gift_rounds g
    join public.people p on p.id = g.person_id
    cross join lateral concierge.reaction_asked_on(g.id) as d (asked_on)
   where g.status = 'delivered'
     and p.deleted_at is null
     and d.asked_on <= p_today
     and p_today < d.asked_on + v_close_days
     and concierge.has_unanswered_gift(g.id)
     and not exists (select 1 from concierge.round_sends s where s.round_id = g.id and s.step = 'reaction_prompt');
end;
$$;

-- ─── close_reacted_rounds ───────────────────────────────────────────────────
-- Closes the delivered rounds whose gifts are all answered (the last answer can
-- come before another gift arrives), and those past their close date. Returns
-- how many. Each round is locked, then checked again, so a save, a delivery or
-- a store cancel that got there first counts.
create function concierge.close_reacted_rounds(p_today date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled integer := concierge.setting_int('reactions_enabled');
  v_close_days integer := concierge.setting_int('reaction_close_days');
  v_id uuid;
  v_closed integer := 0;
begin
  if v_enabled is null then
    raise exception 'close_reacted_rounds: missing setting reactions_enabled';
  end if;
  if concierge.setting_int('reaction_prompt_after_days') is null then
    raise exception 'close_reacted_rounds: missing setting reaction_prompt_after_days';
  end if;
  if v_close_days is null then
    raise exception 'close_reacted_rounds: missing setting reaction_close_days';
  end if;
  if v_enabled <> 1 then
    return 0;
  end if;

  for v_id in
    select g.id
      from concierge.gift_rounds g
     where g.status = 'delivered'
       and (not concierge.has_unanswered_gift(g.id) or p_today >= concierge.reaction_asked_on(g.id) + v_close_days)
     order by g.id
  loop
    perform 1 from concierge.gift_rounds where id = v_id for update;
    update concierge.gift_rounds g
       set status = 'complete', next_action_at = null
     where g.id = v_id
       and g.status = 'delivered'
       and (not concierge.has_unanswered_gift(g.id) or p_today >= concierge.reaction_asked_on(g.id) + v_close_days);
    if found then
      v_closed := v_closed + 1;
    end if;
  end loop;
  return v_closed;
end;
$$;

-- ─── grants: the server only ────────────────────────────────────────────────
revoke all on function concierge.reaction_asked_on(uuid) from public, anon, authenticated;
revoke all on function concierge.has_unanswered_gift(uuid) from public, anon, authenticated;
revoke all on function concierge.save_reaction(uuid, uuid, text, text, text, text, date) from public, anon, authenticated;
revoke all on function concierge.reactions_due(date) from public, anon, authenticated;
revoke all on function concierge.close_reacted_rounds(date) from public, anon, authenticated;
grant execute on function concierge.save_reaction(uuid, uuid, text, text, text, text, date) to service_role;
grant execute on function concierge.reactions_due(date) to service_role;
grant execute on function concierge.close_reacted_rounds(date) to service_role;
