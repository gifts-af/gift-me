# ALL-34 Reactions and gift history: Spec and Plan

**Goal:** the day after the occasion, ask the buyer how each gift went over, learn from the answer, close the round, and show each person's past gifts in one place.

**Links:** [ALL-34](https://linear.app/allens-forever/issue/ALL-34) · PRD D-2, D-3 · planning decisions 12, 13 · T14, T23, T26, T38, T42, T80, T89 · dry run [ALL-36](https://linear.app/allens-forever/issue/ALL-36), which needs a round to reach `complete`

**Owner's choices (2026-11-24):** one answer **per gift**. For every other choice on this ticket the owner said to go with Claude's pick; each is marked **[Claude's call]**. The owner still approves the merge, prod steps and spending.

## Spec: what it does

### Who it's for and what they can do

1. **Buyer, email:** one email per occasion lists each gift that arrived, each with four links: Loved it, Liked it, Meh, Returned it. Tapping one opens the page with that answer chosen; Save keeps it. Two taps. Opening a link never saves (email scanners).
2. **Buyer, page:** `/rounds/{id}/reaction` shows every delivered gift with the four choices and an optional note. They can answer some, skip others, and change an answer later.
3. **Buyer, history:** `/people/{id}/gifts`, from a "Past gifts" row on the person's page, lists past rounds, newest first.
4. **System:** answers become facts the idea engine reads; the round moves to `complete`.

### When the email goes and when the round closes

- **Asked-on date:** the latest of the occasion date, the last delivery date and the day the round became delivered, plus `reaction_prompt_after_days` (1). UTC days, by the daily tick, once per round (`round_sends` step `reaction_prompt`). The day it became delivered counts because the store can cancel the last gift well after the others arrived. A late gift is asked about after it arrives **[Claude's call]**.
- **Asked when** `asked_on <= today < asked_on + reaction_close_days` (7), the round is `delivered`, the person isn't removed, and a delivered gift has no answer. The email lists the **unanswered** gifts only. A removed occasion is still asked about: the gift was given.
- **Closes to `complete`** when every delivered gift has an answer, or on `asked_on + reaction_close_days`. An unanswered round closes silently. The tick also closes a `delivered` round whose gifts were all answered earlier (while another gift was still on its way). Answers are still taken after that.
- **Not before the occasion:** answering is refused, and the round screen's link hidden, until the occasion date. A gift can arrive weeks before it's given.
- **Only `delivered` rounds.** A round still `ordered` isn't asked. Zinc's delivered event can be lost, and "It arrived" takes shipped gifts only, so such a round is never asked and never closes. Known gap, with its own follow-up ticket **[Claude's call]**.
- **Old rounds at launch,** already past their close date, close without an email.
- **A refused email** gives its key back (best effort) and is tried at the next tick, until the close date.
- **Delivered email:** once a round is `complete`, a refused delivered email isn't retried. The buyer has said how it went, so they know it arrived.
- **Switch:** `reactions_enabled` (1). At 0 nothing is asked or closed and saving is refused ("Not available right now"); history still shows. Turning it back on after a long gap closes the waiting rounds unasked.

### What an answer does

| Answer | Fact saved about the person |
|---|---|
| Loved it | `loved`: the title, or "title: note" |
| Liked it | none: too weak to steer ideas **[Claude's call]** |
| Meh | `avoid`: "Didn't love: title", or with ": note" **[Claude's call]** |
| Returned it | with a note, `avoid`: "Returned title: note"; without one, none (wrong size or broken isn't dislike) **[Claude's call]** |

- **List gifts never become facts.** A gift from someone's list keeps that person's words out of facts and out of the AI (T42). The answer and note are still saved.
- **Facts are written only when the rating is new or changes.** A note edit or a repeat save touches no fact, so it can't bring back one the buyer turned off, deleted or edited. When the rating changes, the old fact is removed only if it's still exactly as we wrote it (the reaction stores its category and value) and active. A changed rating is a new answer, so its fact is written even if an earlier one was deleted. A fact that already exists is left as it is. Known gap: two gifts with the same title share one fact, owned by the first answered, so changing that answer removes it even if the other gift is still loved. Saving a fact for a removed person is skipped.
- **Sensitive text is refused,** with the same message as other typed profile text (C-8, decision 51), and nothing is saved. A title whose fact trips the filter saves the answer with no fact.
- Facts have source `reaction`, `confirmed` true, and the fact length limit (the existing cut helper).
- "Don't suggest it again" is already covered: given products are excluded (`excluded_offers`).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A `delivered` round whose asked-on date is today or earlier, not past its close date | The tick runs | One email listing every delivered gift with four links each; the key is recorded; a second tick sends nothing |
| AC-2 | Asked-on date in the future, or the round is `ordered` / `needs_attention` / `skipped` | The tick runs | No email |
| AC-3 | The gift arrived after the occasion | The tick runs | It's asked the day after it arrived |
| AC-4 | The buyer taps "Loved it" in the email, signed in | The page opens, they press Save | Saved in two taps. The GET alone saved nothing |
| AC-5 | Signed out, or someone else's account | They open the link | Sign in and return to it; another account sees "This gift belongs to another account" (T80); nothing about the round |
| AC-6 | A round with two gifts | One is answered | Saved for that gift only; the round stays `delivered`. Answering the second makes it `complete` |
| AC-7 | An unanswered round past its close date | The tick runs | `complete`, no email |
| AC-8 | A rating is changed | Saved | One reaction row per gift, updated; the old fact is gone if it's still as we wrote it, the new one is in. An edited, turned-off or deleted fact stays as the buyer left it |
| AC-9 | A note with a sensitive trait | Saved | Refused with the usual message; nothing is written |
| AC-10 | Someone else's order, an order not delivered, before the occasion date, a bad rating, a note over the limit | Save is called | Refused; nothing is written |
| AC-11 | Rounds `delivered`, `complete`, `skipped`, or with a given gift and an occasion date before today | The history opens | Each is listed, newest first: occasion and date (a removed occasion reads "Occasion"), gifts, cost (the order's total, or "Cost not known yet"), delivery outcome, reaction and note. A skipped round with nothing bought says no gift was bought; one whose gift the store cancelled says cancelled and refunded, with the amount only if Zinc sent it |
| AC-12 | A person with no past rounds | Their page opens | No "Past gifts" row |
| AC-13 | `reactions_enabled` = 0 | Tick, page, save | No email, no close; saving refused |
| AC-14 | The email fails or the read throws | The tick runs | The key is given back, an alert event is logged (ids only), and the rest of the tick runs |
| AC-15 | Signed-in user | Writes to `reactions` directly, or calls the save function | Refused: server only (T26) |
| AC-16 | A double tap on Save, or two tabs | Saved | One row, one fact |
| AC-17 | A gift that came from someone's list | Any answer is saved | No fact; the answer and note are kept |
| AC-18 | A round where one gift was answered before the other arrived | The last gift arrives or is store-cancelled | Only unanswered gifts are asked about; if none are left it closes |
| AC-19 | The new code runs before the migration | The person page or round screen opens | They work, without the new row or link |

### Out of scope

Push (W5-4), voice notes, asking the recipient, ideas-page changes, backfilling facts for past gifts, editing or deleting history.

## What was decided, and why

- **Plain app links, not `/a/` action links:** the same pattern as "Buy this" (T80). Two taps, no token per gift and answer, no expiry.
- **Per-gift answers:** `reactions.order_id`, unique. `round_id` stays. Expand-only.
- **Two more writers of round status** (`save_reaction` and `close_reacted_rounds`), beside `reconcile_round` (T14). Both lock the round, require `delivered`, set `complete` and `next_action_at` null together, and leave `closed_at` alone. `reconcile_round` already returns early for both statuses. T91 records it.
- **The close is driven by the round's dates, not by whether the email went,** so a refused email can't leave a round open forever.
- **Facts are written in the same function as the answer,** so they can't disagree.

## Principles check

E2: one page, one history page, one function, no new job. T23: every number is a setting. T26/E3: server-only writes; clients built in the action. T42/E6: logs carry ids only; notes never logged. E7: additive; a switch. E8/customers informed: nothing is bought or charged, so silence is the only closing step.

## Plan

**Rules for every task:** test first, commit per task, no hard-coded numbers (T23), ids only in events (E6), no ticket or AC ids in code comments (T86), tests leave nothing behind, fields off until ready (ALL-161).

### Names the tasks share

```sql
-- All service_role only, security definer, set search_path = ''.
concierge.save_reaction(p_user_id uuid, p_order_id uuid, p_rating text, p_note text,
                        p_fact_category text, p_fact_value text, p_today date) returns text  -- the round's status
concierge.reactions_due(p_today date) returns table (round_id uuid, user_id uuid)  -- to ask
concierge.close_reacted_rounds(p_today date) returns integer                         -- how many closed
```

```ts
// packages/core/src/reactions.ts
export const RATINGS = ["loved", "liked", "meh", "returned"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABELS: Record<Rating, string>; // Loved it, Liked it, Meh, Returned it
export function reactionFact(rating: Rating, gift: { title: string; fromList: boolean }, note: string | null): { category: "loved" | "avoid"; value: string } | null;

// modules/concierge/reactions/
export function saveReaction(i: { userId: string; orderId: string; rating: Rating; note: string | null }, deps): Promise<SaveResult>;
export function reactionView(roundId: string, userDb: Db, now: Date): Promise<ReactionView | null>; // the user's own client (RLS, T26)
export function giftHistory(personId: string, userDb: Db, now: Date): Promise<PastRound[]>;
export function hasPastGifts(personId: string, userDb: Db, now: Date): Promise<boolean>; // existing columns only; false on any error
export function runReactions(deps: { store: RoundStore; notify: NotifyDeps; now: Date }): Promise<{ closed: number; asked: number }>;
```

### Task 1: Database (AC-2, AC-3, AC-6 to AC-8, AC-10, AC-13, AC-15, AC-16)

- [ ] pgTAP tests for everything above that the database decides, then migration `20261126100000_reactions.sql` (check main first): settings `reactions_enabled` 1, `reaction_prompt_after_days` 1, `reaction_close_days` 7, `reaction_note_max_chars` 500 (a missing one raises; the note limit is enforced in SQL).
  - `reactions` gains `order_id` (nullable, unique), `fact_category`, `fact_value`. `orders` gains unique `(id, round_id, user_id)`; the FK `(order_id, round_id, user_id)` references it, `on delete cascade`, so a reaction can't pair one round with another's order.
  - The `round_sends` step check is recreated from its latest version (`20261124110000`) plus `reaction_prompt`. The notifications check already allows it.
  - `save_reaction` locks the round, derives `round_id`, checks the order is the user's and `delivered` and the occasion date has come, follows "What an answer does" (inserting a fact with `on conflict do nothing`), writes `source` `web`, and closes the round when it's `delivered` and every delivered gift has an answer.
  - `close_reacted_rounds` locks and re-checks each round; a concurrent save is tested.
- [ ] `db:types`, `db:map`.

### Task 2: Core rules (AC-9)

- [ ] `reactionFact` and labels, with unit tests: every rating, with and without a note, a list gift (always null), a long title or note cut to the limit (reuse `FACT_VALUE_MAX` and `cut` from `core/approval.ts`), whitespace-only note, blank title (null).

### Task 3: Save, view and history (AC-4, AC-6, AC-8 to AC-13)

- [ ] `saveReaction` (refuses sensitive notes; drops a fact whose final value trips the filter), `reactionView`, `giftHistory`, `hasPastGifts` in one module, with unit tests and local-db tests (including a `source = 'list'` idea, an edited, off and deleted fact, a removed occasion, a store-cancelled skip); server action `saveReactionAction` in `app/rounds/actions.ts` (zod at the boundary, E4).

### Task 4: The page (AC-4, AC-5, AC-13)

- [ ] `/rounds/[id]/reaction` (`?gift=&r=` preselects; anything invalid is ignored; a GET saves nothing), phone layout `@layout`, component tests, a link on the round screen's delivered gifts from the occasion date (fails soft). Sign-in return path covers it. Mock-up picture to the owner.

### Task 5: History (AC-11, AC-12)

- [ ] `/people/[id]/gifts` and the "Past gifts" row (only when there are past rounds; `hasPastGifts`, which fails soft, so it can't break the person page). Component tests and layout check.

### Task 6: The email and the tick (AC-1 to AC-3, AC-7, AC-13, AC-14)

- [ ] `EmailRow` gains `links?: EmailLink[]`, each at least 44 px tall on a phone. The existing `reaction_prompt` template changes from one gift and one button to each gift with its four links (its sample, `samples.test.ts` and `e2e/emails.spec.ts` follow). Also: `StepKey` in `packages/core/src/round-plan.ts`, `TrackingStep`/`emailStep` in `rounds/emails.ts`, `RoundStore` and `fake-round-store.ts`, `EngineDeps`. Then `runReactions` closes first, then asks; wired into `runTick` in its own try/catch after the tracking news, whatever `round_engine_enabled` says. Events `reactions.run`, and the alerts `reactions.ask_failed` and `reactions.run_failed`, each with a runbook heading in operations.md (E8). Samples, `pnpm gallery`.

### Task 7: The journey and docs

- [ ] One Playwright journey: tick sends the email, "Loved it" link, Save, `complete`, history shows it. T91, technical-design §6.6 and the round table, operations (settings, events, off switch and what turning it back on does), the round engine page note. Republishing pages is done after merge.

### After merge (E9)

- **How we see it:** `reactions.run` in the daily tick's logs; the first real delivered round gets one email.
- **How to turn it off:** `reactions_enabled` = 0.
- **Stays open:** the first real answer.

## Review focus

1. A GET saving an answer: Tasks 4 and 6.
2. A round closed early, or never: Tasks 1 and 6.
3. Asking twice, or about a gift that hasn't arrived: Tasks 1 and 6.
4. Someone else's round or notes reachable: Tasks 1, 3, 4.
5. A wrong fact steering next year's ideas: Tasks 1, 2, 3.
