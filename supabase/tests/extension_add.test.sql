-- Adding to My list from the extension (ALL-78): lists.add_item's outcomes,
-- the generated match keys, the list-photos bucket, the photo deletion queue
-- and concierge.recent_people. The races are in
-- apps/web/modules/lists/__tests__/add-item-db.test.ts, and every case in
-- match-key-cases.json is checked there too.
begin;
\ir _helpers.psql
select plan(63);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select tests.create_user('c@example.com') as c \gset

-- ─── Schema, bucket, settings ───────────────────────────────────────────────

select has_column('lists', 'list_items', 'product_id', 'list_items has product_id');
select has_column('lists', 'list_items', 'has_photo', 'list_items has has_photo');
select is((select attgenerated::text from pg_attribute where attrelid = 'lists.list_items'::regclass and attname = 'match_key'), 's', 'match_key is a stored generated column');
select is((select attgenerated::text from pg_attribute where attrelid = 'lists.list_items'::regclass and attname = 'store_host'), 's', 'store_host is a stored generated column');

select is((select public from storage.buckets where id = 'list-photos'), true, 'list-photos is public');
select is((select allowed_mime_types from storage.buckets where id = 'list-photos'), array['image/jpeg'], 'list-photos takes JPEGs only');
select is((select file_size_limit from storage.buckets where id = 'list-photos'), 1048576::bigint, 'list-photos has a 1 MB ceiling');
select ok(
  (select file_size_limit from storage.buckets where id = 'list-photos') > concierge.setting_int('list_photo_max_bytes'),
  'the size setting stays below the bucket ceiling'
);

select is(concierge.setting_int('list_photo_width_px'), 400, 'photo width setting');
select is(concierge.setting_int('list_photo_jpeg_quality'), 80, 'photo quality setting');
select is(concierge.setting_int('list_photo_max_bytes'), 200000, 'photo size setting');
select is(concierge.setting_int('extension_add_enabled'), 1, 'extension add switch is on');

-- ─── add_item outcomes ──────────────────────────────────────────────────────

\set i1 'a0000000-0000-4000-8000-000000000001'
\set i2 'a0000000-0000-4000-8000-000000000002'
\set i3 'a0000000-0000-4000-8000-000000000003'
\set i4 'a0000000-0000-4000-8000-000000000004'
\set i5 'a0000000-0000-4000-8000-000000000005'
\set i6 'a0000000-0000-4000-8000-000000000006'
\set i7 'a0000000-0000-4000-8000-000000000007'
\set i8 'a0000000-0000-4000-8000-000000000008'
\set photo 'http://127.0.0.1:54321/storage/v1/object/public/list-photos/'

select tests.act_as(:'a');

-- A has no list yet: the add makes one.
select outcome as o1, list_id as list_a from lists.add_item(
  :'i1', 'Yeti Mug', 3500, 'https://www.rei.com/product/123/yeti', 'SKU-1', :'photo' || :'i1' || '.jpg', false, 500
) \gset
select is(:'o1'::text, 'added', 'the first add is added');
select is((select count(*)::int from lists.lists), 1, 'it made A''s list');
select is(
  (select row(position, image_url, has_photo, source, product_id, match_key, store_host)::text from lists.list_items where id = :'i1'),
  row(0, :'photo' || :'i1' || '.jpg', true, 'extension', 'SKU-1', 'rei.com/product/123/yeti', 'rei.com')::text,
  'the gift is at the top with our photo, source extension and its keys'
);
select updated_at::text as v1 from lists.lists where id = :'list_a' \gset

-- A second product goes on top and moves the list's version.
select is(
  (select outcome from lists.add_item(:'i2', 'Tent', 20000, 'https://www.rei.com/product/999/tent', null, null, false, 500)),
  'added', 'a different product is added'
);
select is(
  (select array_agg(id::text order by position) from lists.list_items),
  array[:'i2', :'i1'],
  'the newest gift is first'
);
select is((select position from lists.list_items where id = :'i2'), 0, 'the new gift is at position 0');
select is((select image_url from lists.list_items where id = :'i2'), null, 'no photo, no image_url');
select ok((select updated_at > :'v1'::timestamptz from lists.lists where id = :'list_a'), 'the add moved updated_at');

