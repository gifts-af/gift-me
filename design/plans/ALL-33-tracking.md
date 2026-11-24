# ALL-33 Order tracking, late-risk check, failure and replacement: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after a gift is bought, the buyer can see where it is. If it looks like it'll miss the day, or the store cancels it, they're told plainly and shown every option they really have. They hear when it arrives.

**Links:** [ALL-33](https://linear.app/allens-forever/issue/ALL-33) · PRD D-1, D-4 · design §4.1, §5, §6.5 (steps 4–6), §6.6 · decisions T18 (approval means buy now), T56 (forward-only webhooks), T81 (`replace_failed_order`), T89 (new, below) · planning decision 29 (revised, below) · Zinc spike [`design/spikes/checkout.md`](../spikes/checkout.md) (real order: tracking lagged, no carrier estimate) · Zinc docs: [Webhooks](https://www.zinc.com/docs/v2/api-reference/introduction/webhooks.md), [Tracking](https://www.zinc.com/docs/v2/api-reference/orders/tracking.md) · mock-up signed off in ALL-41: [Price went up](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#needs-attention).

## Spec: what it does

### What's already built (not part of this ticket)

- **Webhooks:** the Zinc webhook route (`modules/concierge/zinc/events.ts`) handles `order.placed` and `order.failed` through `settle_order`, which only moves an order from `placing` or `unconfirmed`. It checks the signature per user, and order status only moves forward, so a repeated event changes nothing (T56).
- **Failures:** each failed gift is told once (ALL-116). The fix page `/rounds/<id>/fix/<orderId>` offers the next-best idea, every idea, a re-buy at a new price, or an address fix. `replace_failed_order` swaps in a replacement under the budget rules, on an open round before its ship-by date (T81).
- **Spend:** `order_is_given` counts an order unless it's `cancelled`, `refunded`, or `failed` **and resolved**. An unresolved failure still counts until it's replaced or closed, which is how a replacement keeps within budget.
- **The daily run never claims an `ordered` round** (`claim_due_rounds` and `due_rounds` leave it out). `closed_at` is set on an `ordered` round only if it went through the deadline close-out. So "open" can't be the test for anything in this ticket; the occasion date is.

### What Zinc sends (checked 2026-11-23)

| Event | What's in it | What we do |
|---|---|---|
| `order.tracking_received` | carrier and tracking number per package, **no estimate** | Save the packages (whitelist below); fetch the estimate (see [Verify]); late check |
| `order.shipped` | once per order, first package moving; all tracking numbers so far | Order → `shipped`; save the packages; fetch the estimate; late check |
| `order.estimated_delivery_updated` | new and previous estimate; **Amazon Business only** | Save the estimate; late check |
| `order.delivered` | every package delivered | Order → `delivered`; round → `delivered` when it's the last |
| `order.cancelled` | the store cancelled after placing; `refund_amount`; Zinc refunds the wallet at once | Order → `failed` / `store_cancelled` (below). **Always handled**, whatever the settings |
| `order.available_for_pickup` | per package | Logged and ignored in the MVP: gifts ship to a home address |

There's no tracking link in the payload. We build one from the carrier's public tracking page (UPS, FedEx, USPS, DHL), with the tracking number URL-encoded. Amazon has no public page by number, so Amazon packages show the status without a link.

### Who it's for and what they can do

1. **See where a gift is:** as a buyer, on the round screen each bought gift shows its status (Ordered, Shipped, Delivered), the expected date when there is one, and a "Track it" link. I don't have to dig through Zinc.
2. **Hear when a gift may be late, and know my options:** as a buyer, when a gift is expected after the occasion, I get one email that says so plainly. It lists what I can actually do: keep it (nothing to do), get something locally for the day and return this one when it arrives, or tell you it already arrived. That way I decide, not the app.
3. **Hear when it's back on time:** as a buyer who was told a gift may be late, I hear again if the estimate moves back in time, so I don't buy something else for nothing.
4. **Handle a store cancellation:** as a buyer, when the store cancels my order, I'm told with an apology and that the money is back in my Zinc wallet. Before the ship-by date I get the usual fix page (next-best idea, every idea, or nothing). After it, I'm told plainly it's too late to ship another in time and what I can do instead.
5. **Mark it arrived myself:** as a buyer, I can tap "It arrived" on a shipped gift, because Zinc's delivered event can be late or missing.
6. **Hear it was delivered:** as a buyer, I get one short email when all my gifts for the occasion have arrived.

### Rules

**Order status moves one way:** `placing`/`unconfirmed` → `placed` → `shipped` → `delivered`. A store cancel moves `placed` or `shipped` to `failed`. Everything else is ignored and logged: an older event after a newer one, a cancel on a `delivered` order, and any event on a `failed` or `cancelled` order. A tracking or shipped event on an order still `placing` or `unconfirmed` means Zinc's `order.placed` was lost. It settles the order as `placed` first (the usual "ordered" email), then applies.

**Round status has one writer:** `reconcile_round` (the ALL-32 rule). It learns one new move: `ordered` → `delivered` when every given order on the round is `delivered`.

**Late means:** the gift's expected date is after the occasion date (`gift_rounds.occasion_date`). Days are UTC calendar days, as in the engine.
- **With a carrier estimate:** the expected date is that estimate, the latest across the order's packages.
- **Without one:** it's the date Zinc placed the order (new `orders.placed_at`, set by `settle_order`) plus the idea's `handling_days_max + delivery_days_max`, the end of the store's own range.
- **With neither:** no check, and an event is logged.
- **Delivered gifts** are never late.

**When it's checked:** on each tracking event above, and in its own daily-run step (like the housekeeping prune) for every `placed` or `shipped` order whose occasion date is today or later.

**Told once:**
- **Late:** each order is told late once (`late:<order id>`).
- **Back on time:** if the estimate later moves back on or before the occasion, the order is told good news (`ontime:<order id>`). Late again after that is told again (`late:2:<order id>`, and so on; owner, 2026-11-24).
- **Not after the day:** nothing is told once the occasion date has passed.
- **Same as failures:** keys are claimed in `round_sends` the same way the failure notices are.

**One daily summary per buyer (owner, 2026-11-23):**
- **Sent from the daily run:** late, back-on-time and store-cancelled-after-ship-by news are told only from the daily run. A webhook saves the new estimate or status straight away, but leaves the telling to the next run.
- **One email per buyer per day:** it lists every gift with news, across all their people and occasions. Bad news comes first, with an apology.
- **One item:** with a single item, the email uses that item's own wording (late, back on time, or store cancelled), like ALL-116's one-or-summary rule.
- **If it fails:** the claimed keys are given back, like `release_failure_notices`, so the next run tries again.
- **Not in the summary:** a store cancel before the ship-by date is told right away through the failure path, because the buyer still has time to choose another gift. The delivered email stays one per occasion, sent when it happens.

**The late email** (tone per `design/ui.md` > Tone in emails, owner 2026-11-23: explain clearly, list the real options):
- **Opens with:** an apology, the gift, its expected date and the occasion date.
- **Then:** it's on its way and can't be cancelled (T18).
- **Then, what you can do:** keep it (nothing to do, it arrives on <date>); get something locally for the day and return this one once it arrives; or **[ It already arrived ]**, the only button, which opens the round screen.
- **No in-app buy** after the ship-by date in this ticket (owner, 2026-11-23). A follow-up ticket adds one if it's wanted.

**It arrived:**
- **When it's allowed:** only on a `shipped` order. On a `placed` one, a mistaken tap could hide a later store cancel.
- **What it does:** moves the order to `delivered` with `delivered_by = 'buyer'`, exactly as the webhook does (`delivered_by = 'zinc'`).
- **How it runs:** a server action on the round screen that re-checks ownership, like ALL-29's.

**Round delivered:** when the last given order is delivered, the round moves to `delivered` and the delivered email goes out once (`delivered:<round id>`), naming every gift.

**Store cancelled** (`order.cancelled`) uses a new function (`settle_order` only handles `placing`/`unconfirmed`):
- **What it records:** the order becomes `failed` with failure type `store_cancelled`, and `failed_at` is set once.
- **Before the ship-by date, with the round open:** the round goes through the usual failure path, `reconcile_round` to `needs_attention` / failed. The failure email and the fix page follow, and the cancelled order's spend is freed once the buyer replaces it or the round closes. The fix page shows a store-cancelled message.
- **On or after the ship-by date, or on a closed round:** the failure is resolved at once (nothing more can be bought in time). It never takes the deadline close-out path, and never sends the "No gift was chosen" or "we couldn't buy it" wording. The buyer gets the store-cancelled email: an apology, that the wallet was refunded, that it's too late to ship another in time, and what they can do instead.
  - **Other gifts on the round:** the round stays `ordered` if it still has another given order.
  - **Its only gift:** the round becomes `skipped`, so nothing will be bought. **[Claude's call]** `skipped` is the right final status; the email is the store-cancelled one.

**Package details kept (T42):** only carrier, tracking number, status, estimated delivery date and Zinc's own public tracking link (`zinc_tracking_url`, found in Get Order) per package (a whitelist). Never Zinc's delivery photo URL or checkpoints. Tracking numbers are cleared by the existing prune step `tracking_prune_days` after the order is delivered (default 30, off when ≤ 0).

**Off switches (E7):**
- **`order_tracking_enabled`** covers tracking, shipped, estimate, delivered and "It arrived".
- **`late_check_enabled`** covers the late check and its emails.
- **What off means:** those events are logged and ignored, the same as today. Store cancellations are never behind a switch: money came back, so the buyer is always told.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A placed order | `order.tracking_received` or `order.shipped` arrives (signed) | Its packages (whitelisted fields only) and the latest estimate are saved; `order.shipped` moves it to `shipped` |
| AC-2 | Any order | The same event arrives twice, or an older event after a newer one | Nothing changes the second time; status never moves backwards |
| AC-3 | An order still `placing` or `unconfirmed` | `order.shipped` arrives | It's settled `placed` (with the "ordered" email), then `shipped` |
| AC-4 | A shipped order whose estimate is after the occasion | The estimate arrives by webhook, then the daily run | The webhook saves it and sends nothing; the daily run sends the late email once, with the options and the "It already arrived" button; the next run sends nothing |
| AC-5 | A placed order with no carrier estimate whose store range ends after the occasion | The daily run | Same as AC-4 |
| AC-6 | A buyer told a gift was late | The estimate moves on or before the occasion | One good-news item in the next daily run; never two |
| AC-6a | One buyer with two late gifts (different people) and one back on time | The daily run | One summary email listing all three, bad news first; each gift is told once |
| AC-6b | The summary email is refused by the email service | The daily run | The keys are given back; the next run sends it |
| AC-7 | Any late or on-time change | The occasion date has passed (UTC) | No email |
| AC-8 | A placed order on an open round before its ship-by date | `order.cancelled` arrives | Order `failed` / `store_cancelled`; one failure email; the fix page offers the next-best idea; after the replacement, the cancelled order's spend no longer counts |
| AC-9 | A placed or shipped order on or after its round's ship-by date | `order.cancelled` arrives, then the daily run | Order `failed` / `store_cancelled`, failure resolved at once; the daily run tells it once (refund, too late to ship another, what to do); round stays `ordered` if another given order remains, else `skipped`; no "No gift was chosen" email |
| AC-10 | A `delivered` order | `order.cancelled` arrives | Ignored and logged; nothing changes |
| AC-11 | A shipped order | The buyer taps "It arrived", or `order.delivered` arrives | Order `delivered` (`delivered_by` buyer or zinc); when it's the round's last given order, round → `delivered` and one delivered email |
| AC-12 | A placed (not shipped) order | The buyer tries "It arrived" | Refused |
| AC-13 | A round with two gifts, one delivered | — | Round stays `ordered`; no delivered email yet |
| AC-14 | The round screen | A bought gift is shown | Status, expected date and a carrier link (none for Amazon) |
| AC-15 | `order_tracking_enabled` or `late_check_enabled` = 0 | Those events or the daily run | Logged and ignored; no change, no email. `order.cancelled` is still handled |
| AC-16 | Another user's order id or webhook id | Any event or "It arrived" tap | Refused; nothing changes |
| AC-17 | A delivered order older than `tracking_prune_days` | The daily run | Its tracking numbers are cleared |

### Out of scope

- **Buying anything after the ship-by date:** an extra gift for a late one, or a replacement for a late store cancel. A follow-up ticket covers both (owner, 2026-11-23).
- **The "how did they like it?" prompt and `delivered` → `complete`:** ALL-34.
- **Asking Zinc daily for every order's status** (approach B below). Add it only if missing webhooks turn out to be real.
- **Returns** (`return.*` events), pickup handling, and a tracking page of our own.

### Open questions

- **Answered:** does `GET /orders/{id}` cost money? Zinc's Get Order docs list no charge; only `/agent/*` calls are priced (checked 2026-11-23), and ALL-32's webhook already calls it. It's called once per tracking event, behind its own switch `zinc_tracking_fetch_enabled`, in case Zinc's bill says otherwise.
- **[Claude's call]** Late risk doesn't move the round to `needs_attention`, though design §5 and §6.6 say it should. A late gift is already bought and nothing more can be done in-app. `needs_attention` brings the deadline close-out and the held/failed reasons, which would act on a round that has a bought gift. The late state lives in `round_sends` and on the round screen instead. Recorded as T89, revising §5 and §6.6.
- **[Claude's call]** One delivered email per round, not one per gift; no shipped email (status shows on the round screen).

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| How a late gift is handled | Explain clearly and list every real option (owner, 2026-11-23) | Owner: "always give the user clear explanation and let them choose from options available to them." A placed order can't be cancelled (T18) |
| Buying after the ship-by date (an extra gift when late, a replacement after a late store cancel) | Not now: tell only, with what they can do instead; follow-up ticket (owner, 2026-11-23) | Today's purchase code stops at the ship-by date. A new money path after it (lease on `ordered` rounds, no holds, one extra per gift) is a bigger, riskier piece than the MVP needs. Revises planning decision 29 and PRD D-4 for the late case |
| No carrier estimate | Order date + the store's own range (owner OK'd) | The real order (spike) never got one |
| "It arrived" button | Yes, on shipped gifts only (owner OK'd; "shipped only" from the review) | Zinc's delivered event lagged on the real order; a tap on a placed gift could hide a later store cancel |
| Store cancelled before ship-by | Same as a failed gift: email + fix page (owner OK'd) | One failure path (T81) |
| One email per gift, or combined? | Combined: late, back-on-time and after-ship-by cancel news go in one daily summary per buyer; a one-item summary uses that item's own email (owner, 2026-11-23) | Matches the owner's ALL-116 rule (one summary, not a burst). Nothing can be bought for these, so a day's wait costs nothing |
| Store cancel before ship-by that's never replaced: the deadline email | The store-cancelled wording, not "No gift was chosen" (owner, 2026-11-23, from the plan review) | It says what really happened |
| Refund amount in store-cancel emails | Zinc's own `refund_amount` from the cancel event, stored on the order (owner, 2026-11-23, final review) | It's what actually came back, so no claim about fees |
| Two emails to one buyer on one day (held gift + late cancel; summary + deadline cancel) | Accepted for the MVP (owner, 2026-11-23) | Both rare, each email truthful |
| Ideas list on a bought round | Drops the gifts already under "Your gifts" (owner, 2026-11-23) | No duplicate list; the rest stays as history |
| How it's built | Subagent-driven: a fresh implementer and reviewer per task, then a whole-branch review (owner, 2026-11-23) | It touches money-path status and `reconcile_round` |
| Mock-ups | Signed off 2026-11-23: [ALL-33 mock-ups](https://claude.ai/artifact/64XUHT7xfzaibNtWtWpSXx) | — |
| Approach | A: extend the webhook and daily run; no daily polling (owner, 2026-11-23) | Polling returns the same stale data at a cost. Add B only if needed |

## Approaches considered

- **A. Extend what's there (chosen).** The existing webhook handler learns five events. Order status moves one way. One late check is shared by the webhook and its own daily-run step. Notices are sent once per key, like ALL-116. The one buyer action is a server action on the round screen, and new paths have off switches.
- **B. A plus a daily status fetch per order from Zinc.** It would catch dropped webhooks. Rejected for now: the real order's lag was in Zinc's own data, so polling adds a paid call per gift per day for no new information (E1). It's the fallback if dropped webhooks show up.
- **C. A separate tracking worker or queue.** Rejected: E1, no reason that qualifies.

## Principles check

- **Simplest version?** What we cut:
  - any buying after the ship-by date;
  - daily polling, returns and pickup;
  - per-gift delivered emails and a shipped email;
  - moving the round to `needs_attention` for lateness.
- **Hard-coded values?** New `app_settings`: `order_tracking_enabled`, `late_check_enabled`, `tracking_prune_days`. Carrier tracking-page URLs are true constants.
- **Product boundaries?** All inside `modules/concierge`; no other product's tables.
- **Schema changes** (one migration, then `pnpm db:map`):
  - `orders.placed_at` (backfilled from `updated_at` for existing placed orders) and `orders.delivered_by` (`zinc` | `buyer`);
  - `store_cancelled` in `orders_failure_type_check` and in `reconcile_round`'s failure handling;
  - `late:`, `ontime:` and `delivered:` in `round_sends_step_check`;
  - the new email kinds in `notifications_kind_check`;
  - `reconcile_round`'s `ordered` → `delivered` move;
  - the store-cancel function;
  - the three settings.
- **New personal data?** Tracking numbers per package (in `orders.packages`), needed for the "Track it" link while the gift is on its way. Cleared `tracking_prune_days` after delivery. No delivery photos or checkpoints are stored. Events carry ids only (E6).
- **Docs and decisions:**
  - T89 in `design/decisions.md`: late risk lives on the order, not the round status, and there's no buying after ship-by.
  - Planning decision 29's late case, revised in `planning/decisions.md`.
  - `technical-design.md` §5 and §6.6.
  - The round engine page (`ordered` → `delivered` is now real).
  - `design/ui.md` for the four emails, and `operations.md` for the three settings.

## Mock-ups

Before the plan:
- **Emails**, rendered through `renderEmail`: the late email, the on-time email, the delivered email, and the store-cancelled email in both versions (before ship-by with the fix page; after it, tell only).
- **The round screen:** the bought-gift status line and the "It arrived" button, on a phone, in light and dark.

They're shared for the owner's sign-off.

## Plan

**Architecture:**
- **One migration** carries the data and the SQL rules:
  - the new columns, settings and check values;
  - order moves that only go forward (`record_tracking`, `mark_delivered`, `store_cancel_order`);
  - `reconcile_round`'s `ordered` → `delivered` move;
  - claim and release for the per-order news keys.
- **Pure date and link rules** live in `packages/core/src/tracking.ts`.
- **Zinc events:** the webhook (`zinc/events.ts`) passes the new events to `zinc/tracking-events.ts`.
- **Daily run:** it gets two steps, the per-buyer news summary (`tracking/news.ts`) and a retry for delivered emails.
- **Round screen:** a status line per bought gift and an "It arrived" server action.

**Tech stack:** Supabase SQL and pgTAP; TypeScript in `packages/core`, with Vitest; `apps/web/modules/concierge`, with Vitest unit and local-db tests; Next.js server actions; Playwright.

**Branch and worktree:** `aarontallen/all-33-tracking` in `.claude/worktrees/all-33`. One PR titled `feat: order tracking, late-gift news and store cancels (ALL-33)`, with the body `Part of ALL-33`. The live check comes after the merge.

### Global constraints

- **Order status moves forward only:**
  - `placing`/`unconfirmed` → `placed` → `shipped` → `delivered`;
  - `placed`/`shipped` → `failed` (store cancel only);
  - anything else is a no-op and is logged as `tracking.event_ignored` with the order id and the status it was in.
- **Round status writer:** only `reconcile_round` writes round status.
- **Days:** UTC calendar days (`now.toISOString().slice(0, 10)`), as in the engine.
- **Settings (T23), seeded by the migration:**
  - `order_tracking_enabled` = 1;
  - `zinc_tracking_fetch_enabled` = 1, which turns off the one `GET /orders` fetch per tracking event;
  - `late_check_enabled` = 1;
  - `tracking_prune_days` = 30 (off when ≤ 0).
- **No fallback values:** none of these is read with a default in code. A missing setting throws, like `appSettingInt`.
- **Logs:** events carry ids only (E6). No tracking numbers, carriers' URLs, names or addresses in logs.
- **Package whitelist:** stored per package are `carrier`, `tracking_number`, `status`, `estimated_delivery_date` and `tracking_url` (Zinc's `zinc_tracking_url` only). Never `delivery_proof_url`, `checkpoints` or any location field.
- **Email copy:** as in the signed-off [mock-ups](https://claude.ai/artifact/64XUHT7xfzaibNtWtWpSXx), through `renderEmail`. Bad news opens with "We're sorry." and ends with "What happens next" or "What you can do" (`design/ui.md` > Tone in emails).
- **Store cancels are always handled,** whatever the two switches say.

### Review focus

The five failure modes no task would otherwise test, each pinned by a test in the task named.

1. **Two copies of the same event at once** (Zinc retries while the first is still running). Exactly one change and no double email. The round lock taken first by every writer is what guarantees it. *Task 3: `two copies of the same event at once change the order once`, `the same shipped event twice saves once`.*
2. **The buyer taps "It arrived" and then `order.cancelled` arrives** (the store cancels a delivered gift). The cancel is refused, and the round stays `delivered`. *Task 1: `store_cancel_order on a delivered order changes nothing`.*
3. **A gift ordered across midnight UTC, or an occasion today.** The occasion counts as not yet passed on its own day, and the gift isn't late when the expected date equals the occasion date. *Task 2: `expected on the occasion day is not late`, `an occasion today still gets news`.*
4. **A buyer with news on two rounds when the email service fails.** Both rounds' keys are given back, and the next run sends one summary. *Task 5: `refused summary releases every claimed key across rounds`.*
5. **A Zinc package with a delivery photo and checkpoints.** Neither is saved. *Task 2: `packagesFromZinc keeps only whitelisted fields`.*

### Task 1: Migration, SQL rules and pgTAP (AC-2, AC-8 to AC-13, AC-15 to AC-17)

**Files:**
- Create: `supabase/migrations/20261124100000_order_tracking.sql`
- Create: `supabase/tests/order_tracking.test.sql`
- Modify: `packages/core/src/database.types.ts` (`pnpm db:types`), `design/database-map.html` (`pnpm db:map`), `supabase/tests/code_column_checks.test.sql` (new values)

**Interfaces (produces):**
- **Columns:**
  - `orders.placed_at timestamptz`, backfilled from `updated_at` for orders that are `placed`, `shipped` or `delivered`.
  - `orders.delivered_at timestamptz`.
  - `orders.delivered_by text check (delivered_by in ('zinc','buyer'))`.
  - `orders.tracking_event_at timestamptz`, the time of the newest Zinc event applied.
- **Grants:** select on `placed_at`, `delivered_at` and `delivered_by` for `authenticated`, since order columns are granted one by one (T56).
- **Lock order:** every new function locks the round row `for update`, then the order `for update`, as `settle_order` does. Because both writers take the round lock first, a webhook and an "It arrived" tap run one after the other.
- **Check values:**
  - `orders_failure_type_check` gains `store_cancelled`.
  - `notifications_kind_check` gains `tracking_news`, `gift_late`, `gift_on_time`, `store_cancelled_late` and `delivered`.
  - `round_sends_step_check` gains the fixed step `delivered` and the pattern `^(late|ontime|cancel_late):<uuid>$`.
- **`settle_order`:** also sets `placed_at = coalesce(placed_at, now())` when it settles `placed`.
- **`concierge.record_tracking(p_user_id uuid, p_order_id uuid, p_shipped boolean, p_packages jsonb, p_est date, p_event_at timestamptz) returns text`:**
  - **Packages:** `p_packages` is merged into the stored packages by tracking number: new ones are added and known ones updated. Nothing is ever removed.
  - **Estimate:** `p_est` replaces `est_delivery_date` only when `p_event_at` is not older than `tracking_event_at`, so a late, older event can't bring back a stale date. `tracking_event_at` then becomes `p_event_at`.
  - **Shipped:** `p_shipped` moves `placed` to `shipped`.
  - **Returns:** the order's status after the call, or `null` if it isn't theirs.
  - **Allowed on** `placed` and `shipped` only. On any other status it changes nothing and returns that status.
- **`concierge.mark_delivered(p_user_id uuid, p_order_id uuid, p_by text) returns table(round_status concierge.round_status, applied boolean)`** (`applied` is false for a no-op, so callers can log `tracking.event_ignored`):
  - **With `p_by = 'buyer'`:** allowed only on `shipped`.
  - **With `p_by = 'zinc'`:** allowed on `placed` or `shipped`.
  - **What it does:** sets `delivered`, `delivered_at = now()` and `delivered_by`, then `reconcile_round`.
  - **Otherwise:** a no-op that returns the round's status.
- **`concierge.store_cancel_order(p_user_id uuid, p_order_id uuid, p_today date, p_refund_cents integer) returns table(round_status concierge.round_status, applied boolean)`:**
  - **When it acts:** on `placed` or `shipped`. On `placing` or `unconfirmed` (a lost `order.placed`), it first sets `placed` and `placed_at`. It refuses (no-op) on anything else.
  - **What it does:** `fail_order_row(order, 'store_cancelled')`.
  - **Too late:** if `p_today >= ship_by_deadline` or the round's `closed_at` is set, it also sets `resolved = true` and **`failed_after_close = false`**. `fail_order_row` sets that flag on closed rounds, and leaving it would send the "we couldn't buy it, you haven't been charged" email for a gift that was bought. It then calls `reconcile_round(round, 'deadline')` when no given order remains on the round, which leads to `skipped`. Otherwise it calls `reconcile_round(round)`.
  - **Otherwise:** `reconcile_round(round)`, which leads to `needs_attention` / failed.
- **`reconcile_round`:** the status becomes `delivered` and `next_action_at` becomes `null` when all of these hold:
  - there's no unconfirmed, held, unresolved-failed or placing order;
  - at least one order is `delivered`;
  - every given order is `delivered`.

  This check comes before the `v_placed` → `ordered` branch.
- **`concierge.delivered_rounds_untold()`:** returns `(round_id, user_id)` for `delivered` rounds with no `delivered` step in `round_sends`. It's for Task 6's retry.
- **`concierge.tracking_candidates(p_today date)`:** returns rows `(user_id, round_id, order_id, person_name, occasion_kind, occasion_date, title, status, est_delivery_date, placed_at, handling_days_max, delivery_days_max, total_cents, failure_type, resolved, sent_steps text[])`. It covers:
  - orders `placed`/`shipped` whose `occasion_date >= p_today`;
  - orders that are `failed`, `store_cancelled`, `resolved` and not `failed_after_close`, with neither `fail:<id>` nor `cancel_late:<id>` sent. This leaves out a store cancel that was told through the fix page before the ship-by date, and one the deadline close-out handed to the "couldn't buy it" email. Test: `tracking_candidates skips a store cancel already told as a failure`.
- **Claim and release:** no new SQL. Tasks 5 and 6 use the existing `store.recordSend(roundId, userId, step)` and `store.forgetSend(roundId, step)`, which upsert a `round_sends` key, ignore duplicates and delete it again (E2). The `StepKey` type in `rounds/store.ts` gains `delivered` and `` `${"late" | "ontime" | "cancel_late"}:${string}` `` (Task 5).
- **`concierge.prune_tracking_numbers()` returns integer:** sets `packages = '[]'` on orders delivered more than `tracking_prune_days` ago (by `delivered_at`), on failed orders by `failed_at`, and on placed or shipped orders whose occasion is that long past. It returns 0 when the setting is ≤ 0.
- **Grants:** every new function is `security definer`, `set search_path = ''`, revoked from `public`/`anon`/`authenticated` and granted to `service_role`. The round screen's "It arrived" calls `mark_delivered` through the server, with the user id from the session.

- [ ] **Step 1: Write the failing pgTAP file** `order_tracking.test.sql`, with one assertion per line below:
  - **record_tracking:**
    - `record_tracking placed → shipped saves packages and estimate`
    - `record_tracking twice in one transaction is a no-op the second time`
    - `record_tracking on delivered/failed/cancelled changes nothing`
    - `record_tracking for another user's order returns null`
  - **mark_delivered:**
    - `mark_delivered by buyer refused on placed`
    - `mark_delivered by zinc on placed sets delivered`
    - `last given order delivered moves round to delivered`
    - `one of two delivered keeps round ordered`
  - **store_cancel_order:**
    - `store_cancel_order before ship-by → needs_attention, unresolved`
    - `store_cancel_order after ship-by with another given order → ordered, resolved`
    - `store_cancel_order after ship-by, only gift → skipped, resolved, closed_at set`
    - `store_cancel_order on a delivered order changes nothing`
    - `a resolved store_cancelled order is not given`
  - **settle_order:** `settle_order placed sets placed_at once`
  - **More record_tracking:**
    - `record_tracking merges packages by tracking number`
    - `an older event does not overwrite a newer estimate`
  - **More store_cancel_order and reconcile:**
    - `store_cancel_order on a closed ordered round leaves failed_after_close false`
    - `store_cancel_order on placing settles placed first`
    - `a round with only cancelled orders is not moved to delivered`
  - **Delivered and candidates:**
    - `delivered_rounds_untold lists a delivered round until its delivered step exists`
    - `tracking_candidates skips a store cancel already told as a failure`
  - **Grants on the new columns:** `authenticated can read placed_at, delivered_at, delivered_by on its own orders`
  - **Pruning:**
    - `prune_tracking_numbers clears packages 30 days after delivered_at, not before`
    - `prune clears a failed order's packages by failed_at`
    - `prune is off at 0`
  - **Check values:** `round_sends accepts late:/ontime:/cancel_late:<uuid> and delivered`
  - **Grants:** `authenticated cannot execute the new functions`
- [ ] **Step 2: Run** `pnpm db:test`. Expected: the new file FAILS (functions missing).
- [ ] **Step 3: Write the migration** to the interfaces above. Redefine `settle_order` and `reconcile_round` with `create or replace`, copying the current bodies (`20261109100000`, `20261114100000`) and changing only what's stated.
- [ ] **Step 4: Run** `pnpm db:reset && pnpm db:test && pnpm db:types && pnpm db:map`. Expected: all pass, and the types and map are regenerated.
- [ ] **Step 5: Commit** `feat(db): order tracking columns, forward-only moves, store cancel and news keys (ALL-33)`.

### Task 2: Pure tracking rules in `packages/core` (AC-4 to AC-7, AC-14)

**Files:** Create `packages/core/src/tracking.ts` and `packages/core/src/tracking.test.ts`; export them from `packages/core/src/index.ts`.

**Interfaces (produces):**
- `type TrackedPackage = { carrier: string; trackingNumber: string; status: string | null; estimatedDeliveryDate: string | null; trackingUrl: string | null }`
- `packagesFromZinc(raw: unknown): TrackedPackage[]`: a zod-parsed whitelist that drops bad entries.
- `latestEstimate(p: TrackedPackage[]): string | null`
- `expectedArrival(o: { estDeliveryDate: string | null; placedAt: string | null; handlingDaysMax: number | null; deliveryDaysMax: number | null }): { date: string; source: "carrier" | "store_range" } | null`
- `isLate(expected: string, occasionDate: string): boolean`: strictly after.
- `trackingNews(o: { expected: string | null; occasionDate: string; today: string; sentLate: boolean; sentOnTime: boolean }): "late" | "on_time" | null`
  - **No news** once `today > occasionDate`.
  - **`on_time`** only when `sentLate && !sentOnTime` and the gift is no longer late.
- `trackingLink(p: TrackedPackage): string | null`:
  - **Zinc's link first:** `p.trackingUrl` when it's an `https:` URL.
  - **Otherwise:** a link built from the carrier constant `CARRIER_TRACKING`, with the number URL-encoded:
    - `ups`: `https://www.ups.com/track?tracknum=`
    - `fedex`: `https://www.fedex.com/fedextrack/?trknbr=`
    - `usps`: `https://tools.usps.com/go/TrackConfirmAction?tLabels=`
    - `dhl`: `https://www.dhl.com/us-en/home/tracking.html?tracking-id=`
  - **Amazon and unknown carriers:** `null`.

- [ ] **Step 1: Write failing tests** in `tracking.test.ts`:
  - **Whitelist:** `packagesFromZinc keeps only whitelisted fields` (the input carries `delivery_proof_url`, `checkpoints` and `city`; the output has none).
  - **Estimates:**
    - `latestEstimate picks the latest date`
    - `expectedArrival prefers the carrier estimate`
    - `expectedArrival without an estimate adds handling and delivery max to placed_at`
    - `expectedArrival with nothing is null`
  - **Lateness:**
    - `expected on the occasion day is not late`
    - `one day after is late`
  - **News:**
    - `an occasion today still gets news`
    - `no news after the occasion`
    - `on_time only after late was sent`
  - **Links:**
    - `trackingLink encodes the number`
    - `amazon has no link`
    - `zinc's https link wins`
    - `a non-https zinc link is ignored`
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/core test tracking`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): tracking dates, late rule and carrier links (ALL-33)`.

### Task 3: Zinc tracking, shipped, estimate and delivered events (AC-1 to AC-3, AC-11, AC-15, AC-16)

**Files:**
- Create: `apps/web/modules/concierge/zinc/tracking-events.ts`
- Modify: `apps/web/modules/concierge/zinc/signature.ts` (parse `data.tracking_numbers`, `data.estimated_delivery`), `apps/web/modules/concierge/zinc/events.ts` (dispatch), `apps/web/lib/wiring.ts` (deps)
- Test: `apps/web/modules/concierge/__tests__/zinc-tracking-events.test.ts` (local-db, real Supabase and fake Zinc HTTP, like `zinc-events.test.ts`)

**Interfaces:**
- **Consumes:** Task 1's `record_tracking`, `mark_delivered` and `settle_order`; Task 2's `packagesFromZinc` and `latestEstimate`; `findOurOrder` and `call` from `zinc/events.ts` / `zinc/client.ts`.
- **Produces:** `handleTrackingEvent(userId: string, event: ZincEvent, deps: TrackingDeps): Promise<void>`, where `TrackingDeps = ZincDeps & { setting: (key: string) => Promise<number>; orderPlaced?: (roundId: string) => Promise<unknown>; tellDelivered?: (roundId: string) => Promise<unknown> }`.
- **Behaviour:**
  - **Gate:** `order_tracking_enabled` ≠ 1 → `tracking.event_ignored` (reason `off`), and return.
  - **Lost `order.placed`:** if the order is `placing`/`unconfirmed`, first `settle_order(..., 'placed', …)` and call `orderPlaced(roundId)`.
  - **Tracking received or shipped:**
    - **Fetch:** with `zinc_tracking_fetch_enabled` = 1 (a new setting, seeded at 1 in Task 1), `tracking_received` and `shipped` fetch `GET /orders/{id}` once with the user's key, the same pattern as `findOurOrder`.
    - **If the fetch is off or fails:** the packages are saved from the event without an estimate.
    - **Then:** `record_tracking(…, shipped = event is order.shipped, packages, latestEstimate, event time)`.
    - **Cost:** Zinc's Get Order docs list no charge. Only `/agent/*` calls are priced, and ALL-32's webhook already calls it. The switch turns it off if Zinc's bill says otherwise.
  - **Estimate updated:** `estimated_delivery_updated` → `record_tracking(…, false, null, date part of data.estimated_delivery, event time)`.
  - **Delivered:** `order.delivered` → `mark_delivered(…, 'zinc')`. If the result is `delivered`, `tellDelivered(roundId)` (Task 6). A throw is logged and doesn't fail the webhook.
  - **Pickup:** `available_for_pickup` → log `tracking.event_ignored` (reason `pickup`).
  - **Log:** `tracking.order_updated` with `{ user_id, order_id, event, status }`.

- [ ] **Step 1: Write failing tests:**
  - `shipped saves whitelisted packages and the fetched estimate`
  - `the same shipped event twice saves once`
  - `shipped on a placing order settles it placed first and sends the ordered email`
  - `estimate updated saves the new date`
  - `delivered moves the round to delivered and calls tellDelivered once`
  - `off switch logs and changes nothing`
  - `another user's webhook id is 401` (reuse the existing guard test pattern)
  - `estimate fetch failing still saves packages`
  - `zinc_tracking_fetch_enabled = 0 saves packages without fetching`
  - `a late shipped event sends no email itself (news waits for the daily run)`
  - `two copies of the same event at once change the order once` (two parallel calls on the local database: the round lock serializes them)
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test:db zinc-tracking-events`. Expected: FAIL.
- [ ] **Step 3: Implement.** Extend `parseEvent` with optional `trackingNumbers: unknown` and `estimatedDelivery?: string`. In `handleZincWebhook`, dispatch `order.tracking_received|shipped|estimated_delivery_updated|delivered|available_for_pickup` to `handleTrackingEvent`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: save Zinc tracking, estimates and deliveries (ALL-33)`.

### Task 4: Store cancellations (AC-8 to AC-10, AC-15)

**Files:**
- Modify: `zinc/events.ts` (handle `order.cancelled`, outside the tracking switch); `rounds/money-path.ts` (`lateDetail` and `openRow` gain a `store_cancelled` case); `app/rounds/[id]/fix/[orderId]/fix-screen.tsx` and `app/rounds/outcome.tsx` (`WHAT_HAPPENED` / outcome entries for `store_cancelled`)
- Test: add to `zinc-tracking-events.test.ts`, the fix-screen and outcome component tests, and `round-engine-failures.test.ts`

**Interfaces:** `order.cancelled` → `store_cancel_order(userId, orderId, today, refundCents)`, where `refundCents` is Zinc's `refund_amount` (cents), stored as `orders.refund_cents` and shown in the emails (null → no amount).
- **Returns `needs_attention`:** call `advanceRound(roundId)`, as `order.failed` does, so the failure email goes out now.
- **Returns `delivered`:** the remaining gifts all arrived, so call `tellDelivered(roundId)` (Task 6).
- **The round was past its ship-by date:** nothing is sent now. The daily summary tells it (Task 5).
- **Deadline close-out** (`closeAtDeadline` in `money-path.ts`): when a round ends `skipped` and has a resolved `store_cancelled` order, it sends the store-cancelled wording instead of "No gift was chosen". It records `cancel_late:<id>` for each such order, so the summary doesn't tell it again (owner decision below).

**Copy:**
- **Open-round row:** "The store cancelled it, and the money is back in your Zinc wallet. Choose another gift."
- **`lateDetail`:** "The store cancelled it, and the money is back in your Zinc wallet."
- **Fix screen:**
  - title: "The store cancelled it"
  - body: "The money is back in your Zinc wallet. Choose another gift."

- [ ] **Step 1: Write failing tests:**
  - `cancel before ship-by emails the failure with the store wording and the fix link`
  - `cancel after ship-by sends nothing now and leaves the order resolved`
  - `cancel on a delivered order is ignored`
  - `cancel is handled with order_tracking_enabled = 0`
  - `fix screen shows the store-cancelled message`
  - `after the replacement the cancelled order no longer counts toward the budget` (local-db, through `replace_failed_order`)
  - `cancel on an ordered round with closed_at set gives one store_cancelled_late email and no failed_late`
  - `cancel on a placing order settles it placed, then cancels`
  - `cancel leaving every other gift delivered sends the delivered email`
  - `ship-by-day race: a told failure plus a store cancel ends skipped with the store wording, once, and no "No gift was chosen"`
- [ ] **Step 2: Run** the affected tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: store-cancelled gifts are told and can be replaced before ship-by (ALL-33)`.

### Task 5: The daily news summary (AC-4 to AC-7, AC-6a, AC-6b, AC-9, AC-15)

**Files:**
- Create: `apps/web/modules/concierge/tracking/news.ts`
- Modify: `notify/templates.ts` (kinds `tracking_news`, `gift_late`, `gift_on_time`, `store_cancelled_late`, plus samples), `notify/samples.ts`, `rounds/engine.ts` (`EngineDeps.trackingNews?: () => Promise<{ sent: number }>`, run after `pruneActionLinks` as its own try/catch step), `rounds/store.ts` + its Supabase implementation (`trackingCandidates`; claims use the existing `recordSend` / `forgetSend`), `lib/wiring.ts`
- Test: `apps/web/modules/concierge/__tests__/tracking-news.test.ts` (local-db) and the template tests

**Interfaces:**
- **Produces:** `runTrackingNews(deps: { store: RoundStore; notify: NotifyDeps; today: string; setting: (k: string) => Promise<number> }): Promise<{ sent: number }>`.
- **Algorithm:**
  1. Read the candidates.
  2. Each resolved store-cancelled order gives `cancel_late:<id>`, whatever the switch says. For each placed or shipped order, `late_check_enabled` is read; when it's 1, work out `trackingNews(...)` → step `late:<id>` or `ontime:<id>`. The setting is read only in this branch, so a missing setting can't block cancel news; there it's logged and skipped.
  3. Group by `user_id`.
  4. For each user, claim each step with `recordSend`, keeping only those it newly recorded.
  5. With one item, send its own kind (`gift_late` / `gift_on_time` / `store_cancelled_late`). Otherwise send `tracking_news` with rows ordered late, cancelled, then on time.
  6. On a refused send or a throw, release every claimed step for that user across rounds (`forgetSend`) and log `tracking.news_failed` (`alert: true`).
  7. Log `tracking.news_sent` with `{ user_id, items }`, where `items` is a count (E6).
- **Links:**
  - `gift_late`'s "It already arrived" button: `{ path: "/rounds/<id>" }`, only when the order is `shipped`.
  - Summary rows: a link to the same path on shipped late items.
- **Copy:** each template's copy is exactly as in the mock-ups, with dates via the existing `longDate` helper.

- [ ] **Step 1: Write failing tests:**
  - **Late and on time:**
    - `late shipped gift is told once, with the arrived button`
    - `late placed gift without estimate is told without the button`
    - `back on time after late is told once`
    - `nothing after the occasion`
  - **Grouping:**
    - `two late gifts on two rounds plus one on time make one summary, bad news first`
    - `refused summary releases every claimed key across rounds`
  - **Switches and cancels:**
    - `late_check_enabled = 0 sends no late or on-time news but still tells a late store cancel`
    - `cancel_late is told once with the store-cancelled wording and no button`
  - **Templates:** each new kind renders the mock-up's heading and subject.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @gifts-af/web test:db tracking-news && pnpm --filter @gifts-af/web test templates`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: one daily summary of late, back-on-time and late-cancel news per buyer (ALL-33)`.

### Task 6: Delivered email and its retry (AC-11, AC-13)

**Files:** Create `apps/web/modules/concierge/tracking/delivered.ts`. Modify `notify/templates.ts` (kind `delivered`), `rounds/engine.ts` (a retry step for delivered rounds without the `delivered` step, beside `retryOrderedEmails`) and `lib/wiring.ts`. Tests go in `tracking-delivered.test.ts` (local-db).

**Interfaces:**
- **Produces:** `tellDelivered(roundId: string, deps: { store: RoundStore; notify: NotifyDeps }): Promise<"sent" | "none" | "refused">`.
- **How it sends:** it claims `delivered` with `recordSend`, sends the email (listing every delivered order's title and `delivered_at` date) and releases the key with `forgetSend` on a refusal.
- **Retry:** the tick's retry calls it for each row of `delivered_rounds_untold()` (Task 1), through a new `store.deliveredRoundsUntold()`.

- [ ] **Step 1: Write failing tests:**
  - `delivered email names every gift and is sent once`
  - `refused delivered email is retried by the next tick`
  - `round with one gift still shipped gets no delivered email`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: delivered email once all of an occasion's gifts arrive (ALL-33)`.

### Task 7: Round screen status line and "It arrived" (AC-12, AC-14, AC-16)

**Files:**
- Modify:
  - `modules/concierge/rounds/approval.ts`:
    - `RoundPageOrder` gains `status`, `placedAt`, `deliveredAt`, `packages: TrackedPackage[]`, `handlingDaysMax` and `deliveryDaysMax`;
    - `liveOrders` keeps delivered orders;
    - a new `storeCancelled: RoundPageOrder[]` keeps resolved `store_cancelled` orders, which the failed list drops, so a late cancel still shows.
  - `app/rounds/[id]/round-screen.tsx`: a "Your gifts" list of live and store-cancelled orders, above the ideas, when any exist.
  - `app/rounds/actions.ts`: `markArrived(roundId: string, orderId: string): Promise<{ ok: boolean }>`. It validates with zod and takes the user from the session. It refuses when `order_tracking_enabled` ≠ 1 (and the button is hidden then). It calls `mark_delivered(…, 'buyer')`, then `tellDelivered` when that returns `delivered`.
- Test: the round-screen component test, `__tests__/mark-arrived.test.ts` (local-db) and `e2e/tracking.spec.ts`

**Status line, per the mock-ups:**
| Order | Line | Extras |
|---|---|---|
| shipped | `Shipped · due <short date> · Track it ↗` | The link opens in a new tab and is omitted when `trackingLink` is null. The "It arrived" button shows. |
| late (expected after the occasion) | An amber chip, `May arrive <short date> · <n> days late` | — |
| placed | `Ordered · usually arrives by <date>` | The date comes from `expectedArrival` with source `store_range`. There's no button. |
| delivered | `Delivered <date>` | — |
| failed `store_cancelled` | The existing failed-gift card, with the store-cancelled copy from Task 4 | — |

- [ ] **Step 1: Write failing tests:**
  - **Component:** one test per row of the table, plus `no It arrived on a placed gift`.
  - **local-db:**
    - `markArrived on someone else's order is refused`
    - `markArrived with order_tracking_enabled = 0 is refused`
    - `a late store cancel shows on the round screen`
    - `markArrived on placed is refused`
    - `markArrived last gift → round delivered and one delivered email`
  - **e2e** (`tracking.spec.ts`, iPhone; `@layout` for the light/dark check): seed a round with a shipped order with packages, see the line and the link, tap "It arrived", and see "Delivered".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm test:db && pnpm --filter @gifts-af/web e2e tracking`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: bought gifts show where they are, with It arrived (ALL-33)`.

### Task 8: Prune, wiring, docs and pages (AC-17, E7, E10)

**Files:**
- Modify: `rounds/engine.ts` and `lib/wiring.ts` (a `pruneTrackingNumbers` housekeeping step logging `housekeeping.tracking_pruned`)
- Docs:
  - `design/technical-design.md`: §5 (the `ordered` → `delivered` row, T89) and §6.6 (as built);
  - `design/ui.md`: the five emails and the status line;
  - `design/operations.md`: the three settings under the switches table, and a runbook line for `tracking.news_failed`.
- Pages: the round engine page and the screens and emails page (`pnpm gallery`), republished per CLAUDE.md.
- Test: a tick test, `prune step runs and logs`.

- [ ] **Step 1: Write the failing tick test.**
- [ ] **Step 2: Implement the wiring** and run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build && pnpm db:map:check`. Expected: all pass.
- [ ] **Step 3: Update the docs, then republish the two pages** (the database map publishes after merge, by the hook).
- [ ] **Step 4: Commit** `docs: tracking in the design, UI and operations docs (ALL-33)`.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test.
- [x] Every task traces back to a story or criterion (nothing extra).
- [x] No open questions are left.
- [x] Adversarial review of the spec done (2026-11-23: 3 blockers, 7 should-fix, all folded in above; the owner's call on buying after ship-by). Again of the plan (2026-11-23: 2 blockers, 11 should-fix, 6 nits, all folded in; the owner's call on the deadline wording).

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of the round screen status line and the emails; mock-ups uploaded.
- [ ] Live check after deploy: a real order's tracking events in the prod log, the status line on giftsaf.com, and a delivered round. Otherwise listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

- **Ordering races:** a tracking event racing the daily run or "It arrived". Status moves one way, and each notice is sent once.
- **Late cancels:** a store cancel after ship-by must never reach the deadline close-out or the "No gift was chosen" email.
- **Cancel after delivery:** a cancel after "It arrived" or `delivered` is refused.
- **Spend:** a store-cancelled order's spend is freed only once it's resolved, and the replacement keeps within budget.
- **Ownership:** another user's webhook or order id is refused.
- **Personal data:** a `packages` payload with a delivery photo URL saves only the whitelisted fields.
