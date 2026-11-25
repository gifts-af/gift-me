-- A shared list never shows an email address (owner, 2026-11-25). An account's
-- name is its display name, or the name Google gave at sign-up; with neither, a
-- claim says "Someone" and a list has no owner name. Any name with an @ in it
-- counts as no name.
begin;
\ir _helpers.psql
select plan(34);

create function tests.signed_up_name(p_meta jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_id || '@example.com', p_meta, now(), now());
  return (select p.display_name from public.profiles p where p.id = v_id);
end;
$$;

-- ─── At sign-up ─────────────────────────────────────────────────────────────

select is(tests.signed_up_name('{"display_name": " Typed ", "full_name": "Google Full"}'), 'Typed', 'the name they typed wins');
select is(tests.signed_up_name('{"full_name": "  Gail Google  ", "name": "Other"}'), 'Gail Google', 'a Google sign-up takes full_name, trimmed');
select is(tests.signed_up_name('{"display_name": "  ", "name": "Gail"}'), 'Gail', 'then name');
select is(tests.signed_up_name('{"full_name": "gail@example.com", "name": "Gail"}'), 'Gail', 'a full_name with an @ is skipped');
select is(tests.signed_up_name('{"display_name": "typed@example.com"}'), null, 'a typed email is not a name');
select is(tests.signed_up_name('{"full_name": "a@example.com", "name": "b@example.com"}'), null, 'nothing but emails is no name');
select is(tests.signed_up_name('{}'), null, 'no names is no name');
select is(tests.signed_up_name(null), null, 'and nor is no metadata');
select is(tests.signed_up_name(jsonb_build_object('full_name', repeat('x', 100))), repeat('x', 80), 'a long name is cut to 80');
select is(
  tests.signed_up_name(jsonb_build_object('full_name', repeat('x', 85) || '@example.com')), null,
  'an @ past the cut still counts'
);

-- ─── Claims ─────────────────────────────────────────────────────────────────

select tests.create_user('owner@example.com') as owner \gset
select tests.create_user('noname@example.com') as noname \gset
select tests.create_user('selfnamed@example.com') as selfnamed \gset
select tests.create_user('named@example.com', 'Nia') as named \gset
update public.profiles set display_name = 'selfnamed@example.com' where id = :'selfnamed';

