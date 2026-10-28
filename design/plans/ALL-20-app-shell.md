# ALL-20 App shell, sign-in, list restyle, PWA: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a signed-in user lands on a phone-friendly Home inside the new look. They can sign in with Google (or email and password), install the app to their home screen, and use the gift list with every feature it has today.

**Architecture:** this builds on what's already there. Supabase cookie sessions through `@supabase/ssr` already exist, and `proxy.ts` already guards routes. The new parts: one shared top bar and page frame (`components/app-shell/`), the design tokens in `globals.css`, and a Home page at `/`. The list module keeps its logic and swaps its stylesheet for Tailwind classes. One small migration hides claims from a list's owner (product decision 39).

**Tech stack:** Next.js 16 (App Router, `cacheComponents`), Supabase Auth, Tailwind 3 and shadcn/ui, Vitest, Playwright (new).

**Spec:** the [ALL-20 ticket](https://linear.app/allens-forever/issue/ALL-20) and its comments, `design/ui.md` (tokens, layout, "Moving the list app"), and the signed-off mock-ups ([sign-in](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#signin), [home](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#home), [home-wide](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#home-wide), [list](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#list), [list-wide](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#list-wide), [shared](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#shared)).

## What was decided, and why

The ticket was written before the mock-ups were signed off. Where they differ, the mock-ups win, since they're the later decision.

| Question | Decision | Why |
|---|---|---|
| Navigation | Top bar only. On a phone: the name or a back arrow on the left, and an account menu (Settings, theme, Sign out) on the right. From 640 px: "My list" and "People" links beside the name. The ticket's "Upcoming" tab is dropped for now **[Claude's call]** | That's what the signed-off home and home-wide mock-ups show. "Upcoming" has nothing to show until rounds exist (Wave 3). |
| What `/` is | **Home**, signed-in only: a "My list" card, then "People". A signed-out visitor goes to sign-in and comes back afterwards (`?next=`) **[Claude's call]** | T29: Home is the front door. Guests can still use `/lists`, which keeps working signed out. |
| People on Home | Heading and the empty-state line only. The "Add someone" button comes with ALL-21 **[Claude's call]** | There's no people screen to link to yet, and a button that does nothing breaks principle 1. |
| Owner's view of a shared list | The owner sees "This is your list. Claims are hidden from you…" with no claim buttons or claim names. The "view as a guest" gate goes, and `lists.get_shared_list` returns no claims to the owner **[Claude's call on doing it here, not in ALL-44]** | Product decision 39 and the signed-off shared mock-up. Hiding claims only in the UI would still send them to the owner's browser. |
| Settings | `/settings` page: timezone (saved to `public.profiles.timezone`) and over-budget % (saved to `concierge.accounts.over_budget_pct`; a new account takes the default from `app_settings`, T23). Notifications show as "Email" with a note that more choices come with ALL-23 **[Claude's call]** | `notification_prefs` has no agreed shape until the notification service (ALL-23) defines channels. Inventing one now would bind that ticket. |
| PWA icons | Generated with `next/og` (`app/icon.tsx`, `app/apple-icon.tsx`, plus 192 and 512 px icons for the manifest): a teal square with a white "G" **[Claude's call]** | There's no logo until the name is settled (ALL-14), and code-generated icons are a one-line change later. |
| Phone save button | The save bar is fixed to the bottom on a phone and sits inline from 640 px | `ui.md` > Phone and computer. |
| `gifts.css` | Removed in this ticket. Every list component moves to Tailwind classes | The restyle touches every list screen anyway, so keeping two stylesheets means two looks. |
| Browser tests | Playwright in `apps/web/e2e/`, Chromium at 375 × 812. CI gets a new `e2e` job that starts local Supabase, creates a test user, builds the app and runs the smoke test | Ticket scope. Local Supabase has no Google, so the test uses email and password (ALL-39 comment). |

## Global constraints

- Tokens, sizes and spacing exactly as `design/ui.md` > Style guide. System font; Geist is removed.
- Tap targets at least 44 × 44 px. Inputs 16 px. One teal (primary) button per screen.
- Product boundaries: `app/` and `components/` import a product only through `modules/<product>/index.ts`.
- No hard-coded business values (T23). The over-budget default comes from the database.
- Every list feature in `ui.md` > Moving the list app keeps working, and the existing tests in `modules/lists/components/__tests__/` still pass (update class or label lookups only if the copy changed on purpose).
- Before the PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `pnpm db:test` and `pnpm --filter @gifts-af/web e2e`.

## Review focus

1. **A deep link while signed out** (e.g. `/settings`) goes to sign-in, then back to `/settings`, never to an outside site. *Test:* `safeNext` unit test (Task 2).
2. **Install files must load signed out.** `/manifest.webmanifest`, `/icon*` and `/apple-icon*` must not redirect to sign-in, or the install prompt breaks. *Test:* `public-paths.test.ts` cases (Task 2).
3. **The Google callback fails** (user cancels, or the code has expired): show the auth error page with a way back, not a crash. *Test:* callback route unit test (Task 2).
4. **A guest's list survives the trip through sign-in**, both by email and password and via Google's redirect. The stash is written when the guest leaves `/lists`, so the Google button (a full-page redirect) must stash before leaving. *Test:* GiftApp test (Task 5) that the stash is written on unmount and read back.
5. **Dark mode contrast.** Every text-on-fill token pair passes 4.5:1 in both themes. *Test:* `tokens.test.ts` (Task 1) parses `globals.css`.

---

### Task 1: Design tokens and base styles

**Files:**
- Modify: `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/app/layout.tsx` (drop Geist, use the system font)
- Test: `apps/web/test/tokens.test.ts`

**Produces:** Tailwind colours `success`, `warning`, `success-soft`, `warning-soft` added to the shadcn set; `--radius: 0.75rem`; `font-sans` set to the system stack; `.tabular-nums` used for prices.

- [ ] Test: `tokens.test.ts` reads `globals.css` and parses the `:root` and `.dark` blocks. It checks every token in `ui.md`'s table against its HSL triple, and checks contrast ≥ 4.5 for these pairs in both themes: foreground/background, muted-foreground/background, muted-foreground/muted, primary-foreground/primary, accent-foreground/accent, secondary-foreground/secondary, destructive/background, success/background, warning/background, warning/warning-soft, success/success-soft.
- [ ] Run it and see it fail; write the tokens; run it and see it pass. Record the measured ratios in `ui.md` (this closes its **[Verify in ALL-20]** item).
- [ ] Commit `feat(web): design tokens from the style guide (ALL-20)`.

### Task 2: Google sign-in, callback, route guard

**Files:**
- Create: `apps/web/app/auth/callback/route.ts`, `apps/web/lib/safe-next.ts`, `apps/web/components/google-button.tsx`, `apps/web/components/auth-frame.tsx` (the centred sign-in layout from the mock-up)
- Modify: `apps/web/lib/supabase/proxy.ts`, `apps/web/components/login-form.tsx`, `sign-up-form.tsx`, `forgot-password-form.tsx`, `update-password-form.tsx`, `apps/web/app/auth/*/page.tsx`
- Test: `apps/web/test/safe-next.test.ts`, `apps/web/test/public-paths.test.ts`, `apps/web/test/auth-callback.test.ts`

**Interfaces:**
- `safeNext(value: string | null | undefined): string` returns a same-origin path, or `"/"`. It replaces the copy inside `login-form.tsx`.
- `GET /auth/callback?code=…&next=…` exchanges the code with `supabase.auth.exchangeCodeForSession(code)`. It redirects to `safeNext(next)`, or to `/auth/error?error=…` on failure.
- `GoogleButton({ next?: string })` is a client component that calls `signInWithOAuth({ provider: 'google', options: { redirectTo: \`${location.origin}/auth/callback?next=${encodeURIComponent(next)}\` } })`.
- `isPublicPath`: `/` is no longer public. Add `/manifest.webmanifest`, `/icon…`, `/apple-icon…`. Signed-out redirects carry `?next=<path + search>`.

- [ ] Tests first: `safeNext` (`"/settings"` kept; `"//evil.com"`, `"https://x"`, `"/\\x"`, `null` give `"/"`); public paths (manifest and icons public, `/` and `/settings` not); callback (no code gives the error page; a failing exchange gives the error page with the message; success redirects to `next`). The callback test mocks `@/lib/supabase/server`.
- [ ] Implement. Restyle every auth page to the sign-in mock-up: name and tagline, "Continue with Google" (primary), an "or" divider, email and password, "Sign in" (secondary), and "Forgot password?" / "Create an account" links. The sign-up page gets the same Google button.
- [ ] Commit `feat(auth): Google sign-in and return to the page you asked for (ALL-20)`.

### Task 3: App shell and Home

**Files:**
- Create: `apps/web/components/app-shell/top-bar.tsx`, `account-menu.tsx` (client: Settings link, theme radio, Sign out), `page-frame.tsx`, `apps/web/app/page.tsx` (Home)
- Modify: `apps/web/components/site-shell.tsx` (removed; callers move to the new parts), `apps/web/modules/lists/index.ts` (export `getMyListSummary`), `apps/web/modules/lists/lib/lists.ts`
- Test: `apps/web/components/app-shell/__tests__/top-bar.test.tsx`

**Interfaces:**
- `TopBar({ back?: { href: string; label: string }, links?: boolean, current?: 'list' | 'people', actions?: ReactNode, account?: ReactNode })`. Height 56, bottom border. The links show only from `sm:`.
- `PageFrame({ wide?: boolean, children })`: 16 px gutters, max width 640 px (1024 px when `wide`).
- `getMyListSummary(): Promise<{ count: number } | null>`: null when the user has no saved list.
- Home: the "My list" card (`N gifts`) or "Start your wish list", then "People" with the empty-state line from the mock-up. People grid classes `grid gap-3 md:grid-cols-2 lg:grid-cols-3`, ready for ALL-21.

- [ ] Test: TopBar shows the back link with its label; links get `aria-current="page"` for `current`; the account slot renders.
- [ ] Implement, and run `pnpm dev` at 375 px to compare against the mock-up.
- [ ] Commit `feat(web): app shell and Home (ALL-20)`.

### Task 4: Settings page

**Files:**
- Create: `apps/web/app/settings/page.tsx`, `apps/web/app/settings/settings-form.tsx`, `apps/web/app/settings/actions.ts`, `apps/web/modules/concierge/settings.ts`
- Modify: `apps/web/modules/concierge/index.ts`
- Test: `apps/web/app/settings/__tests__/settings-form.test.tsx`, `apps/web/modules/concierge/__tests__/settings.test.ts`

**Interfaces:**
- `getConciergeSettings(): Promise<{ overBudgetPct: number }>`: inserts the user's `concierge.accounts` row if it's missing (so the database default applies), then reads it.
- `saveConciergeSettings({ overBudgetPct }): Promise<{ ok: true } | { ok: false; error: string }>`: whole numbers 0–100 only.
- `saveSettings(formData)` server action: saves the timezone to `public.profiles` and calls `saveConciergeSettings`.
- The timezone picker lists `Intl.supportedValuesOf('timeZone')` and suggests the browser's zone when none is saved.

- [ ] Tests: the over-budget % validation (`-1`, `101`, `"abc"`, `"12.5"` rejected; `0`, `15`, `100` accepted); the form shows "Saved" after success and the error text after failure.
- [ ] Implement. Run `pnpm db:test` to confirm nothing in the schema changed.
- [ ] Commit `feat(web): settings page (ALL-20)`.

### Task 5: Restyle the list app

**Files:**
- Modify: every file in `apps/web/modules/lists/components/`, `apps/web/app/lists/page.tsx`
- Delete: `apps/web/modules/lists/components/gifts.css`, `owner-gate.jsx`
- Test: the existing `__tests__`, plus new `__tests__/gift-app.test.jsx`

**Layout (from the list mock-up):** the top bar has "Home" on the left (or the name, for a guest) and Share on the right (members). Then the "My list" title, a meta line (`3 gifts · $133.50`), and the add row ("Paste an Amazon link" + "Add"). After a lookup: if it found everything, a found card with "Add to list"; if it found part, the "Add by hand" form opens prefilled and focuses the missing field; if it failed, an error with focus back on the link field. "Add by hand" opens name, price and image URL. Gifts sit in a 2-column grid (3 from 1024 px), each with a 44 px remove button. The save bar is docked when there are unsaved changes; guests get a docked note instead.

- [ ] Test (`gift-app.test.jsx`): removing a gift moves focus to the list heading; a guest's gifts are stashed under `giftme:guest-list` on unmount; a stash is picked up with the "We brought over…" notice; the save bar appears only when there are changes.
- [ ] Restyle the components, keeping every handler and aria attribute. The modal keeps native `<dialog>`, now with Tailwind styles.
- [ ] Run all web tests; then by hand at 375 px and 1024 px: add by link (fixture ASIN), add by hand with a bad price, remove, save, the save error (stop local Supabase), share and the clipboard fallback (plain HTTP), and dark mode.
- [ ] Commit `feat(lists): list app in the new look (ALL-20)`.

### Task 6: Shared list, and hiding claims from the owner

**Files:**
- Create: `supabase/migrations/20261028120000_hide_claims_from_owner.sql`
- Modify: `supabase/tests/lists.test.sql`, `apps/web/app/share/[token]/page.tsx`, `modules/lists/components/shared-list.jsx`, `claim-dialog.jsx`, `view-dialog.jsx`, `modules/lists/index.ts`

**Interfaces:** `lists.get_shared_list` returns `'claim', null` for every item when `l.owner_id = auth.uid()`. Nothing else changes.

- [ ] pgTAP first: "the owner sees no claims" (the owner calls `get_shared_list` after a guest claimed; every `claim` is null) and "a friend still sees the claim". Raise `plan(…)` to match. Run `pnpm db:test` and see it fail.
- [ ] Migration: `create or replace` the function with the owner check. Run `pnpm db:test` and see it pass. `pnpm db:types` (no change expected).
- [ ] Share page: remove the owner gate. The owner gets the banner and no claim controls; friends get Claim and "Claimed by …"; an already-claimed race shows "Someone else just claimed this. Pick another gift." in the dialog.
- [ ] Commit `feat(lists): shared list in the new look; owners never see claims (ALL-20)`.

### Task 7: PWA manifest and icons

**Files:**
- Create: `apps/web/app/manifest.ts`, `apps/web/app/icon.tsx`, `apps/web/app/apple-icon.tsx`, `apps/web/app/pwa-icon/[size]/route.tsx` (192 and 512 for the manifest)
- Modify: `apps/web/app/layout.tsx` (`appleWebApp: { capable: true, title: 'GiftMe' }`, `viewport.themeColor` light `#ffffff` and dark `#09090b`)
- Test: `apps/web/test/manifest.test.ts`

- [ ] Test: the manifest has `name`, `short_name`, `start_url: '/'`, `display: 'standalone'`, and 192 and 512 PNG icons.
- [ ] Implement; check `/manifest.webmanifest` and the icons in the browser; check Chrome DevTools > Application shows it as installable.
- [ ] Commit `feat(web): installable to the home screen (ALL-20)`.

### Task 8: Playwright smoke test in CI

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/global-setup.ts` (creates the test user with the local service-role key), `apps/web/e2e/smoke.spec.ts`
- Modify: `apps/web/package.json` (`e2e` script, `@playwright/test`), `apps/web/vitest.config.ts` (exclude `e2e/`), `.github/workflows/ci.yml` (new `e2e` job), `scripts/dev-check.mjs` and `README.md` (Playwright browser row; Docker cask is now `docker-desktop`), `apps/web/.gitignore`

**Smoke test:** at 375 × 812, sign in as the test user with email and password. See the top bar, "My list" and "People". Reload and still see Home. Open the account menu, sign out, and land on sign-in. Then confirm `/` sends you to sign-in.

- [ ] Write it; run it locally against `pnpm supabase start`; see it pass.
- [ ] CI job: `supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor`, read keys with `supabase status -o env`, then `playwright install --with-deps chromium`, `pnpm build`, `pnpm e2e`.
- [ ] Commit `ci: Playwright smoke test (ALL-20)`.

### Task 9: Docs, review, PR

- [ ] Update `design/decisions.md` (T30: Home behind sign-in, navigation, owner claims hidden in the database, Settings scope), `design/technical-design.md` §2.1 and §2.2 (routes, PWA), `design/ui.md` (status, contrast results, settled calls), `apps/web/README.md` (routes, structure, e2e), and root `README.md` (doc table and Playwright).
- [ ] Linear: comment on ALL-44 that the owner-claims part of the shared page is done here; ALL-20 to In Review.
- [ ] Full verification, then `superpowers:requesting-code-review`, then a PR titled `feat: auth, app shell, list restyle and PWA (ALL-20)` with `Closes ALL-20`.
