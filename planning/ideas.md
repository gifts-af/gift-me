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

### 2. Clothing with a "buy me a drink" QR code
A T-shirt (or a sash or tiara for bachelorette parties) with a QR code anyone can scan to buy the wearer a drink.
- **Why:** built-in marketing. Give shirts away to friends, people scan and join, then start gifting the shirts themselves. A playful front door to the rest of the platform.
- **Variations:** a bartender puts a QR code above the bar so people can order drinks for someone without flagging him down (Jim).
- **Hard parts:** strangers sending money to each other, and bars redeeming a drink. Either it needs bar partners, or it's really a money transfer, which brings payment and money-transmission rules and safety concerns (harassment, unwanted contact). **[Verify]** before going further.
- **Source:** owner, with additions from Jim.

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
