# ALL-98 Pay by card through Zinc Connect: Spec (draft, not approved)

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
| After a declined card | Saving a new one buys the waiting gift, named on the Add-a-card screen. After a removed card, the buyer taps Buy again | Owner, 2026-11-25 |
| Wallet buyers and shared addresses | Not blocked: the only wallet buyers are the owner and Jim | Owner, 2026-11-25 |
| Store cancels | We refund everything and absorb Stripe's fee | Owner, 2026-11-25 |
| A decline Zinc doesn't tell apart | Today's "couldn't buy it" page | Owner, 2026-11-25 |
| Cards | US only at launch if card fees vary | Owner, 2026-11-25 |
| Sandbox test first | Yes, once the real order is settled. **No plan is written until it passes** (list below) | Owner, 2026-11-25; the gate is Claude's call |
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
[ Add a card ]   then back here: Visa ending 4242  [ Buy now ]
```
(Amounts are only an example: $2.00 fixed, plus the card fee on the whole charge. The real page also allows for the price cap.)

- **First gift:** Add a card, Stripe's page, back to the same gift. Nothing is bought until Buy now.
- **Later gifts:** the same two taps as today.
- **(i):** each part of the fee, labelled "Launch pricing: at cost".
- **Settings > Paying for gifts:** the saved card, Replace, Remove. No Zinc account, balance or top-up.

## Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A buyer with no card | They tap Add a card and finish on Stripe's page | They return to the same gift with the card shown, and nothing is bought |
| AC-2 | They cancel, the session is someone else's, or an old return link is opened again | They return | No card is saved: a pending session is used once, and its customer, user and mode are checked |
| AC-3 | A saved card and phone, ordering and connect on | Buy now | One Zinc order with `payment.mode` `connect`, their customer and card, and the margin saved at approval; the order records `funding_mode` `connect`. With no customer or card it's never sent |
| AC-4 | Any gift, replacement or held gift | It's approved | The most they can pay is shown and saved with the fee inputs; if today's is higher than shown, it asks again. The expected charge at any price up to the cap is at most that. If Zinc's actual charge is higher, the owner is alerted |
| AC-5 | A budget | Totals are judged on any screen or email | The whole charge counts, fee included, for that buyer's way of paying |
| AC-6 | The card is declined, or the bank wants approval | Placing | Nothing is bought, the gift is held once (not retried daily), the buyer is emailed and asked to replace the card; saving a new one, on a screen naming the gift, buys it; never after ship-by. An order Zinc has already created is never sent again: a new order row replaces it, keeping the shared-address owner and saved fee. If Zinc doesn't tell a decline apart, today's failed-gift page applies |
| AC-7 | Zinc's answer is unclear | Placing | Same as today (T56), using the key for the order's `funding_mode`, so the sweep and tracking work for both |
| AC-8 | The order fails | Any time | Nothing is charged; the email says a pending hold drops off |
| AC-9 | The store cancels | After the charge | The email says the whole charge is refunded, fee included |
| AC-10 | Zinc posts an event to the app's webhook | It's handled | Signature checked; the order is found first and the user comes from it; only `connect` orders change there, and only wallet orders at a buyer's own webhook. An unknown order gets 200 and an alert |
| AC-11 | A list owner's shared address | A buyer uses connect | The buyer can't see the street anywhere they can reach (real order). The sharing wording stays as it is while wallet buyers remain, because they can still see a street in Zinc **[Claude's call]** |
| AC-12 | `connect_enabled` is off | Anyone | No connect order is placed (checked in SQL under the lock) and Add a card is hidden; held ones are `paused`; events, sweep, tracking and Remove still work |
| AC-13 | The buyer removes their card | Settings | It's detached at Stripe; unplaced gifts are held until the buyer adds a card and taps Buy again; placed ones unaffected; a remove can't race a send |
| AC-14 | A connect order's price is known | It's recorded | Zinc's fee and the card fee each write a cost record (ALL-144) |
| AC-15 | Fee settings change | Next approval | New amounts, no deploy; approved orders, held ones included, keep theirs |
| AC-16 | A wallet buyer | Anything above | As today, proved by the existing wallet tests |
| AC-17 | A buyer with no phone | They add a card | The phone is asked for there, so a gift never waits for a wallet setup |
| AC-18 | Who pays by card | An account is created or an order approved | Read in SQL under the lock, never from the caller: wallet only if Zinc was connected before this ships; everyone else `connect`; a held order keeps its own |
| AC-19 | A key or account problem on our side | Placing | Held as `paused` with the owner alerted; never tells buyers to fix their setup |
| AC-20 | A card buyer | Any ordered, failed, cancelled, held or deadline email | Shows gift, fee and total, and never mentions a Zinc balance |

## How it fits (builder's starting points)

- **Fee math (`packages/core`), one function each way.** `charge(goods) = ceil((goods + fixed + 30) / (1 - pct))`; `cap(maxCharge) = floor(maxCharge * (1 - pct)) - fixed - 30`. Subtracting a fee worked out at the lower price is wrong: the fee grows with the price ($22.59 could have charged $27.71 against $27.63 shown). Property-tested across cents. $50 + $2.50 + $1 gives Zinc's $55.41; its exact rounding is checked in the sandbox.
- **`max_price` excludes margin and fees** (Zinc docs). Every total comes from the idea's price, shipping and tax plus the buyer's fee, because `est_total_cents` already contains the wallet's $1.
- **Saved on the order at approval:** margin, Zinc fee, percent, fixed cents and the approved maximum.
- **Placing.** `placeRound` and `begin_placing` gate on a saved card instead of a wallet when `funding_mode` is `connect`. One app Zinc key places these; wallet orders keep the buyer's key. Dev, previews and production each need their own Zinc account and Stripe mode, with today's environment check.
- **Held gifts.** No new hold reason: use `setup`. A decline clears the saved card only if it's still the declined one, so the tick stops retrying. Only the email wording differs.
- **Data.** Two ids on `accounts` (customer, payment method), never readable by the buyer's client. No card number, brand or last four stored. The confirm page says "Saved card"; details are read from Stripe in Settings.
- **Stripe customer:** we send our user id only (T42). Stripe's page may collect more itself; turn off what can be, and list the rest on `/privacy`. Consent text on Stripe's page says when we charge and how much.
- **Settings:** `connect_enabled` (0), the margin, card fee percent and fixed cents, the fee labels.
- **Left to the build:** consent wording, and the name on card statements (`GIFTSAF` suggested), shown to the owner as a mock-up.
- **Off switch:** `connect_enabled`, plus `zinc_ordering_enabled`.

## Out of scope

Runs by hand, with a runbook: returns, disputes, and an account deletion (no unsettled orders, delete the Stripe customer, then the account). Rolling back: switch `connect_enabled` off and let orders settle first.

Moving wallet accounts; a spending page (ALL-145); a returns flow; tax; digital wallets such as Apple Pay. Going live needs sole proprietor or LLC, a live Stripe account, ALL-75 and a support inbox.

## Open questions

**Zinc (asked 2026-11-24, no reply):** hold length; returns to the card; chargebacks; whether $0 margin is supported; how bank approval is reported; whether Connect works in the sandbox. Their docs show the Stripe fee added on top, but not which account pays it at settlement.

**Sandbox test: pass or fail, before any plan**
1. A Stripe sandbox connects and a `zn_test_` connect order places.
2. What a decline and a bank-approval request return: sync or later, and which code.
3. What makes the charge: whether the total includes our fees, how Zinc rounds, who pays Stripe's fee, whether the card fee is a fixed rate.
4. Whether events come to one app webhook, and what a hold looks like.


## Principles check

- **Simplest version?** Stripe's page, no Stripe webhook, no wallet migration.
- **Bends:** 59's "inline" (revised by the owner above). One Zinc key for everyone is a bigger blast radius than one per buyer: AC-10, AC-19 and the off switch limit it.
- **New personal data:** two Stripe ids (T42).
- **Docs to update:** planning 59, T16, T56, T61, design §6.5a and §8, `operations.md`.
