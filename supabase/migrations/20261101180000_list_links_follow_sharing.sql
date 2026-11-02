-- A link to someone's list lasts only while the list is shared (product
-- decision 43, narrowing 42; ALL-44 review). Resetting a list's share link
-- cuts off everyone who linked through the old one: they no longer see the
-- list, its claims or the owner's city, and the server can no longer ship to
-- the owner's address. Linking again needs the current share link.
--
-- Two layers, so one bug can't leak an address:
--   1. Each link remembers the share token it was made with, and every read
--      goes through lists.active_link, which requires that token to still be
--      the list's. A reset token revokes every old link at once.
--   2. Changing a list's token also deletes the old links, which clears
--      people.linked_user_id (handle_person_link_deleted), so no stale link
--      is left behind.
-- A future "stop sharing" switch must be checked in lists.active_link too,
-- and should delete links the same way.
--
-- Also from the review: soft-deleting a person ends their link, and
-- person_list recognises the server by its role, not by a missing user.

-- ─── person_links.share_token ───────────────────────────────────────────────

alter table lists.person_links add column share_token uuid;

update lists.person_links pl
   set share_token = l.share_token
  from lists.lists l
 where l.id = pl.list_id;

alter table lists.person_links alter column share_token set not null;

-- ─── active_link ────────────────────────────────────────────────────────────
-- The list a person is linked to, and its owner, but only while the link's
-- share token is still the list's. No rows when unlinked or revoked. Only
-- other functions call it.

create function lists.active_link(p_person_id uuid)
returns table (list_id uuid, owner_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.owner_id
    from lists.person_links pl
    join lists.lists l on l.id = pl.list_id and l.share_token = pl.share_token
   where pl.person_id = p_person_id;
$$;

revoke execute on function lists.active_link(uuid) from public, anon, authenticated;

-- ─── a new share token revokes old links ────────────────────────────────────

create function lists.handle_share_token_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from lists.person_links
   where list_id = new.id and share_token is distinct from new.share_token;
  return null;
end;
$$;

revoke execute on function lists.handle_share_token_changed() from public, anon, authenticated;

create trigger on_share_token_changed after update of share_token on lists.lists
  for each row when (old.share_token is distinct from new.share_token)
  execute function lists.handle_share_token_changed();

-- ─── a deleted person loses their link ──────────────────────────────────────
-- So restoring a person never silently brings a link back.

create function lists.handle_linked_person_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from lists.person_links where person_id = new.id;
  return null;
end;
$$;

revoke execute on function lists.handle_linked_person_deleted() from public, anon, authenticated;

create trigger on_linked_person_deleted after update of deleted_at on public.people
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function lists.handle_linked_person_deleted();

-- ─── link_person ────────────────────────────────────────────────────────────
-- As before, but the link remembers the share token it was made with.
-- `create or replace` keeps the existing grants.

create or replace function lists.link_person(p_token uuid, p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_id uuid;
  v_owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.people p
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  -- `for key share` makes a concurrent token reset wait (or this wait for
  -- it), so a link can't be written with a token that was just replaced.
  select l.id, l.owner_id into v_list_id, v_owner_id
    from lists.lists l
   where l.share_token = p_token
     for key share;
  if not found then
    raise exception 'List not found' using errcode = 'P0002';
  end if;

  if v_owner_id = auth.uid() then
    raise exception 'You cannot link a person to your own list' using errcode = '22023';
  end if;

  insert into lists.person_links (person_id, buyer_id, list_id, share_token)
  values (p_person_id, auth.uid(), v_list_id, p_token)
  on conflict (person_id) do update
    set list_id = excluded.list_id, share_token = excluded.share_token, created_at = now();

  update public.people set linked_user_id = v_owner_id where id = p_person_id;
end;
$$;

-- ─── unlink_person ──────────────────────────────────────────────────────────
-- Returns whether a link was actually removed.

create or replace function lists.unlink_person(p_person_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int;
begin
  perform 1 from public.people p
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  delete from lists.person_links where person_id = p_person_id;
  get diagnostics v_removed = row_count;
  update public.people set linked_user_id = null where id = p_person_id and linked_user_id is not null;
  return v_removed > 0;
end;
$$;

-- ─── person_list ────────────────────────────────────────────────────────────
-- As before, but only through an active link, and the server is recognised
-- by its service_role JWT instead of by having no signed-in user.

create or replace function lists.person_list(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_server boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_list_id uuid;
begin
  perform 1 from public.people p
   where p.id = p_person_id
     and p.deleted_at is null
     and (v_is_server or p.user_id = auth.uid());
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  select a.list_id into v_list_id from lists.active_link(p_person_id) a;

  return (
    select jsonb_build_object(
      'title', l.title,
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
            'claimed', c.item_id is not null,
            'claimed_by_me', coalesce(c.claimer_id = auth.uid(), false)
          )
          order by i.position
        )
        from lists.list_items i
        left join lists.gift_claims c on c.item_id = i.id
        where i.list_id = l.id
      ), '[]'::jsonb)
    )
    from lists.lists l
    where l.id = v_list_id
  );
end;
$$;

-- ─── shared addresses ───────────────────────────────────────────────────────
-- Now keyed on the active link's list owner, not on people.linked_user_id,
-- so a revoked link shares nothing even before any cleanup.

create or replace function public.shared_city_for_person(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform 1 from public.people p
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  return (
    select jsonb_build_object('city', a.city, 'state', a.state)
      from lists.active_link(p_person_id) link
      join public.account_addresses a on a.user_id = link.owner_id
     where a.share_for_gifts
  );
end;
$$;

create or replace function public.shared_address_for_person(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recipient_first_name', a.recipient_first_name,
    'recipient_last_name', a.recipient_last_name,
    'address_line1', a.address_line1,
    'address_line2', a.address_line2,
    'city', a.city,
    'state', a.state,
    'zip', a.zip,
    'country', a.country,
    'phone', a.phone
  )
    from public.people p
    cross join lists.active_link(p.id) link
    join public.account_addresses a on a.user_id = link.owner_id
   where p.id = p_person_id and p.deleted_at is null and a.share_for_gifts;
$$;