-- The same product, by another link: duplicate.
select is(
  (select row(outcome, item_id, existing)::text from lists.add_item(:'i3', 'Mug again', 100, 'https://rei.com/product/123/yeti/?ref=search', null, null, false, 500)),
  row('duplicate', null::uuid, null::jsonb)::text,
  'a link differing by www, slash and tracking is a duplicate'
);

-- Same store, same product id: likely, with the existing gift.
select is(
  (select row(outcome, existing)::text from lists.add_item(:'i3', 'Insulated cup', 100, 'https://www.rei.com/p/cup', 'SKU-1', null, false, 500)),
  row('likely', jsonb_build_object('id', :'i1', 'name', 'Yeti Mug', 'price_cents', 3500, 'image_url', :'photo' || :'i1' || '.jpg'))::text,
  'same store and product id is likely, with the existing gift'
);
-- Same store, same name ignoring case and punctuation: likely.
select is(
  (select outcome from lists.add_item(:'i3', 'yeti-mug!', 100, 'https://www.rei.com/p/other', null, null, false, 500)),
  'likely', 'same store and name is likely'
);
-- Another store with the same name never matches.
select is(
  (select outcome from lists.add_item(:'i3', 'Yeti Mug', 100, 'https://www.target.com/p/yeti', 'SKU-1', null, false, 500)),
  'added', 'another store with the same name and id is added'
);
-- Confirmed: added anyway.
select is(
  (select outcome from lists.add_item(:'i4', 'Insulated cup', 100, 'https://www.rei.com/p/cup', 'SKU-1', null, true, 500)),
  'added', 'a likely duplicate the user confirmed is added'
);
-- Full at the limit (4 gifts now), and nothing added.
select is(
  (select outcome from lists.add_item(:'i5', 'Socks', 100, 'https://www.rei.com/p/socks', null, null, false, 4)),
  'full', 'at the limit the list is full'
);
select is((select count(*)::int from lists.list_items), 4, 'a full list gets nothing');

-- A photo link that isn't this gift's own file is refused.
select throws_ok(
  format($q$select * from lists.add_item(%L, 'Hat', 100, 'https://www.rei.com/p/hat', null, %L, false, 500)$q$,
    :'i5', :'photo' || :'i1' || '.jpg'),
  '22023', null, 'a photo link for another gift is refused'
);
-- Names over 300 characters are refused by the table's own check.
select throws_ok(
  format($q$select * from lists.add_item(%L, %L, 100, 'https://www.rei.com/p/long', null, null, false, 500)$q$,
    :'i5', repeat('x', 301)),
  '23514', null, 'a name over 300 characters is refused'
);

-- ─── Website gifts get keys too ─────────────────────────────────────────────

