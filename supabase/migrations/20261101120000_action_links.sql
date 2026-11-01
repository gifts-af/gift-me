-- One-time email action links (ALL-23). The emailed button carries a signed
-- token; only its hash is stored here, so a leaked table can't be replayed.
-- Server-only: RLS on, no policies, no grants for signed-in users.

create table concierge.action_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  round_id uuid,
  notification_id uuid references concierge.notifications (id) on delete set null,
  action text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (round_id, user_id) references concierge.gift_rounds (id, user_id) on delete cascade
);

create trigger set_updated_at before update on concierge.action_links
  for each row execute function public.set_updated_at();

alter table concierge.action_links enable row level security;
revoke all on concierge.action_links from public, anon, authenticated;
grant all on concierge.action_links to service_role;

-- The token now lives on action_links; notifications records delivery instead.
alter table concierge.notifications
  drop column action_token_hash,
  add column provider_message_id text,
  add column error text;

insert into concierge.app_settings (key, value, description) values
  ('test_action_link_hours', '24', 'Hours the Settings test email''s button keeps working.')
on conflict (key) do nothing;
