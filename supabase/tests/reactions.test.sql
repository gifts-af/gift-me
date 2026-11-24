-- Reactions: what a save writes, when the email is due and when a round closes.
-- Dates are in 2091, every row rolls back, and no assertion depends
-- on rows other sessions have in the shared local database: each looks at this
-- file's own rounds. A round's delivered_at is now(), well before the dates here,
-- except where a test is about it.
begin;
\ir _helpers.psql
select plan(124);

-- ─── Settings, as shipped ────────────────────────────────────────────────────
select is(concierge.setting_int('reactions_enabled'), 1, 'reactions_enabled ships on');
select is(concierge.setting_int('reaction_prompt_after_days'), 1, 'reaction_prompt_after_days ships at 1');
select is(concierge.setting_int('reaction_close_days'), 7, 'reaction_close_days ships at 7');
select is(concierge.setting_int('reaction_note_max_chars'), 500, 'reaction_note_max_chars ships at 500');

-- ─── Fixtures ────────────────────────────────────────────────────────────────
select tests.create_user('rx-a@example.com') as a \gset
select tests.create_user('rx-b@example.com') as b \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Sam', 'friend') returning id as p \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Gone', 'friend') returning id as gone \gset
insert into public.people (user_id, name, relationship) values (:'a', 'Gone2', 'friend') returning id as gone2 \gset

create sequence tests.rx_year start 2100;
-- A round for the occasion on 2091-12-25, each with its own occasion_year.
create function tests.rx_round(p_person uuid, p_status text default 'delivered') returns uuid
language plpgsql as $$
declare
  v_user uuid := (select user_id from public.people where id = p_person);
  v_occasion uuid := (select id from concierge.occasions where person_id = p_person);
  v_id uuid;
begin
  if v_occasion is null then
    insert into concierge.occasions (user_id, person_id, kind) values (v_user, p_person, 'christmas') returning id into v_occasion;
  end if;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
  values (v_user, p_person, v_occasion, nextval('tests.rx_year'), '2091-12-25', '2091-12-15', 5000, p_status::concierge.round_status, '2091-01-01T00:00:00Z')
  returning id into v_id;
  return v_id;
end;
$$;
create function tests.rx_order(p_round uuid, p_status text default 'delivered', p_delivered timestamptz default '2091-12-20T12:00:00Z') returns uuid
language plpgsql as $$
declare
  v_user uuid := (select user_id from concierge.gift_rounds where id = p_round);
  v_idea uuid;
  v_order uuid;
begin
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
  values (v_user, p_round, 'Vase', 4000, 4500, 1) returning id into v_idea;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, delivered_at, ship_to, ship_city, ship_state)
  values (v_user, p_round, v_idea, 'zinc_wallet', 4500, 100, p_status, case when p_status = 'delivered' then p_delivered end, 'recipient', 'Dayton', 'OH')
  returning id into v_order;
  return v_order;
end;
$$;
-- A save on the day after the occasion.
create function tests.rx_save(p_user uuid, p_order uuid, p_rating text, p_note text default null,
                              p_cat text default null, p_val text default null, p_today date default '2091-12-26') returns text
language sql as $$
  select concierge.save_reaction(p_user, p_order, p_rating, p_note, p_cat, p_val, p_today);
$$;
create function tests.rx_status(p_round uuid) returns text language sql as $$
  select status::text from concierge.gift_rounds where id = p_round;
$$;
create function tests.rx_due(p_round uuid, p_today date) returns boolean language sql as $$
  select exists (select 1 from concierge.reactions_due(p_today) d where d.round_id = p_round);
$$;
create function tests.rx_fact(p_person uuid, p_cat text, p_val text) returns integer language sql as $$
  select count(*)::integer from concierge.profile_facts where person_id = p_person and category = p_cat and value = p_val;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ─── Only the server (AC-15) ─────────────────────────────────────────────────
