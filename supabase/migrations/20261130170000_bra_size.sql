-- Bra size, between dress and shoe. Shared only when its switch is on, like
-- every other size. Expand-only: a new column, its flag and checks, and
-- owner_sizes listing it in Settings order.

alter table public.account_sizes
  add column bra text,
  add column bra_shared boolean not null default false,
  add constraint account_sizes_bra_ok
    check (bra is null or (bra = btrim(bra) and char_length(bra) between 1 and 30 and bra !~ '[\x01-\x1f\x7f]')),
  add constraint account_sizes_bra_shared_has_value check (not bra_shared or bra is not null);

-- Same as before, with bra in its place. create or replace keeps the grants.
create or replace function lists.owner_sizes(p_token uuid)
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
         (4, 'bra', s.bra, s.bra_shared),
         (5, 'shoe', s.shoe, s.shoe_shared),
         (6, 'ring', s.ring, s.ring_shared),
         (7, 'hat', s.hat, s.hat_shared),
         (8, 'color', s.color, s.color_shared)
       ) v(ord, kind, value, shared)
   where l.share_token = p_token
     and l.owner_id is distinct from auth.uid()
     and v.shared
     and concierge.setting_int('list_sizes_enabled') = 1
     and concierge.setting_int('list_link_card_enabled') = 1;
$$;
