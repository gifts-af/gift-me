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
| First fixed part | Set from estimates; $1.50 suggested. ALL-76 sets the final amount. A setting (T23) | Owner, 2026-11-25; amount not confirmed |
| Sandbox test first | Yes, once the real order is settled | Owner, 2026-11-25 |
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
GiftsAF fee (i)               $2.53
Most you'll pay              $25.12
[ Add a card ]   then back here: Visa ending 4242  [ Buy now ]
```
(Amounts are only an example: $1.50 fixed, plus the card fee on the whole charge. The real page also allows for the price cap.)

- **First gift:** Add a card, Stripe's page, back to the same gift. Nothing is bought until Buy now.
- **Later gifts:** the same two taps as today.
- **(i):** each part of the fee, labelled "Launch pricing: at cost".
- **Settings > Paying for gifts:** the saved card, Replace, Remove. No Zinc account, balance or top-up.

## Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A buyer with no card | They tap Add a card and finish on Stripe's page | They return to the same gift with the card shown, and nothing is bought |
| AC-2 | They cancel on Stripe's page, or the session belongs to someone else | They return | No card is saved |
| AC-3 | A saved card, ordering and connect on | Buy now | One Zinc order with `payment.mode` `connect`, their customer and card, and the margin from settings; the order records `funding_mode` `connect` |
| AC-4 | Any gift | The confirm page shows | The fee line and the most they can pay, card fees included; the buyer is never charged more |
| AC-5 | A budget | Totals are judged | The whole charge counts, fee included |
| AC-6 | The card is declined, or the bank wants approval | Buy now, or a held gift is placed | Nothing is bought; the gift is held; the buyer is emailed and asked to replace the card; saving one places it; never after ship-by |
| AC-7 | Zinc's answer is unclear | Placing | Same as today: looked up by reference, never resent (T56) |
| AC-8 | The order fails | Any time | Nothing is charged, and the email says so |
| AC-9 | The store cancels | After the charge | The email says the whole charge is refunded, fee included |
| AC-10 | Zinc posts events for connect orders | The app's one webhook | Signature checked; only the named order changes; another order's event can't touch it |
| AC-11 | A list owner's shared address | A buyer uses connect | The buyer can't see the street anywhere they can reach (real order), then the sharing wording returns to "never your street" |
| AC-12 | `connect_enabled` is off | Anyone | No connect order is placed and Add a card is hidden; wallet buyers are unaffected |
| AC-13 | The buyer removes their card | Settings | It's detached at Stripe; unplaced gifts are held, placed ones unaffected |
| AC-14 | A connect order's price is known | It's recorded | Zinc's fee and the card fee each write a cost record (ALL-144) |
| AC-15 | Fee settings change | Next confirm page | New amounts, no deploy; orders already placed keep theirs |
| AC-16 | A wallet buyer | Anything above | Exactly as today |

## How it fits (builder's starting points)

- **Fee math (`packages/core`).** `total = (goods + fixed + 30¢) / (1 − 2.9%)`, matching Zinc's example ($50 + $2.50 + $1 → $55.41). Cents, rounded up for the cap. The fixed part is Zinc's fee plus our margin; only the margin is sent.
- **`max_price` excludes margin and fees** (Zinc docs), so caps subtract the fee first, as `sequentialCaps` does with `fee_cents` now.
- **Placing.** `placeRound` and `begin_placing` gate on a saved card instead of a wallet when `funding_mode` is `connect`. One app Zinc key places these; wallet orders keep the buyer's key.
- **Held gifts.** A new hold reason for the card, alongside `funds`. Its place in the hold order and its emails need a mock-up.
- **Data.** Two ids on `accounts` (customer, payment method), never readable by the buyer's client. No card number, brand or last four stored; read from Stripe when shown.
- **Stripe customer:** our user id only (T42). Consent text on Stripe's page says when we charge and how much.
- **Settings:** `connect_enabled` (0), the margin, card fee percent and fixed cents, the fee labels.
- **Off switch:** `connect_enabled`, plus `zinc_ordering_enabled`.

## Out of scope

Moving wallet accounts; a spending page (ALL-145); a returns flow; tax; digital wallets such as Apple Pay. Going live needs sole proprietor or LLC, a live Stripe account, ALL-75 and a support inbox.

## Open questions

**Zinc (asked 2026-11-24, no reply):** hold length; returns to the card; chargebacks; whether $0 margin is supported; how bank approval is reported; whether Connect works in the sandbox. Their docs show the Stripe fee added on top, but not which account pays it at settlement.

**Sandbox test answers:** whether a Stripe sandbox connects with a `zn_test_` key; what a decline and a bank-approval request look like; whether events come to one app webhook.

**Owner:** the fixed part ($1.50?); the consent wording; the public name on statements (`GIFTSAF`?).

## Principles check

- **Simplest version?** Stripe's page, no Stripe webhook, no wallet migration.
- **Bends:** 59's "inline" (revised by the owner above). One Zinc key for everyone is a bigger blast radius than one per buyer: AC-10 and the off switch limit it.
- **New personal data:** two Stripe ids (T42).
- **Docs to update:** planning 59, T16, T56, T61, design §6.5a and §8, `operations.md`.
