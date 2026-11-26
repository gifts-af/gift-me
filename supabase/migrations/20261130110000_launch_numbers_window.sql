-- launch_numbers counted a list started exactly 24 hours before p_now in the
-- day, unlike every other count, whose day starts just after that moment. Now
-- all six use the same window: after p_now - 1 day, up to and including p_now.
create or replace function concierge.launch_numbers(p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with counted as (
    select u.id, u.created_at
    from auth.users u
    where u.deleted_at is null
      and not coalesce((select a.metrics_excluded from concierge.accounts a where a.user_id = u.id), false)
  ),
  since as (select p_now - interval '1 day' as t)
  select jsonb_build_object(
    'signups', jsonb_build_object(
      'day', (select count(*) from counted c, since s where c.created_at > s.t and c.created_at <= p_now),
      'total', (select count(*) from counted c where c.created_at <= p_now)),
    -- A list counts once it has a gift: every account has an empty one.
    'lists_started', jsonb_build_object(
      'day', (select count(*) from lists.lists l join counted c on c.id = l.owner_id, since s
              where (select min(i.added_at) from lists.list_items i where i.list_id = l.id) > s.t
                and (select min(i.added_at) from lists.list_items i where i.list_id = l.id) <= p_now),
      'total', (select count(*) from lists.lists l join counted c on c.id = l.owner_id
                where exists (select 1 from lists.list_items i where i.list_id = l.id and i.added_at <= p_now))),
    'gifts_added', jsonb_build_object(
      'day', (select count(*) from lists.list_items i join lists.lists l on l.id = i.list_id join counted c on c.id = l.owner_id, since s
              where i.added_at > s.t and i.added_at <= p_now),
      'total', (select count(*) from lists.list_items i join lists.lists l on l.id = i.list_id join counted c on c.id = l.owner_id
                where i.added_at <= p_now)),
    -- Someone saved a shared list to one of their people.
    'lists_followed', jsonb_build_object(
      'day', (select count(*) from lists.person_links pl join counted c on c.id = pl.buyer_id, since s
              where pl.created_at > s.t and pl.created_at <= p_now),
      'total', (select count(*) from lists.person_links pl join counted c on c.id = pl.buyer_id where pl.created_at <= p_now)),
    'gifts_claimed', jsonb_build_object(
      'day', (select count(*) from lists.gift_claims g join counted c on c.id = g.claimer_id, since s
              where g.claimed_at > s.t and g.claimed_at <= p_now),
      'total', (select count(*) from lists.gift_claims g join counted c on c.id = g.claimer_id where g.claimed_at <= p_now)),
    'people_added', jsonb_build_object(
      'day', (select count(*) from public.people p join counted c on c.id = p.user_id, since s
              where p.deleted_at is null and p.created_at > s.t and p.created_at <= p_now),
      'total', (select count(*) from public.people p join counted c on c.id = p.user_id
                where p.deleted_at is null and p.created_at <= p_now))
  );
$$;

