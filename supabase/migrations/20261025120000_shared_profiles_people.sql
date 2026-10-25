-- Shared tables used by every product (design §2.2, §3, T19): one profile
-- per account, and one record per loved one. Money and Zinc details are not
-- here; they stay in the concierge schema (D31).

-- ─── updated_at ─────────────────────────────────────────────────────────────

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── profiles ───────────────────────────────────────────────────────────────
-- One row per account, keyed by the auth user id. Created at sign-up by the
-- trigger below; existing accounts are filled in by backfill_profiles().

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  email text,
  phone text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "Users can read their profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users can update their profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No insert or delete policy: the trigger creates profiles, and deleting the
-- account deletes the profile.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 80),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Gives every existing account a profile. Safe to run more than once.
create function public.backfill_profiles()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.profiles (id, display_name, email)
  select u.id, left(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), 80), u.email
    from auth.users u
  on conflict (id) do nothing;
$$;

revoke execute on function public.backfill_profiles() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

select public.backfill_profiles();

-- ─── people ─────────────────────────────────────────────────────────────────
-- A loved one the user buys for. The address is optional (P-5) and stored in
-- parts, the way the checkout service needs it. linked_user_id is for later,
-- when a loved one has their own account (T19).

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  relationship text not null,
  birthday date,
  recipient_first_name text,
  recipient_last_name text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  country text not null default 'US',
  phone text,
  address_checked_at timestamptz,
  notes text,
  google_contact_id text,
  linked_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets other tables point at a person and its owner together, so a row can
  -- never reference someone else's person.
  unique (id, user_id)
);

create index people_user_id_idx on public.people (user_id);

create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();

alter table public.people enable row level security;

create policy "Users can read their people" on public.people
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can add people" on public.people
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update their people" on public.people
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their people" on public.people
  for delete to authenticated using (user_id = (select auth.uid()));

-- Signed-out visitors get nothing from either table.
revoke all on public.profiles, public.people from anon;