select tests.act_as(:'owner');
select (lists.save_list_checked(null, 'My list', '[
  {"id": "cccccccc-0000-4000-8000-000000000001", "name": "One", "price_cents": 1000},
  {"id": "cccccccc-0000-4000-8000-000000000002", "name": "Two", "price_cents": 1000},
  {"id": "cccccccc-0000-4000-8000-000000000003", "name": "Three", "price_cents": 1000},
  {"id": "cccccccc-0000-4000-8000-000000000004", "name": "Four", "price_cents": 1000},
  {"id": "cccccccc-0000-4000-8000-000000000005", "name": "Five", "price_cents": 1000},
  {"id": "cccccccc-0000-4000-8000-000000000006", "name": "Six", "price_cents": 1000}
]'::jsonb, null) ->> 'id')::uuid as list \gset
select share_token as token from lists.lists where id = :'list' \gset

select tests.act_as(:'noname');
-- A real session's token carries the email.
select set_config('request.jwt.claims',
  jsonb_build_object('sub', :'noname', 'role', 'authenticated', 'email', 'noname@example.com')::text, true);
select is(lists.viewer_display_name(), 'Someone', 'with no name, the viewer is Someone');
select is(lists.claim_gift(:'token', 'cccccccc-0000-4000-8000-000000000001', null) ->> 'name', 'Someone', 'and so is their claim');
select is(lists.get_shared_list(:'token') #>> '{viewer,name}', 'Someone', 'and the claim box tells them so');
select ok(position('@' in lists.get_shared_list(:'token')::text) = 0, 'no email is sent, not even their own');

select tests.act_as(:'selfnamed');
select is(
  lists.claim_gift(:'token', 'cccccccc-0000-4000-8000-000000000002', null) ->> 'name', 'Someone',
  'a display name that is an email is not shown'
);
select tests.act_as(:'named');
select is(lists.claim_gift(:'token', 'cccccccc-0000-4000-8000-000000000003', null) ->> 'name', 'Nia', 'a name still shows');

select tests.act_as_anon();
select is(lists.get_shared_list(:'token') #> '{viewer,name}', 'null'::jsonb, 'a signed-out viewer has no name');
select throws_ok(
  format('select lists.claim_gift(%L, %L, %L)', :'token', 'cccccccc-0000-4000-8000-000000000004', '  '),
  '22023', null, 'a guest still has to give a name'
);
select is(
  lists.claim_gift(:'token', 'cccccccc-0000-4000-8000-000000000004', ' guest@example.com ') ->> 'name', 'Someone',
  'a guest who types an email is Someone'
);

-- A gift the concierge claims is named the same way.
select tests.reset_role();
select ok(lists.claim_for_order('cccccccc-0000-4000-8000-000000000005', :'noname'), 'the concierge claims for an account with no name');
select ok(lists.claim_for_order('cccccccc-0000-4000-8000-000000000006', :'selfnamed'), 'and for one named by an email');
select is(
  (select array_agg(distinct claimer_name) from lists.gift_claims
    where item_id in ('cccccccc-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000006')),
  array['Someone'], 'both as Someone'
);
select is(lists.claim_for_order('cccccccc-0000-4000-8000-000000000005', gen_random_uuid()), false, 'an account that is gone claims nothing');
select tests.act_as_anon();
select ok(position('@' in lists.get_shared_list(:'token')::text) = 0, 'the list shows friends no email');

-- ─── The owner's name ───────────────────────────────────────────────────────

select tests.reset_role();
update public.profiles set display_name = 'owner@example.com' where id = :'owner';
select tests.act_as_anon();
select is(lists.get_shared_list(:'token') -> 'owner_name', 'null'::jsonb, 'an owner named by an email has no name on the list');
select is(lists.share_preview(:'token') -> 'owner_name', 'null'::jsonb, 'or in the link preview');
select tests.reset_role();
update public.profiles set display_name = ' Olive ' where id = :'owner';
select tests.act_as_anon();
select is(lists.share_preview(:'token') ->> 'owner_name', 'Olive', 'a name shows in the preview');

-- ─── Accounts and claims from before ────────────────────────────────────────

select tests.reset_role();
update auth.users set raw_user_meta_data = '{"full_name": "Noni Named"}' where id = :'noname';
update auth.users set raw_user_meta_data = '{"full_name": "Not This"}' where id = :'named';
update lists.gift_claims set claimer_name = 'noname@example.com' where item_id = 'cccccccc-0000-4000-8000-000000000001';
update lists.gift_claims set claimer_name = 'guest@example.com' where item_id = 'cccccccc-0000-4000-8000-000000000004';
select public.backfill_profile_names();
select lists.hide_claim_emails();

select is((select display_name from public.profiles where id = :'noname'), 'Noni Named', 'the backfill names an account from Google');
select is((select display_name from public.profiles where id = :'named'), 'Nia', 'and leaves a name alone');
select is((select display_name from public.profiles where id = :'selfnamed'), null, 'a name that is an email is cleared, so they are asked for one');
select is(
  (select claimer_name from lists.gift_claims where item_id = 'cccccccc-0000-4000-8000-000000000001'),
  'Noni Named', 'an email on an old claim becomes the account''s name'
);
select is(
  (select claimer_name from lists.gift_claims where item_id = 'cccccccc-0000-4000-8000-000000000004'),
  'Someone', 'or Someone when there is none'
);
select is(
  (select claimer_name from lists.gift_claims where item_id = 'cccccccc-0000-4000-8000-000000000003'),
  'Nia', 'other claims are left alone'
);
select ok(
  not has_function_privilege('authenticated', 'public.backfill_profile_names()', 'execute')
  and not has_function_privilege('anon', 'public.backfill_profile_names()', 'execute')
  and not has_function_privilege('authenticated', 'lists.hide_claim_emails()', 'execute')
  and not has_function_privilege('anon', 'lists.hide_claim_emails()', 'execute')
  and not has_function_privilege('anon', 'lists.viewer_display_name()', 'execute'),
  'users can''t run the backfills'
);

select * from finish();
rollback;
