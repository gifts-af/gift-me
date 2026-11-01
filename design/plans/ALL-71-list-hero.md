# ALL-71 Home page: a list hero above the concierge, with its own tour: Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task.

**Goal:** a signed-out visitor to giftsaf.com sees, first, that GiftsAF already gives them a wish list they can text to anyone who asks, with a short tour of it; the concierge hero follows, unchanged except for its button.

**Links:** [ALL-71](https://linear.app/allens-forever/issue/ALL-71). Home page: ALL-46 (`design/plans/ALL-46-home-page.md`, T34), tour layout ALL-61, tour icons ALL-62. Owners never see claims: product decision 39, T30. Mock-up from the brainstorm (2026-11-01): two heroes stacked, list first.

## Spec: what it does

### Why

The home page sells only the concierge, which is still being built. The part that works today is the list: when someone asks "what do you want for your birthday?", you text them one link. Some people will want only that. Today it's one small card in the "Today" section. The owner wants it as visible as the concierge, and as frictionless as the list itself.

### Who it's for and what they can do

1. **See the list first:** as a signed-out visitor, the top of the home page tells me I can keep a wish list and text one link to whoever asks.
2. **Tour the list:** I can take a short tour of the list with made-up gifts, like the concierge tour.
3. **Ask to get in:** from the list hero (and its tour's last step) I can request access; from the concierge hero I can join the waitlist.

### The page, top to bottom

1. **List hero (new).** Same layout, sizes and spacing as today's hero (`components/home/hook.tsx`): text left, sample card right from `md`; on phones one column with the card hidden, like today's hero hides its card. Parts:
   - **Sticker:** "What do you want for your birthday?" with 🎁 (same sticker style).
   - **Headline (the page's `h1`):** "Your wish list, one text away."
   - **Line of text:** "Add gifts from any shop. Text one link when someone asks. Family claims a gift so nobody doubles up."
   - **Buttons:** **Take the tour** (primary, to the list tour) and **Request access** (secondary, the existing request-access dialog). Under them, the "Have an invite? Sign in" link, as today.
   - **Sample card:** what the person who asked sees: a text exchange ("what do u want for ur bday?" / "here you go 👇"), then "Aaron's list" with three gifts, each with a lucide icon in the muted box (as ALL-62), one marked **Claimed** and two with a **Claim** button. Sample content, not real data.
2. **Concierge hero (today's hero).** Unchanged except: its headline becomes an `h2` (same look), and **Request access** becomes **Join the waitlist**.
3. **Everything below stays as it is**, including the "Your gift list" card in "Today".

Light and dark follow the browser, using the existing tokens; no new colours.

### The list tour (new)

At `/tour/list`, built like `/tour` (same frame, two-column layout from `md`, step counter, Skip tour, Next, focus moves to each caption). Made-up content only; nothing is saved or sent.

| Step | Caption | Phone screen |
|---|---|---|
| 1 | "Add anything you'd like, from any shop." | Your list with three gifts (icon, name, shop, price, a size or note) |
| 2 | "Someone asks what you want? Text them one link." | A text thread ending in the list link, with a Copy link button |
| 3 | "They open it and claim a gift, so nobody doubles up." | The shared list as Mom sees it; tapping Claim on a gift marks it claimed |
| 4 | "You never see who got what. It's still a surprise." | Your own list again, no claim marks |
| 5 | "That's your list." | End screen: **Request access**, "Have an invite? Sign in", Back to home |

### Waitlist

**Join the waitlist** opens the same form as Request access, titled "Join the waitlist" with a line saying the concierge is still being built and we'll email when it's ready. The concierge tour's last step says **Join the waitlist** too, with its line reworded to "The concierge is still being built. Join the waitlist and we'll email you when it's ready." and a smaller "Just want the list? Request access" link under it **[Claude's call]**. `EndScreen` takes its line and buttons as props so both tours use it.

`/tour/list` must be added to `isPublicPath` in `lib/supabase/proxy.ts` (today only `/tour` is public), with a row in `test/public-paths.test.ts`.

**Inbox filters (owner, 2026-11-01).** Each form emails a Gmail plus-address of the team inbox, so Gmail filters and labels can sort them:

| Form | Sent to | Subject |
|---|---|---|
| Request access | `allensforever711+access@gmail.com` | "GiftsAF access request: {name}" (as today) |
| Join the waitlist | `allensforever711+waitlist@gmail.com` | "GiftsAF waitlist: {name}" |
| Feedback | `allensforever711+feedback@gmail.com` | as today |

**What each form promises, and what the owner does (owner, 2026-11-01).** The waitlist is for the concierge, so it means *later*:

| | Request access | Join the waitlist |
|---|---|---|
| Thank-you on screen | "We'll email you when you're in." (as today) | "You're on the list. We'll email you when the concierge is ready." plus a small "Want your wish list now? Request access" link |
| Email to the owner | As today: add them as a Google test user, then reply | "{name} wants the concierge. Email them when it launches." No test-user step |
| Email to the person (new) | "Thanks, we got your request. We'll email you when you're in." | "You're on the concierge waitlist. We'll email you when it's ready." |

Nothing is stored: the `+waitlist` Gmail label *is* the waitlist, and at launch the owner invites everyone under it.

**Branded emails (owner, 2026-11-01: "this is a branding touchpoint").** Every email these forms send, to the person and to the owner, uses the ALL-23 email layout (`renderEmail` in `modules/concierge/notify/email-layout.ts`: site teal, phone-safe, always light by design (T33), with a plain-text part). That layout has no logo yet, so this ticket adds the GiftsAF wordmark at the top of **every** email (the concierge's too): a PNG at `https://giftsaf.com/email-logo.png`, drawn from the same art as the site's logo (`lib/logo-art.ts`), since Gmail doesn't show SVG. Its `alt` is "GiftsAF", so it still reads right with images off. The button becomes optional; these form emails have none. The confirmation to the person is new: today they get nothing. The layout moves to `apps/web/lib/` (shared code) so these forms don't import the concierge module, and the concierge's templates import it from there **[Claude's call]**. The person's confirmation has no links to act on and no tracking, and is sent only after the bot check passes (ALL-68), so the form can't be used to email strangers. Feedback emails to the owner use the layout too; feedback senders get no confirmation (not asked for). The `e2e/emails.spec.ts` phone checks cover the new templates.

The tag is added to `FEEDBACK_EMAIL` in `lib/brand.ts` by one helper (`inboxFor("access")`), so the base address stays in one place. Feedback getting a tag too is Claude's call (same reason). The `mailto:` fallback in the bot-check notice keeps the plain address.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Signed out | I open `/` | The list hero is first: its headline is the page's only `h1`, then "Gifting, handled AF." as an `h2` |
| AC-2 | List hero | I look at its buttons | "Take the tour" goes to `/tour/list`; "Request access" opens the request dialog |
| AC-3 | Concierge hero | I click "Join the waitlist" | The waitlist dialog opens; sending it emails `allensforever711+waitlist@gmail.com` with "waitlist" in the subject |
| AC-3b | Any page | I send Request access, or feedback | The email goes to `+access`, or `+feedback`, respectively |
| AC-3c | Request access or waitlist sent | — | The person gets a branded confirmation email with the wording above; the owner's email is branded too; the waitlist thank-you and owner email match the table |
| AC-3d | Each new email | Rendered at 375 px, light and dark | Passes the `emails.spec.ts` phone-layout checks |
| AC-4 | 1280 px | `/` | In the list hero the sample card sits right of the text (as the concierge hero test does) |
| AC-5 | 375 px, light and dark | `/` and `/tour/list` | No sideways scroll; the theme follows the browser |
| AC-6 | `/tour/list` | I press Next through every step | Steps 1–5 show their captions; Claim on step 3 marks the gift claimed; step 5 has Request access |
| AC-7 | `/tour/list` at 375 and 1280 px | Step 2 | Same layout rules as the ALL-61 tour test |
| AC-8 | Concierge tour | Last step | It says "Join the waitlist" |

### Out of scope

- Open sign-up. GiftsAF stays invite-only (T34); the owner chose Request access over Sign up (2026-11-01).
- Gating the concierge for list-only users: not needed while sign-up is invite-only.
- Changes to the signed-in Home, the list app, or the sections below the two heroes.
- Real product photos (ALL-27).
- A branded "you're in" invite email and the concierge launch email: the owner replies by hand for now.
- Storing requests or the waitlist in the database.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Where does the list go? | A second hero above today's, same parts | Owner, 2026-11-01 |
| Buttons | List hero: Take the tour + Request access. Concierge hero: Take the tour + Join the waitlist | Owner |
| Theme | Same light/dark as the rest of the page | Owner |
| Rest of the page | Unchanged | Owner ("we are just adding one section above") |
| Copy, sample card, tour steps | As above | Claude's call; owner reviews in the PR preview |
| Sample card shows the asker's view, not the owner's | The owner never sees claims (decision 39), so a card showing "Claimed" on your own list would be wrong | Claude's call |
| Tour route `/tour/list`; concierge tour stays at `/tour` | Existing links keep working | Claude's call |
| Waitlist reuses the request form | One form; the owner tells them apart by address and subject | Claude's call |
| Each form emails a plus-address (`+access`, `+waitlist`) | So Gmail filters and labels can sort them | Owner |
| The waitlist means "later": no invite until the concierge launches | They clicked on the concierge, so "when you're in" would be the wrong promise | Owner |
| Branded emails, plus a new confirmation to the person | A branding touchpoint | Owner |
| The email layout moves to `lib/` | Shared by the concierge and the public forms without crossing modules (T19) | Claude's call |
| Only the first hero has the page's `h1` | One `h1` per page | Claude's call |

## Principles check

- **Simplest version?** Reuse the hero layout, the tour frame, the request form and the ALL-62 icons. No new data, no network calls in the tour.
- **Hard-coded values?** Copy and sample content only; no tunables.
- **Product boundaries?** Home and tour components only; no module imports beyond what they use today.
- **New personal data?** None stored. The waitlist form collects what Request access already does; the new confirmation email goes only to the address the person typed, for the request they just made (T42).
- **Docs and decisions:** add a line to T34 in `design/decisions.md` (the home page now leads with the list; waitlist wording for the concierge).

## Plan

**Architecture:** the email layout moves to `lib/email-layout.ts` and gains a logo header (a PNG route) and an optional button; the public forms build branded emails from it and send to plus-addresses. The request form takes a `kind` (`access` or `waitlist`) through a hidden field. The home page gets a `ListHook` section above `Hook`; the tour frame is pulled out of `Tour` so a new `ListTour` at `/tour/list` reuses it.

**Tech stack:** Next.js 16 (App Router, `next/og` for the PNG), Tailwind, Vitest + Testing Library, Playwright (`android`, `iphone`, `desktop` projects).

**Branch:** `aarontallen/all-71-list-hero`, PR `feat: home page leads with your list, plus waitlist and branded form emails (ALL-71)`, `Closes ALL-71`. Before the PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, checking each exit code (not piped).

### Global constraints

- Copy is exactly as in the spec tables above.
- Inbox: `allensforever711+access@gmail.com`, `+waitlist`, `+feedback`; base address stays only in `FEEDBACK_EMAIL`.
- Emails: inline styles only, always light, viewport meta, 48 px button (ALL-60 rules stay).
- No new settings or env vars; no data stored; the tour makes no network calls.
- Light and dark on the page come from existing tokens; no new colours.
- Imports across products only through `index.ts` (T19).

### Review focus

1. **Bad `kind` in the form post** (tampered hidden field): treated as `access`, never throws. Test in Task 2.
2. **The person's confirmation fails to send but the owner's succeeds** (or the reverse): the visitor still sees the thank-you if the owner's email went; a failed owner email is the error. Test in Task 2.
3. **A name with HTML or line breaks** (`<b>Sam</b>\nBcc:`) in the subject and body: escaped in HTML, and newlines stripped from the subject. Test in Task 2.
4. **Signed-out visitor opens `/tour/list` or the logo PNG**: not sent to sign-in. Test in Tasks 1 and 5.
5. **Two "Take the tour" links on `/`**: each goes to its own tour (tests pick them by section, not `.first()`). Test in Task 4.

### Task 1: Shared email layout with a logo (spec: Branded emails)

**Files:**
- Move: `apps/web/modules/concierge/notify/email-layout.ts` → `apps/web/lib/email-layout.ts`; update the import in `modules/concierge/notify/templates.ts`
- Create: `apps/web/app/email-logo.png/route.tsx`
- Modify: `apps/web/lib/supabase/proxy.ts` (`isPublicPath`)
- Test: `apps/web/test/email-layout.test.ts` (new), `apps/web/test/public-paths.test.ts`, `apps/web/modules/concierge/__tests__/templates.test.ts` (must still pass)

**Interfaces:**
- Produces: `renderEmail(parts: EmailParts): { html: string; text: string }` and `escapeHtml(s: string): string` from `@/lib/email-layout`. `EmailParts.button` becomes optional. New export `EMAIL_LOGO_URL = \`https://${APP_DOMAIN}/email-logo.png\``.

- [ ] **Step 1: Failing tests** in `test/email-layout.test.ts`:
  - `"every email starts with the GiftsAF logo"`: `renderEmail({heading:"Hi", paragraphs:["x"]}).html` contains `<img src="https://giftsaf.com/email-logo.png"` with `alt="GiftsAF"`, `width=` and `height=` set, before the `<h1`.
  - `"the button is optional"`: no `<a ` in the html and no `: http` line in the text when `button` is omitted.
  - `"with a button, it's still 48px tall"`: html contains `line-height:20px;padding:14px 20px`.
  - In `public-paths.test.ts`: `"/email-logo.png"` is public.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test email-layout public-paths`. Expected: FAIL (module not found / path not public).
- [ ] **Step 3: Implement.** `git mv` the layout; add the logo `<img>` (about 120×40 shown, drawn at 2×) above the heading; make the button optional in html and text. The route returns `new ImageResponse(...)` at 240×80, white background, "Gifts" in Geist Black plus `tagSvg({ holiday: await holidayLogoNow() })`, drawn the way `app/opengraph-image.tsx` does it (reuse its font loading). Add `pathname === "/email-logo.png"` to `isPublicPath`.
- [ ] **Step 4: Run** the same tests plus `templates.test.ts`. Expected: PASS. Open `http://localhost:3000/email-logo.png` under `pnpm dev`: the wordmark shows.
- [ ] **Step 5: Commit** `feat: GiftsAF logo on every email, layout shared from lib (ALL-71)`.

### Task 2: Form emails: plus-addresses, waitlist, confirmations, branded (spec: Waitlist, Inbox filters, Branded emails)

**Files:**
- Modify: `apps/web/lib/brand.ts`, `apps/web/lib/access-request.ts`, `apps/web/lib/feedback.ts`
- Create: `apps/web/scripts/form-email-html.ts`, wire into `scripts/email-html.ts` so `pnpm email:html <dir>` also writes the form emails
- Test: `apps/web/test/access-request.test.ts`, `apps/web/test/feedback.test.ts`, `apps/web/e2e/emails.spec.ts`

**Interfaces:**
- Consumes: `renderEmail` from Task 1.
- Produces:
  - `inboxFor(tag: "access" | "waitlist" | "feedback"): string` in `lib/brand.ts`: inserts `+tag` before the `@` of `FEEDBACK_EMAIL`.
  - `type RequestKind = "access" | "waitlist"`; `AccessRequest` gains `kind: RequestKind` (from form field `kind`; anything else → `"access"`).
  - `buildAccessRequestEmail(req): OutgoingEmail` (to owner) and new `buildRequestConfirmation(req): OutgoingEmail` (to `req.email`).
  - `sampleFormEmails(): { name: string; html: string }[]` (names `access-owner`, `access-confirmation`, `waitlist-owner`, `waitlist-confirmation`, `feedback-owner`) for the phone checks.

- [ ] **Step 1: Failing tests** in `access-request.test.ts`:
  - `"access requests go to +access"`: `buildAccessRequestEmail({kind:"access",…}).to === "allensforever711+access@gmail.com"`, subject `"GiftsAF access request: Sam"`, text contains "Test users".
  - `"waitlist goes to +waitlist and asks to email at launch"`: to `+waitlist`, subject `"GiftsAF waitlist: Sam"`, text contains "wants the concierge" and not "Test users".
  - `"an unknown kind counts as access"`: `validateAccessRequest` with `kind=admin` gives `kind: "access"`.
  - `"the person gets a branded confirmation"`: for access, to `req.email`, text contains "We'll email you when you're in"; for waitlist, "We'll email you when it's ready"; both html contain the logo URL; no `replyTo`.
  - `"owner emails are branded"`: html contains the logo URL.
  - `"a name can't break the email"`: name `"<b>Sam</b>\nBcc: x"` → subject has no `\n`, html has `&lt;b&gt;`.
  - `"requestAccess sends to owner, then the person"`: fake `fetch` records two calls in that order; if the second fails the result is still `{status:"sent"}`; if the first fails it's `error` and the second isn't sent.
  - In `feedback.test.ts`: to `"allensforever711+feedback@gmail.com"`, html contains the logo URL.
  - In `emails.spec.ts`: the expected sample list adds the five form-email names; each passes the existing phone checks in light and dark.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test access-request feedback`. Expected: FAIL.
- [ ] **Step 3: Implement.** Strip `\r\n` from the name for subjects. Owner email first, confirmation second; return `sent` once the owner email is sent (log a failed confirmation with `console.error`). Confirmation and owner emails use `renderEmail` with no button; paragraphs carry the spec copy; owner emails list the name, email and note as `rows`.
- [ ] **Step 4: Run** the unit tests, then `pnpm --filter @gifts-af/web exec playwright test emails --project=iphone`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: form emails are branded, tagged by inbox, and confirm to the sender (ALL-71)`.

### Task 3: Waitlist dialog and thank-you (spec: Waitlist)

**Files:**
- Modify: `apps/web/app/request-access/request-access-form.tsx`, `apps/web/components/home/request-access-dialog.tsx`
- Test: `apps/web/components/home/__tests__/overlays.test.tsx`, `apps/web/test/request-access-page.test.tsx`

**Interfaces:**
- Consumes: form field `kind` (Task 2).
- Produces: `RequestAccessForm({ onSent, kind = "access" })` posting a hidden `<input name="kind">`; `RequestAccessButton({ className, children, kind = "access" })`. With `kind="waitlist"`: button text and submit "Join the waitlist", dialog title "Join the waitlist", description "The concierge is still being built. Leave your name and email and we'll tell you when it's ready.", thank-you "You're on the list. We'll email you when the concierge is ready." plus a `RequestAccessButton` styled as a link reading "Want your wish list now? Request access".

- [ ] **Step 1: Failing tests** in `overlays.test.tsx`: `"Join the waitlist opens the waitlist form"` (dialog named "Join the waitlist", hidden `kind` input value `waitlist`, submit labelled "Join the waitlist"); `"Request access posts kind=access"`; a sent waitlist form shows the waitlist thank-you and the "Request access" link.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test overlays request-access-page`. Expected: FAIL.
- [ ] **Step 3: Implement** the `kind` prop in both components; copy as above.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Join the waitlist form for the concierge (ALL-71)`.

### Task 4: The list hero on the home page (AC-1, AC-2, AC-4, AC-5)

**Files:**
- Create: `apps/web/components/home/list-hook.tsx`, `apps/web/components/home/list-preview.tsx`
- Modify: `apps/web/app/welcome/page.tsx` (`<ListHook />` before `<Hook />`), `apps/web/components/home/hook.tsx` (`h1` → `h2` with the same classes; `RequestAccessButton kind="waitlist"`)
- Docs: a sentence on T34 in `design/decisions.md` (home leads with the list; concierge says Join the waitlist; form emails tagged and branded)
- Test: `apps/web/components/home/__tests__/home.test.tsx`, `apps/web/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `RequestAccessButton` (Task 3), `MY_LIST` from `components/tour/tour-data.ts`.
- Produces: `ListHook()` section with `aria-labelledby` its `h1`, `data-testid="list-hook-text"`; `ListPreview()` with `data-testid="list-preview"`, `aria-hidden="true"`, hidden below `md` like `PickPreview`.

- [ ] **Step 1: Failing tests.** `home.test.tsx`: the only `h1` is "Your wish list, one text away."; "Gifting, handled AF." is an `h2`; within the list hero section, "Take the tour" has `href="/tour/list"` and "Request access" is a button; within the concierge hero, "Take the tour" has `href="/tour"` and the button is "Join the waitlist"; the preview shows 3 `gift-thumb` boxes with svgs, one "Claimed" and two "Claim". `home.spec.ts`: update headings to the new `h1`; add `"on a computer the list hook sits beside its sample card"` (as the existing hook test, with `list-hook-text` and `list-preview`); the request-access test clicks the list hero's button by section; the 375 px light/dark tests run unchanged.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test home`. Expected: FAIL.
- [ ] **Step 3: Implement** `ListHook` as a copy of `Hook`'s layout with the spec copy; `ListPreview` as the spec's card (text bubbles, "Aaron's list", `MY_LIST` rows with the ALL-62 icon box, first row "Claimed", others a "Claim" pill), styled like `PickPreview`.
- [ ] **Step 4: Run** unit tests, then `pnpm --filter @gifts-af/web exec playwright test home`. Expected: PASS on all three projects.
- [ ] **Step 5: Commit** `feat: home page leads with your list (ALL-71)`.

### Task 5: The list tour (AC-6, AC-7, AC-8)

**Files:**
- Create: `apps/web/components/tour/tour-frame.tsx`, `apps/web/components/tour/list-tour.tsx`, `apps/web/components/tour/list-tour-screens.tsx`, `apps/web/app/tour/list/page.tsx`
- Modify: `apps/web/components/tour/tour.tsx` (uses `TourFrame`), `apps/web/components/tour/end-screen.tsx`, `apps/web/components/tour/tour-data.ts` (`LIST_TOUR_STEPS`), `apps/web/lib/supabase/proxy.ts`
- Test: `apps/web/components/tour/__tests__/list-tour.test.tsx` (new), `apps/web/components/tour/__tests__/tour.test.tsx`, `apps/web/test/public-paths.test.ts`, `apps/web/e2e/home.spec.ts`

**Interfaces:**
- Produces:
  - `TourFrame({ step, total, caption, onBack, onNext, last, children })`: today's step bar, Skip tour, focused `h1` caption, `data-testid="tour-screen"` slot and Back/Next, with the ALL-61 grid classes moved over unchanged.
  - `LIST_TOUR_STEPS`: ids `add`, `share`, `claim`, `surprise`, `end` with the spec's captions.
  - `EndScreen({ line, primary, secondary? })`: `primary`/`secondary` are React nodes. The list tour passes the "That's your list." line + `RequestAccessButton`; the concierge tour passes the spec's waitlist line, `RequestAccessButton kind="waitlist"`, and a link-styled "Just want the list? Request access". Both keep "Have an invite? Sign in" and "Back to home".

- [ ] **Step 1: Failing tests.** `list-tour.test.tsx`: steps show the 5 captions in order; step 3 tapping "Claim" on the first gift makes it read "Claimed"; step 4 shows no "Claimed"; step 5 has a "Request access" button. `tour.test.tsx`: the last step has "Join the waitlist" and "Just want the list? Request access". `public-paths.test.ts`: `/tour/list` public. `home.spec.ts`: run the ALL-61 layout test for both `/tour` and `/tour/list`; add `"take the list tour from the home page"` (click the list hero's Take the tour, Next ×4, see "Step 5 of 5").
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test tour public-paths`. Expected: FAIL.
- [ ] **Step 3: Implement.** Extract `TourFrame` first and keep `tour.test.tsx` green; then `ListTour` with local `claimed` state, screens built from `Phone`/`Row` and `MY_LIST`; add `pathname === "/tour/list"` to `isPublicPath`; page metadata "List tour · GiftsAF".
- [ ] **Step 4: Run** unit tests, then `pnpm --filter @gifts-af/web exec playwright test home`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: a short tour of your list (ALL-71)`.

### Before coding: consistency check

- [x] Every acceptance criterion maps to a task: AC-1/2/4/5 → 4; AC-3/3b/3c/3d → 2 and 3; AC-6/7/8 → 5.
- [x] Every task traces back to the spec (Task 1 is the logo and shared layout the branded emails need).
- [x] No open questions left.

After merge: send one of each form on production and check the five emails in Gmail on a phone; set up the `+access`, `+waitlist` and `+feedback` filters.
