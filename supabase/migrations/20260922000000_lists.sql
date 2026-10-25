-- Gift lists. A user may own many lists; the UI currently shows only the
-- oldest one, so there is deliberately no unique constraint on owner_id.

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'My list' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lists_owner_id_idx on public.lists (owner_id, created_at);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  position integer not null,
  name text not null check (char_length(name) between 1 and 300),
  -- Integer cents, capped at $1,000,000 to match MAX_PRICE_CENTS in lib/format.js.
  price_cents integer not null check (price_cents between 0 and 100000000),
  image_url text,
  product_url text,
  asin text,
  source text not null default 'manual',
  added_at timestamptz not null default now()
);

create index list_items_list_id_position_idx on public.list_items (list_id, position);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.lists enable row level security;
alter table public.list_items enable row level security;

create policy "Owners can read their lists" on public.lists
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners can create lists" on public.lists
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners can update their lists" on public.lists
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete their lists" on public.lists
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Owners can read their list items" on public.list_items
  for select to authenticated using (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  );
create policy "Owners can add list items" on public.list_items
  for insert to authenticated with check (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  );
create policy "Owners can update list items" on public.list_items
  for update to authenticated
  using (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  );
create policy "Owners can delete list items" on public.list_items
  for delete to authenticated using (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid()))
  );

-- ─── save_list ──────────────────────────────────────────────────────────────
-- Replaces a list's items in one transaction, creating the list first when
-- p_list_id is null. Runs as the caller (security invoker), so RLS still
-- applies to every statement. Returns the list id.
--
-- p_items: [{ "name", "price_cents", "image_url", "product_url", "asin",
--             "source", "added_at" }, ...] in display order.

create function public.save_list(p_list_id uuid, p_title text, p_items jsonb)
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
     where id = v_list_id
       and owner_id = auth.uid();
    if not found then
      raise exception 'List not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.list_items where list_id = v_list_id;

  insert into public.list_items
    (list_id, position, name, price_cents, image_url, product_url, asin, source, added_at)
  select
    v_list_id,
    item.ord::integer,
    item.value ->> 'name',
    (item.value ->> 'price_cents')::integer,
    item.value ->> 'image_url',
    item.value ->> 'product_url',
    item.value ->> 'asin',
    coalesce(item.value ->> 'source', 'manual'),
    coalesce((item.value ->> 'added_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as item (value, ord);

  return v_list_id;
end;
$$;

revoke execute on function public.save_list(uuid, text, jsonb) from public, anon;
grant execute on function public.save_list(uuid, text, jsonb) to authenticated;