select tests.rx_round(:'p') as r1 \gset
select tests.rx_order(:'r1') as o1 \gset
select tests.act_as(:'a');
select throws_ok(format($q$select concierge.save_reaction(%L, %L, 'loved', null, null, null, '2091-12-26')$q$, :'a', :'o1'),
  '42501', null, 'AC-15 a signed-in user cannot call save_reaction');
select throws_ok($$select * from concierge.reactions_due('2091-12-26')$$, '42501', null, 'AC-15 a signed-in user cannot call reactions_due');
select throws_ok($$select concierge.close_reacted_rounds('2091-12-26')$$, '42501', null, 'AC-15 a signed-in user cannot call close_reacted_rounds');
select throws_ok(format('select concierge.reaction_asked_on(%L)', :'r1'), '42501', null, 'AC-15 a signed-in user cannot call reaction_asked_on');
select throws_ok(format('select concierge.has_unanswered_gift(%L)', :'r1'), '42501', null, 'AC-15 a signed-in user cannot call has_unanswered_gift');
select throws_ok(format($q$insert into concierge.reactions (user_id, round_id, order_id, rating, source) values (%L, %L, %L, 'loved', 'web')$q$, :'a', :'r1', :'o1'),
  '42501', null, 'AC-15 a signed-in user cannot add a reaction directly');
select throws_ok($$update concierge.reactions set rating = 'meh'$$, '42501', null, 'AC-15 a signed-in user cannot change a reaction directly');
select throws_ok($$delete from concierge.reactions$$, '42501', null, 'AC-15 a signed-in user cannot delete a reaction directly');
select tests.act_as_anon();
select throws_ok(format($q$select concierge.save_reaction(%L, %L, 'loved', null, null, null, '2091-12-26')$q$, :'a', :'o1'),
  '42501', null, 'AC-15 anon cannot call save_reaction');
select throws_ok($$select * from concierge.reactions_due('2091-12-26')$$, '42501', null, 'AC-15 anon cannot call reactions_due');
select throws_ok($$select concierge.close_reacted_rounds('2091-12-26')$$, '42501', null, 'AC-15 anon cannot call close_reacted_rounds');

-- ─── save_reaction: what's refused (AC-10, AC-13) ────────────────────────────
select tests.act_as_server();
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved')$q$, :'b', :'o1'), 'P0001', 'save_reaction: not found', 'AC-10 someone else''s order');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved')$q$, :'a', gen_random_uuid()), 'P0001', 'save_reaction: not found', 'AC-10 no such order');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'hated')$q$, :'a', :'o1'), 'P0001', 'save_reaction: bad rating', 'AC-10 a bad rating');
select throws_ok(format($q$select tests.rx_save(%L, %L, null)$q$, :'a', :'o1'), 'P0001', 'save_reaction: bad rating', 'AC-10 no rating');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', repeat('x', 501))$q$, :'a', :'o1'), 'P0001', 'save_reaction: note too long', 'AC-10 a note over the limit');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', null, null, null, '2091-12-24')$q$, :'a', :'o1'),
  'P0001', 'save_reaction: before the occasion', 'AC-10 before the occasion date');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', null, null, null, null)$q$, :'a', :'o1'),
  'P0001', 'save_reaction: before the occasion', 'no date is refused like one before the occasion');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', null, 'interest', 'Vases')$q$, :'a', :'o1'), 'P0001', 'save_reaction: bad fact', 'a fact category a reaction never writes');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', null, 'loved', null)$q$, :'a', :'o1'), 'P0001', 'save_reaction: bad fact', 'a category without a value');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', null, null, 'Vase')$q$, :'a', :'o1'), 'P0001', 'save_reaction: bad fact', 'a value without a category');
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved', 'a note', 'loved', repeat('x', 501))$q$, :'a', :'o1'), '23514', null, 'a fact over the facts limit');
select tests.reset_role();
select tests.rx_round(:'p', 'ordered') as rs \gset
select tests.rx_order(:'rs', 'shipped') as os \gset
select tests.act_as_server();
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved')$q$, :'a', :'os'), 'P0001', 'save_reaction: not delivered', 'AC-10 an order not delivered');
select tests.reset_role();
update concierge.app_settings set value = '0' where key = 'reactions_enabled';
select tests.act_as_server();
select throws_ok(format($q$select tests.rx_save(%L, %L, 'loved')$q$, :'a', :'o1'), 'P0001', 'save_reaction: off', 'AC-13 switched off');
select tests.reset_role();
update concierge.app_settings set value = '1' where key = 'reactions_enabled';
select is((select count(*)::int from concierge.reactions where user_id = :'a'), 0, 'AC-10 a refused save writes no reaction');
select is((select count(*)::int from concierge.profile_facts where user_id = :'a'), 0, 'AC-10 a refused save writes no fact');
select is(tests.rx_status(:'r1'), 'delivered', 'AC-10 a refused save leaves the round alone');

