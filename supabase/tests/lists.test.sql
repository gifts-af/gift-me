-- The list app, in its own `lists` schema (T19, T20): owner-only lists,
-- share links anyone can open, and claims (design §2.2).
begin;
\ir _helpers.psql
select plan(43);

select tests.create_user('a@example.com', 'Aaron') as a \gset
select tests.create_user('b@example.com', 'Bee') as b \gset
select tests.create_user('c@example.com') as c \gset

-- The tables live in `lists`, and nothing is left in `public`.
select has_table('lists', 'lists', 'lists.lists exists');
select has_table('lists', 'list_items', 'lists.list_items exists');
select has_table('lists', 'gift_claims', 'lists.gift_claims exists');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('save_list', 'get_shared_list', 'claim_gift', 'unclaim_gift', 'viewer_display_name'))
  + (select count(*)::int from pg_tables where schemaname = 'public' and tablename in ('lists', 'list_items', 'gift_claims')),
  0,
  'no list tables or functions are left in public'
);

-- A saves a list with two gifts.
select tests.act_as(:'a');
select (lists.save_list_checked(null, 'Birthday', '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Kneeler", "price_cents": 2500},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Gloves", "price_cents": 1500}
]'::jsonb, null) ->> 'id')::uuid as list_id \gset
select share_token as token from lists.lists where id = :'list_id' \gset
select is((select count(*)::int from lists.list_items), 2, 'A sees their two gifts');

-- B and signed-out visitors see nothing in the tables.
select tests.act_as(:'b');
select is((select count(*)::int from lists.lists) + (select count(*)::int from lists.list_items), 0, 'B cannot see A''s list');
select tests.act_as_anon();
select is((select count(*)::int from lists.lists), 0, 'anon sees no lists in the tables');

-- Anyone with the link sees the list and can claim as a guest.
select is((lists.get_shared_list(:'token') ->> 'title'), 'Birthday', 'anon opens the share link');
select is(jsonb_array_length(lists.get_shared_list(:'token') -> 'items'), 2, 'the share link shows both gifts');
select is(
  lists.claim_gift(:'token', 'aaaaaaaa-0000-4000-8000-000000000001', 'Grandma') ->> 'name',
  'Grandma',
  'a guest claims a gift by name'
);
select is(
  lists.claim_gift(:'token', 'aaaaaaaa-0000-4000-8000-000000000001', 'Someone') ->> 'error',
  'already_claimed',
  'a claimed gift can''t be claimed twice'
);

-- The owner can't claim their own gifts.
select tests.act_as(:'a');
select is((lists.get_shared_list(:'token') ->> 'is_owner')::boolean, true, 'the owner is told it''s their list');
select throws_ok(
  format($q$select lists.claim_gift(%L, 'aaaaaaaa-0000-4000-8000-000000000002', null)$q$, :'token'),
  '42501', null, 'the owner cannot claim'
);

-- Signed-in claimers are named by their profile's display name, or email.
select tests.act_as(:'b');
select is(
  lists.claim_gift(:'token', 'aaaaaaaa-0000-4000-8000-000000000002', null) ->> 'name',
  'Bee',
  'a signed-in claimer is named by their display name'
);
select is(lists.unclaim_gift(:'token', 'aaaaaaaa-0000-4000-8000-000000000002'), true, 'B takes back their own claim');
select tests.act_as(:'c');
select is(
  lists.claim_gift(:'token', 'aaaaaaaa-0000-4000-8000-000000000002', null) ->> 'name',
  'c@example.com',
  'without a display name, the claimer is named by their email'
);

-- Re-saving the list keeps existing claims (item ids stay the same).
select tests.act_as(:'a');
select lists.save_list_checked(:'list_id', null, '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Kneeler", "price_cents": 2700},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Gloves", "price_cents": 1500}
]'::jsonb, (select updated_at::text from lists.lists where id = :'list_id'));
select tests.act_as_anon();
select is(
  (select count(*)::int from jsonb_array_elements(lists.get_shared_list(:'token') -> 'items') i where i -> 'claim' is not null and i -> 'claim' <> 'null'::jsonb),
  2,
  'saving a list keeps its claims'
);

-- The list's owner never sees claims, so gifts stay a surprise (product
-- decision 39). Friends still do, so nobody doubles up.
select tests.act_as(:'a');
select is(
  (select count(*)::int from jsonb_array_elements(lists.get_shared_list(:'token') -> 'items') i where i -> 'claim' <> 'null'::jsonb),
  0,
  'the owner sees no claims on their own list'
);
select tests.act_as(:'b');
select is(
  (select count(*)::int from jsonb_array_elements(lists.get_shared_list(:'token') -> 'items') i where i -> 'claim' <> 'null'::jsonb),
  2,
  'a signed-in friend still sees both claims'
);

