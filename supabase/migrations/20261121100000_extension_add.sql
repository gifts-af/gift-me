-- "Add to my list" from the Chrome extension (ALL-78, design/plans/ALL-78-add-to-my-list.md).
--
-- What this adds:
--   * list_items.product_id and has_photo, and match_key / store_host, two
--     columns the database computes from the link for every gift (website
--     gifts and existing rows too), so duplicates are found the same way
--     whoever added the gift;
--   * lists.add_item, the one way the extension adds a gift: it finds or makes
--     the user's list under My list's lock, refuses duplicates, asks about
--     likely duplicates, stops at the item limit and puts the gift on top;
--   * the public list-photos bucket, which only the server writes to;
--   * lists.photo_deletions, a queue of photos whose gift is gone, emptied by
--     the daily tick;
--   * concierge.recent_people for the popup's "recent people" buttons;
--   * the four settings the extension route and popup read.
--
-- Expand only (E7): nothing existing changes shape, so code rolled back on
-- Vercel keeps working. The off switch is the extension_add_enabled setting.

-- ─── Match keys ─────────────────────────────────────────────────────────────
-- The rule is written in the header of packages/core/src/store-page/link.ts
-- (the only implementation is here), and every case in
-- apps/web/modules/lists/__tests__/match-key-cases.json is checked against
-- these functions by add-item-db.test.ts. Change them together.
-- They are immutable because the stored columns below are computed by them:
-- changing one later needs the columns recomputed in the same migration.

