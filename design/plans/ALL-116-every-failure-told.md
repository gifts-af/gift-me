# ALL-116 A round with several failed picks can leave one gift unmentioned: Spec and Plan

**Goal:** a buyer hears about every gift that failed, with the right reason and the right gift named, even when several picks in one round fail together, next to an unconfirmed order, or on the ship-by day.

**Links:** [ALL-116](https://linear.app/allens-forever/issue/ALL-116), found by the adversarial review of [ALL-112](https://linear.app/allens-forever/issue/ALL-112). Blocks [ALL-29](https://linear.app/allens-forever/issue/ALL-29). Owner rule: customers are always told what happened to their purchase (ALL-32 Task 7, `20261110100000_failure_notices.sql`). Decisions T18, T61, 39.

## Spec: what it does

### What goes wrong today (confirmed in the code, 2026-11-08)

Each failure's email is tied to a running count (`fail:<n>:notice`, where n is `round_fail_count`) and a guess at which order is "newest" (`lastFailure`, by `updated_at`). Not to the order that actually failed.

| # | Case | Where | What the buyer gets |
|---|---|---|---|
| 1 | Two picks fail in one `record_outcomes` call, or before the next tick | `round_fail_count` jumps 0 → 2, so only `fail:2:notice` is sent | One email naming one gift. With the same `now()`, which one is arbitrary |
| 2 | A pick fails while another is `unconfirmed` | `reconcile_round` ranks `unconfirmed` above `failed`; `closeAtDeadline` sends nothing while something is pending; `cancel_held` marks the failure resolved | Only the "still confirming" emails. Never told about the failure |
| 3 | A pick fails on the ship-by day next to a placed or placing one | `nextAction` returns `skip` before the failure notice; `closeAtDeadline` sends nothing when something is placed and nothing is held | Nothing about the failed gift |
| 4 | A pick fails on the ship-by day with nothing else in the round | Same skip, then `closeAtDeadline` sends `skipped` | "Couldn't be bought in time", the wrong reason |
| 5 | Clearing a rejected address (ALL-112) or closing the round updates the order | The `set_updated_at` trigger on `orders` moves `updated_at` | An older failure can look newest; ALL-112's "give up after `check_address_retry_days`" window restarts (`engine.ts:458`) |
| 6 | Two failures of different types, e.g. an older `price_up` and a newer `out_of_stock` | The email type comes from the round's reason (`price_up` ranks first); the gift named comes from `lastFailure` (the newest) | "The price went up" naming the out-of-stock gift |

Root cause: the notice isn't keyed to the order it's about.

### Who it's for and what they can do

1. **Every failure is told:** as a buyer, I get an email for every gift that couldn't be bought, naming that gift and the real reason, so I can choose again or know nothing was charged.
2. **Nothing told twice:** as a buyer, a later email never repeats a gift I was already told about.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A round with two placing picks | Both fail in one `record_outcomes` call (one `price_up`, one `out_of_stock`) | The next tick sends one `failed_several` summary naming both, each with its own reason, next step and link. The `price_up` order can still be re-approved (`reapprove_order`) |
| AC-2 | A round where one pick's failure was already emailed | A second pick fails | The next tick sends one email, naming only the second gift |
| AC-3 | Two picks; the one created first fails last | Each failure is told | Each email names the gift that failed, whatever the order of creation (case 5) |
| AC-4 | A round with an `unconfirmed` order | Another pick fails | The failure email goes at the next tick, in the same tick as any "still confirming" notice (case 2) |
| AC-5 | An untold failure (any reason) | The round closes: the ship-by day, `skip_open_rounds` (person deleted, occasion off) | The order is marked `failed_after_close`, and the existing "We couldn't buy it" email (`late_fail:<order id>`) tells the buyer, retried each tick until it goes (cases 2, 3) |
| AC-6 | The engine has read the round on the ship-by day | `settle_order` fails a placing pick before `cancel_held` runs | That failure still gets the "We couldn't buy it" email (the race from the review) |
| AC-7 | A failure on the ship-by day, nothing held, placed or pending | The tick closes the round | The buyer gets "We couldn't buy it" for that gift, and not also "No gift … this time" (case 4) |
| AC-8 | A rejected shared address (ALL-112) | The round closes, or another update touches the order | The order's `failed_at` doesn't change, and the retry window in `tellOwnerOfRejection` counts from `failed_at` (case 5) |
| AC-9 | Shared-address orders ended together (`address_withdrawn` and/or `address_rejected`) | The next tick | One email per type names every untold order of that type, as today (ALL-112). It records `fail:<order id>` for each one it names, and forgets them all if refused. None is named again later |
| AC-10 | Failures in rounds that have any old `fail:<n>:notice` key | The migration runs | They count as told, so nobody gets a repeat. A failure in a round with no such key was never told, and is told at the next tick |
| AC-11 | A failure email that the email service refuses | The tick goes on | It's forgotten and logged with an alert; the run still tries placing held gifts, and the failure is sent at the next tick |
| AC-12 | A failure that happened after the round closed | Any tick | Only the existing `late_fail:<order id>` email goes, never a round failure email too |
| AC-13 | A buyer cancels a held gift (`cancel` context) while another gift's failure is untold | Closing | They still get "We couldn't buy it" for that gift: they cancelled one gift, not the news about another (owner: the more they know, the better) |
| AC-14 | Three picks fail together, and a fourth is held for funds | The next tick | One summary naming the three, and the funds notice, go in that tick, and the placing try still runs |
| AC-15 | Two untold failures when the round closes | Closing | One "We couldn't buy" email names both, each with its reason |

Every AC gets a test that fails first.

### Out of scope

- Grouping failures from different rounds into one email (see the summary emails).
- Links that act on one gift (re-approve, choose another) from the email: ALL-29.
- The approval screen and real re-approval links: ALL-29.
- Changing how the deadline treats `unconfirmed` orders beyond sending the failure email first.

### Open questions

- **[Verify, owner]** The two summary mock-ups (below) approved before building.

### Owner answers (2026-11-08)

1. **Several failures for the same buyer: one summary email with a link per gift**, not one email each. The owner added a general rule: the more the buyer knows, the better. Every email says what happened, what we're doing, and what happens next.
2. **Yes:** at closing, untold failures get "We couldn't buy it", not the price, stock or timing email, and no "No gift this time" email. **[Claude's call, from the owner's "more information is better"]** This includes a close caused by the buyer cancelling a held gift: that cancels one gift, not the news about another.
3. **Yes:** failures in rounds that already sent an old failure email count as told; one the old code never emailed is told at the next tick, late.

### The summary emails (mock-ups posted on ALL-116)

- **Round open, two or more untold failures:** new `failed_several` email. Heading "2 of Sam's birthday gifts couldn't be bought". Says what was tried and that nothing was charged for them, and names anything on its way. One row per gift with what happened and what the buyer can do. The "Open Sam's page" button, and one link per gift ("Review the new price for the earbuds", "Choose another gift instead of the cookbook"). A "What happens next" line: nothing else is bought until you choose, choose by the ship-by date, and what we do if you don't. Until ALL-29, every link opens the person's page; ALL-29 points each at its gift.
- **One untold failure:** the existing `price_up`, `out_of_stock`, `too_late` or `needs_attention` email, as today.
- **Round closed:** `failed_late` takes a list of gifts with a reason each, so several late failures in one round go in one email ("We couldn't buy 2 of Sam's birthday gifts"), with the "What happens next" line. One failure reads as today, with the reason added.
- **Shared-address failures** (ALL-112) become rows in the same summary, with their existing wording as the row's text.
- **[Claude's call]** "Same buyer" is grouped per round (one person's occasion). Failures in two different rounds on the same day still get one email per round, because each round has its own person, date and choices.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Key per failure | `fail:<order id>`, like `ordered:<order id>` and `late_fail:<order id>` | Ties the email to the order. No count, no "newest" guess, nothing told twice |
| `failed_at` | New `orders.failed_at`, set once by `fail_order_row` with `clock_timestamp()`. Backfilled from `updated_at` for failed orders; a check makes it required on failed orders | ALL-112's retry window counts from it (case 5). Telling order uses `created_at, id`, which is enough |
| Which failures are untold | `failed`, not `resolved`, not `invalid_shipping_address` (held for a new address instead), not `failed_after_close` (told by `late_fail`), and no `fail:<id>` in `round_sends` | Same set the buyer needs to hear about, keyed per order |
| While the round is open | `runHeld` tells every untold failure first, in one email (the summary when there are two or more), with `trySend` (a refusal is logged and retried next tick, never aborts the run). These don't count toward "one email per run", which stays for holds and reminders | Customers are always told; a refused email can't block placing (E7) |
| At closing | `reconcile_round` with the `deadline` context, or a close from `skip_open_rounds`, sets `failed_after_close = true` on every untold failure before resolving it, for any close (`deadline`, `cancel`, `skip_open_rounds`). `closeAtDeadline` doesn't send "No gift this time" when nothing was held, placed or pending | One path for every close and every race (review B1). The deadline needs no new ordering in the engine (review B2) |
| Email type | From the order's `failure_type`, not the round's reason | Fixes case 6 |
| Rollout | Code and migration in one PR. CI applies the migration and Vercel deploys within minutes; the old engine only sends at the daily tick (12:00 UTC), so don't merge between 11:45 and 12:15 UTC | Avoids the old code writing `fail:<n>` keys after the backfill (review S5) |

### What this changes that was recorded before

- `reconcile_round`'s next look: due now when any untold failure exists, whatever the round's reason (today only inside the failure branch).
- The ALL-32 rule that an `unconfirmed` round waits: it still waits, but untold failures are told first.
- `StepKey`: `fail:${number}:notice` becomes `fail:${string}` (order id). `round_fail_count` is no longer used; it's dropped in a later contract migration (E7).
- `design/technical-design.md` round engine section: failure notices.

## Principles check

- **Simplest version?** Reuses the existing emails and the per-order key pattern. Cut: a combined email, new deadline wording, and `round_fail_count` (dropped from use; the function stays until a later contract migration, E7).
- **Hard-coded values?** None. `check_address_retry_days` stays a setting.
- **Product boundaries?** Concierge only. No list tables touched.
- **New personal data?** None. `failed_at` is a timestamp.
- **Docs and decisions:** `design/technical-design.md` round-engine section (failure notices), and the comments in `round-plan.ts`.

### Folded in (owner, 2026-11-08)

- **Every bad-news email** gets the apologetic tone (was ALL-124): an apology, what it means, what was or wasn't charged, and "What happens next". Approved before-and-after preview of every changed email posted on ALL-116.
- **ALL-114:** no "Alpha:" label in emails or money notices; the cost is said plainly. `design/ui.md` "Alpha money notice" rule renamed and reworded; decision 53 gets a note.

## Plan

**Architecture:** the database marks which failures are untold (no `fail:<order id>` in `round_sends`) and, at any close, turns untold ones into late failures. The engine tells untold failures first in each held run, as one email, outside the "one email per run" loop. Closing sends nothing about failures itself: the late-failure path (`tellOrdered`) tells them, now grouped per round, and runs right after closing.

**Tech stack:** one migration plus pgTAP, `packages/core` round plan, the concierge round engine, store and templates, and the money wording in `paid-features.ts`.

### Task 1: database (AC-5, AC-6, AC-8, AC-10, AC-12)

New migration `20261114100000_every_failure_told.sql`, expand-only:
- `orders.failed_at timestamptz`, backfilled `= updated_at` for failed orders, then `check (status <> 'failed' or failed_at is not null)`. `fail_order_row` sets `failed_at = clock_timestamp()`.
- `concierge.untold_failures(p_round_id)`: failed, not resolved, not `invalid_shipping_address`, not `failed_after_close`, and no `fail:<id>` in `round_sends`.
- `reconcile_round` (copied from `20261110100000`): at any close (`v_ctx` not null), first `failed_after_close = true` on untold failures, then resolve as today. The next look is now whenever an untold failure exists, whatever the reason; the old failure branch goes.
- Backfill: every failed order in a round that has any `fail:%:notice` step gets `fail:<id>`.
- pgTAP `every_failure_told.test.sql`: `failed_at` is set once and unchanged by later updates; the check; untold set; close marks untold as late for `deadline`, `cancel` and `skip_open_rounds`, but not told ones; a `settle_order` failure after the engine's read but before close ends up late; next look is now for an untold failure next to `unconfirmed`; backfill.

### Task 2: round plan (core)

- `StepKey`: `fail:${string}` (order id); `failCount` leaves `RoundView`.
- `holdAction`: a failure reason no longer sends anything (the engine tells failures before the plan runs); it waits like a hold that isn't emailed.
- Tests in `round-plan.test.ts` updated, failing first.

### Task 3: store

- `RoundOrder` gets `failedAt` and `createdAt`; `roundContext` drops `failCount` (and the `round_fail_count` call). Fake store follows.
- `tellOwnerOfRejection` counts its retry window from `failedAt` (AC-8).

### Task 4: tell untold failures while the round is open (AC-1 to AC-4, AC-9, AC-11, AC-14)

In `runHeld`, before the pass loop and only when the round isn't at its deadline:
- Untold = `failed`, not resolved, not `invalid_shipping_address`, not `failedAfterClose`, no `fail:<id>` in `sent`, oldest `createdAt` first.
- One: the existing email for its `failureType` (`price_up`, `out_of_stock`, `too_late`, else `needs_attention`; address endings as ALL-112, owner told first). Two or more: `failed_several`, with a detail and action per gift.
- Record `fail:<id>` for every order it names, then send. A refusal forgets them all and logs `round_failure_email_failed` with `alert: true`; the run goes on (placing still tried).
- It doesn't count toward "one email per run". `sendFailure`'s `lastFailure` and round-reason switch go.
- Tests (fake store and real Postgres): AC-1, AC-2, AC-3, AC-4, AC-9, AC-11, AC-14, each failing first.

### Task 5: closing (AC-5, AC-6, AC-7, AC-12, AC-15)

- `closeAtDeadline`: after `cancelHeld`, call `tellOrdered` for the round, best effort, so late failures are told the same tick. No "skipped" email when the round's only news is failures told as late (nothing held, placed or pending, or a pending one failed while closing).
- `tellOrdered`: all untold late failures in a round go in one `failed_late` email, each with its reason; it records `late_fail:<id>` for each and forgets them all on refusal.
- Tests: AC-5, AC-6 (the existing "placing gift fails while the round closes" test changes: "We couldn't buy", not "No gift … this time"), AC-7, AC-12, AC-15.

### Task 6: emails and money wording (approved)

- `templates.ts`: the approved wording; `failed_several`; `failed_late` with a list; `orderByText` on single failures (from the round's ship-by date).
- `paid-features.ts`: no "Alpha:". `design/ui.md`: "Money notice" rule without the label; note on decision 53.
- Template, sample, `paid-features` and `what-we-know` tests updated. `e2e/emails.spec.ts` still passes on phone.

### Task 7: docs

- `design/technical-design.md` round engine: failure notices per order, closing marks untold failures late.
- `design/operations.md`: nothing new to run.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test (AC-1 to AC-15).
- [x] Every task traces back to a criterion or an owner decision.
- [x] No open questions are left.
- [ ] Plan review done; blockers fixed.

## Review focus

- Closing never loses an untold failure: AC-5, AC-6 (pgTAP and real Postgres).
- No failure told twice across the summary, single and late paths: AC-2, AC-9, AC-12.
- A refused failure email never blocks placing: AC-11, AC-14.

## Adversarial review (T55)

**Spec review (2026-11-08, fresh agent):** 2 blockers, 5 should-fixes, 4 nits. All folded in above:
- B1 (closing hid untold failures, including a webhook racing the deadline): closing marks them `failed_after_close` (AC-5, AC-6).
- B2 (the email break and pass cap stopped the deadline closing): failure emails sit outside the pass loop, and the deadline needs no new email first (AC-14).
- S1 (deadline-day emails offering choices that are gone): "We couldn't buy it" at closing.
- S2 (a refused email aborting placing): `trySend` (AC-11).
- S3 (unnamed changes): listed under "What this changes".
- S4 (`failed_at` backfill and check), S5 (rollout order): in the decisions table.
- Nits: AC-9 covers mixed address types; AC-10 picks one rule; `failed_at` is kept only for the retry window; AC-4 says "same tick".

Plan review: after the plan is written.
