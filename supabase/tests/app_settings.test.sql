-- App-wide settings (T23): seeded by migration, readable by the server only.
begin;
\ir _helpers.psql
select plan(6);

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
    'default_over_budget_pct', 'zinc_gift_message_max_chars', 'test_action_link_hours',
    'install_tip_snooze_days', 'capture_text_max_chars', 'capture_screenshot_max_bytes',
    'person_photo_max_upload_bytes', 'person_photo_px', 'contact_photo_timeout_ms', 'contact_photo_concurrency',
    'capture_fact_min_confidence_pct', 'capture_extraction_enabled', 'capture_extract_timeout_ms',
    'round_engine_enabled', 'round_lock_minutes', 'round_max_attempts',
    'store_page_read_enabled', 'store_page_read_timeout_ms', 'store_page_read_max_bytes',
    'guided_questions_max', 'guided_answer_max_facts', 'readiness_points_interests', 'readiness_points_wants',
    'readiness_points_avoid', 'readiness_points_sizes', 'readiness_points_brands', 'readiness_points_owns',
    'readiness_points_own_list', 'readiness_ready_pct', 'readiness_meter_enabled',
    'capture_read_estimate_cents'
  ],
  'every fee, limit, default and schedule setting is seeded'
);

select is(concierge.setting_int('install_tip_snooze_days'), 14, 'the install tip snoozes for 14 days by default');

select * from finish();
rollback;
