-- Local-only data, loaded by `supabase db reset` after the migrations
-- (supabase/config.toml, db.seed). Never pushed to dev or production.

-- Ordering ships switched off in the migration, so `db push` never turns it
-- on; local talks to a fake Zinc, so it is on here (ALL-32, AC-17).
update concierge.app_settings set value = '1' where key = 'zinc_ordering_enabled';
