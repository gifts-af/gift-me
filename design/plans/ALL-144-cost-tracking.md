# ALL-144 Track what each gift costs us: Spec and Plan

**Goal:** every cost we pay for the concierge is recorded when it happens, and the Monday health email shows our average cost per completed gift for each part of the GiftsAF fee, so ALL-76 can set the fee's fixed part.

**Links:** [ALL-144](https://linear.app/allens-forever/issue/ALL-144) · fee [ALL-76](https://linear.app/allens-forever/issue/ALL-76) · card payments [ALL-98](https://linear.app/allens-forever/issue/ALL-98) · health email [ALL-35](https://linear.app/allens-forever/issue/ALL-35) (`design/plans/ALL-35-health-email.md`, T87) · planning decisions 53, 57, 58, 59 · T19, T23, T42, T68, T87

## Spec: what it does

### Why

The GiftsAF fee is a fixed part plus the actual card fee (decision 59). The fixed part is Zinc's order fee plus **our own average cost per completed gift**: AI suggestions, product lookups and running the service. "Per completed gift" includes rounds that end without a purchase (decision 58). Today only idea runs record a cost, and that one number mixes AI and lookups. Nothing else is added up.

### Who it's for and what they can do

1. **Cost records (system):** whenever the concierge pays a vendor (AI, Zinc lookups), a cost record is written: what kind, how many cents, and whether that's an estimate.
2. **Monthly bills (owner):** the owner gives each month's vendor bills (hosting, email, Zinc's plan, the domain) to Claude, or types them into the Supabase editor as allensforever711. No page is built (owner, 2026-11-24). Running costs are then spread across that month's completed gifts.
3. **Weekly numbers (owner):** the Monday health email shows the average cost per completed gift for each fee part over the window in settings, so the owner can propose the fee's fixed part (ALL-76).

### What's recorded

| Kind | Fee part | Cents | Written by |
|---|---|---|---|
| `ai_ideas` | AI suggestions | The run's AI spend, as `ideas/run.ts` already works it out (tokens × the gateway's list prices, plus web searches). Marked **estimated** when a call was cut off and its cost is unknown (`costUnknown`) | One row per idea run, when the run finishes, any outcome |
| `lookup_ideas` | AI suggestions (shown as its own line) | The run's Zinc lookups × `zinc_lookup_cents`, estimated | Same, one row per run |
| `ai_capture` | AI suggestions | The gateway's reported cost for the call, parsed with a schema in `lib/ai/extract.ts`; when it's missing or the call threw, `capture_read_estimate_cents`, estimated. A call the Gateway refused (a 4xx) bought nothing and isn't recorded | One row per capture read that called `extract` |
| `lookup_price_check` | AI suggestions | `zinc_lookup_cents` per lookup, estimated | Fix page price check and its re-check (`purchase/replace.ts`) |

Zinc's order fee and card fees are added by **ALL-98**, per Connect order, as its own kinds. They stay out of these averages (decision 59 passes them through per gift).

**Not recorded: Amazon paste lookups (decision 57).** They serve gift lists, which stay free, and lists must not write concierge tables (T19). Their per-person rows are deleted after a day on purpose (T42). Their cost is already in the `list.amazon_lookup` event.

**Each record holds only:** kind, cents (fractions allowed), estimated, whether it's left out, time, and the idea run or order it came from where there is one, for checking. No buyer, person or round link (T42): the averages don't need them.

**Accounts left out (owner, 2026-11-24):** the QA live-check account is kept out of the averages, as a safeguard: its rules (T60) already say it adds no people and buys nothing. An account flag set by hand (like `paid_features`) marks it. Its costs are recorded and marked left out, and its orders don't count as completed gifts. The email shows what it cost on its own line. Everyone else's use counts, including the owner's and Jim's, so ALL-76 has numbers before friends join.

### The averages

