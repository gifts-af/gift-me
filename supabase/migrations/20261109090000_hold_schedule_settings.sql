-- When a held gift's reminder and final emails go out (ALL-32).
insert into concierge.app_settings (key, value, description) values
  ('hold_reminder_days', '7', 'Days before the ship-by deadline that a held gift gets its reminder email (ALL-32).'),
  ('hold_final_days', '2', 'Days before the ship-by deadline that a held gift gets its final email (ALL-32).')
on conflict (key) do nothing;
