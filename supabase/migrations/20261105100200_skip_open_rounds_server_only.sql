-- Only the server can call concierge.skip_open_rounds directly (ALL-28 ruling 15).
-- It is security definer and doesn't check who owns the person or occasion, so
-- it must never be reachable through the API. The schema's default privileges
-- (20261025120100) already keep it from public; this says so on the function
-- itself and lets the server call it.
-- The triggers that use it (deleting a person or an occasion, switching an
-- occasion off) are security definer functions owned by postgres, so they still work.

revoke execute on function concierge.skip_open_rounds(uuid, uuid) from public, anon, authenticated;
grant execute on function concierge.skip_open_rounds(uuid, uuid) to service_role;
