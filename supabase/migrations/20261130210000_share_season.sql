-- The season shared lists lead with for signed-out visitors (ALL-191): "Make your
-- Christmas list. Free." on the card, and "Want your own Christmas list?" after a
-- guest's claim. Data only: no schema change.
--
-- On from share_season_start up to the day before share_season_end (dates are
-- YYYY-MM-DD). Off switch (E7): set share_season_end to a past date, and the
-- share page goes back to its everyday wording.

insert into concierge.app_settings (key, value, description) values
  ('share_season_name', '"Christmas"',
   'The season signed-out visitors to a shared list are asked to make their own list for, while it''s on.'),
  ('share_season_start', '"2026-11-01"',
   'First day (YYYY-MM-DD) shared lists show the season wording.'),
  ('share_season_end', '"2026-12-26"',
   'Day (YYYY-MM-DD) the season wording stops; a past date turns it off.')
on conflict (key) do nothing;
