-- Inbound email notes (ALL-31, design/plans/ALL-31-email-capture.md). Mail to
-- notes@in.giftsaf.com from an account's own address becomes a capture for
-- the person it names. When it names nobody, or several people, the note is
-- kept as an "asking" message until the user taps who it's about.
-- inbound_messages has never been used by app code, so its placeholder
-- columns are replaced here; everything else is added (E7).

-- ─── inbound_seen ───────────────────────────────────────────────────────────
-- Resend email ids already taken, so a webhook retry does nothing. No
-- personal data. The daily tick prunes rows older than 7 days.
create table concierge.inbound_seen (
  provider_email_id text primary key,
  created_at timestamptz not null default now()
);
alter table concierge.inbound_seen enable row level security;
revoke all on concierge.inbound_seen from public, anon, authenticated;
grant all on concierge.inbound_seen to service_role;

-- ─── inbound_events ─────────────────────────────────────────────────────────
-- One row per accepted message and per email sent back, for the per-user
-- daily cap (inbound_max_per_user_per_day), so a mail loop can't run up AI
-- spend or the email quota. Pruned by the daily tick like inbound_seen.
create table concierge.inbound_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index inbound_events_user_id_created_at_idx on concierge.inbound_events (user_id, created_at);
create index inbound_events_created_at_idx on concierge.inbound_events (created_at);
alter table concierge.inbound_events enable row level security;
revoke all on concierge.inbound_events from public, anon, authenticated;
grant all on concierge.inbound_events to service_role;

-- ─── inbound_messages ───────────────────────────────────────────────────────
-- Only notes waiting on "Who is this about?" are stored. Subject and body
-- are cleared once filed; the capture holds them from then on.
alter table concierge.inbound_messages
  drop column from_address,
  drop column attachments,
  add column notification_id uuid references concierge.notifications (id) on delete set null,
  add column capture_id uuid references concierge.captures (id) on delete set null,
  add column image_path text,
  add column image_type text,
  alter column status set default 'asking',
  add constraint inbound_messages_status_check check (status in ('asking', 'filed'));

-- ─── notifications ──────────────────────────────────────────────────────────
-- The person an email is about, so a reply to it files to that person, and
-- the Message-ID header we set, which the reply's In-Reply-To names.
-- provider_message_id stays Resend's own id.
alter table concierge.notifications
  add column person_id uuid,
  add column message_id text unique,
  add foreign key (person_id, user_id) references public.people (id, user_id)
    on delete set null (person_id);

-- ─── action_links ───────────────────────────────────────────────────────────
-- A "Who is this about?" button names the message and the person it files to.
alter table concierge.action_links
  add column inbound_message_id uuid references concierge.inbound_messages (id) on delete cascade,
  add column person_id uuid,
  add foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade;
create index action_links_inbound_message_id_idx on concierge.action_links (inbound_message_id);

-- ─── captures ───────────────────────────────────────────────────────────────
-- The screenshot's media type. Null means image/jpeg, which is all the
-- extension sends; an emailed image can also be PNG, WebP or GIF.
alter table concierge.captures add column screenshot_type text;

-- ─── accounts ───────────────────────────────────────────────────────────────
-- One-time emails: the "Did you know?" tip, and the reply telling an account
-- without paid features that notes aren't read. Set only by the server.
alter table concierge.accounts
  add column notes_tip_sent_at timestamptz,
  add column notes_unpaid_reply_sent_at timestamptz;

-- ─── functions (server only) ────────────────────────────────────────────────

