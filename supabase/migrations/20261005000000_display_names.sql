-- Accounts can have an optional display name (set at sign-up, stored in
-- auth.users.raw_user_meta_data ->> 'display_name'). A signed-in claimer is
-- now named by it, falling back to their email when they didn't give one.
-- Read from auth.users rather than the JWT so it's never stale.
create function public.viewer_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    left(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), 80),
    nullif(trim(u.email), '')
  )
  from auth.users u
  where u.id = auth.uid();
$$;

revoke execute on function public.viewer_display_name() from public, anon;
grant execute on function public.viewer_display_name() to authenticated;

-- Same as before, plus the name a claim by this viewer would show.
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
      'email', auth.jwt() ->> 'email',
      'name', public.viewer_display_name()
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

-- Same as before, but a signed-in claimer is named by their display name,
-- or their email if they have none. A guest still names themselves.
create or replace function public.claim_gift(p_token uuid, p_item_id uuid, p_name text)
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
    v_name := public.viewer_display_name();
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
