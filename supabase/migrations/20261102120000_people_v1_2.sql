-- People v1.2 (ALL-21): what the people screens need beyond v1.1.
--
-- * birth_year on a person (the app shows an age; the day and month live on
--   the birthday occasion), and photo_path for a profile photo (decision 46).
-- * people.birthday goes: only occasion rows hold birthdays (nothing reads it).
-- * One live occasion per kind for a person, so "Birthday" can't appear twice.
-- * A private Storage bucket for the photos, one folder per buyer.
-- * add_person saves a person and their occasions in one transaction.

-- ─── people ─────────────────────────────────────────────────────────────────

alter table public.people drop column birthday;

alter table public.people
  add column birth_year smallint check (birth_year between 1900 and 2100),
  -- Storage object name in the person-photos bucket, or null for no photo.
  add column photo_path text;

-- Column grants are per column, so both new columns are listed. linked_user_id
-- stays out: only the server links a person to someone's account.
revoke insert, update on public.people from authenticated;
grant insert (name, relationship, birth_year, photo_path, recipient_first_name, recipient_last_name,
              address_line1, address_line2, city, state, zip, country, phone, address_checked_at,
              notes, google_contact_id)
  on public.people to authenticated;
grant update (name, relationship, birth_year, photo_path, recipient_first_name, recipient_last_name,
              address_line1, address_line2, city, state, zip, country, phone, address_checked_at,
              notes, google_contact_id)
  on public.people to authenticated;

-- ─── occasions ──────────────────────────────────────────────────────────────

-- If a person somehow has two live occasions of one kind, keep the oldest so
-- the unique index below can be built. Soft-deleted rows are left alone.
update concierge.occasions o
   set deleted_at = now()
 where o.deleted_at is null
   and exists (
     select 1 from concierge.occasions k
      where k.person_id = o.person_id and k.kind = o.kind and k.deleted_at is null
        and (k.created_at, k.id) < (o.created_at, o.id)
   );

-- Partial, so a soft-deleted occasion doesn't block adding that kind again.
create unique index occasions_person_kind_key
  on concierge.occasions (person_id, kind) where deleted_at is null;

-- ─── add_person ─────────────────────────────────────────────────────────────

-- Saves a person and one enabled occasion per kind. Runs as the caller (no
-- security definer), so row-level security applies and user_id is the
-- caller's. The birthday and anniversary dates go on those kinds' rows; a
-- birthday or anniversary without a month and day fails the occasions check
-- (23514) and the whole call rolls back.
create function concierge.add_person(
  p_name text,
  p_relationship text,
  p_kinds text[],
  p_birthday_month int,
  p_birthday_day int,
  p_birth_year int,
  p_anniversary_month int,
  p_anniversary_day int
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
begin
  insert into public.people (name, relationship, birth_year)
  values (p_name, p_relationship, p_birth_year)
  returning id into v_person_id;

  insert into concierge.occasions (person_id, kind, month, day)
  select v_person_id,
         k,
         case k when 'birthday' then p_birthday_month when 'anniversary' then p_anniversary_month end,
         case k when 'birthday' then p_birthday_day when 'anniversary' then p_anniversary_day end
    from unnest(coalesce(p_kinds, '{}'::text[])) as k;

  return v_person_id;
end;
$$;

revoke execute on function concierge.add_person(text, text, text[], int, int, int, int, int)
  from public, anon;
grant execute on function concierge.add_person(text, text, text[], int, int, int, int, int)
  to authenticated;

-- ─── profile photos ─────────────────────────────────────────────────────────

-- Private: photos are shown through signed links. Objects are named
-- <user_id>/<person_id>/<random>.jpg, and the policies below let a buyer touch
-- only their own folder.
insert into storage.buckets (id, name, public)
values ('person-photos', 'person-photos', false)
on conflict (id) do nothing;

create policy person_photos_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy person_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy person_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy person_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ─── settings (T23) ─────────────────────────────────────────────────────────

insert into concierge.app_settings (key, value, description) values
  ('person_photo_max_upload_bytes', '10485760', 'Largest profile photo file the picker accepts, in bytes (10 MB).'),
  ('person_photo_px', '512', 'Longest side, in pixels, of a stored profile photo.')
on conflict (key) do nothing;
