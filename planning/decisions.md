# Product Decisions Log

Running record of product decisions made during discovery. Each entry notes whether it came from the product owner or was a proposal still awaiting confirmation.

## 2026-10-17

| # | Decision | Source |
|---|---|---|
| 1 | The core problem is both *knowing what to get* and *finding time to order*. The product should automate as much of both as possible. | Owner |
| 2 | Core loop: early heads-up → curated ideas (priced, arrive-in-time verified) → user picks **one or more** → app buys and ships. If the user rejects ideas, they give a reason and the app searches again. | Owner |
| 3 | Gifts must arrive on time. Shipping lead time is part of choosing a gift. | Owner |
| 4 | Budgets are set per person and per occasion. | Owner |
| 5 | Purchasing is hybrid: use the user's own retailer accounts where they have them, otherwise buy directly from the store. | Owner |
| 6 | Audience: personal use first (owner plus a friend or two), then a public product with monetization to be decided (subscription, per-transaction, etc.). | Owner |
| 7 | Recipient profiles are built from user-guided collection (a browser extension where the user deliberately clips content, guided questions, notes), not automatic scraping or social media APIs. Research showed automatic profile reading isn't viable (see `research/profile-data-feasibility.md`). | Owner, after research |
| 8 | Purchasing through the user's own accounts stays as an *option* (likely assisted checkout where the user clicks Buy), pending technical design. The main value is maximum automation, which is most achievable when the app buys directly (see `research/purchasing-feasibility.md`). | Owner, after research |
| 9 | **Anti-goal:** overspending or ignoring the budget. This is the top failure to avoid (along with late delivery). The single-use virtual card capped at the approved amount (see purchasing research) is a strong candidate for enforcing it. | Owner |
| 10 | The budget covers the **full landed cost**: item, shipping, taxes, delivery fees, and any gift wrap or service fees. | Owner |
| 11 | The budget is a **hard limit for automatic purchases**. When suggesting ideas, the app may include a clearly labeled "a bit over budget" option that's *close* to the budget, which the user must explicitly approve. *Proposal (Claude's call, not yet confirmed): "close" defaults to at most 15% over, adjustable by the user.* | Owner (threshold: Claude's call) |
| 12 | Reactions and quick notes are captured mainly from the **phone** (mobile app or mobile-ready web app), with the web app, email, and other channels also supported. Exact channels to be decided. | Owner |
| 13 | **The app prompts for reactions.** A day or two after the occasion it asks "How did they like it?" with a one-tap rating (loved / liked / meh / returned) plus an optional voice or text note. | Owner |
| 14 | **No native mobile app for the MVP.** Nudges arrive by message and link to a mobile-friendly web page. A native app can come later. | Owner |
| 15 | **MVP channels:** email for nudges, approvals and quick capture (incoming email/forwarding to a dedicated address files notes under a person), plus optional push notifications from the home-screen web page for time-sensitive approvals. **Text messages wait for the public launch** because of US carrier registration requirements. | Owner, on Claude's recommendation |
| 16 | **MVP is single-user.** No household or partner sharing of people, profiles, or budgets. Sharing may come later if the product succeeds. | Owner |
| 17 | **Primary target market:** young men (and possibly women) who struggle to remember occasions and want a "set it and forget it" experience. Low effort for the user is the core promise. | Owner |
| 18 | Users will accept a light setup step: visiting a person's social profiles and **clicking one button in the browser extension** to capture content for the app. Setup must make this easy. | Owner |
| 19 | **Contact import:** the MVP imports from **Google Contacts only** (official, includes birthdays), and people can always be added by hand. Contacts-file upload (iPhone export) and **extension capture of contact and friend lists the user is viewing** wait for the public launch (Facebook birthdays page, Instagram following list, LinkedIn connections). After import, a "Who do you buy gifts for?" checklist creates people with any known names, birthdays and addresses. **Guardrail (confirmed):** the extension captures only what's on screen when the user clicks. No automatic scrolling or crawling through lists. | Owner + Claude (scope trimmed for MVP on Claude's challenge) |
| 20 | **Gifts ship straight to the recipient by default.** Gift notes, wrapping, and shipping to the user for hand-delivery are later options. | Owner |
| 21 | **Working principle:** keep the MVP simple. Claude should challenge any direction that's harder than necessary. | Owner |
| 22 | **Recipient addresses (MVP):** the user enters the address when adding a person, and the app asks before the first gift if it's missing. Having the recipient enter their own address through a link (Goody-style) is a later option. | Owner, on Claude's recommendation |
| 23 | **No reply in the MVP means nothing is bought.** If the user doesn't respond, reminders escalate and then stop, ending with a final notice: "If you don't reply, this gift won't be sent." Every MVP purchase needs the user's approval. *Proposed schedule (Claude's call): first heads-up about 3–4 weeks before the ship-by date, a reminder after about 5 days, a push and email about 1 week out, and a final notice 48 hours before the ship-by deadline. The occasion is then marked "skipped" in history.* | Owner (schedule: Claude's call) |
| 24 | **Later (post-MVP):** an opt-in "don't let the date pass" setting for users willing to take the risk. If there's no reply by the deadline, the app buys automatically (e.g. the top pick, within budget). A same-day digital gift card is a possible fallback when a deadline is missed. | Owner (gift card fallback: Claude's idea) |
| 25 | **MVP success criteria:** after the first holiday season, every chosen recipient got their gift **on time and within budget**. Recipient happiness matters too, but is expected to improve over time and isn't a pass/fail bar for the MVP. | Owner |
| 26 | **No target date for the MVP.** It's done when it's done. | Owner |
| 27 | **MVP payment:** each user pays with their own card through the checkout service, with a price limit on every order. The app doesn't front money. A business entity (for capped single-use virtual cards) waits for the public launch. | Owner, on Claude's recommendation |
| 28 | **After approval:** if checkout comes in at a different price but the full cost is still within budget, buy it and notify the user. Over budget means stop and ask. | Owner, on Claude's recommendation |
| 29 | **Failed or late orders:** ask the user to approve a replacement (next-best idea ready in one tap). Never buy a replacement automatically. The replacement must fit the original budget, and a refunded order doesn't count against it. | Owner, on Claude's recommendation |
| 30 | **Rounds skipped for no reply don't count as MVP failures.** The success measure covers approved gifts only, and skipped rounds are tracked separately. | Owner, on Claude's recommendation |

