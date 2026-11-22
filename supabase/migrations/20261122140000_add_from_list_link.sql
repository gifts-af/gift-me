-- Opening someone's list link to add or link its owner (ALL-123, planning
-- decision 55).
--
--   * get_shared_list says whose list it is (owner_name: the owner's
--     profiles.display_name only, never an email or Google name, T42) and
--     which of the viewer's people is linked to it (linked_person).
--   * person_share_token gives a linked person's current share token, so their
--     "Their list" row can open the one list screen.
--   * link_unlinked_person links a person only when nothing is linked yet:
--     it never replaces a link, because a link decides where held gifts ship
--     (T26, T61), and it never links a second of the buyer's people to the
--     same list, which would mean two rounds for one human (T18).
--   * add_person takes an optional share token and creates and links the
--     person in one transaction.
--   * share_preview gives a link preview the owner's name and a gift count,
--     and never reads claims (decision 39).
--
-- Off switch (E7): app_settings.list_link_card_enabled. It's on only when the
-- value is 1, here and in the app; at anything else the owner's name is null
-- on the list and in the preview, and the app hides the card.

insert into concierge.app_settings (key, value, description) values
  ('list_link_card_enabled', '1',
   '1 shows the owner''s name on shared lists and previews, and the add/link card (ALL-123); 0 turns them off.')
on conflict (key) do nothing;

-- ─── get_shared_list ────────────────────────────────────────────────────────
-- Same as 20261028120000_hide_claims_from_owner.sql, plus card_enabled,
-- owner_name and linked_person. `create or replace` keeps the grants (anon, authenticated).

create or replace function lists.get_shared_list(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', l.title,
    'is_owner', coalesce(l.owner_id = auth.uid(), false),
    -- The off switch, for the page: a signed-out visitor can't read
    -- app_settings, and this runs as its owner (AC-25).
    'card_enabled', coalesce(concierge.setting_int('list_link_card_enabled'), 0) = 1,
    'owner_name', case
      when coalesce(concierge.setting_int('list_link_card_enabled'), 0) = 1 then (
        select nullif(trim(pr.display_name), '') from public.profiles pr where pr.id = l.owner_id
      )
    end,
    'linked_person', case
      when auth.uid() is null or l.owner_id = auth.uid() then null
      else (
        select jsonb_build_object('id', p.id, 'name', p.name)
          from lists.person_links pl
          join public.people p on p.id = pl.person_id and p.deleted_at is null
         where pl.list_id = l.id
           and pl.share_token = l.share_token
           and pl.buyer_id = auth.uid()
           and p.user_id = auth.uid()
         order by pl.created_at desc
         limit 1
      )
    end,
    'viewer', jsonb_build_object(
      'signed_in', auth.uid() is not null,
      'email', auth.jwt() ->> 'email',
      'name', lists.viewer_display_name()
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'price_cents', i.price_cents,
          'image_url', i.image_url,
          'product_url', i.product_url,
          'asin', i.asin,
          'source', i.source,
          'added_at', i.added_at,
          'claim', case
            when c.item_id is null or l.owner_id = auth.uid() then null
            else jsonb_build_object(
              'name', c.claimer_name,
              'mine', coalesce(c.claimer_id = auth.uid(), false)
            )
          end
        )
        order by i.position
      )
      from lists.list_items i
      left join lists.gift_claims c on c.item_id = i.id
      where i.list_id = l.id
    ), '[]'::jsonb)
  )
  from lists.lists l
  where l.share_token = p_token;
$$;

-- ─── person_share_token ─────────────────────────────────────────────────────
-- The current share token of the list the caller's own live person is
-- actively linked to. Null when unlinked, revoked, deleted or not theirs.

