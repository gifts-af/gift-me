-- Your own birthday, month and day, saved in Settings (ALL-182). Saving it
-- shares it: a signed-in person adding you from your list's link has it filled
-- in. Account data, like account_addresses, so it sits outside both products.

create table public.account_birthdays (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  month smallint not null check (month between 1 and 12),
  -- 29 February is a birthday, so it has no year to check against.
  day smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_birthdays_real_day
    check (day between 1 and case when month = 2 then 29 when month in (4, 6, 9, 11) then 30 else 31 end)
);

create trigger account_birthdays_updated_at before update on public.account_birthdays
  for each row execute function public.set_updated_at();

alter table public.account_birthdays enable row level security;

create policy "Users can read their birthday" on public.account_birthdays
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can add their birthday" on public.account_birthdays
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update their birthday" on public.account_birthdays
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their birthday" on public.account_birthdays
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.account_birthdays from anon;

-- The birthday of the owner of the list behind a current link, for the Add
-- form. Never for the owner or a signed-out visitor, and nothing while either
-- switch is off. Kept apart from get_shared_list, which anyone can call.
create function lists.owner_birthday(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('month', b.month, 'day', b.day)
    from lists.lists l
    join public.account_birthdays b on b.user_id = l.owner_id
   where l.share_token = p_token
     and l.owner_id <> auth.uid()
     and concierge.setting_int('list_birthday_enabled') = 1
     and concierge.setting_int('list_link_card_enabled') = 1;
$$;

revoke execute on function lists.owner_birthday(uuid) from public, anon;
grant execute on function lists.owner_birthday(uuid) to authenticated;

insert into concierge.app_settings (key, value, description) values
  ('list_birthday_enabled', '1', 'Switch for sharing your birthday with people who add you from your list: on only at exactly 1.');