## 2026-10-25

Platform direction from the owner and Jim. Details in [`strategy.md`](strategy.md). These set direction and don't change MVP scope.

| # | Decision | Source |
|---|---|---|
| 31 | **Gift Concierge is one of three products on one platform:** scan-to-gift, gift lists (Jim's app, already in progress) and Gift Concierge. Each works on its own and connects to the others. The concierge stays an isolated service. | Owner and Jim |
| 32 | **Scan-to-gift is the front door for go-to-market. Its primary use case is "buy me a drink"** for college students: clothing with a QR code that lets a stranger buy the wearer **any drink**, anonymously through our payment links, with the sender able to choose to be found (a profile or a selfie). Party gear for bachelor and bachelorette parties is a second audience. Other scan-to-gift ideas (QR cards, pay-it-forward plushie and cookie) are in `ideas.md`. | Owner |
| 33 | **Gift Concierge is the final stage of the funnel.** Loyal customers fill in their loved ones' profiles, including a guided tour of each person's social media to show the concierge their vibe, and the concierge automates their recurring gift giving. | Owner |
| 34 | **Money model direction (not decided):** free gift lists, premium automation (the concierge), and a per-gift fee on scan-to-gift and custom gifts. Zinc's $1 per order can be passed to the buyer. Billing stays out of MVP scope (revisits D6). | Owner and Jim |
| 35 | **Where the roadmap lives:** Linear projects hold live status (Gift Concierge MVP, Gift Concierge Public Launch, Scan-to-gift, plus Jim's list projects). `strategy.md` is the written source, and two shareable pages present it (roadmap and go-to-market plan). | Owner, on Claude's recommendation |

## 2026-10-26

From the owner's review of the ALL-41 mock-ups (`../design/ui.md`).

| # | Decision | Source |
|---|---|---|
| 36 | **The budget is the buyer's own, and optional** (revises decision 4 and PRD B-1). It's set per person and occasion in the buyer's view, is never shown as the recipient's limit, and only you see it. With no budget there are no over-budget labels or confirm step. **[Verify]** Follow-ups: `concierge.gift_rounds.budget_cents` is `not null` today (ALL-19), and design §4.2 assumes a budget; B-3 ("automatic purchases never go over budget") then applies only when one is set. | Owner |
| 37 | **A person's own list is the best source of gifts.** When the recipient keeps a gift list (Mom), the concierge offers picks from it, and that's the ideal case the app steers toward. When they don't (Dad), it suggests ideas from what you've saved. Home and the person page show which applies. Builds on T19 (`people.linked_user_id`) and the PRD's "gift list connection" (Later). | Owner |
| 38 | **A gift ships to the recipient, to you, or to another address** (revises PRD A-3, which shipped only to the recipient). If the recipient keeps a list, they can share their address through it and the buyer sees only the city. Otherwise the buyer enters it once and can save it to that person. **[Verify]** Follow-up: the buyer's own address isn't stored yet (`public.profiles` has no address). | Owner |
| 39 | **A list's owner never sees whether gifts are claimed**, so gifts stay a surprise. Friends still see claims so nobody doubles up. | Owner |
| 40 | **The heads-up email says whether anything will be bought.** A reminder says nothing is bought until you choose. With auto-buy on (opt-in, PRD A-7, still Later), the email names the gift that will be bought, the date, and how to change or skip it. | Owner |
