-- Schema hygiene: a missing updated_at trigger, a unique Zinc order id, and
-- indexes behind every foreign key and every user_id.

-- lists.lists has updated_at but only the save functions kept it current; any
-- other update (a share-token change, a rename by the server) left it stale.
-- updated_at is also the list's version for stale-save checks, and the save
-- functions set it to clock_timestamp() so two saves in one transaction get
-- different versions. An update that sets updated_at itself keeps its value.
create trigger set_updated_at before update on lists.lists
  for each row when (new.updated_at is not distinct from old.updated_at)
  execute function public.set_updated_at();

-- A provider's order id names one order in that account. The Zinc webhook finds
-- our row by user_id and the provider's order id, so two rows holding the same
-- id would make it update the wrong one. Each account orders through its own
-- Zinc key, so the id is unique per account rather than across all of them.
-- The column order matches the webhook's lookup.
create unique index orders_provider_order_key
  on concierge.orders (user_id, provider_order_id, provider)
  where provider_order_id is not null;

-- Foreign keys without an index make every delete of the parent row scan the
-- child table, and deleting an account cascades through all of them. user_id
-- also backs every RLS check. Where an index already leads with the key's
-- first column (person_id, round_id, ...) it covers the key, so none is added.
create index on concierge.action_links (notification_id);
create index on concierge.action_links (person_id);
create index on concierge.action_links (round_id);
create index on concierge.action_links (user_id);

create index on concierge.budgets (user_id);

create index on concierge.captures (user_id);

create index on concierge.gift_ideas (person_id);
create index on concierge.gift_ideas (user_id);

create index on concierge.gift_rounds (occasion_id);
create index on concierge.gift_rounds (user_id);

create index on concierge.idea_runs (user_id);

create index on concierge.inbound_messages (capture_id);
create index on concierge.inbound_messages (matched_person_id);
create index on concierge.inbound_messages (user_id);

create index on concierge.notifications (person_id);
create index on concierge.notifications (round_id);
create index on concierge.notifications (user_id);

create index on concierge.occasions (user_id);

create index on concierge.order_addresses (user_id);

create index on concierge.orders (idea_id);
create index on concierge.orders (user_id);

create index on concierge.profile_facts (user_id);

create index on concierge.questions (user_id);

create index on concierge.reactions (round_id);
create index on concierge.reactions (user_id);

create index on concierge.rejections (idea_id);
create index on concierge.rejections (round_id);
create index on concierge.rejections (user_id);

create index on concierge.round_sends (user_id);

create index on concierge.saved_gifts (user_id);

create index on lists.gift_claims (claimer_id);

create index on public.people (linked_user_id);