- **A completed gift:** an order with status `placed`, `shipped` or `delivered` and `placed_at` in the window, from an account not left out. (Not `order_is_given`, which also counts orders still placing and unresolved failures.)
- **Average for AI suggestions** = the recorded kinds above, in the window ÷ completed gifts in the window. Costs of rounds that ended without a purchase are in the numerator on purpose. The function names the kinds it adds up, so ALL-98's order and card fees never land in it.
- **Running the service** = bills ÷ completed gifts, over the months in the window that **have bills entered**. A month with no bills yet doesn't count, so a month whose bills haven't arrived doesn't understate the cost. Yearly bills (the domain) are entered as one-twelfth each month.
- **Never entered as bills:** the AI Gateway (counted per call) and Zinc wallet top-ups (lookups are counted per call). Only Zinc's plan, if it has one, is a bill. `design/operations.md` says so where bills are explained.
- **The fixed part shown** = `zinc_order_fee_cents` (T23, already a setting) + AI suggestions, **with and without** running the service. People who only use free lists use hosting and email too, so how much of it concierge gifts carry is decided in ALL-76 (owner, 2026-11-24).
- **Counting starts when tracking does.** Orders from before it have no costs behind them, so the start is the later of the window's start and `cost_tracking_since`, which the migration sets. The email shows the date. Turning tracking back on after an off period means setting it again.
- **Bills with no gifts in their months** show as a total, and only the fixed part without running the service is shown.
- **The window:** `cost_window_days` (90), a setting (T23).
- **After an account is deleted,** its orders go (they cascade), but its cost records stay, with no links to it. Averages then read slightly high. That's accepted: it's rare, and it errs toward covering cost.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An idea run that makes AI replies and Zinc lookups | It finishes, with any outcome (saved, `cost_cap`, failed after spending) | One `ai_ideas` and one `lookup_ideas` record for the run; together they equal its `idea_runs.cost_cents` within 1¢ |
| AC-2 | An AI call in a run that was cut off with an unknown cost | The run finishes | Its `ai_ideas` record is marked estimated |
| AC-3 | A capture read that calls `extract` | It ends, either extracted or failed, and the Gateway didn't refuse the call (4xx) | One `ai_capture` record, with the gateway's cost if it was reported and valid, otherwise `capture_read_estimate_cents` marked estimated |
| AC-4 | A capture that isn't read (no paid features) | — | No record |
| AC-5 | A price check on the fix page | Each Zinc lookup is made | One `lookup_price_check` record with its order |
| AC-6 | An Amazon link pasted on a list | The lookup is made | No cost record (decision 57, T19) |
| AC-7 | Writing a cost record fails | — | The user's action still succeeds; `cost.record_failed` is logged with the kind; money caps keep working from their own counters, unchanged |
| AC-8 | The QA account (flagged) | It runs ideas, reads captures or orders | Its costs are recorded, marked left out, and shown on their own line in the Monday email; they're in no average, and its orders aren't completed gifts |
| AC-9 | Cost records and bills in the window, and completed gifts | The Monday email is sent | It has a "Cost per completed gift" section: the window, the number of completed gifts, AI suggestions (lookups on their own line), running the service with its months and vendors counted, and the fixed part including Zinc's order fee, with and without running the service |
| AC-10 | No completed gifts in the window | The Monday email is sent | The section shows the totals spent and "no completed gifts yet", with no division by zero |
| AC-11 | Reading the costs fails (a missing setting, a query error) | The Monday email is built | The rest of the email, its problems and alerts, goes out unchanged; the section says "Costs couldn't be read"; `health.costs_failed` is logged. On other days costs aren't read at all |
| AC-12 | A missing `cost_window_days` | The averages function runs | It raises (no fallback values, T23), which AC-11 then handles |
| AC-13 | The cost records and bills tables, and any function that writes them | A signed-in user calls them | Refused: only the service role can read or write. Routes and actions that record a cost build a service-role client and pass it in (E3); nothing that writes costs is granted to signed-in users |
| AC-14 | A bill for the same month and vendor entered twice | — | The second replaces the first (unique month and vendor) |
| AC-15 | Orders, costs or bill months from before `cost_tracking_since` | The averages are worked out | They aren't counted, and the email shows the date counting starts |

### Out of scope

