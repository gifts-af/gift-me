# ALL-98 Pay by card through Zinc Connect: Spec (approved by the owner, 2026-11-25; build started 2026-11-27)

**Goal:** a buyer saves a card once, and each gift is one charge from GiftsAF: the gift plus one "GiftsAF fee" line.

**Links:** ALL-98; planning decisions 58 and 59; T16, T56, T61; design §6.5a; [Zinc Connect](https://www.zinc.com/docs/v2/connect). Built last, before friends join (owner, 2026-11-25).

## Why

A typical buyer won't keep $100 parked in a Zinc account (owner). Friends join only once this ships.

## Decided

| Question | Answer | Who |
|---|---|---|
| What happens to wallets? | Hidden from new buyers. Existing wallet accounts keep theirs. Moving them and deleting the code is later work | Owner, 2026-11-25 |
| Where is the card entered? | Stripe's own page, then back to the gift. Revises 59's "inline" | Owner, 2026-11-25 |
| First fixed part | $2.00, from estimates. ALL-76 sets the final amount. A setting (T23) | Owner, 2026-11-25 |
| After a declined, removed or replaced card | The buyer adds a card, then taps Buy again. **Saving a card never buys anything** | Owner, 2026-11-25 (replaces "saving a new one buys the waiting gift") |
| Removing a card mid-purchase | Refused while an order is `placing`; allowed while one is only `unconfirmed`, since the hold is already on the card | Owner, 2026-11-25; revised 2026-11-27 |
| Wallet buyers and shared addresses | Not blocked: the only wallet buyers are the owner and Jim | Owner, 2026-11-25 |
| Store cancels | We refund everything and absorb Stripe's fee | Owner, 2026-11-25 |
| A decline Zinc doesn't tell apart | Today's "couldn't buy it" page | Owner, 2026-11-25 |
| Which Zinc account | The current one, for the test and for launch. The risk that a bug could spend its wallet is accepted. A Zinc account has one webhook, so at launch the owner pays by card too and their wallet connection is removed | Owner, 2026-11-25 |
| Cards | US only at launch if card fees vary | Owner, 2026-11-25 |
| Proof before building | Zinc Connect can't use a Stripe sandbox (tested 2026-11-25). Unproven parts are assumptions (A1 to A4 below). **Revised 2026-11-27: build now, alongside other work, despite the scope freeze's "last"** (owner, relayed by the lead session; **not yet in CLAUDE.md's scope-freeze exceptions: the owner adds it**). Everything ships off (`connect_enabled` 0). **The real card order (under $25, on the owner's account, a gift the owner wants to give; was Jim's, revised by the owner 2026-11-27) now gates turning it on (Task 10), not building** | Owner, 2026-11-25; revised 2026-11-27 |
| Returns, disputes | By hand, with a runbook (59) | Owner, 2026-11-24 |

**Plan review, 2026-11-27** (fresh reviewer): the app Zinc key is only usable through one function that requires `payment` (Task 6); launch is two steps, one account first (Task 10; the owner's, owner 2026-11-27); A7 on Zinc's totals; `est_total_cents` keeps one meaning; the margin is derived from its two parts; the Stripe customer is saved at once; store cancels adjust costs; a hold-age alert; mixed modes raise.

**Spec review, 2026-11-27** (fresh reviewer, against today's code): card codes now follow Zinc's documented list (A1); the first card order's buyer disconnects their wallet first (Task 10); US-only cards and Stripe's page data become AC-21; fees aren't counted twice (AC-14); store-cancel refund is assumption A5 with a runbook check; test webhooks A6; the mixed-modes alert is cut; Task 10 recomputes open rounds' totals.

## Approaches considered

| How the card is saved | Trade-off |
|---|---|
| Stripe's form in our page | Stays on GiftsAF; adds Stripe's script, theming and phone checks |
| **Stripe's own page (picked)** | Least to build; leaves the site once per buyer. Can change later without touching orders |
| Emailed link beforehand | More friction, easy to ignore. Dropped |

Placing has one sensible way: add Zinc's `payment` object to today's order. Charging the card ourselves and paying Zinc from our own wallet would mean fronting money, which 59 rules out.

## What the buyer sees

```
Buy for Jimmy
Mouse pad                    $22.59
GiftsAF fee (i)               $3.05
Most you'll pay              $25.64
[ Add a card ]   then back here: Saved card  [ Buy now ]
```
(Amounts are only an example: $2.00 fixed, plus the card fee on the whole charge. The real page also allows for the price cap.)

- **First gift:** Add a card, Stripe's page, back to the same gift. Nothing is bought until Buy now.
- **Later gifts:** the same two taps as today.
- **(i):** each part of the fee, labelled "Launch pricing: at cost".
- **Settings > Paying for gifts:** the saved card, Replace, Remove. No Zinc account, balance or top-up.

## Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A buyer with no card | They tap Add a card and finish on Stripe's page | They return to the same gift showing "Saved card", and nothing is bought |
| AC-2 | They cancel, the session is someone else's, or an old return link is opened again | They return | No card is saved: a pending session is used once, and its customer, user and mode are checked |
| AC-3 | A saved card and phone, ordering and connect on | Buy now | One Zinc order with `payment.mode` `connect`, their customer and card, and the margin saved at approval; the order records `funding_mode` `connect`. With no customer or card it's never sent |
| AC-4 | Any gift, replacement or held gift | It's approved | The most they can pay is shown and saved with the fee inputs; if today's is higher than shown, it asks again. The expected charge at any price up to the cap is at most that. If Zinc's actual charge is higher, the owner is alerted |
| AC-5 | A budget | Totals are judged on any screen or email | The whole charge counts, fee included, for that buyer's way of paying |
| AC-6 | The card is declined, or the bank wants approval | Placing | Nothing is bought, the gift ends as `card_needed` (a failure the fix page can replace) and is never retried on its own, and the buyer is emailed to add a card and tap Buy again; never after ship-by. A card problem, or any 402, on a connect order never becomes `funds`; one we can't tell is the card follows today's failed-gift page. A try after a definite refusal uses a new idempotency key (T56), never after an unclear answer. An order Zinc has already created is never sent again: Buy again makes a new order row at today's price and fees, which the buyer agrees to |
| AC-7 | Zinc's answer is unclear | Placing | Same as today (T56), using the key for the order's `funding_mode`, so the sweep and tracking work for both |
| AC-8 | The order fails | Any time | Nothing is charged; the email says a pending hold drops off |
| AC-9 | The store cancels | After the charge | The email says the whole charge is refunded, fee included |
| AC-10 | Zinc posts an event to the app's webhook | It's handled | Signature checked; the order is found first and the user comes from it; only `connect` orders change there, and only wallet orders at a buyer's own webhook. A definite unknown order gets 200 and an alert; a failed lookup still errors, so Zinc retries |
| AC-11 | A list owner's shared address | A buyer uses connect | The buyer can't see the street anywhere they can reach (real order). The sharing wording stays as it is while wallet buyers remain, because they can still see a street in Zinc **[Claude's call]** |
| AC-12 | `connect_enabled` is off | Anyone | No connect order is placed (checked in SQL under the lock) and Add a card is hidden; held ones show as `paused` whatever their stored reason, so nobody is asked for a card; events, sweep, tracking and Remove still work |
| AC-13 | The buyer removes or replaces their card | Settings | The old one is detached at Stripe; unplaced gifts end as `card_needed` at their next placing try, and need a card and a Buy again tap; placed ones unaffected; removing is refused while an order is `placing` |
| AC-14 | A connect order's price is known | It's recorded | Zinc's fee and the card fee are each counted once, whichever of the webhook and the sweep comes first; the report's fee from settings isn't added again for connect orders (ALL-144). The AI and lookup averages behind `margin_cents` never include these two kinds, so the buyer doesn't pay them twice |
| AC-21 | Stripe's card page | A buyer saves a card | Card only, Link off, no `customer_update`; what Stripe stores on the customer after the first real card is checked and listed on `/privacy` **[Verify]**. Cards from outside the US are blocked by a Stripe Radar rule (runbook; owner's call, see Owner decisions) |
| AC-15 | Fee settings change | Next approval | New amounts, no deploy; approved orders, held ones included, keep theirs |
| AC-16 | A wallet buyer | Anything above | As today, proved by the existing wallet tests |
| AC-17 | A buyer with no phone | They add a card | The phone is asked for there, so a gift never waits for a wallet setup |
| AC-18 | Who pays by card | An account is created or an order approved | Read in SQL under the lock, never from the caller: from `accounts.funding_mode`, never worked out from `zinc_connected_at` (disconnecting clears it). A `connect` account can't start a Zinc connection (it would replace the app's webhook on the owner's account). The migration leaves accounts connected when it runs, or with an unfinished wallet order, on wallet, and sets everyone else, and the column default, to `connect`; a held order keeps its own |
| AC-19 | A key or account problem on our side | Placing | Held as `paused` with the owner alerted; never tells buyers to fix their setup |
| AC-20 | A card buyer | Any ordered, failed, cancelled, held or deadline email | Shows gift, fee and total, and never mentions a Zinc balance |

## How it fits (builder's starting points)

- **Fee math (`packages/core`), one function each way.** `charge(goods) = ceil((goods + margin + zinc_fee + card_fixed) / (1 - pct))`; `cap(maxCharge) = floor(maxCharge * (1 - pct)) - margin - zinc_fee - card_fixed`. Integer math on basis points. Subtracting a fee worked out at the lower price is wrong: the fee grows with the price ($22.59 could have charged $27.71 against $27.63 shown). Property-tested across cents. $50 + $2.50 + $1 gives Zinc's $55.41; the sandbox hold rounds to the nearest cent, so ours is the same or 1 cent more.
- **`max_price` excludes margin and fees** (Zinc docs). Every total comes from the idea's price, shipping and tax plus the buyer's fee, because `est_total_cents` already contains the wallet's $1.
- **Saved on the order at approval:** the four fee inputs and the approved maximum. The re-check uses them, not today's settings. Budget code that adds a flat fee (`committedSpendCents`, `sequentialCaps`, `recheckedCaps`, `replace_failed_order`) gets a connect path: goods first, then `charge`. The wallet meaning of `fee_cents` and `total_cents` doesn't change; on a connect order `fee_cents` is the whole GiftsAF fee: at the cap until the order settles, then Zinc's actual charge minus the goods total, or `charge(total) - total` from the saved inputs if Zinc doesn't report it.
- **Placing.** `placeRound` and `begin_placing` gate on a saved card instead of a wallet when `funding_mode` is `connect`. One app Zinc key places these, on the same Zinc account as the owner's wallet; a connect order whose body has no `payment` is refused before it's sent, because Zinc would take it from that wallet. Wallet orders keep the buyer's key. Approval records the card on each order; only that card is sent, resends included. Other wallet checks to split: `hold-gate.ts`, `rounds/store.ts` (`canBuy`), `steps.ts` (balance warning), and the fee wording. Dev and previews use a `zn_test_` key and Stripe test mode, production live ones, with today's environment check.
- **No card.** Each order records the card it was approved with and is only ever sent on that card. A decline fails its own order as `card_needed` and, if that card is still the saved one, clears it. `begin_placing` ends any gift whose recorded card isn't the saved one as `card_needed`, so a removed, declined or replaced card stops every waiting gift without touching other rounds. The fix page replaces it on a tap. Approval without a card is refused. Remove takes the account lock, refuses while an order is `placing`, clears the database, then detaches at Stripe (but not a card an `unconfirmed` order was sent on, see Task 4). Replaces a separate needs-a-tap mark (owner agreed, 2026-11-25).
- **Data.** Two ids on `accounts` (customer, payment method), never readable by the buyer's client. No card number, brand or last four stored. The confirm page says "Saved card"; details are read from Stripe in Settings.
- **Stripe customer:** we send our user id only (T42). Stripe's page may collect more itself; turn off what can be, and list the rest on `/privacy`. Consent text on Stripe's page says when we charge and how much.
- **Settings:** `connect_enabled` (0), `margin_cents` (100) and `zinc_fee_cents` (100), which make the $2.00 fixed part; `card_fee_bps` (290), `card_fee_fixed_cents` (30); the fee labels.
- **Left to the build:** consent wording, and the name on card statements (`GIFTSAF` suggested), shown to the owner as a mock-up.
- **Off switch:** `connect_enabled`, plus `zinc_ordering_enabled`.

## Out of scope

Runs by hand, with a runbook: returns, disputes, and an account deletion (no unsettled orders, delete the Stripe customer, then the account). Rolling back: switch `connect_enabled` off and let orders settle first.

Moving wallet accounts; a spending page (ALL-145); a returns flow; tax; digital wallets such as Apple Pay. Going live needs sole proprietor or LLC, a live Stripe account, ALL-75 and a support inbox.

## Open questions

**Zinc (asked 2026-11-24, no reply):** hold length; returns to the card; chargebacks; whether $0 margin is supported; how bank approval is reported. Their docs show the Stripe fee added on top, but not which account pays it at settlement.

**Sandbox test, 2026-11-25 (details on ALL-98).** Stripe refuses to link a sandbox to Zinc. Zinc's test API simulates connect orders (`connect.simulated`) and checks no card or customer.

| To prove | So far | Left for the real card order |
|---|---|---|
| 1. A connect order places | Simulated only | A live Stripe account connects and the order places |
| 2. What a decline and a bank-approval request return | Not testable | Only if Stripe and Zinc allow it; otherwise stays an assumption |
| 3. What makes the charge | The hold matches our formula to 1 cent or less; $0 margin accepted | The final charge, its rounding, who pays Stripe's fee, whether the rate is fixed |
| 4. Events and the hold | `connect.state` is `secured` on create | Capture, release, and events at one app webhook |

### Owner decisions from the 2026-11-27 review (answered by the owner, 2026-11-27; planning 66)

1. Charged more than "Most you'll pay": refund the difference automatically and email the buyer, rather than only alerting? **Decided: alert only until a real order shows it happens [Claude's call, accepted].**
2. A person's budget now counts the GiftsAF fee, so a $22.59 gift is over a $25 budget for a card buyer. OK? **Decided: yes.**
3. Jim disconnects his Zinc wallet before Task 10 so he can make the first card order? **Decided: yes; revised by the owner, 2026-11-27: the first card order is on the owner's account instead, so Jim follows step 2 like everyone else.**
4. Block non-US cards with a Stripe Radar rule? **Decided: yes.**
5. Add ALL-98 to CLAUDE.md's scope-freeze exceptions (built now)? **Decided: yes** (CLAUDE.md, `c8a3f28`).
6. Keep the shared Zinc account's wallet at $0 with auto top-up off once the app key is on production, so a card order that somehow lacks `payment` fails instead of spending it? **Decided: yes.**
7. Launch on one account first, everyone else after the real card order passes? **Decided: yes, the owner's account (revised from Jim's, owner 2026-11-27).**
8. Refuse Remove only while an order is `placing`, not `unconfirmed` (the hold is already on the card; `unconfirmed` can last days)? Revises 2026-11-25. **Decided: yes [Claude's call, accepted]; built in PR #175.**
9. Zinc's pending answers (returns, chargebacks, hold length, fee on top or from the margin, $0 margin): each stays a setting or a runbook step **[Claude's call, accepted]**.
10. Business form: **sole proprietorship for now**, Stripe in the owner's name. Moving off Vercel Hobby before the first real charge is planned separately.

## Principles check

- **Simplest version?** Stripe's page, no Stripe webhook, no wallet migration.
- **Bends:** 59's "inline" (revised by the owner above). One Zinc key for everyone is a bigger blast radius than one per buyer: AC-10, AC-19 and the off switch limit it.
- **New personal data:** two Stripe ids (T42).
- **Docs to update:** planning 59, T16, T56, T61, design §6.5a and §8, `operations.md`.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task by task. **Approved by the owner, 2026-11-25; build it with subagent-driven-development. Build started 2026-11-27 (owner); PRs merge off, and nothing turns on until the real card order in "Decided" passes.** Read apps/web/AGENTS.md first, and the spec above with every task.

**Architecture:** `orders.funding_mode` picks the path. A connect order differs only in its fee math, its Zinc key, its `payment` object and its webhook. The card is saved with a Stripe setup session on Stripe's page. No card, a declined card or a removed card ends a gift as the failure `card_needed`, which the fix page replaces on a tap; it's never retried.

**Tech stack:** Postgres functions, `packages/core`, Next.js server actions and routes, Stripe's REST API by `fetch` and zod, the way `zinc/client.ts` does it (no new package, T10).

### Global constraints

- Off until launch: `connect_enabled` 0. Only Task 10 changes anyone's `funding_mode`.
- Fees are settings read at approval: `margin_cents` 100, `zinc_fee_cents` 100, `card_fee_bps` 290, `card_fee_fixed_cents` 30. No fallback values (T23).
- Integer math. `max_price` never includes margin or fees.
- Every money write is in SQL under the round lock, then the account lock, in that order.
- Logs carry ids, cents and reason codes only. Never a key, card, customer id, name or address (E6).
- Wallet behaviour doesn't change; its existing tests pass with only lists gaining the new values (`code_column_checks`, `app_settings`' seeded keys, `cost_per_gift`'s keys) (AC-16). Migrations only add (E7), and ship in their own PR first.
- Copied SQL functions start from the latest definition (`grep -l "function concierge.<name>(" supabase/migrations/*.sql | tail -1`), and the header names it.

### Assumptions until the real card order

| # | Assumption | If wrong |
|---|---|---|
| A1 | A decline or bank approval is a 4xx on create or an `order.failed` event, with a code in `CARD_CODES`: Zinc's documented `payment_failed`, `invalid_payment_method`, `payment_method_required`, `card_verification_required` and `insufficient_funds`. `payment_declined` is the store refusing payment, not the bank, so it stays `failed` and never clears the card. Unverified until a real decline | An unlisted code becomes today's `failed`; add the code |
| A5 | On a store cancel Zinc refunds the whole card charge (its Connect guide; its `order.cancelled` text says "wallet") | Runbook: no refund in Stripe within 5 days of the cancel, refund from the Stripe dashboard. Checked in the real card order if a cancel happens |
| A7 | On a card order Zinc's `price_components.total` is the goods only, and `connect.final_charge` adds the margin and fees **[Verify]** | Otherwise `settle_order`'s fee (charge minus total) is near 0 and committed spend counts fees twice; fix `placedPrice` before turning it on |
| A8 | A card declined after our request timed out leaves no Zinc order (Zinc: "if it's declined, no order is created") **[Verify]** | The sweep finds nothing and the order becomes `unconfirmed` with the owner alerted; settle it as failed by hand, and the buyer gets today's failed-gift path (runbook **Unconfirmed orders**) |
| A6 | Test-key (`zn_test_`) orders post to the test webhook, not production's **[Verify]** | Production would alert `zinc.unknown_order` for dev orders (E8); then dev and previews move to their own Zinc account |
| A2 | Zinc charges `round((total + margin + zinc_fee + fixed) / (1 - pct))` | Above our maximum alerts; fix `charge` before launch |
| A3 | Events for the connect account reach one registered webhook with today's signature | Rework Task 7 |
| A4 | `connect.final_charge` is on the order when placed | Estimated from the saved inputs, marked estimated |

### Files

| File | What it's for |
|---|---|
| `packages/core/src/card-fees.ts` (new) | Fee math |
| `supabase/migrations/<date>_card_payments.sql` (new) | Columns, settings, SQL (Tasks 2 and 3) |
| `apps/web/modules/concierge/stripe/client.ts`, `card.ts` (new) | Stripe calls; add, confirm, read and remove a card |
| `apps/web/modules/concierge/purchase/payer.ts` (new) | Who pays and with which fees, for every caller |
| `apps/web/modules/concierge/purchase/{approve,place,replace,store}.ts` | Connect path |
| `apps/web/modules/concierge/zinc/{orders,events,retry,types,tracking-events}.ts`, `zinc/card-codes.ts` (new) | `payment`, decline codes, app events |
| `apps/web/app/api/zinc/webhook/app/route.ts`, `apps/web/app/rounds/card/return/route.ts` (new) | Zinc's app webhook; the return from Stripe |
| Buy, fix and Settings screens, `rounds/emails.ts`, `notify/templates.ts` | What the buyer sees |

### Task 1: Fee math (AC-4, AC-15) **[P]**

**Files:** create `packages/core/src/card-fees.ts` and `card-fees.test.ts`; export from `index.ts`.

**Produces:**
```ts
export type FeeInputs = { marginCents: number; zincFeeCents: number; cardFeeBps: number; cardFeeFixedCents: number };
export function chargeCents(goodsCents: number, f: FeeInputs): number; // ceil
export function goodsCapCents(maxChargeCents: number, f: FeeInputs): number; // RangeError when <= 0
export function feeParts(goodsCents: number, f: FeeInputs): { marginCents: number; zincFeeCents: number; cardFeeCents: number; totalFeeCents: number };
```

- [ ] Failing tests, with `F = { marginCents: 100, zincFeeCents: 100, cardFeeBps: 290, cardFeeFixedCents: 30 }`:
```ts
expect(chargeCents(5000, { ...F, marginCents: 250 })).toBe(5541);
expect(chargeCents(2259, F)).toBe(2564);
expect(feeParts(2259, F).totalFeeCents).toBe(305);
for (let max = 300; max <= 60000; max++) expect(chargeCents(goodsCapCents(max, F), F)).toBeLessThanOrEqual(max);
for (let g = 1; g <= 60000; g++) expect(goodsCapCents(chargeCents(g, F), F)).toBeGreaterThanOrEqual(g);
expect(() => goodsCapCents(230, F)).toThrow(RangeError);
expect(() => chargeCents(10.5, F)).toThrow(RangeError);
expect(() => chargeCents(100, { ...F, cardFeeBps: 10000 })).toThrow(RangeError);
```
- [ ] Run `pnpm --filter @gifts-af/core test card-fees`: fails, not exported. Implement `ceil((goods + sum) * 10000 / (10000 - bps))` and `floor(max * (10000 - bps) / 10000) - sum`, where `sum` is margin + Zinc fee + fixed. Passes. Commit.

### Task 2: Columns and settings (AC-12, AC-15, AC-18)

**Files:** the migration; `supabase/tests/card_payments.test.sql`; `code_column_checks.test.sql`; regenerate types (`pnpm db:types`) and the map (`pnpm db:map`).

**Produces:**
- `accounts.stripe_customer_id text`, `stripe_payment_method_id text`. No grants to `authenticated`.
- `orders.margin_cents`, `zinc_fee_cents`, `card_fee_bps`, `card_fee_fixed_cents`, `max_charge_cents`, `final_charge_cents` (integer), `payment_method_id text`. No grants. Check: a `connect` row has all four fee inputs, `max_charge_cents` and `payment_method_id`.
- `gift_ideas.goods_cents integer`, backfilled `greatest(0, est_total_cents - setting_int('zinc_order_fee_cents'))`.
- Failure type `card_needed`, added to the check in `20261124110000_order_tracking.sql`.
- `card_sessions (id uuid pk, user_id, stripe_session_id unique, stripe_customer_id, round_id null, idea_ids uuid[] null, failed_order_id null, created_at, used_at)`: service role only. No round means it came from Settings.
- Settings: `zinc_fee_cents`, `card_fee_bps`, `card_fee_fixed_cents`, `connect_enabled` 0, `stripe_timeout_ms` 10000, `card_session_minutes` 60, the fee labels (`fee_label`, `fee_pricing_note`, text), and planning 61's amounts behind (i): `fee_part_ai_cents` 65 and `fee_part_running_cents` 35 (the margin is always their sum, `card_margin_cents()`, with no setting of its own, so the (i) breakdown can't drift from the charge), with Zinc's $1.00 from `zinc_fee_cents` (kept apart from the wallet's `zinc_order_fee_cents`, since Zinc sets each **[Claude's call]**). The fee labels stay settings because the ticket's Done-when asks for it.
- `cost_events` kinds `zinc_order_fee` and `card_fee`, unique on `(order_id, kind)` for those two.

- [ ] pgTAP, failing first: a signed-in user can't select or update any new account or order column, or read `card_sessions`; a `connect` order without fee inputs is refused; a wallet order without them is fine; a second `card_fee` row for one order is refused; the backfill gives 2359 for an idea of 2459 with a $1 fee.
- [ ] Run `pnpm db:test`: fails. Write the migration; it passes, and so do `pnpm db:types:check` and `pnpm db:map:check`. Commit.

### Task 3: SQL money path (AC-3, AC-6, AC-8, AC-12, AC-13, AC-14, AC-18)

**Files:** the same migration; `card_payments.test.sql`.

**Produces:**
- `approve_round`, `replace_failed_order`: lock the account after the round; take `funding_mode` from it, never from the caller; no account row means wallet, as today. For `connect`: refuse `no_card` with no customer, card or phone; refuse `connect_off` when `connect_enabled` isn't 1; refuse `fees_changed` unless the sent fee inputs equal today's settings (one shared check, `check_card_order`); save them, `payment_method_id`, and `max_charge_cents` worked out in SQL (`card_charge_cents`, the same math as `chargeCents`), with `fee_cents = max_charge_cents - max_price_cents`. `replace_failed_order` accepts the same idea for `card_needed`, any number of times, and updates `goods_cents` with `est_total_cents` on any re-quote.
- `save_ideas`: saves `goods_cents`; a caller that sends none (old code) gets the total minus the wallet fee.
- `fail_order_row`: its replacement row also copies the fee columns, `max_charge_cents`, `payment_method_id` and `address_owner_id`.
- `begin_placing`, for `connect` orders: `zinc_ordering_enabled` and `connect_enabled` (`paused`, replacing any stored reason), paid features, phone (`setup`). Then, if any held order's `payment_method_id` is distinct from the account's, fail those as `card_needed`, reconcile and return none; the rest place on a later try. Held orders of mixed modes (can't happen: Task 10 never switches an account with held wallet orders) raise an error, so a bug is loud.
- `gate_held_orders`: `paused` replaces any reason on connect orders.
- `fail_order_row` takes the failure type `card_declined`: on a connect order it fails it as `card_needed` and, if its `payment_method_id` is still the account's, nulls the account's card (account lock after the round's; no other round is touched). So every place that fails an order (`record_outcomes`' `rejected`, `settle_order`) handles a decline the same way; on a wallet order `card_declined` is plain `failed`. `record_outcomes` applies declines before the rest. An `unsent` connect order whose card is distinct from the account's fails as `card_needed`. `insufficient` on a connect order raises `22023`.
- `settle_order`: for `placed`, saves `final_charge_cents` from `p_price`, else `ceil((total + margin + zinc fee + fixed) * 10000 / (10000 - bps))`; sets `fee_cents` to it minus `total_cents`; writes `zinc_order_fee` and `card_fee` with `on conflict do nothing`, the card fee marked estimated without Zinc's number. No total: keeps `fee_cents` at the cap, writes no card-fee row. No cost rows while tracking is off.
- `save_card(p_user_id, p_session_id text, p_customer text, p_payment_method text) returns text`: `ok`, `used` or `not_yours` (another user, a customer that isn't the row's, or one that differs from the account's). Locks the account; uses the session once; changes no order.
- `start_card_session(p_user_id, p_session_id, p_customer, p_round_id, p_idea_ids, p_failed_order_id) returns text`: saves the Stripe customer on the account the first time, under its lock, so an abandoned visit leaves no orphan customer at Stripe (T42); `other_customer` if the account has a different one.
- `remove_card(p_user_id) returns text`: `ok` or `placing`. Locks only the account (`begin_placing` takes it too, so a send can't start in between); `placing` while any order is `placing` (an `unconfirmed` one doesn't block it: the hold is already on the card; owner, 2026-11-27); otherwise nulls the card and keeps the customer. Changes no order.
- `cost_per_gift`: also returns `cardGifts`, `zincFeeCents`, `cardFeeCents`; `orderFeeCents` stays the wallet setting.

- [ ] pgTAP, failing first:
  1. Connect account, caller says nothing about mode: the row is `connect`. A held order keeps its mode after the account's changes.
  2. No card: `approve_round` raises `no_card` and writes nothing.
  3. Held gift A; `remove_card`; `save_card`; `begin_placing` on A returns no rows, and A is `failed`/`card_needed`.
  4. Sent with card 1, card 2 saved, decline of card 1: that order fails, the account keeps card 2, nothing else changes.
  5. Two rounds. Round 1's order is declined with the card still saved: the account's card is null and round 2 is untouched; after a new card is saved, `begin_placing` on round 2 places nothing and its gift is `card_needed`. Same round: an unsent sibling is `card_needed` at once.
  6. Removed while a sibling is `placing`: `remove_card` returns `placing` and nothing changes.
  7. `connect_enabled` 0: `begin_placing` returns no rows; a `setup` hold reads `paused`.
  8. `settle_order` twice, the second with another price: one row of each cost kind; first price kept.
  9. Goods 2349, no Zinc charge reported: `final_charge_cents` 2657, `fee_cents` 308.
  10. `replace_failed_order` on `card_needed`: a new row with a new `idempotency_key` and today's fees; the old row is resolved; past ship-by it's refused.
  11. A wallet order through each function gives today's result (existing files pass unedited).
  12. `settle_order` `placed` with no prices on a connect order succeeds, and `fee_cents` is unchanged.
  13. An old-shape `save_ideas` payload gets `goods_cents`; a price-rise replacement updates both columns; a missing account row approves as wallet.
  14. Declined twice in a row: two replacements, two idempotency keys.
  15. Same session twice: `used`. Another user's session: `not_yours`, no card saved.
  16. `card_charge_cents` gives the same answers as `chargeCents` (5000 with a 250 margin is 5541; 2259 is 2564; 2349 is 2657), and `cost_per_gift`'s AI and lookup figures leave out `zinc_order_fee` and `card_fee` rows.
- [ ] Write the functions; `pnpm db:test` passes. Commit. **PR 1: Tasks 1 to 3, merged and migrated before any later PR.**

### Task 4: Stripe client and saving a card (AC-1, AC-2, AC-13, AC-17)

**Files:** create `modules/concierge/stripe/client.ts`, `stripe/card.ts`, tests in `modules/concierge/__tests__`; `lib/wiring.ts`; `app/rounds/card/return/route.ts`; `.env.example` (`STRIPE_SECRET_KEY`); `e2e/fake-stripe.ts`.

**Produces:**
```ts
export type StripeHttp = { key: string; mode: "test" | "live"; timeoutMs: number; fetch: typeof fetch };
export type CardDeps = DbDeps & { stripe: StripeHttp; siteUrl: string };
export async function startCardSession(d: CardDeps, i: { userId: string; from: { roundId: string; ideaIds: string[]; failedOrderId?: string } | "settings"; phone?: string }): Promise<{ url: string } | "off" | "bad_phone">;
export async function finishCardSession(d: CardDeps, i: { userId: string; sessionId: string }): Promise<{ backTo: string } | "cancelled" | "used" | "not_yours">;
export async function savedCard(d: CardDeps, userId: string): Promise<{ brand: string; last4: string } | null>; // Settings only, read live
export async function removeCard(d: CardDeps, userId: string): Promise<"ok" | "placing" | "detach_failed">;
export async function stripeWiring(db: SupabaseClient<Database>, env?: Env): Promise<StripeHttp | null>;
```
- `stripeWiring` is null unless `sk_test_` goes with `ZINC_ENV=test`, or `sk_live_` with `live`.
- The customer holds `metadata[user_id]` only: no name or email (T42). The account's `stripe_customer_id` is reused; one is created only when it's null, with a Stripe idempotency key made from the user id, and saved on the `card_sessions` row. Session: `mode=setup`, card only, `usage=off_session`, our consent text.
- `finishCardSession` reads the session back from Stripe and requires status `complete`, the stored row's user, our customer, the same mode, and a row no older than `card_session_minutes`. `backTo` is built from the stored row, never from the request.
- `phone` is required when the account's `buyer_phone` is null, and saved by the same form (AC-17).
- `removeCard` clears the database, then detaches every payment method on the customer except the saved one and any an `unconfirmed` or `placing` order was sent on (so Zinc can still capture its hold); those go at the next Remove or Replace **[Claude's call]**. `finishCardSession` does the same for the old ones. A failed detach logs `card.detach_failed` (a log line, not an alert).

- [ ] Unit tests, failing first: each `finishCardSession` requirement, when missed, saves nothing; a replayed return is `used`; a live key with `ZINC_ENV=test` is null; `removeCard` returning `placing` makes no Stripe call; request bodies contain no email or name; the session asks for cards only, with no `customer_update`; Replace after the first save creates no customer, and Remove detaches both cards; a session Stripe reports as not complete saves nothing. Implement; pass; commit.

### Task 5: Budget and approval (AC-3, AC-4, AC-5, AC-15, AC-18)

**Files:** create `purchase/payer.ts`; modify `approve.ts`, `replace.ts`, `store.ts`, `place.ts` (caps only), `ideas/run.ts`, `ideas/store.ts`; tests; `approval-db.test.ts`.

**Produces:**
```ts
export type Payer = { mode: "zinc_wallet"; feeCents: number } | { mode: "connect"; fees: FeeInputs };
export async function readPayer(d: DbDeps, userId: string): Promise<Payer>;
export function ideaTotalCents(i: { goods_cents: number; est_total_cents: number }, p: Payer): number; // connect: chargeCents(goods)
export function capsForPayer(round: Pick<RoundRow, "budget_cents">, totals: number[], account: Pick<Account, "over_budget_pct">, confirmed: boolean, p: Payer, marginPct: number, committedCents: number):
  { caps: number[]; maxCharges: number[] | null; neverMoreThanCents: number } | ApproveError;
```
- Connect runs the same budget math on whole charges with a fee of 0, then `goodsCapCents`. Because `fee_cents = max_charge - max_price`, `committedSpendCents` needs no change.
- **Idea runs judge a card buyer's candidates on the whole charge** (`chargeCents(goods)` at today's fees) for the budget filter and the over-budget flag; wallet buyers as today. This follows from the owner's decision that the GiftsAF fee counts toward the gift budget (planning 66), so it's not a new decision (ruled 2026-11-27).
- Idea runs save `goods_cents`. `est_total_cents` keeps its wallet meaning; every reader that shows or judges a total (`place.ts`, `ideas/store.ts`, `read.ts`, `approval.ts`, `replace.ts`, emails) calls `ideaTotalCents(idea, payer)`, which for a card buyer is `chargeCents(goods_cents)` with today's fees. So nothing goes stale when fees or the buyer's way of paying change, and Task 10 needs no recompute. A re-quote sets both columns.
- `ApproveInput` and `ReplaceInput` gain `shownMaxCents?: number`, required for connect; a higher maximum today returns `price_changed` with the new one. `no_card` and `connect_off` join `ApproveError`; `fees_changed` is shown as `price_changed`.
- `recheckedCaps` for connect: totals are `chargeCents(goods, saved inputs)`, fee 0, then `goodsCapCents(…, saved inputs)`, then the lower of that and the saved cap.
- `replaceFailedOrder` and `quoteFailedOrder` allow the same idea for `card_needed`, re-quoted without the once rule; a gift that can't be re-quoted uses its saved estimate, still capped.

- [ ] Tests, failing first: for goods of $22.59 and `order_price_margin_pct` 10, `chargeCents` of every price up to the cap is at most the shown maximum; budget $25 and goods $22.59 is over budget for connect and within for a wallet; two picks together stay within the ceiling; a fee raised after the page loaded returns `price_changed` and writes nothing; a held order re-checked after a fee change keeps its own inputs; a `card_needed` gift is bought again at today's price, twice in a row, and at its saved estimate when it can't be re-quoted; a wallet approval's payload is identical to today's. Implement; `pnpm test` and `pnpm test:db` pass; commit.

### Task 6: Placing and the sweep (AC-3, AC-6, AC-7, AC-8, AC-12, AC-19)

**Files:** `zinc/types.ts`, `zinc/orders.ts`, `zinc/retry.ts`, `zinc/card-codes.ts` (new), `purchase/place.ts`, `purchase/store.ts`, `rounds/hold-gate.ts`, `rounds/store.ts` (`canBuy`), `rounds/steps.ts`, `lib/wiring.ts`, `.env.example` (`ZINC_CONNECT_API_KEY`, `ZINC_CONNECT_WEBHOOK_SECRET`).

**Produces:**
```ts
export type ZincPayment = { mode: "connect"; paymentMethod: string; customer: string; marginCents: number };
// ZincOrderInput gains: payment: ZincPayment | null. PlaceResult gains: { cardDeclined: true }.
export function isCardCode(code: string | undefined): boolean; // CARD_CODES (A1): payment_failed, invalid_payment_method, payment_method_required, card_verification_required, insufficient_funds
export function zincKeyFor(d: PurchaseDeps, o: { user_id: string; funding_mode: string }): Promise<{ apiKey: string; env: "test" | "live" } | null>;
export async function connectWiring(db: SupabaseClient<Database>, env?: Env): Promise<{ apiKey: string; webhookSecret: string } | null>;
```
- **The app Zinc key is only ever used through one function, `sendConnectOrder`, which throws unless the body has `payment.mode` `connect` with a customer and card.** Every path that sends or resends with that key (place, retry, sweep) goes through it; a test lists every request made with the app key and checks each carries the payment. Because a Zinc order without `payment` is paid from that account's wallet.
- `connectWiring` is null if the key's prefix (`zn_test_` or not) doesn't fit `ZINC_ENV`. A connect row with no `payment` throws before any request.
- `failureTypeFor(code, fundingMode)` replaces `failureType` at all four places (a first 4xx, an order found already failed, the sweep, the event): on a connect order a listed code is `card_declined`. A 402 that isn't listed is `failed`, never `funds`. After any ambiguous try, still `unavailable` (T56).
- `cardDeclined` stops the run: the rest are `unsent`.
- App key refused (401) or missing: the round is `paused` with `zinc.connect_unauthorized`, `alert: true`.
- The wallet balance step and "low balance" emails skip connect orders. The sweep uses `zincKeyFor`. `placedPrice(found): PlacedPrice`, in `zinc/orders.ts`, reads prices and `connect.final_charge`, and `alertIfOver(order, price)` logs `order.over_max_charge` with `alert: true` above `max_charge_cents`; the sweep and Task 7 both use them.

- [ ] Tests against the fake, failing first: the body has the exact `payment` object and the saved margin; a wallet body has none; a 402 with and without a known code never gives `funds`; a decline at each of the four places clears the card; two gifts, the first declined, makes exactly one POST; a decline after a timeout stays `placing`; a resend sends the order's recorded card even after the buyer replaced theirs; a 401 pauses and emails nobody; the sweep looks a connect order up with the app key and a wallet one with the buyer's; an overcharge alerts. Implement; pass; commit.

### Task 7: App webhook (AC-8, AC-9, AC-10)

**Files:** `zinc/events.ts`, `zinc/tracking-events.ts`, `app/api/zinc/webhook/app/route.ts`; tests; the `isPublicPath` test.

**Produces:** `handleAppZincWebhook(rawBody: string, signature: string | null, deps: Deps & { secret: string; connectKey: string }): Promise<{ status: 200 | 401 }>`; `findConnectOrder(zincOrderId: string, deps): Promise<{ orderId: string; userId: string } | null>`, which throws on a failed lookup. `findOurOrder` and the per-buyer handlers only match `zinc_wallet` rows. Before any connect order settles as placed, from `order.placed` or a tracking event, the Zinc order is fetched for `placedPrice`, so Zinc's charge is saved and checked; a failed fetch throws and Zinc retries.

- [ ] Tests, failing first: bad signature 401; a wallet order's id on the app webhook, or a connect order's on a buyer's, changes nothing and doesn't alert; definite unknown is 200 and `zinc.unknown_order` with `alert: true`; a lookup 500 throws; the same event twice is one settlement; a charge over the maximum alerts from `order.placed` and from a tracking event; `order.cancelled` after the charge tells the buyer; wallet events here are ignored; the path needs no session; starting a Zinc connection from a `connect` account is refused before any Zinc call. Implement; pass; commit.

### Task 8: Screens (AC-1, AC-4, AC-5, AC-6, AC-12, AC-13, AC-17)

**Files:** `app/rounds/[id]/buy/{page,confirm-screen}.tsx`, `app/rounds/[id]/fix/[orderId]/{page,fix-screen}.tsx`, `app/rounds/outcome.tsx`, `app/settings/paying-for-gifts*.tsx`, `app/settings/paying/page.tsx`, `app/privacy/page.tsx`; `e2e/card-payments.spec.ts`.

- Mock-ups first, shown to the owner with the consent wording and statement name (phone and desktop, light and dark). Build after their OK.
- Buy page: gift, "GiftsAF fee" with (i) and "Launch pricing: at cost", "Most you'll pay", then Add a card, or "Saved card" with Buy now. Off: "Buying is paused", no Add a card.
- Fix page for `card_needed`: "Your card changed or couldn't be charged. Nothing was bought." With no card: Add a card. With one: "Check today's price" (or the saved estimate), "Most you'll pay", Buy again.
- Settings: the card, Replace, Remove (on `placing`: "A gift is being bought with this card. You can remove it once that's confirmed.", since an `unconfirmed` order can take days). Wallet accounts see today's screen.

- [ ] e2e with the fakes, failing first: add a card, return, nothing bought, Buy now, one order; cancel on Stripe's page; decline, new card, nothing bought until Buy again; remove with a held gift, add for another gift, the first isn't bought; off hides Add a card; a wallet buyer sees today's page. Implement; `pnpm e2e` passes; screenshots on the ticket; commit.

### Task 9: Emails, costs and docs (AC-5, AC-8, AC-9, AC-11, AC-14, AC-20)

**Files:** `rounds/emails.ts`, `notify/templates.ts`, `rounds/money-path.ts`, `health/costs.ts`; `design/operations.md` (env vars, webhook setup, returns, disputes, account deletion, and a line for each alert: `zinc.connect_unauthorized`, `zinc.unknown_order`, `order.over_max_charge`; and two runbook steps: the Radar rule blocking non-US cards, and the refund check after a store cancel (A5)), `design/decisions.md` (a new T#, revising T16, T56, T61), planning decision 59, design §6.5a and §8.

- `store_cancel_order` (copied into Task 9's migration) adjusts a card order's cost rows on a cancel: Zinc's fee comes off, and the card fee we absorb is recorded, once A5 shows what Zinc refunds. pgTAP test.
- Runbook and alert: a card order not placed within `card_hold_alert_days` (5) alerts the owner, since card holds usually lapse after about 7 days; ask Zinc what happens then. `card.detach_failed` is a log line, not an alert (nothing a user notices, E8). Stripe errors are logged by code only, never the message, which repeats ids (E6).
- `card_needed` gets its own words in `lateDetail`, `openRow` and `sendOpenFailures` (`money-path.ts`): "Your card changed or couldn't be charged. Nothing was bought.", then "Add a card and tap Buy again." with no card saved, or "Tap Buy again." with one. Never "the store couldn't place the order".
- [ ] Tests, failing first, for connect ordered, failed, `card_needed` (open, summary and after the round closed), cancelled, held and deadline emails: gift, fee and total are right, and "Zinc" and "balance" don't appear; failed says "If you see a pending hold, it will drop off"; cancelled says the whole charge is refunded, fee included; a wallet email is unchanged; no street appears on any connect screen or email for a shared address; the Monday cost report counts a connect order's Zinc fee once. Implement; pass; commit. **PR 2: Tasks 4 to 7. PR 3: Tasks 8 and 9.**

### Task 10: Launch (AC-12, AC-18), only with the owner's go-ahead, in two steps

**Files:** `supabase/migrations/<date>_card_payments_launch.sql`, its pgTAP.

- Before step 1, in Stripe: the US-only Radar rule (planning 66), so a non-US card's higher fee can't push a charge over "Most you'll pay" (PR #176 review). The health email lists any order charged over its maximum (Task 9).
- First, in this order: the owner's wallet orders are delivered or closed (today the in-transit loaf pan, order `48bd263a`), the owner disconnects Zinc in Settings (which clears the account's webhook), and the app webhook is set on that Zinc account. Check it with `GET /webhooks/endpoint`.
- **Step 1 (PR 4a):** switch the owner's account (aaron.aallen@gmail.com) only, then the real card order below, bought by the owner (owner, 2026-11-27; was Jim's). **Step 2 (PR 4b), only after it passes:** set `accounts.funding_mode` and the column default to `connect` for everyone else, Jim included, except accounts with `zinc_connected_at` set, a wallet order `held`, `placing` or `unconfirmed`, or an unresolved wallet failure.
- [ ] pgTAP for each exception. **PR 4**, merged after ALL-75 and the app webhook on the Zinc account.
- [ ] The owner turns `connect_enabled` on. One gift under $25, bought by a person on a connect account, agreed with the owner first (the QA account never buys). Check the charge against the maximum shown, the Stripe settlement, one `card_fee` and one `zinc_order_fee` row, the email, tracking on the app webhook, and that no street shows for a shared address. Evidence on ALL-98.
- **Turning it off:** `connect_enabled` 0. Orders already sent settle as usual.

### Review focus

1. A second tab, or Back from Stripe, buys twice: Task 8's one-order e2e.
2. The card is swapped or removed between the tap and the send: Task 3 (3) to (6), Task 6's resend test.
3. The fee or price changes while on Stripe's page: Task 5's `price_changed` test.
4. A saved card that Stripe has since removed: Task 6, an unlisted code gives `failed`, nothing retried.
5. Two gifts, one declined: Task 3 (5), Task 6's one-POST test, and Task 8's decline e2e run with two gifts.

### Coverage

AC-1, 2: 4, 8. AC-3: 3, 5, 6. AC-4: 1, 5, 6. AC-5: 5, 8, 9. AC-6: 3, 6, 8. AC-7: 6. AC-8: 6, 7, 9. AC-9: 7, 9. AC-10: 7. AC-11: 9, 10. AC-12: 3, 6, 8, 10. AC-13: 3, 4, 8. AC-14: 3, 9. AC-15: 1, 2, 5. AC-16: every task's unedited wallet tests. AC-17: 4, 8. AC-18: 3, 5, 10. AC-19: 6. AC-20: 9. AC-21: 4, 9, 10.
