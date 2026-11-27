-- Card payments, launch step 1 (planning 66, revised by the owner 2026-11-27): the owner's
-- account alone moves to paying by card, for one real card order. Everyone else, Jim
-- included, and the column default stay on the wallet until that order passes (step 2).
--
-- switch_account_to_card switches one account only when nothing of it is still on the wallet
-- path: not connected to Zinc, and no wallet order held, placing, unconfirmed, placed or shipped
-- (a gift still on its way, whose events would reach the app webhook, which ignores wallet
-- orders), or failed and unresolved. Otherwise it changes nothing and says why. Card payments stay off
-- (connect_enabled 0) until the owner turns them on. Expand-only (E7): a new function and
-- one data change. Run on every environment; where the owner's account isn't ready or
-- doesn't exist, nothing changes, and the launch runbook (design/operations.md > Card
-- payments > Launch day) checks the result before card payments go on. On dev the owner's
-- dev account is switched too if it's ready; with connect_enabled 0 there, their dev
-- approvals then stop with connect_off until it's turned on or switched back. The function
-- stays for launch step 2.
create function concierge.switch_account_to_card(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select u.id from auth.users u where lower(u.email) = lower(p_email));
  a concierge.accounts;
begin
  if v_user is null then
    return 'no_account';
  end if;
  select * into a from concierge.accounts where user_id = v_user for update;
  if not found then
    return 'no_account';
  end if;
  if a.funding_mode = 'connect' then
    return 'already';
  end if;
  if a.zinc_connected_at is not null then
    return 'still_connected';
  end if;
  if exists (select 1 from concierge.orders o
              where o.user_id = v_user and o.funding_mode = 'zinc_wallet'
                and (o.status in ('held', 'placing', 'unconfirmed', 'placed', 'shipped') or (o.status = 'failed' and not o.resolved))) then
    return 'wallet_order_open';
  end if;
  update concierge.accounts set funding_mode = 'connect' where user_id = v_user;
  return 'switched';
end;
$$;
revoke all on function concierge.switch_account_to_card(text) from public, anon, authenticated;
grant execute on function concierge.switch_account_to_card(text) to service_role;

do $$
begin
  raise notice 'card launch step 1: %', concierge.switch_account_to_card('aaron.aallen@gmail.com');
end $$;
