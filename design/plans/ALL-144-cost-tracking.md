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
| `ai_capture` | AI suggestions | The gateway's reported cost for the call, parsed with a schema in `lib/ai/extract.ts`; when it's missing or the call threw, `capture_read_estimate_cents`, estimated **[Verify]** that the gateway returns a per-call cost through `generateText` | One row per capture read that called `extract` |
| `lookup_price_check` | AI suggestions | `zinc_lookup_cents` per lookup, estimated | Fix page price check and its re-check (`purchase/replace.ts`) |
| `zinc_order_fee`, `card_fee` | Ordering, card fees | — | **ALL-98**, per Connect order. Kept out of the averages here (decision 59 passes them through per gift) |

**Not recorded: Amazon paste lookups (decision 57).** They serve gift lists, which stay free, and lists must not write concierge tables (T19). Their per-person rows are deleted after a day on purpose (T42). Their cost is already in the `list.amazon_lookup` event.

**Each record holds only:** kind, cents (fractions allowed), estimated, time, and the idea run or order it came from where there is one, for checking. No buyer, person or round link (T42): the averages don't need them.

**Accounts left out (owner, 2026-11-24):** the QA live-check account's activity is left out, because its automated runs would skew the numbers. An account flag set by hand (like `paid_features`) marks it; nothing is written for it, and its orders don't count as completed gifts. Everyone else's use counts, including the owner's and Jim's, so ALL-76 has numbers before friends join.

### The averages

- **A completed gift:** an order with status `placed`, `shipped` or `delivered` and `placed_at` in the window, from an account not left out. (Not `order_is_given`, which also counts orders still placing and unresolved failures.)
- **Average for AI suggestions** = the recorded kinds above, in the window ÷ completed gifts in the window. Costs of rounds that ended without a purchase are in the numerator on purpose. The function names the kinds it adds up, so ALL-98's order and card fees never land in it.
- **Running the service** = bills ÷ completed gifts, over the months in the window that **have bills entered**. A month with no bills yet doesn't count, so a month whose bills haven't arrived doesn't understate the cost. Yearly bills (the domain) are entered as one-twelfth each month.
- **Never entered as bills:** the AI Gateway (counted per call) and Zinc wallet top-ups (lookups are counted per call). Only Zinc's plan, if it has one, is a bill. `design/operations.md` says so where bills are explained.
- **The fixed part shown** = `zinc_order_fee_cents` (T23, already a setting) + AI suggestions + running the service.
- **The window:** `cost_window_days` (90), a setting (T23).
- **After an account is deleted,** its orders go (they cascade), but its cost records stay, with no links to it. Averages then read slightly high. That's accepted: it's rare, and it errs toward covering cost.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An idea run that makes AI replies and Zinc lookups | It finishes, with any outcome (saved, `cost_cap`, failed after spending) | One `ai_ideas` and one `lookup_ideas` record for the run; together they equal its `idea_runs.cost_cents` within 1¢ |
| AC-2 | An AI call in a run that was cut off with an unknown cost | The run finishes | Its `ai_ideas` record is marked estimated |
| AC-3 | A capture read that calls `extract` | It ends, either extracted or failed | One `ai_capture` record, with the gateway's cost if it was reported and valid, otherwise `capture_read_estimate_cents` marked estimated |
| AC-4 | A capture that isn't read (no paid features) | — | No record |
| AC-5 | A price check on the fix page | Each Zinc lookup is made | One `lookup_price_check` record with its order |
| AC-6 | An Amazon link pasted on a list | The lookup is made | No cost record (decision 57, T19) |
| AC-7 | Writing a cost record fails | — | The user's action still succeeds; `cost.record_failed` is logged with the kind; money caps keep working from their own counters, unchanged |
| AC-8 | The QA account (flagged) | It runs ideas, reads captures or orders | No cost records, and its orders aren't completed gifts |
| AC-9 | Cost records and bills in the window, and completed gifts | The Monday email is sent | It has a "Cost per completed gift" section: the window, the number of completed gifts, AI suggestions (lookups on their own line), running the service and its months counted, and the fixed part including Zinc's order fee |
| AC-10 | No completed gifts in the window | The Monday email is sent | The section shows the totals spent and "no completed gifts yet", with no division by zero |
| AC-11 | Reading the costs fails (a missing setting, a query error) | The Monday email is built | The rest of the email, its problems and alerts, goes out unchanged; the section says "Costs couldn't be read"; `health.costs_failed` is logged. On other days costs aren't read at all |
| AC-12 | A missing `cost_window_days` | The averages function runs | It raises (no fallback values, T23), which AC-11 then handles |
| AC-13 | The cost records and bills tables, and any function that writes them | A signed-in user calls them | Refused: only the service role can read or write. Routes and actions that record a cost build a service-role client and pass it in (E3); nothing that writes costs is granted to signed-in users |
| AC-14 | A bill for the same month and vendor entered twice | — | The second replaces the first (unique month and vendor) |

### Out of scope

- Charging or showing the fee (ALL-98), and recording order and card fees (ALL-98 writes them into the same table).
- An admin page for bills, and an admin flag (owner, 2026-11-24).
- Pulling bills from vendor APIs.
- Amazon paste lookups (see above).
- Backfilling past idea runs; their totals stay in `idea_runs.cost_cents`.
- Checking against a real month of vendor bills: done once real rounds run (the ticket's "Done when"), not in the build.

### Open questions

None open for the owner. **[Verify]** while planning: what `generateText` returns for cost through the AI Gateway (AC-3 works either way).

## What was decided, and why

- **One cost ledger (owner, 2026-11-24),** over working it out from existing tables (can't split AI from lookups, misses fix-page lookups, no place for ALL-98's fees) or vendor bills only (no per-part breakdown). Recorded as a new T# with the plan.
- **Shown in the Monday health email (owner),** not a dashboard: it already arrives weekly, and there's no data to browse yet. This extends T87: costs are read only on the weekly day, and a failure drops only that section.
- **Bills entered by Claude or in the Supabase editor (owner),** no page.
- **Only the QA account left out (owner),** so ALL-76 has real numbers before friends join.
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