- Charging or showing the fee (ALL-98), and recording order and card fees (ALL-98 writes them into the same table).
- An admin page for bills, and an admin flag (owner, 2026-11-24).
- Pulling bills from vendor APIs.
- Amazon paste lookups (see above).
- Backfilling past idea runs; their totals stay in `idea_runs.cost_cents`.
- Checking against a real month of vendor bills: done once real rounds run (the ticket's "Done when"), not in the build.

### Open questions

None. Checked on 2026-11-24: the Gateway reports each call's cost through `generateText` (`providerMetadata.gateway.cost`).

## What was decided, and why

- **One cost ledger (owner, 2026-11-24),** over working it out from existing tables (can't split AI from lookups, misses fix-page lookups, no place for ALL-98's fees) or vendor bills only (no per-part breakdown). Recorded as a new T# with the plan.
- **Shown in the Monday health email (owner),** not a dashboard: it already arrives weekly, and there's no data to browse yet. This extends T87: costs are read only on the weekly day, and a failure drops only that section.
- **Bills entered by Claude or in the Supabase editor (owner),** no page.
- **Only the QA account left out, with its cost shown separately (owner),** so ALL-76 has real numbers before friends join.
- **Running costs recorded and shown, the share decided in ALL-76 (owner, 2026-11-24).**
- **[Claude's call]** Lookups count toward AI suggestions in the fee breakdown (decision 58 (2)'s parts), shown as their own line in the email.
- **[Claude's call]** Amazon paste lookups aren't recorded (adversarial review: T19 and T42).

## Principles check

- **1, E2 (simple):** one table for costs, one for bills, one function, and one email section. No page, no admin flag, one row per run instead of one per call.
- **4, T23:** the window, prices and Zinc's fee come from settings; the function raises without them.
- **5, T19:** lists write nothing here.
- **6, 10, T42, E6:** records hold no buyer or person links; events carry ids only.
- **E3:** service-role clients are built in routes and actions and passed in.
- **E7:** recording a cost never blocks the user's action. The cost section can't block the health email's alerts.
- **E8:** no new alert. The section is information, never a "problem".

## Plan

**Architecture:** Two new tables (`cost_events`, `monthly_bills`) and two service-role functions: `record_cost` writes one record, and `cost_per_gift` adds everything up. App code records through one function that never throws. The Monday health email reads `cost_per_gift` after its report is built.

**Tech stack:** Postgres migration with pgTAP, Vitest, the existing health email. No new dependency, page, job or email.

**Rules for every task:** test first, commit per task, no hard-coded amounts (T23), ids only in events (E6), nothing that writes costs is granted to `anon` or `authenticated`. Tests leave nothing behind in the shared local database: pgTAP rolls back and uses dates far in the future; local-db tests delete their own rows.

### Names the tasks share

```sql
-- All service_role only, security definer, set search_path = ''.
concierge.record_cost(p_user_id uuid, p_kind text, p_cents numeric, p_estimated boolean,
                      p_idea_run_id uuid default null, p_order_id uuid default null) returns void
concierge.cost_per_gift(p_now timestamptz) returns jsonb  -- null when tracking is off
```

```ts
// modules/concierge/costs/record.ts
export type CostKind = "ai_ideas" | "lookup_ideas" | "ai_capture" | "lookup_price_check";
export type Cost = {
  userId: string;
  kind: CostKind;
  cents: number; // fractions allowed; the caller always knows it
  estimated: boolean;
  ideaRunId?: string;
  orderId?: string;
};
export type RecordCost = (cost: Cost) => Promise<void>;
/** Never throws: a failure logs cost.record_failed {kind, user_id, idea_run_id, order_id}. */
export function costRecorder(makeDb: () => AdminDb, timeoutMs?: number): RecordCost;

// modules/concierge/health/costs.ts
export type CostPerGift = {
  since: string; // when counting starts: the later of the window's start and cost_tracking_since
  windowDays: number; gifts: number;
  aiCents: number; lookupCents: number; aiRecords: number; aiEstimated: number;
  bills: { month: string; vendors: string[] }[]; billCents: number; billGifts: number;
  orderFeeCents: number;
  excludedCents: number; // the QA account's costs, not in any number above
};
export function readCostPerGift(db: AdminDb, now: Date): Promise<CostPerGift | null>; // null: tracking is off
export function costLines(c: CostPerGift): EmailRow[];
```

### Task 1: The ledger (AC-8, AC-12 to AC-15, the averages)

**Files:** create `supabase/migrations/20261125100000_cost_tracking.sql` (check the latest timestamp on main first) and `supabase/tests/cost_tracking.test.sql`; regenerate `db:types` and `db:map` (add both tables to `apps/web/scripts/db-map/layout.json`).

- [ ] Write the pgTAP tests, each named for what it proves:
  - Signed-in and anonymous users can't select, insert, or call either function (`42501`). The service role can do all of it.
  - `record_cost` keeps a fraction of a cent (12.3456) and the estimate mark. A kind outside the list, and negative cents, are refused.
  - An account with `costs_excluded` writes a row marked `excluded`. A user with no `accounts` row is recorded, not excluded. Changing the flag later doesn't change old rows.
  - Users can't set `costs_excluded` on their own account.
  - `cost_tracking_enabled` = 0 writes nothing, and `cost_per_gift` returns null.
  - Deleting an idea run or an order keeps its cost row with that link cleared.
  - `cost_per_gift` counts orders `placed`, `shipped` and `delivered` with `placed_at` in the window (start excluded, `p_now` included). It leaves out `failed`, `placing`, `cancelled`, `refunded` and excluded accounts.
  - An order placed before `cost_tracking_since` isn't counted, even inside the window; nor are costs or bill months from before it.
  - Excluded rows are only in `excludedCents`. Rows outside the window change nothing.
  - Bills: a month counts only if it starts on or after the counting start, has ended by `p_now`, and has a bill. The current month and a month with no bills are left out of both `billCents` and `billGifts`. Each counted month lists its vendors.
  - A bill month with no gifts gives `billCents` > 0 and `billGifts` = 0.
  - A missing `cost_window_days`, `cost_tracking_since` or `zinc_order_fee_cents` raises.
  - A second bill for the same month and vendor is refused as a plain insert (`23505`) and replaces with `on conflict … do update`.
- [ ] Run `pnpm db:test`; the new file fails.
- [ ] Write the migration:
  - Settings: `cost_tracking_enabled` 1, `cost_window_days` 90, `cost_record_timeout_ms` 3000, and `cost_tracking_since`, set to the migration's `now()`. Turning tracking back on after an off period means setting it again; the settings' descriptions say so.
  - `concierge.accounts.costs_excluded boolean not null default false`, with a comment.
  - `cost_events`: `id` identity, `created_at`, `kind` (check list of the four kinds; ALL-98 widens it), `cents numeric(12,4)` ≥ 0, `estimated`, `excluded`, `idea_run_id` and `order_id` (single-column FKs, `on delete set null`, both indexed: the row holds no user to pair them with, T26 (3), and only the service role writes it), index on `created_at`.
  - `monthly_bills`: `month date` (check: first of the month), `vendor text` (check: not blank), `cents integer` ≥ 0, primary key (month, vendor).
  - Both: RLS on, no policies, all revoked from public, anon and authenticated, granted to service_role (as `tick_heartbeats`). The functions: the same, execute only.
  - `cost_per_gift` names its kinds: AI = `ai_ideas`, `ai_capture`; lookups = `lookup_ideas`, `lookup_price_check`. Dates are UTC.
- [ ] Apply with `psql` (the local Supabase is shared: never reset it), then run `pnpm db:test`, `pnpm db:types` and `pnpm db:map`. Commit.

### Task 2: The recorder (AC-7)

**Files:** create `modules/concierge/costs/record.ts`, `__tests__/cost-record.test.ts` and `__tests__/cost-record-db.test.ts` (local db; add to `LOCAL_DB_TESTS` in `vitest.config.ts`); add the test rows of `cost_events` and `monthly_bills` to `scripts/db-clean.mjs`.

- [ ] Tests: a recorded cost lands in `cost_events`; a database error, a thrown client error, a **factory that throws** and a call that outlasts the timeout each resolve and log `cost.record_failed` with ids and kind only, never the error's message. A missing timeout setting does the same.
- [ ] Implement: the client is made inside the try. `costRecorder(makeDb, timeoutMs?)` reads `cost_record_timeout_ms` only when it isn't passed; the write is aborted at that value. Export from `modules/concierge/index.ts`. Commit.

### Task 3: Idea runs (AC-1, AC-2)

**Files:** `ideas/run.ts`, `lib/ai/messages.ts`, `lib/wiring.ts` (`ideaDeps`), `__tests__/idea-run.test.ts`, `lib/ai/__tests__/messages.test.ts`.

- [ ] Tests, with a fake `recordCost` in `IdeaDeps`:
  - A saved run records AI and lookups separately, and their sum is within 1¢ of the cost given to `finish`. The same for `cost_cap`, `deadline`, and a run that failed on an unreadable paid reply.
  - A brainstorm error swallowed after list gifts qualified still counts.
  - The AI row is marked estimated when a call was cut off, its reply couldn't be read or priced, or its connection dropped; not when the Gateway refused it (402, 429, 5xx).
  - No AI spend and nothing unknown writes no `ai_ideas` row; unknown with nothing spent writes one at 0 cents, estimated. No lookups writes no `lookup_ideas` row. A run refused before it started records nothing.
  - A run still records when `store.finish` throws.
- [ ] Implement: `Tally` gains `ai` (added to in `paidAi`) and `lookups` (added to where `t.spent += s.zincLookupCents`). `AiError` gains `maybeSpent`, set only in `sendMessages` (dropped fetch, unreadable body, failed schema), and it sets `costUnknown`. In `runIdeas`'s `finally`, when `runId` is set, await `deps.recordCost` for each part. Lookups are always marked estimated. `idea_runs.cost_cents` and the cap logic don't change.
- [ ] Commit.

A run killed by the platform before its `finally` records nothing. The tick's own deadline aborts a run first (T68), so this is rare.

### Task 4: Capture reads (AC-3, AC-4)

**Files:** `lib/ai/extract.ts`, `capture/extract.ts`, `capture/store.ts`, `capture/facts.ts`, `inbound/handle.ts`, `notify/actions.ts`, `scripts/ai-eval.ts`, and the five callers: `app/api/captures/route.ts`, `app/api/captures/[id]/extract/route.ts`, `app/api/inbound/resend/route.ts`, `app/a/[token]/actions.ts`, `app/people/actions.ts`.

**Checked 2026-11-24 with two real calls (about 0.4¢):** `generateText` returns `providerMetadata.gateway.cost`, a string in dollars (`"0.001966"`), matching token count × list price.

- [ ] Tests:
  - `Extract` resolves `{ facts, costCents }`. `costCents` is parsed from `providerMetadata.gateway.cost` ("0.001966" → 0.1966) and is null when missing, blank, negative or not a number.
  - `processCapture` records the reported cents, unmarked; `readEstimateCents`, estimated, when the cost is null or `extract` throws.
  - Records nothing when the call was refused (a 4xx status on the thrown error, such as 402 or 429, where nothing was bought), when something failed before `extract` was called, or when the capture was already read, extraction is off, or there are no paid features.
  - A later `insertFacts` failure records exactly once, with the reported cost.
  - The stored facts and status are the same when recording fails.
- [ ] Implement `processCapture(store, extract, recordCost, captureId)`. `extractionSettings()` gains `readEstimateCents` (`capture_read_estimate_cents`). Each caller passes `costRecorder(createAdminClient)`, wired in the route or action (E3). The user's own token client never writes a cost. `store.userId` is the account.
- [ ] Commit.

### Task 5: Price checks (AC-5, AC-6)

**Files:** `purchase/replace.ts` (`QuoteDeps`, and the `PurchaseDeps & { lookup }` that `replaceFailedOrder` takes), `app/rounds/actions.ts` (`checkPriceAction`, `replaceAction`), `__tests__/replace.test.ts`.

- [ ] Tests: "Check today's price" and the re-check inside "Buy" each record one `lookup_price_check` at `zinc_lookup_cents`, estimated, for the failed order and its buyer; a Zinc error after the call still records; an idea with no live price (no call made) records nothing. A pasted Amazon link writes no `cost_events` row.
- [ ] Implement: both deps gain `recordCost`; `requote` takes the order id and buyer id, and records in a `finally` when `calls > 0`. Commit.

### Task 6: The Monday email (AC-8 to AC-11, AC-15)

**Files:** create `health/costs.ts`, `__tests__/health-costs.test.ts`; change `health/report.ts` (`HealthReport.costs?: CostPerGift | "unreadable" | null`), `health/run.ts`, `health/email.ts`, `notify/samples.ts`, `health-run.test.ts`, `health-db.test.ts`, `health-email.test.ts`.

- [ ] Tests:
  - With gifts: counting start, gifts, AI suggestions ("2 of 41 AI records estimated"), lookups, running the service with its months and each month's vendors, and the fixed part **with and without running the service**.
  - No gifts: totals and "No completed gifts yet", no `NaN` or `Infinity`.
  - No bills: "No bills entered yet", and only the fixed part without running the service.
  - Bills but no gifts in those months: the bill total, "no gifts in those months", and the same fixed part.
  - "QA account (not counted above): $0.42", also when it's $0.00.
  - "Costs couldn't be read", with `health.costs_failed` logged, while the problems above it are exactly the same.
  - No read on a day that isn't Monday; null (tracking off) shows no section.
- [ ] Implement: in `runHealthCheck`, after `healthReport`, only when `report.isWeekly`, read costs inside its own try/catch. The result is validated with zod (E4). Amounts show to the cent.
- [ ] Run `pnpm gallery`; `health-weekly-all-clear` and `health-problems` show the section. Send the owner a picture. Commit.

### Task 7: Docs

- [ ] `design/decisions.md` T90: the ledger, what's left out, why the links are single-column (T26 (3)), that it extends T87. `design/technical-design.md`: tables, where costs are recorded, and T87's health description. `design/operations.md`: the new settings, turning it off and back on (reset `cost_tracking_since`), `cost.record_failed` and `health.costs_failed`, marking the QA account (an upsert on `accounts`), entering bills (with the upsert SQL), what never to enter as a bill (AI Gateway, Zinc wallet top-ups), and that yearly bills go in as one-twelfth. Republish the screens and emails page and the database map.

### After merge (E9)

- **Ask the owner first:** mark the QA account `costs_excluded` on prod.
- **How we see it working:** a `cost_events` row after the next idea run and capture read (the capture row unmarked), and the section in the next Monday email.
- **How to turn it off:** `cost_tracking_enabled` = 0.
- **Stays open on the ticket:** the check against one real month of bills, and ALL-76 having its numbers (including the share of running costs concierge gifts carry).

## Before coding: consistency check

| Criterion | Task |
|---|---|
| AC-1, AC-2 | 3 |
| AC-3, AC-4 | 4 |
| AC-5, AC-6 | 5 |
| AC-7 | 2 (and 3, 4, 5) |
| AC-8, AC-15 | 1, 6 |
| AC-9, AC-10, AC-11 | 6 |
| AC-12, AC-13, AC-14 | 1 |

- [x] Adversarial review of the spec done.
- [x] Adversarial review of the plan: 2 blockers and 10 should-fixes fixed; three owner questions answered 2026-11-24.

## Review focus

1. A recording failure or a slow write reaching the user's action or a money path: Tasks 2 to 5.
2. A signed-in user writing a cost: Task 1.
3. A cost read hiding a health alert: Task 6.
4. AI and lookup spend split wrongly on a failed or cut-off run, or a refused call recorded as spent: Tasks 3 and 4.
5. A division by zero, bills counted against the wrong months, or old orders counted without their costs: Tasks 1 and 6.
