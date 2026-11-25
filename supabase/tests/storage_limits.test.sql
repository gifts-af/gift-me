-- What storage takes: a size ceiling and file types per bucket, and a cap on
-- files per account without concierge access. The uploads themselves are in
-- storage-limits-db.test.ts.
begin;
\ir _helpers.psql
select plan(30);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

-- ─── Buckets and settings ────────────────────────────────────────────────────

select is((select file_size_limit from storage.buckets where id = 'person-photos'), 1048576::bigint, 'photos: 1 MB');
select set_eq(
  $$select unnest(allowed_mime_types) from storage.buckets where id = 'person-photos'$$,
  array['image/jpeg', 'image/png', 'image/webp'], 'photos: JPEG, PNG and WebP'
);
select is((select file_size_limit from storage.buckets where id = 'captures'), 3145728::bigint, 'captures: 3 MB');
select set_eq(
  $$select unnest(allowed_mime_types) from storage.buckets where id = 'captures'$$,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif'], 'captures: JPEG, PNG, WebP and GIF'
);
select is(concierge.setting_int('person_photo_stored_max_bytes'), 1000000, 'the stored photo setting');
select is(concierge.setting_int('storage_files_per_account'), 100, '100 files per account');
select cmp_ok(
  (select file_size_limit from storage.buckets where id = 'person-photos'), '>',
  concierge.setting_int('person_photo_stored_max_bytes')::bigint, 'the photo ceiling is above its setting'
);
select cmp_ok(
  (select file_size_limit from storage.buckets where id = 'captures'), '>',
  concierge.setting_int('capture_screenshot_max_bytes')::bigint, 'the capture ceiling is above its setting'
);

-- ─── The function's grants ───────────────────────────────────────────────────

select has_function('concierge', 'may_store_file', array['text']);
select ok(has_function_privilege('authenticated', 'concierge.may_store_file(text)', 'execute'), 'signed-in users can run it');
select ok(not has_function_privilege('anon', 'concierge.may_store_file(text)', 'execute'), 'anon cannot');
select ok(not has_function_privilege('service_role', 'concierge.may_store_file(text)', 'execute'), 'the server cannot');
select is_definer('concierge', 'may_store_file', array['text']);

-- ─── The cap ─────────────────────────────────────────────────────────────────

create function tests.add_file(p_bucket text, p_owner uuid, p_file text) returns void language sql as
$$ insert into storage.objects (bucket_id, name, owner_id) values (p_bucket, p_owner::text || '/' || p_file, p_owner::text) $$;
grant execute on function tests.add_file(text, uuid, text) to authenticated, service_role;

update concierge.app_settings set value = '2' where key = 'storage_files_per_account';

-- Other people's files, and files in the other bucket, don't count.
select tests.add_file('person-photos', :'b', 'p/1.jpg'), tests.add_file('person-photos', :'b', 'p/2.jpg'),
       tests.add_file('captures', :'a', '1.jpg'), tests.add_file('captures', :'a', '2.jpg');

select tests.act_as(:'a');
select is(concierge.may_store_file('person-photos'), true, 'none of your own files there yet');
select lives_ok(format($q$select tests.add_file('person-photos', %L, 'p/1.jpg')$q$, :'a'), 'the first file');
select lives_ok(format($q$select tests.add_file('person-photos', %L, 'p/2.jpg')$q$, :'a'), 'the second, up to the cap');
select is(concierge.may_store_file('person-photos'), false, 'at the cap');
select throws_ok(format($q$select tests.add_file('person-photos', %L, 'p/3.jpg')$q$, :'a'), '42501', null, 'the third photo is refused');
select throws_ok(format($q$select tests.add_file('captures', %L, '3.jpg')$q$, :'a'), '42501', null, 'the third capture is refused');
select throws_ok(
  format($q$update storage.objects set bucket_id = 'person-photos' where bucket_id = 'captures' and name = %L$q$, :'a' || '/1.jpg'),
  '42501', null, 'moving a file into a full bucket is refused'
);

-- A missing setting refuses rather than lets through.
select tests.reset_role();
delete from concierge.app_settings where key = 'storage_files_per_account';
select tests.act_as(:'a');
select is(concierge.may_store_file('person-photos'), false, 'no setting, no upload');

-- With access there's no cap, and someone else's folder stays closed.
select tests.reset_role();
insert into concierge.app_settings (key, value, description) values ('storage_files_per_account', '2', 'test');
insert into concierge.accounts (user_id, concierge_access) values (:'a', true);
select tests.act_as(:'a');
select is(concierge.may_store_file('person-photos'), true, 'with access there is no cap');
select lives_ok(format($q$select tests.add_file('person-photos', %L, 'p/3.jpg')$q$, :'a'), 'a photo past the cap, with access');
select lives_ok(format($q$select tests.add_file('captures', %L, '3.jpg')$q$, :'a'), 'a capture past the cap, with access');
select throws_ok(
  format($q$select tests.add_file('captures', %L, '9.jpg')$q$, :'b'),
  '42501', null, 'access does not open someone else''s folder'
);
select throws_ok(
  format($q$select tests.add_file('person-photos', %L, 'p/9.jpg')$q$, :'b'),
  '42501', null, 'in either bucket'
);

-- A signed upload link is used later with no check at all, so none is given,
-- with access or without.
select set_config('storage.operation', 'storage.object.sign_upload_url', true);
select is(concierge.may_store_file('captures'), false, 'no signed upload link, with access');
select tests.act_as(:'b');
select is(concierge.may_store_file('captures'), false, 'or without');
select set_config('storage.operation', 'storage.object.upload', true);
select tests.act_as(:'a');
select is(concierge.may_store_file('captures'), true, 'an ordinary upload still passes');

-- The server (emailed notes) isn't held by the cap.
select tests.reset_role();
update concierge.accounts set concierge_access = false where user_id = :'a';
select tests.act_as_server();
select lives_ok(format($q$select tests.add_file('captures', %L, 'note.gif')$q$, :'a'), 'the server still stores');

select * from finish();
rollback;
