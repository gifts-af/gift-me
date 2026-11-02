-- Your own address, shared by every product (product decisions 38 and 41,
-- ALL-44). It's where gifts to you ship when you keep a list, and "My
-- address" when you buy a gift for yourself to hand over. One row per
-- account, and only you read it.
--
-- This narrows D31 (addresses stay in the concierge): your own address is
-- account data, like your email and phone. Addresses you enter for other
-- people stay on your private `people` rows.

create table public.account_addresses (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  recipient_first_name text not null,
  recipient_last_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  zip text not null,
  country text not null default 'US',
  phone text,
  address_checked_at timestamptz,
  -- Set from the list app. When on, anyone who linked your list to a person
  -- can ship gifts to you and sees your city and state, never the street.
  share_for_gifts boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger account_addresses_updated_at before update on public.account_addresses
  for each row execute function public.set_updated_at();

alter table public.account_addresses enable row level security;

create policy "Users can read their address" on public.account_addresses
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can add their address" on public.account_addresses
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update their address" on public.account_addresses
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their address" on public.account_addresses
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.account_addresses from anon;

-- ─── shared addresses ───────────────────────────────────────────────────────
-- The address of the account a person is linked to (people.linked_user_id,
-- set by lists.link_person), but only while that account shares it.

-- City and state, for the buyer's "Where it goes" screen. Only for your own
-- person; null when it isn't linked or nothing is shared.
create function public.shared_city_for_person(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_linked uuid;
begin
  select p.linked_user_id into v_linked
    from public.people p
   where p.id = p_person_id and p.user_id = auth.uid() and p.deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  return (
    select jsonb_build_object('city', a.city, 'state', a.state)
      from public.account_addresses a
     where a.user_id = v_linked and a.share_for_gifts
  );
end;
$$;

revoke execute on function public.shared_city_for_person(uuid) from public, anon;
grant execute on function public.shared_city_for_person(uuid) to authenticated;

-- The full address, for placing an order. Server only.
create function public.shared_address_for_person(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recipient_first_name', a.recipient_first_name,
    'recipient_last_name', a.recipient_last_name,
    'address_line1', a.address_line1,
    'address_line2', a.address_line2,
    'city', a.city,
    'state', a.state,
    'zip', a.zip,
    'country', a.country,
    'phone', a.phone
  )
    from public.people p
    join public.account_addresses a on a.user_id = p.linked_user_id
   where p.id = p_person_id and p.deleted_at is null and a.share_for_gifts;
$$;

revoke execute on function public.shared_address_for_person(uuid) from public, anon, authenticated;
grant execute on function public.shared_address_for_person(uuid) to service_role;
