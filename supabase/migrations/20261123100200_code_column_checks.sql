-- Code columns only accept the values the app knows. Each list is every value
-- the app and the SQL functions write; a new value means adding it here too,
-- so a typo or a stale caller fails loudly instead of saving a row nothing
-- reads. Nullable columns stay nullable.

-- notify/templates.ts NotificationKind.
alter table concierge.notifications
  add constraint notifications_kind_check check (kind in (
    'test', 'heads_up', 'reminder', 'final_notice', 'needs_attention', 'reaction_prompt',
    'needs_address', 'skipped', 'hold_funds', 'hold_setup', 'hold_address', 'hold_trouble',
    'hold_unconfirmed', 'price_up', 'out_of_stock', 'too_late', 'missed_on_us', 'ordered',
    'failed_late', 'failed_several', 'check_your_address', 'notes_tip', 'who_is_this',
    'notes_not_read', 'notes_cant_cancel', 'no_ideas'
  ));

-- notify/actions.ts ActionName.
alter table concierge.action_links
  add constraint action_links_action_check check (action in (
    'test', 'open_person', 'add_address', 'answer_questions', 'open_settings',
    'check_my_address', 'cancel_held_gift', 'file_note'
  ));

-- core round-plan.ts StepKey. Some keys carry a number, a date or an order id,
-- so this is a pattern per shape rather than a list:
--   a plain step; an approval step renamed <step>@<n> by reject_round_ideas;
--   hold:<n>:<stage> and hold:<n>:short:<date>; fail:<order id> and the older
--   fail:<n>:notice that untold_failures still reads; ordered:<order id> and
--   late_fail:<order id>.
alter table concierge.round_sends
  add constraint round_sends_step_check check (
    step ~ '^(heads_up|reminder_[12]|final_notice|skipped|address_request|address_reminder_[12]|address_final_notice|hold_trouble|missed_on_us|held_cancelled|shared_address|no_ideas|no_ideas_again)$'
    or step ~ '^(heads_up|reminder_[12]|final_notice|no_ideas|no_ideas_again)@[0-9]+$'
    or step ~ '^hold:[0-9]+:(notice|reminder|final|deadline)$'
    or step ~ '^hold:[0-9]+:short:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or step ~ '^fail:[0-9]+:notice$'
    or step ~ '^(fail|ordered|late_fail):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- The reasons reject_round_ideas accepts.
alter table concierge.rejections
  add constraint rejections_reason_code_check check (reason_code in (
    'has_it', 'not_style', 'too_pricey', 'too_generic'
  ));

-- ideas/store.ts RunStage; null until the run's first stage is saved.
alter table concierge.idea_runs
  add constraint idea_runs_stage_check check (stage in ('brainstormed', 'resolved', 'ranked'));

-- Where a gift came from: typed in, a pasted link (lib/product-link.ts), the
-- add panel's page read or Amazon lookup, or the browser extension.
alter table lists.list_items
  add constraint list_items_source_check check (source in (
    'manual', 'store-url', 'amazon-url', 'amazon-fixture', 'store-page', 'amazon-zinc', 'extension'
  ));

-- The image types a capture can hold (capture.ts IMAGE_EXTENSIONS); an emailed
-- note's image becomes its capture's screenshot, so both take the same list.
alter table concierge.captures
  add constraint captures_screenshot_type_check check (screenshot_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ));
alter table concierge.inbound_messages
  add constraint inbound_messages_image_type_check check (image_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ));

-- Why an order failed or was cancelled. Zinc's error codes are mapped before
-- they get here (zinc/events.ts failureType): price_up, out_of_stock,
-- invalid_shipping_address, or failed for anything else. The rest are ours:
-- placing's own checks, a shared address the store refused, and the round
-- closing around a held gift.
alter table concierge.orders
  add constraint orders_failure_type_check check (failure_type in (
    'failed', 'price_up', 'out_of_stock', 'invalid_shipping_address', 'too_late',
    'address_withdrawn', 'address_rejected', 'held_expired', 'cancelled', 'round_closed'
  ));
