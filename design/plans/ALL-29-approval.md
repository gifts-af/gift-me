# ALL-29 Approval: Spec and Plan

**Goal:** a buyer can buy a suggested gift from the heads-up email in two taps, pick several or none of a round's ideas in the app, and fix a gift that hit a problem, and rounds are switched on in production for test and admin users.

**Status:** Spec approved by the owner, 2026-11-22, after its adversarial review (T55) and the owner's six answers.

**Links:** [ALL-29](https://linear.app/allens-forever/issue/ALL-29). Design §4.2, §6.5. PRD A-1, A-3, A-4, B-4, G-2, G-3. Planning decisions 2, 23, 36, 37, 38, 45, 53. Technical decisions T18, T29, T31, T51, T56, T68, T71, T76. Mock-ups: [ALL-29 approval](https://claude.ai/artifact/UB35r46GYrCddcLj2Frxhh) (this ticket, owner approved 2026-11-22) and the signed-off ALL-41 screens [Mom: pick from her list](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#approval), [Dad: suggested ideas](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ideas), [Where it goes](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ship-to) and [Price went up](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#needs-attention).

**Depends on (all merged):** ALL-27 idea engine (#92), ALL-125 fan-out (#95), ALL-116 failure summaries, ALL-32/ALL-30 `approveAndBuy` and Zinc ordering, ALL-112 shared-address failures, ALL-120 base budgets.

**Switching on in production (AC-20) also needs:** ALL-134 (strip contact details from facts before the AI, T75 (3)), built by the owner's session as its own PR during this work (owner, 2026-11-22), and Jim's go-ahead to spend on production AI (T75 (4)).

**Hands off to:** ALL-33 (order tracking reuses the re-approval screen), ALL-36 (end-to-end dry run), ALL-37 (privacy and security pass).

## Spec: what it does

### Who it's for and what they can do

1. **Buy from the email in two taps:** as a buyer, each idea in the heads-up email has its own "Buy this" link. Tap 1 opens a confirm page with everything that will happen (photo, total with the fee, arrival date, where it ships, the money notice). Tap 2 buys it. So a gift I like costs me two taps.
2. **Pick one or more:** as a buyer, the round screen lists the round's ideas, with photo, title, store, full cost, arrive-by date and the reason each fits. I tick one or more and continue to the same confirm page. Ideas from the person's own list say so, and gifts someone else claimed are greyed out (decisions 36, 37).
3. **Over budget only on purpose:** as a buyer, picking the over-budget idea, or picks that add up past the budget, asks me first ("Yes, pick it" / "Keep within budget"). Without that, nothing over budget can be bought, and nothing past the over-budget allowance can be bought at all (B-4, §4.2).
4. **Set a budget where it's first useful:** as a buyer with no budget for this person and occasion, the round screen offers an optional "Your budget" field. What I type is saved as that person's budget for that occasion and marks ideas over it (decision 45, ALL-21).
5. **Choose where it ships and add a note:** as a buyer, the confirm page ships to the recipient by default. I can switch to my own address or another address (D38), and add an optional gift note.
6. **None of these:** as a buyer, I can reject a round's ideas with a reason (chips plus optional text). The reason is saved to what the app knows about the person, the round looks again, and I get new ideas by email, never the same products again (G-3).
7. **Fix a gift that hit a problem:** as a buyer, when a gift's price went up, I can buy it at the new price if that still fits the budget rules, or buy the next-best idea in one tap. When it's out of stock, failed, or its address couldn't be used, I can buy the next-best idea or open all ideas (§6.5 steps 4–5).
8. **Photos on ideas:** as a buyer, every idea card shows the product photo when the store has one.
9. **Rounds on in production:** as the owner, rounds run on production for test and admin users, and one real round goes from start to heads-up to a real order.

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
| AC-12 | A round in `awaiting_approval` with no live orders | The buyer chooses "None of these", picks a reason chip and optionally types more | Under the round lease: a `rejections` row is saved for each idea, each idea becomes `rejected`, and the round goes back to `generating`. "Already has one" saves an `owns` fact; "Not their style" and "Too generic" save an `avoid` fact; the free text is saved as its own fact. Each fact has `source = 'rejection'`, stays under the 500-character limit, and bumps `updated_at` even when the same value already exists, so it counts as new for the idea engine's extra run (ALL-27 AC-9). "Too pricey" saves no fact: the next run searches under the cheapest rejected idea's total. The next run never shows those products again. "None of these" isn't offered on a round in any other state |
| AC-12a | A round whose ideas were all rejected | The next tick runs it | The run starts and saves new ideas: the idea engine counts only ideas that aren't `rejected` when deciding a round already has ideas (`start_idea_run`, `save_ideas`) |
| AC-12b | A rejected idea, or one that isn't `proposed` any more | Someone opens an old "Buy this" link or a stale tab and presses Buy | Nothing is bought: `approve_round` and `replace_failed_order` refuse ideas that aren't `proposed`, and the page says those ideas were replaced |
| AC-13 | A rejected round gets new ideas | The run saves ideas | A new heads-up email goes out with the new ideas. Every send step after a rejection is keyed per idea set (`heads_up:2`, `reminder_1:2`, …), so the new ideas get their own heads-up and reminders. If the run finds nothing, the existing "couldn't get gift ideas" email goes out instead |
| AC-13a | A "None of these" when the round has used all its idea runs | The buyer rejects | The reason is saved, the round stays open until its deadline, and the page and one email say there are no more new ideas this time: pick from the remaining ideas on the person's page or buy it yourself |
| AC-14 | An order failed with `price_up` | The buyer opens the gift's fix page | The page looks up today's price (one product lookup, inside the paid-features check) and shows the old and new totals. "Buy at about $new" replaces the failed order through `replace_failed_order`, with the cap worked out like `approveAndBuy`'s: other orders' committed spend counted, then the budget check (AC-6's deliberate choice if over, refused past the allowance). Once only |
| AC-15 | An order failed with `price_up`, `out_of_stock`, `failed` or `too_late` | The buyer opens the gift's fix page | They see what happened in plain words and the next-best idea (highest-ranked `proposed` idea in the round that can still arrive in time), with "Buy this instead". `replace_failed_order` takes the lease, checks the round is open and before its ship-by date, checks the failed order is unresolved and current, re-checks list claims and that the idea is `proposed`, counts the other picks' committed spend, then resolves the failure and inserts the new order in one transaction. The new order keeps the failed one's ship-to and gift note. With no next-best idea left, they see "See all ideas" |
| AC-15a | An order failed with `address_withdrawn` or `address_rejected` | The buyer opens the gift's fix page | The gift is offered again, not a different one: ship it to the buyer, to another address, or to the person's own address once one is added, read fresh at that moment. It's never sent to the withdrawn or rejected shared address |
| AC-16 | A round in `needs_attention` | Its emails are built | The "needs your attention" email and the `failed_several` summary link each gift to its own re-approval page (ALL-116 `FailedGift.action`), not the person's page. Failures are read from the orders, not `attention_reason` (ALL-116) |
| AC-17 | Ideas are saved by a run | The run resolves each kept idea | The idea gets the product's photo URL (https only) when Zinc has one. Cards and the confirm page show it with `referrerpolicy="no-referrer"`; without one (including gifts from the person's own list) they show the gift icon. Photos come only from Zinc, never a URL the AI wrote |
| AC-18 | A link or page for a round that's no longer open (ordered, skipped, past its deadline) | The buyer opens it | They see what happened ("Already ordered: LEGO Botanical Orchid", "This occasion has passed") and nothing can be bought. Buying twice from two tabs places one order (the `approve_round` lease and guards) |
| AC-19 | Two people or two tabs act on one round at once | Both press Buy | One order set is placed; the other sees what was bought (`claimed`/`busy`) |
| AC-20 | Rounds are switched on in production (moved from ALL-27, decision 53), after ALL-134 ships and Jim approves the AI spend | The owner sets `round_engine_enabled` for test and admin users | One real round goes from start to heads-up email to approval with real ideas. Evidence on this ticket |
| AC-21 | Rounds are on (moved from ALL-28) | The morning cron runs | The production Vercel log shows `round_tick` between 12:00 and 12:59 UTC, with no errors on `/api/rounds/tick` |
| AC-22 | That real round's heads-up or reminder email (moved from ALL-26) | The owner opens the guided-questions link on a phone | The question form opens on production and an answer saves |
| AC-23 | One real order (moved from ALL-32/ALL-30) | With `zinc_ordering_enabled` on, the owner approves one cheap gift on production | The order is placed from the owner's Zinc wallet (Zinc reports `placed`) and the "gift is ordered" email arrives. Delivery is checked in ALL-36 (owner, 2026-11-22). A sandbox order on dev first |
| AC-24 | Auto top-up (moved from ALL-32). Charges the owner's real card, so the owner confirms right before it runs (owner, 2026-11-22) | Turned on only for this test, with Zinc's $15 minimum and a daily limit of about $30, and a gift costing more than the balance | Zinc charges the card and the order goes ahead. Auto top-up goes off again afterwards |
| AC-25 | A rejection reason saved from AC-12 | The person's page is opened, and the next ideas are made | The reason shows under what we know about them, and the next ideas avoid it (ticket AC) |
| AC-26 | A phone and a computer, light and dark | Each new screen is shown | It fits with no sideways scroll, and every tap target is at least 44px (`@layout` tests) |

### Out of scope

- Auto-buy (the `auto_buy` heads-up mode): unchanged here.
- Order tracking, late-risk checks and replacement after shipping: ALL-33, which reuses AC-15's page.
- A daily limit on idea runs per buyer: ALL-132. Sample ideas on dev: ALL-133 (this ticket seeds `gift_ideas` rows in tests instead).
- Opening paid features beyond test and admin users: ALL-135.
- Editing a gift note or ship-to after an order is placed.

### Open questions

None left for the owner. The choices below marked **[Claude's call]** are open to the reviewer and the owner.

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
| What facts a rejection saves | "Already has one" saves `owns`; "Not their style" and "Too generic" save `avoid`; the free text is its own fact. "Too pricey" saves no lasting fact and only lowers the next search's price (AC-12) **Owner, 2026-11-22** | The engine already excludes rejected products (ALL-27 AC-7), so the fact carries only the reason. A price complaint is about this occasion, not the person (T42 (3), "ask, don't infer") |
| Which idea is "next-best" | The highest-ranked `proposed` idea in the round that still arrives in time. Not offered for address failures, which re-offer the same gift with a different address (AC-15a) | §6.5 step 5; no new search needed. For an address failure the gift was fine (T61, ALL-112) |
| How a failed order is replaced | A new database function, `replace_failed_order`, does it in one transaction under the round lease (AC-15). `approve_round` stays for first approvals. Both refuse ideas that aren't `proposed` (AC-12b). New T# | `approve_round` refuses rounds outside `awaiting_approval` and counts an unresolved failure as a live order, so it can't do this. `reapprove_order` takes any price it's given and checks no budget, so it's replaced by the new function |
| Where "Buy at $new" gets the price | One product lookup ($0.01) when the fix page opens, inside the paid-features check. **[Verify]** first whether Zinc's `max_price_exceeded` failure carries the price, and use that if so. **Owner, 2026-11-22** | Nothing records the new price today (`zinc/events.ts` keeps only the failure type) |
| Old email links after "None of these" | Stay valid as plain URLs; the server refuses ideas that were rejected (AC-12b) and the page says they were replaced | Simpler than expiring them; the status check protects the money path |
| What "None of these" does when runs are used up | Saves the reason, keeps the round open until its deadline, and says plainly there are no more new ideas this time (AC-13a). **Owner, 2026-11-22** | ALL-27 caps a round at `idea_round_runs_max` (2) plus one after a new fact, about $1.20 |

## Principles check

- **Simplest version?** Plain app pages instead of new signed-link kinds; the confirm page serves one or many ideas; re-approval is one page for every failure kind. Cut: a separate ship-to step, an immediate new search after "None of these".
- **Hard-coded values?** None new. The fee, over-budget allowance, gift-note length, price margin and run cap are existing settings.
- **Product boundaries?** All in `modules/concierge`. Budgets and facts are concierge tables. Claimed list gifts come through `lists.person_list` (T19).
- **New personal data?** `gift_ideas.image_url` (a product photo, not personal). A gift note is already an `orders` column. Events carry ids only (E6).
- **Docs and decisions** that need updating: `design/technical-design.md` §6.5 (plain links, next-best, photos, `replace_failed_order`), `design/decisions.md` (a new T# for plain app links revising T38, `replace_failed_order`, photos, and AC-9's revision of T73), `design/ui.md` (the approval screens and the email's per-idea links), the round engine page (re-generation after a rejection), the screens and emails page.

## Plan

To be written after the spec's adversarial review.

## Review focus

To be filled with the plan.
