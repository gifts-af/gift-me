-- Switching an occasion off stops its open round (ALL-28), the same way
-- deleting it does: the round is skipped with no email, and the engine has
-- nothing left to do for it. Done here so every writer gets it.
-- Switching it back on doesn't bring the round back; next year's starts as usual.

create function concierge.handle_occasion_disabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform concierge.skip_open_rounds(null, new.id);
  return new;
end;
$$;

create trigger on_occasion_disabled after update of enabled on concierge.occasions
  for each row when (old.enabled and not new.enabled)
  execute function concierge.handle_occasion_disabled();