select tests.act_as(:'b');
select (lists.save_list_checked(null, null, '[
  {"name": "Kettle", "price_cents": 100, "product_url": "https://www.shop.example.com/k/?utm_source=a"}
]'::jsonb, null) ->> 'id') as list_b \gset
select is((select match_key from lists.list_items where list_id = :'list_b'), 'shop.example.com/k', 'a website gift gets a match key');
select is(
  (select outcome from lists.add_item(:'i6', 'Kettle', 100, 'https://shop.example.com/k', null, null, false, 500)),
  'duplicate', 'add_item finds a website gift as a duplicate'
);
-- B's add with a photo, into B's list.
select is(
  (select outcome from lists.add_item(:'i6', 'Pan', 100, 'https://shop.example.com/pan', null, :'photo' || :'i6' || '.jpg', false, 500)),
  'added', 'B adds a gift with a photo'
);

-- ─── My list saves leave the photo alone ────────────────────────────────────

select tests.act_as(:'a');
select updated_at::text as va from lists.lists where id = :'list_a' \gset
select lives_ok(
  format($q$select lists.save_list_checked(%L, null, (
    select jsonb_agg(jsonb_build_object('id', id, 'name', name || ' (edited)', 'price_cents', price_cents,
      'image_url', image_url, 'product_url', product_url, 'asin', asin, 'source', source, 'added_at', added_at) order by position)
    from lists.list_items), %L)$q$, :'list_a', :'va'),
  'a My list save of every gift works'
);
select is(
  (select row(has_photo, product_id, name)::text from lists.list_items where id = :'i1'),
  row(true, 'SKU-1', 'Yeti Mug (edited)')::text,
  'the save keeps has_photo and product_id'
);

-- ─── Photo deletion queue ───────────────────────────────────────────────────

-- Nobody can change a gift's id or has_photo, so a queued path can't be redirected or lost.
select throws_ok(
  format($q$update lists.list_items set id = gen_random_uuid() where id = %L$q$, :'i1'),
  '42501', null, 'a gift''s id can''t be changed'
);
select throws_ok(
  format($q$update lists.list_items set has_photo = false where id = %L$q$, :'i1'),
  '42501', null, 'has_photo can''t be changed'
);
-- B can't touch A's gift.
select tests.act_as(:'b');
update lists.list_items set name = 'Hacked' where id = :'i1';
select tests.reset_role();
select is((select name from lists.list_items where id = :'i1'), 'Yeti Mug (edited)', 'B''s update to A''s gift changes nothing');

-- The queue is closed to signed-in users.
select tests.act_as(:'a');
select throws_ok('select * from lists.photo_deletions', '42501', null, 'A can''t read the queue');
select throws_ok($q$insert into lists.photo_deletions (path) values ('x.jpg')$q$, '42501', null, 'A can''t add to the queue');
select throws_ok($q$update lists.photo_deletions set path = 'x.jpg'$q$, '42501', null, 'A can''t change the queue');
select throws_ok($q$delete from lists.photo_deletions$q$, '42501', null, 'A can''t empty the queue');

-- A removes the photo gift (i1) and a gift with no photo (i2) through My list.
select updated_at::text as va from lists.lists where id = :'list_a' \gset
select lists.save_list_checked(:'list_a', null, (
  select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price_cents', price_cents) order by position)
    from lists.list_items where id not in (:'i1', :'i2')), :'va');
select tests.reset_role();
select is((select array_agg(path order by path) from lists.photo_deletions), array[:'i1' || '.jpg'], 'removing a gift queues its photo only');

-- Deleting B's list queues B's photo.
select tests.act_as(:'b');
delete from lists.lists where id = :'list_b';
select tests.reset_role();
select is((select array_agg(path order by path) from lists.photo_deletions), array[:'i1' || '.jpg', :'i6' || '.jpg'], 'deleting a list queues its photos');

-- Deleting C's account queues C's photo.
select tests.act_as(:'c');
select is((select outcome from lists.add_item(:'i7', 'Lamp', 100, 'https://lamps.example/1', null, :'photo' || :'i7' || '.jpg', false, 500)), 'added', 'C adds a gift with a photo');
select tests.reset_role();
delete from auth.users where id = :'c';
select is(
  (select array_agg(path order by path) from lists.photo_deletions),
  array[:'i1' || '.jpg', :'i6' || '.jpg', :'i7' || '.jpg'],
  'deleting an account queues its photos, and nothing else is queued'
);

-- The route queues a photo before uploading; an added gift takes it off the queue.
select tests.act_as_server();
select lists.queue_photo(:'i8');
select ok((select count(*) = 1 from lists.photo_deletions where path = :'i8' || '.jpg'), 'the server queues a photo before uploading');
select tests.act_as(:'a');
select is((select outcome from lists.add_item(:'i8', 'Boots', 100, 'https://www.rei.com/p/boots', null, :'photo' || :'i8' || '.jpg', false, 500)), 'added', 'the add with the uploaded photo is added');
select tests.reset_role();
select is((select count(*)::int from lists.photo_deletions where path = :'i8' || '.jpg'), 0, 'an added gift takes its photo off the queue');

-- Taking and forgetting, service role only.
select tests.act_as_server();
select is((select count(*)::int from lists.take_photo_deletions(10, interval '1 hour')), 0, 'nothing is older than an hour');
select is((select array_agg(p order by p) from lists.take_photo_deletions(2, interval '0') as p), array[:'i1' || '.jpg', :'i6' || '.jpg'], 'take returns the oldest, limited');
select lists.forget_photo_deletions(array[:'i1' || '.jpg', :'i6' || '.jpg']);
select is((select array_agg(p) from lists.take_photo_deletions(10, interval '0') as p), array[:'i7' || '.jpg'], 'forget removes only the named paths');

-- ─── Grants ─────────────────────────────────────────────────────────────────

select tests.act_as_anon();
select throws_ok(format($q$select * from lists.add_item(%L, 'X', 1, 'https://x.example/1', null, null, false, 500)$q$, gen_random_uuid()), '42501', null, 'anon can''t run add_item');
select throws_ok('select * from concierge.recent_people(3)', '42501', null, 'anon can''t run recent_people');
select tests.act_as(:'a');
select throws_ok(format('select lists.queue_photo(%L)', gen_random_uuid()), '42501', null, 'a user can''t queue a photo');
select throws_ok($q$select * from lists.take_photo_deletions(10, interval '0')$q$, '42501', null, 'a user can''t take the queue');
select throws_ok($q$select lists.forget_photo_deletions(array['x.jpg'])$q$, '42501', null, 'a user can''t forget queued photos');

-- ─── The bucket is closed to users ──────────────────────────────────────────

select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('list-photos', %L, %L)$q$, gen_random_uuid() || '.jpg', :'a'),
  '42501', null, 'a signed-in user can''t upload to list-photos'
);
select tests.act_as_server();
insert into storage.objects (bucket_id, name) values ('list-photos', :'i8' || '.jpg');
select tests.act_as(:'a');
select is((select count(*)::int from storage.objects where bucket_id = 'list-photos'), 0, 'a signed-in user can''t list list-photos');

