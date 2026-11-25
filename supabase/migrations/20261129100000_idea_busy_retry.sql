-- When a fan-out job finds its round busy, it retries through a delayed queue
-- message. These two rows set how long it waits and how many times it tries.
insert into concierge.app_settings (key, value, description) values
  ('idea_busy_retry_seconds', '300', 'Seconds a fan-out job waits before retrying a round that was refused busy. 0 turns the retries off. Above 86400 (the queue keeps messages 24 hours) the send fails. Delay times retries should stay above idea_run_lease_ms.'),
  ('idea_busy_retries_max', '3', 'The most times a fan-out job retries a round refused busy before it gives up and leaves the round for the next tick. Delay times retries should stay above idea_run_lease_ms.')
on conflict (key) do nothing;
