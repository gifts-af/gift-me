-- A failure recorded after its round closed (ALL-32 final review S2): an
-- order still placing at the deadline fails, or the owner settles an
-- unconfirmed one as failed. reconcile_round resolves it and the round ends
-- skipped, so the engine never looks at it again; the order is marked
-- failed_after_close, and the app emails the customer for each one.
begin;
\ir _helpers.psql
select plan(6);

select tests.create_user('late@example.com') as u \gset

create function tests.lf_round(p_user uuid) returns uuid language plpgsql as $$
declare v_person uuid; v_occasion uuid; v_round uuid;
begin
  insert into public.people (user_id, name, relationship) values (p_user, 'P', 'friend') returning id into v_person;
  insert into concierge.occasions (user_id, person_id, kind) values (p_user, v_person, 'christmas') returning id into v_occasion;
  insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
  values (p_user, v_person, v_occasion, 2030, current_date + 7, current_date, 5000, 'ordered', now())
  returning id into v_round;
  return v_round;
end $$;

create function tests.lf_order(p_round uuid, p_status text) returns uuid language plpgsql as $$
declare v_idea uuid; v_order uuid; v_user uuid;
begin
  select user_id into v_user from concierge.gift_rounds where id = p_round;
  insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
  values (v_user, p_round, 'Mug', 4000, 4500, 1) returning id into v_idea;
  insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, ship_to, ship_city, ship_state)
  values (v_user, p_round, v_idea, 'zinc_wallet', 4500, 100, p_status, 'recipient', 'Dayton', 'OH') returning id into v_order;
  return v_order;
end $$;

-- Open round: a failure is an ordinary one.
select tests.lf_round(:'u') as open_round \gset
select tests.lf_order(:'open_round', 'placing') as open_order \gset
-- Closed at the deadline with the order still placing.
select tests.lf_round(:'u') as closed_round \gset
select tests.lf_order(:'closed_round', 'placing') as closed_order \gset
select concierge.cancel_held(:'closed_round', 'deadline');
-- Closed with the order unconfirmed; the owner settles it as failed (runbook in design/operations.md).
select tests.lf_round(:'u') as unconf_round \gset
select tests.lf_order(:'unconf_round', 'unconfirmed') as unconf_order \gset
select concierge.cancel_held(:'unconf_round', 'deadline');

select concierge.settle_order(:'u', :'open_order', 'failed', 'out_of_stock', null);
select concierge.settle_order(:'u', :'closed_order', 'failed', 'out_of_stock', null);
select concierge.settle_order(:'u', :'unconf_order', 'failed', 'failed', null);

select is((select failed_after_close from concierge.orders where id = :'open_order'), false, 'a failure on an open round is an ordinary one');
select is((select failed_after_close from concierge.orders where id = :'closed_order'), true, 'a placing order that fails after the deadline is marked');
select is((select status::text from concierge.gift_rounds where id = :'closed_round'), 'skipped', '... and its round ends skipped');
select is((select failed_after_close from concierge.orders where id = :'unconf_order'), true, 'an unconfirmed order settled as failed after the close is marked');
select is((select status::text from concierge.gift_rounds where id = :'unconf_round'), 'skipped', '... and its round ends skipped');

select tests.act_as(:'u');
select throws_ok('select failed_after_close from concierge.orders', '42501', null, 'users can''t read the new column');
select tests.reset_role();

select * from finish();
rollback;
