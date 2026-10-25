# Spike: checkout and payment with Zinc (W1-2, ALL-16)

Date: 2026-10-25. Status: **desk research and sandbox done; one real order still to place** (needs the owner's Zinc sign-in, see [Still to do](#still-to-do)).

## Recommendation

**Use Zinc. It passes every must-have, so Rye isn't needed.**

1. **Each user gets their own Zinc account and wallet, connected with Zinc's "Allow" sign-in** (no API keys to copy and paste). This confirms T6.
2. **Each user turns on Zinc auto top-up once.** If an order is short of funds, Zinc charges the user's saved card and goes ahead with the order, so it doesn't fail. The app still checks the balance first and listens for top-up failures.
3. **Set `max_price` to the full approved total.** It caps item, shipping and tax together.
4. **Send every gift order with `is_gift: true`**, plus `fulfillment.gift: "best_effort"` and an optional `gift_message`. This keeps prices off the packing slip and still places the order if a store has no gift option.
5. **Keep Stripe Connect in mind for later (D34).** It charges the user's own card per order, takes Zinc's $1 fee, and adds our margin. There's no wallet involved, but it needs our own Stripe business account, so it isn't for the MVP.

## Answers

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | How does each user pay with their own money (A-9)? | **One Zinc account and wallet per user.** Two other options exist: (a) **Stripe Connect** charges the user's card directly through *our* Stripe account; this suits the paid product later, not the MVP. (b) **Bring your own retailer account**, where Zinc logs in to the user's Amazon; Zinc advises against this for customers' accounts. | [Wallet](https://www.zinc.com/docs/v2/wallet.md), [Connect](https://www.zinc.com/docs/v2/connect.md), [Retailer accounts](https://www.zinc.com/docs/v2/retailer-accounts.md) |
| 2 | Can wallet funding be automated? | **Yes.** Auto top-up: the user sets a minimum balance and a top-up amount in Zinc. On a shortfall, Zinc charges the saved card before refusing an order. It turns itself off after 3 failed charges, and webhooks report each case (`wallet.auto_topup.succeeded`, `.failed`, `.disabled`). `GET /wallet/me` returns `spendable_balance` for a free pre-check. There is no public API for the *app* to add funds; that happens in Zinc's dashboard. | [Webhooks](https://www.zinc.com/docs/v2/api-reference/introduction/webhooks.md), [Get wallet](https://www.zinc.com/docs/v2/api-reference/wallet/get-wallet.md), changelog 2026-07 |
| 3 | Pricing and minimums | **$1 per successful order**; failed orders are free. Product data costs $0.01 per call (search, details, offers). Top-up fees: card 2.9% + $0.30, ACH 0.8% (max $5), wire $15. Top-ups run from $15 to $100,000. No platform minimum and no monthly fee. Volume pricing starts at 1,000 orders a month. | [FAQ](https://www.zinc.com/faq), [Wallet](https://www.zinc.com/docs/v2/wallet.md) |
| 4 | Does `max_price` include shipping and tax? | **Yes, it's the whole order total.** The docs say "product, shipping, and tax". Our sandbox order showed a subtotal of $39.55 + tax $3.46 + shipping $5.99 = total $49.00 against `max_price` 5000 ($50.00). The wallet must hold `max_price + $1` when the order is placed; the unused part is refunded. `max_price` is never relaxed. | [Agentic purchases](https://www.zinc.com/docs/v2/agentic-purchases.md), sandbox run |
| 5 | Delivery estimates: where and how accurate? | **Before buying:** offers return `handling_days {min,max}` and `shipping_options[].delivery_days {min,max}`, which is a range rather than a date. **After buying:** each `tracking_numbers[]` entry has the carrier's `estimated_delivery_date` and checkpoints. `order.estimated_delivery_updated` fires when Amazon revises its estimate. **Accuracy can't be measured in the sandbox** (it returns `null`); the real order will give one data point. | [Offers](https://www.zinc.com/docs/v2/api-reference/products/get-product-offers.md), [Tracking](https://www.zinc.com/docs/v2/api-reference/orders/tracking.md) |
| 6 | Webhook events and signing | Orders: `order.started`, `.placed` (with price breakdown), `.failed` (with `error_type`), `.tracking_received`, `.shipped`, `.estimated_delivery_updated`, `.available_for_pickup`, `.delivered`, `.cancelled`. Returns: `return.*`. Wallet: `wallet.auto_topup.*`. **Signing:** HMAC-SHA256 of the raw body using the account's `zn_whsec_` secret, sent in `X-Webhook-Signature`. Events can be delivered more than once, so dedupe on `event` + `order_id`. The URL is set per account through the API (`Set Webhook Endpoint`). | [Webhooks](https://www.zinc.com/docs/v2/api-reference/introduction/webhooks.md) |
| 7 | Does lookup give live price, availability, shipping and delivery for ideas? | **Yes, for Amazon and Walmart.** `GET /products/{id}/offers` returns per-seller `price`, `available`, `handling_days` and `shipping_options[]` (price and delivery days); there is **no tax**, so we keep estimating it (§4.2). Best Buy, Shopify and Etsy use `GET /products/{id}` instead. `GET /search` searches across retailers (beta). `GET /retailers/check?url=` says whether Zinc will try a given store URL. Each call costs $0.01. | [Offers](https://www.zinc.com/docs/v2/api-reference/products/get-product-offers.md), [Check retailer](https://www.zinc.com/docs/v2/api-reference/retailers/check-retailer.md) |
| 8 | Sandbox or test mode? | **Yes, and it's good.** `POST /sandbox/keys` mints a free `zn_test_` key with no account. Test product URLs cover success, price exceeded, out of stock, invalid address, unreachable URL, invalid variant, shipping unavailable and insufficient funds. A test order delivers in about 5 seconds. Test mode has its own webhook settings. Keys expire after 7 days unused. | [Sandbox](https://www.zinc.com/docs/v2/api-reference/introduction/sandbox.md) |

## What we ran (sandbox)

Script: [`spikes/checkout/sandbox.mjs`](../../spikes/checkout/sandbox.mjs). Run it with `node spikes/checkout/sandbox.mjs`. It needs nothing to be installed.

| Test | Result |
|---|---|
| `GET /wallet/me` | 200. `spendable_balance` 0, `order_fee_cents` 100 |
| Search "cozy throw blanket", then offers | 200. Two offers, each with price, `available`, handling days, and shipping price plus delivery days (2–5) |
| `test-success` as a gift with a gift message | 201. Order placed; price breakdown as in answer 4; tracking went from `in_transit` to `delivered` within seconds |
| `test-price-exceeded` | 201, then `order_failed` with `max_price_exceeded` |
| `test-out-of-stock` | 201, then `order_failed` with `out_of_stock` |
| `test-insufficient-funds` | **402 straight away**, with `required`, `available` and `short_by` |

Note: order `status` stops at `order_placed`. Shipping progress is on `tracking_numbers[].status`.

## What this changes in the design

- **§4.2 Budget:** `max_price` covers the full total, so there's no item-only cap. Check that the wallet has `max_price + order_fee_cents` before placing an order.
- **§6.5 Purchase:** gift fields (`is_gift`, `gift_message`, `fulfillment.gift: "best_effort"`); one order per idea; map `order.failed` `error_type` to the right `needs_attention` message (`max_price_exceeded` means "price went up", A-4); pass an `idempotency_key` per round and idea, so a retry can't buy twice.
- **§6.5a Funding (and ALL-32):** connect with Zinc's sign-in. The app requests a code (`POST /device/code`), the user clicks Allow at `app.zinc.com/activate`, and the app collects that user's live key once (`POST /device/token`), then stores it in Vault. The app then registers its webhook URL on that account. The user turns on auto top-up, and the app reminds them if `wallet.auto_topup.disabled` arrives.
- **§6.6 Tracking:** use `tracking_numbers[].estimated_delivery_date` and `order.estimated_delivery_updated` for the late-risk check.

## Risks and gaps

- **No API to add funds.** If a user leaves auto top-up off, we fall back to the "top up your balance" email (already in §6.5a).
- **Every user has to sign up for Zinc.** That's a little friction for the 3 MVP users, and it's the cue to move to Stripe Connect once there's a business (D34).
- **Tax isn't known until the order is placed.** Keep a buffer in `est_total` (already in §4.2).
- **Real-world success rate and placement time are unmeasured.** Zinc says placement takes anywhere from about 10 seconds to a couple of hours. The research suggested a trial of about 20 orders; for the MVP, one order now and watching the first real rounds is enough.
- Zinc is changing fast: the v2 API, weekly changelog entries, and Connect wallet funding added 2026-10-23. Pin the API version in Wave 4.

## Still to do

- [ ] **One real low-cost order** (owner). Zinc's "go live" gives a **$5 starter credit**. With the $1 fee, the item plus tax and shipping must come in under $4. Steps: the script asks for a code, you click Allow at `app.zinc.com/activate`, then we place one real order and track it to delivery. That also tests the sign-in flow for ALL-32.
- [ ] Record its real delivery estimate against the actual delivery date (answer 5).
