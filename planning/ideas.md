# Longer-term product ideas

Ideas for after the MVP. **Nothing here is in MVP scope.** The PRD's roadmap ("Public launch" and "Later") stays the source of truth for what's planned, and an idea only moves there by a decision in `decisions.md`.

Each idea notes where it came from and how it relates to what's already decided.

## The bigger picture: a gifting platform

Three products that share one platform, each usable on its own or together:

| Product | For | What it does |
|---|---|---|
| **Gift Concierge** (what we're building) | The giver | Never forget a loved one: remembers dates, learns what people like, picks and buys gifts. |
| **Gift lists** ("gift-me") | The receiver | Keep a list of what you'd like, so others know what to get you. Jim's idea. |
| **Custom digital gifts** | Both | Gifts delivered in creative, secure ways (cards, clothing, food; see below). |

- **Shape:** Gift Concierge stays an isolated service that works alongside the list site or on its own (Jim). This fits the current design: it's a separate app with its own API.
- **Possible money model:** lists are free (freemium), automation of giving and receiving is premium, and custom digital gifts earn a one-off profit on each sale.
- **Related decisions:** D6 (monetization to be decided), PRD "Billing" out of scope for the MVP. Zinc's $1 per order could be passed on to the buyer as part of a per-gift fee.
- **Note:** the competitive research (`research/competitive-analysis.md`) shows wishlist apps are a crowded space (GoWish, Elfster, Giftster), mostly earning from affiliate links. A list on its own isn't the edge; tying it into the concierge could be. A list someone shares is also the best possible input for the concierge's gift ideas.

Source: owner and Jim, Discord, 2026-10-24.

## Ideas

### 1. Real cards with a QR code inside
A physical greeting card with a QR code that takes the recipient straight to a gift card, or even to pick a specific gift.
- **Why:** gift cards mailed in envelopes get stolen. A QR code tied to a secure, signed-in claim means a stolen card is worthless to the thief.
- **Related:** D24 already lists a digital gift card as a later fallback for missed deadlines. Research covers digital gift card APIs (Tango Card, Giftbit in `research/purchasing-feasibility.md`) and recipient-chosen gifts (Goody-style links). Printing and mailing cards would need a card-printing service **[Verify]**.
- **Source:** the owner's mom.

### 2. "Buy me a drink" QR code on clothing and party gear
A QR code on something the person wears. Anyone can scan it and buy the wearer a drink.
- **Main audience: college students.** Cool shirts and clothing that students buy for the chance of a stranger buying them a drink, and an easy way to connect without walking up to someone first.
- **Also party gear:** sashes, tiaras and the like for bachelorette and bachelor parties. Who doesn't want to buy the bride or groom a drink?
- **Anonymous by design:** everything goes through our platform with payment links, so neither side sees the other's personal details. The sender can choose to be found, either through a profile or by taking a selfie when they send, so the wearer can spot them.
- **Why it matters:** this is a **user acquisition engine**. If scanning and paying is close to friction-free, every scan brings in a new user. Give gear away to friends, people scan and join, then start buying the gear for others. Free marketing that keeps spreading, and a playful front door to the rest of the platform.
- **Variations:** a bartender puts a QR code above the bar so people can order drinks for someone without flagging him down (Jim).
- **To work out when brainstormed:**
  - How the drink is redeemed: a cash payout to the wearer, or bar partners who honor the code
  - Moving money between strangers: a payments provider that handles payouts would carry most of the payment rules **[Verify]**
  - Safety: the wearer controls whether to meet the sender, and can block or report
  - The scan-to-pay flow: as few steps as possible, ideally no sign-up before paying
  - Drinking age: the gift is **any drink**, not just alcohol (owner). Different versions (for example coffee, or 21+ only) can be planned later.
- **Source:** owner, with additions from Jim. The owner thinks it's very doable and wants to brainstorm it further.

### 3. Thank-you card reminders
For people using a gift list: once a gift arrives, remind them to send a thank-you, maybe with a ready-to-send card.
- **Related:** reuses the round engine's reminders and the reaction prompt (D-2). Small once gift lists exist.
- **Source:** owner.

### 4. Pay-it-forward cookie
A gift cookie with a barcode. The recipient scans it and pays a cookie forward to someone else.
- **Why:** a chain of small gifts that spreads the platform.
- **Related:** same "scan to gift" mechanics as ideas 1 and 2.
- **Source:** owner.

## A common thread

Ideas 1, 2 and 4 all use the same building block: **a scannable code tied to a gift that someone claims securely.** If any of these move forward, that's the piece to design once and reuse.
