-- Every change of a bought gift's timing is told (T89 as revised 2026-11-24): the second time it is
-- late or back on time is keyed late:2:<order id> / ontime:2:<order id>, and so on. Only the check
-- changes; the keys already there stay valid, and old code ignores the new ones.
alter table concierge.round_sends drop constraint round_sends_step_check;
alter table concierge.round_sends
  add constraint round_sends_step_check check (
    step ~ '^(heads_up|reminder_[12]|final_notice|skipped|address_request|address_reminder_[12]|address_final_notice|hold_trouble|missed_on_us|held_cancelled|shared_address|no_ideas|no_ideas_again|delivered|reaction_prompt)$'
    or step ~ '^(heads_up|reminder_[12]|final_notice|no_ideas|no_ideas_again)@[0-9]+$'
    or step ~ '^hold:[0-9]+:(notice|reminder|final|deadline)$'
    or step ~ '^hold:[0-9]+:short:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or step ~ '^fail:[0-9]+:notice$'
    or step ~ '^(fail|ordered|late_fail):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or step ~ '^(late|ontime|cancel_late):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or step ~ '^(late|ontime):([2-9]|[1-9][0-9]+):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
