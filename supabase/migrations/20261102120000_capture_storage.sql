-- Capture storage for the Chrome extension (ALL-22): a private bucket for
-- screenshots (one folder per user), an optional note on each capture, and
-- the size limits the capture endpoint enforces.

insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

create policy captures_select_own on storage.objects for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy captures_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy captures_update_own on storage.objects for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy captures_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table concierge.captures add column note text check (char_length(note) <= 2000);

insert into concierge.app_settings (key, value, description) values
  ('capture_text_max_chars', '20000', 'Most page text (characters) a capture may carry.'),
  ('capture_screenshot_max_bytes', '2500000', 'Largest capture screenshot, in bytes.')
on conflict (key) do nothing;
