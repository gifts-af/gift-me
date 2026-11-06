-- The tick's retry of "we couldn't buy it" emails (ALL-32 re-review): read
-- only the late failures whose email isn't recorded yet, instead of every
-- order that ever failed after its round closed. A partial index keeps the
-- scan to those orders. New function and index only (expand, E7).

create index orders_failed_after_close_idx on concierge.orders (round_id) where failed_after_close;

create function concierge.rounds_missing_late_failure_email()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct o.round_id
    from concierge.orders o
   where o.failed_after_close
     and o.status = 'failed'
     and not exists (select 1 from concierge.round_sends s
                      where s.round_id = o.round_id and s.step = 'late_fail:' || o.id);
$$;

revoke all on function concierge.rounds_missing_late_failure_email() from public, anon, authenticated;
grant execute on function concierge.rounds_missing_late_failure_email() to service_role;
