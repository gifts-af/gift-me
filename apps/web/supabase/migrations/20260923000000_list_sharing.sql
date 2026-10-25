-- Read-only share links. Each list gets its own share token, kept separate
-- from the list id so a link can later be rotated without touching the PK.

alter table public.lists
  add column share_token uuid not null unique default gen_random_uuid();

-- ─── get_shared_list ────────────────────────────────────────────────────────
-- The one way a non-owner (signed in or not) can read a list. Runs as the
-- definer so it can see past RLS, and so must expose nothing beyond what a
-- share page shows: never owner_id, only whether the caller is the owner.
-- Returns null when no list has that token.
--
-- Result: { "title", "is_owner", "items": [{ id, name, price_cents,
--           image_url, product_url, asin, source, added_at }, ...] }

create function public.get_shared_list(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', l.title,
    'is_owner', coalesce(l.owner_id = auth.uid(), false),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'name', i.name,
            'price_cents', i.price_cents,
            'image_url', i.image_url,
            'product_url', i.product_url,
            'asin', i.asin,
            'source', i.source,
            'added_at', i.added_at
          )
          order by i.position
        )
        from public.list_items i
        where i.list_id = l.id
      ),
      '[]'::jsonb
    )
  )
  from public.lists l
  where l.share_token = p_token;
$$;

revoke execute on function public.get_shared_list(uuid) from public;
grant execute on function public.get_shared_list(uuid) to anon, authenticated;
