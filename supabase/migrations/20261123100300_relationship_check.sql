-- Relationships are checked in the database. people.relationship and
-- budget_defaults.relationship were free text, and a person's base budget is
-- found by matching the two (round_candidates joins on it), so a value outside
-- the list, or a renamed one, silently drops the default.
--
-- The stored values are the keys from RELATIONSHIPS in packages/core/src/people.ts
-- (the list the app and the extension share). This function is the one SQL copy
-- of that list; a unit test next to people.ts reads it from this file and fails
-- if the two drift apart. Adding a relationship means a new migration that
-- replaces this function, plus the TypeScript list.

create or replace function public.is_relationship(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value = any (array[
    'aunt',
    'best_friend',
    'boyfriend',
    'brother',
    'brother_in_law',
    'daughter',
    'daughter_in_law',
    'father',
    'father_in_law',
    'friend',
    'girlfriend',
    'grandfather',
    'grandmother',
    'husband',
    'mother',
    'mother_in_law',
    'partner',
    'sister',
    'sister_in_law',
    'son',
    'son_in_law',
    'uncle',
    'wife',
    'other'
  ]);
$$;

-- Adding a key is a new migration that redefines this function. Removing one
-- also needs a data fix first: the function is immutable, so Postgres won't
-- re-check rows already stored until each check is dropped and re-added.
comment on function public.is_relationship(text) is
  'True for a relationship key the app knows (RELATIONSHIPS in packages/core/src/people.ts).';

-- Both columns use the same function, so there is one list to change.
alter table public.people
  add constraint people_relationship_known check (public.is_relationship(relationship));

alter table concierge.budget_defaults
  add constraint budget_defaults_relationship_known check (public.is_relationship(relationship));
