-- Links a buyer's person to that person's own gift list, so the concierge
-- can offer picks from it (product decisions 37 and 42, ALL-44). Anyone
-- holding the list's share link can link right away; there's no consent
-- step. The concierge never reads list tables: it calls person_list (T19).

-- Which list each linked person was linked through. A user can own several
-- lists, and picks come only from the one the buyer was given a link to.
-- Reached only through the functions below.
create table lists.person_links (
  person_id uuid primary key,
  buyer_id uuid not null,
  list_id uuid not null references lists.lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (person_id, buyer_id) references public.people (id, user_id) on delete cascade
);

create index person_links_list_id_idx on lists.person_links (list_id);

alter table lists.person_links enable row level security;
revoke all on lists.person_links from anon, authenticated;

-- A person stays linked to an account only while the link exists. When the
-- list is deleted (or the person is unlinked), linked_user_id is cleared
-- too, so deleting a list also ends address sharing with everyone who
-- linked through it (shared_city_for_person, shared_address_for_person).
create function lists.handle_person_link_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.people set linked_user_id = null
   where id = old.person_id and linked_user_id is not null;
  return null;
end;
$$;

revoke execute on function lists.handle_person_link_deleted() from public, anon, authenticated;

create trigger on_person_link_deleted after delete on lists.person_links
  for each row execute function lists.handle_person_link_deleted();

-- ─── link_person ────────────────────────────────────────────────────────────
-- Links one of your people to the list behind a share link, and sets
-- people.linked_user_id to the list's owner (T19). Linking again moves the
-- person to the new list.

create function lists.link_person(p_token uuid, p_person_id uuid)
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

  select l.id, l.owner_id into v_list_id, v_owner_id
    from lists.lists l
   where l.share_token = p_token;
  if not found then
    raise exception 'List not found' using errcode = 'P0002';
  end if;

  if v_owner_id = auth.uid() then
    raise exception 'You cannot link a person to your own list' using errcode = '22023';
  end if;

  insert into lists.person_links (person_id, buyer_id, list_id)
  values (p_person_id, auth.uid(), v_list_id)
  on conflict (person_id) do update set list_id = excluded.list_id, created_at = now();

  update public.people set linked_user_id = v_owner_id where id = p_person_id;
end;
$$;

-- ─── unlink_person ──────────────────────────────────────────────────────────
-- Removes the link. Returns whether the person was linked.

create function lists.unlink_person(p_person_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_linked boolean;
begin
  select p.linked_user_id is not null into v_was_linked
    from public.people p
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  delete from lists.person_links where person_id = p_person_id;
  update public.people set linked_user_id = null where id = p_person_id;
  return v_was_linked;
end;
$$;

-- ─── person_list ────────────────────────────────────────────────────────────
-- The gifts on a linked person's list, in list order, for a round to offer
-- as picks. Claimed gifts say so (but not by whom), so the buyer doesn't
-- double up; the list's owner never calls this, since it's keyed by the
-- buyer's person. Null when the person isn't linked or the list is gone.
-- A signed-in buyer may ask only about their own people; with no user, the
-- caller is the server (only it and authenticated users can run this).

create function lists.person_list(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list_id uuid;
begin
  perform 1 from public.people p
   where p.id = p_person_id
     and p.deleted_at is null
     and (auth.uid() is null or p.user_id = auth.uid());
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  select pl.list_id into v_list_id from lists.person_links pl where pl.person_id = p_person_id;

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

revoke execute on function lists.link_person(uuid, uuid) from public, anon;
revoke execute on function lists.unlink_person(uuid) from public, anon;
revoke execute on function lists.person_list(uuid) from public, anon;
grant execute on function lists.link_person(uuid, uuid) to authenticated;
grant execute on function lists.unlink_person(uuid) to authenticated;
grant execute on function lists.person_list(uuid) to authenticated, service_role;
