-- Until the access gate ships (with this migration), an account made since the
-- first backfill could use the concierge, so it keeps it. Only accounts from
-- just before that backfill on: older ones got it then, and one turned off
-- since must not get it back. No record is kept of turning access off, and
-- nobody has had it turned off so far, so the date is the whole check.
insert into concierge.accounts (user_id, concierge_access)
select id, true from auth.users
where created_at >= '2026-11-25 16:30:00+00'
on conflict (user_id) do update set concierge_access = true;
