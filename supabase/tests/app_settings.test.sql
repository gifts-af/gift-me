-- App-wide settings (T23): seeded by migration, readable by the server only.
begin;
\ir _helpers.psql
select plan(5);

select tests.create_user('a@example.com') as a \gset

select tests.act_as(:'a');
select throws_ok('select * from concierge.app_settings', '42501', null, 'signed-in users cannot read app settings');
select throws_ok(
  $q$update concierge.app_settings set value = '0' where key = 'zinc_order_fee_cents'$q$,
  '42501', null, 'signed-in users cannot change app settings'
);

select tests.act_as_anon();
select throws_ok('select * from concierge.app_settings', '42501', null, 'anon cannot read app settings');

-- The server (service role) reads them.
select tests.reset_role();
set local role service_role;
select is(
  (select value from concierge.app_settings where key = 'zinc_order_fee_cents'),
  '100'::jsonb,
  'the Zinc order fee is seeded at 100 cents'
);
select set_eq(
  'select key from concierge.app_settings',
  array[
    'zinc_order_fee_cents', 'planning_delivery_days', 'safety_buffer_days', 'round_lead_days',
    'reminder_1_after_heads_up_days', 'reminder_2_before_deadline_days',
    'final_notice_before_deadline_days', 'fastest_days_to_arrive',
    'default_over_budget_pct', 'zinc_gift_message_max_chars'
  ],
  'every fee, limit, default and schedule setting is seeded'
);

select * from finish();
rollback;
