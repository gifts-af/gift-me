# Gift Concierge: Product Requirements Document (MVP)

| | |
|---|---|
| **Status** | **Approved** v1.0 (2026-10-17). v1.1 (2026-10-25): §11 links to the platform strategy and adds gift list connection to Later. |
| **Date** | 2026-10-17 |
| **Owner** | Product owner (Aaron) |
| **Working name** | Gift Concierge (placeholder) |
| **Inputs** | `decisions.md` (decision log, referenced as D#), `research/competitive-analysis.md`, `research/profile-data-feasibility.md`, `research/purchasing-feasibility.md` |
| **Next stage** | Technical design (platform and service selection). This PRD says *what* and *why*. Technical design decides *how*. |

Items marked **[Claude's call]** are proposals the owner hasn't explicitly confirmed yet. Everything else came from the owner.

---

## 1. Summary

Gift Concierge remembers the people you buy gifts for and the dates that matter. Before each occasion, early enough for gifts to arrive on time, it suggests a few gift ideas that fit the person and the budget. You pick one or more and it buys them and ships them straight to the recipient. If none fit, you say why and it tries again. It learns from every choice, rejection, and reaction, with the goal of getting good enough that approving a gift takes one tap. A later version will let users who want it buy gifts without approval.

## 2. Problem and why

- **Remembering is hard and so is choosing.** The owner's own example: family Christmas gifts were bought at the last minute, and some ordered too late arrived after Christmas. Both parts were painful: knowing *what* to get and finding *time* to order (D1).
- **Late is the same as failure.** A gift that misses the date is a broken promise, so shipping time has to factor into which gift gets picked (D3).
- **Market gap (from research):** consumer apps suggest gifts and send you a link to buy, and the closest competitor (Presnt) never buys. Corporate gifting platforms automate sending but mostly let the recipient pick. No consumer product tracks the people, knows their preferences, buys on time, and learns. Big AI shopping assistants (Amazon Alexa for Shopping, Google Gemini) are the main threat, but none of them currently manages a calendar of occasions for specific recipients.

## 3. Target users

- **Primary market (public launch):** young adults, mostly men and possibly women, who are bad at remembering occasions and want "set it and forget it." Low effort is the core promise (D17).
- **MVP users:** the owner plus one or two friends, i.e. personal use (D6).
- **Recipients** (the people who receive gifts) **do not use the app in the MVP.** They haven't agreed to be profiled, which shapes the data rules in §9.

## 4. Goals, non-goals, anti-goals

**Goals (MVP)**
1. Every approved gift arrives **on time**. Because reminders escalate before the deadline, no turned-on occasion slips past unnoticed.
2. Every purchase stays **within budget**, counting the full cost (D10).
3. Getting set up takes about **2 minutes per person**.
4. Gift ideas get better over time, based on what the user picks, why they reject ideas, and how gifts are received.

**Non-goals (MVP)**
- Native mobile apps (D14)
- Household or partner sharing (D16)
- Recipients entering their own profile or address (D22)
- Gift notes, wrapping, shipping to the user for hand-delivery (D20)
- Text-message notifications (D15)
- Buying with no reply (D23, D24)
- Billing or monetization
- Contact import beyond Google Contacts (D19)
- Reading social media through APIs or automated scraping (D7)

**Anti-goals: failures even if everything else works**
- **Overspending, or ignoring the budget** (D9)
- **Late delivery** (D3)
- Buying anything the user didn't approve (MVP)
- Collecting data by crawling, scrolling automatically, or harvesting in the background (D19 guardrail)
- Storing the user's retailer passwords (research)

## 5. Core concepts

| Concept | Definition |
|---|---|
| **Person** | Someone the user buys gifts for: name, relationship, birthday, mailing address, profile. |
| **Profile** | What the app knows about a person: interests, likes and dislikes, brands, sizes, things they already own, "already has too many of," and gift history. Built from captures, guided answers, notes, and reactions. |
| **Occasion** | A date tied to a person (birthday, anniversary) or a shared holiday (Christmas, Mother's Day, Valentine's Day). It can be turned on or off per person. |
| **Budget** | The maximum full cost for one person for one occasion. |
| **Gift round** | One person and one occasion, from the first heads-up through ideas, approval, purchase, delivery, and the reaction. |
| **Ship-by deadline** | The last moment an order can be placed and still arrive before the occasion, based on the delivery estimate. |
| **Capture** | Content the user saves with one click in the browser extension, from a social profile or any web page. |

## 6. Main user journeys

### 6.1 Setup
1. Sign up, then optionally import Google Contacts (D19).
2. From the import, pick who you buy gifts for using a checklist, or add people by hand: name, relationship, birthday, address.
3. Occasions are **added automatically by relationship**, for example Mother's Day for Mom and Valentine's Day for a partner, plus Christmas for everyone. Each one can be turned off. **[Claude's call]**
4. Set **default budgets by relationship type**, like parents $100 and friends $40. Smaller holidays are scaled down automatically. Any person or occasion can be overridden. **[Claude's call on the structure.]** Per person and per occasion budgets are D4.
5. Install the extension, visit the person's profiles, and click **"Capture for {Person}."** The app shows **"Here's what I learned,"** and the user confirms or removes each item (D18).
6. If important information is missing, the app asks 3–5 **guided questions**, like sizes or "anything they already have too much of?"
7. Each person shows a **readiness meter** and a suggested next step. **[Claude's call]**

### 6.2 A gift round (the core loop) (D2)
1. **Heads-up:** about 3–4 weeks before the ship-by deadline, the user gets an email (and a push notification if enabled) with **3–5 ideas**. Each idea shows the full cost, an arrive-by date that has been checked, and a one-line reason ("she captured three gardening posts"). **[Claude's call on the count and timing]**
2. Optionally, **one "a bit over budget" idea** that's clearly labeled and at most 15% over (adjustable). The user has to approve it on purpose (D11).
3. **The user picks one or more ideas.** The total of the selected ideas must fit the budget unless the over-budget idea is chosen deliberately. **[Claude's call: the budget covers everything bought for that round]**
4. **Or the user rejects the ideas with a reason.** They can choose from quick reasons (already has it, too practical, not their style, too expensive) or write their own. The app saves the reason to the profile and sends new ideas.
5. **Purchase:** the app places the order, shipped straight to the recipient (D20). Price and shipping are confirmed at checkout before paying. If the full cost would go over the approved amount, the purchase stops and the user is asked.
6. **Tracking:** the app watches delivery and alerts the user if a gift is at risk of arriving late.
7. **Reaction:** a day or two after the occasion, the app asks **"How did {Person} like it?"** with one-tap answers (loved it / liked it / meh / returned it) and an optional voice or text note (D13).

### 6.3 No reply (D23)
Reminders escalate, then stop. **[Claude's call on the schedule]:**

| When | Message |
|---|---|
| About 5 days after the heads-up | Reminder |
| About 1 week before the deadline | Email plus push notification |
| 48 hours before the deadline | Final notice: "If you don't reply, this gift won't be sent" |

After that, the round is marked **skipped** and nothing is bought.

### 6.4 Quick capture
- **Extension:** clip any page (product, wishlist, article) to a person.
- **Email:** send or forward to a dedicated address, e.g. "Dad wants a new fly rod." The app works out which person it's about and files it, and asks if it's unsure (D15).
- **Phone:** the mobile-friendly web page, which can be added to the home screen (D14).

## 7. Functional requirements

Priority: **M** = must have for the MVP, **S** = should have, **L** = later.

### 7.1 People and occasions
| ID | Requirement | Pri |
|---|---|---|
| P-1 | Add, edit, and remove people: name, relationship, birthday, address, notes. | M |
| P-2 | Import from Google Contacts with a "Who do you buy gifts for?" checklist. | M |
| P-3 | Built-in holiday calendar plus personal dates. Each occasion can be turned on or off per person. | M |
| P-4 | Occasions suggested automatically based on relationship. | S |
| P-5 | If an address is missing, ask before the first gift round for that person (D22). | M |
| P-6 | Contacts-file upload, and extension capture of friend and contact lists. | L |

### 7.2 Budgets
| ID | Requirement | Pri |
|---|---|---|
| B-1 | A budget for each person and occasion. It covers the **full cost**: item, shipping, tax, fees. **Revised 2026-10-26 (decision 36):** the budget is the buyer's own and optional. | M |
| B-2 | Default budgets by relationship type, scaled by occasion, and adjustable. | S |
| B-3 | **Automatic purchases can never go over budget.** It's checked again at checkout using the final price. | M |
| B-4 | Optional over-budget idea, at most 15% over by default (adjustable), and only with explicit approval. | M |
| B-5 | The budget limit is enforced **at the payment step too**, e.g. each purchase is paid with a card capped at the approved amount. That way a software bug can't cause overspending. | M |
| B-6 | Season or yearly spending cap across everyone. | L |

### 7.3 Profiles and capture
| ID | Requirement | Pri |
|---|---|---|
| C-1 | Browser extension for Chrome: one click captures the visible page and saves it to a chosen person. | M |
| C-2 | Captures **only what's on screen when the user clicks**. No automatic scrolling, crawling, or background collection. | M |
| C-3 | AI pulls likely preferences from captured text and images and shows "Here's what I learned" for the user to confirm. | M |
| C-4 | Guided questions that target gaps in a profile, answerable in the web app or by email. | M |
| C-5 | Notes by email, filed to the right person. | M |
| C-6 | Readiness meter per person, with a suggested next step. | S |
| C-7 | The user can view, edit, and delete anything in a profile. Deleting a person deletes all of their data. | M |
| C-8 | The app doesn't infer or store sensitive traits (health, religion, sexuality, politics). | M |
| C-9 | Extensions for other browsers (Firefox, Safari). | L |

### 7.4 Gift ideas
| ID | Requirement | Pri |
|---|---|---|
| G-1 | Generate 3–5 ideas per round from the profile, gift history, and budget. Each idea can actually be bought and has an arrive-by date that's been checked. | M |
| G-2 | Every idea shows the full cost, the arrive-by date, the store, and a short reason it fits. | M |
| G-3 | Rejecting ideas captures a reason, saves it to the profile, and starts a new search. | M |
| G-4 | Never suggest something already given to this person, or something they've rejected before. | M |
| G-5 | Ideas are never ranked by affiliate commission. | M |

### 7.5 Approval and purchasing
| ID | Requirement | Pri |
|---|---|---|
| A-1 | Every MVP purchase needs the user's approval (one tap from email, push, or web). | M |
| A-2 | Reminders escalate according to the no-reply schedule, then the round is marked skipped. | M |
| A-3 | Buy from supported stores and ship straight to the recipient. **Revised 2026-10-26 (decision 38):** or to the buyer, or to another address. | M |
| A-4 | Confirm the price, shipping, tax, and delivery estimate at checkout before paying. Stop and ask if anything changed beyond the approved amount. | M |
| A-5 | Never store the user's retailer passwords. | M |
| A-6 | Optional purchase through the user's own retailer account, using assisted checkout where the user clicks Buy (D8). | S |
| A-7 | Opt-in "don't let the date pass" auto-purchase mode, and a gift card fallback for missed deadlines (D24). | L |
| A-8 | **After approval:** if the checkout price differs from the idea's price but the full cost is still within budget, buy it and tell the user. If it would go over budget, stop and ask (B-3, A-4). | M |
| A-9 | **Each MVP user pays with their own card** through the checkout service, with a price limit set on every order (satisfies B-5 for the MVP). The app never fronts money for users. | M |

### 7.6 Delivery and reactions
| ID | Requirement | Pri |
|---|---|---|
| D-1 | Track every order and alert the user if delivery is at risk or the order fails. | M |
| D-4 | **If an order fails or will arrive late,** ask the user to approve a replacement, with the next-best idea ready to approve in one tap. Never buy a replacement without approval. The replacement must fit the original budget, and the failed order's cost doesn't count once it's refunded. | M |
| D-2 | Ask for a reaction 1–2 days after the occasion (one tap plus an optional note). | M |
| D-3 | Gift history for each person: what was bought, cost, date, delivery result, reaction, notes. | M |

### 7.7 Notifications and channels
| ID | Requirement | Pri |
|---|---|---|
| N-1 | Email for heads-ups, approvals, reminders, reactions, and alerts, with one-tap links to the phone page. | M |
| N-2 | Incoming email address for quick capture. | M |
| N-3 | Push notifications from the home-screen web page for time-sensitive messages. | S |
| N-4 | Text messages. | L |
| N-5 | Native mobile apps. | L |

## 8. Constraints from research

- **Social media APIs can't read other people's profiles** (Instagram, Facebook, TikTok, and LinkedIn are closed). User-triggered capture in the extension is the only workable source.
- **Automating the user's own Amazon account goes against Amazon's terms** and is being fought in court (Amazon v. Perplexity). Amazon recently blocked another company's shopping agent. If own-account purchasing is offered, the user clicks Buy and the app never stores passwords.
- **Universal checkout services** (e.g. Zinc, Rye) can buy from major stores today but are young. Expect failed orders, and plan for them (D-1).
- **Delivery estimates** should come from the checkout, not the product page, plus a safety buffer.
- **Single-use virtual cards with spending caps** are the strongest guard against overspending. Some providers require cards funded by a business, which affects the public version.

## 9. Privacy and data

- **MVP:** personal use. Recipients are profiled only from what the user deliberately saves or types.
- No sensitive traits inferred (C-8). Children's profiles use only what the user enters, never children's social accounts.
- The user can see and delete everything (C-7).
- **Before the public launch (out of MVP scope):** privacy law review (GDPR, US state laws), privacy notices, and recipient opt-in as the main way to build profiles. Recipients joining also removes most of the legal risk.

## 10. Success measures

**MVP pass/fail (D25, D30):** after the first holiday season of real use, **100% of approved gifts arrived on time and within budget.** Rounds skipped because the user didn't reply are tracked separately and don't count as failures.

Also tracked **[Claude's call]:**
- Recipient reactions (share rated "loved it" or "liked it"), expected to improve over seasons
- How often the user approves an idea from the first set (a measure of idea quality)
- Average time from heads-up to approval
- Rounds skipped because of no reply
- Failed or late orders

## 11. Phasing

| Phase | Scope |
|---|---|
| **MVP (personal use)** | **No target date; it ships when it's ready (D26).** Everything marked **M**, plus **S** if time allows. Chrome extension, web app that works on phones, email. US only. **[Claude's call]** |
| **Public launch** | Form a business entity (enables capped single-use virtual cards and paying for users). Billing (subscription plus per-gift fee to test, about $8–15/mo plus a small per-gift fee per research), text messages, privacy compliance, recipient opt-in and recipient-entered addresses, more import sources, a second browser. |
| **Later** | Auto-buy without a reply, gift card fallback, household sharing, gift notes and wrapping, native apps, season budgets, connecting to gift lists (a loved one's list feeds their profile and ideas). |

The concierge is one of three products on a wider platform (D31–D35). The platform roadmap and go-to-market plan are in [`strategy.md`](strategy.md).

## 12. Open questions for technical design
1. Which checkout service(s) and which stores in the MVP. Should own-account assisted checkout (A-6) be in the MVP at all?
2. Which checkout service's per-order price limit and user-funded payment setup works best for A-9.
3. Where gift ideas come from (product search, affiliate catalogs) and how to confirm they're in stock and can be delivered in time.
4. Which AI models to use for preference extraction and idea ranking.
5. How to store captures (images and text) with deletion support.
6. Who builds it and how. Not decided in the PRD, so it's sized during technical design.
