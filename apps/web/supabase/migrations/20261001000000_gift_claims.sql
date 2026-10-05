-- Visitors to a shared list can claim a gift so nobody buys it twice.
-- One claim per gift: the primary key settles two people claiming at once.
-- claimer_id is null for a guest, which is also what makes a guest claim
-- impossible to revoke (unclaim_gift matches on auth.uid()).
create table public.gift_claims (
  item_id uuid primary key references public.list_items (id) on delete cascade,
  claimer_id uuid references auth.users (id) on delete set null,
  claimer_name text not null check (char_length(claimer_name) between 1 and 80),
  claimed_at timestamptz not null default now()
);

-- No policies: claims are only reachable through the security definer
-- functions below, so an owner can't peek at them through the tables.
alter table public.gift_claims enable row level security;

-- save_list used to delete and re-insert every item, which changed every id
-- and would drop every claim (on delete cascade) whenever the owner saved.
-- Now items the client sends back with their id are updated in place; only
-- items that are really gone are deleted. A new gift keeps its client uuid
-- when that id is unused; otherwise it gets a fresh one.
create or replace function public.save_list(p_list_id uuid, p_title text, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list_id uuid := p_list_id;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_list_id is null then
    insert into public.lists (owner_id, title)
    values (auth.uid(), coalesce(nullif(trim(p_title), ''), 'My list'))
    returning id into v_list_id;
  else
    update public.lists
       set updated_at = now(),
           title = coalesce(nullif(trim(p_title), ''), title)
     where id = v_list_id and owner_id = auth.uid();
    if not found then
      raise exception 'List not found' using errcode = 'P0002';
    end if;
  end if;

  -- One statement, so every part sees the same snapshot of list_items. The
  -- delete and update touch disjoint rows (gone vs kept).
  with incoming as materialized (
    select
      case
        when existing.id is not null then existing.id
        -- A new gift keeps the client's uuid, so a client still holding it
        -- (an edit made mid-save) matches this row on its next save.
        when item.value ->> 'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and not exists (select 1 from public.list_items taken where taken.id::text = item.value ->> 'id')
          then (item.value ->> 'id')::uuid
        else gen_random_uuid()
      end as id,
      existing.id is not null as is_existing,
      item.ord::integer as position,
      item.value ->> 'name' as name,
      (item.value ->> 'price_cents')::integer as price_cents,
      item.value ->> 'image_url' as image_url,
      item.value ->> 'product_url' as product_url,
      item.value ->> 'asin' as asin,
      coalesce(item.value ->> 'source', 'manual') as source,
      coalesce((item.value ->> 'added_at')::timestamptz, now()) as added_at
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as item (value, ord)
    left join public.list_items existing
      on existing.list_id = v_list_id
     and existing.id::text = item.value ->> 'id'
  ),
  removed as (
    delete from public.list_items li
     where li.list_id = v_list_id
       and not exists (select 1 from incoming i where i.is_existing and i.id = li.id)
  ),
  kept as (
    update public.list_items li
       set position = i.position,
           name = i.name,
           price_cents = i.price_cents,
           image_url = i.image_url,
           product_url = i.product_url,
           asin = i.asin,
           source = i.source,
           added_at = i.added_at
      from incoming i
     where i.is_existing and li.id = i.id
  )
  insert into public.list_items
    (id, list_id, position, name, price_cents, image_url, product_url, asin, source, added_at)
  select id, v_list_id, position, name, price_cents, image_url, product_url, asin, source, added_at
    from incoming
   where not is_existing;

  return v_list_id;
end;
$$;

-- Same as before, plus each item's claim and who is looking. The claimer's
-- name is shown to everyone with the link; `mine` lets a signed-in claimer
-- see their own claim (and unclaim it).
create or replace function public.get_shared_list(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', l.title,
    'is_owner', coalesce(l.owner_id = auth.uid(), false),
    'viewer', jsonb_build_object(
      'signed_in', auth.uid() is not null,
      'email', auth.jwt() ->> 'email'
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
          'claim', case when c.item_id is null then null else jsonb_build_object(
            'name', c.claimer_name,
            'mine', coalesce(c.claimer_id = auth.uid(), false)
          ) end
        )
        order by i.position
      )
      from public.list_items i
      left join public.gift_claims c on c.item_id = i.id
      where i.list_id = l.id
    ), '[]'::jsonb)
  )
  from public.lists l
  where l.share_token = p_token;
$$;

-- Anyone holding the share link may claim, except the list's owner.
-- A signed-in claimer is named by their email; a guest names themselves.
create function public.claim_gift(p_token uuid, p_item_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_name text;
begin
  select l.owner_id into v_owner_id
    from public.lists l
    join public.list_items i on i.list_id = l.id
   where l.share_token = p_token and i.id = p_item_id;
  if not found then
    raise exception 'Gift not found' using errcode = 'P0002';
  end if;

  if v_owner_id = auth.uid() then
    raise exception 'Owners cannot claim their own gifts' using errcode = '42501';
  end if;

  if auth.uid() is not null then
    v_name := nullif(trim(auth.jwt() ->> 'email'), '');
  else
    v_name := nullif(trim(p_name), '');
  end if;
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'A name is required' using errcode = '22023';
  end if;

  begin
    insert into public.gift_claims (item_id, claimer_id, claimer_name)
    values (p_item_id, auth.uid(), v_name);
  exception when unique_violation then
    return jsonb_build_object('error', 'already_claimed');
  end;

  return jsonb_build_object('name', v_name, 'mine', auth.uid() is not null);
end;
$$;

revoke execute on function public.claim_gift(uuid, uuid, text) from public;
grant execute on function public.claim_gift(uuid, uuid, text) to anon, authenticated;

-- Only a signed-in claimer can take their own claim back. Returns whether a
-- claim was removed.
create function public.unclaim_gift(p_token uuid, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from public.gift_claims c
   using public.list_items i, public.lists l
   where c.item_id = p_item_id
     and i.id = c.item_id
     and l.id = i.list_id
     and l.share_token = p_token
     and c.claimer_id = auth.uid();
  return found;
end;
$$;

revoke execute on function public.unclaim_gift(uuid, uuid) from public, anon;
grant execute on function public.unclaim_gift(uuid, uuid) to authenticated;
