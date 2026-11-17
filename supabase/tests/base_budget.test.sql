-- A base budget for each person (ALL-120, T73): a budgets row of kind 'any'.
-- Rounds use the occasion's own budget, else the base, else the relationship
-- default, else none; a null occasion row means the same as no row.
begin;
\ir _helpers.psql
select plan(21);

select tests.create_user('a@example.com') as a \gset
-- Rounds are for paid users only (ALL-27).
insert into concierge.accounts (user_id, paid_features) values (:'a', true);
select tests.create_user('b@example.com') as b \gset

select tests.act_as(:'a');
insert into concierge.budget_defaults (relationship, base_amount_cents) values ('friend', 6000);
-- Own amount, base and default all set: own wins.
insert into public.people (name, relationship) values ('Own', 'friend') returning id as own \gset
-- Base and default: base wins.
insert into public.people (name, relationship) values ('Base', 'friend') returning id as base \gset
-- Default only.
insert into public.people (name, relationship) values ('Default', 'friend') returning id as dflt \gset
-- Nothing at all.
insert into public.people (name, relationship) values ('None', 'sister') returning id as none \gset
-- A null occasion row and a base: falls through to the base.
insert into public.people (name, relationship) values ('Null row', 'friend') returning id as nullrow \gset

insert into concierge.occasions (person_id, kind) values
  (:'own', 'christmas'), (:'base', 'christmas'), (:'dflt', 'christmas'), (:'none', 'christmas'), (:'nullrow', 'christmas');
insert into concierge.budgets (person_id, occasion_kind, amount_cents) values
  (:'own', 'christmas', 12000), (:'own', 'any', 7500),
  (:'base', 'any', 7500),
  (:'nullrow', 'christmas', null), (:'nullrow', 'any', 7500);

-- ─── round_candidates: the order ─────────────────────────────────────────────
select tests.act_as_server();
create temp table c as select person_id, budget_cents from concierge.round_candidates('2027-01-01');
select is((select budget_cents from c where person_id = :'own'), 12000, 'the occasion''s own budget wins');
select is((select budget_cents from c where person_id = :'base'), 7500, 'then the person''s base budget');
select is((select budget_cents from c where person_id = :'dflt'), 6000, 'then the relationship default');
select is((select budget_cents from c where person_id = :'none'), null, 'then no budget');
select is((select budget_cents from c where person_id = :'nullrow'), 7500, 'a null occasion row falls through to the base');
select is((select count(*)::int from c where person_id = :'own'), 1, 'the base row is not an occasion');

-- ─── the table's own rules ───────────────────────────────────────────────────
select tests.act_as(:'a');
select throws_ok(
  format($q$insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (%L, 'any', null)$q$, :'dflt'),
  '23514', null, 'a base budget is always an amount'
);
select throws_ok(
  format($q$insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (%L, 'bogus', 100)$q$, :'dflt'),
  '23514', null, 'only real occasion kinds and any can be stored'
);

-- ─── save_budgets ────────────────────────────────────────────────────────────
select lives_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 7500, "christmas": 10000}')$q$, :'dflt'),
  'the owner saves a base and an occasion at once'
);
select is(
  (select jsonb_object_agg(occasion_kind, amount_cents) from concierge.budgets where person_id = :'dflt'),
  '{"any": 7500, "christmas": 10000}'::jsonb, 'both are stored'
);
select lives_ok(
  format($q$select concierge.save_budgets(%L, '{"christmas": null}')$q$, :'dflt'),
  'an empty occasion is saved as null'
);
select is(
  (select jsonb_object_agg(occasion_kind, amount_cents) from concierge.budgets where person_id = :'dflt'),
  '{"any": 7500}'::jsonb, 'which removes its own budget and keeps the base, leaving no null row'
);
insert into concierge.budgets (person_id, occasion_kind, amount_cents) values (:'dflt', 'fathers_day', 4000);
select concierge.save_budgets(:'dflt', '{"birthday": 5000}');
select is(
  (select amount_cents from concierge.budgets where person_id = :'dflt' and occasion_kind = 'fathers_day'),
  4000, 'kinds that aren''t sent are left alone'
);
select throws_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 1, "christmas": -1}')$q$, :'none'),
  '22023', null, 'a negative amount is refused'
);
select throws_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 75.5}')$q$, :'none'),
  '22023', null, 'a fraction of a cent is refused'
);
select throws_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 100, "bogus": 100}')$q$, :'none'),
  '22023', null, 'an unknown kind is refused'
);
select is((select count(*)::int from concierge.budgets where person_id = :'none'), 0, 'a refused save stores nothing at all');

-- ─── everyone else ───────────────────────────────────────────────────────────
select tests.act_as(:'b');
select throws_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 1}')$q$, :'base'),
  'P0002', null, 'another user can''t save budgets for A''s person'
);
select tests.act_as(:'a');
select is((select amount_cents from concierge.budgets where person_id = :'base' and occasion_kind = 'any'), 7500, 'A''s base is unchanged');

select public.delete_person(:'none');
select throws_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 1}')$q$, :'none'),
  'P0002', null, 'nothing saves for a deleted person'
);

select tests.act_as_anon();
select throws_ok(
  format($q$select concierge.save_budgets(%L, '{"any": 1}')$q$, :'base'),
  '42501', null, 'signed-out visitors can''t save budgets'
);

select * from finish();
rollback;
