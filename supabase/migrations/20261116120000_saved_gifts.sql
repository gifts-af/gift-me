-- Saved gifts for someone (ALL-93, planning decision 54, T72). Gifts a buyer
-- spotted for one of their people, kept on that person's page. Only the buyer
-- who saved them can ever read them: nothing shares them, not even after the
-- person joins and their own list is linked. The rules live here, not only in
-- the app, because signed-in users can reach concierge tables through the API.

create table concierge.saved_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  -- Fixed column limits, like profile_facts' 500 characters (not settings, T23).
  name text not null check (char_length(name) between 1 and 200),
  -- Null when the buyer doesn't know the price yet. Typed or read from a page,
  -- so never trusted for buying: a round re-checks it first (decision 54).
  price_cents integer check (price_cents between 0 and 10000000),
  product_url text check (char_length(product_url) <= 2048 and product_url ~* '^https?://'),
  image_url text check (char_length(image_url) <= 2048 and image_url ~* '^https?://'),
  created_at timestamptz not null default now(),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade
);

create index saved_gifts_person_id_created_at_idx on concierge.saved_gifts (person_id, created_at desc);

-- Owner only: read, add and remove. No update: editing isn't offered, so the
-- grant that default privileges gave is taken back.
alter table concierge.saved_gifts enable row level security;
create policy "Owner can read" on concierge.saved_gifts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner can add" on concierge.saved_gifts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner can delete" on concierge.saved_gifts
  for delete to authenticated using (user_id = (select auth.uid()));
revoke update on concierge.saved_gifts from authenticated;

-- Before each save: the person must be the buyer's own and not deleted (the
-- foreign key alone ignores deleted_at), and under the cap. Locking the
-- person's row makes parallel saves for one person wait their turn, so they
-- can't race past the cap. A missing setting refuses saves rather than
-- allowing any number.
create function concierge.saved_gifts_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  -- Before anything else: this runs with the owner's rights and before the
  -- row's policy is checked, so a save as someone else must learn nothing
  -- about their people (whether one exists, is deleted or is at the cap).
  if new.user_id is distinct from auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  perform 1 from public.people p
   where p.id = new.person_id and p.user_id = new.user_id and p.deleted_at is null
   for no key update;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  v_max := concierge.setting_int('saved_gifts_max');
  if v_max is null then
    raise exception 'saved_gifts_max is not set' using errcode = 'P0001';
  end if;
  if (select count(*) from concierge.saved_gifts g where g.person_id = new.person_id) >= v_max then
    raise exception 'saved_gifts_max' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function concierge.saved_gifts_check() from public, anon, authenticated;

create trigger saved_gifts_check before insert on concierge.saved_gifts
  for each row execute function concierge.saved_gifts_check();

insert into concierge.app_settings (key, value, description) values
  ('saved_gifts_max', '100', 'Most gifts a buyer can save for one person.')
on conflict (key) do nothing;
