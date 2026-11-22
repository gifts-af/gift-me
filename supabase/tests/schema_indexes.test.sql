-- Schema hygiene: every foreign key and every user_id has an index behind it,
-- lists.lists keeps its updated_at current, and a provider's order id names
-- one order in an account, which the Zinc webhook relies on to find the right row.
begin;
\ir _helpers.psql
select plan(9);

-- ─── indexes behind foreign keys ─────────────────────────────────────────────
-- A key is covered by a btree index that leads with the key's first column, or
-- whose leading columns are exactly the key's columns in any order. A partial
-- index counts only when its condition is "<that column> is not null", which
-- every lookup by that column satisfies. Composite keys here are (id, user_id)
-- pairs, so an index on the id alone already finds the rows.
create function tests.uncovered_foreign_keys()
returns setof text language sql as $$
  select format('%s (%s)', c.conrelid::regclass,
                (select string_agg(a.attname, ', ' order by k.ord)
                   from unnest(c.conkey) with ordinality k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum))
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f'
     and n.nspname in ('public', 'concierge', 'lists')
     and not exists (
       select 1
         from pg_index i
         join pg_class ic on ic.oid = i.indexrelid
         join pg_am am on am.oid = ic.relam and am.amname = 'btree'
        where i.indrelid = c.conrelid
          and (i.indpred is null
               or pg_get_expr(i.indpred, i.indrelid) =
                  format('(%s IS NOT NULL)', quote_ident((select attname from pg_attribute
                                                           where attrelid = i.indrelid and attnum = i.indkey[0]))))
          and (i.indkey[0] = c.conkey[1]
               or (i.indnkeyatts >= cardinality(c.conkey)
                   and (select array_agg(i.indkey[g] order by i.indkey[g]) from generate_series(0, cardinality(c.conkey) - 1) g)
                     = (select array_agg(x order by x) from unnest(c.conkey) x))))
   order by 1;
$$;

select is_empty(
  'select * from tests.uncovered_foreign_keys()',
  'every foreign key in public, concierge and lists has an index that covers it'
);

-- ─── user_id on user-owned tables ────────────────────────────────────────────
-- Deleting an account and every RLS check filter by user_id.
select is_empty(
  $q$select format('%s.%s', n.nspname, t.relname)
       from pg_class t
       join pg_namespace n on n.oid = t.relnamespace
       join pg_attribute a on a.attrelid = t.oid and a.attname = 'user_id' and not a.attisdropped
      where t.relkind = 'r'
        and n.nspname in ('public', 'concierge', 'lists')
        and not exists (select 1 from pg_index i
                         where i.indrelid = t.oid and i.indpred is null and i.indkey[0] = a.attnum)$q$,
  'every table with a user_id has an index that leads with it'
);

select ok(
  exists (select 1 from pg_index i
           where i.indrelid = 'concierge.gift_rounds'::regclass and i.indpred is null
             and i.indkey[0] = (select attnum from pg_attribute
                                 where attrelid = 'concierge.gift_rounds'::regclass and attname = 'occasion_id')),
  'gift_rounds has an index that leads with occasion_id, for keys from rounds to their occasion'
);

-- ─── lists.lists keeps updated_at current ────────────────────────────────────
select tests.create_user('owner@example.com', 'Owner') as owner \gset
insert into lists.lists (owner_id, title, updated_at)
values (:'owner', 'Birthday', now() - interval '1 day') returning id as list_id \gset

update lists.lists set title = 'Birthday 2030' where id = :'list_id';
select is((select updated_at from lists.lists where id = :'list_id'), now(),
  'changing a list stamps its updated_at');

-- The save functions stamp clock_timestamp() so two saves in one transaction
-- get different versions; the trigger must not round that back to now().
update lists.lists set updated_at = clock_timestamp() where id = :'list_id';
select ok((select updated_at > now() from lists.lists where id = :'list_id'),
  'an update that sets updated_at itself keeps that value');

-- ─── one order per provider order id ─────────────────────────────────────────
select tests.create_user('buyer@example.com', 'Buyer') as buyer \gset
select tests.create_user('other@example.com', 'Other') as other \gset
create function tests.si_idea(p_user uuid) returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid; v_idea uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'Mom', 'mother') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents)
  values (p_user, v_person, v_occasion, 2030, '2030-12-25', '2030-12-15', 5000) returning id into v_round;
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank, source)
  values (p_user, v_round, 'Gift', 4000, 4500, 1, 'generated') returning id into v_idea;
  return v_idea;
end $$;
create function tests.si_order(p_user uuid, p_idea uuid, p_provider_order_id text) returns void language sql as $$
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status,
                                provider_order_id, ship_to, ship_city, ship_state)
  select p_user, round_id, id, 'zinc_wallet', 4500, 100, 'failed', p_provider_order_id, 'recipient', 'Dayton', 'OH'
    from concierge.gift_ideas where id = p_idea;
$$;
select tests.si_idea(:'buyer') as idea \gset
select tests.si_idea(:'other') as other_idea \gset

select lives_ok(
  format($q$select tests.si_order(%L, %L, 'zinc-1')$q$, :'buyer', :'idea'),
  'an order saves with the provider''s order id'
);
select throws_ok(
  format($q$select tests.si_order(%L, %L, 'zinc-1')$q$, :'buyer', :'idea'),
  '23505', null, 'a second order with the same provider order id is refused'
);
select lives_ok(
  format($q$select tests.si_order(%L, %L, 'zinc-1')$q$, :'other', :'other_idea'),
  'another account may hold the same id, since each account orders through its own Zinc key'
);
select lives_ok(
  format($q$select tests.si_order(%L, %L, null); select tests.si_order(%L, %L, null)$q$, :'buyer', :'idea', :'buyer', :'idea'),
  'orders not yet sent to the provider, with no order id, never clash'
);

select * from finish();
rollback;