-- ─── save_reaction: an answer, its fact and the close (AC-6, AC-16) ──────────
select tests.rx_order(:'r1') as o1b \gset
select tests.act_as_server();
select is(tests.rx_save(:'a', :'o1', 'loved', repeat('é', 500), 'loved', 'Vase', '2091-12-25'), 'delivered',
  'AC-6 answering one of two on the occasion date, with a note at the limit, keeps the round delivered');
select results_eq(
  format('select user_id, round_id, rating, char_length(note), source, fact_category, fact_value from concierge.reactions where order_id = %L', :'o1'),
  format($q$values (%L::uuid, %L::uuid, 'loved', 500, 'web', 'loved', 'Vase')$q$, :'a', :'r1'),
  'the reaction is stored with its round and its fact');
select results_eq(
  format($q$select f.user_id, f.source, f.confirmed, f.active, f.source_id = r.id
              from concierge.profile_facts f join concierge.reactions r on r.order_id = %L
             where f.person_id = %L and f.category = 'loved' and f.value = 'Vase'$q$, :'o1', :'p'),
  format($q$values (%L::uuid, 'reaction', true, true, true)$q$, :'a'),
  'the fact is the buyer''s, confirmed, and points at the reaction');
select is(tests.rx_save(:'a', :'o1b', 'liked'), 'complete', 'AC-6 answering the second completes the round');
select results_eq(
  format('select status::text, next_action_at, closed_at from concierge.gift_rounds where id = %L', :'r1'),
  $$values ('complete', null::timestamptz, null::timestamptz)$$,
  'complete clears next_action_at and leaves closed_at alone');
select is((select fact_category from concierge.reactions where order_id = :'o1b'), null, 'an answer with no fact stores none');
select is(tests.rx_save(:'a', :'o1', 'loved', '  ', 'loved', 'Vase'), 'complete', 'AC-16 a repeat save after the close is taken');
select is((select count(*)::int from concierge.reactions where order_id = :'o1'), 1, 'AC-16 ... and keeps one row');
select is(tests.rx_fact(:'p', 'loved', 'Vase'), 1, 'AC-16 ... and one fact');
select is((select note from concierge.reactions where order_id = :'o1'), null, 'a blank note is stored as none');

-- A gift answered while another is still on its way.
select tests.reset_role();
select tests.rx_round(:'p', 'ordered') as rw \gset
select tests.rx_order(:'rw') as ow \gset
select tests.rx_order(:'rw', 'shipped') as ow2 \gset
select tests.act_as_server();
select is(tests.rx_save(:'a', :'ow', 'liked'), 'ordered', 'AC-18 a delivered gift is answered while the round is still ordered, and nothing closes');

