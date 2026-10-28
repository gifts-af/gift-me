-- Your own address, used by every product (product decisions 38 and 41,
-- ALL-44): where gifts to you can ship, and "My address" when you buy.
-- Only you read it. If you turn sharing on, someone who linked your list to
-- a person sees only your city and state; the server reads the rest when an
-- order is placed.
begin;
\ir _helpers.psql
select plan(12);

select tests.create_user('mom@example.com') as mom \gset
select tests.create_user('buyer@example.com') as buyer \gset
select tests.create_user('other@example.com') as other \gset

-- Mom saves her address, then edits it.
select tests.act_as(:'mom');
select lives_ok(
  $$insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state, zip)
    values ('Mary', 'Allen', '12 Oak St', 'Dayton', 'OH', '45402')$$,
  'Mom saves her own address'
);
update public.account_addresses set address_line2 = 'Apt 3';
select is((select address_line2 from public.account_addresses), 'Apt 3', 'Mom edits her address');
select is((select share_for_gifts from public.account_addresses), false, 'sharing starts off');
select throws_ok(
  $$insert into public.account_addresses (recipient_first_name, recipient_last_name, address_line1, city, state)
    values ('X', 'Y', '1 St', 'Town', 'OH')$$,
  '23502', null,
  'an address needs a ZIP code'
);

-- Nobody else reads it.
select tests.act_as(:'buyer');
select is((select count(*)::int from public.account_addresses), 0, 'the buyer reads none of Mom''s address');
select tests.act_as_anon();
select throws_ok('select * from public.account_addresses', '42501', null, 'signed-out visitors can''t read addresses');

-- The buyer's "Mom" is linked to Mom's account (set by lists.link_person in
-- real use; set directly here).
select tests.act_as(:'buyer');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as person \gset
select tests.reset_role();
update public.people set linked_user_id = :'mom' where id = :'person';

select tests.act_as(:'buyer');
select is(public.shared_city_for_person(:'person'), null, 'no city while Mom hasn''t shared her address');

select tests.act_as(:'mom');
update public.account_addresses set share_for_gifts = true;

select tests.act_as(:'buyer');
select is(public.shared_city_for_person(:'person'), '{"city": "Dayton", "state": "OH"}'::jsonb, 'once shared, the buyer sees only city and state');
select throws_ok(
  format('select public.shared_address_for_person(%L)', :'person'),
  '42501', null,
  'the buyer can''t read the full address'
);

select tests.act_as(:'other');
select throws_ok(
  format('select public.shared_city_for_person(%L)', :'person'),
  'P0002', null,
  'someone else can''t ask about the buyer''s person'
);

select tests.act_as_server();
select is(
  public.shared_address_for_person(:'person') ->> 'address_line1',
  '12 Oak St',
  'the server reads the full address to place an order'
);
select is(
  public.shared_address_for_person(:'person') ->> 'zip',
  '45402',
  'including the ZIP code'
);

select * from finish();
rollback;
