# ALL-127 Save as you go, and a person's page as rows: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every screen that changes something that already exists saves as you go (T71), a person's page becomes a short list of rows, and My list saves each change as it's made without ever losing a gift or a claim.

**Links:** [ALL-127](https://linear.app/allens-forever/issue/ALL-127) · T71 and `design/ui.md` > Editing and saving · ALL-115 (Settings rows) · ALL-120 (Budget) · ALL-93 (saved gifts) · decision 39 (owners never see claims) · mock-ups approved 2026-11-16 (phone screens; desktop option A, the same centred column), then revised by the owner's decisions after the spec review and the plan review (below).

## Spec: what it does

### Who it's for and what they can do

1. **Mom's page at a glance:** as a buyer, Mom's page shows what we know, then rows for who she is, her occasions and her gifts, so I see everything without scrolling past forms.
2. **Change a detail:** as a buyer, I open "About Mom", change her birthday, and it's saved. No Save button, a "Saved" tick, and my change stays on screen if the save fails.
3. **Fix a fact:** as a buyer, I tap a fact on Mom's page, correct it in place, and it's saved. A ✨ suggestion I agree with gets "Looks right".
4. **My list saves itself:** as a list owner, adding or removing a gift saves without a Save button, and Undo after a remove really undoes it. No gift, and no claim on a gift, is ever lost to a stale tab, and a stale tab never loses its own change either.
5. **Nothing lost on leaving:** as a list owner, a remove still waiting in its Undo window is sent when I leave the page, switch away, close the tab or sign out.

### The screens

**Mom's page** (`/people/[id]`), top to bottom:
- Header: photo, name, "Mother · next occasion", and the readiness banner, as today. A failed photo from the add flow (`?photo=failed`) still says so here.
- **What we know:** the facts list stays. Tapping a fact opens it in place: text and category save as you go (one save carrying both), a "Use for gift ideas" switch replaces Turn off, Delete keeps its confirm, and an unconfirmed ✨ fact shows "Looks right". No Save button.
- **About Mom** row ›, value like "Mother · Birthday Mar 14", opening the About screen.
- **Occasions:** today's switches, in rows.
- **Gifts:** Budget › (ALL-120), Saved gifts › (a count), Their list › ("Linked" or "Not linked"), Shipping address › (today's summary).
- Delete Mom, as today.

**About Mom** (`/people/[id]/about`), one screen (owner, 2026-11-16), each field saving on its own:
- Name: saves on leaving the field, Enter, or leaving the page in the app. Empty shows the error and keeps the saved name.
- Who she is to you: the phone's own picker; saves when picked.
- Birthday: month and day save together **when you leave the date fields**, not on each pick, so passing through another date on the way never saves it. Only a real date saves ("February 31" shows "That date doesn't exist"). A change moves the occasion, never removes it. The year is off until there's a date, and saves on leaving it. **"Remove birthday"** is a button with a confirm; it clears the year too. Clearing the fields saves nothing.
- Anniversary: the same, without a year, with "Remove anniversary".
- Photo: today's picker, which saves on pick.

**Moved, unchanged inside:** Saved gifts (`/people/[id]/saved-gifts`), Their list (`/people/[id]/list`), Shipping address (`/people/[id]/address`, keeping its one Save and the 300 s time limit, since saving it can place held orders). Budget stays at `/people/[id]/budget`. Mom's page drops its 300 s limit.

**Old links keep working:** `/people/[id]?address=open` (in emails already sent) redirects to the address screen. The Home card's "Add birthday" opens About Mom.

**My list** (`/lists`), signed in:
- Adding a gift saves straight away.
- Removing one hides it and shows "Removed {gift} · Undo" for 6 seconds (`UNDO_MS`). The remove is sent only when that window closes, or earlier when: a second gift is removed (the first is sent then, and the bar shows the second), the page is left in the app, the tab is hidden or closed, or Sign out is picked (sent and waited for before signing out). Undo never reaches the server, so a claim on that gift is never lost.
- An add made during the Undo window saves the gifts on screen plus the held one in its old place.
- One save at a time; a change made during a save goes in the next one.
- The header says "Saved", "Saving…", or "Couldn't save" with "Try again".
- **A stale tab or device can't overwrite newer gifts:** each save carries the list's version, and the database refuses one that's out of date. The app then takes the latest list, puts its own unsaved changes back on top (its new gifts and any held remove), saves once more, and says "Your list changed somewhere else. We've loaded the latest." If that save is refused too, it shows "Couldn't save".
- A tab that opened before the list existed can't create a second list: the save is refused as stale and handled as above.
- The "Unsaved changes" bar and its Save button go. A warning before leaving stays only while a save is waiting or has failed.
- Gifts carried over from before signing in (the guest stash) save themselves on arrival.
- Guests keep today's behaviour: there's nowhere to save to.

**Settings:** unchanged (owner, 2026-11-16: no save on tab close).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Mom's page | It loads | The groups and rows above; the Edit form and the address, saved gifts and list sections are gone from the page |
| AC-2 | About Mom | The name is changed and the field left | Saved, "Saved" shows, and Mom's page and Home show the new name. Rounds are not resumed by this save |
| AC-3 | About Mom | The name is emptied and left | An error by the field; the saved name is unchanged |
| AC-4 | About Mom | Aunt is picked | Saved; the header reads "Aunt" |
| AC-5 | About Mom, birthday Mar 14 | The month is picked as Nov, then the day as 30, then the fields left | One save, to Nov 30; the same occasion is moved (its id, and any open round, stay) |
| AC-6 | About Mom | Month and day are cleared, or Feb 31 is picked | Nothing is saved; Feb 31 shows "That date doesn't exist" |
| AC-7 | About Mom | "Remove birthday" is confirmed | The birthday and the birth year are removed |
| AC-8 | About Mom | The page is opened before its scripts load | The fields are disabled until they can save (ALL-110) |
| AC-9 | A fact on Mom's page | Its text is changed and left, its category picked, its switch flipped | Each saves with "Saved", and neither text nor category undoes the other; a failed save keeps the text and shows the error |
| AC-10 | An unconfirmed ✨ fact | "Looks right" is tapped | It's confirmed and the ✨ goes |
| AC-11 | My list | A gift is added, then another removed and the window passes | Both saved; a reload shows them |
| AC-12 | My list | Undo is tapped within 6 s | The gift is back and nothing was sent; its claim (pgTAP: a claimed gift) is untouched |
| AC-13 | My list | Two gifts are added quickly | Both saved, saves never overlap |
| AC-14 | My list in two tabs | Tab A adds gift X; stale tab B adds gift Y | B's first save is refused; B ends with X and Y saved, shows the notice; A's gift and any claims stay |
| AC-15 | My list | A save fails | "Couldn't save" with "Try again"; the gifts on screen stay; leaving warns while it's unsaved |
| AC-16 | My list, a guest | A gift is added | Today's behaviour |
| AC-17 | My list, a remove held | The tab is hidden, the page left in the app, or the tab closed | The remove is sent (to the close route with `keepalive` when the tab goes) |
| AC-18 | My list, a remove held | Sign out is picked | The remove is saved before signing out |
| AC-19 | An old address email link | It's opened | It lands on the address screen |
| AC-20 | 375 px light and dark, and desktop | Mom's page, About Mom and the moved screens | No sideways scroll, one `@layout` test |

### Out of scope

| What | Why |
|---|---|
| Creating things (add a person, add a gift, saved gifts, linking a list, request access) | T71 keeps one button for creating |
| Guided questions | Answering creates facts |
| Budget and address screens' own Save | T71: money and grouped fields |
| Saving typed person or fact text when the tab is closed mid-typing | Leaving the field or the page in the app saves it; only a hard close mid-word loses it **[Claude's call]** |
| Settings saving on tab close | Owner, 2026-11-16 (plan review): the time zone saves within 0.4 s, and typing cut off by a close is accepted elsewhere |
| A side-by-side desktop layout; editing a gift on My list | Owner, 2026-11-16 |
| Dropping the old `save_list` | A cleanup migration after this ships (E7, expand then contract); ticket raised with the PR |

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Scope | Every edit screen, including My list | Owner, 2026-11-16 |
| Desktop | The same centred column (option A) | Owner, 2026-11-16 |
| One About screen, or a screen per field? | One "About Mom" screen, each field saving on its own | Owner, 2026-11-16 (review pick) |
| Facts | Edited in place on Mom's page, saving as you go | Owner, 2026-11-16 (review pick) |
| Removing a date | An explicit "Remove" with a confirm; clearing the fields never saves | Owner, 2026-11-16 (review pick). Removing an occasion skips its open rounds, and a new date makes a new occasion, so an accidental clear could lead to a second gift |
| When a date saves | On leaving the date fields, and only a real date | Plan review: saving each pick saves dates passed through, and a passing date can let the daily tick start a round (money) |
| Stale saves on My list | A new function `lists.save_list_checked(p_list_id, p_title, p_items, p_expected text)` returns `{ id, updated_at }`; the check sits in the `UPDATE … WHERE updated_at::text = p_expected`, so a save queued behind another re-checks after it commits; a mismatch raises our own code `GL409`. With no list id it creates the list only if the caller has none, otherwise refuses as stale. The old `save_list` stays untouched for a rollback | Owner, 2026-11-16 (spec review pick); plan review: a new function avoids PostgREST overload clashes and keeps the old code working after a Vercel rollback (E7). The version stays a string end to end, since a JS `Date` drops microseconds and would refuse every save. Told Jim |
| A refused save | The app takes the latest list and version returned with the refusal, re-applies its own unsaved adds (by id) and held remove, and saves once more | Plan review: just reloading would lose the stale tab's own change (story 4) |
| Undo | The remove is held on the device for `UNDO_MS` (6000) and sent only after | A sent remove deletes the row and its claims (cascade); undoing would bring the gift back unclaimed |
| A second remove inside the window | Sends the first, and Undo moves to the second | One held remove keeps the rules simple [Claude's call] |
| Saving one person field | Narrow actions per field, which never resume rounds; only the address does | `updatePerson` resumes rounds, which can place orders; a name doesn't need that |
| Saving a fact | One save per fact always carrying its current text and category | `updateFact` writes both, so separate saves could put back the other's old value |
| Confirming an AI fact | A "Looks right" button | Save used to confirm even with no change; save-as-you-go sends nothing unchanged |
| Closing the tab on My list | A held remove goes to `POST /api/lists/save-on-close` with `fetch(..., { keepalive: true })`, carrying only `{ listId, version, removeIds }`; the server reads the list, drops those ids and saves through the same checked path | A server action started on `pagehide` is cancelled by the browser; keepalive bodies are capped at 64 KiB and a list can hold 500 gifts |
| Releases | Two PRs: Mom's page, About Mom and facts in one; My list in another | Owner, 2026-11-16 (plan review): My list can be rolled back alone (E7, T19) |

## Principles check

- **Simplest version?** One About screen instead of five; facts stay in place; one shared as-you-go field hook (extracted from ALL-115's over-budget field: its second and third uses). Settings is left alone.
- **Hard-coded values?** `UNDO_MS` = 6000 is UI timing, like ALL-115's picker wait.
- **Product boundaries?** My list's changes stay in `modules/lists`.
- **New personal data?** None.
- **E4:** the close route validates its body (ids only, JSON only, same origin, signed in).
- **E6/E9:** events `list_save_stale` and `list_close_sent` (ids only) show both paths on production; a live check per PR.
- **E7:** one expand-only migration (a new function beside the old one). Vercel rollback per PR.
- **Docs:** `design/ui.md` (person page, About, My list), `design/decisions.md` (a T# for the checked save and the hold-then-send remove), `design/operations.md` (the close route), the gallery, `e2e-live/all-93-saved-gifts.spec.ts`.

## Plan

**Architecture:** a shared client hook `useAutosave` (from ALL-115's over-budget field) gives every as-you-go field the same save-on-blur, skip-if-unchanged, failed-keeps-value and hidden-page behaviour. Mom's page and About Mom live in `app/people`, with narrow server actions per field. My list changes stay in `modules/lists`, with one queued saver and a checked save function.

**Execution:**
- **PR 1** (branch `aarontallen/all-127-person-rows`): Task 1 first. Then Tasks 2 and 3 run **in parallel**, each by its own agent in its own worktree, branched from Task 1's commit.
- **PR 2** (branch `aarontallen/all-127-my-list`, from `main`): Task 4, by its own agent in parallel with Tasks 2 and 3. It doesn't use the hook.
- Task 5 merges PR 1's branches, and each PR gets one whole-branch review.
- **Shared local database:** apply migrations with `supabase migration up`, never `db reset`, which would wipe the other agents' e2e data mid-run.
- **The hook is settled in Task 1.** Agents A and B don't change it; if it can't do something they need, they stop and say so.

**Global constraints**
- Copy: "Saved", "Saving…", "Couldn't save", "Try again", "Removed {name}", "Undo", "Looks right", "Remove birthday", "Remove anniversary", "That date doesn't exist", "Your list changed somewhere else. We've loaded the latest.", "That didn't save. Try again."
- `UNDO_MS = 6000`.
- Tests that look for elements assert `toBeVisible` (hidden pages stay in the document).
- Fields disabled until hydrated (`useHydrated`, ALL-110).

### Task 1: the shared hook (me, before the split)

**Files:** create `apps/web/lib/use-autosave.ts` and its test; modify `apps/web/app/settings/over-budget-field.tsx` to use it. `time-zone-row.tsx` stays as it is (its 400 ms wait and hidden-page rule differ).

**Produces:** `useAutosave<T>({ initial: T; save: (value: T) => Promise<SaveResult>; equals?: (a: T, b: T) => boolean }) → { value, setValue, commit(next?: T), onBlur, onKeyDown, status: "idle" | "saving" | "saved" | "error", error }`.
- `initial` is read once; callers re-key the component to reset it.
- `commit()` saves the current value now, for choices and switches; `commit(next)` sets and saves. `onBlur` and Enter call `commit()`.
- Saves only if changed from the last saved value; one save at a time, the latest value wins.
- A failed save keeps the value and sets `error`.
- When the page is hidden (the Activity cleanup), a pending change is saved, as ALL-115 does.
- `T` can be an object, so month and day save together.

- [ ] Tests first: the over-budget field's existing tests still pass; `save` is called once per change and not when unchanged; `commit(next)` saves at once; an object value saves as one call; a failure keeps the value and exposes `error`; a save during a save queues the latest.
- [ ] Commit `refactor: one save-as-you-go hook (ALL-127)`.

### Task 2: Mom's page and About Mom (agent A) [P]

**Files:** `app/people/[id]/person-view.tsx` (rows), new `app/people/[id]/about/{page,about-form}.tsx`, `app/people/[id]/{saved-gifts,list,address}/page.tsx`, `app/people/[id]/page.tsx` (the `?address=open` redirect; `maxDuration` removed), `app/people/actions.ts` (narrow actions), `modules/concierge/people/{service,store,rules,people}.ts` (narrow updates: `renamePerson`, `setRelationship`, `setDatedOccasion`, `setBirthYear`, `removeDatedOccasion`), `modules/concierge/index.ts` (their exports), `components/home/person-card.tsx` ("Add birthday" link), tests, `e2e/people.spec.ts`, `e2e/person-address.spec.ts`, `e2e/round-engine.spec.ts:222`, `e2e-live/all-93-saved-gifts.spec.ts`.

- [ ] Service tests first: each narrow update changes only its field; `setDatedOccasion` refuses a date that doesn't exist, moves an existing occasion (same id) and adds one only when none exists; `removeDatedOccasion("birthday")` clears the birth year (year first, then the occasion; two writes, accepted **[Claude's call]**); none resumes rounds.
- [ ] Component tests: the rows and their values; About Mom saves each field alone; the date saves once on leaving the date fields after month and day both change; Feb 31 shows the error and sends nothing; disabled before hydration; remove asks first; clearing the fields sends nothing.
- [ ] Route tests: the address page keeps `maxDuration = 300`; `?address=open` redirects.
- [ ] e2e: the people journey through About Mom; address and live specs updated; one `@layout` test over Mom's page, About Mom and the moved screens.
- [ ] Commit `feat: a person's page as rows, and About Mom saves as you go (ALL-127)`.

### Task 3: facts in place (agent B) [P]

**Files:** `app/people/[id]/what-we-know.tsx` and its test (it imports `confirmFactAction` itself, so `person-view.tsx` doesn't change for B), `app/people/actions.ts` (`confirmFactAction` only), `modules/concierge/profile/profile.ts` (`confirmFact`), `modules/concierge/index.ts` (that one export), `e2e/what-we-know.spec.ts`.

- [ ] Tests first: tapping a fact opens it in place; text saves on blur and category on change, each save carrying both current values (a text save after a category save keeps the new category); the switch saves; Delete confirms; "Looks right" shows only on unconfirmed facts and confirms; no Save button.
- [ ] Commit `feat: facts edit in place and save as you go (ALL-127)`.

### Task 4: My list (agent C, PR 2) [P]

**Files:** `supabase/migrations/<next>_save_list_checked.sql`, `supabase/tests/lists.test.sql`, `packages/db` types (`pnpm db:types`); `modules/lists/lib/lists.ts` (`getMyList` returns the version, read in the same query as the list), `modules/lists/actions/lists.ts`, `modules/lists/components/gift-app.jsx`, `save-button.jsx` and their tests; new `app/api/lists/save-on-close/route.ts` and its test; `components/app-shell/account-menu.tsx` (Sign out waits for a held remove); `e2e/top-bar.spec.ts` and the lists e2e specs; `design/operations.md` (the route).

- [ ] pgTAP first: `save_list_checked` with the current version saves and returns the new one; with an older one it raises `GL409` and changes nothing; with no id it creates a list only when the caller has none, and otherwise raises `GL409`; two saves with the same version, the second refused; a claim on a kept gift survives a save; old `save_list` unchanged.
- [ ] Action tests (local-db): `saveList` returns `{ ok: false, stale: true, items, version }` on `GL409` and logs `list_save_stale`; the version round-trips as a string.
- [ ] Route tests: refuses signed out, another origin, non-JSON, or anything but `{ listId: uuid, version: string, removeIds: uuid[] }`; drops only those ids; logs `list_close_sent`.
- [ ] Component tests: an add saves at once; a remove waits `UNDO_MS` and Undo sends nothing; a second remove sends the first; an add in the window keeps the held gift in its place; hidden tab, in-app leave and unmount send the held remove; `pagehide` posts to the route with `keepalive`; Sign out waits for it; saves queue; a stale refusal re-applies this tab's adds and held remove and saves once, then shows the notice; a second refusal shows "Couldn't save"; a failed save shows Try again and keeps `beforeunload` armed; guests unchanged; carried guest gifts save on arrival.
- [ ] e2e: top-bar's unsaved tests replaced by the new behaviour; one journey adds, removes, waits, reloads.
- [ ] Commit `feat: My list saves as you go, safely (ALL-127)`; docs (ui.md My list, the T#), live check, PR `Part of ALL-127`.

### Task 5: merge, docs, review (me, PR 1)

- [ ] Merge A's and B's branches onto `aarontallen/all-127-person-rows`; resolve `actions.ts` and `modules/concierge/index.ts` (both add to them).
- [ ] `e2e/gallery.shots.ts`: the new routes. Full checks, all e2e, `pnpm db:test`, gallery; docs (ui.md, the T#).
- [ ] One whole-branch review each for PR 1 and PR 2, fixes, PRs. PR 1 `Part of ALL-127`, the last to land says `Closes`.

## Review focus

1. A held remove that never sends: tab hidden, in-app leave, sign out, close.
2. A stale tab: refused, never overwrites, and keeps its own change.
3. A date passed through on the way to another: never saved.
4. A fact's text and category saved close together: neither undoes the other.
5. The old address email link and the Home "Add birthday" link.
