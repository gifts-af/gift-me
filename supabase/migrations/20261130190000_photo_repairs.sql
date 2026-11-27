-- A daily repair for gifts with a link but no usable photo (ALL-000, owner 2026-11-27).
--
-- Two kinds of gift end up that way: an Amazon gift added after the daily
-- Zinc lookup allowance ran out keeps the guessed /images/P/<ASIN> photo,
-- which Amazon often serves as a 1x1 GIF; and another store's gift whose
-- page read found no photo. The daily tick's housekeeping tries each one
-- again, a few at a time, and stores what it finds as our own copy in the
-- list-photos bucket, the way the extension does.
--
-- What this adds:
--   * lists.photo_repairs, one row per gift tried, for the backoff: waits
--     double after each failure, and a gift is given up on after
--     photo_repair_max_attempts;
--   * lists.photo_repair_candidates(), which claims the gifts due a try,
--     real people's and the most active first;
--   * lists.save_repaired_photo(), which saves a found photo and moves the
--     list's version so an open My list tab can't overwrite it;
--   * lists.take_repair_amazon_lookup(), one Zinc lookup counted against
--     amazon_paste_lookups_per_day_total only (the repair has no signed-in
--     person), so amazon_lookups.user_id may now be null;
--   * has_photo may turn on (never off), so a repaired gift's stored photo
--     is deleted with it like an extension photo;
--   * the settings, with photo_repair_enabled as the off switch.
--
-- Expand only (E7). No key to lists.lists: a second key between list_items
-- and lists broke PostgREST embeds (#188).

-- ─── Backoff ────────────────────────────────────────────────────────────────

create table lists.photo_repairs (
  item_id uuid primary key references lists.list_items (id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_outcome text check (char_length(last_outcome) between 1 and 40),
  gave_up_at timestamptz
);

comment on table lists.photo_repairs is
  'Gifts the daily photo repair has tried and failed on: how many tries, when to try next, and when it gave up. A repaired, edited or removed gift loses its row.';
comment on column lists.photo_repairs.attempts is 'Failed tries so far.';
comment on column lists.photo_repairs.next_attempt_at is 'Not tried again before this: photo_repair_backoff_days, doubled after each failure.';
comment on column lists.photo_repairs.last_outcome is 'Why the last try failed, as a short code (not_found, tiny_image, http_status, ...).';
comment on column lists.photo_repairs.gave_up_at is 'Set after photo_repair_max_attempts failures; the gift is never tried again.';

-- Only the server reads or writes it: new tables in `lists` are granted to
-- signed-in users by default, so take that back.
alter table lists.photo_repairs enable row level security;
revoke all on lists.photo_repairs from public, anon, authenticated;
grant select, insert, update, delete on lists.photo_repairs to service_role;

-- A gift whose link or photo changes starts over: the row is dropped.
create function lists.reset_photo_repair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from lists.photo_repairs where item_id = new.id;
  return new;
end;
$$;

create trigger reset_photo_repair after update of product_url, image_url on lists.list_items
  for each row
  when (old.product_url is distinct from new.product_url or old.image_url is distinct from new.image_url)
  execute function lists.reset_photo_repair();

revoke execute on function lists.reset_photo_repair() from public, anon, authenticated;

-- ─── has_photo may turn on ──────────────────────────────────────────────────
-- A repaired gift gets our stored photo after it was added. Turning has_photo
-- on is safe: the photo's path is still the gift's own id. Turning it off, or
-- changing the id, stays refused (it would leave the file behind or point at
-- another).

drop trigger keep_photo_path on lists.list_items;
create trigger keep_photo_path before update on lists.list_items
  for each row
  when (old.id is distinct from new.id or (old.has_photo and not new.has_photo))
  execute function lists.keep_photo_path();

-- The repair queues its photo before uploading it, like the extension; the
-- gift taking the photo takes it off the queue again.
create trigger unqueue_repaired_photo after update of has_photo on lists.list_items
  for each row when (not old.has_photo and new.has_photo)
  execute function lists.unqueue_added_photo();

-- ─── Candidates ─────────────────────────────────────────────────────────────

-- The guessed Amazon photo product-link.ts builds when there's no lookup.
create function lists.is_guessed_amazon_photo(p_url text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_url ~ '^https://images-na\.ssl-images-amazon\.com/images/P/[A-Z0-9]{10}\.01\._SCLZZZZZZZ_\.jpg$', false);
$$;

revoke execute on function lists.is_guessed_amazon_photo(text) from public, anon;
grant execute on function lists.is_guessed_amazon_photo(text) to authenticated, service_role;

-- Claims the gifts due a try: a link, no stored photo, no photo or the
-- guessed Amazon one, added in the last p_max_age_days, not given up on and
-- not waiting. Typed-in gifts (no link) and any other photo are never
-- touched. Each gift picked is claimed for p_claim_minutes (its
-- next_attempt_at moves forward, attempts unchanged), and claims take turns
-- on one lock, so two runs never pick the same gift. The run then saves the
-- real outcome over the claim.
-- Order (owner): real people before team and test accounts
-- (accounts.metrics_excluded; no accounts row is a real person), then the
-- most active owner (latest of the list's update, the owner's last sign-in
-- and the gift's add), then the newest gift. Security definer to read
-- auth.users; the server only.
create function lists.photo_repair_candidates(p_limit integer, p_max_age_days integer, p_claim_minutes integer)
returns table (item_id uuid, owner_id uuid, product_url text, asin text, image_url text, attempts integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform pg_advisory_xact_lock(hashtextextended('lists.photo_repair_candidates', 0));
  return query
  with picked as (
    select i.id, l.owner_id, i.product_url, i.asin, i.image_url, coalesce(r.attempts, 0) as attempts
      from lists.list_items i
      join lists.lists l on l.id = i.list_id
      left join lists.photo_repairs r on r.item_id = i.id
      left join concierge.accounts a on a.user_id = l.owner_id
      left join auth.users u on u.id = l.owner_id
     where i.product_url is not null
       and not i.has_photo
       and (i.image_url is null or lists.is_guessed_amazon_photo(i.image_url))
       and i.added_at >= now() - make_interval(days => p_max_age_days)
       and (r.item_id is null or (r.gave_up_at is null and r.next_attempt_at <= now()))
     order by coalesce(a.metrics_excluded, false),
              greatest(l.updated_at, u.last_sign_in_at, i.added_at) desc,
              i.added_at desc,
              i.id
     limit p_limit
  ), claimed as (
    insert into lists.photo_repairs as r (item_id, next_attempt_at)
    select p.id, now() + make_interval(mins => p_claim_minutes) from picked p
    on conflict on constraint photo_repairs_pkey do update set next_attempt_at = excluded.next_attempt_at
  )
  select p.id, p.owner_id, p.product_url, p.asin, p.image_url, p.attempts from picked p;
end;
$$;

revoke execute on function lists.photo_repair_candidates(integer, integer, integer) from public, anon, authenticated;
grant execute on function lists.photo_repair_candidates(integer, integer, integer) to service_role;

-- Gives a gift its repaired photo, only if it is still as the repair found
-- it (no stored photo, same link, same photo), and moves its list's version
-- the way add_item does, so a My list tab opened before the repair can't
-- save the old photo back over it (save_list_checked answers GL409 and the
-- tab merges). Same locks as a save: the owner's, then the list row. True
-- when the photo was saved.
create function lists.save_repaired_photo(p_item_id uuid, p_product_url text, p_old_image_url text, p_new_image_url text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_id uuid;
  v_owner uuid;
begin
  select i.list_id, l.owner_id into v_list_id, v_owner
    from lists.list_items i join lists.lists l on l.id = i.list_id
   where i.id = p_item_id;
  if v_list_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lists.save_list_checked:' || v_owner::text, 0));
  perform 1 from lists.lists where id = v_list_id for update;

  update lists.list_items
     set image_url = p_new_image_url, has_photo = true
   where id = p_item_id
     and list_id = v_list_id
     and not has_photo
     and product_url = p_product_url
     and image_url is not distinct from p_old_image_url;
  if not found then
    return false;
  end if;

  update lists.lists set updated_at = clock_timestamp() where id = v_list_id;
  return true;
end;
$$;

revoke execute on function lists.save_repaired_photo(uuid, text, text, text) from public, anon, authenticated;
grant execute on function lists.save_repaired_photo(uuid, text, text, text) to service_role;

-- ─── Zinc lookups for the repair ────────────────────────────────────────────

-- A repair lookup belongs to no signed-in person: it counts only toward the
-- daily ceiling across everyone.
alter table lists.amazon_lookups alter column user_id drop not null;
comment on column lists.amazon_lookups.user_id is
  'Who pasted the link; null for the daily photo repair, which counts only toward amazon_paste_lookups_per_day_total.';

-- Takes one lookup from amazon_paste_lookups_per_day_total for the photo
-- repair: true when there was one left (and records it). Same lock and
-- clean-up as take_amazon_lookup, so the two count one after the other.
-- Errors: 22023 the ceiling setting is missing.
create function lists.take_repair_amazon_lookup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_ceiling integer := concierge.setting_int('amazon_paste_lookups_per_day_total');
begin
  if v_ceiling is null then
    raise exception 'amazon_paste_lookups_per_day_total is missing' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lists.take_amazon_lookup:total', 0));

  delete from lists.amazon_lookups
  where created_at < now() - interval '1 day';

  select count(*) into v_total from lists.amazon_lookups;
  if v_total >= v_ceiling then
    return false;
  end if;

  insert into lists.amazon_lookups (user_id) values (null);
  return true;
end;
$$;

revoke execute on function lists.take_repair_amazon_lookup() from public, anon, authenticated;
grant execute on function lists.take_repair_amazon_lookup() to service_role;

-- ─── Settings ───────────────────────────────────────────────────────────────

insert into concierge.app_settings (key, value, description) values
  ('photo_repair_enabled', '1', 'Switch for the daily tick''s photo repair: 1 tries again for gifts with a link but no usable photo, 0 stops it.'),
  ('photo_repair_per_run', '20', 'Most gifts the daily photo repair tries in one run.'),
  ('photo_repair_max_attempts', '4', 'Failed tries before the photo repair gives up on a gift.'),
  ('photo_repair_backoff_days', '1', 'Days the photo repair waits after a gift''s first failed try; the wait doubles after each one (1, 2, 4, 8).'),
  ('photo_repair_max_age_days', '60', 'Only gifts added in this many days are tried by the photo repair.'),
  ('photo_repair_budget_ms', '60000', 'Most time (ms) one photo repair run starts new gifts for; it shares the daily tick''s 300 s with the rounds, and the rest wait for the next day.'),
  ('photo_repair_claim_minutes', '15', 'Minutes a photo repair run holds the gifts it picked, so an overlapping run skips them; longer than photo_repair_budget_ms plus one gift''s slowest try.'),
  ('photo_repair_min_px', '100', 'Smallest photo the repair keeps, in pixels on each side; anything smaller (like a 1x1 placeholder) is refused.')
on conflict (key) do nothing;

-- Raised by hand on prod and dev on 2026-11-27; this keeps the repo in step.
update concierge.app_settings set value = '30' where key = 'amazon_paste_lookups_per_user_per_day';
