# Spike: checkout and payment with Zinc (W1-2, ALL-16)

Date: 2026-10-25. Status: **done.** Desk research, sandbox and a real order ($3.42, delivered 2026-10-26) are complete (see [Real order](#real-order)).

## Recommendation

**Use Zinc. It passes every must-have, so Rye isn't needed.**

1. **Funding in two stages (T16).**
   - **MVP:** each user has their own Zinc account and wallet, connected with Zinc's "Allow" sign-in (no keys to copy and paste), and turns on auto top-up once. If an order is short of funds, Zinc charges the user's saved card and goes ahead. The app shows the balance and warns ahead.
   - **Later:** the user adds a card in our app, and Zinc Connect charges it per order through our Stripe account, with no wallet. The margin can be $0. It needs our own Stripe account, so it waits.
2. **Product lookups go through one app-owned Zinc account (T17),** so brainstorming never draws on a user's balance. (The real order showed why: two 1¢ lookups made it fail.)
3. **Set `max_price` to the approved ceiling minus the $1 fee.** It caps item, shipping and tax together.
4. **Send every gift order with `is_gift: true`**, plus `fulfillment.gift: "best_effort"` and an optional `gift_message`. This keeps prices off the packing slip and still places the order if a store has no gift option.
5. **Approval means buy now (T18).** A placed order can't be cancelled, only returned.

What this means for the rest of the design (data model, budget, purchase, funding, tracking) is written into `technical-design.md` v1.2.

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

## Real order

- **Sign-in and Allow worked** (`spikes/checkout/go-live.mjs`). The owner approved in the browser, and the script received a live key plus Zinc's **$5 starter credit**. The practice orders moved into the new account (allensforever711@gmail.com). This is the same flow W4-4 uses.
- **First try failed with `insufficient_funds`:** two 1¢ product lookups had left $4.98, and the order needed `max_price` + $1 = $5.00. That's the reason for T17.
- **Second try:** Lipton tea bags, $3.42 at Walmart, `max_price` $3.98, marked as a gift with a gift message, shipped to the owner. Zinc accepted it (`pending`), and **about 4 minutes later it was placed** with Walmart (Walmart order 200015359811878).
  - **Price:** subtotal $3.42, shipping $0, tax $0, total **$3.42**, comfortably under the $3.98 cap.
  - **Tax was $0** because Florida doesn't tax grocery food. So the tax estimate by state (§4.2) will often be high, which is the safe direction.
  - **Gift option:** Walmart's business checkout has none. Because we sent `fulfillment.gift: "best_effort"`, Zinc placed a normal order and reported it in `fulfillment.concessions` (`gift_option_unavailable`). Without best effort, the order would have failed. **Lesson:** a gift message isn't guaranteed, so the app should say "if the store supports it".
  - **Estimated delivery:** `job_result.estimated_delivery` said 2026-10-25, the same day the order was placed, which looks like a placeholder. **Don't trust the placement-time estimate.** Use the offer's delivery range until the carrier's estimate arrives with tracking.
  - The price breakdown is in `job_result.price_components` (not `result`).
- **Delivery: ordered Sunday 2026-10-25 at about 10:35 a.m. Eastern, received Monday 2026-10-26** (the owner confirmed it), so about a day.
  - **Zinc's tracking lagged the real delivery.** A Walmart tracking number arrived at 7:03 p.m. Eastern on the order day. On the 26th, once the owner had the package, Zinc still said `in_transit`, its only checkpoint was "Shipped" (2:37 p.m. Eastern), and `estimated_delivery_date` was `null`. No `order.delivered` had come yet.
  - **The carrier gave no estimate,** so for Walmart orders there was nothing better than the offer's delivery range. The placement-time estimate (the 25th) was a day early.
  - **Lesson for W5-1 (tracking and late risk):** treat "delivered" from Zinc as late and sometimes missing. The late-risk check should run on the offer's range and the order date, use the carrier's estimate when one exists, and let the giver mark a gift "arrived". One order is one data point; check again on Amazon orders, where Zinc's docs say estimates come through.
- **Wallet settled** at $0.56: the $5 credit, minus two 1¢ lookups, minus the $3.42 order and the $1 fee. The unused part of the $3.98 cap was refunded.

Watch-outs from doing it for real:
- The live key is returned once, in `key`. Persist it immediately and never log it (the first script version printed it; the owner should delete that key in Zinc after the spike).
- The device-code "still waiting" reply is nested (`{"error": {"code": "authorization_pending"}}`).
