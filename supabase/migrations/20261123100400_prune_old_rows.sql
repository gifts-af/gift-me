-- Spent emailed buttons get cleaned up. The daily tick calls
-- prune_expired_action_links on its own, so a failed prune never undoes or
-- blocks the privacy clear-out (clear_unfiled_inbound), and the other way round.
--
-- Only links whose expires_at passed more than action_link_prune_days ago go.
-- Until then a late tap still finds the link and is told it expired or was used.
-- A setting that is missing, null or 0 or below turns the prune off (E7, T23).
--
-- clear_unfiled_inbound still works once a message's file_note links are gone:
-- with no live button left, a message older than inbound_link_hours counts as
-- due, and every such message was cleared long before its links were pruned.
--
-- Notifications and idea runs are kept: they hold no personal data, and they
-- are the record of what buyers were told and what the AI cost.

insert into concierge.app_settings (key, value, description) values
  ('action_link_prune_days', '30', 'Days after an emailed button expires before the daily tick deletes its row. Until then a late tap is told the link expired or was used. Null or 0 or below turns the prune off.')
on conflict (key) do nothing;

-- Returns how many links it deleted, for the tick's log line.
create function concierge.prune_expired_action_links()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := concierge.setting_int('action_link_prune_days');
  v_deleted integer;
begin
  if v_days is null or v_days <= 0 then
    return 0;
  end if;

  delete from concierge.action_links
   where expires_at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function concierge.prune_expired_action_links() from public, anon, authenticated;
grant execute on function concierge.prune_expired_action_links() to service_role;
