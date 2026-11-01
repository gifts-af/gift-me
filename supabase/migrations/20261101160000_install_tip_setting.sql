-- How long "Not now" hides the "Add GiftsAF to your Home Screen" tip (ALL-57).
insert into concierge.app_settings (key, value, description) values
  ('install_tip_snooze_days', '14', 'Days the Home Screen install tip stays hidden after "Not now".')
on conflict (key) do nothing;
