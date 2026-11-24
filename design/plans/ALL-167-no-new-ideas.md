# ALL-167 When a search finds nothing: Spec and Plan

**Goal:** a search that finds nothing never leaves the buyer with an empty page, a useless request or a second bill.

**Links:** [ALL-167](https://linear.app/allens-forever/issue/ALL-167), design questions 2 and 4 (owner, 2026-11-24). Revises T68 (when a round searches again) and T85 ("never offers a rejected product again"). Adversarial review of the first draft: 6 blockers, all folded in here.

## Spec: what it does

### Who it's for and what they can do

1. **Earlier ideas come back (question 4):** as a buyer who said "None of these", when the new search brings nothing and none is left, I get the earlier ideas back, so I can still buy one.
2. **Too late for anything (question 2):** as a buyer, when no gift can be ordered in time, I'm told so and pointed to something local, and I'm not asked for facts that can't help.
3. **No second bill for the same answer (question 2):** as the owner, a search that really found nothing isn't paid for again until the buyer gives a new fact.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | "None of these" rejected the round's ideas; the new search ended `none` and no search is left | The run ends | In that same step and lease, the latest rejected set that can still be offered is `proposed` again, the heads-up goes with "We didn't find anything new. These are still here if you want one.", and the round becomes `awaiting_approval` |
| AC-2 | As AC-1, but the last allowed run ended `failed`, `cost_cap` or `deadline` | The run ends | The same, worded "We couldn't finish looking. These are still here if you want one." |
| AC-3 | The run was the day before ship-by | The run ends | AC-1 and AC-2 still happen that day, since the next tick would close the round |
| AC-4 | Rejected as "Already has one", naming a gift | Ideas come back | That gift stays rejected: a list gift by `rejections.owned`, an AI idea also by the active `owns` fact with its title (rejections made before this change) |
| AC-5 | A rejected idea can't arrive in time from today (`canArriveInTime`; unknown delivery days count as can't), is live, bought, failed or cancelled on any order, is bought for the person in another round, or is a list gift claimed or no longer shared | Ideas come back | It stays rejected. "Too pricey" ideas come back |
| AC-6 | Several sets were rejected | Ideas come back | Only the latest set |
| AC-7 | A budget was set after the ideas were made | Ideas come back | Each is marked over budget or not again |
| AC-8 | Nothing can come back | The run ends | The no-ideas email as today, worded by AC-10 when it's too late |
| AC-9 | A run is still allowed, the engine is off, the buyer isn't paid, the outcome is `no_credit`, or the round was never rejected | The run ends | Nothing comes back |
| AC-10 | The next tick isn't before the ship-by day (`today + 1 >= ship_by_deadline`, as `runs_after_rejection`) and the no-ideas email is due | The run ends | It goes that day, says no gift can arrive in time, suggests something local, and asks for no facts |
| AC-11 | The round's last counted run ended `none` and no active fact is newer than its start | Anything asks for a run | None starts, even with runs left |
| AC-12 | As AC-11 with a newer active fact | Same | One may start, within `idea_round_runs_max` and its one extra |
| AC-13 | The last run ended `failed`, `deadline` or `cost_cap` with runs left | The next tick | The retry is allowed as today |
| AC-14 | Nothing was kept and any lookup ended in a vendor error (brainstorm or list pass) | The run ends | It is `failed`, not `none` |
| AC-15 | Ideas came back | The buyer says "None of these" again | With no search left they stay buyable; if the reason saves a new fact and a run is left, the search runs, and the sheet said so beforehand. The sheet's answer and the rejection agree for every `idea_round_runs_max` |
| AC-16 | Ideas came back | The buyer buys one | Price checks and caps as any idea; an idea that stayed rejected is still refused |
| AC-17 | The heads-up send is refused or the process dies after the ideas came back | The next tick | The round is still `generating` with ideas, and goes straight to the heads-up: one email, no run |
| AC-18 | Two ticks or jobs act at once | | Ideas come back once, one email (the lease, checked in the SQL) |
| AC-19 | `restore_rejected_ideas_enabled` = 0 | AC-1 or AC-2's case | The no-ideas email goes as today |
| AC-20 | Ideas came back | | One event `round.ideas_restored` with round and user ids, the count and why (`none` or the failed outcome); the page shows the same first line above the ideas |

### Out of scope

- List, budget and address changes reopening a search (owner 2026-11-24: facts only. We can't tell when a list changed, and the list owner's edits would spend the buyer's money).
- On-demand ideas.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Bring back gifts the buyer said no to? | Yes, when nothing new came and no search is left, without ones they already have | Owner: an empty page helps nobody, and nothing is bought unasked |
| When the last search failed on our side? | Yes, worded as ours | Owner |
| Pay for a second identical search? | No, until a new fact. Errors still retry | Owner: the dry run paid twice for the same answer |
| Too late? | Say so, suggest something local, ask for nothing | Owner |
| Where ideas come back | In `afterIdeaRun`, same lease; SQL only flips ideas to `proposed`, then `sendHeadsUp` sends and finishes | A day later the round would be closed; and `awaiting_approval` before the email could lose it |
| `rejections.owned` | New boolean, default false | List gift titles are never saved (T42); an internal id is |

## Principles check

- **Simplest version?** No new status, table, email kind or job. No list, budget or address detection.
- **Hard-coded values?** One setting: `restore_rejected_ideas_enabled` (1).
- **New personal data?** `rejections.owned`: an internal flag on an idea id.
- **Docs and decisions:** T68 and T85 marked revised; technical design 5.1 and 6.3; operations; ui.md; database map.

## Plan

**Architecture:** one migration, the round step after an idea run, the run's outcome rule, two email variants and one page line.

1. **Outcome rule (AC-14):** `ideas/run.ts`.
2. **SQL:** `rejections.owned`; `reject_round_ideas` takes `p_owned_idea_id` (drop and recreate, old call shape still works); `round_idea_state` and `runs_after_rejection` (AC-11, AC-12, AC-15; preview branch `n.runs <= max`); `restore_rejected_ideas(round, lock)` guarded by lease token, `generating`, open, no non-rejected idea, no unfinished run, last counted run ended `none`/`failed`/`cost_cap`/`deadline`, no run left, before ship-by, under `save_ideas`' person advisory lock; returns the count. pgTAP for each guard.
3. **Engine (AC-1 to AC-3, AC-8 to AC-10, AC-17 to AC-20):** `afterIdeaRun`, and a generating round with ideas goes to `sendHeadsUp` without a run.
4. **Emails and page:** heads-up variant, no-ideas too-late variant, the page line; samples and gallery.

## Before coding: consistency check

- [x] Every criterion maps to a task and a test.
- [x] No open questions are left.
