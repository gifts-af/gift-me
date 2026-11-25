# ALL-179 Open list sign-up, and the concierge by request: Spec and Plan

**Status:** spec approved by the owner, 2026-11-25. Plan reviewed, and approved by the owner the same day, with both new [Claude's call] rows (10 requests a day, mail scanners) agreed. Built subagent-driven.

**Goal:** anyone can sign up at giftsaf.com, build a wish list and share it, free; the concierge (Give) is something they request and we approve.

**Links:** [ALL-179](https://linear.app/allens-forever/issue/ALL-179). Revises T34 (invite only), T30 and T58 (everyone lands on Give at `/`; landing since revised by T98), T37 and the ALL-71 waitlist, T43 (a signed-in request has no Turnstile), T45 (import off for now), T69's reason, T78 (the shared-list card) and planning 57's caps. Keeps planning decision 53 (what costs money is off unless `paid_features` is on) and D59 (friends use the concierge once card payments ship).

**Scope freeze:** built as the owner's exception (2026-11-25).

## Change: people are free (option B)

**Status:** approved by the owner, 2026-11-25, with yes to a file cap (500, lowered by the owner to 100 the same day), "Add … to your people" for signed-out visitors, and T61's city and state. The owner chose B after Tasks 1 to 4 were built for A. Those tasks' text below is kept as the record of what was built; Task 4b changes it. Where this section and Tasks 2 to 4 disagree, this section wins.

**Why:** family needs everyone's lists in one place for Christmas. It adds no new spending: AI, rounds, reading captures and buying each check `paid_features`, which the review confirmed in the code. Small existing costs stay: Amazon lookups (capped), one "not read" reply ever to an unpaid account's emailed note (it counts toward Resend's 100 a day), and store pages read for pasted links (no per-person limit; `store_page_read_enabled` turns it off).

**What changes:** anyone signed in can add people, link their lists and see them on Give. Access is asked for where the concierge starts: gift ideas, and the concierge settings.

| # | Replaces | Now |
|---|---|---|
| AC-4 | Give shows the pitch | `/give` shows People to everyone, plus a Request access card for someone without access (their request state: ask, sent, busy, error). The card says ideas, reminders and buying come with the concierge |
| AC-5 | People and settings show the pitch | Without access, only `people/[id]/ideas` and the settings pages reminders, over-budget and paying show the pitch, and none of their own content. Every other people page works |
| AC-8 | The card about their people is hidden | Claiming and the card work for every signed-in account, as today |
| AC-9 | With access, as today | Unchanged, and the back link and title on the ungated pages show straight away again |
| AC-13 | A failed check | On `/give`, People still shows, and the card says "We couldn't check your access. Refresh to try again." On a gated page, the retry line |
| AC-14 | Why access can't be turned off mid-purchase | Unchanged |
| AC-19 | new | These lines change for everyone, because they promise something only the concierge does: no people yet ("Add the people you buy for, and keep their lists in one place."); the birthday hint on the add and About forms ("The year is just for age-right ideas.", no "We'll suggest gifts before it"); "We won't suggest gifts for it" ("It won't be used for gift ideas."); "We suggest ideas" and "so we suggest ideas" ("No list linked"). Without access, a person's page also hides the readiness banner, the Gift ideas row the "Order by" and "Too late to ship" lines, and "we'll learn from it" (the capture hint). "Their gift ideas will come from their own list" becomes "Their own list is linked". Other lines stay: they describe what facts are for, or what happens when a gift ships |
| AC-20 | new | An account without paid features has a person with an occasion inside its lead time, and so does a paid one. After a real tick, the paid one has a round; the unpaid one has no round, idea run, cost event or notification |
| AC-21 | new | Storage refuses a file over the bucket's ceiling or of the wrong type, and an account's files past the cap, for `person-photos` and `captures`, proved by real uploads. Accounts with access have no cap. Today's uploads, imports included, still work |
| AC-22 | new | A signed-out person can reach us to ask for erasing (PR 3), and the steps that do it have been tried |

AC-3 stays: without access you land on My list, and Give is one tap away. AC-6, 7, 10, 11, 12, 15, 16, 17 and 18 stay.

**Storage, found while writing this:** `person-photos` and `captures` have no size or type limit in production, and any account can upload straight to them. This matters under A too. A migration in PR 2 sets, like `list-photos`: photos 1 MB, JPEG, PNG or WebP (the app stores a 512 px copy; import compares against a new stored-size setting, not the 10 MB picker one); captures 3 MB, the types `IMAGE_EXTENSIONS` allows. pgTAP checks each ceiling is above its setting. A new setting, `storage_files_per_account`, caps files per account in each bucket at 100 for accounts without access, checked on upload. **[Claude's call]** no cap with access: captures are never pruned, so a lifetime cap would one day stop an approved person saving.

**Accepted:** strangers can store other people's names, birthdays, photos and addresses, private to their account, with no cap on people. T61's shared city and state can be seen by any account holding a list's link, as its switch already says. The owner accepted both.

**Erasing what we hold (AC-22, PR 3):** the privacy page points to `/feedback`, which has no page today, so nobody can use it. PR 3 adds a public way to reach us (the existing feedback form on its own page), and `operations.md` gets steps to erase an account or a person, photos included, tried once on dev. The page promises nothing those steps don't do.

**Approving someone later:** turning on `paid_features` can start rounds for everyone they've added. The runbook says to count their people and near occasions first.

**Left out, as before:** the extension needs no change: people added there now show on the site, which closes the gap above. Server actions and database rules aren't gated (approach 1).

**Work:** Task 2's gate stays in the code but wraps four pages, not fourteen. On the ideas page the back link stays outside it. Task 3 stays, with People outside the gate. Task 4 loses its shared-list part. A new **Task 4b** does this section, with its own review, before Task 5. Task 6 keeps "Add … to your people" for signed-out visitors, leading to sign-up and back to that list. Task 5 adds the storage migration and keeps the second backfill, which now only decides who sees the request card.

## Spec: what it does

### Why

The owner's family is asking for Christmas ideas now. Building and sharing a list charges them nothing (our own cost is Amazon lookups, at most $2 a day), so there is no reason to keep it invite only. Success: a relative with no help from us signs up, makes a list and texts the link, well before Christmas.

**Would make it a failure even if it works:** a stranger can spend more of our money than the Amazon lookup cap; someone who already uses the concierge loses it; a relative signs up and never gets the confirmation email.

### Who it's for and what they can do

1. **Start a list:** as a relative, I can sign up with Google or email and land on My list, so I can share it for Christmas.
2. **Keep my people's lists:** as a signed-in list user, I can add people and their lists on Give, free, and ask for the concierge in one tap.
3. **Let someone in:** as the owner, I get an email for each request and can give that account access.
4. **Nothing changes for those already in:** as someone with access, Give is as it is today.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed out | they open the home page | the list half's main button is "Start your list, free", which goes to sign-up; the bar says "Sign in", not "Invite only"; the concierge half offers "Request concierge access" |
| AC-2 | signed out | they open sign-in, sign-up, the list tour's end, or a shared list | nothing says invite only for lists, and the way in is sign-up. From a shared list, sign-in and sign-up both bring them back to that list |
| AC-3 | a new account, no access | they sign in with no other page asked for, or open `/` | they land on My list. With email, tapping the confirmation link on a phone leaves them signed in on My list; a password reset also ends signed in |
| AC-4 | signed in | they tap Give | the tab always opens `/give`, whoever they are, so My list never reads the concierge. Without access it shows the pitch, "Request access" and the tour link |
| AC-5 | signed in, no access | they open `/people` pages or the concierge settings pages by address | they see the pitch, and none of those pages' content |
| AC-6 | signed in, no access | they tap Request access | the date is claimed, the owner is emailed their name and account email (line breaks stripped), and they're emailed "we got it"; the page says "Request sent". A second tap or reload sends nothing. If the owner's email fails, the claim is cleared and they can try again. If the process dies between claim and send, it shows as sent and the owner sees the date in the database (accepted) |
| AC-7 | signed in, no access | they open Settings | Name, time zone and My address show; Reminders, Gift ideas and Paying for gifts don't |
| AC-8 | signed in, no access | they open someone's shared list | claiming works as today; the card about their people (add, pick, linked) isn't shown |
| AC-9 | an account with access | they use the app | `/give` shows People, and `/` takes them there; person pages, rounds, settings and the shared-list card work as today (existing browser journeys pass) |
| AC-10 | any account that exists when this ships, including one with no `concierge.accounts` row | the migration runs | it has access. A row is inserted where there was none. New accounts don't have it |
| AC-11 | an account | it calls the database as itself | it can read its own access flag and request date, and can't change either, or see anyone else's |
| AC-12 | access is on, `paid_features` off | they use anything that costs money | still refused, except Amazon lookups (planning 57), which any signed-in account may make: 10 a person and 200 in all a day |
| AC-13 | the access check itself fails | the page loads | an error with a way to retry, never the concierge and never a false "request access" |
| AC-14 | an account with paid features, an open round or a saved Zinc key | the owner runs the statement that turns access off | it refuses, so nobody loses the pages they need to finish a purchase. Turning access off clears the request date, so they can ask again |
| AC-15 | `google_import_enabled` is 0, as shipped | anyone opens Import or Give | import isn't offered, and Import says to add people by hand. At 1 it works as today |
| AC-16 | signed in, no access | they call the test-email action directly | it refuses and sends nothing |
| AC-17 | any link that says Give or "your people" (settings, extension connect, rounds, reactions, emails) | someone follows it | it goes to `/give`. The logo and the home-screen app open `/` |
| AC-18 | `concierge_requests_per_day` requests were made in the last 24 hours (10; 0 = off) | someone taps Request access | nothing is saved or sent, and the page says to try again tomorrow, never "Request sent" |

### Getting it live, in order

Nothing on the public pages opens until steps 1 to 4 are done.

1. **Database change** (first PR): the two fields, the backfill, the settings and lookup caps. Alone, because Vercel deploys alongside the migration, and code arriving first would break Give.
2. **Gate and request flow** (second PR): AC-3 to AC-17.
3. **Sign-up emails reach strangers.** Supabase's built-in sender only delivers to the project's team ([SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [rate limits](https://supabase.com/docs/guides/auth/rate-limits)). Connect Resend if production doesn't use it, require email confirmation, and set the limit to **3 an hour**. We stay on Resend's free plan (owner), which allows 100 emails a day, sent and received together (`spikes/email.md`): 3 an hour is at most 72 a day, leaving 28 for everything else, of which access requests can take 20 (10 a day, two emails each; AC-18). Google sign-up sends no email, and stays the first button. Proof: AC-3 on a phone, at an address outside the team.
4. **Google sign-in for everyone.** Publish the Google app. Proof: a Google account that isn't a test user signs in with no warning, with import off.
5. **Home page, sign-in and tour wording** (third PR): AC-1 and AC-2.

Steps 3 and 4 are admin work, done as allensforever711.

**Accepted risk (no paid Resend plan yet, owner, 2026-11-25):** a busy day can still use up the 100, and purchase emails would fail along with sign-ups. A burst of family email sign-ups can hit the 3 an hour and be told to try later. Watch Resend's daily count after opening.

### Google Contacts import: approval, alongside

Import ships off, and the approval starts now so it can come back (owner). Nothing above waits on it. Google asks for ([requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)):

| Needed | State |
|---|---|
| App published | Step 4; Google's "Prepare for verification" comes after it |
| Verified domain, home page | `giftsaf.com` is an authorized domain. **[Verify]** it's verified in Search Console as allensforever711 |
| Privacy page covering contacts | Missing: it says nothing about Google Contacts. Add: read in the browser, only ticked contacts saved, access revoked straight away (T45) |
| Why `contacts.readonly`, and nothing narrower | To draft |
| Unlisted YouTube video of the whole import, showing Google's consent screen and our client ID | The owner records it before import is turned off |

Google says review usually takes 3 to 5 business days. **[Verify]** that a pending review shows no warning to people only signing in.

### How we see it working, and turn it off (E9, E7)

- **Working:** a logged event for each access request (user id only), and a live check with the QA account with access off, then on.
- **Off:** Supabase's "allow new sign-ups" stops new accounts; `amazon_paste_lookup_enabled` = 0 stops lookups; `google_import_enabled` hides import; `concierge_requests_per_day` = 0 stops requests. None needs a deploy.
- **After a Vercel rollback:** every account sees Give again, as today. They still can't spend beyond the lookup cap. Turn off new sign-ups first.

### Out of scope

- **The Chrome extension.** It needs no change: people added there show on the site.
- An in-app approval screen, or an automatic "you're in" email.
- Enforcing access in the database rules (approach 2).
- Multiple lists, finding people on GiftsAF, and anything else in the freeze's parked list.

## Approaches considered

| Approach | Trade-off | |
|---|---|---|
| **1. Check access on the pages** | Smallest. Someone technical could save people to their own account through the API, but can't spend | **Owner picked, 2026-11-25** |
| 2. Also in the database rules | Airtight, but changes the privacy rules a month before Christmas | Rejected |
| 3. Reuse `paid_features` | Approving someone would let them spend our money, against decision 53 | Rejected |

For what Give shows: the owner first picked **A, the pitch with Request access**, over free People (B) and no Give tab (C), then switched to **B** the same day.

## What was decided, and why

| Question | Answer | Who |
|---|---|---|
| What does Give show without access? | People, and a Request access card (B; first A, the pitch) | Owner |
| Where is access checked? | On the pages | Owner |
| Where do people land? | No access: My list. Access: People. The Give tab is `/give` for everyone | Claude's call, shown to the owner |
| Existing accounts? | Keep access | Claude's call, shown to the owner |
| Is access separate from spending? | Yes, `paid_features` stays its own switch | Claude's call, shown to the owner |
| What's stored? | Two fields on `concierge.accounts`: has access, and when they asked. Server-only writes | Claude's call, shown to the owner |
| Are `/rounds` pages gated? | **No. Changed from what the owner was first shown**: only someone with access can have a round, and hiding one could hide a purchase | **[Claude's call]** |
| Amazon lookups | 10 a person, 200 in all a day | Owner |
| Paid Resend plan | No, stay on free; sign-up mail capped at 3 an hour (the number is Claude's call) | Owner |
| Google import | Off for everyone for now, and start Google's approval | Owner |
| "We got it" email | Yes | Owner |
| Cap on access requests | 10 a day across everyone | **[Claude's call]** |
| Mail scanners can open, and so use up, a confirmation link | Accepted for now; Google is the first button | **[Claude's call]** |
| Extension asks for access? | No need under B | Owner |
| How is someone let in? | The owner runs one SQL statement (`operations.md`, beside paid features) and replies to the request email, which goes to the person | **[Claude's call]** |
| Signed-out concierge requests? | The waitlist form stays, reworded "Request concierge access"; it emails the owner as today, and stores nothing | **[Claude's call]** |
| What happens to `/request-access`? | It becomes the concierge request page, so old links still work; the "access" kind goes away | **[Claude's call]** |

### Open questions

Facts to check during the admin steps. The first doesn't change the code.

- **[Verify]** Production's Supabase email sender and confirmation setting (step 3).
- **[Verify]** Plain sign-in shows no warning while `contacts.readonly` is unapproved (step 4). If it does, take the scope off the consent screen until approval.

## Principles check

- **Simplest version?** Cut: approval screen, automatic email, database enforcement, extension change.
- **Hard-coded values?** New settings `google_import_enabled` and `concierge_requests_per_day`; changed `amazon_paste_lookups_per_user_per_day` and `amazon_paste_lookups_per_day_total`. The sign-up email limit is a Supabase setting.
- **Product boundaries?** The check lives in the concierge module and is read through its `index.ts`. My list doesn't depend on it.
- **New personal data?** The request date, needed to show "Request sent" and send one email only. The owner's email carries the person's name and address (as today's form does); logged events carry the user id only.
- **Docs and decisions:** new T# revising T34 and T58 (number taken at merge); a planning decision for open lists; `technical-design.md` (accounts, navigation), `operations.md` (letting someone in, sign-up emails, Google), `strategy.md`, `README.md`, the privacy page, and the freeze exception in `CLAUDE.md`. The roadmap and screens pages, and the database map.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Architecture:** a per-account access flag on `concierge.accounts`, read by one server component, `ConciergeGate`, that wraps the content of each Give page. Give moves from `/` to `/give`; `/` only sends you to the right home. Public pages change last.

**Tech stack:** Supabase migration and pgTAP, Next.js 16 server components (`cacheComponents`), Resend, Vitest, Playwright.

**Spec:** the sections above.

### Global constraints

- Three PRs, in order, each `Part of ALL-179` until the last: **PR 1** Task 1; **PR 2** Tasks 2 to 5; **PR 3** Tasks 6 and 7. PR 3 merges only after steps 3 and 4 of "Getting it live" are proved.
- Branch from fresh `origin/main` in its own worktree. `<github-login>/all-179-<short-name>`.
- No ticket ids in code comments (T86). Events carry ids only (E6). Values live in settings (T23).
- A `catch` around request data starts with `unstable_rethrow(error)` (ALL-87).
- **Gate in pages, never in a layout:** Next renders a page alongside its layout, and layouts don't rerun when moving between pages.
- Before each PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `pnpm db:test` and `pnpm e2e` for PRs 1 and 2.
- Work on one local database at a time (`db:clean` lock). Apply to dev with `pnpm db:push:dev`; production migrates through CI's `migrate` job.

### Task 1: Database (AC-10, AC-11, AC-14; caps for AC-12, AC-15)

**Files:**
- Create: `supabase/migrations/<next timestamp after the newest on main>_concierge_access.sql`, `supabase/tests/concierge_access.test.sql`
- Modify: `supabase/tests/app_settings.test.sql` (its list of every setting gains the two new keys), `supabase/tests/amazon_paste_lookups.test.sql` (30 → 10, 2000 → 200 in the two setting checks; line 85's own override stays), `packages/core/src/database.types.ts` (`pnpm db:types`), `design/database-map.html` (`pnpm db:map`)

**Produces:**
- `concierge.accounts.concierge_access boolean not null default false`, `concierge.accounts.access_requested_at timestamptz`; `grant select (concierge_access, access_requested_at)` to `authenticated`, because `20261109100000_zinc_wallet.sql` made select per column; no insert or update grant.
- `concierge.has_concierge_access(p_user_id uuid) returns boolean`: same shape, `stable`, `search_path` and grants as `has_paid_features`.
- `concierge.claim_access_request(p_user_id uuid) returns text`: service_role only. `'already'` if a date is set or access is on; `'busy'` if `concierge_requests_per_day` dates fall in the last 24 hours; otherwise inserts the row or sets the date to now, and returns `'claimed'`. One transaction-level advisory lock makes the count safe. A missing setting raises.
- `concierge.release_access_request(p_user_id uuid) returns void`: service_role only. Sets `access_requested_at` to null where access is still false.
- `concierge.turn_off_concierge_access(p_user_id uuid) returns void`: service_role only. Raises `P0001` if `paid_features`, or `zinc_api_key_secret_id is not null`, or the user has a `concierge.gift_rounds` row whose status isn't `complete` or `skipped`; otherwise sets access false and the date null. It locks the account row first.
- Backfill: `insert into concierge.accounts (user_id, concierge_access) select id, true from auth.users on conflict (user_id) do update set concierge_access = true`. A new row takes today's default over-budget %.
- Settings: `google_import_enabled` = `'0'`; `concierge_requests_per_day` = `'10'`; update the two Amazon lookup settings to `'10'` and `'200'`.

- [ ] **Step 1: Write `concierge_access.test.sql`**, following `paid_features.test.sql`, with these checks:
  - no row means no access; a new row defaults to none; a user reads their own flag and date; another user's reads as none; anon gets `42501`
  - a user setting either field, by insert or update, gets `42501`; a user calling claim, release or turn-off gets `42501`
  - claim returns `claimed` then `already`; with access on, `already`; release then claim returns `claimed`; at the cap, and at 0, another user gets `busy` and no date
  - turn-off raises with paid features, with a saved Zinc key, and with an `awaiting_approval` round; with none of those it clears both fields
  - the backfill statement, run again in the test, gives access to a user with no row and to one with a row, leaving that row's `over_budget_pct` alone
  - the four settings' values
- [ ] **Step 2:** `pnpm db:test` → the new file fails (column doesn't exist).
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `pnpm supabase migration up --local`, then `pnpm db:test` → all pass. `pnpm db:types`, `pnpm db:map`.
- [ ] **Step 5:** Commit `feat(db): concierge access per account, and lower Amazon lookup caps (ALL-179)`. Open PR 1. After merge: CI's `migrate` job passes; publish the database map; confirm on production that every existing account has access.

### Task 2: The gate (AC-5, AC-13)

**Files:**
- Create: `apps/web/modules/concierge/access.ts`, `apps/web/components/concierge-gate.tsx`, `apps/web/components/__tests__/concierge-gate.test.tsx`, `apps/web/components/home/concierge-pitch.tsx`
- Modify: `apps/web/modules/concierge/index.ts` (export the two functions); every `page.tsx` under `app/people/` (11 pages: `new`, `import`, and `[id]` with its 8 screens), `app/settings/reminders|over-budget|paying/page.tsx`; `apps/web/e2e/fresh-user.ts`, `apps/web/e2e/global-setup.ts`

**Produces:**
- `hasConciergeAccess(db: SupabaseClient<Database>, userId: string): Promise<boolean>` (throws on a failed check)
- `getAccessState(db, userId): Promise<{ access: boolean; requested: boolean }>` (one read of the user's own row; no row means both false; throws on error)
- `<ConciergeGate>{children}</ConciergeGate>`: async server component. Access: children. No access: `<ConciergePitch requested={requested} />`. Failed check: logs `concierge_access.check_failed` with `user_id` and shows "We couldn't load this. Refresh to try again." Signed out: `redirect("/auth/login")`.
- `<ConciergePitch requested>`: mock-up A's two states. Copy: heading "Gifting, handled AF." / "You asked for access"; button "Request access"; sent text "We're letting people in a few at a time. We'll email you when you're in."; links "Take the tour" (`/tour`), "Go to my list" (`/lists`). The button's action is passed in by Task 3; until then the pitch renders without it.
- `createFreshUser(displayName?: string, opts?: { access?: boolean })`: access on by default, off with `{ access: false }`. Global setup gives both shared users access, and works when they already exist (the create call then returns 422 with no id): take the id from a password session, then upsert `concierge.accounts` with the service role.

- [ ] **Step 1: Write failing component tests:** access renders children; none renders the pitch and not the children; `requested: true` renders "Request sent" and no button; a thrown check renders the retry text, with neither children nor "Request access".
- [ ] **Step 2:** `pnpm --filter @gifts-af/web test concierge-gate` → fails.
- [ ] **Step 3:** Implement, then apply one rule to each listed page: `<PageFrame><Suspense><ConciergeGate>…everything, title and back link included…</ConciergeGate></Suspense></PageFrame>`, with the top bar outside. `people/[id]/list/page.tsx` has no outer frame: give its no-access case the top bar and frame. `/rounds` and `/a/` pages aren't wrapped.
- [ ] **Step 4:** Add `e2e/open-signup.spec.ts` with a journey: a fresh user without access opens every listed route (people routes with a made-up id) and sees "Gifting, handled AF." and none of that page's own title. Run → pass. (`/give` joins the list in Task 3.)
- [ ] **Step 5:** Commit `feat: people and concierge settings need concierge access (ALL-179)`.

### Task 3: `/give`, home and links (AC-3, AC-4, AC-9, AC-17)

**Files:**
- Create: `apps/web/app/give/page.tsx` (today's `app/page.tsx`, under Task 2's rule)
- Modify: `apps/web/e2e/open-signup.spec.ts`; `apps/web/app/page.tsx` (the check runs inside `Suspense`); `components/app-shell/product-tabs.tsx` (Give → `/give`); links to `/give` in `app/settings/page.tsx`, `app/extension/connect/page.tsx`, `app/rounds/access.tsx`, `app/rounds/[id]/reaction/reaction-form.tsx`, `app/people/[id]/page.tsx`, `app/people/import/import-checklist.tsx`, `app/people/new/page.tsx` (`doneHref`), `app/people/actions.ts` (`redirect("/")` after a delete), `modules/concierge/inbound/handle.ts` (`/people` → `/give`; `/people` has no page today). Every `revalidatePath("/")` becomes `/give`. Tests: `app/people/__tests__/actions.test.ts`, and a check in the inbound tests that the "someone else" link is `/give` (nothing checks it today).
- Unchanged, on purpose: the logo, `manifest.ts`, `/a/` "Go to GiftsAF", "What is GiftsAF?", `safeNext`, `update-password-form.tsx`; all go to `/`, which sends people to the right home.

**Produces:** `app/page.tsx` signed in: access → `redirect("/give")`, none → `redirect("/lists")`, failed check → the gate's retry text. Signed out it stays `/welcome` (the proxy).

- [ ] **Step 1: Write failing journeys** in `open-signup.spec.ts`:
  - no access: `/` lands on `/lists`; Give shows "Gifting, handled AF." and no "People" heading; `/people/new` and `/settings/paying` show the pitch; browser Back from `/lists` doesn't bounce
  - access: `/` lands on `/give` with the People heading
  - signed out: `/give` goes to sign-in with `next=/give`
- [ ] **Step 2:** `pnpm e2e open-signup` → fails.
- [ ] **Step 3:** Implement. Update existing specs and component tests only where they assert Give's address; don't loosen any other assertion.
- [ ] **Step 4:** `pnpm e2e` → pass on all projects.
- [ ] **Step 5:** Commit `feat: Give lives at /give, and / sends you home (ALL-179)`.

### Task 4: Asking for access, and what's hidden (AC-6, AC-7, AC-8, AC-16)

**Files:**
- Create: `apps/web/app/give/actions.ts`, `apps/web/app/give/request-access-button.tsx`, `apps/web/test/concierge-request.test.ts`
- Modify: `apps/web/modules/concierge/access.ts`, `lib/form-email-samples.ts`, `app/settings/page.tsx`, `app/settings/actions.ts`, `app/share/[token]/page.tsx`, `components/home/concierge-pitch.tsx`

**Produces:**
- `requestConciergeAccess(user: { id: string; email: string; name: string | null }, deps: { claim(id: string): Promise<"claimed" | "already" | "busy">; release(id: string): Promise<void>; sendOwner(u): Promise<SendResult>; sendPerson(u): Promise<SendResult>; log: typeof logEvent }): Promise<{ status: "sent" | "busy" | "error" }>`
- Emails through `renderEmail`: owner to `inboxFor("access")`, reply-to the person, subject `GiftsAF concierge request: <name or email, one line>`, body pointing to `operations.md` for the statement; person's copy heading "Got it.", text "Thanks, we got your request. We'll email you when you're in.", nothing they typed.
- `requestAccessAction(): Promise<{ status: "sent" | "busy" | "error" }>`: sends through `defaultChannels(process.env)[0]`, which honours `EMAIL_OUTBOX=log`, so local runs never email anyone. Busy text: "We've had a lot of requests today. Please try again tomorrow." Takes no input; id from claims, name and email from `profiles`.

- [ ] **Step 1: Write failing unit tests** for `requestConciergeAccess`: first call claims, sends owner then person, returns sent; `already` sends nothing and returns sent; `busy` sends nothing and returns busy; owner failure releases, sends no copy, returns error; person-copy failure still returns sent and logs `concierge_access.confirmation_failed`; a name with `\r\n` gives a one-line subject; logged events contain only `user_id`.
- [ ] **Step 2:** Run → fails. **Step 3:** Implement. Run → pass.
- [ ] **Step 4: Write failing journeys** in `open-signup.spec.ts`: no access, tap Request access → "Request sent", still there after reload, and the date is in the database (the unit tests count emails); at `concierge_requests_per_day` = 0 in a unit test only, so parallel specs aren't affected; Settings shows Name and time zone but not Reminders, Gift ideas or Paying for gifts; someone else's shared list has Claim and no "to your people". And a test that `sendTestEmail` for a user without access returns an error and sends nothing.
- [ ] **Step 5:** Implement: Settings shows the three groups only with access, and loads their data only then; the share `Card` returns null for a signed-in viewer without access, and also if the check fails (logged, after `unstable_rethrow`), so a claim never breaks; `sendTestEmail` checks `hasConciergeAccess` first, inside its `try`. Run → pass.
- [ ] **Step 6:** Commit `feat: request concierge access in one tap (ALL-179)`.

### Task 4b: People are free (AC-4, AC-5, AC-9, AC-13, AC-19, AC-20)

**Files:**
- Modify: `app/give/page.tsx` and the ten `app/people` pages other than `[id]/ideas` (gate off, so each is as on main at ab574de, keeping Task 3's `/give` addresses); `app/people/[id]/ideas/page.tsx` (no access: the pitch with a "Back" link to `/people/<id>` that reads nothing, and no name; a person who isn't theirs shows the same); `components/concierge-gate.tsx` (drop `frame` and its tests; keep `AccessCheckFailed`, which `/` uses); `components/home/concierge-pitch.tsx`; `components/home/people-section.tsx`, `person-card.tsx`; `app/people/person-form.tsx`, `[id]/about/about-form.tsx`, `[id]/person-view.tsx`, `[id]/readiness.tsx` (or where it's rendered), `[id]/occasions.tsx`; `e2e/open-signup.spec.ts` and the tests of those components
- Create: `components/home/request-access-card.tsx` and its test; `modules/concierge/__tests__/free-account-db.test.ts`
- Unchanged: `app/share/`, the three settings pages, `/rounds`, `/a/`

**Produces:** `<RequestAccessCard>`: async server component on `/give`, in its own Suspense with `fallback={null}`, after People. With access it renders nothing. Without: heading "Want gifts found and shipped for you?", text "Gift ideas, reminders and buying come with the concierge. Request access and we'll email you when you're in.", and Task 4's button; requested: "You asked for access. We'll email you when you're in."; failed check: "We couldn't check your access. Refresh to try again." It uses `readAccess`.

- [ ] **Step 1: Failing component tests** for the card's four states, each AC-19 line, and a person page with and without access (readiness banner, Gift ideas row, "Order by" and "Too late to ship" lines).
- [ ] **Step 2: Failing journeys**, replacing Task 2's: no access can add a person from `/people/new`, see them on `/give`, open the ten people pages, and add someone from a shared list; `[id]/ideas` and the three settings pages show the pitch, and ideas has its Back link; the request button on `/give` ends at "You asked for access".
- [ ] **Step 3: Failing local-db test (AC-20):** `free-account-db.test.ts`, added to `LOCAL_DB_TESTS`. Two accounts, each with a person, an address and an occasion inside its lead time. Run the real tick with the real candidates query, filtered to these two users, and the other global reads scoped to them too (the shared `onlyOurs` drops candidates, so it can't be used as is); `round_engine_enabled` 1 and fan-out 0, put back after. In one tick: the paid account has a `gift_rounds` row; the unpaid one has none, and no `idea_runs`, `cost_events` or `notifications`. Then set `paid_features` on the unpaid account and tick again: it gets one.
- [ ] **Step 4:** Implement. The person page reads access once and passes a boolean down; if that check fails it hides the same things and shows the rest (`readAccess` already logs it).
- [ ] **Step 5:** From Task 4's review: one client component, kept mounted across ask and sent in both the card and the pitch, announces the sent state (`role="status"`) and moves focus to it; action tests for `already`, `busy` and release throwing; the test-email refusal matches "part of the concierge" in the unit test and the journey.
- [ ] **Step 6:** Full checks and `pnpm e2e`. Commit `feat: people are free, the concierge is by request (ALL-179)`.

### Task 5: Import off, and the runbook (AC-15, AC-14, AC-21)

**Files:** Modify `app/people/import/import-section.tsx`, `components/home/people-section.tsx`, `e2e/contacts-import.spec.ts`, `e2e/global-setup.ts` (`google_import_enabled: 1` in `RUN_SETTINGS`), `design/operations.md`, `design/technical-design.md`.

- [ ] **Step 1:** Failing component tests: at 0, Give has no "Import from Google" and Import says "Google import is off for now. Add people by hand." with a link to `/people/new`, and never loads Google's script; at 1 both are as today; if the setting can't be read, it counts as off; `importContactsAction` refuses at 0. `e2e-live/all-104-connect-button.spec.ts` opens Import on production: expect the off text.
- [ ] **Step 2:** Implement with `appSettingInt("google_import_enabled")`; its catch starts with `unstable_rethrow`. Tests that mention import: `prerender-rethrow`, `people-section`, `import-action`, `gallery.shots.ts`, `top-bar.spec.ts`. Run → pass.
- [ ] **Step 3:** `operations.md`: letting someone in (the `insert … on conflict` statement setting `concierge_access`, then reply to their email), changing the paid-features statement to set `concierge_access` too, since paid without access would start rounds whose address links show the pitch, turning it off (`select concierge.turn_off_concierge_access(id)`), the off switches, and after-rollback steps.
- [ ] **Step 4a: Storage limits (AC-21).** Files: one migration; `supabase/tests/storage_limits.test.sql`; `apps/web/modules/concierge/__tests__/storage-limits-db.test.ts`, added to `LOCAL_DB_TESTS`; `supabase/tests/app_settings.test.sql`; `modules/concierge/people/store.ts`; `packages/core/src/database.types.ts`; `package.json` (`db:start:tests` stops excluding `storage-api`, and `test/local-db.ts` waits for it).
  - Failing first. pgTAP: both buckets' ceilings and types; each ceiling above its setting; the cap setting; the function's grants. Vitest, real uploads as a signed-in user: over the ceiling refused, wrong type refused, ordinary upload works, at the cap (setting lowered in the test and put back) refused, and at the cap with access allowed.
  - Migration: `update storage.buckets` (photos 1048576; JPEG, PNG, WebP; captures 3145728; JPEG, PNG, WebP, GIF); settings `person_photo_stored_max_bytes` (1000000) and `storage_files_per_account` (100); and `concierge.may_store_file(p_bucket text) returns boolean`, `security definer`, `set search_path = ''`, granted to `authenticated` only, true when `auth.uid()` has concierge access or fewer than the cap of objects in its own folder of that bucket. Both insert policies add `and (select concierge.may_store_file(bucket_id))`. A policy can't count `storage.objects` itself (it would recurse). Import compares against `person_photo_stored_max_bytes`.
  - It's a soft cap on uploads people make themselves: parallel uploads can overshoot, and emailed notes (server uploads, paid only) aren't counted. At the cap, replacing a photo is refused too, with the app's existing error.
  - `db:types`, `db:map`.
- [ ] **Step 4b: Backfill again.** A data-only migration repeats Task 1's backfill, for accounts created since PR 1 only (a date in the migration), so nobody turned off since gets access back. It changes no tables, so no `db:map`. List the accounts it adds.
- [ ] **Step 5:** `pnpm gallery`; commit `feat: Google import behind a setting (ALL-179)`; adversarial review; open PR 2. Before merging, the owner has recorded the import video. After: live check with the QA account: check it has no paid features, Zinc key or open round, turn access off, check, then turn it on again; republish the screens page.

### Between PR 2 and PR 3: admin steps (owner, as allensforever711)

- [ ] **Sign-up email:** Supabase production > Auth: sender (Resend SMTP), confirmation required, 3 emails an hour. The confirm and reset templates use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<email or recovery>&next={{ .RedirectTo }}`, which works in any browser; the default link needs the one that signed up. Proof: AC-3 on a phone outside the team, and a password reset.
- [ ] **Existing accounts (before opening):** list them, so a stray one is seen.
- [ ] **Google:** publish the app. Proof: a Google account that isn't a test user signs in, with no warning.
- [ ] **Limits:** Supabase sign-up rate limits are on.

### Task 6: Public pages (AC-1, AC-2)

**Files:** `components/home/{list-hook,hook,home-top-bar,request-access-dialog}.tsx`, `components/tour/{tour,list-tour,end-screen}.tsx`, `app/request-access/{page,request-access-form}.tsx`, `lib/access-request.ts`, `lib/form-email-samples.ts`, `app/auth/login/page.tsx`, `components/sign-up-form.tsx`, `app/share/[token]/list-card.tsx`, `app/auth/sign-up-success/page.tsx` (drop "Open it on this device"), `README.md`. Tests that change: `e2e/{home,smoke,add-from-list-link,emails}.spec.ts`, `e2e-live/all-123-share-signed-out.spec.ts`, `test/{login-page,access-request,request-access-page,human-check,early-tap,auth-forms}`, and the home and tour component tests.

**Copy:** list button "Start your list, free" → `/auth/sign-up`; bar "Sign in" → `/auth/login`; concierge button "Request concierge access"; "Have an invite? Sign in" → "Already have an account? Sign in"; list tour end "Your list is free. Start it now."; concierge tour end "We're letting people into the concierge a few at a time." The form's only kind is the concierge request; its thank-you links to sign-up for a list. The form keeps emailing `inboxFor("waitlist")`; signed-in requests use `access`. Shared list, signed out: "Add … to your people" stays and leads to sign-up, "Request access" goes, and "Sign in" stays, both with `next=/share/<token>`.

- [ ] **Step 1:** Update the component tests to that copy and those links, plus: no signed-out page contains "invite only" (home, login, sign-up, both tours' ends, shared list); sign-up from a share passes `next` through Google and email; a route test for `/auth/confirm` with a full-URL `next` of `/`, `/share/<token>` and `/auth/update-password`, for types `email` and `recovery`, redirecting to each, and to `/` for another site. Run → fail (the route test may already pass).
- [ ] **Step 2:** Implement; remove `RequestKind`. Run → pass.
- [ ] **Step 3:** `pnpm e2e`; commit `feat: anyone can start a list (ALL-179)`.

### Task 7: Privacy page, decisions, docs

- [ ] **Erasing (AC-22):** a public `/feedback` page: move `FeedbackForm` out of `feedback-dialog.tsx`, with the closing words and `onSent` staying in the dialog; add the path to `isPublicPath`, with a test; and `operations.md` steps to erase an account or a person, with photos, captures and list photos removed through the Storage API, tried once on dev.
- [ ] Privacy page, which now also covers what people store about others and promises only what those steps do: a "Google sign-in and contacts" section (sign-in gives name and email; import reads contacts in the browser, only ticked ones are saved, Google access is revoked straight away, never used for ads), and the account data list sign-up keeps. Update its date.
- [ ] Draft Google's scope reason in `operations.md`: import needs names, birthdays, addresses and photos of chosen contacts; no narrower read scope gives them; read in the browser only.
- [ ] `design/decisions.md` next T# and `planning/decisions.md` next number, marking each revised decision named in **Links**; `strategy.md`; roadmap page; `design/ui.md`; ALL-78 gets the extension listing's "invite only" line.
- [ ] Adversarial review; PR 3 `Closes ALL-179` only if every box is ticked. Live check: a relative-style sign-up on a phone, list made and link texted. Evidence on the ticket.

### Review Focus

- **Someone opens an old `/` link, home-screen icon or sign-in with no destination:** ends on the right home, no loop. Task 3 journeys.
- **Access check fails during a claim on a shared list:** the claim still works, the card is hidden. Task 4, step 5; test in `share` page tests.
- **A signed-out relative taps a share link, signs up by email in an in-app browser, and confirms in another:** lands signed in on that list. Task 6 tests `next`; the template is proved in the admin steps.
- **Double tap on Request access:** one owner email. Task 1 claim test and Task 4 unit test.
- **A guest builds a list at `/lists`, then signs up:** kept in the same browser, as today; confirming in a different browser loses it (accepted). Add a journey to Task 6: guest list, sign up, item still there.

### Consistency check

Every AC has a task: AC-1, 2 → 6; 3, 4, 9, 17 → 3 (AC-3's email half → admin steps); 5, 13 → 2; 6, 7, 8, 16, 18 → 4 (18's cap → 1); 10, 11, 14 → 1; 12 → 1 and existing paid-features tests; 15, 21 → 5; 19, 20 → 4b, which also revises 4, 5, 8, 9 and 13; 22 → 7.