-- ─── save_reaction: changing the answer (AC-8) ───────────────────────────────
select tests.reset_role();
select tests.rx_round(:'p') as r2 \gset
select tests.rx_order(:'r2') as o2 \gset
select tests.act_as_server();
select tests.rx_save(:'a', :'o2', 'loved', null, 'loved', 'Lamp');
select tests.rx_save(:'a', :'o2', 'meh', 'too big', 'avoid', 'Didn''t love: Lamp: too big');
select is((select count(*)::int from concierge.reactions where order_id = :'o2'), 1, 'AC-8 a changed rating keeps one row');
select is(tests.rx_fact(:'p', 'loved', 'Lamp'), 0, 'AC-8 ... the old fact is gone');
select is(tests.rx_fact(:'p', 'avoid', 'Didn''t love: Lamp: too big'), 1, 'AC-8 ... and the new one is in');
select results_eq(format('select rating, note, fact_category from concierge.reactions where order_id = %L', :'o2'),
  $$values ('meh', 'too big', 'avoid')$$, 'AC-8 ... and stored on the reaction');
-- The same rating again touches only the note, whatever fact comes with it.
select tests.rx_save(:'a', :'o2', 'meh', 'far too big', 'avoid', 'Didn''t love: Lamp: far too big');
select is((select note from concierge.reactions where order_id = :'o2'), 'far too big', 'a same-rating save updates the note');
select is(tests.rx_fact(:'p', 'avoid', 'Didn''t love: Lamp: far too big'), 0, '... and writes no fact');
select is(tests.rx_fact(:'p', 'avoid', 'Didn''t love: Lamp: too big'), 1, '... and removes none');
-- Changed to a rating with no fact.
select tests.rx_save(:'a', :'o2', 'liked');
select is(tests.rx_fact(:'p', 'avoid', 'Didn''t love: Lamp: too big'), 0, 'a rating with no fact removes the old one');
select is((select coalesce(fact_category, fact_value) from concierge.reactions where order_id = :'o2'), null, '... and the reaction stores none');

-- A fact the buyer deleted isn't brought back by a repeat save.
select tests.rx_save(:'a', :'o2', 'loved', null, 'loved', 'Lamp');
select is(tests.rx_fact(:'p', 'loved', 'Lamp'), 1, 'changing back writes the fact again');
select tests.reset_role();
delete from concierge.profile_facts where person_id = :'p' and value = 'Lamp';
select tests.act_as_server();
select tests.rx_save(:'a', :'o2', 'loved', 'x', 'loved', 'Lamp');
select is(tests.rx_fact(:'p', 'loved', 'Lamp'), 0, 'AC-8 a deleted fact stays deleted after a note edit');

-- A fact the buyer edited, turned off or moved to another category stays.
select tests.reset_role();
select tests.rx_round(:'p') as r3 \gset
select tests.rx_order(:'r3') as oe \gset
select tests.rx_order(:'r3') as ot \gset
select tests.rx_order(:'r3') as oc \gset
select tests.act_as_server();
select tests.rx_save(:'a', :'oe', 'loved', null, 'loved', 'Mug');
select tests.rx_save(:'a', :'ot', 'loved', null, 'loved', 'Scarf');
select tests.rx_save(:'a', :'oc', 'loved', null, 'loved', 'Book');
select tests.reset_role();
update concierge.profile_facts set value = 'Blue mugs' where person_id = :'p' and value = 'Mug';
update concierge.profile_facts set active = false where person_id = :'p' and value = 'Scarf';
update concierge.profile_facts set category = 'interest' where person_id = :'p' and value = 'Book';
select tests.act_as_server();
select tests.rx_save(:'a', :'oe', 'liked');
select tests.rx_save(:'a', :'ot', 'liked');
select tests.rx_save(:'a', :'oc', 'liked');
select is(tests.rx_fact(:'p', 'loved', 'Blue mugs'), 1, 'AC-8 an edited fact stays');
select is((select active from concierge.profile_facts where person_id = :'p' and value = 'Scarf'), false, 'AC-8 a turned-off fact stays, off');
select is(tests.rx_fact(:'p', 'interest', 'Book'), 1, 'AC-8 a fact moved to another category stays');
select tests.rx_save(:'a', :'ot', 'loved', null, 'loved', 'Scarf');
select is((select active from concierge.profile_facts where person_id = :'p' and value = 'Scarf'), false, 'AC-8 changing back doesn''t turn it on');
select is((select fact_value from concierge.reactions where order_id = :'ot'), null, '... and the reaction doesn''t claim it');

