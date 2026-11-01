-- The budget is the buyer's own and optional (product decision 36, ALL-44).
-- A round, or a person's budget for an occasion, can have no budget at all.
begin;
\ir _helpers.psql
select plan(4);

select tests.create_user('a@example.com') as a \gset

select tests.act_as(:'a');
insert into public.people (name, relationship) values ('Mom', 'parent') returning id as mom \gset
insert into concierge.occasions (person_id, kind, month, day) values (:'mom', 'birthday', 3, 14) returning id as bday \gset

select lives_ok(
  format($$insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (%L, 'birthday', null)$$, :'mom'),
  'a person can have no budget for an occasion'
);
select throws_ok(
  format($$update concierge.budgets set amount_cents = -1 where person_id = %L$$, :'mom'),
  '23514', null,
  'a budget still can''t be negative'
);
select col_not_null('concierge', 'budget_defaults', 'base_amount_cents', 'a relationship default is still an amount (no row means no default)');

select tests.reset_role();
select lives_ok(
  format($$insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
           values (%L, %L, %L, 2027, '2027-03-14', '2027-03-05', null)$$, :'a', :'mom', :'bday'),
  'a round can have no budget'
);

select * from finish();
rollback;