create function lists.person_share_token(p_person_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.share_token
    from public.people p
    cross join lists.active_link(p.id) a
    join lists.lists l on l.id = a.list_id
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null;
$$;

revoke execute on function lists.person_share_token(uuid) from public, anon;
grant execute on function lists.person_share_token(uuid) to authenticated;

-- ─── link_unlinked_person ───────────────────────────────────────────────────
-- Links the caller's person to the list behind a share link, only when the
-- person has no link and none of the caller's live people is actively linked
-- to this list. Returns {"status": "linked", "list_id"}, {"status":
-- "person_has_list"} or {"status": "list_has_person", "person_id"}. Errors
-- like link_person: P0002 for an unknown token or person, 22023 for your own
-- list. Never overwrites.
--
-- Lock order: the person row, then the list row. Locking the list row
-- serializes two adds to the same list (and waits out a token reset), so the
-- "already linked" check below, a separate statement, sees the other's link.
-- `for no key update` is enough for that and, unlike `for update`, doesn't
-- block the owner adding items (their foreign key takes a key-share lock).

create function lists.link_unlinked_person(p_token uuid, p_person_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_id uuid;
  v_owner_id uuid;
  v_existing uuid;
  v_written int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.people p
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null
     for update;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  select l.id, l.owner_id into v_list_id, v_owner_id
    from lists.lists l
   where l.share_token = p_token
     for no key update;
  if not found then
    raise exception 'List not found' using errcode = 'P0002';
  end if;

  if v_owner_id = auth.uid() then
    raise exception 'You cannot link a person to your own list' using errcode = '22023';
  end if;

  select pl.person_id into v_existing
    from lists.person_links pl
    join lists.lists l on l.id = pl.list_id and l.share_token = pl.share_token
    join public.people p on p.id = pl.person_id and p.deleted_at is null
   where pl.list_id = v_list_id
     and pl.buyer_id = auth.uid()
     and pl.person_id <> p_person_id
   order by pl.created_at desc
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('status', 'list_has_person', 'person_id', v_existing);
  end if;

  insert into lists.person_links (person_id, buyer_id, list_id, share_token)
  values (p_person_id, auth.uid(), v_list_id, p_token)
  on conflict (person_id) do nothing;
  get diagnostics v_written = row_count;
  if v_written = 0 then
    return jsonb_build_object('status', 'person_has_list');
  end if;

  update public.people set linked_user_id = v_owner_id where id = p_person_id;
  return jsonb_build_object('status', 'linked', 'list_id', v_list_id);
end;
$$;

revoke execute on function lists.link_unlinked_person(uuid, uuid) from public, anon;
grant execute on function lists.link_unlinked_person(uuid, uuid) to authenticated;

-- ─── add_person ─────────────────────────────────────────────────────────────
-- As in 20261103100000_contacts_import.sql, plus an optional share token:
-- when given, the new person is linked to that list in the same transaction,
-- and anything but a fresh link rolls the add back. list_has_person raises
-- P0001 with the linked person's id as the detail; a missing or reset list
-- raises P0002. The 17-argument function is dropped rather than overloaded,
-- so PostgREST calls stay unambiguous; the new argument defaults to null, so
-- callers passing the 17 named arguments still work (E7).

drop function concierge.add_person(text, text, text[], int, int, int, int, int,
  text, text, text, text, text, text, text, text, text);

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
  p_country text default null,
  p_share_token uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_link jsonb;
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

  if p_share_token is not null then
    v_link := lists.link_unlinked_person(p_share_token, v_person_id);
    if v_link ->> 'status' = 'list_has_person' then
      raise exception 'list_has_person' using errcode = 'P0001', detail = v_link ->> 'person_id';
    elsif v_link ->> 'status' is distinct from 'linked' then
      raise exception '%', v_link ->> 'status' using errcode = 'P0001';
    end if;
  end if;

  return v_person_id;
end;
$$;

revoke execute on function concierge.add_person(text, text, text[], int, int, int, int, int,
  text, text, text, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function concierge.add_person(text, text, text[], int, int, int, int, int,
  text, text, text, text, text, text, text, text, text, uuid) to authenticated;

-- ─── share_preview ──────────────────────────────────────────────────────────
-- What a chat app's link preview may show: the owner's name and how many
-- gifts the list has. Reads no claim table and no item details (AC-26).

create function lists.share_preview(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'owner_name', case
      when coalesce(concierge.setting_int('list_link_card_enabled'), 0) = 1 then (
        select nullif(trim(pr.display_name), '') from public.profiles pr where pr.id = l.owner_id
      )
    end,
    'item_count', (select count(*)::int from lists.list_items i where i.list_id = l.id)
  )
  from lists.lists l
  where l.share_token = p_token;
$$;

revoke execute on function lists.share_preview(uuid) from public;
grant execute on function lists.share_preview(uuid) to anon, authenticated;
