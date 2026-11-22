-- The database enforces My list's rules itself (ALL-142), and the old save
-- function goes (ALL-130).
--
-- Row security only checks that a signed-in user owns the list, so they could
-- write lists.list_items straight through Supabase's API, past the app's
-- checks. Two rules now hold however a gift is written:
--
--   * A list holds at most list_max_items gifts (T23). add_item still answers
--     "full" on its own; a save or direct insert past the limit fails. Lowering
--     the setting below a list's size stops adds to that list (edits and
--     removes still work), and a value that isn't a number fails every write.
--   * A gift's photo address starts with https://, or is http:// on this
--     machine (localhost or 127.0.0.1: local Supabase storage, which can't
--     reach anyone else). Existing http:// addresses elsewhere are moved to
--     https:// first; anything else is dropped (the app only ever stored
--     http(s) links, so there should be none).
--
-- An https:// photo on someone else's server can still see who opens a shared
-- list. Serving photos through our own server is ALL-143.
--
-- Contract (E7): lists.save_list was kept beside save_list_checked so a Vercel
-- rollback to code that called it still saved (ALL-127). That code is long
-- gone from production, so it's dropped here.

-- ─── Setting ────────────────────────────────────────────────────────────────

insert into concierge.app_settings (key, value, description) values
  ('list_max_items', '500', 'Most gifts one list can hold. The database refuses more (ALL-142); My list and the extension say so first.')
on conflict (key) do nothing;

-- ─── Photo addresses ────────────────────────────────────────────────────────

-- The rule, in one place; apps/web/modules/lists/lib/save-list.ts
-- (cleanImageUrl) applies the same one before saving.
create function lists.is_allowed_image_url(p_url text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_url ~ '^https://' or p_url ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/';
$$;

-- Checked as whoever writes the gift. It only reads its argument.
revoke execute on function lists.is_allowed_image_url(text) from public, anon;
grant execute on function lists.is_allowed_image_url(text) to authenticated, service_role;

update lists.list_items
   set image_url = 'https://' || substr(image_url, 8)
 where image_url ~* '^http://' and not lists.is_allowed_image_url(image_url);

update lists.list_items
   set image_url = null
 where image_url is not null and not lists.is_allowed_image_url(image_url);

alter table lists.list_items
  add constraint list_items_image_url_allowed check (image_url is null or lists.is_allowed_image_url(image_url));

-- ─── Item limit ─────────────────────────────────────────────────────────────
-- Checked once per statement, after it: a save writes many rows in one
-- statement and deletes some in the same one, so only the finished count means
-- anything. Inserts count, and so do updates that move a gift onto another
-- list; an edit in place doesn't, so a list left over a lowered limit can still
-- be edited and trimmed. Each list is locked first (no key update: it doesn't
-- clash with the foreign-key locks inserts take), so two writers can't both
-- squeeze under the limit; My list's saves and add_item hold that lock already.
-- Runs as its owner to read the setting; a missing setting fails the write
-- rather than guessing a limit (T23).

create function lists.check_item_limit(p_list_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_list_id uuid;
begin
  if coalesce(cardinality(p_list_ids), 0) = 0 then
    return;
  end if;
  select s.value::integer into v_limit from concierge.app_settings s where s.key = 'list_max_items';
  if v_limit is null then
    raise exception 'Setting list_max_items is missing' using errcode = '22023';
  end if;
  for v_list_id in select distinct x from unnest(p_list_ids) x order by 1 loop
    perform 1 from lists.lists l where l.id = v_list_id for no key update;
    if (select count(*) from lists.list_items i where i.list_id = v_list_id) > v_limit then
      raise exception 'A list can hold up to % gifts', v_limit using errcode = '23514';
    end if;
  end loop;
end;
$$;

create function lists.enforce_item_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lists.check_item_limit(array(select n.list_id from new_items n));
  return null;
end;
$$;

create function lists.enforce_item_limit_on_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lists.check_item_limit(array(
    select n.list_id from new_items n join old_items o on o.id = n.id
     where o.list_id is distinct from n.list_id
  ));
  return null;
end;
$$;

revoke execute on function lists.check_item_limit(uuid[]) from public, anon, authenticated;
revoke execute on function lists.enforce_item_limit() from public, anon, authenticated;
revoke execute on function lists.enforce_item_limit_on_move() from public, anon, authenticated;

create trigger enforce_item_limit after insert on lists.list_items
  referencing new table as new_items
  for each statement execute function lists.enforce_item_limit();

create trigger enforce_item_limit_on_move after update on lists.list_items
  referencing old table as old_items new table as new_items
  for each statement execute function lists.enforce_item_limit_on_move();

-- ─── Old save ───────────────────────────────────────────────────────────────

drop function lists.save_list(uuid, text, jsonb);
