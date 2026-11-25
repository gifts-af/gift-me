-- The concierge is by request: each account carries a flag for being let in,
-- and the date it asked, which also paces how many ask per day. Add-only (E7).
-- Neither column is in the grants users have on concierge.accounts beyond
-- select, so nobody can let themselves in or fake a request.
alter table concierge.accounts
  add column concierge_access boolean not null default false,
  add column access_requested_at timestamptz;

comment on column concierge.accounts.concierge_access is
  'Let into the concierge. Set by the server only: a request is claimed, or an admin turns it on.';
comment on column concierge.accounts.access_requested_at is
  'When this person asked for access; null when they have not, or the request was released.';

-- Select is granted column by column since the Zinc wallet migration, so the
-- new columns stay hidden until granted. No insert or update grant is added.
grant select (concierge_access, access_requested_at) on concierge.accounts to authenticated;

-- Everyone who has an account today keeps the concierge. A new row takes the
-- column defaults, today's default over-budget % included.
insert into concierge.accounts (user_id, concierge_access)
select id, true from auth.users
on conflict (user_id) do update set concierge_access = true;

-- The one check the concierge's entry points go through. Runs as the caller: a
-- signed-in user sees only their own flag, the server sees anyone's, and no
-- account row means off.
create function concierge.has_concierge_access(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select a.concierge_access from concierge.accounts a where a.user_id = p_user_id),
    false
  );
$$;

revoke execute on function concierge.has_concierge_access(uuid) from public, anon;
grant execute on function concierge.has_concierge_access(uuid) to authenticated, service_role;

-- Asks for access. Returns 'already' when a request is on file or access is on,
-- 'busy' when concierge_requests_per_day requests came in over the last 24
-- hours, otherwise records the request and returns 'claimed'. One lock makes
-- the count safe when several people ask at once.
create function concierge.claim_access_request(p_user_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_cap integer := concierge.setting_int('concierge_requests_per_day');
  v_account concierge.accounts;
begin
  if v_cap is null then
    raise exception 'concierge_requests_per_day is missing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('concierge.claim_access_request', 0));

  select * into v_account from concierge.accounts where user_id = p_user_id;
  if found and (v_account.concierge_access or v_account.access_requested_at is not null) then
    return 'already';
  end if;

  if (select count(*) from concierge.accounts where access_requested_at > now() - interval '24 hours') >= v_cap then
    return 'busy';
  end if;

  insert into concierge.accounts (user_id, access_requested_at)
  values (p_user_id, now())
  on conflict (user_id) do update set access_requested_at = now();
  return 'claimed';
end;
$$;

-- Gives a request back, when what came after it (the email) didn't go out.
create function concierge.release_access_request(p_user_id uuid)
returns void
language sql
set search_path = ''
as $$
  update concierge.accounts set access_requested_at = null
  where user_id = p_user_id and not concierge_access;
$$;

-- Takes access away, but never from someone with money or a gift in flight:
-- paid features, a saved Zinc key, or a round that isn't finished.
create function concierge.turn_off_concierge_access(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_account concierge.accounts;
begin
  select * into v_account from concierge.accounts where user_id = p_user_id for update;
  if not found then
    return;
  end if;

  if v_account.paid_features or v_account.zinc_api_key_secret_id is not null then
    raise exception 'This account has paid features or a Zinc key, so access stays on';
  end if;
  if exists (
    select 1 from concierge.gift_rounds r
    where r.user_id = p_user_id and r.status not in ('complete', 'skipped')
  ) then
    raise exception 'This account has a gift round in progress, so access stays on';
  end if;

  update concierge.accounts set concierge_access = false, access_requested_at = null
  where user_id = p_user_id;
end;
$$;

revoke execute on function concierge.claim_access_request(uuid) from public, anon, authenticated;
revoke execute on function concierge.release_access_request(uuid) from public, anon, authenticated;
revoke execute on function concierge.turn_off_concierge_access(uuid) from public, anon, authenticated;
grant execute on function concierge.claim_access_request(uuid) to service_role;
grant execute on function concierge.release_access_request(uuid) to service_role;
grant execute on function concierge.turn_off_concierge_access(uuid) to service_role;

insert into concierge.app_settings (key, value, description) values
  ('google_import_enabled', '0', 'Switch for importing contacts from Google: 1 on, 0 off.'),
  ('concierge_requests_per_day', '10', 'Most requests for concierge access taken in 24 hours; more get a try-again-later answer.');

-- Amazon lookups cost money per call, so open sign-up gets a lower allowance.
update concierge.app_settings set value = '10' where key = 'amazon_paste_lookups_per_user_per_day';
update concierge.app_settings set value = '200' where key = 'amazon_paste_lookups_per_day_total';
