-- A round belongs to one person through that person's own occasion, and an
-- idea on it can't name a different person.
begin;
\ir _helpers.psql
select plan(12);

select tests.create_user('a@example.com') as a \gset
select tests.create_user('b@example.com') as b \gset
select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'mother') returning id as mom \gset
insert into public.people (name, relationship) values ('Dad', 'father') returning id as dad \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as mom_bday \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'dad', 'birthday', 6, 2) returning id as dad_bday \gset
select tests.act_as(:'b');
insert into public.people (name, relationship) values ('Sis', 'sister') returning id as sis \gset
insert into concierge.occasions (person_id, kind) values (:'sis', 'christmas') returning id as sis_xmas \gset
select tests.reset_role();
-- An occasion with no person, which the column still allows.
insert into concierge.occasions (user_id, kind) values (:'a', 'christmas') returning id as loose_xmas \gset

-- ─── which occasion a round may name ─────────────────────────────────────────
select lives_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
            values (%L, %L, %L, 2027, '2027-03-14', '2027-03-05', 'scheduled')$q$, :'a', :'mom', :'mom_bday'),
  'a round for a person''s own occasion is saved');
select throws_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
            values (%L, %L, %L, 2027, '2027-06-02', '2027-05-24', 'scheduled')$q$, :'a', :'mom', :'dad_bday'),
  '23503', null, 'a round can''t name another person''s occasion');
select throws_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
            values (%L, %L, %L, 2027, '2027-12-25', '2027-12-16', 'scheduled')$q$, :'a', :'mom', :'loose_xmas'),
  '23503', null, 'a round can''t name an occasion that has no person');
select throws_ok(
  format($q$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
            values (%L, %L, %L, 2027, '2027-12-25', '2027-12-16', 'scheduled')$q$, :'a', :'mom', :'sis_xmas'),
  '23503', null, 'a round can''t name another account''s occasion');
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, status)
values (:'a', :'dad', :'dad_bday', 2027, '2027-06-02', '2027-05-24', 'scheduled') returning id as dad_round \gset
select throws_ok(
  format($q$update concierge.gift_rounds set person_id = %L where id = %L$q$, :'mom', :'dad_round'),
  '23503', null, 'a round can''t be moved to a person whose occasion it isn''t');

-- ─── which person a round idea may name ──────────────────────────────────────
select lives_ok(
  format($q$insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, rank)
            values (%L, %L, %L, 'Tie', 3000, 3400, 1)$q$, :'a', :'dad_round', :'dad'),
  'a round idea naming the round''s person is saved');
select lives_ok(
  format($q$insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
            values (%L, %L, 'Mug', 2000, 2400, 2)$q$, :'a', :'dad_round'),
  'a round idea with no person is still saved');
select throws_ok(
  format($q$insert into concierge.gift_ideas (user_id, round_id, person_id, title, price_cents, est_total_cents, rank)
            values (%L, %L, %L, 'Scarf', 3000, 3400, 3)$q$, :'a', :'dad_round', :'mom'),
  '23503', null, 'a round idea can''t name a different person from its round');
select throws_ok(
  format($q$insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
            values (%L, %L, 'Pen', 1000, 1100, 4)$q$, :'b', :'dad_round'),
  '23503', null, 'an idea still can''t belong to someone other than its round''s owner');

-- ─── deletes still cascade ───────────────────────────────────────────────────
delete from concierge.occasions where id = :'dad_bday';
select is((select count(*)::int from concierge.gift_rounds where id = :'dad_round'), 0,
  'removing an occasion removes its rounds');
select is((select count(*)::int from concierge.gift_ideas where round_id = :'dad_round'), 0,
  'and their ideas');
delete from public.people where id = :'mom';
select is((select count(*)::int from concierge.gift_rounds where person_id = :'mom'), 0,
  'removing a person removes their rounds');

select * from finish();
rollback;
