-- Zinc webhook hardening (ALL-32). Expand-only (E7).
-- zinc_webhook_max_bytes caps a webhook body; zinc_wallet_event_at is the time of the last
-- wallet.auto_topup.* event applied, so a replayed or late older event can't undo newer state.
-- The column is server-only: select is granted column by column and this one is not granted.
insert into concierge.app_settings (key, value, description) values
  ('zinc_webhook_max_bytes', '65536', 'Largest Zinc webhook body the route will read, in bytes; bigger ones get 413 (ALL-32).')
on conflict (key) do nothing;

alter table concierge.accounts
  add column zinc_wallet_event_at timestamptz;
