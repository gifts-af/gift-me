# ALL-167 When a search finds nothing: Spec

**Goal:** a search that finds nothing never leaves the buyer with an empty page, a useless request or a second bill.

**Links:** [ALL-167](https://linear.app/allens-forever/issue/ALL-167), design questions 2 and 4 (owner, 2026-11-24). Revises T68 (when a round searches again) and T85 ("never offers a rejected product again"). Questions 1, 3 and 5 are separate PRs.

## Spec: what it does

### Who it's for and what they can do

1. **Earlier ideas come back (question 4):** as a buyer who said "None of these", when the new search finds nothing and none is left, I get the earlier ideas back, so I can still buy one.
2. **Nothing can arrive in time (question 2):** as a buyer, when it's too late for any gift to arrive, I'm told so plainly and pointed to something local, and I'm not asked for facts that can't help.
3. **No second bill for the same answer (question 2):** as the owner, a search that really found nothing isn't paid for again until something changed.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | "None of these" rejected the round's ideas, the new search ended `none`, and no search is left | The tick or job acts on the round | Its rejected ideas that can still be offered are `proposed` again, the round is `awaiting_approval`, and the buyer gets one email: "We didn't find anything new. These are still here if you want one." |
| AC-2 | As AC-1, rejected as "Already has one" | Same | The named gift stays rejected, AI idea or list gift |
| AC-3 | As AC-1 | Same | A gift that can't arrive in time any more, is bought or live elsewhere, or is a list gift no longer shared or claimed, stays rejected. "Too pricey" ideas do come back |
| AC-4 | As AC-1, and nothing is left to bring back | Same | The no-ideas email goes as today, worded by AC-8 when it's too late |
| AC-5 | Ideas came back | The buyer says "None of these" again | No search is left, so they stay buyable (T85 as it is) |
| AC-6 | Ideas came back | The buyer buys one | The same price checks and caps as any idea; an old email's link to an idea that stayed rejected is still refused |
| AC-7 | A search found new ideas, or a run is still allowed, or the run ended `failed`, `deadline` or `no_credit` | Any | Nothing comes back |
| AC-8 | No gift could arrive in time if ordered at the next chance (the fastest shipping rule, `fastest_days_to_arrive`), and the no-ideas email is due | It's sent | It says it's too late for a gift to arrive, suggests something local, and asks for no facts |
| AC-9 | The round's last counted run ended `none` | Nothing has changed since it started | No further run starts for the round |
| AC-10 | As AC-9 | A fact, the round's budget, the address, or the person's list changed since | One more run may start, still within `idea_round_runs_max` and its one extra |
| AC-11 | The last run ended `failed`, `deadline` or `cost_cap` | The next tick | The retry is allowed as today |
| AC-12 | The round page | Ideas came back | They show as normal ideas under "We didn't find anything new. These are still here if you want one." |
| AC-13 | Two ticks or jobs act on the same round | At once | Ideas come back once and one email goes (the round lease) |

### Out of scope

- Asking for another paid search by hand.
- On-demand ideas (no round).
- Changing which gifts a first search may offer.

### Open questions

- **[Verify]** Is there a stored time for a list change that the concierge can read through a public interface (T19)? If not, compare the list gifts offerable now with the ones the last run had.
- **[Verify]** Is there a stored time for a budget and an address change? `gift_rounds.updated_at` moves on every step, so it can't be used.
- **[Claude's call]** The owned gift isn't stored today. `rejections` gains `owned boolean not null default false`, set on the named idea's row. It's an internal id, not a title, so T42 holds.
- **[Claude's call]** The email is the heads-up with its own first line and subject ("Mom's birthday: your earlier ideas are still here"), so reminders run as usual under the fresh keys.
- **[Claude's call]** Off switch: `restore_rejected_ideas_enabled` in `app_settings` (E7). Off, the no-ideas email goes as today.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Bring back gifts the buyer said no to? | Yes, only when nothing new was found and no search is left, without the ones they already have | Owner: an empty page helps nobody, and nothing is bought unless they choose it |
| Pay for a second identical search? | No, until something changes. Errors on our side still retry | Owner: the dry run paid twice for the same answer |
| Too late for anything? | Say so, suggest something local, ask for nothing | Owner |