-- A fact from somewhere else is never claimed or removed.
select tests.reset_role();
insert into concierge.profile_facts (user_id, person_id, category, value, source) values (:'a', :'p', 'loved', 'Kettle', 'note');
select tests.rx_round(:'p') as r4 \gset
select tests.rx_order(:'r4') as ok1 \gset
select tests.rx_order(:'r4') as ok2 \gset
select tests.act_as_server();
select lives_ok(format($q$select tests.rx_save(%L, %L, 'loved', null, 'loved', ' kettle ')$q$, :'a', :'ok1'), 'a fact that already exists is no error');
select results_eq(format($q$select value, source, confirmed from concierge.profile_facts where person_id = %L and value_key = 'kettle'$q$, :'p'),
  $$values ('Kettle', 'note', false)$$, '... and is left as it is');
select is((select fact_category from concierge.reactions where order_id = :'ok1'), null, '... and isn''t recorded on the reaction');
select tests.rx_save(:'a', :'ok1', 'liked');
select is(tests.rx_fact(:'p', 'loved', 'Kettle'), 1, '... and a changed rating keeps it');

-- Same category and value, but the fact is now another input's.
select tests.rx_save(:'a', :'ok2', 'loved', null, 'loved', 'Teapot');
select tests.reset_role();
update concierge.profile_facts set source_id = gen_random_uuid() where person_id = :'p' and value = 'Teapot';
select tests.act_as_server();
select tests.rx_save(:'a', :'ok2', 'liked');
select is(tests.rx_fact(:'p', 'loved', 'Teapot'), 1, 'a fact that points at another input is kept');
select tests.rx_save(:'a', :'ok2', 'loved', null, 'loved', 'Pan');
select tests.reset_role();
update concierge.profile_facts set source = 'note' where person_id = :'p' and value = 'Pan';
select tests.act_as_server();
select tests.rx_save(:'a', :'ok2', 'liked');
select is(tests.rx_fact(:'p', 'loved', 'Pan'), 1, 'a fact whose source is no longer a reaction is kept');

-- A removed person gets no fact, but the answer is kept and the round closes.
select tests.reset_role();
select tests.rx_round(:'gone') as rg \gset
select tests.rx_order(:'rg') as og \gset
update public.people set deleted_at = now() where id = :'gone';
select tests.act_as_server();
select is(tests.rx_save(:'a', :'og', 'loved', 'hi', 'loved', 'Vase'), 'complete', 'a removed person''s gift can still be answered');
select is(tests.rx_fact(:'gone', 'loved', 'Vase'), 0, '... with no fact');
select is((select fact_category from concierge.reactions where order_id = :'og'), null, '... and none recorded');

