-- Saved gifts for someone (ALL-93, planning decision 54): only the buyer who
-- saved them can ever see them, and the database itself enforces the limits,
-- the cap and live people, so a script using the API can't skip them.
begin;
\ir _helpers.psql
select plan(22);

select tests.create_user('buyer@example.com', 'Buyer') as buyer \gset
select tests.create_user('other@example.com', 'Other') as other \gset
select tests.create_user('dad@example.com', 'Dad') as dad \gset

-- Dad keeps his own list; the buyer links their "Dad" to it.
select tests.act_as(:'dad');
select lists.save_list(null, 'Dad''s list', '[{"name": "Reel", "price_cents": 4900}]'::jsonb) as dad_list \gset
select share_token as token from lists.lists where id = :'dad_list' \gset

select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Dad', 'father') returning id as person \gset
insert into public.people (name, relationship) values ('Mom', 'mother') returning id as mom \gset
select lists.link_person(:'token', :'person');

-- ─── the buyer ───────────────────────────────────────────────────────────────
select lives_ok(
  format($q$insert into concierge.saved_gifts (person_id, name, price_cents, product_url, image_url)
            values (%L, 'Fly-fishing reel', 4900, 'https://www.amazon.com/dp/B0TESTREEL', 'https://m.media-amazon.com/images/I/x.jpg')$q$, :'person'),
  'the buyer saves a gift for their person'
);
select lives_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, 'Coffee sampler')$q$, :'person'),
  'a gift with no price or link saves too'
);
select is((select count(*)::int from concierge.saved_gifts), 2, 'the buyer reads their saved gifts back');
select throws_ok(
  $q$update concierge.saved_gifts set name = 'Changed'$q$,
  '42501', null, 'nobody can change a saved gift, not even its owner'
);

-- ─── limits on what's stored ─────────────────────────────────────────────────
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, repeat('x', 201))$q$, :'person'),
  '23514', null, 'a name over 200 characters is refused'
);
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name, product_url) values (%L, 'Bad', 'javascript:alert(1)')$q$, :'person'),
  '23514', null, 'a link that isn''t http(s) is refused'
);
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name, image_url) values (%L, 'Bad', 'data:image/png;base64,x')$q$, :'person'),
  '23514', null, 'a photo that isn''t http(s) is refused'
);
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name, price_cents) values (%L, 'Bad', -1)$q$, :'person'),
  '23514', null, 'a negative price is refused'
);

-- ─── everyone else ───────────────────────────────────────────────────────────
select tests.act_as(:'other');
select is((select count(*)::int from concierge.saved_gifts), 0, 'another user sees none of them');
delete from concierge.saved_gifts;
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, user_id, name) values (%L, %L, 'Sneaky')$q$, :'person', :'buyer'),
  '42501', null, 'another user can''t save as the buyer'
);
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, 'Sneaky')$q$, :'person'),
  'P0002', null, 'another user can''t save against the buyer''s person'
);

select tests.act_as(:'dad');
select is((select count(*)::int from concierge.saved_gifts), 0, 'Dad, linked through his own list, sees none of them');

select tests.act_as_anon();
select throws_ok('select * from concierge.saved_gifts', '42501', null, 'signed-out visitors can''t read saved gifts');

select tests.act_as(:'buyer');
select is((select count(*)::int from concierge.saved_gifts), 2, 'the other user''s delete removed nothing');

-- ─── the cap ─────────────────────────────────────────────────────────────────
select tests.reset_role();
update concierge.app_settings set value = '2' where key = 'saved_gifts_max';
select tests.act_as(:'buyer');
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, 'Third')$q$, :'person'),
  'P0001', 'saved_gifts_max', 'a person at the cap takes no more'
);
select lives_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, 'For Mom')$q$, :'mom'),
  'the cap is per person'
);

select tests.reset_role();
delete from concierge.app_settings where key = 'saved_gifts_max';
select tests.act_as(:'buyer');
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, 'No setting')$q$, :'mom'),
  'P0001', null, 'a missing cap setting refuses saves rather than allowing any number'
);

-- ─── deleted people ──────────────────────────────────────────────────────────
select public.delete_person(:'mom');
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, name) values (%L, 'Too late')$q$, :'mom'),
  'P0002', null, 'nothing saves against a deleted person'
);

-- Saving as someone else tells nothing about their people: not whether one
-- is deleted (P0002) or at the cap (P0001), only "not allowed".
select tests.act_as(:'other');
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, user_id, name) values (%L, %L, 'Probe')$q$, :'mom', :'buyer'),
  '42501', null, 'saving as the buyer against their deleted person says only "not allowed"'
);
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'saved_gifts_max';
insert into concierge.app_settings (key, value, description) values ('saved_gifts_max', '0', 'test') on conflict (key) do update set value = '0';
select tests.act_as(:'other');
select throws_ok(
  format($q$insert into concierge.saved_gifts (person_id, user_id, name) values (%L, %L, 'Probe')$q$, :'person', :'buyer'),
  '42501', null, 'saving as the buyer against their person at the cap says only "not allowed"'
);

select tests.act_as_server();
delete from public.people where id = :'person';
select is((select count(*)::int from concierge.saved_gifts where person_id = :'person'), 0, 'a hard-deleted person''s gifts go with them');

select tests.reset_role();
select has_table('concierge', 'saved_gifts', 'the table exists');

select * from finish();
rollback;
