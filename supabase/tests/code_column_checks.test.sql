-- Code columns accept the values the app writes and refuse anything else.
begin;
\ir _helpers.psql
select plan(43);

select tests.create_user('codes@example.com') as u \gset
insert into public.people (user_id, name, relationship) values (:'u', 'P', 'friend') returning id as p \gset
insert into concierge.occasions (user_id, person_id, kind) values (:'u', :'p', 'christmas') returning id as o \gset
insert into concierge.gift_rounds (user_id, person_id, occasion_id, occasion_year, occasion_date, ship_by_deadline, budget_cents, status, next_action_at)
values (:'u', :'p', :'o', 2030, current_date + 37, current_date + 30, 9000, 'needs_attention', now() + interval '5 days') returning id as r \gset
insert into concierge.gift_ideas (user_id, round_id, title, price_cents, est_total_cents, rank)
values (:'u', :'r', 'Mug', 4000, 4500, 1) returning id as i \gset
insert into concierge.orders (user_id, round_id, idea_id, funding_mode, max_price_cents, fee_cents, status, hold_reason, ship_to, ship_city, ship_state)
values (:'u', :'r', :'i', 'zinc_wallet', 4500, 100, 'held', 'retry', 'recipient', 'Dayton', 'OH') returning id as ord \gset
insert into concierge.idea_runs (user_id, person_id, round_id) values (:'u', :'p', :'r') returning id as run \gset
insert into concierge.captures (user_id, person_id) values (:'u', :'p') returning id as cap \gset
insert into concierge.inbound_messages (user_id, status) values (:'u', 'asking') returning id as msg \gset
insert into lists.lists (owner_id) values (:'u') returning id as list \gset

-- ─── notifications.kind ─────────────────────────────────────────────────────

select lives_ok(format($$insert into concierge.notifications (user_id, kind) values (%L, 'heads_up')$$, :'u'),
  'a known notification kind is saved');
select lives_ok(format($$insert into concierge.notifications (user_id, kind) values (%L, %L)$$, :'u', k), 'notification kind ' || k || ' is saved')
  from unnest(array['tracking_news', 'gift_late', 'gift_on_time', 'store_cancelled_late', 'delivered']) k;
select throws_ok(format($$insert into concierge.notifications (user_id, kind) values (%L, 'heads-up')$$, :'u'),
  '23514', null, 'an unknown notification kind is refused');

-- ─── action_links.action ────────────────────────────────────────────────────

select lives_ok(format($$insert into concierge.action_links (user_id, action, token_hash, expires_at)
  values (%L, 'open_person', 'h1', now())$$, :'u'), 'a known link action is saved');
select throws_ok(format($$insert into concierge.action_links (user_id, action, token_hash, expires_at)
  values (%L, 'delete_account', 'h2', now())$$, :'u'), '23514', null, 'an unknown link action is refused');

-- ─── round_sends.step ───────────────────────────────────────────────────────

select lives_ok(format($$insert into concierge.round_sends (round_id, user_id, step) values (%L, %L, %L)$$, :'r', :'u', s), 'step ' || s || ' is saved')
  from unnest(array[
    'heads_up', 'reminder_1@2', 'hold:1:notice', 'hold:2:short:2030-01-05', 'fail:1:notice',
    'fail:' || :'ord', 'ordered:' || :'ord', 'late_fail:' || :'ord',
    'late:' || :'ord', 'ontime:' || :'ord', 'cancel_late:' || :'ord', 'late:2:' || :'ord', 'ontime:12:' || :'ord', 'delivered'
  ]) s;
select throws_ok(format($$insert into concierge.round_sends (round_id, user_id, step) values (%L, %L, %L)$$, :'r', :'u', s), '23514', null, 'step ' || s || ' is refused')
  from unnest(array['reminder_3', 'fail:abc', 'hold:x:notice', 'late:abc', 'late:1:' || :'ord']) s;

-- ─── rejections.reason_code ─────────────────────────────────────────────────

select lives_ok(format($$insert into concierge.rejections (user_id, round_id, reason_code) values (%L, %L, 'has_it')$$, :'u', :'r'),
  'a known rejection reason is saved');
select throws_ok(format($$insert into concierge.rejections (user_id, round_id, reason_code) values (%L, %L, 'ugly')$$, :'u', :'r'),
  '23514', null, 'an unknown rejection reason is refused');

-- ─── idea_runs.stage ────────────────────────────────────────────────────────

select lives_ok(format($$update concierge.idea_runs set stage = 'ranked' where id = %L$$, :'run'), 'a known run stage is saved');
select throws_ok(format($$update concierge.idea_runs set stage = 'started' where id = %L$$, :'run'),
  '23514', null, 'an unknown run stage is refused');
select lives_ok(format($$update concierge.idea_runs set stage = null where id = %L$$, :'run'), 'a run with no stage yet is fine');

-- ─── list_items.source ──────────────────────────────────────────────────────

select lives_ok(format($$insert into lists.list_items (list_id, position, name, price_cents, source) values (%L, 0, 'A', 100, 'extension')$$, :'list'),
  'a known gift source is saved');
select throws_ok(format($$insert into lists.list_items (list_id, position, name, price_cents, source) values (%L, 1, 'B', 100, 'telepathy')$$, :'list'),
  '23514', null, 'an unknown gift source is refused');

-- ─── captures.screenshot_type ───────────────────────────────────────────────

select lives_ok(format($$update concierge.captures set screenshot_type = 'image/png' where id = %L$$, :'cap'), 'a known screenshot type is saved');
select throws_ok(format($$update concierge.captures set screenshot_type = 'text/html' where id = %L$$, :'cap'),
  '23514', null, 'an unknown screenshot type is refused');
select lives_ok(format($$update concierge.captures set screenshot_type = null where id = %L$$, :'cap'), 'a capture with no screenshot is fine');

-- ─── inbound_messages.image_type ────────────────────────────────────────────

select lives_ok(format($$update concierge.inbound_messages set image_type = 'image/gif' where id = %L$$, :'msg'), 'a known image type is saved');
select throws_ok(format($$update concierge.inbound_messages set image_type = 'application/pdf' where id = %L$$, :'msg'),
  '23514', null, 'an unknown image type is refused');

-- ─── orders.failure_type ────────────────────────────────────────────────────

select lives_ok(format($$update concierge.orders set failure_type = 'address_rejected' where id = %L$$, :'ord'), 'a known failure type is saved');
select lives_ok(format($$update concierge.orders set failure_type = 'store_cancelled' where id = %L$$, :'ord'), 'store_cancelled is a known failure type');
select throws_ok(format($$update concierge.orders set failure_type = 'max_price_exceeded' where id = %L$$, :'ord'),
  '23514', null, 'a raw Zinc error code is refused');

select * from finish();
rollback;