-- {host, path, query} of a link, or null when it isn't one. The host has
-- user info and port dropped, is lower case, and loses a leading "www." then
-- "m." while a dot is still left after it. The query keeps its "?".
create function lists.url_parts(p_url text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_match text[] := regexp_match(p_url, '^[a-z][a-z0-9+.-]*:(//([^/?#]*))?([^?#]*)(\?[^#]*)?', 'i');
  v_host text;
begin
  if v_match is null then
    return null;
  end if;
  v_host := lower(regexp_replace(regexp_replace(coalesce(v_match[2], ''), '^.*@', ''), ':[0-9]*$', ''));
  v_host := regexp_replace(regexp_replace(v_host, '^www\.(?=[^.]+\.)', ''), '^m\.(?=[^.]+\.)', '');
  return array[v_host, coalesce(v_match[3], ''), coalesce(v_match[4], '')];
end;
$$;

-- Any Amazon store, label by label: amazon.evil.com is not Amazon.
create function lists.is_amazon_host(p_host text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_host ~ '(^|\.)amazon\.[^.]*$' or p_host ~ '(^|\.)amazon\.(co|com|net|org)\.[^.]*$';
$$;

-- The store a gift is from: the plain host, "amazon" for every Amazon store,
-- "" for text that isn't a link, null for no link.
create function lists.store_host(p_url text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_parts text[];
begin
  if p_url is null or btrim(p_url) = '' then
    return null;
  end if;
  v_parts := lists.url_parts(p_url);
  if v_parts is null then
    return '';
  end if;
  return case when lists.is_amazon_host(v_parts[1]) then 'amazon' else v_parts[1] end;
end;
$$;

-- Two gifts are the same product when their keys are equal. Amazon gifts are
-- keyed by ASIN: from the link's path, else the gift's asin column (also when
-- there's no link). Text that isn't a link is its own key; no link and no
-- ASIN gives null, which matches nothing.
create function lists.match_key(p_url text, p_asin text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_parts text[];
  v_asin text := case when p_asin ~* '^[a-z0-9]{10}$' then upper(p_asin) end;
  v_params text;
begin
  if p_url is null or btrim(p_url) = '' then
    return 'amazon:' || v_asin;
  end if;
  v_parts := lists.url_parts(p_url);
  if v_parts is null then
    return p_url;
  end if;
  if lists.is_amazon_host(v_parts[1]) then
    v_asin := coalesce(
      upper((regexp_match(v_parts[2], '/(?:dp|gp/product|gp/aw/d|product|exec/obidos/asin)/(?:product/)?([a-z0-9]{10})(?:/|$)', 'i'))[1]),
      v_asin
    );
    if v_asin is not null then
      return 'amazon:' || v_asin;
    end if;
  end if;
  -- Variant and product-id parameters only, keys lower case, values as
  -- written; sorted byte-wise (COLLATE "C") to match the JS sort.
  select string_agg(k || '=' || v, '&' order by k collate "C", v collate "C")
    into v_params
    from (
      select lower(split_part(pair, '=', 1)) as k,
             case when strpos(pair, '=') > 0 then substr(pair, strpos(pair, '=') + 1) else '' end as v
        from unnest(string_to_array(substr(v_parts[3], 2), '&')) as pair
       where pair <> ''
    ) params
   where k in ('variant', 'sku', 'skuid', 'size', 'color', 'id', 'pid', 'productid', 'itemid');
  return v_parts[1] || regexp_replace(v_parts[2], '/$', '') || coalesce('?' || v_params, '');
end;
$$;

-- The stored columns are computed as whoever writes the gift, so signed-in
-- users (My list saves, add_item) and the server need these. They only
-- transform text.
revoke execute on function lists.url_parts(text) from public, anon;
revoke execute on function lists.is_amazon_host(text) from public, anon;
revoke execute on function lists.store_host(text) from public, anon;
revoke execute on function lists.match_key(text, text) from public, anon;
grant execute on function lists.url_parts(text) to authenticated, service_role;
grant execute on function lists.is_amazon_host(text) to authenticated, service_role;
grant execute on function lists.store_host(text) to authenticated, service_role;
grant execute on function lists.match_key(text, text) to authenticated, service_role;

-- ─── New gift columns ───────────────────────────────────────────────────────

alter table lists.list_items
  -- The page's own product id (sku, gtin, mpn), for the likely-duplicate check. Never shown.
  add column product_id text check (char_length(product_id) between 1 and 128),
  -- The photo is ours, at list-photos/{id}.jpg, and is deleted with the gift.
  add column has_photo boolean not null default false,
  add column match_key text generated always as (lists.match_key(product_url, asin)) stored,
  add column store_host text generated always as (lists.store_host(product_url)) stored;

create index list_items_list_id_match_key_idx on lists.list_items (list_id, match_key);
create index list_items_list_id_store_host_idx on lists.list_items (list_id, store_host);

-- ─── Photos ─────────────────────────────────────────────────────────────────
-- Public, so the list and its share page can show photos; the path is the
-- gift's random id, so it can't be guessed. No storage policies: signed-in
-- users can't upload or list, only the server (service role) writes here. The
-- 1 MB ceiling sits above list_photo_max_bytes, which the route checks.

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('list-photos', 'list-photos', true, array['image/jpeg'], 1048576)
on conflict (id) do nothing;

-- Photos to delete from storage. The route queues a photo before uploading
-- it, and an added gift takes it off again, so an upload whose add failed or
-- crashed is still cleaned up. A removed gift queues its photo again. The
-- daily tick deletes queued files and forgets them. Closed to everyone but
-- the server: new tables in `lists` are granted to signed-in users by default.
create table lists.photo_deletions (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table lists.photo_deletions enable row level security;
revoke all on lists.photo_deletions from public, anon, authenticated;

-- The path always comes from the deleted row's own id, never from input, so
-- nobody can queue another user's file.
create function lists.queue_deleted_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into lists.photo_deletions (path) values (old.id::text || '.jpg')
  on conflict (path) do nothing;
  return old;
end;
$$;

create trigger queue_deleted_photo after delete on lists.list_items
  for each row when (old.has_photo) execute function lists.queue_deleted_photo();

-- An added gift with a photo keeps it: off the queue. (add_item runs as the
-- user, who can't touch the queue, so this runs as its owner.)
create function lists.unqueue_added_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from lists.photo_deletions where path = new.id::text || '.jpg';
  return new;
end;
$$;

create trigger unqueue_added_photo after insert on lists.list_items
  for each row when (new.has_photo) execute function lists.unqueue_added_photo();

-- A gift's id and has_photo never change, so the path queued on delete is
-- always its own photo's: changing the id would point it at another file, and
-- clearing has_photo would leave the photo behind. My list saves never set
-- either (save_list_checked updates other columns only).
create function lists.keep_photo_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A gift''s id and photo can''t change' using errcode = '42501';
end;
$$;

create trigger keep_photo_path before update on lists.list_items
  for each row
  when (old.id is distinct from new.id or old.has_photo is distinct from new.has_photo)
  execute function lists.keep_photo_path();

revoke execute on function lists.queue_deleted_photo() from public, anon, authenticated;
revoke execute on function lists.unqueue_added_photo() from public, anon, authenticated;
revoke execute on function lists.keep_photo_path() from public, anon, authenticated;

-- The server's side of the queue: queue before upload, take the old ones,
-- forget the ones it deleted.
create function lists.queue_photo(p_item_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into lists.photo_deletions (path) values (p_item_id::text || '.jpg')
  on conflict (path) do nothing;
$$;

-- Paths queued at least p_older_than ago, oldest first, skipping any whose gift
-- exists again (an add re-using the id after the file was queued) and any row
-- another run holds.
create function lists.take_photo_deletions(p_limit integer, p_older_than interval)
returns setof text
language sql
volatile
security invoker
set search_path = ''
as $$
  select d.path from lists.photo_deletions d
   where d.queued_at <= now() - p_older_than
     and not exists (
       select 1 from lists.list_items i where i.id::text || '.jpg' = d.path
     )
   order by d.queued_at, d.path
   limit p_limit
   for update of d skip locked;
$$;

create function lists.forget_photo_deletions(p_paths text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from lists.photo_deletions where path = any(p_paths);
$$;

revoke execute on function lists.queue_photo(uuid) from public, anon, authenticated;
revoke execute on function lists.take_photo_deletions(integer, interval) from public, anon, authenticated;
revoke execute on function lists.forget_photo_deletions(text[]) from public, anon, authenticated;
grant execute on function lists.queue_photo(uuid) to service_role;
grant execute on function lists.take_photo_deletions(integer, interval) to service_role;
grant execute on function lists.forget_photo_deletions(text[]) to service_role;

-- ─── add_item ───────────────────────────────────────────────────────────────
-- Adds one gift to the top of the signed-in user's list (the oldest, as
-- getMyList shows), making the list if there is none. Runs as the caller, so
-- RLS applies, like save_list_checked.
--
-- It takes save_list_checked's advisory lock, so a My list tab making the
-- first list at the same time makes no second one (it gets GL409), then locks
-- the list's row, so two adds of the same product can't both pass the
-- duplicate check. The add moves updated_at (clock_timestamp()), so a tab
-- holding the older version is refused on its next save and merges.
--
-- Outcomes, in this order:
--   duplicate  a gift with the same match_key is on the list
--   likely     a gift from the same store has the same product_id or the same
--              name ignoring case and punctuation (skipped when
--              p_confirm_likely); existing = {id, name, price_cents, image_url}
--   full       the list already has p_max_items gifts (MAX_ITEMS in save-list.ts)
--   added      inserted at position 0, source 'extension'
--
-- p_photo_url is the public URL of the photo the route uploaded for this gift,
-- or null. It must be this gift's own file (…/list-photos/{p_item_id}.jpg).
--
-- Errors: 42501 not signed in; 22023 a photo URL for another file, or no limit.
-- Name length and price range are the table's own checks.

create function lists.add_item(
  p_item_id uuid,
  p_name text,
  p_price_cents integer,
  p_product_url text,
  p_product_id text,
  p_photo_url text,
  p_confirm_likely boolean,
  p_max_items integer
)
returns table (outcome text, list_id uuid, item_id uuid, existing jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_list_id uuid;
  v_product_id text := nullif(btrim(p_product_id), '');
  v_key text := lists.match_key(p_product_url, null);
  v_host text := lists.store_host(p_product_url);
  v_name_key text := lower(regexp_replace(coalesce(p_name, ''), '[^[:alnum:]]+', '', 'g'));
  v_likely jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_max_items is null then
    raise exception 'An item limit is required' using errcode = '22023';
  end if;
  if p_photo_url is not null
     and right(p_photo_url, length('/storage/v1/object/public/list-photos/' || p_item_id::text || '.jpg'))
         is distinct from '/storage/v1/object/public/list-photos/' || p_item_id::text || '.jpg' then
    raise exception 'The photo isn''t this gift''s' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lists.save_list_checked:' || auth.uid()::text, 0));
  select l.id into v_list_id
    from lists.lists l
   where l.owner_id = auth.uid()
   order by l.created_at
   limit 1
   for update;
  if v_list_id is null then
    insert into lists.lists (owner_id) values (auth.uid()) returning id into v_list_id;
  end if;

  if v_key is not null and exists (
    select 1 from lists.list_items i where i.list_id = v_list_id and i.match_key = v_key
  ) then
    return query select 'duplicate'::text, v_list_id, null::uuid, null::jsonb;
    return;
  end if;

  if not coalesce(p_confirm_likely, false) and v_host is not null then
    select jsonb_build_object('id', i.id, 'name', i.name, 'price_cents', i.price_cents, 'image_url', i.image_url)
      into v_likely
      from lists.list_items i
     where i.list_id = v_list_id
       and i.store_host = v_host
       and ((v_product_id is not null and i.product_id = v_product_id)
         or (v_name_key <> '' and lower(regexp_replace(i.name, '[^[:alnum:]]+', '', 'g')) = v_name_key))
     order by i.position
     limit 1;
    if v_likely is not null then
      return query select 'likely'::text, v_list_id, null::uuid, v_likely;
      return;
    end if;
  end if;

  if (select count(*) from lists.list_items i where i.list_id = v_list_id) >= p_max_items then
    return query select 'full'::text, v_list_id, null::uuid, null::jsonb;
    return;
  end if;

  update lists.list_items i set position = i.position + 1 where i.list_id = v_list_id;
  insert into lists.list_items
    (id, list_id, position, name, price_cents, image_url, product_url, product_id, has_photo, source)
  values
    (p_item_id, v_list_id, 0, p_name, p_price_cents, p_photo_url, p_product_url, v_product_id,
     p_photo_url is not null, 'extension');
  update lists.lists l set updated_at = clock_timestamp() where l.id = v_list_id;

  return query select 'added'::text, v_list_id, p_item_id, null::jsonb;
end;
$$;

revoke execute on function lists.add_item(uuid, text, integer, text, text, text, boolean, integer) from public, anon;
grant execute on function lists.add_item(uuid, text, integer, text, text, text, boolean, integer) to authenticated;

-- ─── recent_people ──────────────────────────────────────────────────────────
-- The signed-in user's people (not deleted) they captured for most recently,
-- newest first, for the popup's buttons. People with no capture aren't
-- listed; the popup fills the rest alphabetically. Runs as the caller.

create function concierge.recent_people(p_limit integer)
returns table (person_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.person_id
    from concierge.captures c
    join public.people p on p.id = c.person_id
   where c.user_id = auth.uid()
     and p.deleted_at is null
   group by c.person_id
   order by max(c.created_at) desc, c.person_id
   limit p_limit;
$$;

revoke execute on function concierge.recent_people(integer) from public, anon;
grant execute on function concierge.recent_people(integer) to authenticated;

-- ─── Settings (T23) ─────────────────────────────────────────────────────────

insert into concierge.app_settings (key, value, description) values
  ('list_photo_width_px', '400', 'Widest gift photo the extension stores, in pixels.'),
  ('list_photo_jpeg_quality', '80', 'JPEG quality (1-100) of gift photos from the extension.'),
  ('list_photo_max_bytes', '200000', 'Largest gift photo the extension route accepts, in bytes. Keep it below the list-photos bucket''s 1 MB file_size_limit.'),
  ('extension_add_enabled', '1', 'Switch for "Add to my list" in the extension: 1 on, 0 refuses adds (saving for a person still works).')
on conflict (key) do nothing;
