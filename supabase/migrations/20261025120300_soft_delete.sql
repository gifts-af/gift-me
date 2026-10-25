-- Soft deletes for people and occasions, and an admin hard delete (T26).
--
-- Deleting a person or occasion in the app marks it deleted instead of
-- removing it, so gift and order history survive. Open rounds for it are
-- skipped at once, so nothing is ever bought for someone who was deleted.
-- Removing data for real (for example a GDPR erasure request) is an admin
-- action: admin.hard_delete_person and admin.hard_delete_account, which
-- only the server can run, and which log what they did.

-- ─── people ─────────────────────────────────────────────────────────────────

alter table public.people add column deleted_at timestamptz;

drop policy "Users can read their people" on public.people;
create policy "Users can read their people" on public.people
  for select to authenticated using (user_id = (select auth.uid()) and deleted_at is null);

drop policy "Users can update their people" on public.people;
create policy "Users can update their people" on public.people
  for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

-- Users never hard-delete a person; they call delete_person.
drop policy "Users can delete their people" on public.people;
revoke delete on public.people from authenticated;

create function public.delete_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.people
     set deleted_at = now()
   where id = p_person_id
     and user_id = auth.uid()
     and deleted_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.delete_person(uuid) from public, anon;
grant execute on function public.delete_person(uuid) to authenticated;

-- ─── occasions ──────────────────────────────────────────────────────────────

alter table concierge.occasions add column deleted_at timestamptz;

alter policy "Owner can read" on concierge.occasions
  using (user_id = (select auth.uid()) and deleted_at is null);
alter policy "Owner can update" on concierge.occasions
  using (user_id = (select auth.uid()) and deleted_at is null);

drop policy "Owner can delete" on concierge.occasions;
revoke delete on concierge.occasions from authenticated;

create function concierge.delete_occasion(p_occasion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update concierge.occasions
     set deleted_at = now()
   where id = p_occasion_id
     and user_id = auth.uid()
     and deleted_at is null;
  if not found then
    raise exception 'Occasion not found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function concierge.delete_occasion(uuid) to authenticated;

-- ─── stop rounds for deleted people and occasions ───────────────────────────
-- Statuses where nothing has been bought yet. Ordered and delivered rounds
-- are left alone: the gift is already on its way.

create function concierge.skip_open_rounds(p_person_id uuid, p_occasion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update concierge.gift_rounds
     set status = 'skipped', next_action_at = null, locked_until = null
   where (person_id = p_person_id or occasion_id = p_occasion_id)
     and status in ('scheduled', 'generating', 'awaiting_approval', 'needs_address', 'needs_attention');
$$;

create function concierge.handle_person_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update concierge.occasions set deleted_at = new.deleted_at
   where person_id = new.id and deleted_at is null;
  perform concierge.skip_open_rounds(new.id, null);
  return new;
end;
$$;

create trigger on_person_deleted after update of deleted_at on public.people
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function concierge.handle_person_deleted();

create function concierge.handle_occasion_deleted()
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

create trigger on_occasion_deleted after update of deleted_at on concierge.occasions
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function concierge.handle_occasion_deleted();

-- A last guard for the round engine: no new round for a deleted person or occasion.
create function concierge.check_round_target_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.people where id = new.person_id and deleted_at is not null)
     or exists (select 1 from concierge.occasions where id = new.occasion_id and deleted_at is not null) then
    raise exception 'Cannot start a round for a deleted person or occasion';
  end if;
  return new;
end;
$$;

create trigger check_round_target_active before insert on concierge.gift_rounds
  for each row execute function concierge.check_round_target_active();

-- ─── admin: hard delete ─────────────────────────────────────────────────────
-- A private schema that the API never exposes. Only the server (service role)
-- can use it. An admin screen comes with the privacy pass (ALL-37).

create schema admin;
revoke all on schema admin from public;
grant usage on schema admin to service_role;

-- What was removed, when, by whom and why: ids only, never the deleted data.
create table admin.deletion_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'account')),
  target_id uuid not null,
  user_id uuid not null,
  requested_by text not null,
  reason text not null,
  deleted_at timestamptz not null default now()
);
grant select, insert on admin.deletion_log to service_role;

-- Removes a person and everything about them, including order history.
-- Capture screenshots in Storage must be removed by the server as well.
create function admin.hard_delete_person(p_person_id uuid, p_requested_by text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  delete from public.people where id = p_person_id returning user_id into v_user_id;
  if v_user_id is null then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  insert into admin.deletion_log (kind, target_id, user_id, requested_by, reason)
  values ('person', p_person_id, v_user_id, p_requested_by, p_reason);
end;
$$;

-- Removes an account and everything it owns, across every product.
create function admin.hard_delete_account(p_user_id uuid, p_requested_by text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  insert into admin.deletion_log (kind, target_id, user_id, requested_by, reason)
  values ('account', p_user_id, p_user_id, p_requested_by, p_reason);
end;
$$;

grant execute on function admin.hard_delete_person(uuid, text, text) to service_role;
grant execute on function admin.hard_delete_account(uuid, text, text) to service_role;
