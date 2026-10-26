-- The concierge's own schema (design §2.2, T19): only the concierge reads or
-- writes it. This migration adds the per-user account and everything the
-- concierge knows about the people a user buys for.

create schema concierge;

-- Signed-in users reach it through the API under RLS; signed-out visitors
-- (anon) can't reach it at all.
grant usage on schema concierge to authenticated, service_role;
alter default privileges in schema concierge
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema concierge
  grant all on tables to service_role;
-- Postgres lets everyone run a new function by default. Here a function must
-- be granted on purpose, so a server-only one (like the round engine's) is
-- never reachable through the API by accident. Postgres can only take this
-- default away for all schemas at once; `public` keeps working because
-- Supabase grants its functions to anon and authenticated separately, and
-- the list app's functions grant themselves explicitly.
alter default privileges for role postgres
  revoke execute on functions from public;

-- ─── app_settings ───────────────────────────────────────────────────────────
-- App-wide settings that change without a deploy (T23): fees, limits,
-- defaults and the round schedule timings (design §4.1, §4.2). Only the
-- server (service role) reads them and passes them into packages/core.

create table concierge.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on concierge.app_settings
  for each row execute function public.set_updated_at();

-- RLS on with no policies, and no grants beyond the service role: signed-in
-- users and visitors can't read or change these.
alter table concierge.app_settings enable row level security;
revoke all on concierge.app_settings from public, anon, authenticated;
grant all on concierge.app_settings to service_role;

-- Starting values. `do nothing` on conflict, so re-running a migration never
-- overwrites a value someone has since changed.
insert into concierge.app_settings (key, value, description) values
  ('zinc_order_fee_cents', '100', 'Zinc''s fee per order, in cents. Not included in an order''s max_price.'),
  ('zinc_gift_message_max_chars', '240', 'Longest gift message Zinc accepts.'),
  ('default_over_budget_pct', '15', 'Over-budget percent a new account starts with.'),
  ('planning_delivery_days', '7', 'Days to arrive assumed before any idea exists.'),
  ('safety_buffer_days', '2', 'Days of margin between the slowest arrival and the occasion.'),
  ('round_lead_days', '28', 'How many days before the planning deadline a round starts.'),
  ('reminder_1_after_heads_up_days', '5', 'Days after the heads-up that reminder 1 goes out.'),
  ('reminder_2_before_deadline_days', '7', 'Days before the deadline that reminder 2 goes out.'),
  ('final_notice_before_deadline_days', '2', 'Days before the deadline that the final notice goes out.'),
  ('fastest_days_to_arrive', '1', 'The fastest shipping a late round still hopes to find.')
on conflict (key) do nothing;

-- A whole-number setting, for column defaults. Runs as its owner so a user's
-- insert can take a default without reading the settings table themselves.
create function concierge.setting_int(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (value #>> '{}')::integer from concierge.app_settings where key = p_key;
$$;

grant execute on function concierge.setting_int(text) to authenticated, service_role;

-- Every user-owned table gets the same four policies: a user sees and changes
-- only rows whose user_id is theirs.
create function concierge.enable_owner_rls(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy "Owner can read" on %s for select to authenticated using (user_id = (select auth.uid()))', p_table);
  execute format('create policy "Owner can add" on %s for insert to authenticated with check (user_id = (select auth.uid()))', p_table);
  execute format('create policy "Owner can update" on %s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', p_table);
  execute format('create policy "Owner can delete" on %s for delete to authenticated using (user_id = (select auth.uid()))', p_table);
  execute format('create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()', p_table);
end;
$$;

revoke execute on function concierge.enable_owner_rls(regclass) from public, authenticated;

-- ─── accounts ───────────────────────────────────────────────────────────────
-- The user's concierge settings and Zinc connection. Kept out of the shared
-- profiles table so money details stay inside the concierge (D31). Zinc keys
-- live in Supabase Vault; only their secret ids are stored here (§6.5a, T16).

create table concierge.accounts (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  over_budget_pct integer not null default concierge.setting_int('default_over_budget_pct')
    check (over_budget_pct between 0 and 100),
  notification_prefs jsonb not null default '{}'::jsonb,
  funding_mode text not null default 'zinc_wallet' check (funding_mode in ('zinc_wallet', 'connect')),
  zinc_api_key_secret_id uuid,
  zinc_webhook_secret_id uuid,
  zinc_connected_at timestamptz,
  auto_topup_on boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select concierge.enable_owner_rls('concierge.accounts');
-- Users create their account and change their own preferences. The funding
-- mode and Zinc connection are set only by the server, so nobody can point
-- their account at a key stored for someone else.
revoke insert, update on concierge.accounts from authenticated;
grant insert (user_id, over_budget_pct, notification_prefs) on concierge.accounts to authenticated;
grant update (over_budget_pct, notification_prefs) on concierge.accounts to authenticated;

-- ─── budgets ────────────────────────────────────────────────────────────────

-- Default budget per relationship (B-2), e.g. parents $100.
create table concierge.budget_defaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  relationship text not null,
  base_amount_cents integer not null check (base_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, relationship)
);
select concierge.enable_owner_rls('concierge.budget_defaults');

-- ─── occasions ──────────────────────────────────────────────────────────────
-- Kinds match OccasionKind in packages/core/src/occasions.ts. Birthdays and
-- anniversaries store their month and day; holiday dates come from the rule.

create table concierge.occasions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid,
  kind text not null check (kind in ('birthday', 'anniversary', 'christmas', 'valentines_day', 'mothers_day', 'fathers_day')),
  month integer check (month between 1 and 12),
  day integer check (day between 1 and 31),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade,
  constraint occasions_date_matches_kind check (
    case when kind in ('birthday', 'anniversary')
      then month is not null and day is not null
      else month is null and day is null
    end
  )
);
create index occasions_person_id_idx on concierge.occasions (person_id);
select concierge.enable_owner_rls('concierge.occasions');

-- A person's budget for one kind of occasion, overriding the default (B-1).
create table concierge.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  occasion_kind text not null,
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, occasion_kind),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade
);
select concierge.enable_owner_rls('concierge.budgets');

-- ─── learning about a person (§3.1) ─────────────────────────────────────────

-- Layer 1: a page captured with the extension (C-1, C-2).
create table concierge.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  source_url text,
  page_title text,
  text_excerpt text,
  screenshot_path text,
  status text not null default 'pending' check (status in ('pending', 'extracted', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade
);
create index captures_person_id_idx on concierge.captures (person_id);
select concierge.enable_owner_rls('concierge.captures');

-- Layer 2: what the app knows. A person's profile is their active facts.
create table concierge.profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  category text not null check (category in ('interest', 'dislike', 'size', 'brand', 'owns', 'style', 'avoid', 'loved')),
  value text not null check (char_length(value) between 1 and 500),
  source text not null check (source in ('capture', 'question', 'note', 'reaction', 'rejection', 'inbound')),
  -- The input the fact came from (a capture, question, reaction, …).
  source_id uuid,
  confirmed boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade
);
create index profile_facts_person_id_idx on concierge.profile_facts (person_id) where active;
select concierge.enable_owner_rls('concierge.profile_facts');

-- Guided questions about a person (C-4).
create table concierge.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id uuid not null,
  prompt text not null,
  answer text,
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade
);
select concierge.enable_owner_rls('concierge.questions');
