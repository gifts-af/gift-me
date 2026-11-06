-- Connecting Zinc from Settings (ALL-32, Task 4): the poll hold after Zinc answers,
-- and the top-up fee wording's numbers (T23). Expand-only (E7).

insert into concierge.app_settings (key, value, description) values
  ('zinc_topup_fee_bps', '290', 'Zinc''s card top-up fee, percent in basis points (290 = 2.9%). Shown in the Settings auto top-up guide.'),
  ('zinc_topup_fee_fixed_cents', '30', 'Zinc''s card top-up fee, fixed part in cents. Shown in the Settings auto top-up guide.')
on conflict (key) do nothing;

-- After Zinc answers a device-token poll, hold the next poll for one Zinc interval, counted from now.
-- Only the attempt that was polled is touched: an old poll can't change a newer attempt (a fresh
-- device code means a different row state), so it matches on the device code.
create function concierge.zinc_release_poll(p_user_id uuid, p_device_code text, p_interval_sec integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update concierge.zinc_connect_attempts
     set interval_sec = p_interval_sec,
         polling_until = now() + make_interval(secs => p_interval_sec)
   where user_id = p_user_id and device_code = p_device_code and p_interval_sec > 0;
$$;

revoke all on function concierge.zinc_release_poll(uuid, text, integer) from public, anon, authenticated;
grant execute on function concierge.zinc_release_poll(uuid, text, integer) to service_role;
