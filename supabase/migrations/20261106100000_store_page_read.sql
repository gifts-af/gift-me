-- Reading a pasted store link's page on the server for its name, price and
-- photo (ALL-10, planning decision 50, T52). The switch turns it off without a
-- deploy (E7): 0 = off, and pasting a link falls back to the name in the link.
insert into concierge.app_settings (key, value, description) values
  ('store_page_read_enabled', '1', 'Read a pasted store link''s page on the server for name, price and photo (ALL-10). 1 = on, 0 = off.'),
  ('store_page_read_timeout_ms', '8000', 'Most time (ms) the server waits for one store page before giving up.'),
  ('store_page_read_max_bytes', '5000000', 'Largest store page (bytes, after decompression) the server will read. Banana Republic pages are about 1.3 MB.')
on conflict (key) do nothing;
