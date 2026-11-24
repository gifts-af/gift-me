-- When a gift leaves the "Gifts in progress" list: nothing says a gift arrived if tracking never
-- does, so without this its row would stay for good (T23).
insert into concierge.app_settings (key, value, description) values
  ('gift_progress_days', '14',
   'How many days a bought gift stays in Gifts in progress: after it was delivered, or after the later of the occasion and its due day when it was never marked delivered.')
on conflict (key) do nothing;
