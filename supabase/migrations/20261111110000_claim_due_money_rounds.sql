-- The money path runs whatever round_engine_enabled says (ALL-32 final
-- review S6, owner decision): a customer is always told what is happening
-- with a purchase. With the engine switched off, the tick still sweeps
-- orders left placing, retries "ordered" emails, and moves on the rounds
-- that need attention (a hold or a failure). This claims those, and only
-- those, the way claim_due_rounds claims every due round. Round creation,
-- ideas and approval reminders stay switched off with the engine.
-- New function only (expand, E7).

create function concierge.claim_due_money_rounds(p_now timestamptz)
returns setof concierge.gift_rounds
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id from concierge.gift_rounds
    where next_action_at <= p_now
      and status = 'needs_attention'
      and (locked_until is null or locked_until < p_now)
    for update skip locked
  ),
  claimed as (
    update concierge.gift_rounds r
       set locked_until = p_now + make_interval(mins => concierge.setting_int('round_lock_minutes')),
           attempts = r.attempts + 1
      from due
     where r.id = due.id
    returning r.*
  )
  select * from claimed c
   order by (c.attention_reason in ('funds', 'setup', 'paused', 'not_allowed', 'retry')) desc,
            c.ship_by_deadline,
            c.next_action_at;
$$;

revoke all on function concierge.claim_due_money_rounds(timestamptz) from public, anon, authenticated;
grant execute on function concierge.claim_due_money_rounds(timestamptz) to service_role;
