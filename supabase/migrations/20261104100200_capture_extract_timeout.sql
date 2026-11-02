-- How long one capture's model call may take before it counts as failed
-- (ALL-25 review). Below the capture routes' 60 s maxDuration, so a slow model
-- gives the popup "Couldn't read this page" instead of a timed-out save.
insert into concierge.app_settings (key, value, description) values
  ('capture_extract_timeout_ms', '40000', 'Most time (ms) one capture''s AI read may take before it''s marked failed. Keep under 60000.')
on conflict (key) do nothing;