-- ─── reactions_due (AC-1 to AC-3) ────────────────────────────────────────────
select tests.reset_role();
select tests.rx_round(:'p') as d1 \gset
select tests.rx_order(:'d1') as do1 \gset
-- Arrived after the occasion, on a UTC day that is still the day before in New York.
select tests.rx_round(:'p') as d2 \gset
select tests.rx_order(:'d2');
select tests.rx_order(:'d2', 'delivered', '2091-12-28T01:30:00Z') as do2 \gset
select tests.rx_round(:'p', 'ordered') as d3 \gset
select tests.rx_order(:'d3');
select tests.rx_round(:'p', 'needs_attention') as d4 \gset
select tests.rx_order(:'d4');
select tests.rx_round(:'p', 'skipped') as d5 \gset
select tests.rx_order(:'d5');
select tests.rx_round(:'p') as d6 \gset
select tests.rx_order(:'d6');
insert into concierge.round_sends (user_id, round_id, step) values (:'a', :'d6', 'reaction_prompt');
set local timezone = 'America/New_York';
select tests.act_as_server();
select is(tests.rx_due(:'d1', '2091-12-25'), false, 'AC-2 not on the occasion date');
select is(tests.rx_due(:'d1', '2091-12-26'), true, 'AC-1 due the day after the occasion');
select is(tests.rx_due(:'d1', '2092-01-01'), true, 'AC-1 due until the day before the close date');
select is(tests.rx_due(:'d1', '2092-01-02'), false, 'AC-7 not on the close date');
select is((select user_id from concierge.reactions_due('2091-12-26') where round_id = :'d1'), :'a'::uuid, 'the round''s buyer comes with it');
select is(tests.rx_due(:'d2', '2091-12-28'), false, 'AC-3 a late gift isn''t asked about on the UTC day it arrives, whatever the session''s zone');
select is(tests.rx_due(:'d2', '2091-12-29'), true, 'AC-3 ... but the day after');
select is(tests.rx_due(:'d2', '2092-01-04'), true, 'AC-3 ... and its close date moves with it');
select is(tests.rx_due(:'d2', '2092-01-05'), false, 'AC-3 ... to seven days later');
select is(tests.rx_due(:'d3', '2091-12-26') or tests.rx_due(:'d4', '2091-12-26') or tests.rx_due(:'d5', '2091-12-26'), false,
  'AC-2 ordered, needs_attention and skipped rounds aren''t asked');
select is(tests.rx_due(:'d6', '2091-12-26'), false, 'AC-1 a round already asked isn''t asked again');
select tests.reset_role();
set local timezone = 'UTC';
-- Answered directly, as a gift answered before the round was delivered would be.
insert into concierge.reactions (user_id, round_id, order_id, rating, source) values (:'a', :'d2', :'do2', 'liked', 'web');
select is(tests.rx_due(:'d2', '2091-12-29'), true, 'AC-18 a round with one gift unanswered is due');
insert into concierge.reactions (user_id, round_id, order_id, rating, source)
select user_id, round_id, id, 'liked', 'web' from concierge.orders where round_id = :'d2' and id <> :'do2';
select is(tests.rx_due(:'d2', '2091-12-29'), false, 'AC-18 a round with every gift answered isn''t');
-- A removed person isn't asked about; a removed occasion is.
select tests.rx_round(:'gone2') as dg \gset
select tests.rx_order(:'dg');
update concierge.occasions set deleted_at = now() where person_id = :'gone2';
select is(tests.rx_due(:'dg', '2091-12-26'), true, 'a removed occasion is still asked about');
update public.people set deleted_at = now() where id = :'gone2';
select is(tests.rx_due(:'dg', '2091-12-26'), false, 'a removed person isn''t');
update concierge.app_settings set value = '0' where key = 'reactions_enabled';
select is_empty($$select * from concierge.reactions_due('2091-12-26')$$, 'AC-13 nothing is due when switched off');

-- ─── close_reacted_rounds (AC-7, AC-13, AC-18) ───────────────────────────────
select is(concierge.close_reacted_rounds('2092-06-01'), 0, 'AC-13 nothing closes when switched off');
select is(tests.rx_status(:'d1'), 'delivered', 'AC-13 ... the round stays delivered');
update concierge.app_settings set value = '1' where key = 'reactions_enabled';
select tests.rx_round(:'p') as d7 \gset
select tests.rx_order(:'d7', 'delivered', '2091-12-29T10:00:00Z') as do7 \gset
select tests.act_as_server();
select concierge.close_reacted_rounds('2092-01-02') as closed \gset
select tests.reset_role();
select cmp_ok(:'closed'::int, '>=', 4, 'it returns how many it closed: at least this file''s four');
select results_eq(format('select status::text, next_action_at, closed_at from concierge.gift_rounds where id = %L', :'d1'),
  $$values ('complete', null::timestamptz, null::timestamptz)$$, 'AC-7 an unanswered round closes on its close date');
