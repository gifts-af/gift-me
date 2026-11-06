# ALL-95 Top navigation, Get and Give: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every signed-in page has one bar with Get and Give, and the My list card on Home becomes a "You" card among your people.

**Links:** [ALL-95](https://linear.app/allens-forever/issue/ALL-95/top-navigation-get-and-give-one-bar-on-every-signed-in-page) (spec and approved mock-up). Revises T29 and T30 (2). Keeps T19, ALL-54, ALL-60, ALL-74.

## Spec: what it does

### Who it's for and what they can do

1. **Move between getting and giving:** as a signed-in person, I can see and press Get or Give from any app page, on a phone or a computer, so I always know where I am.
2. **Reach my account from anywhere:** as a signed-in person, I can open Settings and Sign out from My list too.
3. **See myself among my people:** as a signed-in person, I see a "You" card first on Give, which takes me to my list.

### Which bar each page gets

| Page | Bar | Marked tab |
|---|---|---|
| `/` | Logo, tabs, account | Give |
| `/people/*`, including while a page loads | Logo, tabs, account | Give |
| `/lists`, signed in | Logo, tabs, account (logo alone for a moment while the session is read) | Get |
| `/settings`, `/extension/connect` | Logo, tabs, account | Neither |
| `/lists`, signed out | Logo, sun/moon | None |
| `/share/*`, signed in or out | Logo, sun/moon | None |
| `/a/*`, update password | Unchanged (`AuthFrame`) | None |
| `/welcome`, `/tour`, `/request-access` | Unchanged (`HomeTopBar`) | None |

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Any page in the table | It renders | It shows the bar the table gives it |
| AC-2 | A signed-in page at 320 px | It renders | Nothing overflows, checked by an automated test |
| AC-3 | The bar | It renders | Get goes to `/lists` and Give to `/`. Each is a link with an icon, at least 44 px tall and 68 px wide. The current one has `aria-current="page"` and a visible marker |
| AC-4 | `/lists` or `/share/*` | It's still loading | A signed-out or share-link visitor never sees tabs or the account menu |
| AC-5 | `/lists` | The session is still being read | The logo shows alone, and the bar's height and logo position are the same signed in and signed out, so nothing moves when the tabs appear |
| AC-6 | Signed in on `/lists` | The page has loaded | Share sits beside the "My list" title and works as it did, including when blocked. The title row doesn't change height between loading and loaded |
| AC-7 | Person, questions, Settings, extension connect pages | They render | The back link is in the page: "‹ People" on a person, "‹ <name>" on questions, "‹ Give" on the other two. The logo is in the same spot on every page |
| AC-8 | Signed in on Give | It renders | No My list card. A "You" card comes first, with "Treat yourself · 12 gifts on your list" ("1 gift" when singular), and goes to `/lists` |
| AC-9 | No list, or zero gifts | Give renders | The card says "Treat yourself · Start your wish list" |
| AC-10 | The count can't be read | Give renders | The card says "Your list", and never invites someone to start one |
| AC-11 | Zero people, people still loading, or people failing to load | Give renders | The "You" card still shows |
| AC-12 | Signed in | I save my list, then press Give | The count is the new one |
| AC-13 | Unsaved changes on My list | I press Give, or the logo | The unsaved-changes warning still appears |
| AC-14 | The finished work | Evidence is posted | Screenshots of Give, Get and a person page, at 320 px, 375 px and computer width, in light and dark |
| AC-15 | The finished work | Docs are read | A new T# revises T29 and T30 (2), and the docs in Task 5 no longer describe the old bar |

### Out of scope

- Keeping the bar visible while scrolling. It scrolls away, as it does today.
- A not-found page for `/people/<bad id>`.

### Open questions

None left to research. The owner signed off on the mock-up on 2026-11-06. One choice is with the owner: logo alone for a moment on `/lists` (AC-5).

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Labels and style | `Get · Give`, tabs with icons | Owner's picks |
| "You" card, and removing the My list card | Yes | Owner: the card repeated the navigation |
| New pages or URLs? | No. `/` is Give, `/lists` is Get | Simplest thing that works. A list-only person still gets to their list in one press, from the "You" card |
| Bottom tabs on phones? | No | **[Claude's call]** They'd clash with the fixed main button |
| Wording of the "You" card | As in AC-8 to AC-10 | **[Claude's call]** The owner saw AC-8 in the mock-up |
| Icons | lucide `Gift` and `HeartHandshake` | **[Claude's call]** The app uses lucide. The mock-up's emoji were placeholders |
| Tabs on `/share` and `/a/` for someone signed in? | No | **[Claude's call]** These are pages reached from a link someone sent. It also keeps `/share` free of a session check |

## Principles check

- **Simplest version?** Cut: a `/people` page, bottom tabs, a sticky bar. `TopBar` loses its `back`, `links`, `current`, `actions` and `account` props.
- **Hard-coded values?** None. Sizes and labels are UI.
- **Product boundaries?** `app/page.tsx` already imports `@/modules/lists` through its public index. Nothing in `modules/lists` imports the shared bar any more except `shared-list.jsx`, which already does.
- **New personal data?** None.
- **Docs and decisions:** Task 5.

## Plan

**Architecture:** `TopBar` becomes the logo plus a slot, with the sun/moon as the default content. A new server component, `AppNav`, fills the slot with the tabs and account menu. `/lists` is the one page that doesn't know who's signed in until it reads the session, so it renders the logo straight away and fills the slot behind its own Suspense boundary. The bar moves out of `GiftApp`.

**Tech stack:** Next.js 16 App Router with cacheComponents (read `apps/web/AGENTS.md` first), Tailwind, Vitest, Playwright.

Work from `origin/main` in a worktree, on branch `aarontallen/all-95-get-give-nav`.

**320 px budget:** 288 px after padding, or 273 px on a browser that reserves 15 px for a scrollbar. Logo 81 + 12 gap + tabs 136 + menu 44 = 273, so it fits both.

### Task 1: The bar (AC-1, AC-3, AC-7)

**Files:**
- Modify: `apps/web/components/app-shell/top-bar.tsx`, `page-frame.tsx`
- Create: `apps/web/components/app-shell/product-tabs.tsx`, `app-nav.tsx`
- Modify: the pages `app/page.tsx`, `app/settings/page.tsx`, `app/extension/connect/page.tsx`, `app/people/new/page.tsx`, `app/people/import/page.tsx`, `app/people/[id]/page.tsx`, `app/people/[id]/questions/page.tsx`
- Modify: `app/people/import/import-checklist.tsx:245` ("See them on Give")
- Test: `components/app-shell/__tests__/top-bar.test.tsx`, `components/__tests__/top-bar-anchor.test.tsx`, `components/__tests__/theme-toggle.test.tsx`, `app/people/__tests__/import-checklist.test.tsx`, `e2e/contacts-import.spec.ts:99`

**Interfaces, for later tasks:**
- `TopBar({ children }: { children?: React.ReactNode })`: client-safe (`shared-list.jsx` imports it). `TopBarRow` with the logo, `gap-3`, and a slot `flex min-w-0 flex-1 items-center gap-2`. With no children the slot holds the sun/moon, right-aligned with `ml-auto`.
- `ProductTabs({ current }: { current?: "get" | "give" })`: client-safe.
- `AppNav({ current }: { current?: "get" | "give" })`: server component. `<ProductTabs>` then `<div className="ml-auto"><Account /></div>`.
- `BackLink({ href, label })` in `page-frame.tsx`: `ChevronLeft` plus the label, at least 44 px tall.

Steps:

- [ ] Rewrite `top-bar.test.tsx`. Tests: `TopBar` with no children shows the logo linking to `/` and the sun/moon. `ProductTabs current="get"` has links named `Get` (`href="/lists"`, `aria-current="page"`) and `Give` (`href="/"`, no `aria-current`) inside `navigation` named `Main`. `current="give"` is the reverse. With no `current`, neither is marked.
- [ ] Update `theme-toggle.test.tsx` (`<TopBar><span>account</span></TopBar>` has no sun/moon) and `top-bar-anchor.test.tsx` (`<TopBar><span /></TopBar>` is in the same row as `HomeTopBar`).
- [ ] Update `import-checklist.test.tsx:123` and `contacts-import.spec.ts:99` to "See them on Give".
- [ ] In `gift-app.test.jsx`, make the unsaved-changes tests click a link rendered beside `GiftApp` (`<a href="/">Give</a>`), since the bar is leaving it. Today's `clickHome` finds `/Home/` and would throw.
- [ ] Run `pnpm --filter @gifts-af/web exec vitest run components app/people`. Expected: the new tests FAIL.
- [ ] Build `TopBar`, `ProductTabs`, `AppNav`, `BackLink`. Tabs are `inline-flex min-h-11 min-w-[68px] items-center justify-center gap-1.5 px-2 border-b-[3px] border-transparent text-muted-foreground`, and current adds `font-semibold text-foreground border-sticker`. Icons are `size-4`, `aria-hidden`.
- [ ] Update each page's bar and back link, following the table. Questions page: move the bar outside its Suspense boundary so it shows while loading, keeping the back link inside with the person's name. `TopBar` keeps its logo on phones, so remove the `-ml-1` back-link code.
- [ ] Run `pnpm --filter @gifts-af/web exec vitest run` and `pnpm typecheck`. `gift-app.jsx` is plain JS and still passes the old props until Task 2, which typecheck won't flag. Expected: PASS.
- [ ] Commit: `feat: Get and Give tabs in one bar (ALL-95)`.

### Task 2: My list gets the bar and Share moves (AC-1, AC-4, AC-5, AC-6, AC-13)

**Files:**
- Modify: `apps/web/modules/lists/components/gift-app.jsx`, `apps/web/app/lists/page.tsx`, `apps/web/app/share/[token]/page.tsx`
- Test: `modules/lists/components/__tests__/gift-app.test.jsx`, `e2e/home.spec.ts`

**Interfaces:**
- Consumes `TopBar`, `AppNav`, `ProductTabs` from Task 1.
- `GiftApp` and `GiftAppSkeleton` no longer render a bar.
- In `app/lists/page.tsx`: `async function ListsBarEnd()` reads `getClaims()`. With a `sub` it returns `<AppNav current="get" />`, otherwise `<div className="ml-auto"><ThemeToggle /></div>`.

Page shape:

```tsx
<TopBar><Suspense fallback={null}><ListsBarEnd /></Suspense></TopBar>
<Suspense fallback={<GiftAppSkeleton />}><ListLoader /></Suspense>
```

Steps:

- [ ] Update `gift-app.test.jsx`. Add: Share is in the same row as the "My list" heading for a member, and absent for a guest. `GiftAppSkeleton` renders no links, no `Account` button and no sun/moon (AC-4), and its title row has the same `min-h-11` class as the loaded one (AC-6). Loading states are tested this way because `getMyList` runs on the server, so Playwright can't hold it open.
- [ ] Add to `home.spec.ts`:
  - Signed out at `/lists`: no `Get` link, no `Account` button, sun/moon shows.
  - The `header:visible` box and logo position are equal signed in and signed out at `/lists` (AC-5). The row's `min-h-14` is taller than anything in the slot, so this holds while the tabs load.
  - Signed in at `/lists`: the `Account` button opens the menu with Settings and Sign out.
  - Signed in with unsaved changes: pressing `Give` raises the unsaved-changes dialog (`page.on("dialog")`).
- [ ] Run them. Expected: FAIL.
- [ ] Remove `TopBar` from `GiftApp` and `GiftAppSkeleton`. Put the title in `<div className="flex min-h-11 items-start justify-between gap-3">`, with `<ShareButton>` for members. Do the same in the skeleton, without the button, so the row height matches.
- [ ] Write `ListsBarEnd` and the page shape above. Read `node_modules/next/dist/docs/` on cacheComponents first.
- [ ] Give `/share/[token]` its own fallback: `<TopBar />` plus `PageFrame` with "Loading…". Don't reuse `GiftAppSkeleton`.
- [ ] Run the tests. Expected: PASS.
- [ ] Commit: `feat: account menu on My list, Share beside its title (ALL-95)`.

### Task 3: The "You" card on Give (AC-8, AC-9, AC-10, AC-11, AC-12)

**Files:**
- Create: `apps/web/components/home/you-card.tsx`, `components/home/__tests__/you-card.test.tsx`
- Modify: `apps/web/app/page.tsx`, `components/home/people-section.tsx`, `modules/lists/lib/lists.ts`, `modules/lists/actions/lists.ts`
- Test: `e2e/home.spec.ts`, `e2e/smoke.spec.ts:21-23`

**Interfaces:**
- `getMyListSummary(): Promise<{ count: number } | null>`, changed: `{ count: 0 }` when there's no list, `null` only when it can't be read.
- `YouCard({ count }: { count: number | null | undefined })`: `undefined` is loading (just "You"), `null` is AC-10.
- `PeopleSection` returns grid children, not its own grid.

Steps:

- [ ] Write `you-card.test.tsx`, with a link to `/lists` in every case. `count={12}` shows "Treat yourself · 12 gifts on your list". `count={1}` shows "Treat yourself · 1 gift on your list". `count={0}` shows "Treat yourself · Start your wish list". `count={null}` shows "Your list" and not "Start". `count={undefined}` shows "You" only.
- [ ] Add `e2e/fresh-user.ts`: `createFreshUser(): Promise<{ email; password }>`, creating a unique user the way `global-setup` does. The shared users race, because specs run in parallel across three projects.
- [ ] Add to `home.spec.ts`, with a fresh user: Give shows the "You" card before "Add someone you buy for" (AC-11, zero people).
- [ ] Update `smoke.spec.ts:21-23` to look for a link named `/^You/`.
- [ ] Run them. Expected: FAIL.
- [ ] Build `YouCard`: looks like `PersonCard`, but the whole card is one `<Link>` (`flex min-h-11 items-center gap-3 rounded-lg border p-3`), with `border-sticker`, a tinted background, and a `size-14` circle reading "You" in `bg-sticker text-sticker-foreground`.
- [ ] Change `getMyListSummary` as in Interfaces.
- [ ] In `app/page.tsx`: remove `ListCard` and `MyListCard`. Use `PageTitle` for "People", then one grid (`grid gap-3 md:grid-cols-2 lg:grid-cols-3`) holding `<Suspense fallback={<YouCard />}><YouCardLoader /></Suspense>` and `<Suspense fallback={<p className="col-span-full …">Loading…</p>}><PeopleSection /></Suspense>`.
- [ ] In `people-section.tsx`: return fragments. Messages and the add buttons get `col-span-full`.
- [ ] Run the tests. Expected: PASS.
- [ ] Add the AC-12 test to `home.spec.ts`, with a fresh user: save a list with one gift, press `Give`, see "1 gift". Run it. **If it passes, stop here and don't add `revalidatePath`.**
- [ ] Only if it failed: call `revalidatePath("/")` in `saveList` straight after the RPC succeeds, because a failed re-read still means the save landed. That re-renders `/lists` with a new `initial`, so hold `isGuest` and `loadError` from the first render (`useState(() => ...)`), so a failed read after a good save can't show "saving is paused".
- [ ] If `revalidatePath` was added, add a test to `home.spec.ts`: hold the save request with `page.route`, add a gift while it's held, release it, and the new gift is still on the page and still counts as unsaved.
- [ ] AC-11's failure case can't be forced from a test without mocking our own module (E5), so check it by hand on dev: make `listPeople` throw locally, screenshot the "You" card, revert. Post it as evidence.
- [ ] Commit: `feat: You card on Give replaces the My list card (ALL-95)`.

### Task 4: 320 px and the existing e2e suite (AC-2, AC-7)

**Files:**
- Test: `e2e/home.spec.ts` (including `:157-165`)

Steps:

- [ ] Add a test at `setViewportSize({ width: 320, height: 800 })`, with a fresh user who has no people: `phoneLayoutProblems(page)` is `[]` on `/`, `/lists`, `/settings`. Then add a person through the form: it's `[]` on their page and their questions page. Zero people on `/` is deliberate: `PersonCard`'s name link is under 44 px by itself (its tap area is a `::after`), which `phoneLayoutProblems` would flag, and that isn't this ticket's change.
- [ ] Add a test: tabs are at least 44 px tall and 68 px wide at 320 px (`boundingBox`).
- [ ] Update the logo test at `:157-165`: the logo is in the same spot on `/lists` at every width, so drop the `width < 640` branch and the "Home" link check. Add `/settings` and a person page.
- [ ] Run `pnpm --filter @gifts-af/web e2e` (Docker and local Supabase up). If the bar overflows, reduce gaps first, then the logo size. Expected: PASS.
- [ ] Commit: `test: top bar at 320 px and logo on every page (ALL-95)`.

### Task 5: Docs and last checks (AC-15)

**Files:**
- Modify: `design/decisions.md` (next T# at merge time, fetched from `origin/main`), `design/technical-design.md:97`, `design/ui.md:36,113,123-128,149,161`, `apps/web/README.md:60`
- Modify: the comment at `components/home/person-card.tsx:7`, and any "Home" or "My list" comments still found

Steps:

- [ ] Search `apps/web` for user-visible `Home` and `My list` left over. `Go to {APP_NAME}` on `/a/` stays. "My list" stays as the page title, and the tour keeps its wording.
- [ ] Add the T#: what changed from T29 and T30 (2), why (the owner's Get and Give), and that `/` remains the landing page.
- [ ] Update the three design docs and the README.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: PASS.
- [ ] Commit: `docs: Get and Give navigation, revises T29 and T30 (ALL-95)`.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test, except AC-14 and AC-15 (checked by reading) and AC-11's failure case (checked by hand).
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.
- [x] Adversarial review of the spec and of the plan done, with findings folded in.

## Done: evidence on the ticket (T44)

- [ ] Tests added, that they failed first, suite and CI results.
- [ ] Before and after screenshots (AC-14).
- [ ] Live check on giftsaf.com after deploy, or listed as **Still open**.
- [ ] Every box on the ticket ticked.
- [ ] E9: seen working by opening both tabs on production. Turned off by Vercel's instant rollback.

## Review focus

The riskiest things to check in review, each with its test.

1. **A guest seeing tabs or the account menu on `/lists`:** `home.spec.ts`, signed-out test (Task 2).
2. **`revalidatePath`, if it turns out to be needed, wiping edits made during a save or flipping a member to guest:** the Task 3 held-save test.
3. **The unsaved-changes warning after the bar moved out of `GiftApp`:** `home.spec.ts` dialog test (Task 2).
4. **Someone with gifts being told to start a list when the count fails:** `you-card.test.tsx`, `count={null}` (Task 3).
5. **Overflow on a real phone's font at 320 px:** the 320 px test runs on Android and iPhone profiles (Task 4), with 7 px to spare by calculation.
