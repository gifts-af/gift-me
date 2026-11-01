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
| Who can be signing in from a link? | **Only someone who already has an account and has signed in before.** A link belongs to an account, so its owner signed up already: with Google (as an invited test user, T34) or, for older list users, with email and password. No new sign-in method (such as an emailed sign-in code) is added. | Everyone who gets these emails already has a way in. "First visit" here usually means the first time in this browser (often the mail app's own browser). People with no account at all are ALL-49. |
| What does `/a/{token}` show, in what order? | **[Claude's call]** The checks run in this order, and the first one that applies decides the page: (1) no such token: "This link doesn't work"; (2) signed out: sign-in page with the owner's email as Google's hint, for any real token, even a used or expired one; (3) signed in as someone else: "This link is for a different account"; (4) used: "already used"; (5) expired: "expired"; (6) otherwise the confirm page. Details of the action appear only at step 6. | Tokens are 256-bit random, so whether one exists isn't something worth hiding from the person holding it. What must never leak before the owner signs in is the action and its round (AC-7, AC-8). Keeping used and expired behind sign-in keeps the order simple. |
| One token column, or a links table? | **A new table, `concierge.action_links`**, one row per button, replacing `notifications.action_token_hash` (owner agreed, 2026-11-01). | One email has several buttons (choose, skip, answer a question), each with its own action and possibly its own expiry. |
| How does server code write server-only tables? | **[Claude's call]** Use a server-only Supabase secret key: production already has the integration's `GIFT_SUPABASE_SECRET_KEY`, and the dev project's key was added as `SUPABASE_SECRET_KEY` for Development and Preview (2026-11-01). Code reads `SUPABASE_SECRET_KEY ?? GIFT_SUPABASE_SECRET_KEY`, the same pattern as `lib/supabase/env.ts`. One helper, `lib/supabase/admin.ts`, that only server code imports. Every lookup still checks the signed-in user against the link's owner in code. | T26 says server code writes rounds, notifications and the rest, and nothing can do that yet. The round engine (ALL-28) needs the same key, so it's set up once, properly (README > Environments). |
| Email templates: a library or plain code? | **[Claude's call]** Plain TypeScript functions that return `{ subject, html, text }`, sharing one layout function with inline styles. No new dependency. | Six simple, single-button emails. A templating library adds a build step and a dependency for little gain (Principle 1). |
| How are tokens made? | **[Claude's call]** 32 random bytes from the platform's crypto, base64url (43 characters), stored as a SHA-256 hex hash. Looked up by hash; marked used with a single conditional update (`used_at is null and expires_at > now()`), so a double tap can't run it twice. | Enough randomness that guessing is hopeless, and SHA-256 is right for random tokens (no salt or slow hash needed). |
| When does a link expire? | **The caller decides** (`expiresAt`); round links use the round's deadline (design §6.4). The test email's link uses a new setting, `test_action_link_hours` (24). | T23: no timing constants in code. |
| What does the `test` action do? | Nothing beyond proving the path: it marks the link used and the result page says "It works. Buttons in our emails will look like this." | Real actions belong to their own tickets. |
| How do you check the templates on a phone? | **[Claude's call]** `pnpm email:samples you@example.com` sends every template with sample data through the pulled dev key. Links in samples point to a sample page and don't act. | One command beats wiring six fake rounds; it uses the dev quota (100 a day). |
| Which channels? | A list in code, `CHANNELS = [emailChannel]`. Each channel is `{ name, send(message, recipient) }`, and `notify()` sends through every one. | The design asks for a list so push is just another entry. It stays in code, not settings: it's what's built, not a tunable (T23 allows it). |
| Whose email address? | `public.profiles.email`, which always mirrors the account's sign-in email. | Already kept in sync, and it's what the user signed in with. |
| Dates and times in emails | Shown in the user's `profiles.timezone`. When that's unknown, dates (no times) are shown as calendar dates with no time zone. | Rounds are day-based (§5.1), so a date is enough. |

## Principles check

- **Simplest version?** What we cut: no templating library, no notification preferences, no real actions, no push, no first-visit teaser (ALL-49), no separate confirm page per action (one generic page, where each action gives its own wording).
- **Hard-coded values?** New setting `test_action_link_hours` (24). Sender address and name come from `lib/brand.ts` and the existing `ACCESS_FROM` pattern (moved to a shared constant). New env var `SUPABASE_SECRET_KEY` (Development and Preview; production uses `GIFT_SUPABASE_SECRET_KEY`). `RESEND_API_KEY` already exists.
- **Product boundaries?** The service lives in `modules/concierge/notify/` and is exported through `modules/concierge/index.ts`. The `/a/[token]` route and Settings button live in `app/` and import only module `index.ts` files.
- **Privacy:** `action_links` is server-only (no grants to `authenticated`), like `notifications` (T26). The raw token is never stored or logged.
- **Docs and decisions** to update: design §3 (`action_links` row; `notifications` loses `action_token_hash`, gains `provider_message_id` and `error`), §6.4 (sign-in required as the link's owner), new decision T36 (check `origin/main`'s latest T number first), README > Environments (`SUPABASE_SECRET_KEY`), `apps/web/.env.example`, `planning/ideas.md` (the Jim to Edgar idea and its teaser, ALL-49).

## Plan

_Written after this spec is approved (superpowers:writing-plans)._

## Before coding: consistency check

- [ ] Every acceptance criterion maps to a task and a test.
- [ ] Every task traces back to a story or criterion (nothing extra).
- [ ] No open questions are left.

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