select is(tests.rx_status(:'d2'), 'complete', 'AC-18 a round answered earlier closes before its close date');
select is(tests.rx_status(:'d7'), 'delivered', 'an unanswered round before its close date stays');
select is(tests.rx_status(:'dg'), 'complete', 'a removed person''s round closes too');
select is(array[tests.rx_status(:'d3'), tests.rx_status(:'d4'), tests.rx_status(:'d5')], array['ordered', 'needs_attention', 'skipped'], 'only delivered rounds close');
update concierge.gift_rounds set next_action_at = '2091-01-01T00:00:00Z' where id = :'d1';
select tests.act_as_server();
select concierge.close_reacted_rounds('2092-01-02');
select is((select next_action_at from concierge.gift_rounds where id = :'d1'), '2091-01-01T00:00:00Z'::timestamptz, 'a second run leaves a closed round alone');
select is(tests.rx_save(:'a', :'do1', 'loved', null, 'loved', 'Late answer'), 'complete', 'answers are taken after the close');

-- ─── A round that becomes delivered late (AC-18) ─────────────────────────────
-- One gift arrived before the occasion; 16 days after it the store cancels the other.
select tests.reset_role();
select (now() at time zone 'utc')::date as today \gset
select tests.rx_round(:'p', 'ordered') as l1 \gset
update concierge.gift_rounds set occasion_date = :'today'::date - 16, ship_by_deadline = :'today'::date - 26 where id = :'l1';
select tests.rx_order(:'l1', 'delivered', now() - interval '21 days') as lo1 \gset
select tests.rx_order(:'l1', 'shipped') as lo2 \gset
select is((select delivered_at from concierge.gift_rounds where id = :'l1'), null, 'a round not delivered has no delivered_at');
select tests.act_as_server();
select is((select round_status::text from concierge.store_cancel_order(:'a', :'lo2', :'today', null)), 'delivered', 'AC-18 the store cancel delivers the round');
select tests.reset_role();
select is((select delivered_at from concierge.gift_rounds where id = :'l1'), now(), '... and records when');
select is(tests.rx_due(:'l1', :'today'), false, '... it isn''t asked that day');
select concierge.close_reacted_rounds(:'today');
select is(tests.rx_status(:'l1'), 'delivered', '... nor closed unasked');
select is(tests.rx_due(:'l1', :'today'::date + 1), true, '... it''s asked the day after');
select is(tests.rx_due(:'l1', :'today'::date + 7), true, '... until seven days later');
select is(tests.rx_due(:'l1', :'today'::date + 8), false, '... when it''s due to close');
-- Later writes to a delivered round keep the day.
update concierge.gift_rounds set delivered_at = '2091-12-30T01:30:00Z' where id = :'l1';
update concierge.gift_rounds set status = 'delivered', next_action_at = now() where id = :'l1';
select is((select delivered_at from concierge.gift_rounds where id = :'l1'), '2091-12-30T01:30:00Z'::timestamptz, 'setting delivered again keeps the first time');
set local timezone = 'America/New_York';
select is(concierge.reaction_asked_on(:'l1'), '2091-12-31'::date, 'its day is the UTC one, whatever the session''s zone');
set local timezone = 'UTC';
update concierge.gift_rounds set delivered_at = null where id = :'l1';
select is(concierge.reaction_asked_on(:'l1'), :'today'::date - 15, 'a round from before the column is asked by its other dates');
select is((select delivered_at from concierge.gift_rounds where id = :'d7'), now(), 'a round written as delivered gets the time too');
select is(has_column_privilege('authenticated', 'concierge.gift_rounds', 'delivered_at', 'insert')
  or has_column_privilege('authenticated', 'concierge.gift_rounds', 'delivered_at', 'update')
  or has_column_privilege('anon', 'concierge.gift_rounds', 'delivered_at', 'insert')
  or has_column_privilege('anon', 'concierge.gift_rounds', 'delivered_at', 'update'), false, 'users can''t write delivered_at');

