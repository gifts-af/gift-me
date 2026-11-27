-- "+ My list" on a shared list copies a gift to the viewer's own list. Record
-- where the copy came from, so a list's owner can later see how many people
-- added their gifts, and the copy can say "From <name>'s list". Counts only
-- are planned for the owner, never who copied (T42). Set by the app with the
-- service role after the add. Expand-only (E7).
--
-- Plain ids, no foreign keys: a second key from list_items to lists makes
-- PostgREST's lists -> list_items embed ambiguous, which broke every My list
-- read in CI. A source list or gift that's later deleted just leaves an id
-- that matches nothing, which the counts ignore.
alter table lists.list_items
  add column copied_from_list_id uuid,
  add column copied_from_item_id uuid;

comment on column lists.list_items.copied_from_list_id is
  'The shared list this gift was copied from with "+ My list"; null otherwise. No foreign key (see migration).';
comment on column lists.list_items.copied_from_item_id is
  'The gift on that list it was copied from; null otherwise. No foreign key (see migration).';

create index list_items_copied_from_list_idx on lists.list_items (copied_from_list_id)
  where copied_from_list_id is not null;
create index list_items_copied_from_item_idx on lists.list_items (copied_from_item_id)
  where copied_from_item_id is not null;
