-- A shared list never shows an email address (owner, 2026-11-25).
--
--   * An account's name is its display name. One with none takes the name Google
--     gave at sign-up, and existing accounts are filled in the same way.
--   * A name with an @ in it counts as no name, wherever it came from: the rule
--     can't miss an email, and a real name has none.
--   * With no name, a claim says "Someone" (as an erased claimer's does) and a
--     list has no owner name.
--   * Claims already saved under an email are renamed.

-- A name fit to show other people, or null.
create function public.shown_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when position('@' in p_name) = 0 then left(nullif(trim(p_name), ''), 80) end;
$$;

-- The name in an account's sign-up details: the one they typed, or Google's.
create function public.sign_up_name(p_meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    public.shown_name(p_meta ->> 'display_name'),
    public.shown_name(p_meta ->> 'full_name'),
    public.shown_name(p_meta ->> 'name')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, public.sign_up_name(new.raw_user_meta_data), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.backfill_profiles()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.profiles (id, display_name, email)
  select u.id, public.sign_up_name(u.raw_user_meta_data), u.email
    from auth.users u
  on conflict (id) do nothing;
$$;

-- Names existing accounts that have none, and clears a name that is an email
-- (they're asked for one when they share). Run once, below: run again, it would
-- bring back a name its owner has cleared since.
create function public.backfill_profile_names()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles p
     set display_name = public.sign_up_name(u.raw_user_meta_data)
    from auth.users u
   where u.id = p.id
     and public.shown_name(p.display_name) is null
     and p.display_name is distinct from public.sign_up_name(u.raw_user_meta_data);
$$;

-- Only called by functions that run as their owner.
revoke execute on function public.shown_name(text) from public, anon, authenticated;
revoke execute on function public.sign_up_name(jsonb) from public, anon, authenticated;
revoke execute on function public.backfill_profile_names() from public, anon, authenticated;

-- ─── Claims ─────────────────────────────────────────────────────────────────

-- The signed-in viewer's name, as a claim shows it. Null only when there is no
-- account (signed out, or deleted).
create or replace function lists.viewer_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.shown_name(p.display_name), 'Someone')
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = auth.uid();
$$;

-- As in 20261025140000_lists_schema.sql, but a guest who types an email is "Someone".
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
  v_name := coalesce(public.shown_name(v_name), 'Someone');

  begin
    insert into lists.gift_claims (item_id, claimer_id, claimer_name)
    values (p_item_id, auth.uid(), v_name);
  exception when unique_violation then
    return jsonb_build_object('error', 'already_claimed');
  end;

  return jsonb_build_object('name', v_name, 'mine', auth.uid() is not null);
end;
$$;

-- As in 20261109100000_zinc_wallet.sql, with the claimer named the new way.
create or replace function lists.claim_for_order(p_item_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- Named the way a signed-in claimer is (lists.viewer_display_name).
  select coalesce(public.shown_name(p.display_name), 'Someone')
    into v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = p_user_id;
  if v_name is null or not exists (select 1 from lists.list_items where id = p_item_id) then
    return false;
  end if;
  insert into lists.gift_claims (item_id, claimer_id, claimer_name, for_order)
  values (p_item_id, p_user_id, v_name, true)
  on conflict (item_id) do nothing;
  return found;
end;
$$;

-- Renames claims saved under an email. Run once, below, after names are filled in.
create function lists.hide_claim_emails()
returns void
language sql
security definer
set search_path = ''
as $$
  update lists.gift_claims c
     set claimer_name = coalesce(
       (select public.shown_name(p.display_name) from public.profiles p where p.id = c.claimer_id),
       'Someone'
     )
   where position('@' in c.claimer_name) > 0;
$$;

revoke execute on function lists.hide_claim_emails() from public, anon, authenticated;

-- ─── The shared list and its preview ────────────────────────────────────────
-- As in 20261122140000_add_from_list_link.sql, but the owner's name is one fit
-- to show, and the viewer's own email is no longer sent: nothing shows it now.

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
    -- The off switch, for the page: a signed-out visitor can't read
    -- app_settings, and this runs as its owner.
    'card_enabled', coalesce(concierge.setting_int('list_link_card_enabled'), 0) = 1,
    'owner_name', case
      when coalesce(concierge.setting_int('list_link_card_enabled'), 0) = 1 then (
        select public.shown_name(pr.display_name) from public.profiles pr where pr.id = l.owner_id
      )
    end,
    'linked_person', case
      when auth.uid() is null or l.owner_id = auth.uid() then null
      else (
        select jsonb_build_object('id', p.id, 'name', p.name)
          from lists.person_links pl
          join public.people p on p.id = pl.person_id and p.deleted_at is null
         where pl.list_id = l.id
           and pl.share_token = l.share_token
           and pl.buyer_id = auth.uid()
           and p.user_id = auth.uid()
         order by pl.created_at desc
         limit 1
      )
    end,
    'viewer', jsonb_build_object(
      'signed_in', auth.uid() is not null,
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

create or replace function lists.share_preview(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'owner_name', case
      when coalesce(concierge.setting_int('list_link_card_enabled'), 0) = 1 then (
        select public.shown_name(pr.display_name) from public.profiles pr where pr.id = l.owner_id
      )
    end,
    'item_count', (select count(*)::int from lists.list_items i where i.list_id = l.id)
  )
  from lists.lists l
  where l.share_token = p_token;
$$;

select public.backfill_profile_names();
select lists.hide_claim_emails();
