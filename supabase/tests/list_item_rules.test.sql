-- My list's rules hold however a gift is written (ALL-142), and the old save
-- function is gone (ALL-130).
begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('a@example.com') as a \gset

-- A small limit for the test, set the way an admin would.
select is(
  (select value from concierge.app_settings where key = 'list_max_items'),
  '500',
  'the list limit is a setting, 500 by default'
);
update concierge.app_settings set value = '3' where key = 'list_max_items';

select tests.act_as(:'a');
select (lists.save_list_checked(null, null, '[
  {"name": "One", "price_cents": 100},
  {"name": "Two", "price_cents": 100}
]'::jsonb, null) ->> 'id')::uuid as list_id \gset

-- ─── Item limit ─────────────────────────────────────────────────────────────

select lives_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents) values (%L, 2, 'Three', 100)$$, :'list_id'),
  'a direct insert up to the limit works'
);
select throws_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents) values (%L, 3, 'Four', 100)$$, :'list_id'),
  '23514', 'A list can hold up to 3 gifts',
  'a direct insert past the limit fails'
);
select throws_ok(
  format($$select lists.save_list_checked(%L, null, '[
    {"name": "1", "price_cents": 1}, {"name": "2", "price_cents": 1},
    {"name": "3", "price_cents": 1}, {"name": "4", "price_cents": 1}
  ]'::jsonb, (select updated_at::text from lists.lists where id = %L))$$, :'list_id', :'list_id'),
  '23514', null,
  'a save past the limit fails'
);
select is(
  (select outcome from lists.add_item(gen_random_uuid(), 'Five', 100, null, null, null, false, 3)),
  'full',
  'add_item still answers full on its own'
);

-- Gifts moved onto a full list count too.
insert into lists.lists (owner_id) values (:'a') returning id as list2 \gset
insert into lists.list_items (list_id, position, name, price_cents) values (:'list2', 0, 'Elsewhere', 100);
select throws_ok(
  format($$update lists.list_items set list_id = %L where list_id = %L$$, :'list_id', :'list2'),
  '23514', null,
  'moving a gift onto a full list fails'
);

-- Removing and re-adding in one save stays within the limit.
select lives_ok(
  format($$select lists.save_list_checked(%L, null, '[
    {"name": "A", "price_cents": 1}, {"name": "B", "price_cents": 1}, {"name": "C", "price_cents": 1}
  ]'::jsonb, (select updated_at::text from lists.lists where id = %L))$$, :'list_id', :'list_id'),
  'a save that swaps every gift at the limit works'
);

-- ─── Photo addresses ────────────────────────────────────────────────────────

select lives_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents, image_url)
           values (%L, 1, 'Photo', 100, 'https://example.com/a.jpg')$$, :'list2'),
  'an https photo address is allowed'
);
select throws_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents, image_url)
           values (%L, 2, 'Plain', 100, 'http://example.com/a.jpg')$$, :'list2'),
  '23514', null,
  'an http photo address is refused'
);
select throws_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents, image_url)
           values (%L, 2, 'Lookalike', 100, 'http://localhost.evil.example/a.jpg')$$, :'list2'),
  '23514', null,
  'a host that only starts with localhost is refused'
);
select lives_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents, image_url)
           values (%L, 2, 'Local', 100, 'http://127.0.0.1:54321/storage/v1/object/public/list-photos/x.jpg')$$, :'list2'),
  'local Supabase storage over http is allowed'
);
select throws_ok(
  format($$update lists.list_items set image_url = 'javascript:alert(1)' where list_id = %L$$, :'list2'),
  '23514', null,
  'changing a photo to a non-https address is refused'
);
select throws_ok(
  format($$update lists.list_items set image_url = '//tracker.example/p.gif' where list_id = %L$$, :'list2'),
  '23514', null,
  'a protocol-relative address is refused'
);

-- ─── Setting and old function ───────────────────────────────────────────────

select tests.reset_role();
delete from concierge.app_settings where key = 'list_max_items';
select tests.act_as(:'a');
select throws_ok(
  format($$insert into lists.list_items (list_id, position, name, price_cents) values (%L, 9, 'No limit', 100)$$, :'list2'),
  '22023', null,
  'with the setting missing, adds fail rather than guess a limit'
);

select tests.reset_role();
select hasnt_function('lists', 'save_list', array['uuid', 'text', 'jsonb'], 'the old save_list is gone');
select ok(
  not has_function_privilege('authenticated', 'lists.enforce_item_limit()', 'execute'),
  'nobody calls the limit check directly'
);

select * from finish();
rollback;
