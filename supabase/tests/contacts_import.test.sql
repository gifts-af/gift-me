-- Google Contacts import (ALL-24): add_person also takes the Google contact id
-- and the address, and one live person per user per Google contact.
begin;
\ir _helpers.psql
select plan(9);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset

select tests.act_as(:'a');
select concierge.add_person(
  p_name => 'Mom', p_relationship => 'mother', p_kinds => array['christmas', 'mothers_day'],
  p_google_contact_id => 'people/c111',
  p_recipient_first_name => 'Jane', p_recipient_last_name => 'Allen',
  p_address_line1 => '1 Elm St', p_address_line2 => 'Apt 2', p_city => 'Springfield',
  p_state => 'IL', p_zip => '62701', p_country => 'US') as mom \gset

select is((select google_contact_id from public.people where id = :'mom'), 'people/c111',
  'add_person saves the Google contact id');
select is((select concat_ws('|', recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country)
             from public.people where id = :'mom'),
  'Jane|Allen|1 Elm St|Apt 2|Springfield|IL|62701|US', 'add_person saves the address');
select is((select address_checked_at from public.people where id = :'mom'), null::timestamptz,
  'an imported address is saved unchecked');

select concierge.add_person(p_name => 'Sam', p_relationship => 'friend', p_kinds => array['christmas']) as sam \gset
select is((select country from public.people where id = :'sam'), 'US',
  'without an address, the country keeps its default');

select throws_ok(
  $$select concierge.add_person(p_name => 'Mom again', p_relationship => 'mother', p_kinds => array['christmas'],
                                p_google_contact_id => 'people/c111')$$,
  '23505', null, 'a second live person from the same Google contact is refused');
select is((select count(*)::int from public.people where name = 'Mom again'), 0, 'and nothing is left behind');

select tests.act_as(:'b');
select lives_ok(
  $$select concierge.add_person(p_name => 'Their mom', p_relationship => 'mother', p_kinds => array['christmas'],
                                p_google_contact_id => 'people/c111')$$,
  'another user can import a contact with the same Google id');

select tests.reset_role();
update public.people set deleted_at = now() where id = :'mom';
select tests.act_as(:'a');
select lives_ok(
  $$select concierge.add_person(p_name => 'Mom', p_relationship => 'mother', p_kinds => array['christmas'],
                                p_google_contact_id => 'people/c111')$$,
  'a deleted person''s Google contact can be imported again');

-- The ALL-21 call shape still works.
select lives_ok(
  $$select concierge.add_person('Pat', 'friend', array['christmas'], null, null, null, null, null)$$,
  'the positional ALL-21 call still works');

select * from finish();
rollback;
