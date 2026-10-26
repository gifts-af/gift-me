-- The list app moves into its own `lists` schema (T19, T20, design §2.2).
--
-- `set schema` moves each table in place: rows, privacy rules, indexes,
-- foreign keys and grants come along unchanged. The functions move too, and
-- are then rewritten, because their bodies name `public.*` explicitly. Their
-- signatures, results, error codes and grants stay exactly the same.
-- Display names now come from the shared `public.profiles` (ALL-19).

create schema lists;

-- Share links work signed out, so anon can reach the schema; the tables
-- themselves stay owner-only through RLS, and anon only gets in through the
-- functions granted to it.
grant usage on schema lists to anon, authenticated, service_role;
alter default privileges in schema lists
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema lists
  grant all on tables to service_role;

alter table public.lists set schema lists;
alter table public.list_items set schema lists;
alter table public.gift_claims set schema lists;

alter function public.save_list(uuid, text, jsonb) set schema lists;
alter function public.get_shared_list(uuid) set schema lists;
alter function public.claim_gift(uuid, uuid, text) set schema lists;
alter function public.unclaim_gift(uuid, uuid) set schema lists;
alter function public.viewer_display_name() set schema lists;

-- ─── viewer_display_name ────────────────────────────────────────────────────
-- The signed-in viewer's display name from their profile, falling back to
-- their email. Profiles take the display name from sign-up (ALL-19).

create or replace function lists.viewer_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    left(nullif(trim(p.display_name), ''), 80),
    nullif(trim(p.email), ''),
    nullif(trim(u.email), '')
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid();
$$;

-- ─── save_list ──────────────────────────────────────────────────────────────
-- Unchanged apart from the schema (see 20261001000000_gift_claims.sql).

create or replace function lists.save_list(p_list_id uuid, p_title text, p_items jsonb)
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
    insert into lists.lists (owner_id, title)
    values (auth.uid(), coalesce(nullif(trim(p_title), ''), 'My list'))
    returning id into v_list_id;
  else
    update lists.lists
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
         and not exists (select 1 from lists.list_items taken where taken.id::text = item.value ->> 'id')
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
    left join lists.list_items existing
      on existing.list_id = v_list_id
     and existing.id::text = item.value ->> 'id'
  ),
  removed as (
    delete from lists.list_items li
     where li.list_id = v_list_id
       and not exists (select 1 from incoming i where i.is_existing and i.id = li.id)
  ),
  kept as (
    update lists.list_items li
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
  insert into lists.list_items
    (id, list_id, position, name, price_cents, image_url, product_url, asin, source, added_at)
  select id, v_list_id, position, name, price_cents, image_url, product_url, asin, source, added_at
    from incoming
   where not is_existing;

  return v_list_id;
end;
$$;

-- ─── get_shared_list ────────────────────────────────────────────────────────
-- Unchanged apart from the schema (see 20261005000000_display_names.sql).

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
          'claim', case when c.item_id is null then null else jsonb_build_object(
            'name', c.claimer_name,
            'mine', coalesce(c.claimer_id = auth.uid(), false)
          ) end
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

-- ─── claim_gift ─────────────────────────────────────────────────────────────
-- Unchanged apart from the schema (see 20261005000000_display_names.sql).

create or replace function lists.claim_gift(p_token uuid, p_item_id uuid, p_name text)
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
    from lists.lists l
    join lists.list_items i on i.list_id = l.id
   where l.share_token = p_token and i.id = p_item_id;
  if not found then
    raise exception 'Gift not found' using errcode = 'P0002';
  end if;

  if v_owner_id = auth.uid() then
    raise exception 'Owners cannot claim their own gifts' using errcode = '42501';
  end if;

  if auth.uid() is not null then
    v_name := lists.viewer_display_name();
  else
    v_name := nullif(trim(p_name), '');
  end if;
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'A name is required' using errcode = '22023';
  end if;

  begin
    insert into lists.gift_claims (item_id, claimer_id, claimer_name)
    values (p_item_id, auth.uid(), v_name);
  exception when unique_violation then
    return jsonb_build_object('error', 'already_claimed');
  end;

  return jsonb_build_object('name', v_name, 'mine', auth.uid() is not null);
end;
$$;

-- ─── unclaim_gift ───────────────────────────────────────────────────────────
-- Unchanged apart from the schema (see 20261001000000_gift_claims.sql).

create or replace function lists.unclaim_gift(p_token uuid, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  delete from lists.gift_claims c
   using lists.list_items i, lists.lists l
   where c.item_id = p_item_id
     and i.id = c.item_id
     and l.id = i.list_id
     and l.share_token = p_token
     and c.claimer_id = auth.uid();
  return found;
end;
$$;
