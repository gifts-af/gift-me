-- Private captures bucket, capture note and capture limits (ALL-22).
begin;
\ir _helpers.psql
select plan(8);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select is((select public from storage.buckets where id = 'captures'), false, 'captures bucket exists and is private');
select has_column('concierge', 'captures', 'note', 'captures has a note column');
select is(concierge.setting_int('capture_text_max_chars'), 20000, 'text limit setting');
select is(concierge.setting_int('capture_screenshot_max_bytes'), 2500000, 'screenshot limit setting');

select tests.act_as(:'a');
select lives_ok(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('captures', %L, %L)$q$, :'a' || '/x.jpg', :'a'), 'A can upload into their own folder');
select throws_ok(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('captures', %L, %L)$q$, :'b' || '/x.jpg', :'a'), '42501', null, 'A cannot upload into B''s folder');

select tests.act_as(:'b');
select is((select count(*)::int from storage.objects where bucket_id = 'captures' and name = :'a' || '/x.jpg'), 0, 'B cannot see A''s object');

select tests.act_as(:'a');
select is((select count(*)::int from storage.objects where bucket_id = 'captures' and name = :'a' || '/x.jpg'), 1, 'A can see their own object');

select * from finish();
rollback;
