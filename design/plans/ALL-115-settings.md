# ALL-115 Settings as a list of rows, saves as you go: Spec and Plan

**Goal:** Settings is a short list of rows that each show their value and open a detail page; changes save as you go; and the page loads cleanly on Safari.

**Links:** [ALL-115](https://linear.app/allens-forever/issue/ALL-115) (this ticket) · [ALL-102](https://linear.app/allens-forever/issue/ALL-102) (Safari time zone hydration, folded in) · [ALL-127](https://linear.app/allens-forever/issue/ALL-127) (the same rule for other edit screens, later) · T71 and `design/ui.md` > Editing and saving · [mock-ups](https://claude.ai/artifact/3En5Gng3woZjT7a1G7vski) (owner approved option B with detail pages, 2026-11-16).

## Spec: what it does

### Who it's for and what they can do

1. **Find a setting at a glance:** as a signed-in user, I see Settings as four labelled groups of rows (You, Reminders, Gift ideas, Paying for gifts), each row showing its current value, so I can see how things are set without opening anything.
2. **Change my time zone in one tap:** tapping the Time zone row opens the browser's own picker on the row, and picking a zone saves it.
3. **Change my over-budget allowance:** the row opens a page with the number and its explanation; leaving the box saves it.
4. **Reminders:** the row opens a page saying reminders come by email, with "Send me a test email".
5. **My address:** the row opens a page with today's address card, form and remove, unchanged, including its one Save button (T71 exception).
6. **Paying for gifts:** the row opens a page with today's Zinc section, unchanged.
7. **Settings works on Safari** with no hydration error (ALL-102).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A signed-in user | They open `/settings` | They see the groups You (Time zone, My address), Reminders (Email), Gift ideas (Over-budget allowance), Paying for gifts (Zinc), each row with its value, and no Save button. My address follows today's rule (shown only with a list, a saved address, or a failed load); its value is the first address line, "Not added", or "Couldn't load". |
| AC-2 | Settings is open | The user picks a time zone on the Time zone row | It saves without another tap, the row shows the new zone and a "Saved" tick; reloading shows the new zone. Several quick picks (or arrow keys on the closed picker) save only the last one, with one result shown. The row's accessible name is "Time zone" plus its value. |
| AC-2b | A user with no saved time zone | They open `/settings` | The row shows "Not set (using X)", where X is the zone from the request's location header (as `lib/today.ts` does); picking any zone, X included, saves it. Nothing is saved until they pick. |
| AC-3 | Saving the time zone fails | — | The error shows under the row and the picked zone stays shown; reloading shows the previously saved zone. A zone is valid if `Intl.DateTimeFormat` accepts it (so aliases like `Asia/Calcutta` pass), not by list membership. |
| AC-4 | `/settings/over-budget` is open | The user changes the number and leaves the box, presses Enter, or goes Back straight away | It saves once (compared with the last saved value) with a "Saved" tick, and the Settings row shows the new % without a reload, including when Back was tapped straight from the box. No change saves nothing. |
| AC-5 | `/settings/over-budget` is open | The user enters something that isn't a whole number 0–100 and leaves the box | today's "Enter a whole number from 0 to 100." (same source as `parseOverBudgetPct`'s range) shows under the box, the typed text stays, and nothing is saved. |
| AC-6 | `/settings/reminders` is open | The user taps "Send me a test email" | It sends as it does today, with the same "Sent" and error lines. |
| AC-7 | `/settings/address` is open | The user adds, changes or removes their address | It behaves exactly as today's My address section (existing `my-address` tests pass, pointed at the new page). The list page's "Change it in Settings" link and the "Check my address" email action land on this page. Opened directly by someone the row would be hidden for, it redirects to `/settings`. After a save, coming back to the page or to `/settings` shows the new address. |
| AC-8 | `/settings/paying` is open | — | Every state of today's Paying for gifts section shows and works as before (existing `paying-for-gifts` tests pass, pointed at the new page). The "Finish setting up payment" email action lands on this page. `/settings/paying` exports `maxDuration = 300`, checked by a unit test, because actions run under the limit of the page they're called from. |
| AC-9 | The Zinc row on Settings | — | Its value never needs a Zinc call. Every state has a value, tested one by one: no paid features → "Not available yet"; paused with a connection → "Paused"; Zinc not switched on here → "Not available yet"; not connected → "Not set up"; connecting → "Connecting"; connected without a phone → "Add your phone"; connected → "Connected"; failed load → "Couldn't load" (caught with `unstable_rethrow`, never takes Settings down). |
| AC-10 | Any detail page | The user saves something and taps Back | They return to `/settings` and the row shows the new value without a reload; going back into the page shows no stale "Saved" tick, error or open form. Every save revalidates `/settings` and its own page. |
| AC-11 | A signed-in user on WebKit and Chromium, with and without a saved zone | They open `/settings` | No hydration error. The time zone options and the default come from the server, never from the browser during render, and a saved zone missing from the server's list still shows (ALL-102). |
| AC-12 | The screenshot gallery | `pnpm gallery` runs | Settings is captured after it loads (not "Loading your settings…"), plus the four detail pages. The screens page is republished. |
| AC-13 | Phone and desktop, light and dark | — | Rows are at least 44 px tall (the time zone picker covers its whole row), nothing overflows at 320 px on `/settings` and all four detail pages, and desktop uses the same narrow column (`@layout` test). |
| AC-14 | Every other link into Settings | — | Updated to the new pages and covered by tests: the share switch and `check_my_address` (`/settings/address`), `hold_setup` and the engine's `walletUrl` fallback written into sent emails (`/settings/paying`), the live check `e2e-live/all-32-paying-for-gifts.spec.ts`, and `links.test.ts`. The dead `#my-address` scroll code is removed. |

### Out of scope

- Moving other edit screens to save as you go, and a person's details as rows: ALL-127.
- New settings, or turning email reminders off (there's only one channel).
- Showing the Zinc balance on the Settings row (it needs a Zinc call; the balance stays on the Paying for gifts page).

### Open questions

None left; see below.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Sections vs list of rows | List of rows opening detail pages (option B) | Owner, 2026-11-16: the standard pattern for settings screens |
| Save button or save as you go | Save as you go, except the address | Owner, 2026-11-16 (T71); an address is only valid whole |
| Time zone: own page or picker on the row | The browser's own picker on the row, styled as a row | Owner, 2026-11-16: a page holding one select adds a tap for nothing; T71 amended to allow a picker on the row for a single choice |
| No saved time zone | Show "Not set (using X)" until they pick | **[Claude's call]** principle 10, and honest; easy to switch to saving the location-based zone later |
| Zinc row value | Database only: Connected / Not set up / Not available yet / Paused | **[Claude's call]** the Settings list shouldn't wait on Zinc |
| URLs | `/settings/over-budget`, `/settings/reminders`, `/settings/address`, `/settings/paying` | **[Claude's call]** plain names; the email actions compute their link when clicked, so old emails follow the new paths |
| Old `/settings` and `/settings#my-address` links | `/settings` keeps working (it's the list); `#my-address` isn't kept | Action links compute their path at click time. The one path baked into sent emails is the `walletUrl` fallback to `/settings`, which still lands on the list, one tap from Paying for gifts |

## Principles check

- **Simplest version?** Reuses today's address and Zinc components as-is on their own pages; only the list, the two save-as-you-go controls and the time zone fix are new. No two-pane desktop layout.
- **Hard-coded values?** None new. The allowance range comes from `parseOverBudgetPct` as today.
- **Product boundaries?** None crossed; time zone stays on the shared profile, the allowance in the concierge (T26).
- **New personal data?** None.
- **Docs and decisions:** T71 and `design/ui.md` > Editing and saving (done, e138ed4). `design/technical-design.md` if it names the Settings layout; the screens page.

## Plan

Written after the spec review.

## Before coding: consistency check

- [ ] Every acceptance criterion maps to a task and a test.
- [ ] Every task traces back to a story or criterion (nothing extra).
- [ ] No open questions are left.
- [ ] Adversarial review of the spec done, and again of the plan; blockers fixed, owner decisions answered.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on ALL-115 and ALL-102.
- [ ] Screenshots, phone and desktop, light and dark.
- [ ] Live check after deploy, or listed as **Still open**.
- [ ] Every acceptance-criteria box ticked on both tickets.
