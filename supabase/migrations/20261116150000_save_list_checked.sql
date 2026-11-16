-- My list saves as you go (ALL-127, T74). Each save carries the version of the
-- list it was made from, and the database refuses one that's out of date, so a
-- stale tab or device can't overwrite newer gifts (or drop the claims on them).
--
-- Expand only (E7): the old lists.save_list stays exactly as it is, so code
-- rolled back on Vercel still saves. A later cleanup migration drops it.
--
-- The version is updated_at as text, and stays a string end to end: a JS Date
-- keeps only milliseconds, so a round trip through one would refuse every save.
-- It's compared as a time, so another print of the same moment still matches.
--
-- It returns { id, updated_at, share_token, items }: the gifts it wrote, read
-- here while this save still holds the list's row lock, so the version and
-- the gifts come from one snapshot. (An app re-read after the save could pick
-- up another device's gift under this save's version, and a later merge would
-- then treat that gift as removed.)
--
-- Errors:
--   42501  not signed in
--   P0002  the list isn't the caller's, or doesn't exist
--   GL409  the version is out of date, or (with no list id) the caller already
--          has a list, so this tab must load the latest and try again

create function lists.save_list_checked(p_list_id uuid, p_title text, p_items jsonb, p_expected text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list_id uuid := p_list_id;
  v_expected timestamptz;
  v_updated_at timestamptz;
  v_share_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_list_id is null then
    -- Two tabs that both opened before the list existed would otherwise both
    -- see "no list" and make two. The lock holds the second until the first
    -- commits; it then sees the new list and is refused.
    perform pg_advisory_xact_lock(hashtextextended('lists.save_list_checked:' || auth.uid()::text, 0));
    if exists (select 1 from lists.lists where owner_id = auth.uid()) then
      raise exception 'The list has changed' using errcode = 'GL409';
    end if;
    insert into lists.lists (owner_id, title)
    values (auth.uid(), coalesce(nullif(trim(p_title), ''), 'My list'))
    returning id, updated_at, share_token into v_list_id, v_updated_at, v_share_token;
  else
    -- A version that isn't a time can't be current: stale, so the app loads
    -- the latest and tries again.
    begin
      v_expected := p_expected::timestamptz;
    exception when others then
      raise exception 'The list has changed' using errcode = 'GL409';
    end;
    -- The check sits in the update itself: a save queued behind another on
    -- this row re-checks the version once that one commits, and is refused.
    -- clock_timestamp(), not now(), so two saves in one transaction still get
    -- different versions.
    update lists.lists
       set updated_at = clock_timestamp(),
           title = coalesce(nullif(trim(p_title), ''), title)
     where id = v_list_id
       and owner_id = auth.uid()
       and updated_at = v_expected
    returning updated_at, share_token into v_updated_at, v_share_token;
    if not found then
      if exists (select 1 from lists.lists where id = v_list_id and owner_id = auth.uid()) then
        raise exception 'The list has changed' using errcode = 'GL409';
      end if;
      raise exception 'List not found' using errcode = 'P0002';
    end if;
  end if;

  -- The same items logic as lists.save_list (20261001000000_gift_claims.sql):
  -- gifts sent back with their id are updated in place, keeping their claims;
  -- only gifts really gone are deleted. One statement, so every part sees the
  -- same snapshot of list_items.
  with incoming as materialized (
    select
      case
        when existing.id is not null then existing.id
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

  -- A new statement, so it sees the rows written above; nothing else can
  -- change them while this transaction holds the list's row.
  return jsonb_build_object(
    'id', v_list_id,
    'updated_at', v_updated_at::text,
    'share_token', v_share_token,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name, 'price_cents', i.price_cents, 'image_url', i.image_url,
          'product_url', i.product_url, 'asin', i.asin, 'source', i.source, 'added_at', i.added_at
        ) order by i.position)
        from lists.list_items i
       where i.list_id = v_list_id
    ), '[]'::jsonb)
  );
end;
$$;

-- The same grants as save_list: signed-in users only.
revoke execute on function lists.save_list_checked(uuid, text, jsonb, text) from public, anon;
grant execute on function lists.save_list_checked(uuid, text, jsonb, text) to authenticated;
