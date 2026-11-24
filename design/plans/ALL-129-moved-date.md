# ALL-129 Moving a birthday leaves an open round on the old date: Spec and Plan

**Status:** spec, fourth draft, 2026-11-24. Cut to rule 1 after three adversarial reviews, by the owner's stop rule: the third found a blocker in rule 2 (keeping the yearly key right for rounds that already have a gift), which is now its own ticket. No plan or code yet.

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
| AC-12 | A round of this occasion with a live order (held, placing, unconfirmed, placed, shipped), its date not passed | The buyer saves a new date | It saves, and says "A gift is already set for Dec 28. It keeps that date." If the new date is earlier, it adds that the gift may arrive late |
| AC-13 | A new date that's too close to ship for, with no gift set | The buyer saves it | It saves, and says it's too late this year and the next one starts as usual |
| AC-14 | `moved_dates_close_rounds` is 0 or missing | The occasion moves | Today's behaviour |
| AC-15 | A holiday, an unchanged date or any other save | It happens | No round changes |
| AC-16 | The weekly health email | A round was closed by a move | Not counted under `no_ideas` or `rounds_failed` |

### Out of scope

- **ALL-171:** rounds that already have a gift. As today, a gift for Dec 28 moved to Jan 5 can start a second round (the buyer must approve it), a gift for Jan 5 corrected to Dec 28 can block the next Dec 28, and an order that fails after a move can be replaced for the old date. Also **Cancel it** on the save message.
- Accepted (owner, 2026-11-24): a tick that read the old date at the instant of a move can start a round for it; a round that ended with nothing bought still uses its year; late-gift and reaction emails for a kept gift follow its old date; no limit on moves (ALL-135).

## Approach

A trigger on the occasion's month and day, `security definer`, since owners can update occasions directly. It locks the occasion, then its open rounds by id, and reads orders after each lock. `start_idea_run` and `save_ideas` lock the round after the person's lock and before the daily-limit lock, and refuse one that's closed or `skipped`. The engine rechecks its lease before recording each send. The migration drops `not null` on `occasion_year`; only this rule writes null.

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

Written once the owner approves this spec.
