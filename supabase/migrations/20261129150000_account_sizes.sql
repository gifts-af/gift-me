-- Your sizes and favorite color, saved in Settings. Each one is shared or not;
-- anyone holding your list's current link sees the shared ones when they go to
-- claim a gift. Account data, like account_birthdays, so it sits outside both
-- products.

create table public.account_sizes (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  top text,
  pants text,
  dress text,
  shoe text,
  ring text,
  hat text,
  color text,
  top_shared boolean not null default false,
  pants_shared boolean not null default false,
  dress_shared boolean not null default false,
  shoe_shared boolean not null default false,
  ring_shared boolean not null default false,
  hat_shared boolean not null default false,
  color_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The form counts characters the same way, so a value it accepts always
  -- saves. No line breaks or other control characters.
  constraint account_sizes_top_ok
    check (top is null or (top = btrim(top) and char_length(top) between 1 and 30 and top !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_top_shared_has_value check (not top_shared or top is not null),
  constraint account_sizes_pants_ok
    check (pants is null or (pants = btrim(pants) and char_length(pants) between 1 and 30 and pants !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_pants_shared_has_value check (not pants_shared or pants is not null),
  constraint account_sizes_dress_ok
    check (dress is null or (dress = btrim(dress) and char_length(dress) between 1 and 30 and dress !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_dress_shared_has_value check (not dress_shared or dress is not null),
  constraint account_sizes_shoe_ok
    check (shoe is null or (shoe = btrim(shoe) and char_length(shoe) between 1 and 30 and shoe !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_shoe_shared_has_value check (not shoe_shared or shoe is not null),
  constraint account_sizes_ring_ok
    check (ring is null or (ring = btrim(ring) and char_length(ring) between 1 and 30 and ring !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_ring_shared_has_value check (not ring_shared or ring is not null),
  constraint account_sizes_hat_ok
    check (hat is null or (hat = btrim(hat) and char_length(hat) between 1 and 30 and hat !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_hat_shared_has_value check (not hat_shared or hat is not null),
  constraint account_sizes_color_ok
    check (color is null or (color = btrim(color) and char_length(color) between 1 and 30 and color !~ '[\x01-\x1f\x7f]')),
  constraint account_sizes_color_shared_has_value check (not color_shared or color is not null)
);

create trigger account_sizes_updated_at before update on public.account_sizes
  for each row execute function public.set_updated_at();

alter table public.account_sizes enable row level security;

create policy "Users can read their sizes" on public.account_sizes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can add their sizes" on public.account_sizes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update their sizes" on public.account_sizes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their sizes" on public.account_sizes
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.account_sizes from anon;

-- The shared sizes of the owner of the list behind a current link, for the
-- claim boxes. Open to signed-out visitors too, since anyone holding the link
-- can claim. Null, never an empty array, for the owner, nothing shared, a
-- switch off or an old link. Kept apart from get_shared_list so the page and
-- its preview never carry them.
create function lists.owner_sizes(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object('kind', v.kind, 'value', v.value) order by v.ord)
    from lists.lists l
    join public.account_sizes s on s.user_id = l.owner_id
   cross join lateral (values
         (1, 'top', s.top, s.top_shared),
         (2, 'pants', s.pants, s.pants_shared),
         (3, 'dress', s.dress, s.dress_shared),
         (4, 'shoe', s.shoe, s.shoe_shared),
         (5, 'ring', s.ring, s.ring_shared),
         (6, 'hat', s.hat, s.hat_shared),
         (7, 'color', s.color, s.color_shared)
       ) v(ord, kind, value, shared)
   where l.share_token = p_token
     and l.owner_id is distinct from auth.uid()
     and v.shared
     and concierge.setting_int('list_sizes_enabled') = 1
     and concierge.setting_int('list_link_card_enabled') = 1;
$$;

revoke execute on function lists.owner_sizes(uuid) from public;
grant execute on function lists.owner_sizes(uuid) to anon, authenticated;

insert into concierge.app_settings (key, value, description) values
  ('list_sizes_enabled', '1', 'Switch for sharing your sizes and favorite color with people who claim a gift from your list: on only at exactly 1.');
