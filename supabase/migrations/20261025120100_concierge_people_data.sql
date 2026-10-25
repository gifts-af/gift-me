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
  over_budget_pct integer not null default 15 check (over_budget_pct between 0 and 100),
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