-- Sets one of the one-time flags above if it isn't set yet, creating the
-- account row when the user has none. True only for the call that set it.
create function concierge.claim_inbound_flag(p_user_id uuid, p_flag text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_flag not in ('notes_tip_sent_at', 'notes_unpaid_reply_sent_at') then
    raise exception 'unknown inbound flag: %', p_flag;
  end if;

  insert into concierge.accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;

  update concierge.accounts
     set notes_tip_sent_at = case when p_flag = 'notes_tip_sent_at' then now() else notes_tip_sent_at end,
         notes_unpaid_reply_sent_at = case when p_flag = 'notes_unpaid_reply_sent_at' then now() else notes_unpaid_reply_sent_at end
   where user_id = p_user_id
     and case p_flag
           when 'notes_tip_sent_at' then notes_tip_sent_at is null
           else notes_unpaid_reply_sent_at is null
         end;
  return found;
end;
$$;

-- Messages accepted plus emails sent back today (UTC) for one user.
create function concierge.inbound_count_today(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from concierge.inbound_events
   where user_id = p_user_id
     and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

-- Files an asking message to a person as a capture. Only the first call
-- wins: the message row is locked, so a second tap (even a concurrent one)
-- finds it filed. Refused (null) when the message isn't the user's, isn't
-- asking, or the person is deleted or someone else's.
create function concierge.file_inbound_message(p_user_id uuid, p_message_id uuid, p_person_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg concierge.inbound_messages;
  v_capture_id uuid;
begin
  select * into v_msg from concierge.inbound_messages
   where id = p_message_id and user_id = p_user_id and status = 'asking'
   for update;
  if not found then
    return null;
  end if;

  if not exists (select 1 from public.people
                  where id = p_person_id and user_id = p_user_id and deleted_at is null) then
    return null;
  end if;

  insert into concierge.captures (user_id, person_id, page_title, text_excerpt, screenshot_path, screenshot_type)
  values (p_user_id, p_person_id, v_msg.subject, v_msg.body, v_msg.image_path, v_msg.image_type)
  returning id into v_capture_id;

  update concierge.inbound_messages
     set status = 'filed', capture_id = v_capture_id, subject = null, body = null
   where id = p_message_id;

  return v_capture_id;
end;
$$;

-- The daily tick's housekeeping. Clears the subject, body and image of
-- "asking" messages none of whose file_note buttons can still be tapped
-- (all expired, none used), and returns the stored image paths so the tick
-- can delete the files. A filed message is never touched: its image_path is
-- the capture's screenshot. A message with no buttons at all is cleared once
-- it is older than inbound_link_hours (the buttons are made right after it).
-- Also prunes inbound_seen and inbound_events older than inbound_prune_days.
create function concierge.clear_unfiled_inbound()
returns table (message_id uuid, image_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prune_days integer := concierge.setting_int('inbound_prune_days');
  v_link_hours integer := concierge.setting_int('inbound_link_hours');
begin
  delete from concierge.inbound_seen where created_at < now() - make_interval(days => v_prune_days);
  delete from concierge.inbound_events where created_at < now() - make_interval(days => v_prune_days);

  return query
  with due as (
    select m.id, m.image_path as old_path
      from concierge.inbound_messages m
     where m.status = 'asking'
       and (m.subject is not null or m.body is not null or m.image_path is not null)
       and not exists (select 1 from concierge.action_links l
                        where l.inbound_message_id = m.id and l.action = 'file_note'
                          and (l.used_at is not null or l.expires_at > now()))
       and (exists (select 1 from concierge.action_links l
                     where l.inbound_message_id = m.id and l.action = 'file_note')
            or m.created_at < now() - make_interval(hours => v_link_hours))
       for update of m
  ), cleared as (
    update concierge.inbound_messages m
       set subject = null, body = null, image_path = null, image_type = null
      from due
     where m.id = due.id
    returning m.id
  )
  select due.id, due.old_path from due join cleared on cleared.id = due.id;
end;
$$;

revoke all on function concierge.claim_inbound_flag(uuid, text) from public, anon, authenticated;
revoke all on function concierge.inbound_count_today(uuid) from public, anon, authenticated;
revoke all on function concierge.file_inbound_message(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function concierge.clear_unfiled_inbound() from public, anon, authenticated;
grant execute on function concierge.claim_inbound_flag(uuid, text) to service_role;
grant execute on function concierge.inbound_count_today(uuid) to service_role;
grant execute on function concierge.file_inbound_message(uuid, uuid, uuid) to service_role;
grant execute on function concierge.clear_unfiled_inbound() to service_role;

-- ─── settings ───────────────────────────────────────────────────────────────
insert into concierge.app_settings (key, value, description) values
  ('inbound_email_enabled', '1', '1 accepts notes emailed to the notes address; 0 answers the webhook and only logs (off switch).'),
  ('inbound_match_max_choices', '5', 'Most people offered as buttons in a "Who is this about?" email.'),
  ('inbound_max_per_user_per_day', '20', 'Most emailed notes accepted plus emails sent back per user per day; more are dropped.'),
  ('inbound_link_hours', '72', 'Hours the "Who is this about?" buttons keep working.'),
  ('inbound_thread_lookup_max', '10', 'Most recent sent emails whose Message-ID is read back from Resend when a reply matches none (one Resend call each).'),
  ('inbound_thread_lookup_days', '60', 'How many days back a reply''s In-Reply-To is looked for among sent emails with no Message-ID yet.'),
  ('inbound_prune_days', '7', 'Days the daily tick keeps the seen Resend email ids and the daily-cap events before deleting them.')
on conflict (key) do nothing;