-- ─── take_photo_deletions ───────────────────────────────────────────────────

select tests.act_as(:'a');
select gen_random_uuid() as live \gset
select lists.add_item(:'live', 'Live gift', 100, 'https://shop.example.com/live', null, :'photo' || :'live' || '.jpg', false, 500);
select tests.reset_role();
insert into lists.photo_deletions (path, queued_at) values
  ('old-gone.jpg', now() - interval '2 hours'),
  ('new-gone.jpg', now() - interval '5 minutes'),
  (:'live' || '.jpg', now() - interval '2 hours');
select tests.act_as_server();
select is(
  (select array_agg(p order by p) from lists.take_photo_deletions(500, interval '1 hour') p),
  array['old-gone.jpg'],
  'only a path queued over an hour ago whose gift is gone is taken'
);
select is((select count(*)::int from lists.take_photo_deletions(1, interval '0 seconds')), 1, 'the limit is honoured');
select lists.forget_photo_deletions(array['old-gone.jpg']);
select is((select count(*)::int from lists.photo_deletions where path = 'old-gone.jpg'), 0, 'forgotten paths leave the queue');
select tests.reset_role();

-- ─── recent_people ──────────────────────────────────────────────────────────

select tests.reset_role();
insert into public.people (user_id, name, relationship) values (:'a', 'Pat', 'friend') returning id as p1 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Sam', 'friend') returning id as p2 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Gone', 'friend') returning id as p3 \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Never', 'friend') returning id as p4 \gset
insert into public.people (user_id, name, relationship) values (:'b', 'Theirs', 'friend') returning id as p5 \gset
insert into concierge.captures (user_id, person_id, created_at) values
  (:'a', :'p1', now() - interval '3 days'),
  (:'a', :'p1', now() - interval '1 day'),
  (:'a', :'p2', now() - interval '2 days'),
  (:'a', :'p3', now() - interval '1 hour'),
  (:'b', :'p5', now());
update public.people set deleted_at = now() where id = :'p3';

select tests.act_as(:'a');
select is((select array_agg(person_id) from concierge.recent_people(5)), array[:'p1', :'p2']::uuid[], 'newest capture first; deleted, uncaptured and others'' people skipped');
select is((select array_agg(person_id) from concierge.recent_people(1)), array[:'p1']::uuid[], 'recent_people is limited');

select * from finish();
rollback;
