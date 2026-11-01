-- Google Contacts import (ALL-24): add_person also saves the Google contact id
-- and the address from the contact, and a person can be imported from a given
-- Google contact only once (while they're not deleted). The address is saved
-- unchecked; the first order that needs it checks it (design §6.1).

drop function concierge.add_person(text, text, text[], int, int, int, int, int);

create function concierge.add_person(
  p_name text,
  p_relationship text,
  p_kinds text[],
  p_birthday_month int default null,
  p_birthday_day int default null,
  p_birth_year int default null,
  p_anniversary_month int default null,
  p_anniversary_day int default null,
  p_google_contact_id text default null,
  p_recipient_first_name text default null,
  p_recipient_last_name text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_zip text default null,
  p_country text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
begin
  insert into public.people (name, relationship, birth_year, google_contact_id, recipient_first_name,
                             recipient_last_name, address_line1, address_line2, city, state, zip, country)
  values (p_name, p_relationship, p_birth_year, p_google_contact_id, p_recipient_first_name,
          p_recipient_last_name, p_address_line1, p_address_line2, p_city, p_state, p_zip, coalesce(p_country, 'US'))
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

revoke execute on function concierge.add_person(text, text, text[], int, int, int, int, int,
  text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function concierge.add_person(text, text, text[], int, int, int, int, int,
  text, text, text, text, text, text, text, text, text) to authenticated;

-- One live person per user per Google contact, so two imports at once can't
-- add someone twice.
create unique index people_user_google_contact_key on public.people (user_id, google_contact_id)
  where google_contact_id is not null and deleted_at is null;

-- Copying contact photos (T23): each Google photo fetch gives up after this
-- long, and this many are copied at once, so one slow photo can't stall an
-- import.
insert into concierge.app_settings (key, value, description) values
  ('contact_photo_timeout_ms', '4000', 'How long to wait for one Google contact photo when importing, in milliseconds.'),
  ('contact_photo_concurrency', '6', 'How many Google contact photos an import copies at once.')
on conflict (key) do nothing;
