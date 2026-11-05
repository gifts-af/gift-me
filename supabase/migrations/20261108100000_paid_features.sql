-- Paid features are for test and admin users until premium is scoped
-- (ALL-94, decision 53). Add-only (E7). The column isn't in the grants users
-- have on concierge.accounts, so nobody can turn it on for themselves.
alter table concierge.accounts
  add column paid_features boolean not null default false;

comment on column concierge.accounts.paid_features is
  'Test and admin users. Set by an admin only: see README > Environments.';

-- The one check everything that spends money goes through, so premium can
-- replace it here. Runs as the caller: a signed-in user sees only their own
-- flag, the server sees anyone's, and no account row means off.
create function concierge.has_paid_features(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select a.paid_features from concierge.accounts a where a.user_id = p_user_id),
    false
  );
$$;

revoke execute on function concierge.has_paid_features(uuid) from public, anon;
grant execute on function concierge.has_paid_features(uuid) to authenticated, service_role;

insert into concierge.app_settings (key, value, description) values
  ('capture_read_estimate_cents', '2', 'The rough cost of reading one capture, shown in the alpha money notice (spike: about 1 cent for text, 1 for a screenshot).');
