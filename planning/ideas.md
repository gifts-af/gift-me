# Longer-term product ideas

Ideas for after the MVP. **Nothing here is in MVP scope.** The PRD's roadmap ("Public launch" and "Later") stays the source of truth for what's planned, and an idea only moves there by a decision in `decisions.md`.

Each idea notes where it came from and how it relates to what's already decided.

## The bigger picture

These ideas sit inside a wider platform plan: scan-to-gift brings people in, gift lists keep them, and Gift Concierge earns. The platform, roadmap and go-to-market plan are in [`strategy.md`](strategy.md) (decisions D31–D35).

Source: owner and Jim, Discord, 2026-10-24, and follow-ups on 2026-10-25.

## Ideas

### 1. Real cards with a QR code inside
A physical greeting card with a QR code that takes the recipient straight to a gift card, or even to pick a specific gift.
- **Why:** gift cards mailed in envelopes get stolen. A QR code tied to a secure, signed-in claim means a stolen card is worthless to the thief.
- **Related:** D24 already lists a digital gift card as a later fallback for missed deadlines. Research covers digital gift card APIs (Tango Card, Giftbit in `research/purchasing-feasibility.md`) and recipient-chosen gifts (Goody-style links). Printing and mailing cards would need a card-printing service **[Verify]**.
- **Source:** the owner's mom.

### 2. "Buy me a drink" QR code on clothing and party gear (primary use case)
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

### 5. Pay-it-forward collectible plushie
A cheap, lovable, collectible plushie sent with a code. The recipient scans and pays a plushie forward to someone else.
- **Why:** taps the Jellycat-style collecting craze. College students love them, and young parents (moms especially) would send them to each other and their kids. Collecting gives a reason to come back: new characters, seasons, limited runs.
- **Related:** the same pay-it-forward mechanic as the cookie (idea 4), with a bigger, longer-lasting gift.
- **To work out:** our own characters (not lookalikes of an existing brand), unit cost and shipping cheap enough to send, a manufacturer, and safety rules for toys given to children **[Verify]**.
- **Source:** owner.

### 6. Invite a non-user through an action
A GiftsAF user does something that emails a friend who has no account. For example, Jim asks his friend Edgar for his address or what he'd like. Edgar answers from the email, then lands on a short "get your own GiftsAF going" teaser.
- **Why:** it's how GiftsAF spreads. Every gift a user sends can bring in someone new.
- **Related:** builds on ALL-23's signed action links, which today only work for an account's owner. Ticket: ALL-49.
- **To work out:** which actions can go to a non-user, whether they sign up as part of the tap, and what the sender learns.
- **Source:** owner, 2026-11-01, while specifying ALL-23.

### 7. Concierge for your own list (premium)
The concierge works for you as a receiver, not only as a giver. It curates suggestions for **your own** gift list from what it learns about you, and you add the ones you like so others can buy them for you.
- **Why:** a good list is the best source of gifts (D37), but keeping one up to date is work. This keeps your list fresh without you having to think of things. It's the "automated receiving" half of premium in strategy §6.
- **Related:** the same idea engine as ALL-27, pointed at yourself instead of someone you buy for. You stay in control: suggestions only reach your list when you add them. Pricing: ALL-76.
- **Keep AI costs contained (owner, 2026-11-03):** every run costs AI and product-lookup spend. Options: run it **only on demand** ("Suggest ideas for my list"), or gate it with limits such as a number of runs per month, a minimum time between runs, or a few scheduled runs before your birthday and the holidays. Limits are settings, not code (T23), so they can differ by plan. Or charge for it: let people schedule runs freely and charge **per run**, covering our cost plus a margin (pricing: ALL-76).
- **To work out:** what it learns from (your captures, what you've added, gifts you kept or returned), which of the cost options above, and whether suggestions can be timed to your birthday or the holidays.
- **Source:** owner, 2026-11-03.

### 8. Secret Santa groups
A family, friend group or office runs a Secret Santa on GiftsAF. The organiser invites people and sets a budget and date, and GiftsAF draws names. Each person sees only who they're buying for, sees that person's list (or AI ideas if they have none), and buys and ships in one tap.
- **Why:** one organiser brings a whole group onto the platform, and it uses what we already have: lists, gift ideas, budgets, addresses and one-tap buying.
- **To work out:** who can't draw whom (couples, last year's match), keeping the draw secret even from the organiser, shipping without showing the buyer the address, anonymous questions ("what size?"), and people who aren't users yet.
- **Ticket:** ALL-82. **Source:** owner, 2026-11-02.

### 9. White Elephant gift help
Someone is going to a White Elephant (or Yankee Swap) party. There's no recipient, just a strict price limit, a date and maybe a theme or crowd ("office", "funny"). GiftsAF suggests gifts people will fight over, in budget and arriving before the party, and buys them in one tap.
- **Why it's different:** the idea engine (ALL-27) works from the occasion and crowd instead of a person's facts, the price limit is a rule of the game, and the gift ships to the buyer.
- **Maybe later:** organiser tools (invite guests, share the limit and date, reminders).
- **Ticket:** ALL-83. **Source:** owner, 2026-11-02.

### 10. Affiliate links as income
Earn a commission when people buy through GiftsAF, through Amazon Associates and other retailer programs: on list items bought by clicking through to the store, on gift ideas, and on products added from the extension.
- **Rules we already have:** gifts are never ranked or picked by commission (PRD G-5), and partners get no names or emails (T42).
- **To work out:** whether it works with Zinc-placed orders or only click-throughs, each program's terms (disclosures, bans on links in email or extensions), and whether rewriting links people paste onto their own list is allowed and honest.
- **Related:** competitors mostly earn this way (strategy §1). Pricing: ALL-76. **Ticket:** ALL-84. **Source:** owner, 2026-11-02.

## A common thread

Ideas 1, 2, 4 and 5 all use the same building block: **a scannable code tied to a gift that someone claims securely.** If any of these move forward, that's the piece to design once and reuse.