-- Who may call what. A later drop-and-recreate in `lists` would lose these
-- grants silently (new functions aren't executable by default), so pin them.
select ok(has_function_privilege('anon', 'lists.get_shared_list(uuid)', 'execute'), 'anon can open share links');
select ok(has_function_privilege('anon', 'lists.claim_gift(uuid, uuid, text)', 'execute'), 'anon can claim as a guest');
select ok(
  not has_function_privilege('anon', 'lists.unclaim_gift(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'lists.viewer_display_name()', 'execute'),
  'anon cannot unclaim or look up display names'
);
select ok(
  has_function_privilege('authenticated', 'lists.unclaim_gift(uuid, uuid)', 'execute'),
  'signed-in users can unclaim'
);

-- ─── save_list_checked (ALL-127) ────────────────────────────────────────────
-- Each save carries the list's version (updated_at as text); an out-of-date
-- one is refused with GL409, so a stale tab can't overwrite newer gifts.
select tests.act_as(:'a');
select updated_at::text as v0 from lists.lists where id = :'list_id' \gset

select lists.save_list_checked(:'list_id', null, '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Kneeler", "price_cents": 2700},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Gloves", "price_cents": 1500},
  {"id": "aaaaaaaa-0000-4000-8000-000000000003", "name": "Trowel", "price_cents": 900}
]'::jsonb, :'v0') as saved \gset
select is((:'saved'::jsonb) ->> 'id', :'list_id', 'a checked save returns the list id');
select is(
  (:'saved'::jsonb) ->> 'updated_at',
  (select updated_at::text from lists.lists where id = :'list_id'),
  'a checked save returns the new version, as text'
);
select isnt((:'saved'::jsonb) ->> 'updated_at', :'v0', 'the version moves on with each save');
select is((select count(*)::int from lists.list_items where list_id = :'list_id'), 3, 'the current version saves the gifts');

-- The gifts it wrote come back with the version, from the same snapshot, so
-- the app never pairs a version with rows another save wrote later.
select is(
  (:'saved'::jsonb) -> 'items',
  (select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'price_cents', i.price_cents, 'image_url', i.image_url,
      'product_url', i.product_url, 'asin', i.asin, 'source', i.source, 'added_at', i.added_at
    ) order by i.position)
     from lists.list_items i where i.list_id = :'list_id'),
  'a checked save returns the gifts it wrote, in order'
);
select is((:'saved'::jsonb) ->> 'share_token', :'token', 'and the share token');

-- The same old version again: refused, and nothing changes.
select throws_ok(
  format($q$select lists.save_list_checked(%L, null, '[]'::jsonb, %L)$q$, :'list_id', :'v0'),
  'GL409', null, 'a save with an out-of-date version is refused'
);
select is((select count(*)::int from lists.list_items where list_id = :'list_id'), 3, 'a refused save changes nothing');

-- The version is compared as a time, not as text, so a different print of the
-- same moment (another DateStyle, or ISO with a T) still matches. A claim on a
-- kept gift survives the save.
select to_json(updated_at) #>> '{}' as v1_iso from lists.lists where id = :'list_id' \gset
select isnt(:'v1_iso'::text, (:'saved'::jsonb) ->> 'updated_at', 'the ISO print differs from the text print');
select lists.save_list_checked(:'list_id', null, '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Kneeler", "price_cents": 2700},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Gloves", "price_cents": 1500}
]'::jsonb, :'v1_iso') ->> 'updated_at' as v2 \gset
select isnt(:'v2'::text, null,'the same moment, printed differently, is still the current version');
select throws_ok(
  format($q$select lists.save_list_checked(%L, null, '[]'::jsonb, 'not a time')$q$, :'list_id'),
  'GL409', null, 'a version that isn''t a time is refused as stale'
);
select throws_ok(
  format($q$select lists.save_list_checked(%L, null, '[]'::jsonb, null)$q$, :'list_id'),
  'GL409', null, 'a save to an existing list with no version is refused as stale, never unchecked'
);
select tests.act_as(:'b');
select is(
  (select count(*)::int from jsonb_array_elements(lists.get_shared_list(:'token') -> 'items') i where i -> 'claim' <> 'null'::jsonb),
  2,
  'a checked save keeps the claims on kept gifts'
);

-- Someone else's list, even with its right version: not found, not stale.
select throws_ok(
  format($q$select lists.save_list_checked(%L, null, '[]'::jsonb, %L)$q$, :'list_id', :'v2'),
  'P0002', null, 'another person''s list is not found'
);

-- No list id: creates a list only when the caller has none.
select tests.act_as(:'a');
select throws_ok(
  $q$select lists.save_list_checked(null, null, '[]'::jsonb, null)$q$,
  'GL409', null, 'a caller who already has a list can''t create a second one'
);
select is((select count(*)::int from lists.lists), 1, 'A still has one list');
select tests.act_as(:'c');
select ok(
  (lists.save_list_checked(null, null, '[{"name": "Mug", "price_cents": 1200}]'::jsonb, null) ->> 'updated_at') is not null,
  'a caller with no list creates one'
);
select is((select count(*)::int from lists.list_items), 1, 'with its gift');

-- Signed out: refused.
select tests.act_as_anon();
select throws_ok(
  $q$select lists.save_list_checked(null, 'x', '[]'::jsonb, null)$q$,
  '42501', null, 'anon cannot make a checked save'
);
select ok(
  not has_function_privilege('anon', 'lists.save_list_checked(uuid, text, jsonb, text)', 'execute')
  and has_function_privilege('authenticated', 'lists.save_list_checked(uuid, text, jsonb, text)', 'execute'),
  'only signed-in users can make a checked save'
);

select * from finish();
rollback;
