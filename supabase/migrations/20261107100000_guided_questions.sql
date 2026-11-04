-- Guided questions and the readiness meter (ALL-26, T53, decision 51). Expand
-- only. Open questions are computed from facts, so a row here appears only once
-- a question is answered or skipped. `answer` stays empty from now on: answers
-- live only as profile_facts, so deleting a fact really removes the text.

alter table concierge.questions add column question_key text;

-- A plain unique index (not partial), so the app can upsert on it. Rows from
-- before this column have a null key, and nulls don't collide.
create unique index questions_person_key on concierge.questions (person_id, question_key);

insert into concierge.app_settings (key, value, description) values
  ('guided_questions_max', '5', 'Guided questions shown at a time. 0 switches questions off (form, next step, email link).'),
  ('guided_answer_max_facts', '20', 'Most facts one guided answer may become; more is refused.'),
  ('readiness_points_interests', '30', 'Readiness points once a person has an interest.'),
  ('readiness_points_wants', '20', 'Readiness points once a person has a want.'),
  ('readiness_points_avoid', '15', 'Readiness points once a person has something to avoid.'),
  ('readiness_points_sizes', '15', 'Readiness points once a person has a size.'),
  ('readiness_points_brands', '10', 'Readiness points once a person has a brand or style.'),
  ('readiness_points_owns', '10', 'Readiness points once a person has something they own.'),
  ('readiness_points_own_list', '40', 'Readiness points when a person keeps their own list.'),
  ('readiness_ready_pct', '60', 'Readiness score that reads "Good to go".'),
  ('readiness_meter_enabled', '1', '1 shows the readiness meter on the person page; 0 hides it (off switch).')
on conflict (key) do nothing;

-- Saves one form of answers in one transaction: a row per question, a fact per
-- value. p_answers is [{ key, prompt, category, values: [text] }], already
-- checked by the app. Runs as the caller, so row-level security applies, and
-- people it can't see (someone else's, or deleted) are refused. An answer that
-- matches a turned-off fact turns it back on: the buyer just told us it's true.
create function concierge.answer_questions(p_person_id uuid, p_answers jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_answer jsonb;
  v_question_id uuid;
  v_value text;
  v_saved integer := 0;
begin
  if not exists (select 1 from public.people where id = p_person_id) then
    raise exception 'person not found' using errcode = 'P0002';
  end if;

  for v_answer in select * from jsonb_array_elements(p_answers) loop
    insert into concierge.questions (person_id, question_key, prompt, status)
    values (p_person_id, v_answer->>'key', v_answer->>'prompt', 'answered')
    on conflict (person_id, question_key)
    do update set prompt = excluded.prompt, status = 'answered'
    returning id into v_question_id;

    for v_value in select * from jsonb_array_elements_text(v_answer->'values') loop
      insert into concierge.profile_facts (person_id, category, value, source, source_id, confirmed)
      values (p_person_id, v_answer->>'category', v_value, 'question', v_question_id, true)
      on conflict (person_id, category, value_key)
      do update set active = true, confirmed = true;
      v_saved := v_saved + 1;
    end loop;
  end loop;

  return v_saved;
end;
$$;

revoke execute on function concierge.answer_questions(uuid, jsonb) from public, anon;
grant execute on function concierge.answer_questions(uuid, jsonb) to authenticated;
