# ALL-98 Pay by card through Zinc Connect: Spec (approved by the owner, 2026-11-25; no build until one real card order passes)

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
| After a declined or removed card | The buyer adds a card, then taps Buy again. **Saving a card never buys anything** | Owner, 2026-11-25 (replaces "saving a new one buys the waiting gift") |
| Removing a card mid-purchase | Refused with "try again shortly" while an order is `placing` or `unconfirmed` | Owner, 2026-11-25 |
| Wallet buyers and shared addresses | Not blocked: the only wallet buyers are the owner and Jim | Owner, 2026-11-25 |
| Store cancels | We refund everything and absorb Stripe's fee | Owner, 2026-11-25 |
| A decline Zinc doesn't tell apart | Today's "couldn't buy it" page | Owner, 2026-11-25 |
| Cards | US only at launch if card fees vary | Owner, 2026-11-25 |
| Proof before building | Zinc Connect can't use a Stripe sandbox (tested 2026-11-25). The plan may be written now, with unproven parts marked as assumptions. **No build until one real card order (under $25, the owner's card) on a live Stripe account passes** | Owner, 2026-11-25 |
| Returns, disputes | By hand, with a runbook (59) | Owner, 2026-11-24 |

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
| AC-6 | The card is declined, or the bank wants approval | Placing | Nothing is bought, the gift is held and never retried on its own, and the buyer is emailed to add a card and tap Buy again; never after ship-by. A card problem, or any 402, on a connect order never becomes `funds`; one we can't tell is the card follows today's failed-gift page. A try after a definite refusal uses a new idempotency key (T56), never after an unclear answer. An order Zinc has already created is never sent again: a new order row replaces it, keeping the shared-address owner, cap, fee inputs, approved maximum and the needs-a-tap mark |
| AC-7 | Zinc's answer is unclear | Placing | Same as today (T56), using the key for the order's `funding_mode`, so the sweep and tracking work for both |
| AC-8 | The order fails | Any time | Nothing is charged; the email says a pending hold drops off |
| AC-9 | The store cancels | After the charge | The email says the whole charge is refunded, fee included |
| AC-10 | Zinc posts an event to the app's webhook | It's handled | Signature checked; the order is found first and the user comes from it; only `connect` orders change there, and only wallet orders at a buyer's own webhook. A definite unknown order gets 200 and an alert; a failed lookup still errors, so Zinc retries |
| AC-11 | A list owner's shared address | A buyer uses connect | The buyer can't see the street anywhere they can reach (real order). The sharing wording stays as it is while wallet buyers remain, because they can still see a street in Zinc **[Claude's call]** |
| AC-12 | `connect_enabled` is off | Anyone | No connect order is placed (checked in SQL under the lock) and Add a card is hidden; held ones show as `paused` whatever their stored reason, so nobody is asked for a card; events, sweep, tracking and Remove still work |
| AC-13 | The buyer removes their card | Settings | It's detached at Stripe; unplaced gifts are held until the buyer adds a card and taps Buy again; placed ones unaffected; refused while an order is `placing` or `unconfirmed` |
| AC-14 | A connect order's price is known | It's recorded | Zinc's fee and the card fee are each counted once, whichever of the webhook and the sweep comes first; the report's fee from settings isn't added again for connect orders (ALL-144) |
| AC-15 | Fee settings change | Next approval | New amounts, no deploy; approved orders, held ones included, keep theirs |
| AC-16 | A wallet buyer | Anything above | As today, proved by the existing wallet tests |
| AC-17 | A buyer with no phone | They add a card | The phone is asked for there, so a gift never waits for a wallet setup |
| AC-18 | Who pays by card | An account is created or an order approved | Read in SQL under the lock, never from the caller: from `accounts.funding_mode`, never worked out from `zinc_connected_at` (disconnecting clears it). The migration leaves accounts connected when it runs, or with an unfinished wallet order, on wallet, and sets everyone else, and the column default, to `connect`; a held order keeps its own |
| AC-19 | A key or account problem on our side | Placing | Held as `paused` with the owner alerted; never tells buyers to fix their setup |
| AC-20 | A card buyer | Any ordered, failed, cancelled, held or deadline email | Shows gift, fee and total, and never mentions a Zinc balance |

## How it fits (builder's starting points)

- **Fee math (`packages/core`), one function each way.** `charge(goods) = ceil((goods + margin + zinc_fee + card_fixed) / (1 - pct))`; `cap(maxCharge) = floor(maxCharge * (1 - pct)) - margin - zinc_fee - card_fixed`. Integer math on basis points. Subtracting a fee worked out at the lower price is wrong: the fee grows with the price ($22.59 could have charged $27.71 against $27.63 shown). Property-tested across cents. $50 + $2.50 + $1 gives Zinc's $55.41; the sandbox hold rounds to the nearest cent, so ours is the same or 1 cent more.
- **`max_price` excludes margin and fees** (Zinc docs). Every total comes from the idea's price, shipping and tax plus the buyer's fee, because `est_total_cents` already contains the wallet's $1.
- **Saved on the order at approval:** the four fee inputs and the approved maximum. The re-check uses them, not today's settings. Budget code that adds a flat fee (`committedSpendCents`, `sequentialCaps`, `recheckedCaps`, `replace_failed_order`) gets a connect path: goods first, then `charge`. The wallet meaning of `fee_cents` and `total_cents` doesn't change; on a connect order `fee_cents` is the whole GiftsAF fee: at the cap until the order settles, then Zinc's actual charge minus the goods total, or `charge(total) - total` from the saved inputs if Zinc doesn't report it.
- **Placing.** `placeRound` and `begin_placing` gate on a saved card instead of a wallet when `funding_mode` is `connect`. One app Zinc key places these, separate from the lookup key and on a Zinc account with no wallet money; a connect order whose body has no `payment` is refused before it's sent. Wallet orders keep the buyer's key. `begin_placing` records the card on each order and returns it; only that card is sent, resends included. Other wallet checks to split: `hold-gate.ts`, `rounds/store.ts` (`canBuy`), `steps.ts` (balance warning), and the fee wording. Dev, previews and production each need their own Zinc account and Stripe mode, with today's environment check.
- **Held gifts.** No new hold reason: use `setup`, plus a server-only needs-a-tap mark on the order, because the daily run places `setup` holds by itself. A decline always marks the declined order; if the saved card is still the one recorded on it, it also clears the card and marks the buyer's other unplaced connect orders, as a removal does. Any connect order that approval, the app's gate or `begin_placing` finds without a saved card is marked too, under the account lock. Only Buy again clears it, and `begin_placing` refuses while it's set. Remove follows `zinc_forget`'s lock order, clears the database first, then detaches at Stripe.
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

## Principles check

- **Simplest version?** Stripe's page, no Stripe webhook, no wallet migration.
- **Bends:** 59's "inline" (revised by the owner above). One Zinc key for everyone is a bigger blast radius than one per buyer: AC-10, AC-19 and the off switch limit it.
- **New personal data:** two Stripe ids (T42).
- **Docs to update:** planning 59, T16, T56, T61, design §6.5a and §8, `operations.md`.
