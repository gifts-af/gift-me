-- One copy of each fact per person (ALL-25 review). Two reads of the same
-- capture can overlap (the popup and "Read it now"); the second one's inserts
-- are skipped here. Matches factKey() in apps/web/modules/concierge/capture/extract.ts:
-- category plus the value, trimmed, spaces collapsed, lower case.

alter table concierge.profile_facts
  add column value_key text generated always as (lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))) stored;

-- Keep the oldest of any duplicates already saved, so the index can be built.
delete from concierge.profile_facts f
using concierge.profile_facts older
where f.person_id = older.person_id
  and f.category = older.category
  and f.value_key = older.value_key
  and (older.created_at, older.id) < (f.created_at, f.id);

create unique index profile_facts_person_fact_key on concierge.profile_facts (person_id, category, value_key);
