# ALL-44 Schema v1.1: optional budgets, ship-to addresses, picks from a person's own list: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bring schema v1 (ALL-19) in line with product decisions 36–39 before the screens that use them are built (ALL-21, ALL-27, ALL-29, ALL-30).

**Architecture:** four Supabase migrations, each with its own pgTAP test file, plus a small change to `packages/core/src/budget.ts`. Shared account data (your own address) lives in `public`. The link between a buyer's person and someone's list lives in `lists`, so the concierge reads a list only through `lists` functions (T19). Order destinations live in `concierge`.

**Tech stack:** Postgres 17 (local Supabase), pgTAP (`pnpm db:test`), TypeScript and Vitest (`packages/core`).

**Spec:** the [ALL-44 ticket](https://linear.app/allens-forever/issue/ALL-44) and its comment, `planning/decisions.md` #36–42, design §2.2, §3 and §4.2, and the signed-off mock-ups [approval](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#approval) ("Mom: pick from her list") and [ship-to](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ship-to) ("Where it goes").

**Already done, not redone:** list owners never see claims (decision 39). That shipped in ALL-20 as `20261028120000_hide_claims_from_owner.sql`, tested in `supabase/tests/lists.test.sql` and applied to `dev` and `prod`. This ticket's "a list owner can't see claims" check reuses those tests, and Task 3 adds one more: the new picks function never shows claims to the list's owner either.

## What was decided, and why

### The owner's answers (2026-10-28)

| Question | Answer | What it means for the schema |
|---|---|---|
| Where does a list owner's shared address live? | **One "my address" table for every product** (product decision 41) | `public.account_addresses`, one row per account, readable only by its owner. It holds both Mom's shared address and the buyer's own "My address". Nothing is added to `concierge.accounts`. This narrows D31: your *own* address is account data, like your email and phone. Addresses you enter for other people stay private to you. |
| Does linking Mom's account to a buyer's "Mom" need her consent? | **No. A buyer holding her share link can link right away** (product decision 42) | `lists.link_person(share_token, person_id)` links at once. There's no request table and no accept step. |

### Claude's rulings

Every row below is **[Claude's call]**.

| Question | Ruling | Why |
|---|---|---|
| Who can ship to Mom's shared address? | Mom turns sharing on (`account_addresses.share_for_gifts`, off by default). Then **anyone who has linked through her share link** sees her city and state and can ship to her. Nobody but Mom ever sees the street address | With instant linking, per-buyer approval would be consent by another name, which the owner declined. This is how Amazon wish lists work. Decision 38 says the buyer sees "only the city", and the mock-up shows "Dayton, OH", so the state shows too. The state reveals less than the city does. |
| Which list do picks come from? | **The list the buyer linked through.** `lists.person_links` records it | One account can own several lists. Showing items from a list Mom never shared with this buyer would leak it. |
| `people.linked_user_id` | Kept (T19), and set and cleared together with `person_links` by the link functions | Home and the person page need a quick "keeps a list" check without calling `lists`. |
| Linking to yourself, or to someone else's person | Refused | Neither makes sense, and the second would let you read someone else's picks. |
| What the buyer sees of a claimed gift | `claimed` and `claimed_by_me` only. No claimer name | The mock-up says "Someone already claimed this". A name isn't needed. |
| "No budget" in `concierge.budgets` | `amount_cents` becomes nullable. A row with `null` means "no budget for this person and occasion, even if the relationship has a default". No row means "use the default if there is one". `budget_defaults` stays not-null: no row means no default | Lets "Mom has no budget" sit beside "parents default $100". |
| Budget math with no budget (`budgetCents = null`) | Every total is `"within"`; nothing is over budget. The approval ceiling is **the sum of the picks' estimated totals**, so each order's `max_price` is its own estimated total minus the fee | The ticket says no `max_price` comes from a budget, but every order still needs a cap (B-5). The ship-to mock-up says "When the price rises above what was approved, nothing is bought", so the approved total is that cap. |
| Where the full ship-to snapshot goes | `concierge.order_addresses`, which only the server reads. `orders` keeps `ship_to`, `ship_city` and `ship_state`, which the buyer can read | Buyers can read their own orders, so a full snapshot on `orders` would leak Mom's street address through the order the buyer placed. |
| Saving a one-off "other" address to the person | No schema change. The app writes it into the person's address fields, which the user already owns | Already supported by `public.people`. |
| Ideas that come from a list | `gift_ideas.source` (`generated` or `list`) plus `list_item_id`, a plain uuid with no foreign key into `lists` | No cross-product foreign keys, so a product can still be split out (T19). |
| Claiming a list gift when it's ordered | **Not in this ticket.** ALL-30 adds a `lists` function to claim the item when the order is placed | It belongs with ordering, and nothing calls it before then. |
| Who calls `lists.person_list` | Signed-in buyers (for their own people) and the server (the idea engine). Signed-out visitors can't | ALL-27 builds rounds from the list on the server. |

## Global constraints

- Migrations follow ALL-19's patterns: `user_id` on every concierge row, parent links by `(id, user_id)`, `set search_path = ''` on every function, functions granted on purpose (T26 point 7), and `updated_at` triggers.
- The concierge never reads `lists` tables. It calls `lists.person_list` instead (T19).
- No hard-coded business values (T23).
- Before the PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:test`, and `pnpm db:types` leaves no diff.

## Review focus

1. **A forwarded share link.** A stranger who links sees city and state only, never the street, and only once Mom has turned sharing on. *Test:* Task 2 and Task 3, buyer reads with sharing off and on.
2. **A buyer reading the street address another way:** through `orders` or `order_addresses`, `account_addresses`, `person_links` or the server-only function. *Tests:* Tasks 2 and 4 assert 0 rows or `42501` for `authenticated`.
3. **A deleted person.** A soft-deleted person can't be linked, and returns no picks or city. *Test:* Task 3.
4. **Mom deletes her list or her account.** Picks come back empty (null), and nothing errors. *Test:* Task 3 deletes the list and calls `person_list`.
5. **A round with no budget at approval.** One or several picks are accepted, and `max_price` is never above the pick's own estimated total. *Test:* Task 1 core tests.

---

### Task 1: Optional budgets

**Files:**
- Create: `supabase/migrations/20261028130000_optional_budgets.sql`, `supabase/tests/optional_budgets.test.sql`
- Modify: `packages/core/src/budget.ts`, `packages/core/src/budget.test.ts`

**Produces:** `classifyTotal(totalCents, budgetCents: number | null, overBudgetPct)` and `approvalCeilingCents(selectedTotalsCents, budgetCents: number | null, overBudgetPct, overBudgetConfirmed)`. `gift_rounds.budget_cents` and `budgets.amount_cents` become nullable.

- [ ] Core tests (new `describe("no budget")`): `classifyTotal(1_000_000, null, 15)` is `"within"`; `approvalCeilingCents([4200, 6800], null, 15, false)` is `11000`; `approvalCeilingCents([], null, 15, false)` is `null`; with that ceiling, `maxPriceCents({ ceilingCents: 11000, committedCents: 0, reservedCents: 6800, feeCents: 100 })` is `4100`.
- [ ] pgTAP: a round inserts with `budget_cents null`; a `budgets` row inserts with `amount_cents null`; a negative amount is still refused (`23514`); `budget_defaults.base_amount_cents` is still not null.
- [ ] Run both and see them fail. Implement: `alter column … drop not null`, with comments saying null means no budget. Run both and see them pass.
- [ ] Commit `feat(db): optional budgets (ALL-44)`.

### Task 2: Your own address, and sharing it with gift givers

**Files:**
- Create: `supabase/migrations/20261028130100_account_addresses.sql`, `supabase/tests/account_addresses.test.sql`

**Produces:**
- `public.account_addresses (user_id pk default auth.uid() → auth.users on delete cascade, recipient_first_name, recipient_last_name, address_line1, address_line2 null, city, state, zip, country default 'US', phone null, address_checked_at null, share_for_gifts boolean not null default false, created_at, updated_at)`. Name, line 1, city, state and zip are not null. RLS: the owner selects, inserts, updates and deletes their own row. Nothing for `anon`.
- `public.shared_city_for_person(p_person_id uuid) returns jsonb`: `{ "city", "state" }`, or `null` when the person isn't linked, the linked account has no address, or sharing is off. Raises `P0002` unless the person is the caller's and not deleted. Granted to `authenticated` only.
- `public.shared_address_for_person(p_person_id uuid) returns jsonb`: every address field, for placing an order. Same share rule. Granted to `service_role` only.

- [ ] pgTAP: Mom saves, reads and updates her row; the buyer reads 0 rows of hers; anon reads none. The buyer's person is linked to Mom (set `linked_user_id` as `postgres`). With sharing off, the city is `null`; once Mom turns it on, it's `{"city":"Dayton","state":"OH"}`. Another user calling with the buyer's person gets `P0002`. `authenticated` calling `shared_address_for_person` gets `42501`; `service_role` gets the full address.
- [ ] Fail, implement, pass. Commit `feat(db): own address with opt-in sharing for gifts (ALL-44)`.

### Task 3: Linking a person to their list, and picks from it

**Files:**
- Create: `supabase/migrations/20261028130200_person_links.sql`, `supabase/tests/person_links.test.sql`

**Produces:**
- `lists.person_links (person_id pk, buyer_id, list_id → lists.lists on delete cascade, created_at)`, with `(person_id, buyer_id) → public.people (id, user_id) on delete cascade`. RLS on, no policies, and no grants to `anon` or `authenticated`: it's reached only through the functions below.
- `lists.link_person(p_token uuid, p_person_id uuid) returns void`: `42501` when signed out; `P0002` "Person not found" unless the person is the caller's and not deleted; `P0002` "List not found" for an unknown token; `22023` when the caller owns the list. It upserts the link and sets `people.linked_user_id` to the list's owner. Granted to `authenticated`.
- `lists.unlink_person(p_person_id uuid) returns boolean`: same person check; removes the link and clears `linked_user_id`. Granted to `authenticated`.
- `lists.person_list(p_person_id uuid) returns jsonb`: `{ "title", "items": [{ id, name, price_cents, image_url, product_url, asin, source, added_at, claimed, claimed_by_me }] }` in list order, or `null` when the person isn't linked or the list is gone. A signed-in caller must own the person (`P0002` otherwise); with no `auth.uid()` the caller is the server. Granted to `authenticated` and `service_role`.

- [ ] pgTAP: Mom saves a list with 3 gifts, and a friend claims one. The buyer links "Mom" with the token. `linked_user_id` is now Mom; the picks have 3 items, exactly one `claimed`, and `claimed_by_me` false. A third user calling `person_list` on the buyer's person gets `P0002`. Mom linking her own person to her own list gets `22023`. Anon can't run `link_person` (`42501`). Unknown token: `P0002`. The buyer selecting from `lists.person_links` gets `42501`. Mom reading her own list through the share link still gets `claim: null` everywhere (decision 39, reuses ALL-20's rule). Once Mom deletes her list, `person_list` is `null`. After `unlink_person`, `linked_user_id` is null. A soft-deleted person can't be linked (`P0002`). With the server role and no user, `person_list` returns the items.
- [ ] Fail, implement, pass. Commit `feat(db): link a person to their list and read picks from it (ALL-44)`.

### Task 4: Where an order ships, and ideas from a list

**Files:**
- Create: `supabase/migrations/20261028130300_order_destinations.sql`, `supabase/tests/order_destinations.test.sql`

**Produces:**
- `concierge.orders` gains `ship_to text not null check (ship_to in ('recipient', 'buyer', 'other'))`, `ship_city text not null` and `ship_state text not null`, plus `unique (id, user_id)`.
- `concierge.order_addresses (order_id pk, user_id, recipient_first_name, recipient_last_name, address_line1, address_line2 null, city, state, zip, country, phone null, created_at, updated_at)`, with `(order_id, user_id) → orders (id, user_id) on delete cascade`. RLS on, no grants to `authenticated`: only the server reads or writes it.
- `concierge.gift_ideas` gains `source text not null default 'generated' check (source in ('generated', 'list'))` and `list_item_id uuid` (no foreign key), with a check that `list_item_id` is set exactly when `source = 'list'`.

- [ ] pgTAP: as the server, insert an order with `ship_to 'recipient'` and its address. The buyer reads the order's `ship_to`, `ship_city` and `ship_state`, and gets `42501` selecting `order_addresses`. `ship_to 'friend'` is refused (`23514`). An idea with `source 'list'` and no `list_item_id` is refused (`23514`). Another user can't attach an address to the buyer's order (`23503`).
- [ ] Fail, implement, pass. Commit `feat(db): order destinations and list-sourced ideas (ALL-44)`.

### Task 5: Types, docs, review, PR

- [ ] `pnpm supabase db reset && pnpm db:types`; commit the regenerated `packages/core/src/database.types.ts`.
- [ ] Docs, straight to `main` (CLAUDE.md > Git): `planning/decisions.md` #41 and #42 (owner); `design/decisions.md` T31 (the rulings above); design §2.2 ("Money and sensitive data" row), §3 (new tables and columns, plus "As built in schema v1.1"), §4.2 (no budget) and §6.5 step 3 (ships to the chosen destination). Add this plan to `README.md`'s doc table.
- [ ] Linear: comment on ALL-44 with the answers and rulings. Comment on ALL-30 (claim the list item on order; use `order_addresses` and `shared_address_for_person`) and ALL-21 (null means no budget).
- [ ] Full verification, then one fresh reviewer (`superpowers:requesting-code-review`), then a PR `feat(db): schema v1.1 for optional budgets, ship-to addresses and list picks (ALL-44)` with `Closes ALL-44`.
- [ ] After merge, apply to `dev`, then `prod` (admin, as allensforever711), and verify with `migration list --linked`.
