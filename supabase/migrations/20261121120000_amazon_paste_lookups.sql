-- Amazon paste lookups through Zinc (ALL-141).
--
-- Pasting an Amazon link on My list asks Zinc for the product's real name,
-- price and photo, on the app's own Zinc key, so each lookup costs money.
-- Every signed-in person gets a daily allowance of them.
--
-- What this adds:
--   * lists.amazon_lookups, one row per lookup taken in the last day, written
--     only by take_amazon_lookup;
--   * lists.take_amazon_lookup(), which takes one lookup from the caller's
--     allowance, or says it's used up;
--   * the four settings: the off switch, the daily limit per person, the
--     daily ceiling across everyone, and the timeout.
--
-- Expand only (E7). The off switch is the amazon_paste_lookup_enabled setting.

create table lists.amazon_lookups (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The first counts a person's lookups; the second finds everyone's old rows
-- to delete.
create index amazon_lookups_user_created_idx on lists.amazon_lookups (user_id, created_at);
create index amazon_lookups_created_idx on lists.amazon_lookups (created_at);

-- Only take_amazon_lookup reads or writes it: new tables in `lists` are
-- granted to signed-in users by default, so take that back.
alter table lists.amazon_lookups enable row level security;
revoke all on lists.amazon_lookups from public, anon, authenticated;

-- Takes one Amazon lookup from the signed-in caller's allowance: true when
-- there was one left (and records it), false when the last 24 hours already
-- used amazon_paste_lookups_per_user_per_day for this person, or
-- amazon_paste_lookups_per_day_total across everyone. The limits are read
-- here, never passed in, so a caller can't raise them. Every person's rows
-- older than a day are deleted as it goes, so none linger (T42).
-- Locks: the ceiling's lock, then the person's, always in that order, so two
-- lookups can't deadlock. The ceiling's lock makes all lookups count one
-- after the other; the person's lock keeps that true for the per-person count
-- if the ceiling's lock is ever dropped.
-- Errors: 42501 not signed in; 22023 a limit setting is missing (no lookup
-- then, rather than no limit).
create function lists.take_amazon_lookup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_used integer;
  v_total integer;
  v_limit integer := concierge.setting_int('amazon_paste_lookups_per_user_per_day');
  v_ceiling integer := concierge.setting_int('amazon_paste_lookups_per_day_total');
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_limit is null then
    raise exception 'amazon_paste_lookups_per_user_per_day is missing' using errcode = '22023';
  end if;
  if v_ceiling is null then
    raise exception 'amazon_paste_lookups_per_day_total is missing' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lists.take_amazon_lookup:total', 0));
  perform pg_advisory_xact_lock(hashtextextended('lists.take_amazon_lookup:' || v_user::text, 0));

  delete from lists.amazon_lookups
  where created_at < now() - interval '1 day';

  select count(*) into v_used
  from lists.amazon_lookups
  where user_id = v_user and created_at >= now() - interval '1 day';

  if v_used >= v_limit then
    return false;
  end if;

  -- Old rows were just deleted, so every row left is from the last day.
  select count(*) into v_total from lists.amazon_lookups;
  if v_total >= v_ceiling then
    return false;
  end if;

  insert into lists.amazon_lookups (user_id) values (v_user);
  return true;
end;
$$;

revoke execute on function lists.take_amazon_lookup() from public, anon;
grant execute on function lists.take_amazon_lookup() to authenticated;

insert into concierge.app_settings (key, value, description) values
  ('amazon_paste_lookup_enabled', '1', 'Switch for Amazon paste lookups through Zinc (ALL-141): 1 on, 0 keeps a pasted Amazon link to what the link itself gives.'),
  ('amazon_paste_lookups_per_user_per_day', '30', 'Most Amazon paste lookups (Zinc product details calls) one person can make in 24 hours.'),
  ('amazon_paste_lookups_per_day_total', '2000', 'Most Amazon paste lookups across everyone in 24 hours, a ceiling on what they can cost in a day (each costs zinc_lookup_cents).'),
  ('amazon_paste_lookup_timeout_ms', '10000', 'How long an Amazon paste lookup waits for Zinc, in milliseconds.')
on conflict (key) do nothing;
