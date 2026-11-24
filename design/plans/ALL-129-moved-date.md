# ALL-129 Moving a birthday leaves an open round on the old date: Spec and Plan

**Status:** spec approved by the owner, 2026-11-24; plan reviewed (no blockers; fixes applied), waiting for the owner. Cut to rule 1 after three adversarial reviews, by the owner's stop rule: the third found a blocker in rule 2 (keeping the yearly key right for rounds that already have a gift), which is now its own ticket. No code yet.

**Goal:** when a birthday or anniversary date changes, an open round with no gift chosen ends, and the real date can have one.

**Links:** [ALL-129](https://linear.app/allens-forever/issue/ALL-129) · [ALL-171](https://linear.app/allens-forever/issue/ALL-171) (rounds that already have a gift) · `design/technical-design.md` §4.1, §5, §5.1 · T14, T18, T27, T49 · `modules/concierge/rounds/`, `supabase/migrations/20261105100100_disable_occasion_skips_rounds.sql` (the same idea for switching an occasion off)

## The problem

Changing the date keeps the occasion's id, so its open round stays on the old date and ships for it. Skipping it isn't enough: one round is allowed per person, occasion and year, and a skipped round still holds that place, so the real birthday gets nothing.

## Spec: what it does

Birthdays and anniversaries only. **Moved** means the month or day changed. **Open** means `scheduled`, `generating`, `awaiting_approval`, `needs_address`, or `needs_attention` and not closed.

**The rule.** A move ends an open round that has no orders, or only failed ones, and clears its `occasion_year`, which frees its place. Nulls don't collide in the unique key. Nothing else is changed.

### Stories

1. **Correct a date:** as a buyer, I can fix someone's birthday so that ideas, reminders and delivery follow the real date.
2. **Know what happens to a gift:** as a buyer, I'm told when a gift keeps its old date, or it's too late for the new one.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An open round with no orders | The occasion moves by any amount | It ends `skipped` and closed through `reconcile_round`, its lease ends and its year is cleared. No email about it |
| AC-2 | An open round whose orders all failed | The occasion moves | As AC-1, and nothing in it can be replaced. A failure not yet told gets the late email any close gives; a `store_cancelled` one is told by the daily news, as today |
| AC-3 | AC-1's round, and a new date that's due | The next tick | A round starts for it, with its own ideas and emails |
| AC-4 | AC-1's round, birthday moved from today + 30 to today + 200 | Ticks run | Nothing starts until that date's normal start |
| AC-5 | A round with an order held, placing, unconfirmed, placed, shipped or delivered, or a round already ended | The occasion moves | The round, its orders and its year are unchanged |
| AC-6 | The date moves twice (Dec 28 to Jan 5 to Jan 6) before a tick | The tick runs | One round, for Jan 6 |
| AC-7 | Feb 29, moved from or to, or a date the checks allow but isn't real (Feb 31) | The occasion moves | The save works, and the rule applies |
| AC-8 | A buyer approving as the date moves | Both at once (two connections) | The approval wins and AC-5 holds, or the move wins and the approval is refused. Never an order on a closed round |
| AC-9 | A round claimed, or an idea run under way | The occasion moves | No new paid run, no ideas saved, no new send. An email already being sent can't be recalled. Money spent stays recorded, and the lost lease is a quiet stop, not `round_failed` |
| AC-10 | A round closed by a move (`skipped`, no year) | Its old link is opened, on any day | "The date changed, so this round ended." Nothing can be bought |
| AC-11 | A round closed by a move, with no orders | Its old date passes | Not in past gifts, and the person page doesn't link to an empty list. One with failed orders is listed as today |
| AC-12 | A round of this occasion with a live order (held, placing, unconfirmed, placed, shipped), its date not passed | The buyer saves a new date | It saves, and says "A gift is already set for Dec 28. It keeps that date." If the new date is earlier, or has passed this year, it adds that the gift may arrive late. Leaving the page before it shows can miss it; showing it on the person page is ALL-171 **[Claude's call]** |
| AC-13 | A new date that's too close to ship for, with no gift set | The buyer saves it | It saves, and says it's too late for this one and the next one starts as usual **[Claude's call]**. Not shown when the occasion is off, the buyer has no paid features, or a gift for it was already given |
| AC-14 | `moved_dates_close_rounds` is 0 or missing | The occasion moves | Today's behaviour |
| AC-15 | A holiday, an unchanged date or any other save | It happens | No round changes |
| AC-16 | The weekly health email | A round was closed by a move | Not counted under `no_ideas` or `rounds_failed` |

### Out of scope

- **ALL-171:** rounds that already have a gift. As today, a gift for Dec 28 moved to Jan 5 can start a second round (the buyer must approve it), a gift for Jan 5 corrected to Dec 28 can block the next Dec 28, and an order that fails after a move can be replaced for the old date. Also **Cancel it** on the save message.
- Accepted (owner, 2026-11-24): a tick that read the old date at the instant of a move can start a round for it; a round that ended with nothing bought still uses its year; late-gift and reaction emails for a kept gift follow its old date; no limit on moves (ALL-135).

## Approach

A trigger on the occasion's month and day, `security definer`, since owners can update occasions directly. The update already holds the occasion; the trigger locks its open rounds by id and reads orders after each lock. `start_idea_run` and `save_ideas` lock the round after the person's lock and before the daily-limit lock, and refuse one that's closed or `skipped`. The engine rechecks its lease before recording each send. The migration drops `not null` on `occasion_year`; a check allows null only on a `skipped` round, and only this rule writes it.

| Other ways | Why not |
|---|---|
| Re-date the same round | Sent emails would count as sent, and ideas were priced for the old deadline |
| Delete the round | Loses its history and cost links |
| Also guard or re-key rounds that have a gift | Three reviews found a blocker each time; its own ticket |

## What was decided, and why

| Question | Answer (owner, 2026-11-24) | Why |
|---|---|---|
| Which moves end a round? | Any change of date. Widens the 2026-11-16 answer (only outside the lead window) | A small move also ships for the wrong date. Costs another idea run, up to about $1, and a new heads-up |
| Cancel an approved gift on hold? | No | The buyer said yes to it |
| Email about the ended round? | No; old links explain | They made the change |
| Failed gift, not replaced? | End the round | A later replacement would arrive for the wrong date |
| Ship the rest? | No: rule 1 now, rule 2 as a ticket | Agreed before the third review |

## Principles check

- **Simplest version?** Cut: rule 2, any insert guard, a new key, a replaced column, reviving ended rounds.
- **Hard-coded values?** `moved_dates_close_rounds` is a setting.
- **Product boundaries?** Concierge only. **New personal data?** None.
- **Off switch (E7)?** `moved_dates_close_rounds` = 0.
- **Docs and decisions:** technical design §4.1, §5 and the `gift_rounds` row; the next free T#; `operations.md` (the setting); the `setDatedOccasion` comment; the database map; the round engine page; the screens page.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task.

**Architecture:** One migration adds the trigger, the setting and the two refusals. The engine rechecks its lease before sending and stops quietly when a move ended the round. Screens read the mark (`status = 'skipped'` and `occasion_year is null`) and the save returns an optional note.

**Tech stack:** Postgres (pgTAP), TypeScript engine (Vitest, local-db), React (component tests), one Playwright journey.

**Global constraints**
- Comments carry no ticket ids (T86). Logs carry ids only (E6).
- A round is **ended by a move** exactly when `status = 'skipped' and occasion_year is null`. Only the trigger writes null.
- A round is **eligible** when it's open, `closed_at is null`, and every order it has is `failed` (or it has none).
- `moved_dates_close_rounds` must equal 1; 0 or missing means today's behaviour.
- Copy, exact: "The date changed, so this round ended." · "A gift is already set for {Dec 28}. It keeps that date." · " It may arrive after the new date." · "It's too late to send a gift for this one. The next one starts as usual."
- Database tests run through `pnpm db:test`, `pnpm test:db` and `pnpm e2e` only (they share one database and take turns).

### Task 1: The migration (AC-1, AC-2, AC-5, AC-6, AC-7, AC-14, AC-15, AC-16)

**Files:** create `supabase/migrations/<next>_moved_dates.sql` (`pnpm supabase migration new moved_dates`, dated after the newest) and `supabase/tests/moved_dates.test.sql`; add the check `gift_rounds_year_or_skipped`; regenerate `packages/core/src/database.types.ts` and `design/database-map.html`.

**Produces:** `concierge.handle_occasion_moved()` trigger `on_occasion_moved`; refusal `'closed'` from `concierge.start_idea_run`; `concierge.save_ideas` returns -1 for a round that ended.

- [ ] Write the failing pgTAP tests, each naming its AC: no orders ends (status, `closed_at`, `occasion_year`, `locked_until`, `next_action_at`); all failed ends, orders `resolved`, an untold one `failed_after_close`, a `store_cancelled` one not; each of held, placing, unconfirmed, placed, shipped, delivered leaves the row identical; an already skipped round identical; two moves leave one null-year round and a new insert for the year succeeds; Feb 29 both ways and Feb 31; switch 0 and missing row change nothing; `enabled` change, same-date update and Christmas change nothing; another user's rounds untouched; a `scheduled` round with no year is refused by the check; a birthday changed to an anniversary on the same date changes nothing; a birthday changed to Christmas ends nothing and doesn't error; signed-in and anonymous roles can't execute `handle_occasion_moved`; `start_idea_run` on an ended round returns `closed` and adds no `idea_runs` row; `save_ideas` returns -1 and adds no idea; `health_snapshot` `no_ideas` excludes it.
- [ ] `pnpm db:test`: the new file fails, the rest pass.
- [ ] Write the migration: `occasion_year` drops `not null`; the setting (1); `check (occasion_year is not null or status = 'skipped')`; the trigger `after update of month, day ... when (old.kind in ('birthday', 'anniversary') and new.kind = old.kind and (old.month, old.day) is distinct from (new.month, new.day))`, `security definer`, execute revoked from public, anon and authenticated, locking the occasion's rounds `for update` in id order, checking eligibility after each lock, then `reconcile_round(id, 'deadline')` and, only if it returned `skipped`, `occasion_year = null, locked_until = null`. Copy the latest `start_idea_run`, `save_ideas` and `health_snapshot` bodies and change only: lock the round `for update` after the person lock and return early when `closed_at is not null or status = 'skipped'`; add `and s.occasion_year is not null`. Keep every grant.
- [ ] `pnpm db:test` passes. `pnpm db:types`, `pnpm db:map`. Commit.

### Task 2: Two connections (AC-8)

**Files:** create `apps/web/modules/concierge/__tests__/moved-dates-db.test.ts`; add it to `LOCAL_DB_TESTS` in `apps/web/vitest.config.ts`, or `pnpm test:db` skips it.

- [ ] Write the tests with two `pg` clients, modelled on `approval-db.test.ts`: approval holds the round's lock, the move waits, then the round and its order are unchanged; the move holds it, approval waits, then `approve_round` raises and no order exists; a move against `start_idea_run` and `save_ideas`, both ways round: the run or save first and the move waits, or the move first and they refuse.
- [ ] `pnpm test:db`: they pass against Task 1. Then run them against a copy of the trigger without `for update` (in the test's own transaction) and see the first one fail, so they prove the lock. Commit.

### Task 3: The engine stops quietly (AC-3, AC-4, AC-9, AC-16)

**Files:** modify `apps/web/modules/concierge/rounds/{store,steps,engine}.ts`, `apps/web/modules/concierge/ideas/{store,run}.ts`; tests `round-engine-tick.test.ts`, `round-engine-ideas.test.ts`, `fake-round-store.ts`, `moved-dates-db.test.ts`.

**Produces:** `RoundStore.holdsLease(roundId: string, lock: Date): Promise<boolean>`; `RoundStore.endedByMove(roundId: string): Promise<boolean>`; `class LeaseLost extends Error` (`steps.ts`); `IdeaRefusal` gains `"closed"`; `IdeaStore.save` may return -1, for which the run is finished as `none` with its real cost and reported as `{ status: "none" }`, so it uses a turn.

- [ ] Write failing tests: a move before `recordSend` sends and records nothing (heads-up, reminder, address request, `no_ideas`); a move between claim and the idea run starts no run; a move during a run saves nothing, sends nothing and records the run's cost, and with `idea_rounds_per_tick` = 1 a second waiting round gets no run; the health email's `failed_runs` doesn't count it; each logs `round_ended_by_move` with ids only, not `round_failed`, and leaves the tick's `failed` count and heartbeat alone; a lease lost for any other reason still logs `round_failed`. In the database test: after a move, a tick creates a round when due and none when the date is today + 200.
- [ ] Run them: they fail.
- [ ] Implement: `trySend` calls `holdsLease` before `recordSend` and throws `LeaseLost`; every "Lost the lease" throw becomes `LeaseLost`; the engine's and the idea pass's catch blocks, on `LeaseLost`, ask `endedByMove` and, if true, log and return `"advanced"`. `afterIdeaRun` throws `LeaseLost` on refusal `closed`. Four sites need their own handling, each with a test:

| Site | Behaviour |
|---|---|
| `moveToGenerating` finishes, then its claim returns null | As today: carry on, no log |
| `releaseQuietly` loses the lease | `round_ended_by_move` instead of `round_release_failed` when a move ended it |
| `advanceRound` with `justPlaced` (its release is outside any try) | Catch `LeaseLost` the same way |
| `closeAtDeadline`'s `before()` | Rethrow `LeaseLost` before the "held open" alert, so nothing alerts |

- [ ] `pnpm test` and `pnpm test:db` pass. Commit.

### Task 4: Old links and past gifts (AC-10, AC-11)

**Files:** modify `modules/concierge/rounds/approval.ts`, `modules/concierge/reactions/reactions.ts`; tests `approval-db.test.ts`, `reactions-db.test.ts`, `app/rounds/__tests__/round-screen.test.tsx`.

- [ ] Write failing tests: an ended round shows the exact copy before and after its date, with no buy control, on the round, buy and fix pages; its approve and replace calls are refused; `giftHistory` and `hasPastGifts` leave it out when it has no orders and keep it when it has failed ones; a store-cancelled gift's round (with a year) still shows; on an ended round whose failed order was store-cancelled, the refund still shows beside the new text.
- [ ] Implement: `roundView` selects `occasion_year`; `closedText` checks the mark first, since such a round has no live order. Both history reads exclude `skipped` with a null year and no orders. `hasPastGifts` keeps failing closed.
- [ ] Tests pass. Commit.

### Task 5: What the save says (AC-12, AC-13)

**Files:** modify `modules/concierge/people/{service,store,people}.ts`, `modules/concierge/settings.ts`, `app/people/actions.ts` (reads `todayForRequest()`), `app/people/[id]/about/about-form.tsx` (its own `save` sets the note; `useAutosave` is unchanged); tests `people.test.ts`, `fake-people-store.ts`, `app/people/__tests__/actions.test.ts`, `about/__tests__`, one step in the people Playwright journey.

**Produces:** `SaveResult = { ok: true; note?: string } | { ok: false; error: string }`; `PeopleStore.setGiftDate(occasionId: string, today: CalendarDate): Promise<CalendarDate | null>`, the earliest `occasion_date` on or after today of a round with a held, placing, unconfirmed, placed or shipped order; `PeopleStore.canStartRound(occasionId: string, year: number): Promise<boolean>`, true when the occasion is on, the buyer is paid, and no round for that year gave a gift; `setDatedOccasion(store, id, kind, date, today)`.

- [ ] Write failing tests: note for each live status; none once its date has passed; the "may arrive after" sentence when the new date, taken in the kept date's year, is earlier than it, including when it has already passed; the too-late note only with no gift set, `orderBy` null for the next occurrence and `canStartRound` true (a test each for off, unpaid, already delivered, and Dec 28 to Jan 2); no note for an unchanged date, a first date, or the switch at 0; a failed note lookup still saves and says only "Saved"; the form shows the note in a `role="status"` line, clears it on the next edit, and doesn't show one that arrived after the page was left.
- [ ] Implement. The note is read after the save, so it never blocks one.
- [ ] Tests pass; `pnpm gallery`, look at the About screen. Commit.

### Task 6: Docs

- [ ] Technical design §4.1, §5 and the `gift_rounds` row; the next free T# in `design/decisions.md` (read it at commit time: other sessions add numbers); `operations.md`: the setting, `round_ended_by_move`, and that after a code rollback the trigger stays on (set the switch to 0; until then old code logs `round_failed`, can send the email in flight, and says "This gift round was stopped"); the `setDatedOccasion` comment; tick this plan.
- [ ] After the merge: database map (hook), round engine page, screens page.

## Review focus

| Risk | Test |
|---|---|
| A gift is approved as the date moves | Task 2 |
| A paid run or email after the round ended | Task 3 |
| The mark matches a round that isn't a moved one, hiding a refund | Task 4, store-cancelled case |
| A held gift is cancelled by the close, since `reconcile_round` cancels held orders | Task 1, held case |
| A round with no year isn't skipped, so each tick makes another | Task 1, the check |
| The date can't be saved because the note or the trigger fails | Task 5, failed lookup; Task 1, Feb 31 |

## Before coding: consistency check

- [x] Every criterion maps to a task: AC-1, 2, 5, 6, 7, 14, 15 (1), AC-8 (2), AC-3, 4, 9 (3), AC-10, 11 (4), AC-12, 13 (5), AC-16 (1 and 3).
- [x] Every task traces back to a criterion.
- [x] No open questions.
- [x] Adversarial review of the plan (2026-11-24): no blockers; nine should-fixes applied.

**PR:** `fix: a moved birthday ends its open round and starts one for the real date (ALL-129)`, `Part of ALL-129` (the criteria changed, and production needs a check).
