# ALL-29 Approval: Spec and Plan

**Goal:** a buyer can buy a suggested gift from the heads-up email in two taps, pick several or none of a round's ideas in the app (gifts from the person's own list first), and fix a gift that hit a problem, and rounds are switched on in production for test and admin users.

**Status:** Spec approved by the owner, 2026-11-22, after its adversarial review (T55) and the owner's six answers. Revised the same day after the plan's two adversarial reviews and the owner's further decisions (list gifts built here, "Which one?", None of these with no runs left, Zinc-supported stores, list prices).

**Links:** [ALL-29](https://linear.app/allens-forever/issue/ALL-29). Design §4.2, §6.5. PRD A-1, A-3, A-4, B-4, G-2, G-3. Planning decisions 2, 23, 36, 37, 38, 45, 53. Technical decisions T18, T29, T31, T51, T56, T68, T71, T76. Mock-ups: [ALL-29 approval](https://claude.ai/artifact/UB35r46GYrCddcLj2Frxhh) (this ticket, owner approved 2026-11-22) and the signed-off ALL-41 screens [Mom: pick from her list](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#approval), [Dad: suggested ideas](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ideas), [Where it goes](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ship-to) and [Price went up](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#needs-attention).

**Depends on (all merged):** ALL-27 idea engine (#92), ALL-125 fan-out (#95), ALL-116 failure summaries, ALL-32/ALL-30 `approveAndBuy` and Zinc ordering, ALL-112 shared-address failures, ALL-120 base budgets.

**Switching on in production (AC-20) also needs:** ALL-134 (strip contact details from facts before the AI, T75 (3)), built by the owner's session as its own PR during this work (owner, 2026-11-22), and the owner's approval to spend on production AI (T75 (4)), given 2026-11-22.

**Hands off to:** ALL-33 (order tracking reuses the re-approval screen), ALL-36 (end-to-end dry run), ALL-37 (privacy and security pass).

## Spec: what it does

### Who it's for and what they can do

1. **Buy from the email in two taps:** as a buyer, each idea in the heads-up email has its own "Buy this" link. Tap 1 opens a confirm page with everything that will happen (photo, total with the fee, arrival date, where it ships, the money notice). Tap 2 buys it. So a gift I like costs me two taps.
2. **Pick one or more:** as a buyer, the round screen lists the round's ideas, with photo, title, store, full cost, arrive-by date and the reason each fits. I tick one or more and continue to the same confirm page. Ideas from the person's own list come first and say so, and gifts someone else claimed are greyed out (decisions 36, 37).
3. **Over budget only on purpose:** as a buyer, picking the over-budget idea, or picks that add up past the budget, asks me first ("Yes, pick it" / "Keep within budget"). Without that, nothing over budget can be bought, and nothing past the over-budget allowance can be bought at all (B-4, §4.2).
4. **Set a budget where it's first useful:** as a buyer with no budget for this person and occasion, the round screen offers an optional "Your budget" field. What I type is saved as that person's budget for that occasion and marks ideas over it (decision 45, ALL-21).
5. **Choose where it ships and add a note:** as a buyer, the confirm page ships to the recipient by default. I can switch to my own address or another address (D38), and add an optional gift note.
6. **None of these:** as a buyer, I can reject a round's ideas with a reason (chips plus optional text). The reason is saved to what the app knows about the person, the round looks again, and I get new ideas by email, never the same products again (G-3). If the round has no new searches left, the sheet says so before I confirm, and the ideas stay buyable.
7. **Fix a gift that hit a problem:** as a buyer, when a gift's price went up, I can buy it at the new price if that still fits the budget rules, or buy the next-best idea in one tap. When it's out of stock, failed, or its address couldn't be used, I can buy the next-best idea or open all ideas (§6.5 steps 4–5).
8. **Photos on ideas:** as a buyer, every idea card shows the product photo when the store has one.
9. **Rounds on in production:** as the owner, rounds run on production for test and admin users, and one real round goes from start to heads-up to a real order.
10. **Gifts from their own list first:** as a buyer whose person is linked to their own gift list, the round offers that list's unclaimed gifts first, each priced and dated live, from any store Zinc can buy from. AI ideas are added only when fewer than 3 list gifts qualify. A list gift Zinc can't buy still shows, with "Buy it yourself" (decisions 36, 37, T31 (5)).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A round in `awaiting_approval` with 3 ideas | The heads-up, reminder or final-notice email is built | Each idea row has its title, total, arrive-by date, reason and a "Buy this" link to that idea's confirm page. The one button opens the round screen ("Pick several or none of these"). The text version carries the same links |
| AC-2 | The buyer is signed in as the round's owner | They open a "Buy this" link and tap "Buy now" | Exactly 2 taps from the email: `approveAndBuy` runs for that one idea and the page shows the result ("Ordered", "Waiting on your Zinc balance", "Price went up", …) |
| AC-3 | The buyer isn't signed in, or is signed in as someone else | They open any approval link | Signed out: they sign in and land back on the same page. Wrong account: they see "This gift belongs to another account" and nothing of the round. No round, idea or person detail is shown to anyone but the owner |
| AC-4 | The confirm page for one or more ideas | It loads | It shows each idea's photo, title, store and arrive-by date; the estimated price with shipping and tax, Zinc's order fee per order, and the estimated total; "never more than $cap" (the order's price cap plus the fee, the most the wallet can be charged); "Ships to" (recipient by default, city and state only for a shared address); an optional gift note; the Zinc balance and the alpha money notice (decision 53); and one "Buy now · about $total" button |
| AC-4a | Any `/rounds/…` page | It's loaded by a person, a link scanner or a prefetch | Loading never buys, rejects, or saves a budget. Only the server actions behind the buttons do (replaces T38's one-time links for these pages) |
| AC-5 | The round screen | The buyer ticks ideas | A bar shows how many are picked and their total against the budget. "Buy n gifts" opens the confirm page for those ideas |
| AC-6 | A budget is set | The buyer ticks the over-budget idea, or ticks ideas whose sum is over the budget but within the allowance | A sheet asks "Yes, pick it" or "Keep within budget". Only "Yes, pick it" lets them continue, and the confirm page then says how far over it is. `approveAndBuy` is called with `overBudgetConfirmed: true` only after that choice |
| AC-7 | Picks whose sum is past the over-budget allowance | The buyer tries to continue | It can't be bought: the bar says it's over the most they allowed, and the server refuses it too (`over_budget`) |
| AC-8 | A "Buy this" link for an over-budget idea | The confirm page loads | It says how far over the budget it is, and the button reads "Buy anyway · $total". Tapping it is the deliberate choice |
| AC-9 | No budget for this person and occasion (round `budget_cents` is null) | The buyer types one in "Your budget" on the round screen | It's saved as that person's budget for that occasion (`save_budgets`), and the open round's `budget_cents` is set from it under the round lease, with each idea's `over_budget` recomputed. This revises T73's "a round copies its budget when it starts" for this one case. `approveAndBuy` re-reads the round after taking the lease, so the cap is never computed from an older budget. Left empty, nothing is saved and it's not asked again this round |
| AC-10 | The confirm page | The buyer changes "Ships to" to themselves or another address | The order ships there (`orders.ship_to` is `buyer` or `other`), and another address can be saved to the person (D38, T31). Without a usable address, they're sent to add one and then come back |
| AC-11 | The confirm page | The buyer adds a gift note | It's sent with the order, and it can't be longer than `zinc_gift_message_max_chars`. The note never appears in events or logs (E6) |
| AC-12 | A round in `awaiting_approval` with no live orders | The buyer chooses "None of these", picks a reason chip and optionally types more | Under the round lease, when the round has a new search left (AC-13a otherwise): a `rejections` row is saved for each idea without a live order, each becomes `rejected`, and the round goes back to `generating`. "Already has one" asks "Which one?"; the buyer taps the idea they already have and its title is saved as an `owns` fact. "Not their style" and "Too generic" save one `avoid` fact naming the titles. Only AI ideas are named: a list gift's title is the list owner's words, so for a list gift the fact keeps the reason without the title, and "Already has one" on a list gift saves no fact (T42, decision 43). The free text is saved as its own `avoid` fact. Each fact has `source = 'rejection'`, stays within the 500-character limit, keeps its `active` flag, and bumps `updated_at` even when the same value already exists, so it counts as new for the idea engine's extra run (ALL-27 AC-9). "Too pricey" saves no fact: the next run searches under the cheapest rejected AI idea's total (a cheap list gift never sets it). The next run never shows those products or list gifts again. "None of these" isn't offered on a round in any other state |
| AC-12a | A round whose ideas were all rejected | The next tick runs it | The run starts and saves new ideas: the idea engine counts only ideas that aren't `rejected` when deciding a round already has ideas (`start_idea_run`, `save_ideas`) |
| AC-12b | A rejected idea, or one that isn't `proposed` any more | Someone opens an old "Buy this" link or a stale tab and presses Buy | Nothing is bought: `approve_round` and `replace_failed_order` refuse ideas that aren't `proposed` (except, for `replace_failed_order`, the failed order's own idea, which is `selected`, when it's re-bought at a new price (AC-14) or to a new address (AC-15a)), and the page says those ideas were replaced |
| AC-13 | A rejected round gets new ideas | The run saves ideas | A new heads-up email goes out with the new ideas. The rejection renames the round's sent approval emails (`heads_up` to `heads_up@1`, `reminder_1` to `reminder_1@1`, …, `@2` the second time), so the new ideas get their own heads-up and reminders under the usual keys. If the runs find nothing, the existing "couldn't get gift ideas" email goes out instead, under its usual rules, and nothing else |
| AC-13a | A round with no new search left: its runs are used up, counting the extra run only when the chosen reason saves a fact that ends up active (`round_idea_state`'s rule), or the next tick (tomorrow, UTC; the tick is daily, T49) isn't before the ship-by day, so new ideas couldn't be bought in time | The buyer opens "None of these" and picks a reason | Before confirming, the sheet says "No more new ideas this time". Confirming saves the reason (a `rejections` row with no idea, and its facts) and nothing else: the current ideas stay `proposed` and buyable until the deadline, the round stays `awaiting_approval`, and no new-ideas email goes out. The confirm saves the facts first and then checks the same rule in the same transaction; if the answer changed since the sheet, nothing is saved and the sheet shows again |
| AC-14 | An order failed with `price_up` | The buyer opens the gift's fix page | Opening the page costs nothing. A "Check today's price" button, with the money notice, looks up today's price (one product lookup for the idea's own offer, inside the paid-features check) and shows the old and new totals. "Buy at about $new" looks the price up once more under the round lease ($0.01) and refuses if it rose above what the page showed. Then it replaces the failed order through `replace_failed_order`, which saves the new total on the idea (so the order's cap follows it), with the cap worked out like `approveAndBuy`'s: other orders' committed spend counted, then the budget check (AC-6's deliberate choice and "Buy anyway" if over, refused past the allowance). Once per gift: if the price rises again, the fix page offers "See all ideas" instead |
| AC-15 | An order failed with `price_up`, `out_of_stock`, `failed` or `too_late` | The buyer opens the gift's fix page | They see what happened in plain words and the next-best idea (highest-ranked `proposed` idea in the round that can still arrive in time), with "Buy this instead". `replace_failed_order` takes the lease, checks the round is open and before its ship-by date, checks the failed order is unresolved and current, re-checks list claims and that the idea is `proposed`, counts the other picks' committed spend, then resolves the failure and inserts the new order in one transaction. The new order keeps the failed one's ship-to and gift note. With no next-best idea left, they see "See all ideas" |
| AC-15a | An order failed with `address_withdrawn` or `address_rejected` | The buyer opens the gift's fix page | The gift is offered again, not a different one: ship it to the buyer, to another address, or to the person's own address once one is added, read fresh at that moment (only while no list owner shares an address for them, T61). The new order ships to that fixed address (`ship_to` `buyer` or `other`, its snapshot saved), never re-read from the recipient, so it's never sent to the withdrawn or rejected shared address |
| AC-16 | A round in `needs_attention` | Its emails are built | The "needs your attention" email and the `failed_several` summary link each gift to its own re-approval page (ALL-116 `FailedGift.action`), not the person's page. Failures are read from the orders, not `attention_reason` (ALL-116) |
| AC-17 | Ideas are saved by a run | The run resolves each kept idea | The idea gets the product's photo URL (https only) when Zinc has one, list gifts included. Cards and the confirm page show it with `referrerpolicy="no-referrer"`; without one they show the gift icon. Photos come only from Zinc, never a URL the AI wrote or a list item's own picture. A photo lookup never pushes a run over its cost cap or drops an idea |
| AC-18 | A link or page for a round that's no longer open (ordered, skipped, past its deadline) | The buyer opens it | They see what happened ("Already ordered: LEGO Botanical Orchid", "This occasion has passed") and nothing can be bought. Buying twice from two tabs places one order (the `approve_round` lease and guards) |
| AC-19 | Two people or two tabs act on one round at once | Both press Buy | One order set is placed; the other sees what was bought (`claimed`/`busy`) |
| AC-20 | Rounds are switched on in production (moved from ALL-27, decision 53), after ALL-134 ships (the owner approved the AI spend, 2026-11-22) | The owner sets `round_engine_enabled` (app-wide; rounds reach only test and admin users through the paid-features flag) | One real round goes from start to heads-up email to approval with real ideas. Evidence on this ticket |
| AC-21 | Rounds are on (moved from ALL-28) | The morning cron runs | The production Vercel log shows `round_tick` between 12:00 and 12:59 UTC, with no errors on `/api/rounds/tick` |
| AC-22 | That real round's heads-up or reminder email (moved from ALL-26) | The owner opens the guided-questions link on a phone | The question form opens on production and an answer saves |
| AC-23 | One real order (moved from ALL-32/ALL-30) | With `zinc_ordering_enabled` on, the owner approves one cheap gift on production | The order is placed from the owner's Zinc wallet (Zinc reports `placed`) and the "gift is ordered" email arrives. Delivery is checked in ALL-36 (owner, 2026-11-22). A sandbox order on dev first |
| AC-24 | Auto top-up (moved from ALL-32). Charges the owner's real card, so the owner confirms right before it runs (owner, 2026-11-22) | Turned on only for this test, with Zinc's $15 minimum and a daily limit of about $30, and a gift costing more than the balance | Zinc charges the card and the order goes ahead. Auto top-up goes off again afterwards |
| AC-25 | A rejection reason saved from AC-12 | The person's page is opened, and the next ideas are made | The reason shows under what we know about them, and the next ideas avoid it (ticket AC) |
| AC-26 | A phone and a computer, light and dark | Each new screen is shown | It fits with no sideways scroll, and every tap target is at least 44px (`@layout` tests) |
| AC-27 | A round for a person linked to a list (`lists.person_list`) with unclaimed gifts | The round's idea run starts | Unclaimed list gifts, in list order, are priced and dated through Zinc by their store: Amazon and Walmart through the offers lookup, Best Buy, Shopify and Etsy through `GET /products/{id}`, any other store link through `GET /retailers/check?url=` (`spikes/checkout.md` answer 7). A gift from a store Zinc can only check is offered at the list's saved price plus the tax estimate, labelled "Price from their list", arriving in `planning_delivery_days`; with no saved price it's "Buy it yourself" (owner, 2026-11-22). Each call costs `zinc_lookup_cents` inside the run's cost cap, and a run makes at most `idea_list_lookups_max` (10) list lookups and stops once `idea_keep_max` qualify. A gift qualifies when Zinc can buy from its store, it can arrive in time, and it's within the over-budget allowance; it's saved as a `gift_ideas` row with `source = 'list'` and `list_item_id`, ranked first, in list order. Qualifying gifts are saved even when the cost cap stops the run |
| AC-28 | That run | Fewer than `idea_list_min` (3) list gifts qualify | The AI brainstorm runs and adds ideas up to `idea_keep_max`. With `idea_list_min` or more, there's no brainstorm and no AI cost. A person with no facts but qualifying list gifts still gets a round (no `no_ideas` email) |
| AC-29 | A list gift from a store Zinc can't buy from, or one that didn't qualify | The round screen is shown | It's listed under "From their list" with "Buy it yourself", linking to its product page. It's never bought |
| AC-30 | A list gift someone else claimed | The round screen or confirm page is shown | It's greyed out and can't be picked; `approve_round` refuses it (`claimed`). A list gift the buyer approves is claimed for them through `lists.claim_for_order`, and released if the order fails or is cancelled (ALL-30, T31 (6)). A list gift already on one of this buyer's live orders, in any round, can't be bought again |
| AC-30a | The list's owner stopped sharing it, or the buyer's link to it was cut, after the round's ideas were saved | The buyer opens the round screen or presses Buy | Its list gifts show "No longer shared" and can't be picked; `approve_round` and `replace_failed_order` refuse them (`not_shared`) through a `lists` function that checks the link (decision 43, T19) |
| AC-31 | A list gift that was given (on an order that isn't `failed`, `cancelled` or `refunded`, the same rule as `excluded_products`), or rejected | Any later run for that person | A given one is never offered again. A rejected one is skipped for the rest of that round only, and can come back in a later round; an AI product rejected stays out for good (ALL-27 AC-7). **Owner, 2026-11-22** (revised during the final review) |

### Out of scope

- Auto-buy (the `auto_buy` heads-up mode): unchanged here.
- Order tracking, late-risk checks and replacement after shipping: ALL-33, which reuses AC-15's page.
- A daily limit on idea runs per buyer: ALL-132. Sample ideas on dev: ALL-133 (this ticket seeds `gift_ideas` rows in tests instead).
- Opening paid features beyond test and admin users: ALL-135.
- Editing a gift note or ship-to after an order is placed.
- List gifts on the on-demand Gift ideas screen (ALL-27's screen stays as it is); this ticket adds them to rounds only.

### Open questions

None left for the owner. The choices marked **[Claude's call]** are open to the reviewer and the owner.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Where does choosing happen? | The email lists each idea with its own "Buy this" link to a confirm page, so it's 2 taps. One button opens the round screen for several or none | Owner, 2026-11-22 (option A). Meets "2 taps from a phone email" without guessing which idea to preselect |
| Mock-ups | ALL-29's six screens, approved by the owner 2026-11-22, aligned with ALL-41's signed-off screens: the over-budget sheet ("Yes, pick it" / "Keep within budget"), the optional "Your budget" field, claimed list gifts greyed out, and the reason chips **[Claude's call]** | ALL-41's screens were signed off by both owners; ALL-29's mock-up added the email links, the confirm page and next-best for failures |
| Photos on ideas | Saved when ideas are found, in this ticket | Owner, 2026-11-22. The ticket asks for them and they make choosing easier |
| Where the photo comes from | From the Zinc search hit if it carries one; otherwise one product-details call (`GET /products/{id}`, $0.01) per kept idea, inside the run's cost cap **[Claude's call]** | The search reply's fields aren't recorded yet (`spikes/checkout.md` **[Verify]**); ALL-141 already reads `main_image` from product details |
| Signed links or plain app links? | "Buy this", the round screen and re-approval pages are plain app URLs (`/rounds/<id>`, `/rounds/<id>/buy?ideas=…`, `/rounds/<id>/fix/<orderId>`). The page needs the owner signed in, and buying goes through a server action that calls `approveAndBuy`. The signed-link confirm page (`/a/<token>`) would add a third tap in front of the buy page **[Claude's call]** | Every signed link already needs the owner signed in and shows its own confirm step, so it can't give 2 taps without making the generic link page into the buy page. Plain URLs are simpler (1, E2), and the money checks live in `approveAndBuy` and `approve_round`, not in the link. Changes the ticket's "reachable from signed action links" and revises T38's one-time links for these pages; loading a page never acts (AC-4a). New T# |
| Ship-to on the confirm page | A "Ships to" row with the recipient as the default. Changing it opens the ALL-41 "Where it goes" choices **[Claude's call]** | A separate ship-to step would make the email path 3 taps |
| When does "None of these" search again? | On the next tick, not right away | A new search costs money and takes minutes; the tick already runs ideas inside its limits (ALL-27 AC-25, T76) |
| Reason chips | "Already has one", "Not their style", "Too pricey", "Too generic", plus optional text. ALL-41 said "He has one"; the app doesn't know pronouns, so the chips don't use them. Codes: `has_it`, `not_style`, `too_pricey`, `too_generic` **[Claude's call]** | ALL-41's signed-off chips; the ticket's "too practical" is covered by the free text |
| What facts a rejection saves | "Already has one" asks "Which one?" and saves that idea's title as `owns`; "Not their style" and "Too generic" save one `avoid` fact naming the titles, within 500 characters; the free text is its own `avoid` fact. "Too pricey" saves no lasting fact and only lowers the next search's price (AC-12) **Owner, 2026-11-22** | The engine already excludes rejected products (ALL-27 AC-7), so the fact carries only the reason. A price complaint is about this occasion, not the person (T42 (3), "ask, don't infer") |
| Which idea is "next-best" | The highest-ranked `proposed` idea in the round that still arrives in time. Not offered for address failures, which re-offer the same gift with a different address (AC-15a) | §6.5 step 5; no new search needed. For an address failure the gift was fine (T61, ALL-112) |
| How a failed order is replaced | A new database function, `replace_failed_order`, does it in one transaction under the round lease (AC-15). `approve_round` stays for first approvals. Both refuse ideas that aren't `proposed` (AC-12b). New T# | `approve_round` refuses rounds outside `awaiting_approval` and counts an unresolved failure as a live order, so it can't do this. `reapprove_order` takes any price it's given and checks no budget, so it's replaced by the new function |
| Where "Buy at $new" gets the price | One product lookup ($0.01) for the idea's own offer when the buyer taps "Check today's price" on the fix page (with the money notice; opening the page costs nothing, **[Claude's call]**, coordinator 2026-11-22), inside the paid-features check, and one more under the lease when Buy is pressed, refused if the price rose above what the page showed. Nothing is stored between the two. **[Verify]** first whether Zinc's `max_price_exceeded` failure carries the price, and use that for the page if so. **Owner, 2026-11-22** | Nothing records the new price today (`zinc/events.ts` keeps only the failure type). A stored quote could be stale or from another tab (plan review S1) |
| How often a price rise can be fixed | Once per gift. A second rise sends the buyer to "See all ideas" **Owner, 2026-11-22** | Stops a loop of rising prices; the other ideas are one tap away |
| Old email links after "None of these" | Stay valid as plain URLs; the server refuses ideas that were rejected (AC-12b) and the page says they were replaced | Simpler than expiring them; the status check protects the money path |
| What "None of these" does when runs are used up | The sheet says "No more new ideas this time" before confirming. Confirming saves the reason, keeps the current ideas `proposed` and buyable until the deadline, and sends no new-ideas email (AC-13a). Replaces the earlier answer, where the ideas were rejected and the round waited empty. **Owner, 2026-11-22** | ALL-27 caps a round at `idea_round_runs_max` (2) plus one after a new fact, about $1.20. Rejecting with nothing to replace them would strand the buyer (plan review S6) |
| How the new ideas get their own emails | The rejection renames the round's sent approval steps (`heads_up` to `heads_up@1`, and so on), so the engine sends a fresh heads-up and reminders under its usual keys **Owner, 2026-11-22** | Simpler than a per-set key on every step (plan review S5; 1, E2) |
| Gifts from the person's own list | Built in this ticket: the linked list's unclaimed gifts first, as `source = 'list'` ideas priced and dated live through Zinc; AI ideas only when fewer than `idea_list_min` (3) qualify; unbuyable ones shown with "Buy it yourself"; claimed ones greyed; given ones never return, rejected ones skip only that round (AC-27 to AC-31) **Owner, 2026-11-22** | Decisions 36, 37: a person's own list is the ideal case. T31 (5) laid out the columns; nothing wrote them yet |
| Which stores can be bought from | Any store Zinc supports, not only Amazon: Amazon and Walmart priced through offers, Best Buy, Shopify and Etsy through product details (`GET /products/{id}`), others checked with `GET /retailers/check?url=` (`spikes/checkout.md` answer 7). Orders already go to Zinc by product URL. AI ideas still come from Zinc's Amazon search **Owner, 2026-11-22** | Zinc buys from far more stores than Amazon |
| A list gift whose store gives no live price or delivery time (only the store check) | Offered at the list's saved price plus the tax estimate, labelled "Price from their list", with the usual delivery estimate (`planning_delivery_days`). The order's cap (estimate plus `order_price_margin_pct`) stops an overspend; a wrong list price fails through the normal failure email and fix page. With no saved price, "Buy it yourself" **Owner, 2026-11-22** | Keeps such gifts buyable without risking more than the cap |
| How many list gifts a run looks up | At most `idea_list_lookups_max`, a new setting, default 10, and it stops once `idea_keep_max` qualify **[Claude's call]**, coordinator 2026-11-22 | A long list could otherwise spend the whole run's cap and time on lookups and save nothing (second plan review B1) |
| When list gifts are enough to skip the AI | A new setting, `idea_list_min`, default 3, rather than reusing `idea_keep_min`, the fewest ideas a run aims to keep (ALL-27) **[Claude's call]** | Two meanings in one setting would change silently when either is tuned (T23) |
| List gifts after the list stops being shared | Not buyable: shown as "No longer shared", refused by `approve_round` and `replace_failed_order` (AC-30a) | A buyer mustn't buy and claim on a list they can no longer see (decision 43) |

## Principles check

- **Simplest version?** Plain app pages instead of new signed-link kinds; the confirm page serves one or many ideas; re-approval is one page for every failure kind. Renamed sends instead of per-set keys; no stored price quote. Cut: a separate ship-to step, an immediate new search after "None of these", list gifts on the on-demand screen.
- **Hard-coded values?** Two new settings: `idea_list_lookups_max` (10) and `idea_list_min` (3). The fee, over-budget allowance, gift-note length, price margin and run cap are existing settings.
- **Product boundaries?** All in `modules/concierge`. Budgets and facts are concierge tables. List gifts and their claims are read only through `lists.person_list`, and claimed and released through `lists.claim_for_order` and `lists.release_for_order`, the lists functions ALL-30 added. Two new `lists` functions answer whether an item is still shared with the person and who holds its claim, so concierge functions stop reading `lists.gift_claims` directly (T19, T31).
- **New personal data?** `gift_ideas.image_url` (a product photo, not personal). List gift titles are the list owner's words: they're shown to the buyer as before, but never saved into the buyer's facts or sent to the AI (T42, decision 43). A gift note is already an `orders` column. Events carry ids only (E6).
- **Docs and decisions** that need updating: `design/technical-design.md` §6.3 (list gifts first, store routes) and §6.5 (plain links, next-best, photos, `replace_failed_order`), `design/decisions.md` (a new T# for plain app links revising T38, `replace_failed_order`, photos, and AC-9's revision of T73), `design/ui.md` (the approval screens and the email's per-idea links), the round engine page (re-generation after a rejection), the screens and emails page.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revised 2026-11-22** after the plan's two adversarial reviews and the owner's decisions on list gifts, "Which one?", None of these with no runs left, Zinc-supported stores and list prices. Where each finding is fixed: the consistency check below.

**Architecture:**
- **The database guards money.** One new migration adds a photo column, makes the idea engine ignore rejected ideas and save list gifts, makes `approve_round` refuse ideas that aren't `proposed`, and adds service-role functions that run under the round lease: `replace_failed_order`, `reject_round_ideas` (with `runs_after_rejection` to know beforehand) and `set_round_budget`.
- **List gifts first.** The idea run reads the linked list through `lists.person_list`, prices and dates each unclaimed gift through Zinc by its store, at most `idea_list_lookups_max` lookups a run, and brainstorms with AI only when fewer than `idea_list_min` (3) qualify.
- **Thin TypeScript wrappers** in `modules/concierge` call the functions; pure rules live in `packages/core`.
- **Three plain app pages** (`/rounds/[id]`, `/rounds/[id]/buy`, `/rounds/[id]/fix/[orderId]`) only read; every change goes through a server action in `app/rounds/actions.ts`.

**What changes for a linked person today.** `round_candidates` doesn't look at lists, and needs no change: it picks occasions and budgets. `generateIdeas` (`runIdeas`) ignores lists entirely and stops with `no_facts` for a person with no facts, and the round plan sends `no_ideas` when `hasFacts` is false. So a list-only person gets no round ideas today. Task 6 adds the list pass and lets a person with list gifts but no facts run; Task 7 makes the round plan treat list gifts like facts. Claiming already exists: `approve_round` claims a list gift through `lists.claim_for_order` when it's approved, and `reconcile_round` releases it through `lists.release_for_order` when the order fails or is cancelled (ALL-30). `replace_failed_order` does the same; no new lists function is needed.

**Tech stack:** Next.js 16 (server components, server actions, `params` and `searchParams` as promises), Supabase (Postgres, RLS, pgTAP), Vitest (`unit` and `local-db` projects), Playwright, the fake Zinc and fake Gateway.

**Branch:** `aarontallen/all-29-approval`, cut from `main` at the start of Task 1. One PR (`Part of ALL-29`, since Task 15 follows the merge). The migration ships with the code: it adds things and tightens guards today's code never trips, so a Vercel rollback runs the old code on the new schema safely (E7).

### Global constraints

- **Settings, not constants (T23):** `zinc_order_fee_cents`, `order_price_margin_pct`, `zinc_gift_message_max_chars`, `accounts.over_budget_pct`, `idea_round_runs_max`, `idea_keep_max`, `idea_run_max_cents`, `zinc_lookup_cents`, `zinc_requests_per_second`, `planning_delivery_days` and `round_lock_minutes` are read, never copied into code. Two new settings, added by the migration with descriptions: `idea_list_lookups_max` = 10 and `idea_list_min` = 3. The 500-character fact limit is the `profile_facts` check; the code mirrors it as `FACT_VALUE_MAX`, tested on both sides (Tasks 3 and 4).
- **Loading never acts or spends (AC-4a):** the pages only read; the fix page's paid price check runs only on a tap. Buying, rejecting, saving a budget and replacing happen only in server actions, each of which takes the user from the session, validates its input with zod, checks ownership again on the server, and returns only what the screen renders (Next's `server-actions.md` > Security).
- **Privacy (principle 6, T26):** pages read a round with the signed-in user's client, so RLS applies, naming columns on `gift_rounds` and `orders`. The service role answers only "yours, someone else's, or missing" (AC-3).
- **Product boundary (T19):** the concierge reads list gifts only through `lists.person_list`, takes `storeName` from `@gifts-af/core/store-page/link` (a server-free path, so `pnpm email:html` and the extension can import it; it moved there in Task 10), and claims through `lists.claim_for_order`. Concierge SQL never reads `lists.gift_claims` or `lists.person_links` directly: it calls `lists.item_shared(p_item_id, p_person_id)` and `lists.claim_holder(p_item_id, p_user_id)` (Task 1).
- **List owners' words (T42, decision 43):** list gift titles never go into the buyer's facts or the AI prompt.
- **Explicit dependencies (E3):** module logic takes its clients and settings as arguments. Only server actions and pages build them, through `buyingWiring` and the idea-lookup wiring in `app/settings/zinc-deps.ts`.
- **Events (E6):** through `logEvent`, ids only: `round_id`, `user_id`, `order_id`, `idea_id`, counts, cents, reason codes, store route names. Never a gift note, free-text reason, title, address, URL or photo URL. New events: `round.ideas_rejected`, `round.rejection_noted`, `round.budget_set`, `order.replaced`, `order.requote`, `ideas.list_gift`.
- **Photos (AC-17):** only from Zinc, `https://` only (adapter and column check), shown with `referrerpolicy="no-referrer"`; the gift icon otherwise. "Buy it yourself" links open with `rel="noopener noreferrer"`.
- **Phones (AC-26):** every new screen fits at phone width with no sideways scroll and every tap target is at least 44px (`MIN_TAP_PX`, `e2e/phone-layout.ts`). Layout checks are short `@layout` tests; journeys stay untagged (T62). Sign in with `signIn(page)`.
- **Migration:** one file, `supabase/migrations/20261122160000_approval.sql`, re-dated past `main`'s newest just before merge. Expand-only (E7): `reapprove_order` stays, unused, until a later contract migration. Don't push it to dev before merge. Run `pnpm db:types` after it changes.
- **Fakes (E5):** the database is always real for money, rounds, lists and privacy (pgTAP, `pnpm test:db`, Playwright on local Supabase). Zinc, the AI Gateway and email are faked. The unit-test fake Zinc refuses an order whose `max_price` is below its product's price, as Zinc does.
- **Before the PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm build`, then `pnpm --filter @gifts-af/web e2e` (check the exit code).

### File map

| File | Change |
|---|---|
| `supabase/migrations/20261122160000_approval.sql` | New: `image_url`, two settings, two `lists` functions, `excluded_offers`, idea counting, `save_ideas` list fields, `approve_round` guards, four functions |
| `supabase/tests/approval.test.sql` | New pgTAP |
| `packages/core/src/approval.ts` (+ `index.ts`, test) | New: `rejectionFacts`, `nextBestIdea`, `picksBar` |
| `packages/core/src/{ideas,round-plan}.ts` | `JudgeContext.maxTotalCents`, `ideaRunWorstMs` with the list pass; `hasFacts` becomes `hasInputs`; the skip rule's prefix check |
| `packages/core/src/database.types.ts` | Regenerated |
| `apps/web/modules/concierge/zinc/products.ts` | Retailer on offers and details; `checkRetailer`; `listGiftQuote` |
| `apps/web/modules/concierge/ideas/{run,store}.ts` | The list pass, photos, the price ceiling |
| `apps/web/modules/concierge/purchase/{approve,replace,store}.ts` | `approveAndBuy` changes, `capsFor`; new `replaceFailedOrder`, `quoteFailedOrder` |
| `apps/web/modules/concierge/rounds/{approval,engine,store}.ts` | New `rejectRoundIdeas`, `rejectionOutlook`, `setRoundBudget`, `roundAccess`, `roundView`; engine reads list gifts and the new idea fields |
| `apps/web/modules/concierge/notify/{templates,samples}.ts`, `lib/email-layout.ts` | Per-row links; buy links; fix links |
| `apps/web/app/rounds/…`, `components/idea-photo.tsx` | New pages, screens, actions, photo |
| `apps/web/app/people/[id]/ideas/ideas-screen.tsx` | Photos on idea cards |
| `apps/web/modules/concierge/__tests__/fake-zinc.ts`, `apps/web/e2e/{approval.spec,fake-zinc,gallery.shots}.ts` | Fakes (other stores, max-price refusal), journeys, layout, gallery |

---

### Task 1: Ideas that count, list ideas, and `approve_round`'s new guards (AC-12a, AC-12b, AC-17, AC-27, AC-28, AC-30, AC-30a, AC-31)

**Files:** create the migration and `supabase/tests/approval.test.sql`.

**Produces:**
- `gift_ideas.image_url text` with `check (image_url is null or image_url ~ '^https://')`. Readable by signed-in owners (the table has no column grants).
- `start_idea_run`: re-created from `20261121140000_round_fanout.sql`; `done` only when the round has an idea whose `status <> 'rejected'`.
- `save_ideas`: re-created from `20261117100000_idea_engine.sql`; the same rule. It inserts `image_url`, and `source` and `list_item_id` from each element (`source` defaults to `generated`; `list` requires a `list_item_id`).
- Settings `idea_list_lookups_max` = 10 and `idea_list_min` = 3, each with a description.
- `lists.item_shared(p_item_id uuid, p_person_id uuid) returns boolean`: the item is on the list `lists.active_link(p_person_id)` names. `lists.claim_holder(p_item_id uuid, p_user_id uuid) returns text`: `none`, `mine` or `other`. Both security definer, service_role only; they belong to the lists product and are its interface to the concierge (T19).
- `concierge.excluded_offers(p_person_id uuid, p_round_id uuid) returns table (retailer text, product_id text, list_item_id uuid)`: `excluded_products`' rule with one definition of "given" (an order not `failed`, `cancelled` or `refunded`), matched on retailer and product id, plus given list items and list items already offered in `p_round_id` (null on demand). A list item rejected in another round isn't listed (AC-31, owner 2026-11-22). `excluded_products` stays, unused, for a later contract migration.
- `approve_round`: re-created from `20261113100000_order_address_source.sql`. After the "isn't this round's" check: any idea with `status <> 'proposed'` raises `approve_round: replaced`; a list idea not `lists.item_shared` with the round's person raises `approve_round: not_shared` (B2); a list item already on a live order of this user in any round raises `approve_round: already_bought` (S2). The direct `lists.gift_claims` join is replaced by `lists.claim_holder(…) = 'other'` before the insert and `lists.claim_for_order` or `claim_holder = 'mine'` after it (S3). All P0001.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `start_idea_run starts a round whose ideas were all rejected` (run id returned, refusal null)
  - `save_ideas saves into a round whose ideas were all rejected` (returns 3)
  - `save_ideas keeps image_url, source and list_item_id`
  - `image_url refuses http://` (`throws_ok`, 23514)
  - `approve_round refuses a rejected idea` (`approve_round: replaced`)
  - `approve_round refuses a selected idea`
  - `approve_round refuses a list idea after the link is cut` (`not_shared`)
  - `approve_round refuses a list item already on this buyer's live order in another round` (`already_bought`)
  - `item_shared and claim_holder answer for the linked list only`; `anon and authenticated can't execute them`
  - `excluded_offers lists a rejected list item and a given Walmart product with its retailer`
  - Regression guards (pass before and after): `start_idea_run still says done when one idea is proposed`; `save_ideas refuses a list idea with no list_item_id` (already enforced by `gift_ideas_list_item_matches_source`); `approve_round still refuses a gift a friend claimed`
- [ ] **Step 2: Watch them fail.** `pnpm db:test`. Expected: the new tests fail; the guards pass.
- [ ] **Step 3: Write this part of the migration.**
- [ ] **Step 4: Watch them pass.** `pnpm supabase db reset && pnpm db:test`. Expected: all files pass, `idea_engine.test.sql` and `approve_round_guards.test.sql` unchanged.
- [ ] **Step 5: Commit** `feat(db): rejected ideas don't count, list ideas save, approval refuses replaced ideas (ALL-29)`.

### Task 2: `replace_failed_order` (AC-14, AC-15, AC-15a, AC-12b, AC-30)

**Files:** the migration and `approval.test.sql`.

**Produces:** `concierge.replace_failed_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_failed_order_id uuid, p_order jsonb) returns setof concierge.orders`. `p_order` has an `approve_round` element's shape (`idea_id`, `max_price_cents`, `fee_cents`, `gift_message`, `ship_to`, `address_source`, `address`) plus `new_total_cents` for a price-up re-buy. Security definer, `search_path = ''`, service_role only. In order, each refusal a P0001 starting `replace_failed_order:`:
1. Round locked `for update`, the user's, `locked_until = p_lock` (`lease not held`).
2. `closed_at is null`, status `needs_attention`, and the UTC day before `ship_by_deadline` (`not open`).
3. The failed order is this round's and user's, `status = 'failed'`, `not resolved` (`not current`).
4. The idea is this round's and either `proposed`, or the failed order's own idea when its `failure_type` is `price_up`, `address_withdrawn` or `address_rejected` (`replaced`).
5. A same-idea `price_up` re-buy is refused when that idea already has a resolved `price_up` order (`once`, S2), and needs `new_total_cents`.
6. For `address_withdrawn` and `address_rejected`, `ship_to` must be `buyer` or `other` with `address_source = 'own'` (`fixed address`, B2): the order keeps a saved snapshot and `placeRound` never re-reads the recipient for it.
7. The list checks, as in `approve_round`: `not_shared`, `already_bought` (other rounds), and the claim through `lists.claim_holder` and `lists.claim_for_order` (`claimed`).
8. Then: `resolved = true` on the failed order; for a price-up re-buy, the idea's `est_total_cents = new_total_cents` and `over_budget` recomputed against the round's budget (B1, so `placeRound`'s cap re-check follows the new price); insert the `held`/`retry` order and its `order_addresses` row; the idea `selected`; `reconcile_round`; return the new order.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `replace_failed_order replaces an out_of_stock order with a proposed idea` (old `resolved`, new `held`, idea `selected`)
  - `the new order keeps the gift note and ship_to it was given`
  - `a price_up re-buy saves the new total on the idea` (`est_total_cents` = 5400, `over_budget` true against 5000)
  - `a second price_up re-buy of the same idea is refused` (`once`)
  - `an out_of_stock order can't be re-bought as the same idea` (`replaced`)
  - `a rejected idea is refused` (`replaced`)
  - `an address_rejected order can't ship to the recipient` (`fixed address`)
  - `an address_rejected order can go to the buyer` (`ship_to = 'buyer'`, `address_source = 'own'`)
  - `a second replace of the same failed order is refused` (`not current`)
  - `a closed round is refused`; `on the ship-by day it's refused`; `without the lease it's refused`; `another user's round is refused`
  - `a list gift a friend claimed is refused` (`claimed`); `a list gift whose link was cut is refused` (`not_shared`); `a list gift re-bought is claimed for the buyer`
  - `anon and authenticated can't execute it`
- [ ] **Step 2: Watch them fail.** `pnpm db:test`.
- [ ] **Step 3: Write it.**
- [ ] **Step 4: Watch them pass.** `pnpm supabase db reset && pnpm db:test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(db): replace a failed order under the round lease (ALL-29)`.

### Task 3: Reject a round's ideas, and set an open round's budget (AC-9, AC-12, AC-13, AC-13a)

**Files:** the migration, `approval.test.sql`; then regenerate `packages/core/src/database.types.ts`.

**Produces:**
- `concierge.runs_after_rejection(p_round_id uuid, p_facts jsonb, p_now timestamptz, p_list_gifts boolean) returns boolean`, stable, service_role only, for the sheet: `round_idea_state`'s runs rule, counting a fact in `p_facts` as newer than the last run only if it would end up active (a new fact, or an existing one that's on; a turned-off duplicate doesn't count, B3), and false when `p_now`'s UTC day plus one isn't before `ship_by_deadline` (S1). A missing setting answers false. **None of these can strand the buyer (final review):** also false unless a run can really happen: `round_engine_enabled` and `idea_engine_enabled` are 1, the buyer has paid features, and the person has an active fact (counting the ones this choice saves) or `p_list_gifts`, which the caller sets when `listGiftCandidates` for this round finds a gift beyond the ones it already offered. `reject_round_ideas` takes the same `p_list_gifts`.
- `concierge.reject_round_ideas(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_reason_code text, p_reason_text text, p_facts jsonb, p_expect_more boolean) returns void`, service_role only.
  - Refuses (P0001 `reject_round_ideas: …`): lease not held; status not `awaiting_approval` or closed; any live order (not `cancelled`, not a resolved failure); `p_reason_code` not in (`has_it`, `not_style`, `too_pricey`, `too_generic`); a fact category other than `owns` or `avoid`.
  - Saves each `p_facts` element (`{category, value}`) with `source = 'rejection'`, `on conflict (person_id, category, value_key) do update set updated_at = now()`, leaving `active` as it is.
  - Then, in the same transaction, reads `round_idea_state(p_round_id).runs_left` and the deadline rule; if that differs from `p_expect_more`, raises `changed`, which rolls the facts back too (B3).
  - **New search left:** one `rejections` row per idea without a live order, `proposed` or `selected` (a `selected` idea whose order was cancelled would otherwise make `start_idea_run` say `done`); those ideas `rejected`; the round's sent approval steps renamed to `<step>@<n>`, `n` the next free number (`heads_up`, `reminder_1`, `reminder_2`, `final_notice`, `no_ideas`, `no_ideas_again`) (S5); the round `generating`, `next_action_at = now()`.
  - **None left:** one `rejections` row with `idea_id` null; ideas and round unchanged (decision b).
- `concierge.set_round_budget(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_budget_cents integer) returns void`, service_role only. Refuses: lease not held; status not `awaiting_approval`; `budget_cents` already set (`already set`); a negative amount. Sets `budget_cents`, then `over_budget = est_total_cents > p_budget_cents` on the round's `proposed` ideas.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `with a search left, reject saves a rejection per idea, marks them rejected and sends the round back to generating, due now`
  - `the sent heads_up and reminder_1 become heads_up@1 and reminder_1@1; a second rejection makes @2`
  - `with no search left, reject saves one reason and leaves the ideas proposed and the round awaiting_approval`
  - `runs_after_rejection: after idea_round_runs_max runs, true with a new fact, false without`; `after max + 1 runs, false either way`
  - `at max runs, a fact that duplicates a turned-off one doesn't count` (sheet false; reject with `p_expect_more` true is `changed` and saves nothing) (B3)
  - `the day before the ship-by day there's no new search` (S1)
  - `a selected idea with a cancelled order is rejected too, so the next run starts`
  - `a fact that already exists has its updated_at bumped and stays inactive if it was off`
  - `a 501-character fact is refused` (23514)
  - `a round with a live order can't be rejected`; `a needs_attention round can't be rejected`; `an unknown reason code is refused`
  - `set_round_budget sets the budget and marks ideas over it` (5000: a 6000 idea `over_budget`, a 4000 idea not)
  - `set_round_budget refuses a round that already has a budget`
  - `without the lease each is refused`; `anon and authenticated can't execute them`
- [ ] **Step 2: Watch them fail.** `pnpm db:test`.
- [ ] **Step 3: Write them.**
- [ ] **Step 4: Watch them pass, then regenerate types.** `pnpm supabase db reset && pnpm db:test && pnpm db:types`. Expected: all pass; `database.types.ts` gains the column and functions.
- [ ] **Step 5: Commit** `feat(db): reject a round's ideas and set an open round's budget (ALL-29)`.

### Task 4: Pure rules for the screens [P] (AC-5, AC-6, AC-7, AC-12, AC-15)

Can run alongside Tasks 1–3.

**Files:** create `packages/core/src/approval.ts` and `approval.test.ts`; export from `index.ts`.

**Produces:**
- `type RejectionCode = "has_it" | "not_style" | "too_pricey" | "too_generic"`; `FACT_VALUE_MAX = 500`.
- `rejectionFacts(code: RejectionCode, text: string | null, ideas: { title: string; source: "generated" | "list" }[], owned: { title: string; source: "generated" | "list" } | null): { category: "owns" | "avoid"; value: string }[]`: `has_it` saves an AI idea's title as `owns` (nothing for a list gift or none); `not_style` saves `avoid` "Not their style: <AI idea titles>", `too_generic` "Too generic: <AI idea titles>", and nothing when every idea came from the list (final review: a bare reason teaches the AI nothing), cut to fit 500 characters at a title boundary; `too_pricey` none; the free text, trimmed, as its own `avoid` fact, cut to 500. Cuts count characters as the database does (code points), so an emoji is never split; an owned title that's blank after trimming saves nothing. List gift titles are never saved (T42).
- `nextBestIdea(ideas: { id; rank; status; handlingDaysMax; deliveryDaysMax }[], ctx: { today; occasionDate; s: ScheduleSettings }): string | null`: the lowest `rank` that is `proposed` and passes `canArriveInTime`.
- `picksBar(totals: number[], budgetCents: number | null, overBudgetPct: number): { count; totalCents; fit: BudgetFit }`, on `classifyTotal`.

- [ ] **Step 1: Write the failing tests:**
  - `has_it saves the tapped AI idea's title as owns; a tapped list gift or none saves nothing`
  - `not_style names only AI ideas; with only list gifts it saves nothing`
  - `not_style and too_generic save one avoid fact naming the titles; too_pricey saves nothing`
  - `a long title list is cut at a title, within 500 characters`
  - `the free text is its own avoid fact, trimmed; blank adds nothing`
  - `FACT_VALUE_MAX is 500` (the database side is Task 3's `a 501-character fact is refused`)
  - `next-best skips rejected, selected and too-slow ideas and takes the lowest rank`; `null when nothing can arrive in time`
  - `picksBar: 2 picks of $30 against $50 at 20% are over; against $70 within; 3 of $30 dropped`
- [ ] **Step 2: Watch them fail.** `pnpm --filter @gifts-af/core test`. Expected: module not found.
- [ ] **Step 3: Write `approval.ts`.**
- [ ] **Step 4: Watch them pass.** Same command.
- [ ] **Step 5: Commit** `feat: rules for picks, rejections and next-best ideas (ALL-29)`.

### Task 5: Zinc lookups for any supported store [P] (AC-27, AC-29, AC-17)

Can run alongside Tasks 1–4.

**Files:** `modules/concierge/zinc/products.ts`, `__tests__/zinc-products.test.ts`, `__tests__/fake-zinc.ts`.

**Produces:**
- `productOffers` and `productDetails` take `retailer: ZincRetailer` (today hard-coded `amazon`). `productDetails` is exported for the idea run (its comment, which says only `amazonPasteDetails` may call it, is updated) and returns `deliveryDaysMax` and `shippingCents` when the reply has them (**[Verify]** against Zinc's product-details reply for Best Buy and Etsy).
- `checkRetailer(h, key, url, signal): Promise<boolean>`: `GET /retailers/check?url=`.
- `listGiftRoute(url: string, asin: string | null): { kind: "offers"; retailer: "amazon" | "walmart"; productId: string } | { kind: "details"; retailer: "bestbuy" | "etsy" | "shopify"; productId: string } | { kind: "check" }`: Amazon by its ASIN; Walmart, Best Buy and Etsy by their product id in the link; Shopify through `GET /products/{id}` as `spikes/checkout.md` answer 7 says, recognised by Shopify's `/products/<handle>` link form; everything else by the store check. **[Verify]** Zinc's retailer codes, each store's product-id form, and how Zinc names a Shopify product.
- `listGiftQuote(h, key, item: { url; asin; listPriceCents }, signal): Promise<{ kind: "offer"; offer: ZincOffer; productId; imageUrl } | { kind: "listed"; priceCents } | { kind: "unsupported" }>`: offers route → `pickOffer`; details route → an offer built from the reply; check route → `listed` at the list price when the check passes and there's a list price (the owner question), else `unsupported`. One or two calls, each charged by the caller.
- The unit fake Zinc answers the new routes, and refuses an order whose `max_price` is below its product's price with `max_price_exceeded` (B1).

- [ ] **Step 1: Write the failing tests:**
  - `an Amazon list gift is priced through offers with its ASIN`
  - `a Walmart link uses offers with the walmart retailer`
  - `a Best Buy link uses product details`; `a Shopify /products/ link uses product details`
  - `another store passes the check and is listed at its list price`
  - `a store the check refuses is unsupported`; `no list price is unsupported`
  - `an http photo is dropped`
  - `the fake refuses an order capped below the price`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Write the adapter changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test`. Expected: all pass, the existing Amazon lookups unchanged.
- [ ] **Step 5: Commit** `feat: Zinc lookups for list gifts from any supported store (ALL-29)`.

### Task 6: List gifts first, photos and the price ceiling in the idea run (AC-12, AC-17, AC-27, AC-28, AC-31)

**Files:** `packages/core/src/ideas.ts` and test; `modules/concierge/ideas/{run,store}.ts`; `__tests__/{idea-run,idea-store}.test.ts`.

**Consumes:** Task 1 (`save_ideas` list fields), Task 5 (`listGiftQuote`, `productDetails`).

**Produces:**
- `listGiftCandidates(db: AdminDb, personId: string): Promise<{ itemId; name; url; asin; listPriceCents }[]>` in `ideas/store.ts`: the one read of offerable list gifts (S6), used by the run and by `roundContext`. From `lists.person_list` (service role): unclaimed, in list order, leaving out `excluded_offers`' list items (AC-31). `IdeaInputs.listGifts` (rounds only) comes from it; product exclusion moves to `excluded_offers` (retailer plus product id).
- `IdeaInputs.round.maxTotalCents: number | null`: the lowest `est_total_cents` among the round's AI ideas rejected with `too_pricey`; list gifts never set it (nit). `JudgeContext.maxTotalCents`: a total at or above it drops as `over_limit`; the brainstorm's budget is `min(budget, maxTotalCents)`.
- `runIdeas`:
  1. `no_facts` only when there are no facts and no list gifts.
  2. After `start`, the list pass, in list order: each gift through `listGiftQuote` and `judgeCandidate` (a `listed` gift is judged with `planning_delivery_days` as its delivery time), each call charged `zinc_lookup_cents` through the run's `lookup`. It stops after `idea_list_lookups_max` lookups or once `idea_keep_max` qualify. Qualifying gifts become `SavedIdea`s with `source: "list"`, `listItemId`, title from the list, `retailer` from `storeName`, reason "On their list", ranked first. Logs `ideas.list_gift` with the route and outcome only.
  3. With at least `idea_list_min` list gifts, save them and stop: no brainstorm. Otherwise, if there are facts, brainstorm (list gift titles never in the prompt) and keep up to `idea_keep_max` minus the list gifts kept; with no facts, save the list gifts alone. If the cost cap or the deadline stops the run after list gifts qualified, they're still saved (outcome `saved`), not lost as `cost_cap` (B1).
- `ideaRunWorstMs(aiTimeoutMs, zincTimeoutMs, listLookupsMax, zincRequestsPerSecond)`: adds the list pass (its lookups at the rate limit plus two Zinc timeouts: a details lookup Zinc rejects is followed by the store check), so the engine's tick deadline and the on-demand action's budget stay true.
- Photos: a hit's `imageUrl` if the search reply has one (**[Verify]** the field first; if present, no extra call); otherwise one `productDetails` call per kept idea without one, made only while the run has room under `idea_run_max_cents`. A failed or skipped photo call leaves the photo null and never drops an idea (nit).
- `SavedIdea` gains `imageUrl`, `source` and `listItemId`; `save()` sends them.

- [ ] **Step 1: Write the failing tests:**
  - core: `judgeCandidate drops a total at or above maxTotalCents`
  - run: `three qualifying list gifts are saved first and no brainstorm runs` (fake Gateway call count 0)
  - `two qualifying list gifts are kept and the brainstorm fills up to idea_keep_max`
  - `a person with no facts and one list gift gets that one idea`
  - `a 200-item list makes at most idea_list_lookups_max lookups and saves what qualified` (B1)
  - `list gifts that qualified are saved when the cost cap stops the brainstorm`
  - `ideaRunWorstMs counts the list pass`
  - `list gift titles never reach the brainstorm prompt`
  - `a list gift that can't arrive in time, or is past the allowance, isn't saved`
  - `list lookups count toward idea_run_max_cents`
  - `a photo call never runs past the cost cap, and a failed one keeps the idea`
  - store (local-db): `listGiftCandidates leaves out claimed items, items rejected before, and items on a live order`
  - `the run after Too pricey uses the cheapest rejected AI idea's total as its ceiling, ignoring a cheaper list gift`
- [ ] **Step 2: Watch them fail.** `pnpm test && pnpm test:db`.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** Same commands. Expected: all pass, including the existing `idea-run` tests.
- [ ] **Step 5: Commit** `feat: gifts from their own list first, photos, and a lower price after Too pricey (ALL-29)`.

### Task 7: The engine after a rejection, and list-only people (AC-13, AC-28)

**Files:** `packages/core/src/round-plan.ts` and test; `modules/concierge/rounds/{engine,store}.ts`; `__tests__/round-engine.test.ts`.

**Produces:**
- `RoundView.hasFacts` becomes `hasInputs`: active facts, or `listGiftCandidates(…).length > 0` (`RoundContext.hasListGifts`, the same read the run uses, S6; read only before ideas are found, as `hasFacts` is today).
- The skip rule's "was the buyer told anything?" checks `heads_up`, `address_request` and `no_ideas` with or without an `@n` suffix (`toldBefore(sent)`), since a rejection renames them.
- No other engine change for re-generation: after Task 3's rename the usual keys are free, so a rejected round runs ideas on the next tick and sends a fresh heads-up and reminders.

- [ ] **Step 1: Write the failing tests:**
  - round-plan: `a list-only person (no facts, list gifts) generates instead of sending no_ideas`
  - store (local-db): `hasListGifts and the run's listGifts agree for a claimed-only list` (both empty)
  - `with heads_up@1 sent and no heads_up, a round with new ideas sends heads_up`
  - `the deadline skip emails a buyer whose only heads-up is heads_up@1`
  - engine (fake store): `a rejected round runs ideas on the next tick and sends a second heads-up with the new ideas`
  - `a rejected round whose runs find nothing sends no_ideas once, and later ticks send nothing more` (B3)
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm test:db`. Expected: all pass, including `fanout-db.test.ts`.
- [ ] **Step 5: Commit** `feat: new ideas and their own emails after None of these; rounds for list-only people (ALL-29)`.

### Task 8: Buying and replacing in TypeScript (AC-2, AC-6–AC-11, AC-12b, AC-14, AC-15, AC-15a, AC-18, AC-19)

**Files:** `modules/concierge/purchase/approve.ts`, `store.ts`, new `replace.ts`; `__tests__/purchase.test.ts` (local-db), new `__tests__/replace.test.ts` (local-db); export through `modules/concierge/index.ts`.

**Consumes:** Tasks 1–2, Task 5 (`listGiftQuote` for re-quotes), `sequentialCaps` and `placeRound` from `place.ts`, `committedSpendCents` and `classifyTotal` from core.

**Produces:**
- `ApproveInput` gains `shipTo?: ShipTo`, `type ShipTo = { kind: "recipient" } | { kind: "buyer" } | { kind: "other"; address: AddressDraft; saveToPerson: boolean }`. `buyer` reads `public.account_addresses` (service role; `address_source = 'own'`); `other` checks `isShippableAddress`.
- `ApproveError` gains `"not_shared"`, `"already_bought"` (from `approve_round`'s new guards) and `"replaced"`, returned when a picked idea isn't `proposed` (`IdeaRow` gains `status`), checked after the lease and before `approve_round`, so a stale link on a `generating` round says "replaced", not "not open"; also mapped from `approve_round: replaced`.
- `approveAndBuy` keeps its ownership read before the lease (so it never leases another user's round), then reads the round again after `claimRoundNow` and works only from that read (AC-9).
- `capsFor(round: RoundRow, totals: number[], account: Account, confirmed: boolean, settings, committedCents: number): { caps: number[]; neverMoreThanCents: number } | ApproveError`, shared by `approveAndBuy`, `replaceFailedOrder` and the confirm page.
- `quoteFailedOrder(input: { userId; roundId; orderId }, deps: QuoteDeps): Promise<{ oldCents; newCents } | "not_allowed" | "not_current" | "not_open" | "unavailable" | "once">`, read-only, for the fix page's "Check today's price" action (never on load): `not_open`, with no lookup, unless the round needs attention, isn't closed and today is before its ship-by day, and `zinc_off`, with no lookup, unless `zinc_ordering_enabled` is 1 (final review); inside `hasPaidFeatures`, one quote for the idea's own offer (`offer_id`; gone counts as `unavailable`) through `listGiftQuote`'s route; `once` when the idea already had a price rise fixed. `QuoteDeps` = `DbDeps` (`{ db, now }`) plus `lookup: { http; key }` (the app's lookup key, as the idea run uses it, **[Verify]**). Logs `order.requote`.
- `replaceFailedOrder(input: { userId; roundId; failedOrderId; ideaId; shownTotalCents?: number; shipTo?: ShipTo; overBudgetConfirmed?: boolean }, deps: PurchaseDeps & QuoteDeps): Promise<ApproveResult>`: ownership read, `hasPaidFeatures` (refuses `not_allowed`, nit), lease, re-read; for a price-up re-buy, one more quote under the lease, refused (`price_changed`) when above `shownTotalCents` (S1); the other live orders' committed spend; the budget check (`needs_confirmation`, `over_budget`); caps; `replace_failed_order` with `new_total_cents`; `placeRound`; the same "tell the customer" step as `approveAndBuy`. Address failures pass `shipTo` (`buyer`, `other`, or the person's own address as `other`, only when `recipientAddress` isn't shared, T61).

- [ ] **Step 1: Write the failing local-db tests:**
  - `a budget set while approveAndBuy takes the lease caps the order at the new budget` (S7: the test adds a temporary trigger on that round that sets `budget_cents = 5000` when `locked_until` changes, so the read before the lease sees no budget and the read after sees 5000; it fails on today's code)
  - `ships to the buyer's own address when asked` (`ship_to = 'buyer'`, the snapshot is the account address)
  - `another address is saved to the person when asked`
  - `a stale link after None of these returns replaced and places nothing`
  - `a gift note over zinc_gift_message_max_chars is refused`
  - `a price_up re-buy places at the new price` (B1: the fake refuses any cap below the price; the re-buy is placed)
  - `the re-buy is refused when the price rose again since the page loaded` (`price_changed`; two quotes, no order)
  - `a second price rise on the same gift is offered no re-buy` (`once`)
  - `replace counts the round's other placed order against the budget` ($30 placed and a $25 next-best against $50 → `needs_confirmation`)
  - `replace past the over-budget allowance is refused` (`over_budget`)
  - `without paid features replace is refused and calls no Zinc`
  - `an address_rejected gift re-bought to the buyer ships to the buyer, with the shared address still present` (B2, through `placeRound`: the Zinc order's address is the buyer's)
  - `two replaces at once: one order, the other busy`
  - `a list gift whose link was cut returns not_shared and places nothing`
  - Regression guard (passes before and after; ALL-30 built it): `a list gift approved is claimed for the buyer, and released when its order fails`
- [ ] **Step 2: Watch them fail.** `pnpm test:db`.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test:db`. Expected: all pass, including the existing `purchase.test.ts`.
- [ ] **Step 5: Commit** `feat: buy with a ship-to choice and replace a failed gift (ALL-29)`.

### Task 9: Rejecting, the open round's budget, and page reads [P with Task 8] (AC-3, AC-9, AC-12, AC-13a, AC-18, AC-25, AC-29, AC-30)

**Files:** new `modules/concierge/rounds/approval.ts`, `__tests__/approval-db.test.ts` (local-db); export through `index.ts`.

**Produces:**
- `rejectionOutlook(input: { roundId; code; text; ownedIdeaId }, deps): Promise<boolean>`: `runs_after_rejection` with the facts that choice would save, so the sheet says "No more new ideas this time" for exactly that choice.
- `rejectRoundIdeas(input: { userId; roundId; code: RejectionCode; text: string | null; ownedIdeaId: string | null; expectMore: boolean }, deps: ZincDeps): Promise<{ ok: true; more: boolean } | { ok: false; error: "not_found" | "busy" | "not_open" | "changed" | "too_long" }>`: lease, `rejectionFacts` from the proposed ideas' titles (the owned idea's title for `has_it`), `reject_round_ideas`. Logs `round.ideas_rejected` or `round.rejection_noted` with the code and count only. Doesn't call `advanceRound`: the next tick runs ideas.
- `setRoundBudget(input: { userId; roundId; budgetCents: number }, userDb, deps: ZincDeps): Promise<"saved" | "busy" | "already_set" | "not_open">`: `save_budgets` as the user (the round's occasion kind), then `set_round_budget` under the lease; logs `round.budget_set`.
- `roundAccess(roundId, viewerId, deps): Promise<"mine" | "other" | "missing">`: the only service-role read, returning nothing else (S4).
- `roundView(roundId, userDb): Promise<RoundPageView>`: read with the user's client (RLS), naming columns on `gift_rounds` and `orders`: the round, its ideas (`imageUrl`, `source`, `listItemId`), live and failed orders, `closedText` (AC-18), the next-best idea, and from `lists.person_list` (the user may read their own people's) the claimed flags and the list gifts not among the ideas, for "Buy it yourself". When `person_list` no longer returns the list (the link was cut), the round's list ideas are marked `noLongerShared` (AC-30a).

- [ ] **Step 1: Write the failing local-db tests:**
  - `None of these with a search left saves the reason and the facts and sends the round back to generating`
  - `None of these with no search left keeps the ideas buyable` (the round still `awaiting_approval`, ideas `proposed`)
  - `a stale outlook returns changed and saves nothing`
  - `a busy round returns busy and changes nothing`; `after an order was placed it returns not_open`
  - `the saved reason shows in activeFacts for the person` (AC-25)
  - `a budget typed on the round is saved for the person and the occasion, and sets the round's budget`
  - `roundAccess tells another account only "other"`; `roundView as another user returns nothing` (RLS)
  - `roundView greys a claimed list gift and lists an unbuyable one for Buy it yourself`
  - `after the link is cut, roundView marks the round's list ideas no longer shared`
  - `an ordered round's view says what was ordered`; `a past round says the occasion has passed`
- [ ] **Step 2: Watch them fail.** `pnpm test:db`.
- [ ] **Step 3: Write `approval.ts`.**
- [ ] **Step 4: Watch them pass.** `pnpm test:db`.
- [ ] **Step 5: Commit** `feat: reject a round's ideas and set its budget from the round screen (ALL-29)`.

### Task 10: Emails link to the new pages [P with Tasks 7–9] (AC-1, AC-16)

**Files:** `lib/email-layout.ts` and its test; `modules/concierge/notify/{templates,samples}.ts`; `rounds/{engine,store}.ts`; `__tests__/{templates,samples}.test.ts`.

**Produces:**
- `EmailParts.rows[]` gains `link?: { label: string; url: string }`: an anchor under the row's detail, 44px tall like the other plain links; the text version prints `label: url` under the row.
- `IdeaRow` gains `arriveBy` and `reason`. `TemplateLinks.heads_up | reminder | final_notice` become `{ choose: string; questions?: string; [buy: `buy${number}`]: string }`, the `who_is_this` pattern. Each row's link is "Buy this"; the button reads "Pick several or none of these" and opens `/rounds/<id>`.
- The engine passes plain links (`LinkSpec` `{ path }`): `buy<i>` → `/rounds/<id>/buy?ideas=<ideaId>`, `choose` → `/rounds/<id>`. `RoundContext.ideas` gains `id`, `arriveBy` and `reason`.
- `sendOpenFailures` and `failed_several`: each `FailedGift` gains `url`, `/rounds/<id>/fix/<orderId>`; the single-failure emails' button opens that page. The auto-buy heads-up keeps its current links.

- [ ] **Step 1: Write the failing tests:**
  - `a row with a link renders it as an anchor and in the text version`
  - `the heads-up has a Buy this link per idea and one button to the round screen` (3 ideas → 3 `/buy?ideas=` URLs, 1 `/rounds/<id>` button)
  - `reminder and final notice carry the same links`
  - `failed_several links each gift to its own fix page`; `a single price_up email opens that order's fix page`
  - `the samples render every kind`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test`.
- [ ] **Step 5: Commit** `feat: Buy this links in the approval emails, and failure links to each gift (ALL-29)`.

### Task 11: The round screen (AC-3, AC-5, AC-6, AC-7, AC-9, AC-12, AC-13a, AC-17, AC-18, AC-29, AC-30)

**Files:** create `apps/web/app/rounds/[id]/page.tsx`, `round-screen.tsx`, `app/rounds/actions.ts`, `app/rounds/access.tsx`, `components/idea-photo.tsx`; tests in `app/rounds/__tests__/round-screen.test.tsx`; photos in `app/people/[id]/ideas/ideas-screen.tsx`.

**Produces:**
- Page: `params: Promise<{ id: string }>`; `roundAccess` decides the state, then `roundView` reads the round. Signed out is handled by `proxy.ts` (`signInRedirect` keeps the path and query). "other" shows "This gift belongs to another account" and nothing else.
- `RoundScreen`: list gifts first ("On their list"), then AI ideas: photo, title, store, total, arrive-by, reason; claimed list gifts greyed and not tickable; list gifts no longer shared shown as "No longer shared" and not tickable; "From their list" rows with "Buy it yourself" for gifts that weren't offered; the picks bar (`picksBar`); the over-budget sheet ("Yes, pick it" / "Keep within budget"); "Your budget" when the round has none; "None of these" (only on `awaiting_approval` with no live orders) with the four chips, "Which one?" after "Already has one", optional text, and "No more new ideas this time" when `rejectionOutlook` says so for the chosen chip. "Buy n gifts" links to `/rounds/<id>/buy?ideas=a,b` plus `&over=1` after the sheet.
- `IdeaPhoto({ url, title })`: `<img referrerPolicy="no-referrer" loading="lazy">` or the gift icon.
- Server actions `rejectAction(roundId, form)` and `setBudgetAction(roundId, form)`.

- [ ] **Step 1: Write the failing component tests:**
  - `ticking two ideas shows "2 picked · $60 of $50"`
  - `ticking past the budget opens the sheet; Keep within budget unticks it`
  - `past the allowance the bar says it's over the most you allowed and Buy is disabled`
  - `list gifts come first; a claimed one is greyed and can't be ticked`; `a no-longer-shared one says so and can't be ticked`
  - `a gift that wasn't offered shows Buy it yourself linking to its page`
  - `Already has one asks Which one? before it can be sent`
  - `with no search left the sheet says No more new ideas this time before confirming`
  - `None of these isn't shown on an ordered round`
  - `the photo has referrerpolicy no-referrer; with no url the gift icon shows`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Build the page, screen, actions and photo.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm typecheck`.
- [ ] **Step 5: Commit** `feat: the round screen: list gifts first, pick several, set a budget, or none of these (ALL-29)`.

### Task 12: The confirm page and the fix page (AC-2, AC-4, AC-6, AC-8, AC-10, AC-11, AC-12b, AC-14, AC-15, AC-15a, AC-18, AC-19)

**Files:** create `app/rounds/[id]/buy/page.tsx`, `confirm-screen.tsx`, `app/rounds/[id]/fix/[orderId]/page.tsx`, `fix-screen.tsx`, a shared `over-budget-sheet.tsx`; add `buyAction` and `replaceAction` to `app/rounds/actions.ts`; tests in `app/rounds/__tests__/`.

**Produces:**
- Confirm page: `searchParams: Promise<{ ideas?: string; over?: string }>`, ids parsed as UUIDs (at most the round's idea count). Per AC-4: each idea's photo, title, store and arrive-by; the price with shipping and tax; Zinc's fee per order; the estimated total; "never more than $X" (`capsFor().neverMoreThanCents`); "Ships to" (recipient by default, city and state only for a shared address, the ALL-41 "Where it goes" choices); a gift note limited to `zinc_gift_message_max_chars`; the Zinc balance (`getZincWallet`) and `zincFeeNotice`. One button: "Buy now · about $total", or "Buy anyway · $total" with how far over (AC-8). Ideas that aren't `proposed` show "These ideas were replaced" and no button (AC-12b).
- `buyAction(roundId, form)`: `buyingWiring`, then `approveAndBuy` with `overBudgetConfirmed` only from the over-budget state; shows "Ordered", "Waiting on your Zinc balance", "Price went up", "Someone else got it", "These ideas were replaced", "Busy, try again". `no_address` links to the address form with `?next=` back (**[Verify]** both address forms honour `next`).
- Fix page: for `price_up`, opening it costs nothing; a "Check today's price" button with the money notice calls `checkPriceAction` (`quoteFailedOrder`) and then shows old and new totals with "Buy at about $new" (the form carries `shownTotalCents`); `once`, `unavailable` or a store with no live price shows the next-best idea or "See all ideas". Other failures: what happened in plain words, the next-best idea with "Buy this instead", or "See all ideas". Address failures: "Ship it to me", "Another address", or the person's own address when one is saved and no address is shared (AC-15a). Over the budget, the same over-budget sheet and "Buy anyway" as the round screen (S3). A resolved or replaced order shows what happened instead.
- `checkPriceAction(roundId, orderId)` returns `zinc_off`, with no lookup, when `buyingWiring` gives no purchase (buying is off here), and otherwise calls `quoteFailedOrder`; `replaceAction(roundId, orderId, form)` calls `replaceFailedOrder`.

- [ ] **Step 1: Write the failing component tests:**
  - `the confirm page shows the fee, the total, never more than and the money notice`
  - `an over-budget link reads Buy anyway and says how far over`
  - `the gift note stops at the setting's length`
  - `a replaced idea shows "These ideas were replaced" and no button`
  - `the price_up fix page makes no lookup until Check today's price is tapped, and shows the money notice by it`
  - `after the check it shows old and new totals and carries the shown total`
  - `a fix that goes over the budget asks first and then reads Buy anyway` (S3)
  - `a second price rise shows See all ideas`
  - `an address failure offers me, another address, and their own address only when none is shared`
  - `with no next-best idea the fix page shows See all ideas`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Build the pages and actions.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm typecheck && pnpm build`. Expected: all pass; the build lists the three `/rounds` routes as dynamic.
- [ ] **Step 5: Commit** `feat: the confirm page and the fix page (ALL-29)`.

### Task 13: Browser journeys, layout and gallery (AC-1–AC-4a, AC-6, AC-12, AC-13, AC-13a, AC-14, AC-15, AC-18, AC-19, AC-26–AC-30a)

**Files:** create `e2e/approval.spec.ts`; extend `e2e/fake-zinc.ts` (other stores, store check, product details with `main_image`); add rows to `e2e/gallery.shots.ts`. Rounds and ideas are seeded with the service role (the app can't create them); lists, links and budgets go through the app (`e2e/seed.ts`).

- [ ] **Step 1: Write the journeys (iPhone only):**
  - `Buy this from the heads-up buys in two taps` (one order, the fake places it, "Ordered" shows)
  - `opening a buy link signed out signs in and comes back to the same page`
  - `another account sees only "This gift belongs to another account"`
  - `loading the round, buy and fix pages changes nothing and calls no Zinc` (`request.get` on each; orders, rejections, budgets, facts and rounds unchanged; the fake Zinc's call count unchanged)
  - `two tabs press Buy: one order, the other sees what was bought`
  - `an over-budget pick needs Yes, pick it, and the confirm page says Buy anyway`
  - `None of these saves the reason, the next tick brings new ideas and a second heads-up, and the old Buy this link says replaced` (fake Gateway; tick through `/api/rounds/tick` with the test clock)
  - `None of these with no search left keeps the ideas buyable and sends no email`
  - `a linked list's gifts come first, priced by the fake Zinc, with no AI call when three qualify`; `a claimed one is greyed`; `an unsupported store's gift shows Buy it yourself`; `a check-only store's gift is offered at its list price`
  - `after the list owner stops sharing, its gifts say No longer shared and Buy is refused`
  - `a price_up gift is bought at the new price after Check today's price`
  - `an out_of_stock gift is replaced by the next-best idea`
  - `an ordered round's link says Already ordered and has no Buy button`
- [ ] **Step 2: Write the `@layout` checks:** round screen (with list gifts and "Buy it yourself"), confirm page, fix page, the over-budget sheet and the None of these sheet with "Which one?": `phoneLayoutProblems(page)` is empty, light and dark.
- [ ] **Step 3: Run them.** `pnpm --filter @gifts-af/web e2e -- e2e/approval.spec.ts`. Expected: they fail on Task 10's commit, pass now. Check the exit code.
- [ ] **Step 4: Gallery rows** for the round screen, the confirm page and the fix page; `pnpm gallery` renders them.
- [ ] **Step 5: Commit** `test: approval and list-gift journeys and layout checks (ALL-29)`.

### Task 14: Docs, pages and the PR

- [ ] **Step 1: Decisions** in `design/decisions.md`, next free numbers (T78 onward at the time of writing):
  - Plain app links for the approval pages, revising T38 for them; loading never acts or spends (AC-4a), so the fix page checks a price only on a tap.
  - `replace_failed_order` replaces `reapprove_order` (dropped in a later contract migration): the same-idea rule, once per gift, fixed address for address failures, the buy-time re-quote.
  - List gifts first in rounds, any Zinc-supported store, AI only below `idea_list_min`, at most `idea_list_lookups_max` lookups; the store routes; check-only stores at the list's saved price (owner); "No longer shared"; the new `lists` functions as the concierge's only way into claims and links.
  - Photos from Zinc only, `https://`, no referrer.
  - Revising T73: a budget typed on an open round with none sets that round's budget under the lease.
  - Renamed sends after a rejection; None of these with no search left keeps the ideas.
- [ ] **Step 2: Design and UI docs.** `design/technical-design.md` §6.3 (list gifts first, store routes, photos) and §6.5 (pages, next-best, `replace_failed_order`, re-quote) and §5 (re-generation after a rejection); `design/ui.md` (the approval screens, list gifts and "Buy it yourself", the email's per-idea links); `design/spikes/checkout.md` (the [Verify] answers for store routes); `design/operations.md` (the new events and settings, and that `reapprove_order` and `excluded_products` are unused). No new commands.
- [ ] **Step 3: Pages.** Republish the round engine page (re-generation after a rejection, list-only rounds) and the screens and emails page (`pnpm gallery`), each to its own URL.
- [ ] **Step 4: Verify.** Re-date the migration past `main`'s newest, then `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm build` and `pnpm --filter @gifts-af/web e2e`. All green.
- [ ] **Step 5: PR** titled `feat: approve and buy from the email, list gifts first, none of these, fix a failed gift (ALL-29)`, body `Part of ALL-29`, answering E9: **seeing it work:** `order.approved`, `order.replaced`, `round.ideas_rejected`, `ideas.list_gift` events; **turning it off:** `zinc_ordering_enabled = 0` stops all buying, `round_engine_enabled = 0` stops new rounds and emails, `idea_engine_enabled = 0` stops idea runs (list lookups included), or a Vercel rollback. Run the adversarial review (T55) and read PR feedback (T59).

### Task 15: Switching on in production (AC-20–AC-24; needs the owner)

Not code. Each step needs the owner; none runs without them. Evidence goes on ALL-29 as each passes.

- [ ] **Step 1: Preconditions.** This PR merged and its migration green on dev and prod; ALL-134 merged; the owner's approval to spend on production AI is recorded on the ticket (T75 (4), 2026-11-22).
- [ ] **Step 2: Sandbox order on dev (AC-23, first part).** With the dev Zinc sandbox key, approve one seeded idea; Zinc reports `placed`.
- [ ] **Step 3: Rounds on (AC-20, AC-21).** The owner sets `round_engine_enabled = 1` on prod. It's app-wide; rounds reach only users with `accounts.paid_features` (`round_candidates`), today the test and admin accounts. Next morning, check the Vercel log shows `round_tick` between 12:00 and 12:59 UTC with no errors on `/api/rounds/tick`, and that one real round reached a heads-up with real ideas.
- [ ] **Step 4: Guided questions (AC-22).** The owner opens the questions link from that email on a phone; an answer saves.
- [ ] **Step 5: One real order (AC-23).** With `zinc_ordering_enabled = 1`, the owner buys one cheap gift through "Buy this"; Zinc reports `placed` and the "ordered" email arrives. Delivery is checked in ALL-36.
- [ ] **Step 6: Auto top-up (AC-24). Ask the owner to confirm right before this step; it charges their real card.** Turn auto top-up on with Zinc's $15 minimum and a daily limit of about $30, buy a gift costing more than the balance, see Zinc charge the card and the order go ahead, then turn auto top-up off again.
- [ ] **Step 7:** Tick the boxes and move ALL-29 to Done when nothing is Still open.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test:

| Criterion | Tasks |
|---|---|
| AC-1 | 10, 13 |
| AC-2, AC-3, AC-4, AC-4a | 8, 9, 11, 12, 13 |
| AC-5, AC-6, AC-7, AC-8 | 4, 8, 11, 12, 13 |
| AC-9 | 3, 8, 9, 11 |
| AC-10, AC-11 | 8, 12 |
| AC-12, AC-25 | 3, 4, 6, 9, 11, 13 |
| AC-12a | 1 |
| AC-12b | 1, 2, 8, 12, 13 |
| AC-13 | 3, 7, 13 |
| AC-13a | 3, 9, 11, 13 |
| AC-14, AC-15, AC-15a | 2, 4, 5, 8, 12, 13 |
| AC-16 | 10 |
| AC-17 | 1, 5, 6, 11 |
| AC-18, AC-19 | 1, 8, 9, 12, 13 |
| AC-20 to AC-24 | 15 |
| AC-26 | 13 |
| AC-27, AC-28 | 1, 5, 6, 7, 13 |
| AC-29, AC-30, AC-30a | 1, 2, 5, 8, 9, 11, 13 |
| AC-31 | 1, 6 |

- [x] Every task traces back to a story or criterion (nothing extra).
- [x] Plan review findings and where each is fixed: B1 Tasks 2, 5, 8; B2 Tasks 2, 8; B3 Task 7; S1 Tasks 8, 12; S2 Tasks 2, 8, 12; S3 Task 12; S4 Tasks 9, 11; S5 Tasks 3, 7; S6 Tasks 3, 9, 11; S7 Task 8; nits: status-first mapping Task 8, `active` kept Task 3, `productDetails` called directly and photos never over the cap Task 6, paid check on replace Task 8, regression-guard label Task 1.
- [x] Second plan review: B1 Tasks 1, 6 (lookup cap, save on cost cap, `ideaRunWorstMs`); B2 Tasks 1, 2, 8, 9, 11, 13 (`not_shared`); B3 Task 3 (check after saving facts); S1 Task 3 (deadline rule); S2 Tasks 1, 2, 8 (`already_bought`); S3 Task 1 (`claim_holder`); S4 Tasks 4, 6 (no list titles in facts or prompt); S5 Tasks 8, 12 (price check on a tap); S6 Tasks 6, 7 (`listGiftCandidates`); S7 AC-27, Task 5 (Shopify through product details); S8 Tasks 1, 6 (`idea_list_min`); nits: regression guards Tasks 1, 8, `productDetails` comment Task 5, `excluded_offers` Task 1, one "given" rule AC-31, `selected` ideas rejected Task 3, the ceiling from AI ideas only Task 6.
- [x] No open questions are left (list prices answered by the owner, 2026-11-22).
- [ ] Adversarial review of the spec done, and two of the plan; re-review of this revision still to do.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of what people see (the round screen with list gifts, the confirm page, the fix page, the sheets and the new emails; phone and desktop, light and dark) and the mock-ups, uploaded into the ticket comment.
- [ ] Live checks after deploy (Task 15), or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

The riskiest things no acceptance criterion pins down directly, each with the test that covers it:

1. **A price-up re-buy places at the old price and fails again.** `placeRound` re-checks caps from the idea's estimate, so `replace_failed_order` saves the new total on the idea. Task 2: `a price_up re-buy saves the new total on the idea`; Task 8: `a price_up re-buy places at the new price`, with a fake that refuses any cap below the price.
2. **A failed shared-address gift goes back to the same address.** `placeRound` re-reads the recipient for `ship_to = 'recipient'`, so address re-buys must use a fixed snapshot. Task 2: `an address_rejected order can't ship to the recipient`; Task 8: `… ships to the buyer, with the shared address still present`.
3. **A long list eats the run.** Hundreds of 1¢ lookups would hit the cost cap and the tick's time and save nothing. Task 6: `a 200-item list makes at most idea_list_lookups_max lookups and saves what qualified`.
4. **A list gift is bought after the list stopped being shared.** The saved idea outlives the link. Task 1: `approve_round refuses a list idea after the link is cut`; Task 13's sharing journey.
5. **None of these promises new ideas that can't come.** A turned-off duplicate fact or a near deadline means no new run. Task 3: `at max runs, a fact that duplicates a turned-off one doesn't count`; `the day before the ship-by day there's no new search`.
