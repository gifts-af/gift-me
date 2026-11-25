-- Storage limits, now that anyone can sign up: any account can upload straight
-- to these two buckets, which had no size or type limit. Each ceiling sits
-- above the setting the app checks (person_photo_stored_max_bytes,
-- capture_screenshot_max_bytes), as list-photos' does. They hold for the
-- server's uploads (emailed notes) too.
update storage.buckets
   set file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'person-photos';
update storage.buckets
   set file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'captures';

insert into concierge.app_settings (key, value, description) values
  ('person_photo_stored_max_bytes', '1000000', 'Largest profile photo copied in from Google Contacts, in bytes. Keep it under the person-photos bucket''s limit.'),
  ('storage_files_per_account', '500', 'Most files an account without concierge access may keep in each of the person-photos and captures buckets.');

-- Whether the signed-in user may add a file to a bucket: they have concierge
-- access, or their own folder there is under the cap. A missing setting says
-- no. Definer, because a policy on storage.objects that read storage.objects
-- itself would recurse. It's a soft cap: uploads at the same moment can each
-- see room.
create function concierge.may_store_file(p_bucket text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select concierge.has_concierge_access(auth.uid())
      or coalesce(
        (select count(*) from storage.objects o
          where o.bucket_id = p_bucket
            and (storage.foldername(o.name))[1] = auth.uid()::text)
        < concierge.setting_int('storage_files_per_account'),
        false
      );
$$;

revoke execute on function concierge.may_store_file(text) from public, anon, service_role;
grant execute on function concierge.may_store_file(text) to authenticated;

-- The own-folder checks stay as they were. The update policies get the cap too,
-- or files could be moved from one bucket into the other to make room.
drop policy captures_insert_own on storage.objects;
create policy captures_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select concierge.may_store_file(bucket_id))
  );
drop policy captures_update_own on storage.objects;
create policy captures_update_own on storage.objects for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select concierge.may_store_file(bucket_id))
  );

drop policy person_photos_insert_own on storage.objects;
create policy person_photos_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'person-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select concierge.may_store_file(bucket_id))
  );
drop policy person_photos_update_own on storage.objects;
create policy person_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'person-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select concierge.may_store_file(bucket_id))
  );
