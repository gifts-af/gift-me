# ALL-29 Approval: Spec and Plan

**Goal:** a buyer can buy a suggested gift from the heads-up email in two taps, pick several or none of a round's ideas in the app, and fix a gift that hit a problem, and rounds are switched on in production for test and admin users.

**Status:** Spec approved by the owner, 2026-11-22, after its adversarial review (T55) and the owner's six answers.

**Links:** [ALL-29](https://linear.app/allens-forever/issue/ALL-29). Design §4.2, §6.5. PRD A-1, A-3, A-4, B-4, G-2, G-3. Planning decisions 2, 23, 36, 37, 38, 45, 53. Technical decisions T18, T29, T31, T51, T56, T68, T71, T76. Mock-ups: [ALL-29 approval](https://claude.ai/artifact/UB35r46GYrCddcLj2Frxhh) (this ticket, owner approved 2026-11-22) and the signed-off ALL-41 screens [Mom: pick from her list](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#approval), [Dad: suggested ideas](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ideas), [Where it goes](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#ship-to) and [Price went up](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#needs-attention).

**Depends on (all merged):** ALL-27 idea engine (#92), ALL-125 fan-out (#95), ALL-116 failure summaries, ALL-32/ALL-30 `approveAndBuy` and Zinc ordering, ALL-112 shared-address failures, ALL-120 base budgets.

**Switching on in production (AC-20) also needs:** ALL-134 (strip contact details from facts before the AI, T75 (3)), built by the owner's session as its own PR during this work (owner, 2026-11-22), and the owner's approval to spend on production AI (T75 (4)), given 2026-11-22.

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
| AC-12b | A rejected idea, or one that isn't `proposed` any more | Someone opens an old "Buy this" link or a stale tab and presses Buy | Nothing is bought: `approve_round` and `replace_failed_order` refuse ideas that aren't `proposed` (except, for `replace_failed_order`, the failed order's own idea, which is `selected`, when it's re-bought at a new price (AC-14) or to a new address (AC-15a)), and the page says those ideas were replaced |
| AC-13 | A rejected round gets new ideas | The run saves ideas | A new heads-up email goes out with the new ideas. Every send step after a rejection is keyed per idea set (`heads_up:2`, `reminder_1:2`, …), so the new ideas get their own heads-up and reminders. If the run finds nothing, the existing "couldn't get gift ideas" email goes out instead |
| AC-13a | A "None of these" when the round has used all its idea runs | The buyer rejects | The reason is saved, the round stays open until its deadline, and the page and one email say there are no more new ideas this time: pick from the remaining ideas on the person's page or buy it yourself |
| AC-14 | An order failed with `price_up` | The buyer opens the gift's fix page | The page looks up today's price (one product lookup, inside the paid-features check) and shows the old and new totals. "Buy at about $new" replaces the failed order through `replace_failed_order`, with the cap worked out like `approveAndBuy`'s: other orders' committed spend counted, then the budget check (AC-6's deliberate choice if over, refused past the allowance). Once only |
| AC-15 | An order failed with `price_up`, `out_of_stock`, `failed` or `too_late` | The buyer opens the gift's fix page | They see what happened in plain words and the next-best idea (highest-ranked `proposed` idea in the round that can still arrive in time), with "Buy this instead". `replace_failed_order` takes the lease, checks the round is open and before its ship-by date, checks the failed order is unresolved and current, re-checks list claims and that the idea is `proposed`, counts the other picks' committed spend, then resolves the failure and inserts the new order in one transaction. The new order keeps the failed one's ship-to and gift note. With no next-best idea left, they see "See all ideas" |
| AC-15a | An order failed with `address_withdrawn` or `address_rejected` | The buyer opens the gift's fix page | The gift is offered again, not a different one: ship it to the buyer, to another address, or to the person's own address once one is added, read fresh at that moment. It's never sent to the withdrawn or rejected shared address |
| AC-16 | A round in `needs_attention` | Its emails are built | The "needs your attention" email and the `failed_several` summary link each gift to its own re-approval page (ALL-116 `FailedGift.action`), not the person's page. Failures are read from the orders, not `attention_reason` (ALL-116) |
| AC-17 | Ideas are saved by a run | The run resolves each kept idea | The idea gets the product's photo URL (https only) when Zinc has one. Cards and the confirm page show it with `referrerpolicy="no-referrer"`; without one (including gifts from the person's own list) they show the gift icon. Photos come only from Zinc, never a URL the AI wrote |
| AC-18 | A link or page for a round that's no longer open (ordered, skipped, past its deadline) | The buyer opens it | They see what happened ("Already ordered: LEGO Botanical Orchid", "This occasion has passed") and nothing can be bought. Buying twice from two tabs places one order (the `approve_round` lease and guards) |
| AC-19 | Two people or two tabs act on one round at once | Both press Buy | One order set is placed; the other sees what was bought (`claimed`/`busy`) |
| AC-20 | Rounds are switched on in production (moved from ALL-27, decision 53), after ALL-134 ships (the owner approved the AI spend, 2026-11-22) | The owner sets `round_engine_enabled` (app-wide; rounds reach only test and admin users through the paid-features flag) | One real round goes from start to heads-up email to approval with real ideas. Evidence on this ticket |
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

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture:**
- **The database guards money.** One new migration adds a photo column, an idea-set counter and a re-quote column, makes the idea engine ignore rejected ideas, makes `approve_round` refuse ideas that aren't `proposed`, and adds three service-role functions that run under the round lease: `replace_failed_order`, `reject_round_ideas` and `set_round_budget`.
- **Thin TypeScript wrappers** in `modules/concierge` call them: `approveAndBuy` (changed), `replaceFailedOrder`, `rejectRoundIdeas`, `setRoundBudget`, and the page reads. Pure rules (rejection facts, next-best idea, the picks bar) live in `packages/core`.
- **The engine** keys its approval emails per idea set, gives the next run a price ceiling after "Too pricey", sends one "no more ideas" email, and saves photos while resolving.
- **Three plain app pages** (`/rounds/[id]`, `/rounds/[id]/buy`, `/rounds/[id]/fix/[orderId]`) only read; every change goes through a server action in `app/rounds/actions.ts`.

**Tech stack:** Next.js 16 (server components, server actions, `searchParams` as a promise), Supabase (Postgres, RLS, pgTAP), Vitest (`unit` and `local-db` projects), Playwright, the fake Zinc and fake Gateway.

**Branch:** `aarontallen/all-29-approval`, cut from `main` at the start of Task 1. One PR (`Part of ALL-29`, since Task 14 follows the merge). The migration ships with the code: it only adds things and tightens guards that today's code never trips, so a Vercel rollback runs the old code on the new schema safely (E7).

### Global constraints

- **Settings, not constants (T23):** `zinc_order_fee_cents`, `order_price_margin_pct`, `zinc_gift_message_max_chars`, `accounts.over_budget_pct`, `idea_round_runs_max`, `zinc_lookup_cents` and `round_lock_minutes` are read, never copied into code. No new settings. The 500-character fact limit is the `profile_facts` check; the form mirrors it from one exported constant next to the parser, with a test that it equals the database's limit.
- **Loading never acts (AC-4a):** the three pages only read. Buying, rejecting, saving a budget and replacing happen only in server actions, each of which checks the signed-in user owns the round, validates its input with zod, and returns only what the screen renders (Next's `server-actions.md` > Security). The fix page's one price lookup is a read: it writes only `orders.requote_total_cents`, never an order.
- **Explicit dependencies (E3):** module logic takes its clients and settings as arguments. Only the server actions and pages build them, through `buyingWiring` and the on-demand idea wiring in `app/settings/zinc-deps.ts`.
- **Events (E6):** through `logEvent`, ids only: `round_id`, `user_id`, `order_id`, `idea_id`, counts, cents, reason codes. Never a gift note, free-text reason, title, address or photo URL. New events: `round.ideas_rejected`, `round.budget_set`, `order.replaced`, `order.requoted`.
- **Photos (AC-17):** only from Zinc, `https://` only (checked in the adapter and by a column check), shown with `referrerpolicy="no-referrer"`; the gift icon otherwise.
- **Phones (AC-26):** every new screen fits at phone width with no sideways scroll, and every tap target is at least 44px (`MIN_TAP_PX` in `e2e/phone-layout.ts`). Layout checks are short `@layout` tests; journeys stay untagged (T62). Sign in with `signIn(page)`.
- **Reads on column-granted tables:** signed-in reads of `gift_rounds`, `orders` and `accounts` name their columns (no `select('*')`). The new columns (`idea_set`, `requote_total_cents`) stay server-only.
- **Migration:** one file, `supabase/migrations/20261122100000_approval.sql`, re-dated past `main`'s newest just before merge. Expand-only (E7): `reapprove_order` stays until a later contract migration, unused. Don't push it to dev before merge. Run `pnpm db:types` after it changes.
- **Fakes (E5):** the database is always real for money, rounds and privacy (pgTAP, `pnpm test:db`, Playwright on local Supabase). Zinc, the AI Gateway and email are faked.
- **Before the PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm build`, then `pnpm --filter @gifts-af/web e2e`.

### File map

| File | Change |
|---|---|
| `supabase/migrations/20261122100000_approval.sql` | New: columns, idea counting, `approve_round` guard, three functions |
| `supabase/tests/approval.test.sql` | New pgTAP |
| `packages/core/src/approval.ts` (+ `index.ts`, test) | New: `rejectionFacts`, `nextBestIdea`, `picksBar` |
| `packages/core/src/round-plan.ts`, `ideas.ts` | Per-set keys, `no_more_ideas`; `JudgeContext.maxTotalCents`, `ZincHit.imageUrl` |
| `packages/core/src/database.types.ts` | Regenerated |
| `apps/web/modules/concierge/purchase/{approve,replace,store}.ts` | `approveAndBuy` changes; new `replaceFailedOrder`, `requote` |
| `apps/web/modules/concierge/rounds/{approval,engine,store}.ts` | New `rejectRoundIdeas`, `setRoundBudget`, `roundForBuyer`; engine per-set keys |
| `apps/web/modules/concierge/ideas/{run,store}.ts`, `zinc/products.ts` | Price ceiling; photos |
| `apps/web/modules/concierge/notify/{templates,samples}.ts`, `lib/email-layout.ts` | Per-row links; buy links; fix links; `no_more_ideas` |
| `apps/web/app/rounds/…` | New pages, screens, actions |
| `apps/web/components/idea-photo.tsx` | New: the photo or the gift icon |
| `apps/web/app/people/[id]/ideas/ideas-screen.tsx` | Photos on idea cards |
| `apps/web/e2e/{approval.spec,fake-zinc,gallery.shots}.ts` | Journeys, layout, photos, gallery |

---

### Task 1: Ideas that count, and `approve_round` refuses replaced ideas (AC-12a, AC-12b, AC-17)

**Files:** create the migration and `supabase/tests/approval.test.sql`.

**Produces:**
- `gift_ideas.image_url text` with `check (image_url is null or image_url ~ '^https://')`. Readable by signed-in owners (the table has no column grants).
- `gift_rounds.idea_set integer not null default 1 check (idea_set >= 1)`: which set of ideas the round is on. Server-only (not in the column grant).
- `start_idea_run`: re-created from `20261121140000_round_fanout.sql`; `done` only when the round has an idea whose `status <> 'rejected'`.
- `save_ideas`: re-created from `20261117100000_idea_engine.sql`; the same rule, and it inserts `image_url`.
- `approve_round`: re-created from `20261113100000_order_address_source.sql`, adding after the "isn't this round's" check: any idea with `status <> 'proposed'` raises `approve_round: replaced` (P0001).

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `start_idea_run starts a round whose ideas were all rejected` (returns a run id, refusal null)
  - `start_idea_run still says done when one idea is proposed`
  - `save_ideas saves into a round whose ideas were all rejected` (returns 3)
  - `save_ideas keeps image_url`
  - `image_url refuses http://` (`throws_ok`, 23514)
  - `approve_round refuses a rejected idea` (`throws_ok` … `approve_round: replaced`)
  - `approve_round refuses a selected idea`
  - `authenticated can read image_url but not idea_set`
- [ ] **Step 2: Watch them fail.** `pnpm db:test`. Expected: `approval.test.sql` fails (columns missing).
- [ ] **Step 3: Write this part of the migration.**
- [ ] **Step 4: Watch them pass.** `pnpm supabase db reset && pnpm db:test`. Expected: all files pass, including `idea_engine.test.sql` and `approve_round_guards.test.sql` unchanged.
- [ ] **Step 5: Commit** `feat(db): rejected ideas don't count, and approval refuses replaced ideas (ALL-29)`.

### Task 2: `replace_failed_order` (AC-14, AC-15, AC-15a, AC-12b)

**Files:** the migration and `approval.test.sql`.

**Produces:**
- `orders.requote_total_cents integer check (requote_total_cents >= 0)`: today's estimated total for a `price_up` order, written by the fix page's lookup. Server-only.
- `concierge.replace_failed_order(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_failed_order_id uuid, p_order jsonb) returns setof concierge.orders`. `p_order` has the shape of one `approve_round` element (`idea_id`, `max_price_cents`, `fee_cents`, `gift_message`, `ship_to`, `address_source`, `address`). Security definer, `search_path = ''`, service_role only. In order, each refusal a P0001 starting `replace_failed_order:`:
  1. Round locked `for update`, the user's, `locked_until = p_lock` (`lease not held`).
  2. `closed_at is null`, status `needs_attention`, and the UTC day before `ship_by_deadline` (`not open`).
  3. The failed order is this round's and user's, `status = 'failed'`, `not resolved` (`not current`).
  4. The idea is this round's and either `proposed`, or the failed order's own idea when `failure_type in ('price_up', 'address_withdrawn', 'address_rejected')` (`replaced`).
  5. For `address_withdrawn` and `address_rejected`, `address_source` must not be `shared` (`shared address`).
  6. The list claim check and `lists.claim_for_order`, as in `approve_round` (`claimed`).
  7. Then: `resolved = true` on the failed order, insert the new `held`/`retry` order and its `order_addresses` row, set the idea `selected`, `reconcile_round`, return the new order.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `replace_failed_order replaces an out_of_stock order with a proposed idea` (old `resolved`, new `held`, idea `selected`)
  - `the new order keeps the gift note and ship_to it was given`
  - `a price_up order can be re-bought as the same idea`
  - `an out_of_stock order can't be re-bought as the same idea` (`replaced`)
  - `a rejected idea is refused` (`replaced`)
  - `an address_rejected order is never sent to a shared address` (`shared address`)
  - `an address_rejected order can go to the buyer` (`ship_to = 'buyer'`, `address_source = 'own'`)
  - `a second replace of the same failed order is refused` (`not current`)
  - `a closed round is refused`; `on the ship-by day it's refused`
  - `without the lease it's refused`
  - `another user's round is refused`
  - `a list gift a friend claimed is refused` (`claimed`)
  - `anon and authenticated can't execute it`
- [ ] **Step 2: Watch them fail.** `pnpm db:test`. Expected: the new tests fail (function missing).
- [ ] **Step 3: Write it.**
- [ ] **Step 4: Watch them pass.** `pnpm supabase db reset && pnpm db:test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(db): replace a failed order under the round lease (ALL-29)`.

### Task 3: Reject a round's ideas, and set an open round's budget (AC-9, AC-12, AC-13a)

**Files:** the migration, `approval.test.sql`; then regenerate `packages/core/src/database.types.ts`.

**Produces:**
- `concierge.reject_round_ideas(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_reason_code text, p_reason_text text, p_facts jsonb) returns table (idea_set integer, runs_left boolean)`. Service_role only.
  - Refuses (P0001 `reject_round_ideas: …`): lease not held; status not `awaiting_approval` or closed; any live order (not `cancelled`, not a resolved failure); `p_reason_code` not in (`has_it`, `not_style`, `too_pricey`, `too_generic`); a fact whose category isn't `owns` or `avoid`.
  - Inserts one `rejections` row per `proposed` idea (`reason_code`, `reason_text`), sets those ideas `rejected`.
  - Upserts each `p_facts` element (`{category, value}`) as `source = 'rejection'`, `on conflict (person_id, category, value_key) do update set updated_at = now(), active = true`.
  - Sets the round `status = 'generating'`, `idea_set = idea_set + 1`, `next_action_at = now()`.
  - Returns the new `idea_set` and `round_idea_state(p_round_id).runs_left`, read after the facts are saved.
- `concierge.set_round_budget(p_round_id uuid, p_user_id uuid, p_lock timestamptz, p_budget_cents integer) returns void`. Service_role only. Refuses: lease not held; status not `awaiting_approval`; `budget_cents` already set (`already set`); a negative amount. Sets `budget_cents`, then `over_budget = est_total_cents > p_budget_cents` on the round's `proposed` ideas.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `reject_round_ideas saves a rejection per idea and marks them rejected`
  - `the round goes back to generating, due now, on idea set 2`
  - `a fact that already exists has its updated_at bumped` (`updated_at > before`, one row)
  - `the bumped fact allows one more run` (`runs_left` true after `idea_round_runs_max` runs)
  - `too_pricey with no facts and no runs left returns runs_left false`
  - `a 501-character fact is refused` (23514)
  - `a round with a live order can't be rejected`
  - `a needs_attention round can't be rejected`
  - `an unknown reason code is refused`
  - `set_round_budget sets the budget and marks ideas over it` (5000: a 6000 idea `over_budget`, a 4000 idea not)
  - `set_round_budget refuses a round that already has a budget`
  - `without the lease both are refused`
  - `anon and authenticated can't execute either`
- [ ] **Step 2: Watch them fail.** `pnpm db:test`. Expected: the new tests fail.
- [ ] **Step 3: Write them.**
- [ ] **Step 4: Watch them pass, then regenerate types.** `pnpm supabase db reset && pnpm db:test && pnpm db:types`. Expected: all pass; `database.types.ts` gains the columns and functions.
- [ ] **Step 5: Commit** `feat(db): reject a round's ideas and set an open round's budget (ALL-29)`.

### Task 4: Pure rules for the screens [P] (AC-5, AC-6, AC-7, AC-12, AC-15)

Can run alongside Tasks 1–3.

**Files:** create `packages/core/src/approval.ts` and `approval.test.ts`; export from `index.ts`.

**Produces:**
- `type RejectionCode = "has_it" | "not_style" | "too_pricey" | "too_generic"`.
- `rejectionFacts(code: RejectionCode, text: string | null, titles: string[]): { category: "owns" | "avoid"; value: string }[]`: `has_it` → `owns`, `not_style` and `too_generic` → `avoid`, `too_pricey` → none; the free text, trimmed, as its own `avoid` fact. Values come from the titles as written in the owner decision below (**[Claude's call]** pending it); each value is cut to `FACT_VALUE_MAX` (500).
- `nextBestIdea(ideas: { id; rank; status; handlingDaysMax; deliveryDaysMax }[], ctx: { today; occasionDate; s: ScheduleSettings }): string | null`: the lowest `rank` that is `proposed` and passes `canArriveInTime`.
- `picksBar(totals: number[], budgetCents: number | null, overBudgetPct: number): { count; totalCents; fit: BudgetFit }`, built on `classifyTotal`.

- [ ] **Step 1: Write the failing tests:**
  - `has_it saves owns, not_style and too_generic save avoid, too_pricey saves nothing`
  - `the free text is its own fact, trimmed; blank text adds nothing`
  - `a value is never longer than 500 characters`
  - `next-best skips rejected, selected and too-slow ideas and takes the lowest rank`
  - `no next-best when nothing proposed can arrive in time` (null)
  - `picksBar: 2 picks of $30 against $50 at 20% are over; against $70 within; 3 of $30 dropped`
- [ ] **Step 2: Watch them fail.** `pnpm --filter @gifts-af/core test`. Expected: module not found.
- [ ] **Step 3: Write `approval.ts`.**
- [ ] **Step 4: Watch them pass.** Same command. Expected: all pass.
- [ ] **Step 5: Commit** `feat: rules for picks, rejections and next-best ideas (ALL-29)`.

### Task 5: Buying and replacing in TypeScript (AC-2, AC-6–AC-11, AC-12b, AC-14, AC-15, AC-15a, AC-18, AC-19)

**Files:** `modules/concierge/purchase/approve.ts`, `store.ts`, new `replace.ts`; `__tests__/purchase.test.ts` (local-db), new `__tests__/replace.test.ts` (local-db); export through `modules/concierge/index.ts`.

**Consumes:** Tasks 1–2 functions; `sequentialCaps` and `placeRound` from `place.ts`; `committedSpendCents`, `classifyTotal` from core.

**Produces:**
- `ApproveInput` gains `shipTo?: ShipTo`, with `type ShipTo = { kind: "recipient" } | { kind: "buyer" } | { kind: "other"; address: AddressDraft; saveToPerson: boolean }`. `buyer` reads `public.account_addresses` with the service-role client (`address_source = 'own'`); `other` checks `isShippableAddress`.
- `ApproveError` gains `"replaced"` (from `approve_round: replaced`).
- `approveAndBuy` reads the round again **after** `claimRoundNow` and computes caps from that read (AC-9).
- `capsFor(round: RoundRow, totals: number[], account: Account, confirmed: boolean, settings, committedCents: number): { caps: number[]; neverMoreThanCents: number } | ApproveError`, shared by `approveAndBuy`, `replaceFailedOrder` and the confirm page's preview.
- `requote(input: { userId; roundId; orderId }, deps: PurchaseDeps & { lookup: { http: ZincHttp; key: string } }): Promise<{ oldCents; newCents } | "not_allowed" | "unavailable">`: inside `hasPaidFeatures`, one `productOffers` call, `pickOffer`, `estimatedTotalCents`; writes `requote_total_cents`; logs `order.requoted`. Only for an unresolved `price_up` order.
- `replaceFailedOrder(input: { userId; roundId; failedOrderId; ideaId; shipTo?: ShipTo; overBudgetConfirmed?: boolean }, deps: PurchaseDeps): Promise<ApproveResult>`: lease, re-read, committed spend of the other live orders, budget check (AC-6 rules), caps, `replace_failed_order`, `placeRound`, the same "tell the customer" step as `approveAndBuy`. A `price_up` re-buy uses `requote_total_cents` as its total and refuses without one (`not_found`). Keeps the failed order's `gift_message` and `ship_to` unless `shipTo` is given (address failures).

- [ ] **Step 1: Write the failing local-db tests:**
  - `a budget saved while approveAndBuy waits for the lease caps the order at the new budget`
  - `ships to the buyer's own address when asked` (`ship_to = 'buyer'`, the snapshot is the account address)
  - `another address is saved to the person when asked`
  - `a rejected idea returns replaced and places nothing`
  - `a gift note over zinc_gift_message_max_chars is refused`
  - `requote writes today's total and makes one Zinc call` (fake Zinc call count 1)
  - `requote without paid features makes no Zinc call`
  - `replace at the new price places one order capped from the re-quote, and a second replace is refused`
  - `replace counts the round's other placed order against the budget` (a $30 placed order and $25 next-best against $50 → `needs_confirmation`)
  - `replace past the over-budget allowance is refused` (`over_budget`)
  - `an address_rejected order replaced to the buyer places; to the shared address it's refused`
  - `two replaces at once: one order, the other busy`
- [ ] **Step 2: Watch them fail.** `pnpm test:db`. Expected: the new tests fail.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test:db`. Expected: all pass, including the existing `purchase.test.ts`.
- [ ] **Step 5: Commit** `feat: buy with a ship-to choice and replace a failed gift (ALL-29)`.

### Task 6: Rejecting, the open round's budget, and page reads [P with Task 5] (AC-3, AC-9, AC-12, AC-13a, AC-18, AC-25)

**Files:** new `modules/concierge/rounds/approval.ts`, `__tests__/approval-db.test.ts` (local-db); export through `index.ts`.

**Produces:**
- `rejectRoundIdeas(input: { userId; roundId; code: RejectionCode; text: string | null }, deps: ZincDeps): Promise<{ ok: true; runsLeft: boolean } | { ok: false; error: "not_found" | "busy" | "not_open" | "too_long" }>`: lease via `claimRoundNow`/`withLease`, `rejectionFacts` from the proposed ideas' titles, `reject_round_ideas`; logs `round.ideas_rejected` with the code and count only. Doesn't call `advanceRound`: the next tick runs ideas.
- `setRoundBudget(input: { userId; roundId; budgetCents: number }, userDb, deps: ZincDeps): Promise<"saved" | "busy" | "already_set" | "not_open">`: `save_budgets` as the user (the round's occasion kind), then `set_round_budget` under the lease; logs `round.budget_set`.
- `roundForBuyer(roundId: string, viewerId: string, deps): Promise<{ kind: "mine"; view: RoundPageView } | { kind: "other" } | { kind: "missing" }>`: one service-role read that tells the owner from anyone else and returns nothing about another account's round. `RoundPageView` carries the round (status, budget, deadline, occasion), its ideas (with `imageUrl`, `source`, claimed), live and failed orders, the next-best idea, and `closedText` for AC-18.

- [ ] **Step 1: Write the failing local-db tests:**
  - `None of these saves the reason and the facts and sends the round back to generating`
  - `a busy round returns busy and changes nothing`
  - `rejecting after an order was placed returns not_open`
  - `the saved reason shows in activeFacts for the person` (AC-25)
  - `a budget typed on the round is saved for the person and the occasion, and sets the round's budget`
  - `roundForBuyer tells another account only "other"` (no ids, titles or names in the result)
  - `an ordered round's view says what was ordered`; `a past round says the occasion has passed`
- [ ] **Step 2: Watch them fail.** `pnpm test:db`.
- [ ] **Step 3: Write `approval.ts`.**
- [ ] **Step 4: Watch them pass.** `pnpm test:db`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: reject a round's ideas and set its budget from the round screen (ALL-29)`.

### Task 7: The engine after a rejection (AC-13, AC-13a)

**Files:** `packages/core/src/round-plan.ts` and its test; `modules/concierge/rounds/{engine,store}.ts`, `notify/templates.ts`, `__tests__/round-engine.test.ts`.

**Produces:**
- `StepKey` adds `` `${SetStep}:${number}` `` with `SetStep = "heads_up" | "reminder_1" | "reminder_2" | "final_notice" | "no_ideas" | "no_ideas_again" | "no_more_ideas"`.
- `setKey(step: SetStep, ideaSet: number): StepKey`: set 1 keeps the bare key, so rounds already running are unchanged; set 2 and later get `:n`.
- `RoundView.ideaSet: number` and `ranSinceRejection: boolean` (an idea run started after the round's latest `rejections.created_at`). `nextAction` keys the approval schedule and `noIdeasAction` through `setKey`. When `ideaSet > 1`, `!ideaRunsLeft` and `!ranSinceRejection`, it sends `setKey("no_more_ideas", n)` once.
- `ClaimedRound.ideaSet` from `gift_rounds.idea_set`; `RoundContext.ranSinceRejection`; `ranSinceNoIdeas` reads the set's own `no_ideas` key.
- The engine's `sendHeadsUp`, `emailStep` and the skip rule ("was the buyer told anything?") use the set's keys.
- New template `no_more_ideas: { personName }` with links `{ open: person page }`: "There are no more new ideas this time. Pick from the ideas on {name}'s page, or buy something yourself."

- [ ] **Step 1: Write the failing tests:**
  - round-plan: `after a rejection, set 2 sends heads_up:2 though heads_up was sent`
  - `reminder_1 from set 1 doesn't stop reminder_1:2`
  - `set 1 keys are unchanged` (existing tests pass as they are)
  - `set 2 with no runs left and no run since the rejection sends no_more_ideas:2, once`
  - `set 2 whose run found nothing sends no_ideas:2`
  - engine (fake store): `a rejected round runs ideas on the next tick and sends a second heads-up with the new ideas`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm test:db`. Expected: all pass, including `fanout-db.test.ts`.
- [ ] **Step 5: Commit** `feat: new ideas, and their own emails, after None of these (ALL-29)`.

### Task 8: Too-pricey ceiling and photos in the idea run [P with Task 7] (AC-12, AC-17)

**Files:** `packages/core/src/ideas.ts` and test; `modules/concierge/zinc/products.ts`, `ideas/{run,store}.ts`; `__tests__/{zinc-products,idea-run,idea-store}.test.ts`; `e2e/fake-zinc.ts`.

**Produces:**
- `ZincHit.imageUrl: string | null`, read from the search hit's image field when it's `https://` (**[Verify]** the field name against the first recorded search reply; `null` until then).
- `productPhoto(h, key, productId, signal): Promise<string | null>`, exported from `products.ts`, wrapping `productDetails`' `imageUrl`. The run calls it once per kept idea that has no photo, after ranking, counting `zinc_lookup_cents` against `idea_run_max_cents` like every other lookup; a failure leaves the photo null.
- `SavedIdea.imageUrl`; `save()` sends `image_url`.
- `IdeaInputs.round.maxTotalCents: number | null`: the lowest `est_total_cents` among the round's ideas rejected with `too_pricey` in its latest rejection. `JudgeContext.maxTotalCents`: a total at or above it drops as `over_limit`; the brainstorm's budget is `min(budget, maxTotalCents)`.

- [ ] **Step 1: Write the failing tests:**
  - `judgeCandidate drops a total at or above maxTotalCents`
  - `searchProducts keeps an https image and drops an http one`
  - `a kept idea without a search photo gets one from product details, counted at zinc_lookup_cents`
  - `a failed photo lookup keeps the idea, with no photo`
  - `the run after Too pricey uses the cheapest rejected total as its ceiling` (idea-store, local-db)
- [ ] **Step 2: Watch them fail.** `pnpm test && pnpm test:db`.
- [ ] **Step 3: Write the changes; the fake Zinc's product details answer with a `main_image`.**
- [ ] **Step 4: Watch them pass.** Same commands. Expected: all pass.
- [ ] **Step 5: Commit** `feat: product photos on ideas, and a lower price after Too pricey (ALL-29)`.

### Task 9: Emails link to the new pages [P with Tasks 7–8] (AC-1, AC-16)

**Files:** `lib/email-layout.ts` and `lib/__tests__/email-layout.test.ts`; `modules/concierge/notify/{templates,samples}.ts`; `rounds/engine.ts`; `__tests__/{templates,samples}.test.ts`.

**Produces:**
- `EmailParts.rows[]` gains `link?: { label: string; url: string }`: an anchor under the row's detail, 44px tall like the other plain links; the text version prints `label: url` under the row.
- `IdeaRow` gains `arriveBy: string` and `reason: string`; `TemplateLinks.heads_up | reminder | final_notice` become `{ choose: string; questions?: string; [buy: `buy${number}`]: string }`, the `who_is_this` pattern. Each row's link is "Buy this". The button reads "Pick several or none of these" and opens `/rounds/<id>`.
- The engine passes plain links (`LinkSpec` `{ path }`): `buy<i>` → `/rounds/<id>/buy?ideas=<ideaId>`, `choose` → `/rounds/<id>`. Ideas come from `RoundContext.ideas`, which gains `id`, `arriveBy` and `reason`.
- `sendOpenFailures` and `failed_several`: each `FailedGift` gains `url`, `/rounds/<id>/fix/<orderId>`; the single-failure emails' button opens that page too. The auto-buy heads-up keeps its current links.

- [ ] **Step 1: Write the failing tests:**
  - `a row with a link renders it as an anchor and in the text version`
  - `the heads-up has a Buy this link per idea and one button to the round screen` (3 ideas → 3 `/buy?ideas=` URLs, 1 `/rounds/<id>` button)
  - `reminder and final notice carry the same links`
  - `failed_several links each gift to its own fix page`
  - `a single price_up email opens that order's fix page`
  - `the samples render every kind` (adds `no_more_ideas`)
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Write the changes.**
- [ ] **Step 4: Watch them pass.** `pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Buy this links in the approval emails, and failure links to each gift (ALL-29)`.

### Task 10: The round screen (AC-3, AC-5, AC-6, AC-7, AC-9, AC-12, AC-13a, AC-17, AC-18)

**Files:** create `apps/web/app/rounds/[id]/page.tsx`, `round-screen.tsx`, `app/rounds/actions.ts`, `app/rounds/access.tsx` (signed-out and wrong-account states), `components/idea-photo.tsx`; tests in `app/rounds/__tests__/round-screen.test.tsx`; photos in `app/people/[id]/ideas/ideas-screen.tsx`.

**Produces:**
- Page: `params: Promise<{ id: string }>`; `roundForBuyer` decides the state. Signed out is handled by `proxy.ts` (`signInRedirect` keeps the path and query). "other" shows "This gift belongs to another account" and nothing else.
- `RoundScreen`: idea cards (photo, title, store, total, arrive-by, reason; "From their list" for `source = 'list'`; claimed list gifts greyed and not tickable); the picks bar (`picksBar`); the over-budget sheet ("Yes, pick it" / "Keep within budget"); "Your budget" when the round has none; "None of these" with the four chips (`Already has one`, `Not their style`, `Too pricey`, `Too generic`) and optional text, only on `awaiting_approval` with no live orders. "Buy n gifts" links to `/rounds/<id>/buy?ideas=a,b` plus `&over=1` after the sheet.
- `IdeaPhoto({ url, title })`: `<img referrerPolicy="no-referrer" loading="lazy">` or the gift icon.
- Server actions: `rejectAction(roundId, form)` and `setBudgetAction(roundId, form)`, each re-reading the user from the session and validating with zod.

- [ ] **Step 1: Write the failing component tests:**
  - `ticking two ideas shows "2 picked · $60 of $50"`
  - `ticking past the budget opens the sheet; Keep within budget unticks it`
  - `past the allowance the bar says it's over the most you allowed and Buy is disabled`
  - `a claimed list gift is greyed and can't be ticked`
  - `None of these isn't shown on an ordered round`
  - `with no runs left the page says there are no more new ideas this time`
  - `the photo has referrerpolicy no-referrer; with no url the gift icon shows`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Build the page, screen, actions and photo.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the round screen: pick several, set a budget, or none of these (ALL-29)`.

### Task 11: The confirm page and the fix page (AC-2, AC-4, AC-8, AC-10, AC-11, AC-12b, AC-14, AC-15, AC-15a, AC-18, AC-19)

**Files:** create `app/rounds/[id]/buy/page.tsx`, `confirm-screen.tsx`, `app/rounds/[id]/fix/[orderId]/page.tsx`, `fix-screen.tsx`; add `buyAction` and `replaceAction` to `app/rounds/actions.ts`; tests in `app/rounds/__tests__/`.

**Produces:**
- Confirm page: `searchParams: Promise<{ ideas?: string; over?: string }>`, ids parsed as UUIDs (max: the round's idea count). It shows, per AC-4, each idea's photo, title, store and arrive-by; the price with shipping and tax; Zinc's fee per order; the estimated total; "never more than $X" (`capsFor().neverMoreThanCents`); "Ships to" (the recipient by default; city and state only for a shared address; the ALL-41 "Where it goes" choices); a gift note limited to `zinc_gift_message_max_chars`; the Zinc balance (`getZincWallet`) and `zincFeeNotice`. One button: "Buy now · about $total", or "Buy anyway · $total" with how far over the budget it is (AC-8). Ideas that aren't `proposed` show "These ideas were replaced" and no button (AC-12b).
- `buyAction(roundId, form)`: builds deps with `buyingWiring`, calls `approveAndBuy` with `overBudgetConfirmed` only when the page was in its over-budget state, and shows the result ("Ordered", "Waiting on your Zinc balance", "Price went up", "Someone else got it", "Busy, try again"). `no_address` links to the address form with `?next=` back (**[Verify]** both address forms honour `next`).
- Fix page: for `price_up` it calls `requote` once on load and shows old and new totals with "Buy at about $new"; for the other failures it shows what happened in plain words and the next-best idea with "Buy this instead", or "See all ideas"; for address failures, "Ship it to me", "Another address" or the person's own address once added (AC-15a). A resolved or replaced order shows what happened instead.
- `replaceAction(roundId, orderId, form)` calls `replaceFailedOrder`.

- [ ] **Step 1: Write the failing component tests:**
  - `the confirm page shows the fee, the total, never more than and the money notice`
  - `an over-budget link reads Buy anyway and says how far over`
  - `the gift note stops at the setting's length`
  - `a replaced idea shows "These ideas were replaced" and no button`
  - `the price_up fix page shows old and new totals`
  - `an address failure never offers the shared address`
  - `with no next-best idea the fix page shows See all ideas`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Build the pages and actions.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm typecheck && pnpm build`. Expected: all pass, and the build lists `/rounds/[id]`, `/rounds/[id]/buy` and `/rounds/[id]/fix/[orderId]` as dynamic.
- [ ] **Step 5: Commit** `feat: the confirm page and the fix page (ALL-29)`.

### Task 12: Browser journeys, layout and gallery (AC-1–AC-4a, AC-6, AC-12, AC-13, AC-14, AC-15, AC-18, AC-19, AC-26)

**Files:** create `e2e/approval.spec.ts`; add rows to `e2e/gallery.shots.ts`. Rounds and ideas are seeded with the service role (the app can't create them); everything else goes through the app.

- [ ] **Step 1: Write the journeys (iPhone only):**
  - `Buy this from the heads-up buys in two taps` (open the buy URL, press "Buy now": one order, fake Zinc places it, "Ordered" shows)
  - `opening a buy link signed out signs in and comes back to the same page`
  - `another account sees only "This gift belongs to another account"`
  - `loading the round, buy and fix pages changes nothing` (`request.get` on each URL: orders, rejections, budgets and round rows unchanged)
  - `two tabs press Buy: one order, the other sees what was bought`
  - `an over-budget pick needs Yes, pick it, and the confirm page says Buy anyway`
  - `None of these saves the reason, the next tick brings new ideas and a second heads-up, and the old Buy this link says replaced` (fake Gateway, tick through `/api/rounds/tick` with the test clock)
  - `a price_up gift is bought at the new price from its fix page`
  - `an out_of_stock gift is replaced by the next-best idea`
  - `an ordered round's link says Already ordered and has no Buy button`
- [ ] **Step 2: Write the `@layout` checks:** round screen, confirm page, fix page, the over-budget sheet and the None of these sheet: `phoneLayoutProblems(page)` is empty (no sideways scroll, every target at least 44px), light and dark.
- [ ] **Step 3: Run them.** `pnpm --filter @gifts-af/web e2e -- e2e/approval.spec.ts`. Expected: they fail before the pages exist (run once on Task 9's commit), pass now. Check the exit code, not just the summary.
- [ ] **Step 4: Gallery rows** for the round screen, the confirm page, the fix page and the `no_more_ideas` email; `pnpm gallery` renders them.
- [ ] **Step 5: Commit** `test: approval journeys and layout checks (ALL-29)`.

### Task 13: Docs, pages and the PR

- [ ] **Step 1: Decisions** in `design/decisions.md`, next free numbers (T78 onward at the time of writing):
  - Plain app links for the approval pages, revising T38 for them; loading never acts (AC-4a).
  - `replace_failed_order` replaces `reapprove_order` (dropped in a later contract migration); the same-idea rule; never back to a withdrawn or rejected shared address.
  - Photos from Zinc only, `https://`, no referrer.
  - Revising T73: a budget typed on an open round with none sets that round's budget under the lease.
  - Per-idea-set step keys and `no_more_ideas`.
- [ ] **Step 2: Design and UI docs.** `design/technical-design.md` §6.5 (pages, next-best, `replace_failed_order`, photos, re-quote) and §5 (re-generation after a rejection); `design/ui.md` (the approval screens and the email's per-idea links); `design/operations.md` (the new events, and that `reapprove_order` is unused). No new commands.
- [ ] **Step 3: Pages.** Republish the round engine page (re-generation after a rejection, per-set keys) and the screens and emails page (`pnpm gallery`), each to its own URL.
- [ ] **Step 4: Verify.** Re-date the migration past `main`'s newest, then `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm build` and `pnpm --filter @gifts-af/web e2e`. All green.
- [ ] **Step 5: PR** titled `feat: approve and buy from the email, pick several, none of these, fix a failed gift (ALL-29)`, body `Part of ALL-29`, answering E9: **seeing it work:** `order.approved`, `order.replaced`, `round.ideas_rejected` events; **turning it off:** `zinc_ordering_enabled = 0` stops all buying, `round_engine_enabled = 0` stops new rounds and emails, or a Vercel rollback. Run the adversarial review (T55) and read PR feedback (T59).

### Task 14: Switching on in production (AC-20–AC-24; needs the owner)

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

| Criterion | Task |
|---|---|
| AC-1 | 9, 12 |
| AC-2, AC-3, AC-4, AC-4a | 5, 6, 10, 11, 12 |
| AC-5, AC-6, AC-7, AC-8 | 4, 5, 10, 11, 12 |
| AC-9 | 3, 5, 6, 10 |
| AC-10, AC-11 | 5, 11 |
| AC-12, AC-25 | 3, 4, 6, 8, 10, 12 |
| AC-12a | 1 |
| AC-12b | 1, 2, 5, 11, 12 |
| AC-13, AC-13a | 3, 7, 10, 12 |
| AC-14, AC-15, AC-15a | 2, 4, 5, 11, 12 |
| AC-16 | 9 |
| AC-17 | 1, 8, 10 |
| AC-18, AC-19 | 1, 5, 6, 11, 12 |
| AC-20 to AC-24 | 14 |
| AC-26 | 12 |

- [x] Every task traces back to a story or criterion. The re-quote column (Task 2) exists so the "Buy at about $new" action uses the price the page showed without a second paid lookup (AC-14).
- [ ] No open questions are left. Two need the owner (below).
- [ ] Adversarial review of the spec done; of this plan, still to do.

**For the owner, before Task 4:**
1. **What does "Already has one" save when the round had three ideas?** My pick: the sheet asks "Which one?" (one tap on an idea) and saves that title as `owns`; "Not their style" and "Too generic" save one `avoid` fact, "Not their style: <the titles>"; the free text is saved as an `avoid` fact.
2. **Gifts from a person's own list:** nothing puts them into a round today (no code writes `gift_ideas.source = 'list'`). My pick: this ticket shows and greys them out when they're there, and a new ticket makes rounds offer them.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of what people see (the round screen, the confirm page, the fix page, the sheets and the new emails; phone and desktop, light and dark) and the mock-ups, uploaded into the ticket comment.
- [ ] Live checks after deploy (Task 14), or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

The riskiest things no acceptance criterion pins down directly, each with the test that covers it:

1. **A stale "Buy this" link buys a rejected idea.** The email outlives the ideas it lists. `approve_round` refuses anything not `proposed` (Task 1: `approve_round refuses a rejected idea`), and the journey presses an old link after None of these (Task 12).
2. **A budget typed on the round screen races an approval in another tab.** `approveAndBuy` used to read the round before the lease, so its cap could ignore the new budget. It now re-reads under the lease (Task 5: `a budget saved while approveAndBuy waits for the lease caps the order at the new budget`).
3. **A failed address gift goes back to the same unusable shared address.** `replace_failed_order` refuses `address_source = 'shared'` for those failures (Task 2: `an address_rejected order is never sent to a shared address`).
4. **Double replacement from two tabs on the fix page buys twice.** The lease makes one busy, and the failed order must still be unresolved (Task 2: `a second replace of the same failed order is refused`; Task 5: `two replaces at once: one order, the other busy`).
5. **A link scanner or prefetch acts by loading a page.** The pages only read, and the fix page's lookup writes only the re-quote (Task 12: `loading the round, buy and fix pages changes nothing`).
