-- Old rows get cleaned up. The daily tick's housekeeping call,
-- clear_unfiled_inbound, now also prunes spent action links, old notifications
-- and old idea runs, each by its own age in app_settings (T23). A missing
-- setting makes its delete match nothing, so nothing is pruned by accident.
--
-- What each prune leaves alone, and why:
-- - action_links: only links whose expires_at passed more than
--   action_link_prune_days ago. Until then a late tap still finds the link and
--   is told it expired or was used. An inbound message whose file_note links
--   are gone falls back to its own age in the clear-out below, so it is still
--   cleared.
-- - notifications: only rows older than notification_prune_days whose round is
--   finished for good (complete, skipped or delivered) or which have no round.
--   An ordered round can still fail late, so its emails stay. Reply threading
--   reads message_id for replies to old emails; the default age is far past
--   inbound_thread_lookup_days, and a reply to a year-old email just asks
--   "Who is this about?" again. action_links.notification_id is set null.
-- - idea_runs: only rows older than idea_run_prune_days whose round is finished
--   for good, or on-demand runs. A round's run count limits its runs
--   (round_idea_state), so an open round keeps every run. The daily limit and
--   the lease look back a day at most.

insert into concierge.app_settings (key, value, description) values
  ('action_link_prune_days', '30', 'Days after an emailed button expires before its row is deleted. Until then a late tap is told the link expired or was used.'),
  ('notification_prune_days', '365', 'Days a sent-email record is kept once its round is finished (complete, skipped or delivered) or it has no round. Keep it well above inbound_thread_lookup_days.'),
  ('idea_run_prune_days', '365', 'Days an idea run record is kept once its round is finished (complete, skipped or delivered) or it was an on-demand run. Keep it above any idea limit window (today: one day).')
on conflict (key) do nothing;

-- From 20261116100000_inbound_notes.sql; the three new deletes are marked.
create or replace function concierge.clear_unfiled_inbound()
returns table (message_id uuid, image_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prune_days integer := concierge.setting_int('inbound_prune_days');
  v_link_hours integer := concierge.setting_int('inbound_link_hours');
  v_link_prune_days integer := concierge.setting_int('action_link_prune_days');
  v_notification_prune_days integer := concierge.setting_int('notification_prune_days');
  v_idea_run_prune_days integer := concierge.setting_int('idea_run_prune_days');
begin
  delete from concierge.inbound_seen where created_at < now() - make_interval(days => v_prune_days);
  delete from concierge.inbound_events where created_at < now() - make_interval(days => v_prune_days);

  -- New: spent action links, old notifications and old idea runs.
  delete from concierge.action_links
   where expires_at < now() - make_interval(days => v_link_prune_days);

  delete from concierge.notifications n
   where n.created_at < now() - make_interval(days => v_notification_prune_days)
     and (n.round_id is null
          or exists (select 1 from concierge.gift_rounds r
                      where r.id = n.round_id and r.status in ('complete', 'skipped', 'delivered')));

  delete from concierge.idea_runs u
   where u.started_at < now() - make_interval(days => v_idea_run_prune_days)
     and (u.round_id is null
          or exists (select 1 from concierge.gift_rounds r
                      where r.id = u.round_id and r.status in ('complete', 'skipped', 'delivered')));

  return query
  with due as (
    select m.id
      from concierge.inbound_messages m
     where m.status = 'asking'
       and (m.subject is not null or m.body is not null or m.image_path is not null)
       and not exists (select 1 from concierge.action_links l
                        where l.inbound_message_id = m.id and l.action = 'file_note'
                          and l.expires_at > now())
       and (exists (select 1 from concierge.action_links l
                     where l.inbound_message_id = m.id and l.action = 'file_note')
            or m.created_at < now() - make_interval(hours => v_link_hours))
       for update of m
  ), cleared as (
    update concierge.inbound_messages m
       set subject = null, body = null
      from due
     where m.id = due.id
    returning m.id, m.image_path
  )
  select cleared.id, cleared.image_path from cleared where cleared.image_path is not null;
end;
$$;
