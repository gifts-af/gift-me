# ALL-127 Save as you go, and a person's page as rows: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every screen that changes something that already exists saves as you go (T71), a person's page becomes a short list of rows, and My list saves each change as it's made without ever losing a gift or a claim.

**Links:** [ALL-127](https://linear.app/allens-forever/issue/ALL-127) · T71 and `design/ui.md` > Editing and saving · ALL-115 (Settings rows) · ALL-120 (Budget) · ALL-93 (saved gifts) · decision 39 (owners never see claims) · mock-ups approved 2026-11-16 (phone screens; desktop option A, the same centred column), then revised by the owner's decisions after the spec review (below).

## Spec: what it does

### Who it's for and what they can do

1. **Mom's page at a glance:** as a buyer, Mom's page shows what we know, then rows for who she is, her occasions and her gifts, so I see everything without scrolling past forms.
2. **Change a detail:** as a buyer, I open "About Mom", change her birthday, and it's saved. No Save button, a "Saved" tick, and my change stays on screen if the save fails.
3. **Fix a fact:** as a buyer, I tap a fact on Mom's page, correct it in place, and it's saved. A ✨ suggestion I agree with gets "Looks right".
4. **My list saves itself:** as a list owner, adding or removing a gift saves without a Save button, and Undo after a remove really undoes it. No gift, and no claim on a gift, is ever lost to a stale tab.
5. **Nothing lost on close:** as a user, a Settings change or a pending My list change is sent when I close the tab.

### The screens

**Mom's page** (`/people/[id]`), top to bottom:
- Header: photo, name, "Mother · next occasion", and the readiness banner, as today. A failed photo from the add flow (`?photo=failed`) still says so here.
- **What we know:** the facts list stays. Tapping a fact opens it in place: text and category save as you go, a "Use for gift ideas" switch replaces Turn off, Delete keeps its confirm, and an unconfirmed ✨ fact shows "Looks right". No Save button.
- **About Mom** row ›, value like "Mother · Birthday Mar 14", opening the About screen.
- **Occasions:** today's switches, in rows.
- **Gifts:** Budget › (ALL-120), Saved gifts › (a count), Their list › ("Linked" or "Not linked"), Shipping address › (today's summary).
- Delete Mom, as today.

**About Mom** (`/people/[id]/about`), one screen (owner, 2026-11-16), each field saving on its own:
- Name: saves on leaving the field, Enter, or leaving the page in the app. Empty shows the error and keeps the saved name.
- Who she is to you: the phone's own picker; saves when picked.
- Birthday: month and day save when both are set (a change moves the occasion, never removes it). The year is off until there's a date, and saves on leaving it. **"Remove birthday"** is a button with a confirm; it clears the year too. Clearing the fields saves nothing.
- Anniversary: the same, without a year, with "Remove anniversary".
- Photo: today's picker, which saves on pick.

**Moved, unchanged inside:** Saved gifts (`/people/[id]/saved-gifts`), Their list (`/people/[id]/list`), Shipping address (`/people/[id]/address`, keeping its one Save and the 300 s time limit, since saving it can place held orders). Budget stays at `/people/[id]/budget`.

**Old links keep working:** `/people/[id]?address=open` (in emails already sent) redirects to the address screen. The Home card's "Add birthday" opens About Mom.

**My list** (`/lists`), signed in:
- Adding a gift saves straight away.
- Removing one hides it and shows "Removed {gift} · Undo" for 6 seconds (`UNDO_MS`). Only when that window closes, or the tab closes, is the remove sent. Undo never reaches the server, so a claim on that gift is never lost.
- One save at a time; a change made during a save goes in the next one.
- The header says "Saved", "Saving…", or "Couldn't save" with "Try again".
- **A stale tab or device can't overwrite newer gifts:** each save carries the list's version, and `save_list` refuses one that's out of date. The app then loads the latest list and says "Your list changed somewhere else. We've loaded the latest."
- The "Unsaved changes" bar and its Save button go. A warning before leaving stays only while a save is waiting or has failed.
- Gifts carried over from before signing in (the guest stash) save themselves on arrival.
- Guests keep today's behaviour: there's nowhere to save to.

**Settings:** the over-budget field and the time zone picker also send a pending change when the tab closes.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Mom's page | It loads | The groups and rows above; the Edit form and the address, saved gifts and list sections are gone from the page |
| AC-2 | About Mom | The name is changed and the field left | Saved, "Saved" shows, and Mom's page and Home show the new name. Rounds are not resumed by this save |
| AC-3 | About Mom | The name is emptied and left | An error by the field; the saved name is unchanged |
| AC-4 | About Mom | Aunt is picked | Saved; the header reads "Aunt" |
| AC-5 | About Mom, birthday Mar 14 | The day is changed to 15 | The same occasion is moved (its id, and any open round, stay) |
| AC-6 | About Mom | Month and day are cleared | Nothing is saved |
| AC-7 | About Mom | "Remove birthday" is confirmed | The birthday and the birth year are removed |
| AC-8 | About Mom | The page is opened before its scripts load | The fields are disabled until they can save (ALL-110) |
| AC-9 | A fact on Mom's page | Its text is changed and left, its category picked, its switch flipped | Each saves on its own with "Saved"; a failed save keeps the text and shows the error |
| AC-10 | An unconfirmed ✨ fact | "Looks right" is tapped | It's confirmed and the ✨ goes |
| AC-11 | My list | A gift is added, then another removed and the window passes | Both saved; a reload shows them |
| AC-12 | My list | Undo is tapped within 6 s | The gift is back and nothing was sent; its claim (pgTAP: a claimed gift) is untouched |
| AC-13 | My list | Two gifts are added quickly | Both saved, saves never overlap |
| AC-14 | My list in two tabs | Tab A adds a gift, then stale tab B saves | B's save is refused, B reloads the latest and says so; A's gift and any claims stay |
| AC-15 | My list | A save fails | "Couldn't save" with "Try again"; the gifts on screen stay; leaving warns while it's unsaved |
| AC-16 | My list, a guest | A gift is added | Today's behaviour |
| AC-17 | Settings or My list | A change is pending and the tab closes | It's sent with a request the browser keeps alive (component test on the call) |
| AC-18 | An old address email link | It's opened | It lands on the address screen |
| AC-19 | 375 px light and dark, and desktop | Mom's page, About Mom and the moved screens | No sideways scroll, one `@layout` test |

### Out of scope

| What | Why |
|---|---|
| Creating things (add a person, add a gift, saved gifts, linking a list, request access) | T71 keeps one button for creating |
| Guided questions | Answering creates facts |
| Budget and address screens' own Save | T71: money and grouped fields |
| Saving typed person or fact text when the tab is closed mid-typing | Leaving the field or the page in the app saves it; only a hard close mid-word loses it **[Claude's call]** |
| A side-by-side desktop layout; editing a gift on My list | Owner, 2026-11-16 |

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Scope | Every edit screen, including My list | Owner, 2026-11-16 |
| Desktop | The same centred column (option A) | Owner, 2026-11-16 |
| One About screen, or a screen per field? | One "About Mom" screen, each field saving on its own | Owner, 2026-11-16 (review pick) |
| Facts | Edited in place on Mom's page, saving as you go | Owner, 2026-11-16 (review pick) |
| Removing a date | An explicit "Remove" with a confirm; clearing the fields never saves | Owner, 2026-11-16 (review pick). Removing an occasion skips its open rounds, and a new date makes a new occasion, so an accidental clear could lead to a second gift |
| Stale saves on My list | `save_list` gains an optional `p_expected_updated_at`; a mismatch raises `40001`. The app sends it and reloads on refusal | Owner, 2026-11-16 (review pick). Optional, so older callers still work (E4); told Jim |
| Undo | The remove is held on the device for `UNDO_MS` (6000) and sent only after | A sent remove deletes the row and its claims (cascade); undoing would bring the gift back unclaimed |
| Saving one person field | Narrow actions per field, which never resume rounds; only the address does | `updatePerson` resumes rounds, which can place orders; a name doesn't need that |
| Confirming an AI fact | A "Looks right" button | Save used to confirm even with no change; save-as-you-go sends nothing unchanged |
| Closing the tab | Settings and My list send pending changes with `fetch(..., { keepalive: true })` to small POST routes | A server action started on `pagehide` is cancelled by the browser |

## Principles check

- **Simplest version?** One About screen instead of five; facts stay in place; one shared as-you-go field hook (extracted from ALL-115's over-budget field: its second and third uses).
- **Hard-coded values?** `UNDO_MS` = 6000 is UI timing, like ALL-115's picker wait.
- **Product boundaries?** My list's changes stay in `modules/lists`.
- **New personal data?** None.
- **E4:** the keepalive routes validate their bodies; `save_list` stays compatible.
- **E7/E9:** one expand-only migration (an optional parameter). Seen working by a live check; Vercel rollback.
- **Docs:** `design/ui.md` (person page, About, My list), `design/decisions.md` (a T# for the stale-save check and the hold-then-send remove), `design/operations.md` if routes are added, the gallery, `e2e-live/all-93-saved-gifts.spec.ts`.

## Plan

**Architecture:** a shared client hook `useAutosave` (from ALL-115's over-budget field) gives every as-you-go field the same save-on-blur, skip-if-unchanged, failed-keeps-text and hidden-page behaviour. Mom's page and About Mom live in `app/people`, with narrow server actions per field. My list changes stay in `modules/lists`, with one queued saver and an optional version check in `save_list`.

**Execution:** Task 1 first, on the branch. Then Tasks 2, 3 and 4 run **in parallel**, each by its own agent in its own worktree, branched from Task 1's commit. Then Task 5 merges them, and the whole branch gets one review.

**Global constraints**
- Copy: "Saved", "Saving…", "Couldn't save", "Try again", "Removed {name}", "Undo", "Looks right", "Remove birthday", "Remove anniversary", "Your list changed somewhere else. We've loaded the latest.", "That didn't save. Try again."
- `UNDO_MS = 6000`.
- Tests that look for elements assert `toBeVisible` (hidden pages stay in the document).
- Fields disabled until hydrated (`useHydrated`, ALL-110).

### Task 1: the shared hook and Settings on close (me, before the split)

**Files:** create `apps/web/lib/use-autosave.ts`, its test, and `apps/web/app/api/settings/save-on-close/route.ts` plus its test; modify `apps/web/app/settings/over-budget-field.tsx` and `time-zone-row.tsx` to use them.

**Produces:** `useAutosave({ initial: string; save: (value: string) => Promise<SaveResult>; onClose?: (value: string) => void }) → { value, setValue, onBlur, onKeyDown, status: "idle" | "saving" | "saved" | "error", error }`. It saves on blur, on Enter and when hidden (the Activity cleanup) only if changed; a failed save keeps the text; `onClose` runs on `pagehide` with a pending change.

- [ ] Tests: the over-budget field's existing tests still pass; the hook calls `save` once per change, not when unchanged; a failure keeps the value and exposes `error`; `pagehide` calls `onClose` with the pending value; the route validates `{ kind: "over_budget" | "timezone", value }` and refuses anything else.
- [ ] Commit `refactor: one save-as-you-go hook, and Settings saves on tab close (ALL-127)`.

### Task 2: Mom's page and About Mom (agent A) [P]

**Files:** `app/people/[id]/person-view.tsx` (rows), new `app/people/[id]/about/{page,about-form}.tsx`, `app/people/[id]/{saved-gifts,list,address}/page.tsx`, `app/people/[id]/page.tsx` (the `?address=open` redirect), `app/people/actions.ts` (narrow actions), `modules/concierge/people/{service,store,rules}.ts` (narrow updates: `renamePerson`, `setRelationship`, `setDatedOccasion`, `setBirthYear`, `removeDatedOccasion`), `components/home/person-card.tsx` ("Add birthday" link), tests, `e2e/people.spec.ts`, `e2e/person-address.spec.ts`, `e2e/round-engine.spec.ts:222`, `e2e-live/all-93-saved-gifts.spec.ts`.

- [ ] Service tests first: each narrow update changes only its field; `setDatedOccasion` moves an existing occasion (same id) and adds one only when none exists; `removeDatedOccasion("birthday")` clears the birth year; none resumes rounds.
- [ ] Component tests: the rows and their values; About Mom saves each field alone, disabled before hydration, remove asks first, clearing the fields sends nothing.
- [ ] Route tests: the address page keeps `maxDuration = 300`; `?address=open` redirects.
- [ ] e2e: the people journey through About Mom; address and live specs updated; one `@layout` test over Mom's page, About Mom and the moved screens.
- [ ] Commit `feat: a person's page as rows, and About Mom saves as you go (ALL-127)`.

### Task 3: facts in place (agent B) [P]

**Files:** `app/people/[id]/what-we-know.tsx` and its test, `app/people/actions.ts` (`confirmFactAction` only), `modules/concierge/profile/profile.ts` (`confirmFact`), `e2e/what-we-know.spec.ts`.

- [ ] Tests first: tapping a fact opens it in place; text saves on blur through `useAutosave`; category saves on change; the switch saves; Delete confirms; "Looks right" shows only on unconfirmed facts and confirms; no Save button.
- [ ] Commit `feat: facts edit in place and save as you go (ALL-127)`.

### Task 4: My list (agent C) [P]

**Files:** `supabase/migrations/<next>_save_list_version.sql` and its pgTAP test; `modules/lists/actions/lists.ts`, `modules/lists/components/gift-app.jsx` and its tests; a new `app/api/lists/save-on-close/route.ts`; `e2e/top-bar.spec.ts` and the lists e2e specs.

- [ ] pgTAP first: `save_list` with the current `updated_at` saves; with an older one it raises `40001` and changes nothing; without the parameter it behaves as before; a claim on a kept gift survives a save.
- [ ] Component tests: an add saves at once; a remove waits `UNDO_MS` and Undo sends nothing; saves queue; a refused (stale) save reloads with the notice; a failed save shows Try again and keeps `beforeunload` armed; guests unchanged; carried guest gifts save on arrival; `pagehide` sends the pending list to the route with `keepalive`.
- [ ] e2e: top-bar's unsaved tests replaced by the new behaviour; one journey adds, removes, waits, reloads.
- [ ] Commit `feat: My list saves as you go, safely (ALL-127)`.

### Task 5: merge, docs, review (me)

- [ ] Merge the three worktree branches onto the ticket branch; resolve `actions.ts` (A and B both add to it).
- [ ] Full checks, all e2e, `pnpm db:test`, gallery; docs (ui.md, the T#, operations if needed).
- [ ] One whole-branch review, fixes, PR.

## Review focus

1. A remove that never sends (the tab closes inside the Undo window): `pagehide` sends it.
2. Two About Mom fields saved at once (name then Enter on the date): narrow actions don't clobber.
3. A stale My list tab: refused, never overwrites.
4. A Next-hidden page saving after it's hidden: the hook's hidden-page rule from ALL-115.
5. The old address email link and the Home "Add birthday" link.
