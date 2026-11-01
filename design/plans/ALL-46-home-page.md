# ALL-46 Home page for giftsaf.com, with a guided tour: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a signed-out visitor to https://giftsaf.com sees a bold, honest-about-alpha home page that explains GiftsAF and offers a guided tour with made-up people, or sign-in. Signed-in visitors still land on their app home.

**Links:** [ALL-46](https://linear.app/allens-forever/issue/ALL-46) · audiences and funnel in [`planning/strategy.md`](../../planning/strategy.md) §3 · name and domain: planning decision 44 (ALL-14) · app shell and "home needs an account": T29, T30 ([ALL-20 plan](ALL-20-app-shell.md)) · look and feel: [`design/ui.md`](../ui.md) · mock-ups from the brainstorm: [`mockups/ALL-46-home.html`](../mockups/ALL-46-home.html) (phone, chosen version) and [`mockups/ALL-46-home-desktop.html`](../mockups/ALL-46-home-desktop.html) (phone and computer layout). Both are bare HTML fragments from the brainstorm; open them in a browser to see them.

## Spec: what it does

### Why, and who it's for

The idea for GiftsAF came from the owner's son: 24, always forgets holidays, and is terrible at telling people what to buy him. **He is the person this page talks to.** The concierge fixes the forgetting; the gift list fixes "what do you want?". The same young adult is also the scan-to-gift crowd later, so one voice, bold and a bit cheeky, leaning into the "AF" name, covers the whole platform. Parents and grandparents mostly arrive by tapping his shared list, which already works without this page.

**How people arrive decides how much hand-holding they get** (owner, 2026-11-01):
- **Discovery** (someone told them, they searched, they're curious): lots of hand-holding. The home page explains, and the tour lets them try it with made-up people.
- **On a task** (a shared list link, an email link, later a scanned QR code): little friction. They go straight to the task, and only a small link offers to explain GiftsAF. "If they're delighted with the experience they will explore further."

**Honest about alpha:** it's all early development. The page says plainly that a lot is broken, invites people to poke around, and shows where it's heading. Each feature carries a status.

### Who it's for and what they can do

1. **Understand it in seconds:** as a curious visitor on a phone or a computer, I can tell what GiftsAF does, that it's early alpha, and what works today, without signing in.
2. **Take the tour:** as a curious visitor, I can walk through the app with made-up people (pick a gift for Mom from her own list, see ideas for Dad, see my own list and share it), so I understand it before I make an account. Nothing I do is saved or bought.
3. **Ask to get in:** as a visitor who likes what I saw, I can request access from the home page and the end of the tour. As someone already invited, I can sign in.
4. **Signed in, nothing changes:** as a signed-in user, `giftsaf.com` still opens my app home.
5. **From a shared list, find out more:** as a guest who tapped a shared list link, I can find a small "What is GiftsAF?" link that leads to the home page, without it getting in the way of claiming a gift.
6. **Tell the builders something's broken:** as a visitor, I can send feedback from the home page.

### The page

Chosen in the brainstorm: **direction B, bold and cheeky**: dark background, big type, a yellow "sticker", teal buttons (the dark-mode tokens in `ui.md`: background `#0b0b0d`/zinc, primary `#2dd4bf`, sticker `#facc15`). **Light and dark both follow the visitor's browser setting** (owner, 2026-11-01), like the app: dark is the mock-up's look; light keeps the same layout, type and yellow sticker on a white background with the light teal primary (`#0f766e`). No toggle. Phone first, and it must look good on a computer (owner).

Top to bottom (copy from the chosen mock-up; small wording polish is the builder's call):

| Section | Phone | Computer |
|---|---|---|
| **Alpha strip** (every home and tour page) | Yellow strip: "🚧 Early alpha. Lots is broken. Poke around anyway." | Same, full width |
| **Top bar** | "GiftsAF" + an "ALPHA" tag; a small **🔒 Invite only** link on the right that opens sign-in | Adds a "How it works" anchor link |
| **Hook** | Sticker "Mom's birthday is Saturday 👀"; headline "Gifting, handled AF."; "Where we're heading: we remember the dates, find the gift, and ship it. You just tap yes."; buttons **Take the tour** (primary) and **Request access**, with a quiet "Have an invite? Sign in" link under them | Two columns: the text on the left, a light "pick a gift" card on the right (Mom's birthday, two gifts from her list, "Send it · $42"), as in the desktop mock-up |
| **What works today** | Three cards, each with a status chip: **Works now**: "Your gift list" · **Being built**: "Never forget a birthday" (in testing with a few friends) · **Later**: "Buy-me-a-drink shirts" | Three cards side by side |
| **How it'll work** | Three stacked steps, each a numbered circle, a bold title and one line: Add your people / We get ideas ready / You tap yes. Then "Nothing is ever bought without your OK." **Each step on its own lines; nothing wraps mid-sentence** (owner) | Three steps side by side, one column each |
| **Feedback** | "Found something broken? Tell us." / "It's two of us building this. Every bit of feedback helps." / **Send feedback** button | Same, narrower column |
| **Footer** | "GiftsAF alpha · made by Aaron and Jim" | Same |

### The tour (`/tour`)

A guided walkthrough of the real app screens, filled with made-up people, for discovery visitors. Steps, each with a short caption saying what's happening and a **Next** button:

1. **Your people:** the app home with Mom (has her own list), Dad (no list, ideas ready) and Sam. Caption: we remember everyone's dates.
2. **Pick from Mom's list:** Mom's birthday, gifts she chose herself. The visitor taps one; the button shows the total.
3. **Where it goes:** ship to Mom (her address comes with her list), to me, or elsewhere.
4. **Done:** "Ordered. (Not really, this is the tour.) It arrives Thursday, and Mom never sees what you spent."
5. **Ideas for Dad:** no list, so ideas from what you've saved about him, each with its reason.
6. **Your own list:** your list with a few gifts and a Share button. Caption: stop answering "what do you want?".
7. **End:** "That's where we're heading. A lot is still broken, but your gift list works today. Want in?" Buttons: **Request access** (primary), **Have an invite? Sign in**, **Back to home**.

Rules: no network calls, no database, nothing saved or bought; the visitor can leave at any step (a "Skip tour" link). Example people and gifts match the ALL-41 mock-ups.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A signed-out visitor | Opens `/` | The home page shows, with no redirect to sign-in |
| AC-2 | A signed-in user | Opens `/` | Their app home shows, as today |
| AC-3 | The home page | Rendered at 375 px and at 1280 px wide | Every section from "The page" is there; at 1280 px the hook is two columns and the steps are side by side; no horizontal scroll at 375 px |
| AC-4 | The home page and tour | Viewed at any width | The alpha strip is visible, and each feature card shows its status chip |
| AC-15 | The home page and tour | The browser prefers dark, then light | The page renders in the dark look, then the light look, with readable contrast in both |
| AC-5 | A signed-out visitor | Taps **Take the tour** | `/tour` opens without sign-in, at step 1 |
| AC-6 | The tour | The visitor steps through to the end | All 7 steps show in order; picking a gift updates the button total; no request leaves the browser (no fetch to Supabase or `/api`) |
| AC-7 | Any tour step | The visitor taps **Skip tour**, or at the end **Have an invite? Sign in** | They reach the home page or sign-in respectively |
| AC-8 | The home page or tour end | The visitor taps **🔒 Invite only** or **Have an invite? Sign in** | Sign-in opens, and after signing in they land on their app home |
| AC-9 | A guest on a shared list (`/share/<token>`) | Looks for more | A small "What is GiftsAF?" link to `/` is present and doesn't push the claim buttons down noticeably |
| AC-10 | The home page | The visitor taps **Send feedback** | Their email app opens to the feedback address with the subject "GiftsAF alpha feedback" |
| AC-14 | A signed-out visitor | Opens sign-in | A line at the top says GiftsAF is invite only for now, with a "Request access" link (same email as AC-13) |
| AC-13 | The home page or tour end | The visitor taps **Request access** | Their email app opens to the same address with the subject "GiftsAF access request" and a one-line prefilled body asking for their name |
| AC-11 | The home page | Its HTML is fetched | The title and description are set for sharing (title "GiftsAF", a one-line description) |
| AC-12 | `main` is merged | Production deploys | https://giftsaf.com shows the home page to a signed-out visitor (checked on the live site) |

### Out of scope

- A real demo account or a "try it with your own data" sandbox (the tour uses fixed made-up data).
- Open sign-up: publishing the Google sign-in screen and sending Supabase's sign-up emails through Resend. Revisit when the alpha opens up.
- A request-access form or list (requests come by email for now).
- Analytics or tracking (none yet).
- Social sharing images (Open Graph image); title and description are enough for now.
- The "What is GiftsAF?" link in **emails**: that's ALL-23 when it builds the email templates. Scan-to-gift pages don't exist yet.
- A privacy page, terms, or a contact form.
- A logo; the name stays plain text (`apps/web/lib/brand.ts`).

### Open questions

None left for the owner. The calls below are marked in "What was decided".

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Who the page talks to | A young adult who forgets birthdays and can't say what they want (the owner's son, 24) | Owner: that's where the idea came from, and the same person spans all three products |
| Look | Direction B: bold, cheeky, dark | Owner picked it from three directions |
| Phone or computer | Phone first, and it must look good on a computer | Owner |
| Honest about alpha | Alpha strip, an ALPHA tag, a status per feature; pitch "where we're heading" | Owner: "a lot is still broken but you can poke around and see where we are heading" |
| Discovery vs task | Discovery gets the home page and the tour; task arrivals go straight to the task, with a small "What is GiftsAF?" link | Owner |
| Where the page lives | In the same app (`apps/web`): `/` shows the home page when signed out and the app home when signed in; the tour is `/tour` **[Claude's call]** | One app, one deploy (T19); no new project or domain setup |
| Theme | Home page, tour and app all follow the browser's light or dark setting; no toggle | Owner (2026-11-01), replacing Claude's "always dark" call |
| Tour data | Fixed made-up people and gifts in code, matching the ALL-41 mock-ups; rendered with the app's real components where they exist **[Claude's call]** | Shows the real look without touching real data; no seeding or demo accounts |
| Feedback | A `mailto:` link to allensforever711@gmail.com with subject "GiftsAF alpha feedback" **[Claude's call]** | Simplest thing; there's no inbox at `giftsaf.com` yet (Resend only receives on `in.giftsaf.com` into a webhook). The address is already public in the repo |
| Footer credit | "made by Aaron and Jim" **[Claude's call]** | Fits "it's two of us building this" |
| Who can get in | **Invite only: "Request access"**, not open sign-up. The tour shows where it's heading without an account; invited people sign in to poke around the real app | Owner chose this over open sign-up (2026-11-01). Google sign-in stays in testing mode, so inviting someone means adding their email as a Google test user (up to 100) |
| Invite-only feel | The sign-in entry is labelled **🔒 Invite only** (top bar) and "Have an invite? Sign in" (hook, tour end); sign-in says it's invite only, with a Request access link | Owner (2026-11-01): Aaron and Jim need a way in, and it signals that some people already have access, so others want in |
| How access is requested | A `mailto:` to the same address as feedback, subject "GiftsAF access request" **[Claude's call]** | Simplest; no form, no table, no inbox to build. A request list can come later if requests pile up |
| Concierge screens in the tour | Tour-only copies built from the ALL-41 mock-ups, in a tour folder; the list step reuses real list components where practical **[Claude's call]** | The real concierge screens don't exist yet (ALL-21 and later); the tour can switch to them when they do |
| Signed-in visitors | `/tour` is public for everyone; a signed-in user tapping "What is GiftsAF?" lands on their app home **[Claude's call]** | They already have an account; no second explainer address needed |
| Analytics | None for now **[Claude's call]** | Not needed to learn anything yet; adds a vendor and a privacy question |

## Principles check

- **Simplest version?** No sandbox account, no analytics, no OG image, no CMS: copy lives in the components. The tour is client-only with fixed data.
- **Hard-coded values?** The brand name and tagline come from `lib/brand.ts`. The feedback address and the made-up tour data are content, not business values; the address goes in `lib/brand.ts` beside the name. No prices or limits involved.
- **Product boundaries?** The home page and tour are shared (`apps/web/app` and `apps/web/components`), not a product module. The tour may render list and concierge components with fixed props, but must not call their data functions.
- **Docs and decisions:** add T# (home page and tour in the same app, signed-out `/` is public; this changes T30's "home needs an account") to `design/decisions.md`; update `design/ui.md` (home page look) and `README.md` (the docs table, for the new plan and mock-ups).

## Plan

**Architecture:** the home page is a public route, `/welcome`. For a **signed-out** visitor, `proxy.ts` *rewrites* `/` to `/welcome`, so the address bar still says `giftsaf.com`; signed-in visitors get today's app home untouched. The tour is a client-only page at `/tour`, driven by fixed sample data, with no server calls. Colours come from the existing theme tokens (`globals.css`, class-based dark mode via next-themes), so light and dark follow the browser like the rest of the app.

**Tech stack:** Next.js 16 App Router (`cacheComponents` on), Tailwind (`tailwind.config.ts`) with the tokens in `globals.css`, Vitest + Testing Library, Playwright.

**Spec:** the sections above. Mock-ups: `design/mockups/ALL-46-home.html`, `design/mockups/ALL-46-home-desktop.html`.

### Global constraints

- Copy comes from "The page" and "The tour" above; the brand name and tagline only through `@/lib/brand`.
- Feedback and access-request address: `allensforever711@gmail.com`; subjects exactly "GiftsAF alpha feedback" and "GiftsAF access request".
- Colours only from theme tokens (`bg-background`, `text-foreground`, `bg-primary`, `bg-card`, `text-muted-foreground`, `border`). The sticker and alpha strip use one new token pair, `--sticker` / `--sticker-foreground` (`#facc15` on `#18181b` in both themes), added to `globals.css` and `tailwind.config.ts` and listed in `design/ui.md`.
- Touch targets at least 44 px; no horizontal scroll at 375 px; the computer layout starts at the `md` breakpoint (768 px).
- `/welcome` and `/tour` make no Supabase or `/api` calls.
- Branch `aarontallen/all-46-home-page`; PR title `feat: home page and guided tour for giftsaf.com (ALL-46)`; body `Closes ALL-46`.

### Review focus

1. **A signed-in user opening `/`** must still get the app home, never the home page; the rewrite only happens with no session. Tests: Task 1 `homeRewrite`, and the sign-in walk in Task 5.
2. **Session cookies on the rewrite response:** cookies Supabase set on `supabaseResponse` must be copied onto the rewrite, or a refreshed session is dropped. Test: Task 1 `withCookies`.
3. **Deep links still go through sign-in** (`/settings` → `/auth/login?next=%2Fsettings`); only `/` is rewritten. Tests: existing `signInRedirect` tests and Task 1's `homeRewrite("/settings", false)`.
4. **Tour picks:** deselecting the last gift disables the button and resets it to "Pick a gift"; two picks add up. Test: Task 3.
5. **`mailto:` encoding:** subjects and the prefilled body are URL-encoded (spaces as `%20`, no raw `?` or `&`). Test: Task 1 `brand.test.ts`.

---

### Task 1: Routing, public paths, and contact links (AC-1, AC-2, AC-10, AC-13)

**Files:**
- Modify: `apps/web/lib/brand.ts`, `apps/web/lib/supabase/proxy.ts`
- Test: `apps/web/test/public-paths.test.ts`; create `apps/web/test/brand.test.ts`

**Interfaces:**
- Produces: `FEEDBACK_EMAIL: string`, `feedbackHref(): string`, `accessRequestHref(): string` from `@/lib/brand`; `homeRewrite(pathname: string, signedIn: boolean): string | null` and `withCookies(from: NextResponse, to: NextResponse): NextResponse` from `@/lib/supabase/proxy`.

- [ ] **Step 1: Write the failing tests.**
  - `public-paths.test.ts`: add `"/welcome"` and `"/tour"` to the allowed list; keep `"/"` and `"/settings"` blocked (the rewrite, not `isPublicPath`, handles `/`).
  - `homeRewrite("/", false)` → `"/welcome"`; `homeRewrite("/", true)` → `null`; `homeRewrite("/settings", false)` → `null`.
  - `withCookies`: a cookie set on `from` is present on the returned response.
  - `brand.test.ts`: `feedbackHref()` equals `"mailto:allensforever711@gmail.com?subject=GiftsAF%20alpha%20feedback"`; `accessRequestHref()` starts with `"mailto:allensforever711@gmail.com?subject=GiftsAF%20access%20request&body="` and its decoded body contains `"name"`.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- public-paths brand` — Expected: FAIL.
- [ ] **Step 3: Implement.** `brand.ts`: the constant and two builders with `encodeURIComponent`. `proxy.ts`: add `/welcome` and `/tour` to `isPublicPath`; export `homeRewrite` and `withCookies`; in `updateSession`, before the sign-in redirect, when `homeRewrite(pathname, Boolean(user))` returns a path, return `withCookies(supabaseResponse, NextResponse.rewrite(new URL(path, request.url)))`. Update the comment that says Home needs an account.
- [ ] **Step 4: Run the tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: public home route and contact links (ALL-46)`.

### Task 2: The home page (AC-1, AC-3, AC-4, AC-10, AC-11, AC-13, AC-15)

**Files:**
- Create: `apps/web/app/welcome/page.tsx` (metadata: title `APP_NAME`, description the hook's "Where we're heading…" line)
- Create in `apps/web/components/home/`: `alpha-strip.tsx`, `home-top-bar.tsx`, `hook.tsx`, `pick-preview.tsx` (the "pick a gift" card beside the hook on computers), `features.tsx`, `steps.tsx`, `feedback.tsx`, `home-footer.tsx`
- Modify: `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` (the `sticker` token)
- Test: `apps/web/components/home/__tests__/home.test.tsx`

**Interfaces:**
- Consumes: `feedbackHref`, `accessRequestHref`, `APP_NAME` (Task 1).
- Produces: `<AlphaStrip />` and `<HomeTopBar />`, reused by the tour.

- [ ] **Step 1: Write the failing test.** Render the `/welcome` page and assert: heading "Gifting, handled AF."; text "Early alpha. Lots is broken. Poke around anyway."; links "🔒 Invite only" → `/auth/login`, "Take the tour" → `/tour`, "Request access" → `accessRequestHref()`, "Have an invite? Sign in" → `/auth/login`, "Send feedback" → `feedbackHref()`, "How it works" → `#how-it-works`; status chips "Works now", "Being built", "Later" with "Your gift list", "Never forget a birthday", "Buy-me-a-drink shirts"; step titles "Add your people", "We get ideas ready", "You tap yes"; "Nothing is ever bought without your OK."; footer "GiftsAF alpha · made by Aaron and Jim". Also import the page's `metadata` and assert `title` is `APP_NAME` and `description` is a non-empty string (AC-11).
- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Build the components** to the mock-ups. One column on phones. From `md`: the hook is two columns with `<PickPreview />` on the right (hidden below `md`), and feature cards and steps sit three across. Each step is a row: a 28 px numbered circle, then a title over one line of text, so nothing wraps mid-sentence. Status chips: "Works now" success, "Being built" warning, "Later" muted. All colours are tokens, so light and dark follow the browser.
- [ ] **Step 4: Run it** — Expected: PASS. Then check `/welcome` in `pnpm --filter @gifts-af/web dev` at 375 px and 1280 px, in light and dark (DevTools → Rendering → prefers-color-scheme).
- [ ] **Step 5: Commit** `feat: home page (ALL-46)`.

### Task 3: The guided tour (AC-5, AC-6, AC-7)

**Files:**
- Create: `apps/web/app/tour/page.tsx` (renders `<Tour />`)
- Create in `apps/web/components/tour/`: `tour.tsx` (`"use client"`), `tour-data.ts`, `people-screen.tsx`, `pick-screen.tsx`, `ship-screen.tsx`, `done-screen.tsx`, `ideas-screen.tsx`, `list-screen.tsx`, `end-screen.tsx`
- Test: `apps/web/components/tour/__tests__/tour.test.tsx`

**Interfaces:**
- Consumes: `<AlphaStrip />`, `<HomeTopBar />` (Task 2); `accessRequestHref` (Task 1).
- Produces: `TOUR_STEPS: readonly { id: "people" | "pick" | "ship" | "done" | "ideas" | "list" | "end"; caption: string }[]`, and the sample data in `tour-data.ts` copied from the ALL-41 mock-up: Mom, Dad, Sam; Mom's mug set $42, herb planter $68, audiobook credits $45; Dad's sharpening stones $38, shop jacket $59, coffee grinder $46; your list: kettle $39.00, paperback $14.50, rain jacket $80.00.

- [ ] **Step 1: Write the failing tests.**
  - Clicking **Next** six times from the first screen reaches the end screen; each screen shows its `TOUR_STEPS` caption and "Step n of 7".
  - Pick screen: the button reads "Pick a gift" and is disabled; select the mug set → "Send 1 gift · $42"; add the planter → "Send 2 gifts · $110"; deselect both → "Pick a gift", disabled.
  - Done screen shows "Ordered. (Not really, this is the tour.)".
  - "Skip tour" → `/`; end screen: "Request access" → `accessRequestHref()`, "Have an invite? Sign in" → `/auth/login`, "Back to home" → `/`.
  - `vi.spyOn(globalThis, "fetch")` is never called during a full walkthrough.
- [ ] **Step 2: Run them** — Expected: FAIL.
- [ ] **Step 3: Build `<Tour />`**: state is the step index and the picked gift ids; **Next** and **Back** (Back hidden on step 1); each screen is a phone-sized card in the app's look (tokens), copied from the ALL-41 mock-ups. Tour-only components: no imports from `@/modules/*`.
- [ ] **Step 4: Run them** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: guided tour with sample people (ALL-46)`.

### Task 4: Invite-only sign-in note and the shared-list link (AC-9, AC-14) [P with Task 3]

**Files:**
- Modify: `apps/web/app/auth/login/page.tsx`, `apps/web/modules/lists/components/shared-list.jsx`
- Test: create `apps/web/test/login-page.test.tsx`; add a case in `apps/web/modules/lists/components/__tests__/`

- [ ] **Step 1: Write the failing tests**: the login page shows "GiftsAF is invite only for now." with a link "Request access" → `accessRequestHref()`; the shared list has a link "What is GiftsAF?" → `/`, rendered after the gift grid.
- [ ] **Step 2: Run them** — Expected: FAIL.
- [ ] **Step 3: Add the note and the link** (13–14 px muted text, 44 px tap height).
- [ ] **Step 4: Run them** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: invite-only sign-in note and shared-list link (ALL-46)`.

### Task 5: Browser tests, docs, and going live (AC-3, AC-8, AC-12, AC-15)

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`: signed-out `/` now shows the home page. Replace each `goto("/")` → `toHaveURL(/\/auth\/login$/)` check with the heading "Gifting, handled AF.", and start sign-in from the "🔒 Invite only" link.
- Create: `apps/web/e2e/home.spec.ts`
- Modify: `design/decisions.md` (next T#; fetch and check `origin/main` first), `design/ui.md`, `README.md` (docs table: this plan and the two mock-ups)

- [ ] **Step 1: Write `home.spec.ts`**: at 375 px, signed out, `/` shows the heading with no horizontal overflow; at 1280 px the hook text and `PickPreview` share a row (bounding boxes overlap vertically); with `colorScheme: "dark"` the `<html>` element has the `dark` class and with `"light"` it doesn't; "Take the tour" → Next to the end → "Have an invite? Sign in" → sign in as `TEST_USER` → the "People" heading shows.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web e2e` with local Supabase running — Expected: PASS, including the updated smoke test.
- [ ] **Step 3: Docs.** New T#: "The home page and tour live in the app: signed-out `/` rewrites to the public `/welcome`; `/tour` is client-only sample data; invite only for now (refines T30's 'home needs an account')". `ui.md`: a short "Home page" section (direction B, both themes, the `sticker` token). README docs table rows. These ship in the same PR.
- [ ] **Step 4: Full check** from the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — Expected: all pass.
- [ ] **Step 5: PR**: push, open the PR (Global constraints), wait for CI, review with superpowers:requesting-code-review, squash-merge with `--author-email aaron.aallen@gmail.com`.
- [ ] **Step 6: Live check (AC-12)**: after the production deploy, `curl -s https://giftsaf.com/ | grep -c "Gifting, handled AF."` is at least 1, `https://giftsaf.com/tour` returns 200, and the owner opens giftsaf.com on a phone in light and dark.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test: AC-1/2 → T1, T5; AC-3 → T2, T5; AC-4 → T2; AC-5/6/7 → T3; AC-8 → T5; AC-9 → T4; AC-10/13 → T1, T2; AC-11 → T2; AC-12 → T5 step 6; AC-14 → T4; AC-15 → T2, T5.
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.
