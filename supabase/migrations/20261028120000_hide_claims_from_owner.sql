-- A list's owner never sees whether gifts are claimed, so gifts stay a
-- surprise (product decision 39, ALL-20). Friends still see claims so nobody
-- doubles up. Same function as 20261025140000_lists_schema.sql, except that
-- `claim` is null for every item when the viewer owns the list. The share page
-- used to ask the owner first and then show claims; it now shows none.
-- `create or replace` keeps the existing execute grants (anon, authenticated).

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
