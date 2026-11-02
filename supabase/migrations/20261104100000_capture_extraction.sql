-- Capture extraction (ALL-25, D47, T48): two more fact categories and the
-- settings the extraction step reads. Expand only: nothing is removed.

-- "wants" is a stated want or need; "constraint" is a neutral practical need
-- ("prefers large-grip items"). The model's categories match this list.
alter table concierge.profile_facts drop constraint profile_facts_category_check;
alter table concierge.profile_facts add constraint profile_facts_category_check
  check (category in ('interest', 'dislike', 'size', 'brand', 'owns', 'wants', 'style', 'avoid', 'constraint', 'loved'));

insert into concierge.app_settings (key, value, description) values
  ('capture_fact_min_confidence_pct', '60', 'Facts the AI is less sure of than this (percent) are dropped, not saved.'),
  ('capture_extraction_enabled', '1', '1 reads captures with the AI as they arrive; 0 saves them unread (off switch).')
on conflict (key) do nothing;
