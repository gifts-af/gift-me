# ALL-23 Notification service: email, signed action links, channels: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the app can reach a user by email, through one `notify()` call that any later ticket uses. Every email button is a signed one-time link that does its job in one tap once the person is signed in, and never on a plain page load.

**Links:** [ALL-23](https://linear.app/allens-forever/issue/ALL-23) · PRD N-1 (email with one-tap links), N-3 (push, later) · design §6.4 (notifications and one-tap actions), §6.8 (capture address as Reply-To), §8 (security) · email provider: T33, [`spikes/email.md`](../spikes/email.md) · server writes the rest: T26 · no hard-coded values: T23 · email look: [`design/ui.md`](../ui.md) > UI kit, mock-up [`#email`](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#email) (signed off 2026-10-28) · two heads-up templates: planning decision 40 · follow-up for people without an account: [ALL-49](https://linear.app/allens-forever/issue/ALL-49).

## Spec: what it does

### Why

Gift rounds run on their own (design §5). The app has to tell people when something needs them (a heads-up, reminders, a problem) and let them answer from their phone in as few taps as possible. Email is the MVP channel; Web Push may come later (ALL-40, T12), so callers must not care which channel delivers.

**The person opening a link may be on their first visit in that browser** (owner, 2026-11-01), often the mail app's own browser on a phone. That visit should be: sign in with as little friction as possible, do the thing, done. A short "get your own GiftsAF going" teaser for people arriving cold was discussed; it moved to ALL-49, because only people without an account (Edgar) would ever see it.

### Who it's for and what they can do

1. **Act from an email in one tap:** as a signed-in user on my phone, I tap a button in an email, see a confirm page that says exactly what will happen, and one tap does it.
2. **Sign in on the way, with as little friction as possible:** as a user who isn't signed in in that browser (often the mail app's built-in browser), I'm asked to sign in, Google already knows which account to use, and I come straight back to the same confirm page.
3. **Safe links:** as a user, I know a link only works for my account, only once, and only until it expires. An email scanner opening it does nothing, and a forwarded link is useless to anyone else.
4. **Check my email works:** as a user, I can press "Send me a test email" in Settings and get an email with a working test button, so I know mail reaches me and isn't in spam.
5. **One way to notify (for builders):** as a developer on a later ticket (round engine ALL-28, approval ALL-29, failures ALL-33, reactions ALL-34), I call one function with a user, a template and its data, and the service picks the channels, builds the action links, sends, and logs it.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A signed-in user | They press "Send me a test email" in Settings | An email from `GiftsAF <hello@giftsaf.com>` arrives at their account's email, with one teal button that is a signed action link; a `notifications` row records kind `test`, channel `email`, `sent_at` and Resend's message id |
| AC-2 | Resend refuses or is unreachable | A notification is sent | The `notifications` row records the failure (no `sent_at`, an error); the caller gets a failure result and nothing throws; Settings shows "We couldn't send it. Try again in a minute." |
| AC-3 | Any action link | It's opened with a plain GET (an email scanner, a preview, the user) | Nothing changes: the link is not used up and no action runs. Only the confirm button (a POST) acts |
| AC-4 | A signed-in user who owns the link, link unused and unexpired | They open it, then tap the confirm button | The action runs once, the link is marked used, and they land on the result page |
| AC-5 | A used link | It's opened again, or the confirm form is re-posted (double tap, back button) | "This link has already been used", with a link into the app; the action doesn't run a second time |
| AC-6 | A link past its expiry | It's opened or posted | "This link has expired", with a link into the app; nothing runs |
| AC-7 | A visitor who isn't signed in | They open a link | A sign-in page for this link: Google sign-in pre-filled with the link owner's email (Google's `login_hint`), plus the existing email sign-in; after signing in they return to the same confirm page. The page doesn't reveal what the action is until they're signed in as the owner |
| AC-8 | Someone signed in as a different account | They open a link | "This link is for a different account" with a "Sign in as someone else" button; the action's details aren't shown and nothing runs |
| AC-9 | A token that doesn't match any link (typo, made up) | It's opened | A plain "This link doesn't work" page with a link into the app; nothing runs |
| AC-10 | A user | They complete an action | The result page says what was done (in the action's own words) and links back home |
| AC-11 | Each of the six templates (heads-up, reminder, final notice, needs-attention, reaction prompt, needs-address), plus the heads-up's two kinds (decision 40) | It's rendered with sample data | It has a subject, an HTML part (white, at most 600 px, system font, inline styles, one teal button) and a plain-text part with the same links; all of the caller's text is HTML-escaped |
| AC-12 | The samples script is run against the dev Resend key | It sends all templates to one address | The owner checks them in Gmail and iOS Mail on a phone and signs off (manual check, recorded below) |
| AC-13 | A message is sent | The channel list is read | Messages go out through every channel in the list (email only today); a new channel can be added without changing any caller |
| AC-14 | Action links in the database | Anyone looks at the table | Only a SHA-256 hash of each token is stored; the raw token exists only in the email. Signed-in users can't read or write the table directly |

### Out of scope

- **Real actions** (approve, skip, pick another idea, answer a question, react). They're wired in by the tickets that own them: ALL-28 (skip, reminders), ALL-29 (approve), ALL-33 (next-best idea), ALL-34 (reaction). ALL-23 ships the mechanism plus a `test` action.
- **When to send** (escalation timing): the round engine, ALL-28, using the §4.1 schedule.
- **The capture address as Reply-To:** templates accept an optional Reply-To; ALL-31 creates the per-user capture address and supplies it.
- **Emailing people who don't have an account** (Jim emails his friend Edgar): ALL-49.
- **Web Push:** ALL-40, if it goes ahead. **Notification preferences** (`accounts.notification_prefs`): unused until there's more than one channel.
- **Inbound email:** ALL-31.

### Open questions

None left. Settled answers are below.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Does the link alone authorize the action? | **No: the person must be signed in as the link's owner** (owner, 2026-11-01). Already signed in, it's one tap. Not signed in, sign-in should take as little as possible and return to the same page. | Owner's call. A forwarded or leaked link is useless to anyone else. |
| How is sign-in made frictionless? | **[Claude's call]** Links open a public page under `/a/{token}`. Signed out, it shows a short "Sign in to continue" page: the Google button passes the link owner's email as `login_hint` (Google then skips its account chooser when that account is already in the browser), and email sign-in stays for list-only users. Both return to `/a/{token}` through the existing `next` handling (`safeNext`). | Google is the main sign-in (ALL-20). The hint saves a step, and putting the owner's email on this page reveals nothing new: the link was emailed to that address. |
| Where does someone land after acting? | **A plain result page, linking home.** The "get your own GiftsAF going" teaser moved to ALL-49 (owner, 2026-11-01). | Concierge emails are about rounds, and a round needs people, so anyone getting one has already set things up. Only someone without an account (ALL-49) would ever see the teaser. |
| Does this box in later products? | **No: `action_links` is kept generic on purpose** (owner, 2026-11-01: early choices mustn't block the long-term plan). A link is a random token stored hashed, an action name, an expiry and single use; `round_id` is optional and nothing in the table is email-specific. `planning/ideas.md` > "A common thread" says scan-to-gift needs "a scannable code tied to a gift that someone claims securely", and ALL-49 needs links for people without an account (a recipient email next to `user_id`). Both can grow from this table, by adding columns, without a redesign. | Keeps the platform's later products (`planning/strategy.md`) open at no extra cost now. |
| Who can be signing in from a link? | **Only someone who already has an account and has signed in before.** A link belongs to an account, so its owner signed up already: with Google (as an invited test user, T34) or, for older list users, with email and password. No new sign-in method (such as an emailed sign-in code) is added. | Everyone who gets these emails already has a way in. "First visit" here usually means the first time in this browser (often the mail app's own browser). People with no account at all are ALL-49. |
| What does `/a/{token}` show, in what order? | **[Claude's call]** The checks run in this order, and the first one that applies decides the page: (1) no such token: "This link doesn't work"; (2) signed out: sign-in page with the owner's email as Google's hint, for any real token, even a used or expired one; (3) signed in as someone else: "This link is for a different account"; (4) used: "already used"; (5) expired: "expired"; (6) otherwise the confirm page. Details of the action appear only at step 6. | Tokens are 256-bit random, so whether one exists isn't something worth hiding from the person holding it. What must never leak before the owner signs in is the action and its round (AC-7, AC-8). Keeping used and expired behind sign-in keeps the order simple. |
| One token column, or a links table? | **A new table, `concierge.action_links`**, one row per button, replacing `notifications.action_token_hash` (owner agreed, 2026-11-01). | One email has several buttons (choose, skip, answer a question), each with its own action and possibly its own expiry. |
| How does server code write server-only tables? | **[Claude's call]** Use a server-only Supabase secret key: production already has the integration's `GIFT_SUPABASE_SECRET_KEY`, and the dev project's key was added as `SUPABASE_SECRET_KEY` for Development and Preview (2026-11-01). Code reads `SUPABASE_SECRET_KEY ?? GIFT_SUPABASE_SECRET_KEY`, the same pattern as `lib/supabase/env.ts`. One helper, `lib/supabase/admin.ts`, that only server code imports. Every lookup still checks the signed-in user against the link's owner in code. | T26 says server code writes rounds, notifications and the rest, and nothing can do that yet. The round engine (ALL-28) needs the same key, so it's set up once, properly (README > Environments). |
| Email templates: a library or plain code? | **[Claude's call]** Plain TypeScript functions that return `{ subject, html, text }`, sharing one layout function with inline styles. No new dependency. | Six simple, single-button emails. A templating library adds a build step and a dependency for little gain (Principle 1). |
| How are tokens made? | **[Claude's call]** 32 random bytes from the platform's crypto, base64url (43 characters), stored as a SHA-256 hex hash. Looked up by hash; marked used with a single conditional update (`used_at is null and expires_at > now()`), so a double tap can't run it twice. | Enough randomness that guessing is hopeless, and SHA-256 is right for random tokens (no salt or slow hash needed). |
| When does a link expire? | **The caller decides** (`expiresAt`); round links use the round's deadline (design §6.4). The test email's link uses a new setting, `test_action_link_hours` (24). | T23: no timing constants in code. |
| What does the `test` action do? | Nothing beyond proving the path: it marks the link used and the result page says "It works. Buttons in our emails will look like this." | Real actions belong to their own tickets. |
| How do you check the templates on a phone? | **[Claude's call]** `pnpm --filter @gifts-af/web email:samples you@example.com` sends every template with sample data through the pulled dev key. Links in samples point to a sample page and don't act. | One command beats wiring six fake rounds; it uses the dev quota (100 a day). |
| Which channels? | A list in code, `CHANNELS = [emailChannel]`. Each channel is `{ name, send(message, recipient) }`, and `notify()` sends through every one. | The design asks for a list so push is just another entry. It stays in code, not settings: it's what's built, not a tunable (T23 allows it). |
| Whose email address? | `public.profiles.email`, which always mirrors the account's sign-in email. | Already kept in sync, and it's what the user signed in with. |
| Dates and times in emails | Shown in the user's `profiles.timezone`. When that's unknown, dates (no times) are shown as calendar dates with no time zone. | Rounds are day-based (§5.1), so a date is enough. |

## Principles check

- **Simplest version?** What we cut: no templating library, no notification preferences, no real actions, no push, no first-visit teaser (ALL-49), no separate confirm page per action (one generic page, where each action gives its own wording).
- **Hard-coded values?** New setting `test_action_link_hours` (24). Sender address and name come from `lib/brand.ts` and the existing `ACCESS_FROM` pattern (moved to a shared constant). New env var `SUPABASE_SECRET_KEY` (Development and Preview; production uses `GIFT_SUPABASE_SECRET_KEY`). `RESEND_API_KEY` already exists.
- **Product boundaries?** The service lives in `modules/concierge/notify/` and is exported through `modules/concierge/index.ts`. The `/a/[token]` route and Settings button live in `app/` and import only module `index.ts` files.
- **Privacy:** `action_links` is server-only (no grants to `authenticated`), like `notifications` (T26). Our code never stores or logs the raw token; `/a/{token}` URLs do appear in hosting request logs and the sign-in redirect, which is acceptable because a link needs its owner signed in and works once.
- **Docs and decisions** to update: design §3 (`action_links` row; `notifications` loses `action_token_hash`, gains `provider_message_id` and `error`), §6.4 (sign-in required as the link's owner), new decision T36 (check `origin/main`'s latest T number first), README > Environments (`SUPABASE_SECRET_KEY`), `apps/web/.env.example`, `planning/ideas.md` (the Jim to Edgar idea and its teaser, ALL-49).

## Plan

**Architecture:** the notification service lives in `apps/web/modules/concierge/notify/` and talks to the database through a small `NotifyStore` interface, so the logic is unit-tested with an in-memory fake and runs for real through the server-only Supabase client. `notify()` makes the action links, renders the template, and sends through every channel, logging each send. The public page `/a/[token]` reads a link's state in the spec's fixed order, and only a server action (POST) claims and runs it.

**Tech stack:** Supabase migration plus pgTAP test, Next.js 16 App Router (server page and server action), Vitest, Playwright against local Supabase, Resend over `fetch` (as `lib/access-request.ts` does). New dev dependencies: `server-only` (keeps the secret key out of client bundles) and `tsx` (runs the samples script with the `@/` paths).

**Global constraints** (every task):
- Sender `GiftsAF <hello@giftsaf.com>`, built from `APP_NAME` in `lib/brand.ts`; open and click tracking stay off (T33).
- Emails: white background, at most 600 px wide, system font stack, inline styles only, exactly one teal button (`design/ui.md` > UI kit; teal is the `--primary` token's hex in `app/globals.css`).
- Nothing acts on a GET. Our code never stores or logs the raw token (it does appear in hosting request logs and the sign-in redirect; see Privacy above).
- No timing constants in code (T23): link expiry comes from the caller or `app_settings`.
- The concierge module is imported only through `modules/concierge/index.ts` (T19).
- Read `apps/web/AGENTS.md` before writing Next-specific code (Next 16).

### File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261101120000_action_links.sql` | `concierge.action_links`; `notifications` loses `action_token_hash`, gains `provider_message_id`, `error`; setting `test_action_link_hours` = 24 |
| `supabase/tests/action_links.test.sql` | The table is server-only, cascades, single-use update |
| `packages/core/src/database.types.ts` | Regenerated (`pnpm db:types`) |
| `apps/web/lib/supabase/env.ts`, `lib/supabase/admin.ts` | `supabaseSecretKey`; `createAdminClient()` (server-only) |
| `apps/web/lib/brand.ts`, `lib/resend.ts`, `lib/access-request.ts` | `EMAIL_FROM` moves to brand; one `sendEmail()` used by access requests and notifications |
| `modules/concierge/notify/tokens.ts` | Make and hash tokens |
| `modules/concierge/notify/email-layout.ts`, `templates.ts` | HTML escaping, the shared layout, the six templates plus `test` |
| `modules/concierge/notify/channels.ts` | `Channel`, `emailChannel`, `CHANNELS` |
| `modules/concierge/notify/store.ts` | `NotifyStore` interface and the Supabase implementation |
| `modules/concierge/notify/notify.ts` | `notify()`, `sendTestNotification()` |
| `modules/concierge/notify/actions.ts` | The action registry (`test` only) |
| `modules/concierge/notify/links.ts` | `readActionLink()`, `confirmActionLink()` |
| `apps/web/app/a/[token]/page.tsx`, `confirm-form.tsx`, `actions.ts` | The link pages and the confirm POST |
| `apps/web/components/google-button.tsx`, `lib/supabase/proxy.ts` | `loginHint`; `/a/` is public |
| `apps/web/app/settings/*` | "Send me a test email" |
| `apps/web/scripts/email-samples.ts` | `pnpm --filter @gifts-af/web email:samples <to>` |
| `apps/web/e2e/action-links.spec.ts` | The whole link flow in a real browser |

### Task 1: Database: action links table (AC-14, AC-5, AC-2)

**Files:** create the migration and `supabase/tests/action_links.test.sql`; regenerate `packages/core/src/database.types.ts`.

**Produces:** table `concierge.action_links`: `id uuid pk`, `user_id uuid not null` (references `auth.users`, cascade), `round_id uuid null` (foreign key `(round_id, user_id)` to `gift_rounds`, cascade, like `notifications`), `notification_id uuid null` (references `notifications(id)`, on delete set null), `action text not null`, `token_hash text not null unique`, `expires_at timestamptz not null`, `used_at timestamptz`, `created_at`, `updated_at` (trigger `public.set_updated_at`). RLS on, **no policies and no grants for `authenticated`**. `notifications`: drop `action_token_hash`, add `provider_message_id text`, `error text`. `app_settings` row `('test_action_link_hours', '24', 'Hours the Settings test email''s button keeps working.')`.

- [ ] Write `action_links.test.sql` (pgTAP, same style as `concierge_rounds_orders.test.sql`), checking: a signed-in user can't select, insert or update `action_links`, even their own (`42501` or zero rows); the server inserts a link for A; `update … set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() and user_id = $2` affects 1 row the first time and 0 the second; an expired link updates 0 rows; deleting A's round deletes its links; deleting a notification leaves its link with `notification_id` null; `notifications` has `provider_message_id` and `error` and no `action_token_hash`; `concierge.setting_int('test_action_link_hours') = 24`.
- [ ] `pnpm db:test`: fails (no table).
- [ ] Write the migration.
- [ ] `pnpm supabase db reset && pnpm db:test`: all pass. Then `pnpm db:types`, and `pnpm typecheck` still passes.
- [ ] Commit: `feat(db): action links table for one-time email buttons (ALL-23)`.

### Task 2: Server key and shared Resend sender (AC-2)

**Files:** modify `lib/supabase/env.ts`, `lib/brand.ts`, `lib/access-request.ts`, `apps/web/.env.example`; create `lib/supabase/admin.ts`, `lib/resend.ts`; test `test/resend.test.ts`, and `test/access-request.test.ts` stays green.

**Produces:**
- `supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.GIFT_SUPABASE_SECRET_KEY` (not `NEXT_PUBLIC`).
- `createAdminClient(): SupabaseClient<Database>` in `lib/supabase/admin.ts`, first line `import "server-only"`; it throws `"SUPABASE_SECRET_KEY is not set"` when the key is missing; no session persistence.
- `EMAIL_FROM` in `lib/brand.ts` (`${APP_NAME} <hello@giftsaf.com>`); `ACCESS_FROM` is removed and its users import `EMAIL_FROM`.
- `type OutgoingEmail = { to: string; subject: string; html?: string; text: string; replyTo?: string }`; `sendEmail(email: OutgoingEmail, deps: { apiKey: string | undefined; fetch: typeof fetch }): Promise<{ ok: true; id: string } | { ok: false; error: string }>`. It never throws: a missing key, a non-2xx status (the error includes the status) and a network error all return `ok: false`.

- [ ] Tests in `test/resend.test.ts`: posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>` and a body containing `from: EMAIL_FROM`, `to: [to]`, and `reply_to` only when given; returns Resend's `id` on 200; returns `ok: false` on 422, on a thrown fetch, and with no key, without calling fetch.
- [ ] Run: they fail. Implement. Switch `requestAccess` to `sendEmail`; its tests pass unchanged except for the import name.
- [ ] `pnpm --filter @gifts-af/web test`: pass. Add `SUPABASE_SECRET_KEY=` with a one-line comment to `.env.example`. `pnpm add -D server-only --filter @gifts-af/web`.
- [ ] Commit: `refactor: one Resend sender and a server-only Supabase client (ALL-23)`.

### Task 3: Tokens and templates (AC-11, AC-14)

**Files:** create `modules/concierge/notify/tokens.ts`, `email-layout.ts`, `templates.ts`; tests in `modules/concierge/__tests__/tokens.test.ts`, `templates.test.ts`.

**Produces:**
- `newActionToken(): { token: string; hash: string }`: 32 bytes from `crypto.randomBytes`, base64url (43 characters); `hashActionToken(token: string): string` (SHA-256, lowercase hex).
- `escapeHtml(s: string): string`; `renderEmail(parts: { heading: string; paragraphs: string[]; rows?: { title: string; detail?: string }[]; button: { label: string; url: string }; footer?: string }): { html: string; text: string }`. The text part lists the button as `Label: url`.
- `type NotificationKind = "test" | "heads_up" | "reminder" | "final_notice" | "needs_attention" | "reaction_prompt" | "needs_address"`.
- `type RenderedEmail = { subject: string; html: string; text: string }`.
- `TEMPLATES: { [K in NotificationKind]: (data: TemplateData[K], links: TemplateLinks[K]) => RenderedEmail }`. `TemplateData` and `TemplateLinks` are exported types, one entry per kind. Data uses plain strings and dates, already formatted by the caller: person name, occasion, date text, idea rows (`title`, `price` text), and for `heads_up` a `mode: "reminder" | "auto_buy"` plus, in auto-buy mode, `autoBuyIdea` and `autoBuyDate` (decision 40). Links are named URLs, for example `heads_up: { choose: string; skip?: string }`, `test: { tryIt: string }`. Copy follows the signed-off mock-up (`design/mockups/ALL-41.html`, `#email` screen) for the heads-up; the other templates use the same plain voice, one sentence on what happened and one on what to do.
- `SAMPLE_DATA: { [K in NotificationKind]: { data: TemplateData[K]; links: TemplateLinks[K] } }`, used by the tests and by Task 8.

- [ ] Tests: tokens are 43 characters, URL-safe, and differ across 1,000 calls; the hash is 64 hex characters and stable. For every kind in `SAMPLE_DATA`: the subject is non-empty; the HTML has exactly one `<a` styled as the button, contains `max-width:600px`, has no `<style` or `class=`, and contains every link URL; the text part contains every link URL. A name of `<script>&"` appears escaped in the HTML. `heads_up` in `auto_buy` mode names the gift and date and says how to skip; in `reminder` mode it says "Nothing is bought until you choose."
- [ ] Run: fail. Implement. Run: pass.
- [ ] Commit: `feat(concierge): email templates and action tokens (ALL-23)`.

### Task 4: Store, channels and `notify()` (AC-1, AC-2, AC-13)

**Files:** create `modules/concierge/notify/store.ts`, `channels.ts`, `notify.ts`; export from `modules/concierge/index.ts`; test `modules/concierge/__tests__/notify.test.ts` with an in-memory `FakeStore` in `__tests__/fake-store.ts`.

**Interfaces:**
- Consumes: `newActionToken`, `TEMPLATES`, `sendEmail`, `createAdminClient`.
- Produces:
  - `interface NotifyStore { recipient(userId: string): Promise<{ email: string | null; timezone: string | null }>; setting(key: string): Promise<number>; insertLinks(rows: NewLink[]): Promise<void>; insertNotification(row: { userId: string; roundId: string | null; kind: NotificationKind; channel: string }): Promise<string>; finishNotification(id: string, result: { sentAt: Date; providerMessageId: string } | { error: string }): Promise<void>; attachLinks(hashes: string[], notificationId: string): Promise<void>; findLink(hash: string): Promise<LinkRow | null>; claimLink(hash: string, userId: string, now: Date): Promise<LinkRow | null>; }`. `claimLink` is the single conditional update from Task 1, returning the row or `null`. Also `createSupabaseNotifyStore(): NotifyStore`, built on `createAdminClient()`.
  - `type LinkRow = { userId: string; roundId: string | null; action: ActionName; expiresAt: Date; usedAt: Date | null }`.
  - `interface Channel { name: string; send(email: RenderedEmail & { to: string; replyTo?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> }`; `emailChannel(deps: { apiKey: string | undefined; fetch: typeof fetch }): Channel`; `defaultChannels(): Channel[]` returns `[emailChannel({ apiKey: process.env.RESEND_API_KEY, fetch })]`.
  - `notify<K extends NotificationKind>(input: { userId: string; roundId?: string; kind: K; data: TemplateData[K]; links: { [L in keyof TemplateLinks[K]]: { action: ActionName; expiresAt: Date } }; replyTo?: string }, deps: { store: NotifyStore; channels: Channel[]; baseUrl: string; now: Date }): Promise<{ ok: true } | { ok: false; error: string }>`. Steps: look up the recipient (no email: `ok: false`, nothing sent), make one token per link, store the hashes, build `${baseUrl}/a/${token}` URLs, render, then for each channel insert a `notifications` row, send, and finish the row. Links attach to the first channel's row. It's `ok` if any channel succeeded.
  - `sendTestNotification(userId: string, deps)`: reads `test_action_link_hours` and sends kind `test` with `links: { tryIt: { action: "test", expiresAt: now + hours } }`.

- [ ] Tests, with `FakeStore` and fake channels: a sent email's `to` is the recipient's email and its HTML has `/a/<43 chars>`; the fake store holds only hashes, and `hashActionToken(tokenFromUrl)` matches one; the notification row ends with `sentAt` and the provider id; a failing channel leaves the row with `error` and returns `ok: false` without throwing; with two channels both are called and two rows are written (AC-13); no recipient email returns `ok: false` with no rows and no sends; the test link's `expiresAt` is `now + 24h` when the fake setting is 24.
- [ ] Run: fail. Implement. Run: pass.
- [ ] Commit: `feat(concierge): notify() sends through a channel list and logs each send (ALL-23)`.

### Task 5: Reading and confirming a link (AC-3 to AC-9, AC-10)

**Files:** create `modules/concierge/notify/actions.ts`, `links.ts`; export through `index.ts`; test `__tests__/links.test.ts`.

**Produces:**
- `type ActionName = "test"`; `ACTIONS: Record<ActionName, { confirm: { title: string; body: string; button: string }; done: { title: string; body: string }; run(ctx: { userId: string; roundId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> }>`. `test.run` does nothing and returns ok. `test.done.body`: "It works. Buttons in our emails will look like this."
- `type LinkView = { state: "invalid" } | { state: "sign_in"; email: string | null } | { state: "wrong_account" } | { state: "used" } | { state: "expired" } | { state: "confirm"; confirm: { title: string; body: string; button: string } }`.
- `readActionLink(token: string, viewerId: string | null, deps: { store: NotifyStore; now: Date }): Promise<LinkView>`. It's read-only, never calls `claimLink`, and follows the spec's check order (invalid, sign_in, wrong_account, used, expired, confirm). `sign_in.email` is the owner's email from `store.recipient`.
- `confirmActionLink(token: string, viewerId: string | null, deps): Promise<{ state: "done"; done: { title: string; body: string } } | Exclude<LinkView, { state: "confirm" }>>`. It reads first (same order), then calls `claimLink`; `null` from the claim means `used` (a lost race); then it runs the action. If the action fails it returns `{ state: "invalid" }` and logs the error. **[Claude's call]** The link stays used, since real actions (ALL-28 and later) must be safe to treat as done or report their own failure.

- [ ] Tests with `FakeStore`: each state, in order (an unknown token is `invalid` even when signed out; a used or expired token while signed out is `sign_in`; a different viewer is `wrong_account` and the view holds no action text); `readActionLink` called twice leaves `usedAt` null (AC-3); `confirmActionLink` runs `test.run` once and returns `done`; a second call returns `used`; two concurrent `confirmActionLink` calls (`Promise.all`) run the action exactly once (`FakeStore.claimLink` is atomic like the SQL); an expired link returns `expired` and the action never runs.
- [ ] Run: fail. Implement. Run: pass.
- [ ] Commit: `feat(concierge): read and confirm one-time action links (ALL-23)`.

### Task 6: The `/a/[token]` pages and sign-in hint (AC-3 to AC-10)

**Files:** create `app/a/[token]/page.tsx`, `confirm-form.tsx` (client, `useActionState`), `actions.ts` (`"use server"`); modify `components/google-button.tsx`, `lib/supabase/proxy.ts`; tests `test/public-paths.test.ts` (extend), `test/action-link-page.test.tsx`, `test/google-button.test.tsx`.

**Interfaces:** consumes `readActionLink`, `confirmActionLink`, `createSupabaseNotifyStore` (through `@/modules/concierge`); the viewer comes from `createClient().auth.getClaims()`.

- `isPublicPath("/a/abc")` is true.
- `GoogleButton` gains `loginHint?: string`; when it's set, `signInWithOAuth` options include `queryParams: { login_hint: loginHint }`.
- The page renders one view per `LinkView` state, inside the existing `AuthFrame`/`PageFrame` look. `sign_in` shows "Sign in to continue" with `<GoogleButton next={"/a/" + token} loginHint={email} />` and a "Sign in with email" link to `/auth/login?next=/a/<token>`. `wrong_account` shows "This link is for a different account" and a sign-out-then-return button (the existing sign-out action with `next=/a/<token>`). `used`, `expired` and `invalid` show their message and a "Go to GiftsAF" link to `/`. `confirm` shows the title, body and a form whose only submit button posts to the server action. After the POST, the form shows the `done` title and body and a link home (AC-10), or the returned error state's message.
- The page sets `robots: noindex` and `referrer: no-referrer` metadata, so the token isn't leaked in a `Referer` header.

- [ ] Tests: the public path; `GoogleButton` passes `login_hint` (mock the Supabase client); the page component renders each state's copy for a given `LinkView` (render the view component directly with props, not the async page), and the `confirm` view contains a `<form>` with a `button[type=submit]`.
- [ ] Run: fail. Implement. Run: pass. `pnpm build` passes.
- [ ] Commit: `feat: one-tap confirm page for email action links (ALL-23)`.

### Task 7: "Send me a test email" in Settings (AC-1, AC-2)

**Files:** modify `app/settings/actions.ts`, `app/settings/page.tsx`; create `app/settings/test-email-button.tsx`; test `app/settings/__tests__/test-email-button.test.tsx`.

- Server action `sendTestEmail(): Promise<{ ok: true } | { ok: false; error: string }>`. It gets the user from `getClaims()` (missing: "Your session ended. Sign in again."), takes `baseUrl` from the request's `host` and `x-forwarded-proto` headers, and calls `sendTestNotification` with `createSupabaseNotifyStore()`, `defaultChannels()` and `new Date()`. On failure it returns "We couldn't send it. Try again in a minute."
- The button sits under its own small "Email" heading, shows "Sending…" while pending, then "Sent. Check your inbox." or the error.

- [ ] Tests: the button shows the pending text and then the success or error text, with the action mocked.
- [ ] Run: fail. Implement. Run: pass.
- [ ] Commit: `feat: send yourself a test email from Settings (ALL-23)`.

### Task 8: Samples script for phone checks (AC-12)

**Files:** create `apps/web/scripts/email-samples.ts`; add `"email:samples": "tsx --conditions=react-server scripts/email-samples.ts"` to `apps/web/package.json` (the condition lets the module's public index, which imports `server-only`, load outside Next; templates are imported from `@/modules/concierge`); `pnpm add -D tsx --filter @gifts-af/web`.

- `pnpm --filter @gifts-af/web email:samples you@example.com` sends one email per entry in `SAMPLE_DATA` (heads-up in both modes, so eight in all), with the subject prefixed `[Sample]`. It sends with `sendEmail` and `RESEND_API_KEY` from `apps/web/.env.development.local` (what `vercel env pull` writes) or `apps/web/.env.local`, whichever exist (loaded with `process.loadEnvFile`), and its links point to `https://giftsaf.com/a/sample`, which shows "This link doesn't work". It refuses to run without an address argument.
- [ ] Run it once against the owner's address and check that all eight arrive. No unit test (it's a manual tool); `pnpm lint` and `pnpm typecheck` cover it.
- [ ] Commit: `chore: script that sends sample emails for phone checks (ALL-23)`.

### Task 9: End-to-end link flow (AC-3, AC-4, AC-5, AC-7, AC-8)

**Files:** create `apps/web/e2e/action-links.spec.ts`; the dev server for e2e gets `SUPABASE_SECRET_KEY` from `localSupabase().serviceRoleKey` (wire it in `playwright.config.ts` next to the existing local Supabase env).

- The test inserts a link straight into local Supabase with the service key (action `test`, expiring in an hour, for `TEST_USER`), using a token it made, so it knows the URL.
- [ ] Test, signed out: `GET /a/<token>` shows "Sign in to continue", and the database row still has `used_at` null.
- [ ] Test, signed in as `TEST_USER`: opening the link twice leaves `used_at` null (AC-3); pressing the button shows "It works…" and sets `used_at`; reloading shows "already used" (AC-5).
- [ ] Test, signed in as a second local user: "This link is for a different account" and no action text.
- [ ] `pnpm supabase start` (if needed), then `pnpm --filter @gifts-af/web e2e`: pass.
- [ ] Commit: `test: end-to-end check of email action links (ALL-23)`.

### Task 10: Docs, then ship (all)

Docs go straight to `main` (CLAUDE.md > Git); the code goes through the PR.

- [ ] `design/technical-design.md`: §3 gets the `action_links` row, `notifications` changes and the "as built" note; §6.4 gets "sign-in required as the link's owner", the check order, and a link to this plan.
- [ ] `design/decisions.md`: **T36**, after checking `origin/main` for the latest number: action links need the owner signed in; the `action_links` table is generic for later products; the server key is in Vercel; templates are plain functions.
- [ ] `README.md` > Environments: `SUPABASE_SECRET_KEY` (dev key in Development and Preview; production uses the integration's `GIFT_SUPABASE_SECRET_KEY`).
- [ ] Full check: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `pnpm db:test` and e2e. Open the PR `feat: notification service with one-time email action links (ALL-23)`, with `Closes ALL-23`.
- [ ] After merge: apply the migration to `dev` (`pnpm supabase db push --linked`). **Ask the owner before applying it to `prod`.** Then send yourself a test email from Settings on a preview and on production, run the samples script (`pnpm --filter @gifts-af/web email:samples <your email>`), and fill in the phone check table above.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test: AC-1 (Tasks 4, 7), AC-2 (2, 4, 7), AC-3 (5, 9), AC-4 (5, 9), AC-5 (1, 5, 9), AC-6 (5), AC-7 (5, 6, 9), AC-8 (5, 9), AC-9 (5), AC-10 (5, 6), AC-11 (3), AC-12 (8, plus the manual phone check), AC-13 (4), AC-14 (1, 3).
- [x] Every task traces back to a story or criterion (nothing extra).
- [x] No open questions are left.

## Phone check (AC-12)

| Client | Checked by | Date | Result |
|---|---|---|---|
| Gmail (phone) | | | |
| iOS Mail | | | |

## Review focus

- Nothing acts on a GET (AC-3): a test fetches every `/a/` URL with GET and checks that the database is unchanged.
- Single use under a double tap (AC-5): two concurrent POSTs, exactly one runs the action.
- Wrong account and signed-out pages leak nothing about the action (AC-7 to AC-9).
- HTML escaping of every caller-supplied value in templates (AC-11).
- The secret key is imported only by server code (`server-only` import in `lib/supabase/admin.ts`).
