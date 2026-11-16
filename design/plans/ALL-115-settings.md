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
| Old `/settings` and `/settings#my-address` links | `/settings` keeps working (it's the list); `#my-address` isn't kept. The `walletUrl` fallback in new emails becomes `/settings/paying` | Action links compute their path at click time. Emails already sent with the old `/settings` fallback still land on the list, one tap from Paying for gifts |

## Principles check

- **Simplest version?** Reuses today's address and Zinc components as-is on their own pages; only the list, the two save-as-you-go controls and the time zone fix are new. No two-pane desktop layout.
- **Hard-coded values?** None new. The allowance range comes from `parseOverBudgetPct` as today.
- **Product boundaries?** None crossed; time zone stays on the shared profile, the allowance in the concierge (T26).
- **New personal data?** None.
- **Docs and decisions:** T71 and `design/ui.md` > Editing and saving (done, e138ed4). `design/technical-design.md` if it names the Settings layout; the screens page.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkboxes.

**Architecture:** `/settings` becomes a server-rendered list of rows; each detail is its own route under `app/settings/`, reusing today's address and Zinc components unchanged. Two new client controls save as you go: a time zone picker laid over its row, and the over-budget field. Values on the list come from the database only (a new `getPaymentSummary`), and the time zone list and default come from the server (ALL-102).

**Tech stack:** Next.js 16 App Router (server components, server actions, `revalidatePath`), Supabase, Vitest + Testing Library, Playwright.

### Global constraints

- Copy exactly as the spec: "Not set (using X)", "Not added", "Couldn't load", "Not available yet", "Paused", "Not set up", "Connecting", "Add your phone", "Connected", "Saved".
- Rows at least 44 px (`min-h-11`); the list has no teal button (ui.md).
- Every save action calls `revalidatePath("/settings")` and its own detail path.
- Every client detail component resets its local state on hide (the `useLayoutEffect(() => () => reset(), [])` pattern in `my-address.tsx`).
- A catch around request data starts with `unstable_rethrow(error)` (ALL-87). New server logs use `logEvent`, ids only (E6).
- Controls follow ALL-110 (faded until hydrated: `Button` does it; a plain control uses `useHydrated()`).
- The picker's save-coalescing delay (400 ms) is a UI timing, not a business value; it stays in code with a comment.

### Review focus

1. Back tapped straight from the over-budget box: the row on `/settings` shows the new %. Pinned in Task 7.
2. Arrow keys through the closed picker: only the last zone saves, one "Saved". Pinned in Task 2.
3. No saved zone on WebKit: no hydration error, nothing saved until a pick. Pinned in Task 7.
4. Coming back to a detail page after saving: no stale tick, error or open form. Pinned in Task 7.
5. A paid user with Zinc switched off here, or a failed summary load: Settings still renders with the right row text. Pinned in Tasks 3 and 5.

### Task 1: Time zones from the server (AC-3, AC-11)

**Files:** create `apps/web/lib/time-zones.ts`, `apps/web/lib/__tests__/time-zones.test.ts`; modify `app/settings/actions.ts`.

**Produces:**
- `isTimeZone(zone: string): boolean`: true when `new Intl.DateTimeFormat("en-US", { timeZone: zone })` doesn't throw.
- `timeZoneOptions(saved: string | null): string[]`: the server's `Intl.supportedValuesOf("timeZone")`, with `saved` first when it's missing.
- Server action `saveTimezone(zone: string): Promise<SaveResult>`: "Pick a time zone from the list." unless `isTimeZone`; updates `profiles.timezone`; revalidates `/settings`. It replaces the time zone half of `saveSettings` (delete `saveSettings` once Task 5 lands).

- [ ] Tests: `isTimeZone("Asia/Calcutta")` true, `isTimeZone("Mars/Base")` false; `timeZoneOptions("Asia/Calcutta")[0] === "Asia/Calcutta"`; `timeZoneOptions(null)` has no duplicates. Run, FAIL; implement; PASS; commit `feat: time zones from the server (ALL-102)`.

### Task 2: Time zone row (AC-2, AC-2b, AC-3, AC-11)

**Files:** create `app/settings/time-zone-row.tsx`, `app/settings/__tests__/time-zone-row.test.tsx`.

**Produces:** `TimeZoneRow({ zones, saved, fallback, action }: { zones: string[]; saved: string | null; fallback: string | null; action: (zone: string) => Promise<SaveResult> })`. A row: label "Time zone"; value is `saved` with `_` as spaces, or "Not set (using X)" from `fallback`, or "Not set". A native `<select>` covers the whole row transparently, named by `aria-labelledby` pointing at the label and the value; with nothing saved it starts on an empty placeholder option so picking the fallback fires `change`. Nothing reads `Intl` during render. A pick waits 400 ms for further picks; only the latest is sent, and a late older result is ignored. The tick and error reset when `/settings` is hidden, without cancelling a pick still waiting.

- [ ] Tests (fake timers): a pick saves after the delay and shows "Saved"; three quick picks call `action` once with the last zone; a failed save shows the error and keeps the pick; with `saved` null and `fallback` "America/Los_Angeles" it shows "Not set (using America/Los Angeles)" and picking that zone calls `action("America/Los_Angeles")`; the select's accessible name is "Time zone" plus the value. FAIL, implement, PASS, commit.

### Task 3: Payment summary from the database (AC-9)

**Files:** modify `modules/concierge/zinc/connect.ts`, `modules/concierge/index.ts`; tests in `modules/concierge/__tests__/zinc-connect.test.ts`; create `app/settings/rows.ts`, `app/settings/__tests__/rows.test.ts`.

**Produces:**
- `type PaymentSummary = "not_allowed" | "paused" | "off" | "not_connected" | "waiting" | "needs_phone" | "connected"`.
- `getPaymentSummary(userId: string, db: ZincDeps["db"], zincOn: boolean): Promise<PaymentSummary>`: uses `hasPaidFeatures`, `hasZincConnection`, and the rows `getPaymentStatus` already reads (`zinc_connect_attempts`, `accounts.buyer_phone`). It never makes a Zinc call. The mapping matches `PayingForGiftsSection` exactly: unpaid with a connection gives "paused"; unpaid gives "not_allowed"; paid with Zinc off gives "off", with or without a connection. Signature takes `now: Date` as a fourth argument, so an expired connect attempt is "not_connected", not "waiting" (E3).
- `paymentRowText(s: PaymentSummary | "error"): string` in `rows.ts`: not_allowed and off "Not available yet", paused "Paused", not_connected "Not set up", waiting "Connecting", needs_phone "Add your phone", connected "Connected", error "Couldn't load".

- [ ] Tests: one per summary value with the existing fake db, plus an expired attempt giving `not_connected`; `paymentRowText` for every value. FAIL, implement, PASS, commit.

### Task 4: Over-budget page (AC-4, AC-5, AC-10)

**Files:** create `app/settings/over-budget/page.tsx`, `app/settings/over-budget-field.tsx`, `app/settings/__tests__/over-budget-field.test.tsx`; modify `app/settings/actions.ts`.

**Produces:** server action `saveOverBudget(value: string): Promise<SaveResult>`, which wraps `saveConciergeSettings` and revalidates `/settings` and `/settings/over-budget`. Also `OverBudgetField({ initial, action }: { initial: number; action: (v: string) => Promise<SaveResult> })`, which saves on blur, Enter and the hide cleanup, only when the text differs from the last value **sent** (kept in a ref, so blur followed by the hide cleanup sends once). The page has a `BackLink` to `/settings` ("Settings"), the title "Over-budget allowance", today's hint, and the field followed by "%".

- [ ] Tests: blur with a change saves once; Enter then blur saves once; blur with no change doesn't call `action`; "abc" shows the action's error and keeps "abc"; unmounting with an unsaved change calls `action`; blur then unmount calls it once; `saveOverBudget` calls `revalidatePath` for both paths (`next/cache` mocked). FAIL, implement, PASS.
- [ ] Spike the Back case now, as `e2e/settings.spec.ts` › `over-budget saves when Back is tapped straight away`: open `/settings/over-budget`, type 15, tap Back, open `/settings/over-budget` again and expect the field to show 15. If that's unreliable, save from the BackLink's `onNavigate` instead. Task 7 extends it to check the row. Commit.

### Task 5: Settings list and the other detail pages (AC-1, AC-6, AC-7, AC-8, AC-10)

**Files:**
- Rewrite `app/settings/page.tsx`.
- Create `app/settings/settings-row.tsx`, `reminders/page.tsx`, `address/page.tsx`, `paying/page.tsx`.
- Modify `address-actions.ts`: `refresh` also revalidates `/settings/address`.
- Modify the Zinc actions in `actions.ts`: also revalidate `/settings` and `/settings/paying`.
- Modify `my-address.tsx`: remove the `#my-address` scroll effect and the `id`.
- Delete `settings-form.tsx`, its test, and `saveSettings`.

**Produces:**
- `SettingsRow({ href, label, value }: { href: string; label: string; value: string })`: a `Link`, `min-h-11`, with the value muted and truncated, and a chevron.
- `addressRowText(a: MyAddress): string` in `rows.ts`: line1, "Not added", or "Couldn't load".
- `/settings`: groups You, Reminders, Gift ideas, Paying for gifts. Each is an uppercase muted heading over a bordered group of rows.
  - The time zone row is Task 2's. Its zones come from `timeZoneOptions(saved)`, and its fallback is `x-vercel-ip-timezone` when `isTimeZone` accepts it.
  - The address row follows today's `showAddress` rule.
  - The Email row reads "By email", and the allowance row reads `${pct}%`.
  - The Zinc row uses `paymentRowText`, with the summary load in try/catch and `unstable_rethrow`, which gives "error".
  - `maxDuration` moves off this page.
- `/settings/address`: redirects to `/settings` under the same hidden rule; otherwise today's `MyAddressSection`.
- `/settings/paying`: `export const maxDuration = 300` with today's comment, then today's `PayingForGiftsSection`.
- `/settings/reminders`: "By email", "More ways to be reminded are coming.", and `TestEmailButton`.
- Every detail page: a `BackLink` to `/settings` ("Settings") and a `PageTitle`.

- [ ] Unit tests: `addressRowText` for all three cases; the address and Zinc actions revalidate their paths (`next/cache` mocked). FAIL, implement, PASS. The `/settings/address` redirect sits outside any try/catch.
- [ ] Point `e2e/my-address.spec.ts` and `e2e/paying-for-gifts.spec.ts` at `/settings/address` and `/settings/paying`; both run green. Commit.

### Task 6: Links into Settings (AC-14)

**Files:**
- `components/address/share-address-switch.tsx` and its test: `/settings/address`.
- `modules/concierge/notify/actions.ts`: `check_my_address` goes to `/settings/address`, and `hold_setup` to `/settings/paying`.
- `modules/concierge/__tests__/links.test.ts`.
- `modules/concierge/rounds/engine.ts:1114`: the fallback becomes `/settings/paying`, plus its test.
- `e2e-live/all-32-paying-for-gifts.spec.ts`: `/settings/paying`.

- [ ] Change the asserted paths in tests first: FAIL. Change the code: PASS. Then grep for `/settings#` and `"/settings"` in `apps/web`: only the account menu, the auth/path tests and the page itself remain. Commit.

### Task 7: Browser tests (AC-2, AC-2b, AC-4, AC-10, AC-11, AC-13)

**Files:** create `e2e/settings.spec.ts`; modify `e2e/top-bar.spec.ts` (add the four detail pages to the 320 px loop).

All assertions use `toBeVisible()` / `not.toBeVisible()`, never counts: hidden visited pages stay in the document.

- [ ] `settings lists every group and row`: the headings You, Reminders, Gift ideas and Paying for gifts are visible; each row shows its value; there's no button named Save.
- [ ] `address page redirects when the row is hidden`: a fresh user with no list who opens `/settings/address` lands on `/settings`.
- [ ] `picking a time zone saves it`: pick, see "Saved", reload, and the row shows it.
- [ ] `no saved zone shows the fallback and saves nothing until picked`: a fresh user sees "Not set" on the row, and `profiles.timezone` is still null.
- [ ] `over-budget saves when Back is tapped straight away`: type 15, tap Back, and the row shows "15%".
- [ ] `coming back shows no stale state`: save, Back, open again, and there's no "Saved".
- [ ] `@layout settings loads without a hydration error`: `test.use({ timezoneId: "America/Los_Angeles" })` so the browser's zone differs from the server's; collect console errors and `pageerror` on `/settings` for a user with a zone and one without; none match `/Hydration|#418|#423|#425/` (the e2e runs a production build, where React's messages are minified). **Write this first, against today's code, and record that it fails.** Also check the rows are at least 44 px and the picker covers the time zone row (`phone-layout.ts` helpers). One test sends `extraHTTPHeaders: { "x-vercel-ip-timezone": "America/Chicago" }` and sees "Not set (using America/Chicago)".
- [ ] `pnpm e2e settings top-bar` green on all projects. Commit.

### Task 8: Gallery and docs (AC-12)

**Files:** `e2e/gallery.shots.ts`; `design/technical-design.md` (Navigation row: `/settings` is a list of rows with detail pages, T71).

- [ ] `shoot` waits until no text matches `/^Loading\b/`. Add the shots `settings-over-budget`, `settings-reminders`, `settings-address` and `settings-paying`.
- [ ] Run `pnpm gallery`. `phone/settings.png` shows rows. Republish the screens page (CLAUDE.md > Updating the screens and emails page). Commit.
- [ ] Grep check: `maxDuration = 300` is in `app/settings/paying/page.tsx` and not in `app/settings/page.tsx`.
- [ ] Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

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
