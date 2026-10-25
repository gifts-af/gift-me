-- App-wide settings that change without a deploy (T23): the checkout fee and
-- the round schedule timings (design §4.1, §4.2). Only the server (service
-- role) reads them; it passes them into packages/core. Users never see them.

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
  ('planning_delivery_days', '7', 'Days to arrive assumed before any idea exists.'),
  ('safety_buffer_days', '2', 'Days of margin between the slowest arrival and the occasion.'),
  ('round_lead_days', '28', 'How many days before the planning deadline a round starts.'),
  ('reminder_1_after_heads_up_days', '5', 'Days after the heads-up that reminder 1 goes out.'),
  ('reminder_2_before_deadline_days', '7', 'Days before the deadline that reminder 2 goes out.'),
  ('final_notice_before_deadline_days', '2', 'Days before the deadline that the final notice goes out.'),
  ('fastest_days_to_arrive', '1', 'The fastest shipping a late round still hopes to find.')
on conflict (key) do nothing;
