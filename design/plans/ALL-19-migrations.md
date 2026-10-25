# ALL-19 (part 2a): Database schema v1, privacy rules and types

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** migrations for every design §3 table, with row-level security (RLS) so each user sees only their own rows, a server-only `app_settings` table, SQL tests that prove the privacy rules, and generated TypeScript types in `packages/core`.

**Architecture:** Supabase CLI migrations in `supabase/migrations/`. Shared `profiles` and `people` go in `public`, and everything else goes in a new `concierge` schema (T19). Every user-owned row carries `user_id`, and a row that belongs to a parent (an idea in a round) references the parent by `(id, user_id)` together, so a row can never point at another user's data. Tests use pgTAP through `supabase test db`.

**Tech stack:** Postgres 17 (local Supabase in Docker), pgTAP, Supabase CLI 2.122, TypeScript.

**Spec:** `design/technical-design.md` §2.2 and §3, using the §3 table from the W1-2 spike branch (`aarontallen/all-16-zinc-checkout-spike`) for profile, people, idea and order fields; decision T23 (`app_settings`). The choices agreed in chat on 2026-10-25 are listed under Global constraints. **Part 2b** (moving the list tables into a `lists` schema, and display names) waits for the `dev` project (ALL-39).

## Global constraints

- **Migrations only touch `public` and `concierge`.** The list app's tables and functions don't change in 2a.
- **Every user-owned table:** `id uuid primary key default gen_random_uuid()`, `user_id uuid not null default auth.uid() references auth.users on delete cascade`, `created_at` and `updated_at timestamptz not null default now()`, an `updated_at` trigger, RLS enabled, and four policies (select, insert, update, delete) for `authenticated` using `user_id = (select auth.uid())`.
- **Parent links include the owner.** Each parent table gets `unique (id, user_id)`, and children reference it with `foreign key (parent_id, user_id) references parent (id, user_id) on delete cascade`.
- **Money is integer cents** (`integer`, `check (>= 0)`). Dates with no time of day are `date`.
- **Statuses:** `concierge.round_status` is a Postgres enum with the 9 statuses in `ROUND_STATUSES` order (`packages/core/src/rounds.ts`). Every other status or kind is `text` plus a `check (... in (...))`.
- **Money settings stay in `concierge` (D31):** `public.profiles` holds only display name, email, phone and timezone. `concierge.accounts` holds over-budget %, notification preferences, funding mode and Zinc connection. Zinc keys are stored in Supabase Vault, and `accounts` keeps only the secret's id.
- **`concierge.app_settings`:** RLS on with no policies, so only the service role can read it. It's seeded in a migration (not `seed.sql`, so production gets the values): `zinc_order_fee_cents` 100, `planning_delivery_days` 7, `safety_buffer_days` 2, `round_lead_days` 28, `reminder_1_after_heads_up_days` 5, `reminder_2_before_deadline_days` 7, `final_notice_before_deadline_days` 2, `fastest_days_to_arrive` 1.
- **No hard-coded business values (T23)** in app code. Column defaults that come straight from the design (such as `over_budget_pct` 15) are data and can be changed with a migration.
- Before calling the work done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:test` from the repo root.

## Review focus

1. **Cross-user references:** user A inserts an idea whose `round_id` is user B's round. The composite foreign key must reject it. RLS alone doesn't, because foreign key checks ignore RLS.
2. **Anonymous visitors:** the `anon` role (a signed-out visitor using the public API key) must read nothing from any concierge table or from `people`/`profiles`.
3. **Delete a person:** every row about them goes, including rounds, ideas, orders and facts, but not their user's other people.
4. **A repeated round:** the same person, occasion and year can't be inserted twice. The round engine's tick relies on this.
5. **Existing users:** the 3 existing accounts get a `profiles` row from the backfill, and a new sign-up gets one from the trigger.

---

### Task 1: Shared tables, test setup and the profile trigger

**Files:**
- Create: `supabase/migrations/20261025120000_shared_profiles_people.sql`, `supabase/tests/00_helpers.sql` (pgTAP helper functions), `supabase/tests/shared.test.sql`
- Modify: root `package.json` (add `"db:test": "supabase test db"` and `"db:types"`, see Task 5)

**Interfaces:**
- Produces:
  - `public.set_updated_at()`, a trigger function used by every table
  - `public.profiles (id = auth user id, display_name, email, phone, timezone default 'America/New_York')`. RLS: own row only. Created by the trigger `public.handle_new_user()` on `auth.users` insert, and backfilled for existing users. `display_name` comes from `raw_user_meta_data ->> 'display_name'`.
  - `public.people (user_id, name, relationship, birthday date null, recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country default 'US', phone, address_checked_at, notes, google_contact_id, linked_user_id uuid null references auth.users on delete set null)`, with `unique (id, user_id)`
  - Test helpers in `supabase/tests/00_helpers.sql`: `tests.create_user(email text) returns uuid`, `tests.act_as(user_id uuid)` (sets role `authenticated` and the JWT `sub` claim), `tests.act_as_anon()`, `tests.reset_role()`

- [ ] **Step 1:** Write `shared.test.sql`:
  - after `create_user`, a `profiles` row exists for the new user
  - A can insert and read their own person
  - A sees 0 of B's people
  - A's update and delete of B's person affect 0 rows
  - anon sees 0 people and 0 profiles
  - an existing auth user with no profile gets one from the backfill (insert the auth user with the trigger disabled, then run the backfill statement)
- [ ] **Step 2:** Run `pnpm db:test`. It fails because the tables don't exist.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `pnpm supabase db reset && pnpm db:test`. It passes.
- [ ] **Step 5:** Commit: `feat(db): shared profiles and people with RLS (ALL-19)`.

### Task 2: The concierge schema: accounts, occasions, budgets and learning

**Files:**
- Create: `supabase/migrations/20261025120100_concierge_people_data.sql`, `supabase/tests/concierge_people_data.test.sql`
- Modify: `supabase/config.toml` (`[api] schemas` adds `"concierge"`)

**Interfaces:**
- Consumes: Task 1 (`people (id, user_id)`, `set_updated_at`, test helpers).
- Produces: `concierge` schema with `usage` granted to `authenticated` and `service_role` (not `anon`), and tables:
  - `accounts (user_id primary key, over_budget_pct integer default 15 check 0–100, notification_prefs jsonb default '{}', funding_mode text default 'zinc_wallet' check in ('zinc_wallet','connect'), zinc_api_key_secret_id uuid, zinc_webhook_secret_id uuid, zinc_connected_at, auto_topup_on boolean)`
  - `budget_defaults (user_id, relationship, base_amount_cents)`, `unique (user_id, relationship)`
  - `occasions (user_id, person_id null, kind check in the six OccasionKind values, month, day, enabled default true)`. Birthday and anniversary require month and day; holidays require them null. `unique (id, user_id)`.
  - `budgets (user_id, person_id, occasion_kind, amount_cents)`, `unique (person_id, occasion_kind)`
  - `captures (user_id, person_id, source_url, page_title, text_excerpt, screenshot_path, status check in ('pending','extracted','failed'))`
  - `profile_facts (user_id, person_id, category check in ('interest','dislike','size','brand','owns','style','avoid','loved'), value, source check in ('capture','question','note','reaction','rejection','inbound'), source_id uuid null, confirmed boolean default false, active boolean default true)`
  - `questions (user_id, person_id, prompt, answer null, status check in ('open','answered','dismissed'))`
  - Every `person_id` uses `foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade`.

- [ ] **Step 1:** Write `concierge_people_data.test.sql`:
  - for each table: A reads their own rows and none of B's, and anon reads none (anon gets a permission error on the schema; assert `throws_ok`)
  - A can't insert a `budgets` row pointing at B's person (foreign key violation `23503`)
  - a birthday occasion without month and day is rejected (check violation `23514`)
  - deleting A's person removes their occasions, budgets, captures, facts and questions, and A's other person keeps theirs
- [ ] **Step 2:** Run `pnpm db:test`. It fails.
- [ ] **Step 3:** Write the migration and expose the schema in `config.toml`.
- [ ] **Step 4:** Run `pnpm supabase db reset && pnpm db:test`. It passes.
- [ ] **Step 5:** Commit: `feat(db): concierge schema for accounts, occasions, budgets and learning (ALL-19)`.

### Task 3: Rounds, ideas, orders and messages

**Files:**
- Create: `supabase/migrations/20261025120200_concierge_rounds_orders.sql`, `supabase/tests/concierge_rounds_orders.test.sql`

**Interfaces:**
- Consumes: Task 2 (`occasions (id, user_id)`) and Task 1 (`people`).
- Produces:
  - `type concierge.round_status as enum` with the 9 statuses
  - `gift_rounds (user_id, person_id, occasion_id, occasion_year integer, occasion_date date, ship_by_deadline date, budget_cents, status round_status default 'scheduled', late boolean default false, next_action_at timestamptz, locked_until timestamptz null, attempts integer default 0, approved_at null)`, with `unique (person_id, occasion_id, occasion_year)`, `unique (id, user_id)`, and an index on `next_action_at` where the status isn't final
  - `gift_ideas`: the spike's §3 fields (product_url, retailer_product_id, offer_id, seller_name, first_party, price/shipping/tax/total cents, handling_days_max, delivery_days_min, delivery_days_max, arrive_by date, reason, over_budget, rank, status check in ('proposed','selected','rejected')), with `unique (id, user_id)`
  - `rejections (round_id, idea_id null, reason_code, reason_text)`
  - `orders`: the spike's §3 fields (provider default 'zinc', provider_order_id, `idempotency_key uuid not null unique default gen_random_uuid()`, funding_mode, max_price_cents, is_gift default true, gift_message check ≤ 240 characters, subtotal/shipping/tax/total cents, fee_cents, status check in the 7 statuses, failure_type, merchant_order_id, packages jsonb default '[]', est_delivery_date)
  - `reactions (round_id, rating check in ('loved','liked','meh','returned'), note, source check in ('email','web'))`
  - `notifications (user_id, round_id null, kind, channel default 'email', sent_at, action_token_hash unique null)`
  - `inbound_messages (user_id, from_address, subject, body, attachments jsonb, matched_person_id null, status)`: placeholders until W1-4, with status as plain text and no check yet
  - Every round child references `(round_id, user_id)` on gift_rounds and cascades. `orders.idea_id` references `(idea_id, user_id)` on gift_ideas.

- [ ] **Step 1:** Write `concierge_rounds_orders.test.sql`:
  - A reads none of B's rounds, ideas or orders, and anon is refused
  - a second round for the same person, occasion and year fails with `23505`
  - A inserting an idea on B's round fails with `23503` (review focus 1)
  - `status` rejects a value outside the enum
  - deleting A's person removes their rounds, ideas, orders and reactions
  - `gift_message` over 240 characters is rejected
- [ ] **Step 2:** Run `pnpm db:test`. It fails.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `pnpm supabase db reset && pnpm db:test`. It passes, and a test confirms the enum values equal `ROUND_STATUSES` in order.
- [ ] **Step 5:** Commit: `feat(db): rounds, ideas, orders and messages (ALL-19)`.

### Task 4: App settings

**Files:**
- Create: `supabase/migrations/20261025120300_concierge_app_settings.sql`, `supabase/tests/app_settings.test.sql`

**Interfaces:**
- Produces: `concierge.app_settings (key text primary key, value jsonb not null, description text, updated_at)`, seeded with the 8 values in Global constraints. Only `service_role` has privileges on it.

- [ ] **Step 1:** Write `app_settings.test.sql`:
  - `authenticated` reading `app_settings` gets 0 rows or a permission error, and anon is refused
  - as `service_role`, `zinc_order_fee_cents` is `100` and all 8 keys exist
- [ ] **Step 2:** Run `pnpm db:test`. It fails.
- [ ] **Step 3:** Write the migration (`insert ... on conflict (key) do nothing`, so re-running never overwrites a changed value).
- [ ] **Step 4:** Run `pnpm supabase db reset && pnpm db:test`. It passes.
- [ ] **Step 5:** Commit: `feat(db): app settings for fees and schedule timings (ALL-19, T23)`.

### Task 5: Generated types, CI, docs and PR

**Files:**
- Create: `packages/core/src/database.types.ts` (generated)
- Modify: root `package.json` (`"db:types": "supabase gen types typescript --local --schema public --schema concierge > packages/core/src/database.types.ts"`); `packages/core/src/index.ts` (`export type { Database } from "./database.types"`); `packages/core/vitest.config.ts` (exclude `database.types.ts` from coverage); `.github/workflows/ci.yml` (a `db` job: checkout, pnpm install, `pnpm supabase db start`, `pnpm db:test`); `README.md` (Local development: `pnpm db:test`, `pnpm db:types`); `design/technical-design.md` §3 (`accounts`, `user_id` on child tables, composite keys); `design/decisions.md` (T24: money settings in `concierge.accounts`, and owner-checked parent links)

- [ ] **Step 1:** Run `pnpm db:types`, then `pnpm typecheck`. Both pass, and the file contains `concierge` and `round_status`.
- [ ] **Step 2:** Add the CI job, then the docs and decision.
- [ ] **Step 3:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:test`. Everything passes.
- [ ] **Step 4:** Commit, push, and open the PR `feat(db): schema v1 with privacy rules and app settings (ALL-19)` with "Part of ALL-19". After CI passes, the final review runs.
