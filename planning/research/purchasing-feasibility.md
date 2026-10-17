# Gift Concierge: Purchasing, Checkout and Fulfillment Feasibility

Research date: 2026-10-17. Sources are listed at the end and cited inline as [S#].

**How to read this report.** Agentic commerce changed a lot between late 2025 and October 2026, and much of the coverage comes from vendor blogs and trade press. Claims are marked as follows:
- **(verified)**: checked against a primary source (vendor docs, a court opinion, an official pricing page).
- **(secondary)**: reported by third parties and not confirmed against a primary source.
- **(unknown)**: could not be found. Ask the vendor.

Treat pricing as provisional until you see it in a signed agreement or on a live pricing page.

---

## 1. Executive summary

1. **You can buy from any store through a third-party API today, but every option is young and has gaps.**
   - **Zinc** (verified): $1 per successful order. Works on Amazon, Walmart, Target, Best Buy and others. Requires a prefunded wallet and a `max_price` cap on every order. Returns tracking with estimated delivery dates.
   - **Rye** (verified): Universal Checkout from a product URL, covering Shopify, Amazon, Best Buy and "thousands more." Limits: US only, one product per checkout, no post-purchase webhooks except for Amazon, and default rate limits of 50 requests per day. Pricing is not published.
   - Together these two cover the "buy directly from any store" path for an MVP. Neither is a proven platform at consumer scale.

2. **Agent-native protocols exist, but most are for platforms selling inside their own surfaces.**
   - **Shopify Catalog plus UCP/Checkout MCP** is the most open option for an independent developer. You register an agent profile, and catalog search covers all Shopify merchants. Higher trust tiers can complete checkout directly. Lower tiers hand the buyer off to the merchant's checkout.
   - **OpenAI Instant Checkout** was discontinued in March 2026. ChatGPT now focuses on discovery, though the ACP spec is still published.
   - **Google UCP/AP2, Visa Intelligent Commerce and Mastercard Agent Pay** are mostly integrations for large platforms and merchants, not APIs a small app can use to buy from arbitrary stores.

3. **Buying through the user's own Amazon account is the riskiest path.**
   - Amazon's Associates Program Policies (updated 2026-04-14) contain Agent Terms: an agent must identify itself as `Agent/[name]`, must not mimic humans or solve CAPTCHAs, and must not get around blocks. Amazon reportedly added similar Agent Terms to its customer Conditions of Use.
   - Amazon blocked Meta's Muse agent on 2026-09-20 and cited credential capture as one reason.
   - The Ninth Circuit vacated the Perplexity injunction on 2026-08-04. The court held that the user, not the agent vendor, is the party "accessing" Amazon when the agent runs locally on the user's device. That narrows CFAA risk for an extension that runs locally. It does not remove the terms-of-service risk or the risk of the user's account being closed.
   - Zinc itself advises against using end customers' retailer accounts.

4. **Amazon affiliate income does not fit an app that places orders.**
   - The Associates policies forbid making "orders ... on an Amazon Site on behalf of any other person" (§6(k)). They also forbid Associates purchasing through their own Special Links (§4(u)) and using program content to train ML models.
   - Plan to make money from fees, not Amazon affiliate commissions.

5. **For a public launch, the cleanest model is for the app to be the buyer (merchant of record, or a reseller-like "purchasing service").**
   - The app charges the user with Stripe, then pays the retailer with its own funds. Stripe Issuing single-use virtual cards (verified: $0.10 per virtual card) fit this well. Stripe's "Issuing for agents" lists "making purchases to fulfill a service" as a supported use for cards a business issues for its own purchases.
   - You get hard per-gift spend caps, merchant category locks, and real-time approve or decline by webhook.
   - Stripe does **not** currently support consumer-funded Issuing for self-serve accounts. So the cards must be funded by the business, which is the app.

6. **Gift platforms can solve the "no address" problem.**
   - **Goody's Commerce API** (verified) creates gifts without an address. The recipient gets a link, can swap the gift, and enters their own address.
   - **Snappy** offers a similar Triggered Gifting flow, but its API is on the Enterprise tier only.
   - **Giftbit and Tango** handle digital gift cards, mostly at face value.
   - These make a strong fallback for last-minute gifts and unknown addresses.

7. **Delivery-date estimation must come from the checkout, not the catalog.** Catalog and feed data is "not a transactional commitment" (UCP docs). Use estimates from the checkout session (UCP fulfillment, Rye or Zinc shipping options), then confirm with carrier tracking (Zinc tracking, EasyPost, AfterShip, 17TRACK). Use EasyPost SmartRate percentiles or AfterShip predictive EDD when the app ships something itself.

8. **Economics:**
   - Affiliate rates are thin: Amazon about 1–4% in most gift categories, Walmart 1–4%, Target up to 8% (most categories lower), Etsy about 4% (secondary).
   - Per-transaction costs: Stripe 2.9% + $0.30, Zinc $1 per order, Issuing $0.10 per card, possibly Stripe Tax at $0.50 per transaction.
   - Comparable B2B gifting platforms charge about 15% (Snappy service fee). Consumer gift-idea apps charge $2–$18 per month.
   - A realistic model is a subscription of roughly $5–$15 per month plus a per-gift service fee of $3–$5 or 5–10%. These are suggestions to validate, not market data.

---

## 2. Comparison table: purchasing and checkout options

| Option | What it does | Maturity (Oct 2026) | Merchant coverage | Cost | Key risks and limits |
|---|---|---|---|---|---|
| **Zinc API** [S10] | Places orders on retailer sites. Defaults to Zinc's own accounts, or yours as a managed option. | Production. Long-running service. (verified) | Amazon, Walmart, Target, Best Buy and others, listed at `GET /retailers`. Zinc accounts ship only to the US, Germany and Italy. | $1 per successful order plus item cost. Product data $0.01 per call. Wallet top-up by card costs 2.9% + $0.30, ACH 0.8% (cap $5). | Prefunded wallet. Up to 10 items per order, one retailer per order. Cannot cancel once placed (a return is the fallback). Advises against using end customers' accounts. Retailer terms risk sits with Zinc. |
| **Rye Universal Checkout** [S7][S8] | Checkout intent from any product URL, then a confirmed order. | Production API. Docs now redirect to `docs.commerce.jolly.dev`, so a rebrand is possible (unknown). | Shopify, Amazon, Best Buy, "thousands more." | Not published (unknown). | US only. One product per checkout. Intents expire after 45 minutes. No post-purchase webhooks; tracking goes to the buyer's email, except Amazon. Default 5 requests/second and 50 per day. |
| **Shopify Catalog + UCP / Checkout MCP** [S13][S14] | Search all Shopify merchants. Cart, then checkout. Direct completion at higher trust tiers. | Live. Approval-free agent profiles since Spring '26 (secondary). Universal Cart is waitlist only. | Shopify merchants (millions of stores). Universal Cart adds off-Shopify stores (early access). | Fees not stated (unknown). | Trust tier controls rate limits and whether you can finish checkout or must hand off to the merchant. The merchant is merchant of record. |
| **Stripe Shared Payment Tokens / ACP** [S16][S17] | You, as the agent, issue a scoped token (amount cap, expiry, one seller) to a Stripe merchant. | Preview API (`2026-09-30.preview`). | Only sellers with a Stripe profile that accept SPTs. US, Canada, much of Europe. | Normal processing on the seller side. Agent fees not published (unknown). | Coverage is limited to sellers that opted in. Good for spend safety, not universal. |
| **Stripe Issuing (single-use virtual cards)** [S18][S19][S20] | Your business issues a card per purchase, with limits, MCC locks, and a real-time auth webhook. | Production. "Issuing for agents" is documented. | Any merchant that accepts Visa or Mastercard. | $0.10 per virtual card. Per-transaction fee not on the pricing page (an older Stripe post cited 0.2% + $0.20 after $500K). | Business-funded only. Consumer use "not currently supported" self-serve. Platform/consumer cards need a sales conversation. |
| **Browser automation** (Browserbase, computer-use agents) [S30] | An LLM agent drives a real checkout in a cloud browser. | Technically workable. Brittle. | Any site, in theory. | Browserbase about $20–$99 per month plus about $0.10–$0.12 per browser-hour (secondary). Plus LLM tokens. | Bot detection. Amazon Agent Terms forbid hiding agent identity and solving CAPTCHAs. Cloud-run agents are exactly the scenario the Ninth Circuit left open. High failure rate. |
| **Browser extension in the user's own session** | Fills the cart and checks out in the user's logged-in browser. | DIY. | Any site the user is logged into. | Engineering only. | Must identify as an agent on Amazon. Retailers can block it. Risk to the user's account. Runs only while the user's browser is open, which rules out fully automatic purchases. |
| **Goody Commerce API** [S22][S23] | Curated catalog. Gift link lets the recipient swap and enter their address. Or ship direct. | Production. | Goody's catalog, not arbitrary stores. | Prefunded "stored value." Revenue share by agreement. Per-gift fees not published (unknown). | Limited catalog. Business development agreement needed before going live. |
| **OpenAI ACP / Instant Checkout** [S4][S5] | In-ChatGPT checkout. | Instant Checkout discontinued March 2026. ACP spec still published. | Not applicable to a third-party app. | Not applicable. | Not a buying channel for you. |
| **Google UCP + AP2** [S11][S12] | Agentic checkout in AI Mode and Gemini. Mandates for authorization. | Live in Google surfaces. Open spec (Apache 2.0). | Walmart, Target, Shopify, Etsy and others inside Google. | Not applicable. | UCP is usable via Shopify. Direct use of AP2 by a small app is unproven (unknown). |
| **Visa Intelligent Commerce / Mastercard Agent Pay** [S24][S25] | Network "agentic tokens" bound to an agent. | Visa Connect: pilot, GA targeted June 2026 (GA unconfirmed). Agent Pay: US rollout reportedly complete November 2025 (secondary). | Card-network wide. | Contact sales. | Enterprise onboarding. Stripe may use these tokens automatically for SPTs. |
| **Amazon "Buy for Me"** [S26] | Amazon's own agent buys on brand sites from inside the Amazon app. | Live. Amazon-internal. | Amazon app users. | Not applicable. | No third-party API. Not usable by you. |
| **Perplexity Instant Buy (PayPal)** [S27] | In-chat buying inside Perplexity. | Live (secondary). | About 5,000 PayPal merchants. | Not applicable. | Perplexity-internal, not an API. |
| **Henry Labs / Violet / Firmly** [S28][S29] | Multi-merchant cart and checkout APIs. | Henry: SDK and sandbox exist (secondary). Violet: unified checkout across e-commerce platforms. Firmly: merchant-side enablement. | Merchants that integrated with them. | All sales-led (unknown). | Coverage and pricing are opaque. Evaluate in a sandbox. |

---

## 3. Product discovery and catalog data (Question 1)

| Source | Price | Stock | Delivery estimate | Access | Cost |
|---|---|---|---|---|---|
| **Amazon Creators API** (replaces PA-API 5) [S1][S2][S3] | Yes (OffersV2) | Availability type and message | No explicit "arrives by" date found (unknown) | Approved Associates account. One guide says 10 qualified sales in the last 30 days (secondary). | Free, but tied to Associates. PA-API 5 was retired around April 30 / May 15, 2026 and returns 403. |
| **Walmart affiliate APIs** (via Impact) [S31] | Yes | Yes | Not confirmed | Impact affiliate approval | Free. Commission 1–4%. |
| **Target** [S32] | Via Impact feeds | Unclear | Not confirmed | Impact (Target Partners) | No public product API found. Up to 8%. |
| **eBay Browse API** / Order API [S33] | Yes | Yes | Shipping options per item | Browse: developer key. Order API: **limited release**, business-unit approval. | Free. EPN commissions (unknown rates). |
| **Etsy Open API v3** [S34] | Yes | Quantity | Processing and shipping profiles | API key for public reads. Commercial access needs a manual review. | Free. Affiliate via Awin, about 4% (secondary). |
| **Best Buy API** [S35] | Yes | Yes, including store availability | Limited | Free API key. Restrictions on caching. | Free |
| **Shopify Global Catalog** [S13] | Yes | Yes | Through UCP fulfillment at checkout | Agent profile and trust tier | Unknown |
| **Google Shopping** [S36][S37] | Through scrapers only | Partial | Partial | No official public search API. The Merchant API is for merchants managing their own feeds. | SerpApi from $25 per 1,000 searches, down to about $5.50 per 1,000 at volume |
| **Channel3** [S38] | Yes, live offers | Yes | Unknown | API key | 1,000 free searches, then about $7 per 1,000 (vendor blog). Built-in affiliate attribution. |
| **Affiliate networks** (Rakuten, CJ, Impact, Skimlinks, Sovrn) | Product feeds per advertiser | Feed-dependent | Rarely | Publisher approval per network and advertiser | Free. Skimlinks and Sovrn take a revenue share. Rates not researched in depth (unknown). |

**Discovery takeaways:**
- For an MVP, use Channel3 or SerpApi to discover ideas, and Shopify Global Catalog for buyable inventory.
- Use the retailer APIs (Best Buy, eBay Browse, Etsy) for enrichment.
- Amazon data requires Associates eligibility and comes with a ban on ML training (§IP License 1 and 2(e)) and a ban on image caching [S9]. Do not use Creators API data to train or fine-tune models.

---

## 4. Programmatic and agentic checkout (Question 2)

**Production-ready today for an independent app:**
- **Zinc** [S10]. Most mature for the big-box retailers. $1 per order. Wallet-based. `max_price` gives a natural safeguard. Webhooks for placed, failed, tracking_received and delivered. Returns API.
- **Rye** [S7][S8]. Works from a URL. Can show the buyer final costs before confirming (multi-step intents). The lack of webhooks and the default 50 requests per day are real constraints. Negotiate before you depend on it.
- **Shopify Checkout MCP / UCP** [S13][S14]. Best for Shopify DTC brands, which make up much of the gift-worthy long tail. Direct checkout completion depends on trust tier.
- **Stripe Issuing virtual cards plus any checkout path** [S18]. Stripe documents browser checkout with single-use card credentials and programmatic checkout via SPTs.

**Not usable as your buying channel:**
- OpenAI Instant Checkout (discontinued [S4][S5]).
- Amazon Buy for Me (internal [S26]).
- Perplexity Instant Buy (internal [S27]).
- Walmart's and Target's UCP and ChatGPT integrations, which are partnerships with Google and OpenAI [S39].

**Emerging and worth watching:**
- Stripe SPTs (preview).
- Visa Intelligent Commerce Connect (GA unconfirmed).
- Mastercard Agent Pay.
- Shopify Universal Cart (waitlist).
- Henry Labs.

**Main limitations across all options:**
- Most cannot cancel an order once the retailer has accepted it.
- Many are US only.
- Many allow one item or one merchant per order.
- Tracking is inconsistent.
- None publishes service-level agreements for success rates.

---

## 5. Purchasing through the user's own accounts (Question 3)

**What the terms say:**
- **Amazon Associates Program Policies** (last updated 2026-04-14) [S9]:
  - Agent Terms §4 define an "Agent" as software taking "autonomous or semi-autonomous action" for a person.
  - Agents must identify themselves in the user agent string as `Agent/[agent name]`.
  - Agents must not mimic human speed or patterns, or complete or bypass CAPTCHAs.
  - Agents must answer truthfully when asked whether they are a computer.
  - Agents must not get around blocks.
  - Amazon may limit agent access "at its sole discretion."
  - Separately, §6(k) bans making orders "on behalf of any other person."
- **Amazon Conditions of Use** (customer terms): third-party trackers report a parallel Agent Terms section with the same identify-yourself and no-circumvention rules, plus the long-standing ban on "robots ... or automatic process" without permission [S40][S41].
  - Amazon's own page returned HTTP 503 during this research, so the exact customer-terms wording is **(secondary)**.

**Enforcement and case law:**
- **Amazon v. Perplexity**, 9th Cir. No. 26-1444, decided 2026-08-04 [S42][S43]:
  - The preliminary injunction was vacated. The court held that Amazon is unlikely to win on its CFAA and CDAFA claims, because the user operates the agent locally and Perplexity is not the party accessing Amazon.
  - Commentators note the ruling is narrow (local execution). The court said it does not affect Amazon's ability to control agents through its terms of service.
  - Rehearing was reportedly denied on 2026-09-10 (secondary).
- **Amazon blocked Meta Muse** on 2026-09-20 [S41]. Reasons given:
  - no advance notice
  - the agent does not identify itself
  - it appeared to capture and store credentials

**Technical options, from lowest to highest risk:**
1. **Hand off to the user's own account, with the user doing checkout.** The app builds the cart or deep link, and the user taps buy. No ToS issue, but no automation.
2. **Browser extension running locally in the user's session.** It identifies itself as `Agent/GiftConcierge`, never stores passwords, and never solves CAPTCHAs.
   - This closely matches the Perplexity fact pattern the Ninth Circuit protected under the CFAA.
   - It is still subject to Amazon's ToS and blocking, and the user's account bears the risk.
   - It needs the browser open, so it does not work for unattended auto-purchases.
3. **Cloud browser holding the user's stored credentials or session cookies.** This is what Amazon objected to with Muse, and it is the scenario the Ninth Circuit left open.
   - Credential storage creates a breach liability (passwords, MFA, saved cards).
   - **Not recommended.**
4. **OAuth:** No major retailer offers OAuth scopes that let a third party place orders on a consumer's account. eBay's Order API v1 uses user OAuth tokens but is limited release [S33]. Shopify Shop Pay identity linking exists inside UCP flows (unknown details).

**Recommendation:** Support "own account" only as an assisted checkout: a prefilled cart plus a one-tap human confirmation, or a local extension that identifies itself. Do not offer unattended purchases on the user's Amazon account.

---

## 6. Gift-sending platforms as a fulfillment layer (Question 4)

| Platform | API | Recipient-chooses / no address needed | Catalog | Pricing |
|---|---|---|---|---|
| **Goody** [S22][S23][S44] | Commerce API and Automation API. `POST /v1/order_batches`. Send methods: `email_and_link`, `link_multiple_custom_list`, `direct_send`. Webhooks. | Yes. Gift link, recipient swaps the gift and picks variants, then enters an address. | Curated brands (e.g. Brooklinen, Bose, Levain) | Prefunded stored value. Revenue share needs a business development agreement. Consumer and business plans include a free Starter tier (secondary). |
| **Snappy** [S45] | Direct Fulfillment and Triggered Gifting APIs. **Enterprise tier only.** | Yes (Triggered model: Snappy handles claiming and address collection) | Curated, recipient-choice collections | 15% service fee on claimed gifts (official FAQ). Paid tiers about $999 to $2,000 or more per year (secondary). |
| **Sendoso** [S46] | REST API. OAuth credentials by emailing sales. | Address-collection features exist (not verified in detail) | Corporate gifting marketplace | Enterprise (unknown) |
| **Loop & Tie** | Nothing found (unknown) | Recipient-choice is its core product (marketing) | Curated | Unknown |
| **Tango Card (RaaS API)** [S47] | Mature rewards API | Digital gift cards, sent by email | 1,000+ brands (marketing) | Claims "no fees". Setup fees for customization (secondary). |
| **Giftbit** [S48] | API | Digital gift cards and choice links | Many brands | Face value. 2.9% fee for card funding. $2.95 for physical Visa. |

**Fit:**
- Goody (or Snappy, if Enterprise is affordable) is the right fallback when you don't have an address, the deadline is too close for a long-tail store, or the user wants recipient choice.
- Goody's B2B positioning means you need to confirm a consumer-facing reseller use is allowed in its agreement.
- Gift cards (Tango, Giftbit) give a same-day guaranteed fallback for missed deadlines.

---

## 7. Payments and money movement (Question 5)

**Models:**
- **App as merchant of record, or "purchasing service."**
  - The user pays the app the gift price plus a fee. The app buys from the retailer with its own funds (Issuing card or Zinc wallet). The app owns customer support, returns and chargebacks.
  - Simplest for money-transmission analysis: the app sells a service or goods and is not forwarding the user's money to a third party.
  - The app takes on sales-tax obligations (see below) and chargeback exposure.
- **Agent or pass-through model.**
  - The user's own card is charged by the retailer, either through SPTs [S17] or the user's own account.
  - The app never touches the funds, so it is not a money transmitter and has no MoR liability. But automation is limited, and coverage is limited to SPT-enabled sellers.
- **Money transmission.**
  - FinCEN excludes payment processors acting for the *payee* (seller). State "agent of the payee" exemptions exist in some states, not all [S49].
  - A buyer-side agent that holds a user's funds and pays third parties sits on the wrong side of that line.
  - Structuring as a seller of a gift-purchasing service (charge the user, then buy with your own funds) avoids most of this. Holding stored balances or "gift budgets" for users increases risk.
  - **Get a fintech lawyer's opinion before the public launch.**

**Stripe Issuing as a safeguard** [S18][S19][S20]:
- One single-use virtual card per gift.
  - `spending_limits` per authorization equal to the approved price plus a tax and shipping buffer.
  - `allowed_categories` set to retail merchant category codes.
  - Card metadata holds `order_id` and `recipient_id`.
- A real-time `issuing_authorization.request` webhook (2-second timeout) checks:
  - the merchant matches the planned retailer
  - the amount is within budget
  - the cancel window has expired
  - the user has not paused
- Cards are automatically invalidated after use. Automated disputes are available for overcharges.
- **Constraint:** cards must be business-funded. The Stripe support page says consumer use cases are "not currently supported" and cards "may not be funded ... by an individual's personal funds."
  - So cards must be issued as your business's purchasing cards, funded from your Issuing balance after you have charged the user separately.
  - Confirm with Stripe that this "purchases to fulfill a service" pattern is approved for your gifting business [S18].

**Collecting from users:**
- Stripe Payments at 2.9% + $0.30 per transaction [S20].
- Authorize at the gift approval, then capture at purchase. Card authorizations expire after about 7 days (general Stripe behavior, not re-verified here), so for gifts planned further ahead, charge closer to the purchase date or use saved payment methods with consent.

**Chargebacks:**
- $15 per dispute [S20].
- Mitigate with:
  - explicit consent records (budget, recipient, cancel window)
  - receipts showing the retailer order and tracking
  - clear refund policies

**Returns:**
- Zinc's returns API [S10] or the retailer's own policy. Rye has no returns API documented. Under MoR, the app refunds the user and recovers the money from the retailer. Gift receipts are a feature gap to check per channel.
- Amazon Buy for Me sends returns to the brand storefront [S26], which shows how messy third-party returns get.

**Sales tax:**
- If the app resells goods, a drop shipment is two sales. You may buy for resale tax-free only with state-specific resale certificates, and many retailers (Amazon, Target) will charge you tax anyway, which risks double tax [S50].
- Pragmatic approach: structure the user charge as a pass-through of the retailer's taxed total plus a separately stated service fee.
- Whether a "gift purchasing service fee" is taxable varies by state (unknown). Get tax counsel.
- Stripe Tax costs $0.50 per API transaction [S20].

---

## 8. Delivery-date estimation and tracking (Question 6)

**Before you buy (arrives-by):**
1. **Checkout-time estimates are the most reliable.**
   - UCP's fulfillment extension carries methods, prices and ETA at checkout. Catalog data is "not transactional commitments; the checkout process is the authoritative source" [S51].
   - Rye and Zinc return shipping options and costs at checkout. Exact ETA fields were not confirmed for Rye (unknown).
2. **Carrier service standards** as a cross-check:
   - USPS Service Standards API v3 (ZIP-to-ZIP days; "not guarantees") [S52]
   - UPS Time in Transit API [S53]
3. **Statistical prediction:**
   - EasyPost SmartRate gives transit-day percentiles (p50–p99) and "Smart Deliver By," which returns a ship-by date for a target delivery. 500 free calls, then $0.03 per call. US domestic only [S54].
   - AfterShip predictive EDD returns earliest, latest and most-likely dates. You enable it through sales [S55].
   - These model carrier transit. Merchant handling time must be added separately (estimate it per merchant from your own order history).
4. **Policy:** plan purchases at deadline minus (p90 transit + merchant handling + 2 days buffer). If the risk exceeds the threshold, escalate to a faster shipping option or fall back to a gift card or Goody e-gift.

**After you buy (tracking):**
- Zinc: tracking webhooks with `estimated_delivery_date`, multiple parcels per order, and polling of UPS, FedEx, USPS, Amazon Logistics and DHL [S10].
- Rye: tracking goes to the buyer's email only (except Amazon). Use a dedicated per-order inbox address to parse it, or register the number with a tracker [S8].
- Tracking APIs:
  - EasyPost: per-tracker fees, about $0.01–$0.03 (secondary)
  - AfterShip: Pro about $59–$74 per month (secondary)
  - 17TRACK: about $119 for 5,000 tracking quotas per year (secondary) [S56][S57]

---

## 9. Monetization economics (Question 7)

| Retailer / network | Typical commission | Notes |
|---|---|---|
| Amazon Associates | About 1–4% for most gift categories. Luxury beauty 10%. Gift cards 0%. (secondary) [S58] | You **cannot** earn on orders your app places for others (§6(k)), or on your own personal purchases (§4(u)). |
| Walmart (Impact) | 1–4% (Walmart FAQ: "up to 4%") [S31] | A Creator program advertises up to 18% (secondary). |
| Target Partners (Impact) | 1–8%. Several categories at 0%. 7-day cookie. [S32] | The rate card is not public. |
| Etsy (Awin) | About 4% standard (secondary) [S34] | |
| Channel3 | Built-in attribution, rates per offer (vendor) [S38] | |

**Per-transaction cost stack** for a $50 gift bought through the MoR path:
- Stripe card fee: about $1.75
- Zinc: $1 (or Rye, unknown)
- Issuing card: $0.10
- Stripe Tax: $0.50 (optional)
- Total: about **$3.35, or 6.7%**, before support, returns and chargebacks.

**Comparable pricing:**
- Snappy: 15% service fee on claimed gifts [S45]
- Goody consumer and business: free Starter tier, Pro about $20 per user per month (secondary) [S44]
- Consumer AI gift-idea apps: $1.99 per week to $18 per month (Intelli.gift $6 and $18 tiers) [S59]
- No consumer app was found that auto-buys and ships gifts on a subscription, which is a possible gap in the market (unverified).

**Suggested model (hypothesis):**
- Free or low tier with ideas and assisted checkout.
- Paid subscription at $8–$15 per month, including N auto-gifts.
- Per-gift service fee of the greater of $3.99 or 8%, with the shipping or price-protection buffer passed through at cost.
- Affiliate revenue only on links the user clicks (idea mode). Never on orders the app places itself.

---

## 10. Recommended phased approach

**Phase 0: v1 personal use (now to about 3 months)**
- **Discovery:** an LLM gift brainstorm, then Channel3 or SerpApi Google Shopping, plus Shopify Global Catalog.
- **Purchase modes:**
  - (a) **Assisted own-account:** the app prepares a cart or link on Amazon, Target or Walmart, and you click buy. No automation on retailer sites.
  - (b) **Direct buy:** Zinc (big-box retailers) and Rye (Shopify and DTC) using **your own** Stripe Issuing single-use cards, or a Zinc wallet.
- **Fallback:** Goody gift link or a Giftbit or Tango gift card when there's no address or the deadline is at risk.
- **Delivery:** use checkout ETA plus the EasyPost SmartRate p90 cross-check, track with Zinc webhooks or AfterShip, and keep a per-merchant handling-time log.
- **Approval:** suggest, then you approve, then the app buys. Turn on auto-purchase with a 48–72 hour cancel window only after about 20 successful orders.
- **Note:** using your own Issuing cards for personal gifts conflicts with Stripe's "no personal use" rule. For pure personal use, a normal virtual-card product or your own card in the Zinc wallet may be the compliant choice. Switch to Issuing once a business exists (verify with Stripe).

**Phase 1: private beta (friends, about 10–50 users)**
- Form an LLC. Create a Stripe account with Payments and Issuing ("cards for your own business: purchases to fulfill a service"). Make the MoR terms of service explicit.
- Charge users per gift through Stripe and buy with single-use Issuing cards. Add real-time auth rules and per-user monthly caps.
- Build cancel windows, consent logs, and dispute evidence packs.
- Negotiate Rye rate limits and pricing. Apply for a Shopify agent profile and a higher trust tier. Sign the Goody business development agreement.

**Phase 2: public launch**
- Get a legal opinion on money transmission (avoid stored balances) and sales tax on service fees. Add Stripe Tax.
- Launch subscription and per-gift pricing. Add a returns workflow (Zinc returns API, retailer policies).
- Add SPT/ACP or UCP checkout where merchants support it, to cut costs and handle payment more natively.
- Optionally ship a local browser extension that identifies itself as an agent for own-account checkout, with human confirmation, never with stored passwords.

---

## 11. Safeguards enabled by the payment approach

- **Per-gift hard cap:** each Issuing card's `per_authorization` limit is set to the approved price plus X%. Zinc's `max_price` fails the order if the price rises.
- **Per-user and per-period caps:** monthly spending limits at the cardholder or card level. App-level budget per recipient and occasion.
- **Merchant lock:** MCC `allowed_categories`, plus a real-time webhook that checks the merchant name against the planned retailer.
- **Single-use cards:** cards are invalidated after one purchase, so there is no reuse if a merchant is breached.
- **Cancel window:** the order exists in the app as "scheduled." The card is not created or activated until the window closes. Real-time auth declines if the user cancelled.
- **Kill switch:** freeze all cards (`status=inactive`) and pause auto-purchase globally.
- **Consent trail:** store what the user approved (budget, item or criteria, recipient, deadline) for dispute evidence.
- **SPT scoping** (where available): limits on amount, expiry and a single seller. Revocable [S17].
- **Never store retailer passwords.** Own-account purchasing happens in the user's own browser session only.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Retailers block agent and API vendors, such as Amazon's moves against Perplexity and Meta | Medium–High | High | Use multiple vendors (Zinc, Rye, Shopify) and keep the gift-card fallback. Avoid account automation. |
| Vendor fragility: young startups, pricing changes, possible Rye rebrand | Medium | High | Abstraction layer over checkout providers. Contracts. |
| Late delivery on time-critical gifts | Medium | High | Checkout ETA plus p90 buffer, earlier purchase dates, upgraded shipping, e-gift fallback. |
| Price or stock change between approval and purchase | High | Medium | `max_price` and caps. Re-confirm when the change exceeds tolerance. |
| Chargebacks and "I didn't authorize" disputes on auto-buys | Medium | Medium | Cancel window, explicit consent, notifications. |
| Money transmitter or sales-tax misclassification | Low–Medium | High | Legal and tax opinion before launch. MoR structure. No stored balances. |
| Stripe Issuing eligibility (no personal or consumer use) | Medium | Medium | Business-funded purchasing cards. Get Stripe approval early. |
| Return and exchange complexity, plus the lack of gift receipts | High | Medium | Prefer merchants with gift receipts, Goody swaps, and clear refund policies. |
| Amazon Associates and Creators API terms (no ML training, no on-behalf orders) | High if ignored | Medium | Don't rely on Amazon affiliate revenue. Keep Amazon data out of model training. |

---

## 13. Open questions

1. Rye: current pricing, raised rate limits, ETA fields, and whether "Jolly" is a rebrand.
2. Shopify: which trust tier allows direct checkout completion, how to qualify, and fees.
3. Stripe: will it approve Issuing for a gifting service as "purchases to fulfill a service"? What is the current per-transaction Issuing fee? Is SPT agent use (preview) open to you?
4. Goody: does its Commerce API allow consumer-facing resale? Per-gift fees and revenue share?
5. The exact text of the Amazon Conditions of Use Agent Terms (Amazon's page returned 503). Is there any approved-agent program?
6. State sales-tax treatment of a gift-purchasing service fee in your launch states.
7. Does Zinc's managed-accounts option allow your own Amazon Business account, and what are the ToS implications?
8. Creators API: does OffersV2 expose delivery-promise data? What is the eligibility threshold?
9. Visa Intelligent Commerce GA status and whether a small app can join.
10. Real-world order success rates and median placement times for Zinc and Rye (run your own trial of about 20 orders).

---

## 14. Sources

- [S1] Amazon Creators API, PA-API v5 deprecation notice: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation
- [S2] PA-API 5 documentation (deprecation dates): https://webservices.amazon.com/paapi5/documentation/ and https://webservices.amazon.ca/paapi5/documentation/api-reference.html
- [S3] PA-API shutdown and auth changes (third party): https://dev.to/th3nate/amazon-pa-api-v5-is-shutting-down-april-30-2026-here-is-what-changes-at-the-auth-layer-22ek
- [S4] OpenAI abandons Instant Checkout: https://forklog.com/en/openai-abandons-instant-checkout-feature-in-chatgpt/
- [S5] Instant Checkout shutdown analysis: https://explodingtopics.com/blog/agentic-commerce-protocol ; https://www.digitalcommerce360.com/2026/02/16/openai-expands-agentic-commerce-push/
- [S7] Rye docs: https://docs.rye.com
- [S8] Rye LLM context (redirects to docs.commerce.jolly.dev): https://docs.rye.com/llm-context.md ; https://docs.rye.com/api-v2/example-flows/simple-checkout
- [S9] Amazon Associates Program Policies (updated 2026-04-14): https://affiliate-program.amazon.com/help/operating/policies
- [S10] Zinc FAQ: https://www.zinc.com/faq ; https://zincapi.com/faq
- [S11] UCP overview: https://forkast.news/glossary/universal-commerce-protocol-ucp/ ; https://ucp.dev
- [S12] UCP and AP2 architecture: https://stellagent.ai/insights/google-ucp-open-rails-agentic-commerce ; https://monei.com/blog/google-ucp-explained/
- [S13] Shopify agents docs: https://shopify.dev/docs/agents
- [S14] Shopify Spring '26 Edition: https://www.shopify.com/news/spring-26-edition-dev ; https://craftshift.com/shop-mcp-personal-ai-agents-shopify/
- [S16] Stripe Sessions 2026 announcements: https://stripe.com/blog/everything-we-announced-at-sessions-2026
- [S17] Stripe Shared Payment Tokens (agent docs): https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent
- [S18] Stripe Issuing for agents: https://docs.stripe.com/issuing/agents.md
- [S19] Stripe Issuing supported use cases: https://support.stripe.com/questions/supported-business-use-cases-for-stripe-issuing
- [S20] Stripe pricing: https://stripe.com/pricing ; Issuing launch post: https://stripe.com/ie/blog/issuing-self-serve
- [S21] Stripe Issuing real-time authorizations: https://docs.stripe.com/issuing/controls/real-time-authorizations
- [S22] Goody Commerce API: https://developer.ongoody.com/commerce-api/overview
- [S23] Goody create order and send methods: https://developer.ongoody.com/commerce-api/create-an-order ; https://developer.ongoody.com/introduction/send-methods
- [S24] Visa Intelligent Commerce Connect: https://www.paymentsjournal.com/visa-unveils-agentic-commerce-platform-for-merchants/ ; https://nevermined.ai/blog/visa-intelligent-commerce-review
- [S25] Mastercard Agent Pay: https://glenbrook.com/payments_news/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai/ ; https://eco.com/support/en/articles/14845483-mastercard-agent-pay-explained
- [S26] Amazon Buy for Me: https://www.searchable.com/blog/amazon-buy-for-me-agentic-commerce ; https://stellagent.ai/insights/amazon-shop-direct-expansion
- [S27] PayPal and Perplexity Instant Buy: https://www.eweek.com/news/paypal-perplexity-instant-buy-shopping/ ; https://www.secnews.gr/en/725171/paypal-perplexity-instant-buy-agentic-commerce-2026/
- [S28] Henry Labs SDK (community skill): https://www.skills.sh/henry-social/skills/integrate
- [S29] Violet checkout docs: https://docs.violet.io/checkout/overview ; Firmly: https://www.pymnts.com/artificial-intelligence-2/2025/firmly-launches-platform-that-eases-merchant-adoption-of-agentic-commerce/
- [S30] Browserbase pricing (third party): https://www.tinyfish.ai/blog/browserbase-pricing ; https://www.capterra.com/p/10050160/Browserbase/pricing/
- [S31] Walmart affiliate FAQ: https://affiliates.walmart.com/faqs ; https://www.argil.ai/blog/walmart-affiliate-program-cd8f1
- [S32] Target Partners: https://creatorflow.so/blog/target-creator-program/ ; https://entreresource.com/target-affiliate-program/
- [S33] eBay Order API: https://developer.ebay.com/api-docs/buy/order/overview.html ; https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application
- [S34] Etsy API and affiliate: https://developer.etsy.com/documentation/tutorials/listings ; https://AuthorityHacker.com/etsy-affiliate-program/
- [S35] Best Buy API (third-party profiles): https://github.com/api-evangelist/best-buy ; https://public-api.org/api/1122/best-buy
- [S36] Google Merchant API migration: https://searchengineland.com/google-content-api-shopping-new-merchant-api-460937
- [S37] SerpApi pricing: https://serpapi.com/pricing
- [S38] Channel3: https://trychannel3.com/blog/best-product-data-apis-ai-agents-2026 ; https://mcp.so/server/channel3-product-search/channel3-ai
- [S39] Target and Walmart in Gemini (UCP): https://ppc.land/target-and-walmart-bring-checkout-directly-into-googles-ai-assistant/
- [S40] Amazon Conditions of Use agent provisions (tracker): https://conductatlas.com/platform/amazon/amazon-conditions-of-use/agent-transparency-and-technical-requirements/
- [S41] Amazon blocks Meta Muse: https://searchenginejournal.com/amazon-blocked-metas-muse-and-robots-txt-had-nothing-to-say/590494
- [S42] Amazon v. Perplexity, 9th Cir. No. 26-1444 (2026-08-04): https://law.justia.com/cases/federal/appellate-courts/ca9/26-1444/26-1444-2026-08-04.html
- [S43] Commentary: https://www.troutmanprivacy.com/2026/08/ninth-circuit-holds-human-user-not-developer-of-ai-agent-responsible-for-websites-accessed/ ; https://www.pearlcohen.com/ninth-circuit-vacates-injunction-against-perplexitys-ai-shopping-agent/ ; https://www.pymnts.com/news/artificial-intelligence/2026/ninth-circuit-narrows-cfaa-reach-in-perplexity-agentic-commerce-ruling/
- [S44] Goody plans (third party): https://us.fitgap.com/products/038827/goody ; https://hellotars.com/tools/goody
- [S45] Snappy FAQ and docs: https://help.snappy.com/en/articles/14091891-snappy-overview-101-faqs ; https://www.snappy.com/business/faq ; https://docs.snappy.com/swag
- [S46] Sendoso API: https://developer.sendoso.com/rest-api/overview/security
- [S47] Tango Card for developers: https://www.tangocard.com/use-cases/software-developers
- [S48] Giftbit pricing: https://intercom.help/giftbit/en/articles/5777183-how-giftbit-pricing-works
- [S49] Agent-of-the-payee exemption: https://moderntreasury.com/learn/what-is-an-agent-of-the-payee-exemption
- [S50] Drop-ship sales tax: https://stripe.com/resources/more/dropshipping-taxes ; https://beancount.io/blog/2026/05/11/drop-shipping-sales-tax-2026-three-party-transaction-resale-certificate-rules-marketplace-facilitator-ecommerce-operators-guide
- [S51] UCP fulfillment extension: https://ucpchecker.com/capabilities ; https://docsearch.algolia.com/mcp/docs/repo/universal-commerce-protocol/ucp ; https://shopify.engineering/ucp
- [S52] USPS Service Standards API: https://developer.usps.com/standardsv3
- [S53] UPS Developer Resource Center: https://www.ups.com/be/en/business-solutions/expand-your-online-business/upgrade-digital-technology/developer-resource-center
- [S54] EasyPost SmartRate: https://docs.easypost.com/guides/smartrate-guide ; https://support.easypost.com/hc/en-us/articles/15433074900365-SmartRate-API-FAQs
- [S55] AfterShip predictive EDD: https://www.aftership.com/docs/tracking/1o2zu0jrca785-prediction-for-the-estimated-delivery-date
- [S56] EasyPost, Shippo and AfterShip comparisons: https://www.aftership.com/blog/shippo-vs-easypost-api-developer-verdict ; https://toolradar.com/compare/aftership-vs-easypost
- [S57] 17TRACK pricing (third party): https://www.track123.com/blog/track123-vs-17track ; https://us.fitgap.com/products/17track
- [S58] Amazon commission rates (third party): https://getlasso.co/amazon-affiliate-commission-rate/ ; https://affiliatexblocks.com/amazon-affiliate-commission-rates/
- [S59] Consumer gift apps: https://aisotools.com/pricing/intelli-gift ; https://apps.apple.com/app/id6749213560
- Stripe Link agent wallet: https://link.com/agents
