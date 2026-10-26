-- The list app, in its own `lists` schema (T19, T20): owner-only lists,
-- share links anyone can open, and claims (design §2.2).
begin;
\ir _helpers.psql
select plan(22);

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
select lists.save_list(null, 'Birthday', '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Kneeler", "price_cents": 2500},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Gloves", "price_cents": 1500}
]'::jsonb) as list_id \gset
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
select lists.save_list(:'list_id', null, '[
  {"id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Kneeler", "price_cents": 2700},
  {"id": "aaaaaaaa-0000-4000-8000-000000000002", "name": "Gloves", "price_cents": 1500}
]'::jsonb);
select tests.act_as_anon();
select is(
  (select count(*)::int from jsonb_array_elements(lists.get_shared_list(:'token') -> 'items') i where i -> 'claim' is not null and i -> 'claim' <> 'null'::jsonb),
  2,
  'saving a list keeps its claims'
);

-- Who may call what. A later drop-and-recreate in `lists` would lose these
-- grants silently (new functions aren't executable by default), so pin them.
select ok(has_function_privilege('anon', 'lists.get_shared_list(uuid)', 'execute'), 'anon can open share links');
select ok(has_function_privilege('anon', 'lists.claim_gift(uuid, uuid, text)', 'execute'), 'anon can claim as a guest');
select ok(
  not has_function_privilege('anon', 'lists.save_list(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'lists.unclaim_gift(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'lists.viewer_display_name()', 'execute'),
  'anon cannot save, unclaim or look up display names'
);
select ok(
  has_function_privilege('authenticated', 'lists.save_list(uuid, text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'lists.unclaim_gift(uuid, uuid)', 'execute'),
  'signed-in users can save and unclaim'
);

-- Signed-out visitors can't save lists.
select throws_ok(
  $q$select lists.save_list(null, 'x', '[]'::jsonb)$q$,
  '42501', null, 'anon cannot save a list'
);

select * from finish();
rollback;