-- ─── A missing setting is an error ───────────────────────────────────────────
select tests.reset_role();
-- The delete is undone with the block it raises from.
create function tests.rx_without(p_key text, p_call text) returns text language plpgsql as $$
begin
  delete from concierge.app_settings where key = p_key;
  execute p_call;
  raise exception 'no error';
exception when raise_exception then
  return sqlerrm;
end;
$$;
select is(tests.rx_without('reactions_enabled', format($q$select tests.rx_save(%L, %L, 'liked')$q$, :'a', :'do1')), 'save_reaction: missing setting reactions_enabled', 'save needs the switch');
select is(tests.rx_without('reaction_note_max_chars', format($q$select tests.rx_save(%L, %L, 'liked')$q$, :'a', :'do1')), 'save_reaction: missing setting reaction_note_max_chars', 'save needs the note limit');
select is(tests.rx_without('reactions_enabled', $q$select * from concierge.reactions_due('2091-12-26')$q$), 'reactions_due: missing setting reactions_enabled', 'due needs the switch');
select is(tests.rx_without('reaction_close_days', $q$select * from concierge.reactions_due('2091-12-26')$q$), 'reactions_due: missing setting reaction_close_days', 'due needs the close days');
select is(tests.rx_without('reaction_prompt_after_days', $q$select * from concierge.reactions_due('2091-12-26')$q$), 'reactions_due: missing setting reaction_prompt_after_days', 'due needs the prompt days');
select is(tests.rx_without('reactions_enabled', $q$select concierge.close_reacted_rounds('2091-12-26')$q$), 'close_reacted_rounds: missing setting reactions_enabled', 'close needs the switch');
select is(tests.rx_without('reaction_close_days', $q$select concierge.close_reacted_rounds('2091-12-26')$q$), 'close_reacted_rounds: missing setting reaction_close_days', 'close needs the close days');
select is(tests.rx_without('reaction_prompt_after_days', $q$select concierge.close_reacted_rounds('2091-12-26')$q$), 'close_reacted_rounds: missing setting reaction_prompt_after_days', 'close needs the prompt days');

-- ─── The table's own rules ───────────────────────────────────────────────────
select throws_ok(format($q$update concierge.reactions set fact_category = 'loved', fact_value = null where order_id = %L$q$, :'do1'),
  '23514', null, 'a fact category needs its value');
select throws_ok(format($q$update concierge.reactions set fact_category = null, fact_value = 'x' where order_id = %L$q$, :'do1'),
  '23514', null, 'a fact value needs its category');
update concierge.reactions set source = 'email' where order_id = :'do1';
select tests.rx_save(:'a', :'do1', 'loved', 'again');
select is((select source from concierge.reactions where order_id = :'do1'), 'web', 'a same-rating save records where it came from');
select throws_ok(format($q$insert into concierge.reactions (user_id, round_id, order_id, rating, source) values (%L, %L, %L, 'liked', 'web')$q$, :'a', :'d7', :'os'),
  '23503', null, 'a reaction can''t pair one round with another''s order');
select throws_ok(format($q$insert into concierge.reactions (user_id, round_id, order_id, rating, source) values (%L, %L, %L, 'liked', 'web')$q$, :'a', :'d1', :'do1'),
  '23505', null, 'one reaction per order');
delete from concierge.orders where id = :'do1';
select is((select count(*)::int from concierge.reactions where round_id = :'d1'), 0, 'deleting an order deletes its reaction');
select lives_ok(format('delete from public.people where id = %L', :'p'), 'deleting a person works');
select is((select count(*)::int from concierge.reactions where round_id in (:'r1', :'r2', :'r3', :'r4')), 0, '... and deletes their reactions');
select lives_ok(format('delete from auth.users where id = %L', :'a'), 'deleting an account works');
select is((select count(*)::int from concierge.reactions where user_id = :'a'), 0, '... and deletes its reactions');

select * from finish();
rollback;
