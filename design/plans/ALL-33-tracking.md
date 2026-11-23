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
- **Back on time:** if the estimate later moves back on or before the occasion, the order is told good news once (`ontime:<order id>`).
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

**Package details kept (T42):** only carrier, tracking number, status and estimated delivery date per package (a whitelist). Never Zinc's delivery photo URL or checkpoints. Tracking numbers are cleared by the existing prune step `tracking_prune_days` after the order is delivered (default 30, off when ≤ 0).

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

- **[Verify]** Does `GET /orders/{id}` cost money? Zinc's docs don't say. Check on dev first. If it's free, call it once on `tracking_received` and `shipped` for the carrier estimate. If it costs money, drop it: the late check then uses the store's range plus Zinc's `estimated_delivery_updated`. **[Claude's call]**
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

_To be written after the owner signs off the mock-ups._

## Before coding: consistency check

- [ ] Every acceptance criterion maps to a task and a test.
- [ ] Every task traces back to a story or criterion (nothing extra).
- [ ] No open questions are left.
- [x] Adversarial review of the spec done (2026-11-23: 3 blockers, 7 should-fix, all folded in above; the owner's call on buying after ship-by). Again of the plan.

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
