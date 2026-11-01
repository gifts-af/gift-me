# ALL-22 Chrome extension MVP: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one click in a Chrome extension saves what's on screen to a person: a `captures` row with status `pending`, plus its screenshot in private Storage.

**Links:** [ALL-22](https://linear.app/allensforever/issue/ALL-22) · technical design §2.1, §6.2 · PRD C-1, C-2 · decision 19 (no crawling) · T23, T26, T28 · mock-up `design/mockups/ALL-41.html#extension`

## Spec: what it does

The capture is raw material for the AI, and ALL-25 is what reads it. This ticket gets the page into the database and Storage, and nothing more.

### Who it's for and what they can do

1. **Sign in once:** as a buyer, I sign in to the extension from giftsaf.com and stay signed in through browser restarts, so capturing is always one click.
2. **Capture for a person:** as a buyer on any web page, I pick a person, optionally add a note, and click **Save to {Person}**. The page's URL, title, visible text and a screenshot of what I see are saved for that person.
3. **Add a person on the spot:** as a buyer with no people yet, or with the person I want missing, I add one in the popup with just a name and a relationship, so the extension works before the people screens (ALL-21) exist.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The extension isn't signed in | I click **Sign in** and I'm signed in on giftsaf.com | The popup shows my people. The web app's session is untouched, and I stay signed in there. |
| AC-2 | The extension is signed in | I quit and reopen Chrome, after the access token has expired | The popup still shows my people without signing in again |
| AC-3 | The extension is signed in | I click **Sign out** in the popup | The extension's session is revoked and cleared, and the web app stays signed in |
| AC-4 | I'm on Instagram, Pinterest or an ordinary product page | I pick a person and click **Save** | One `captures` row exists (pending, with URL, title, text, and the note if I gave one) and its JPEG is in the `captures` bucket at `{user_id}/{capture_id}.jpg` |
| AC-5 | The page's text is longer than the `capture_text_max_chars` setting | I save | The stored `text_excerpt` is cut to that length |
| AC-6 | A request with no token, a bad token, someone else's `person_id`, or a screenshot over `capture_screenshot_max_bytes` | It hits `POST /api/captures` | 401, 404, 404 or 413, and nothing is written |
| AC-7 | The screenshot upload fails | I save | No `captures` row is left behind, and the popup shows an error with a retry |
| AC-8 | Another signed-in user | Tries to read or write my files in the `captures` bucket | It's denied |
| AC-9 | I have no people | I add "Sam, friend" in the popup | A `public.people` row is created and selected, and **Save to Sam** is enabled |
| AC-10 | I'm on a page Chrome blocks (`chrome://`, the Web Store) | I open the popup | It says the page can't be captured, and Save is disabled |
| AC-11 | The built extension | Its manifest is read | Its permissions are exactly `activeTab`, `scripting` and `storage`, with no `host_permissions` and no content scripts |

### Out of scope

- AI extraction and the "Here's what I learned" review: ALL-25.
- People fields beyond name and relationship: ALL-21.
- Deleting a person's files from Storage when the person is deleted (design §2.1). The rows cascade but the files don't; this goes to ALL-21 or ALL-37, and a note is added to ALL-21.
- A Web Store listing, other browsers (C-9), and capturing contact lists (P-6).

### Open questions

None open. The answers are below.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| What does a user with no people see? | A quick add (name and relationship) in the popup. | Owner, 2026-11-01. Without it, the extension is useless until ALL-21. |
| How does the extension sign in? (§6.2 [Verify]) | It gets **its own Supabase session**. The signed-in page `/extension/connect` has the server generate a one-time magic-link token for the current user (admin `generateLink`, no email sent) and sends only the hashed token to the extension through `externally_connectable`. The extension exchanges it with `verifyOtp` and stores the session in `chrome.storage.local`. | Handing over the web app's refresh token would make the two share one token. Supabase rotates refresh tokens and revokes the whole session when a used token comes back, so they would sign each other out. A separate session also lets each one sign out on its own. **[Claude's call]** |
| How does the web page find the extension? | The manifest has a fixed `key`, so the extension ID is the same for every unpacked install. The ID is an env var in the web app. | `chrome.runtime.sendMessage` needs the ID. Without a key, every unpacked install gets a random one. **[Claude's call]** |
| Where do limits live? | `concierge.app_settings`: `capture_text_max_chars` (20000) and `capture_screenshot_max_bytes` (2500000). When the popup opens, the extension reads the text cap through `concierge.setting_int()`, which signed-in users can call, and trims the text before sending. The server trims again and rejects screenshots that are too large. The screenshot goes as raw binary in multipart, not base64. | T23: one source of truth. Vercel cuts off any request over 4.5 MB with its own 413 before the route runs, so the extension has to trim first. A 2.5 MB screenshot plus 20k characters stays well under that limit. **[Claude's call]** |
| Which sites can sign the extension in? | Two builds. **dev** accepts `http://localhost:3000` and uses `gift-me-dev`. **prod** accepts `https://giftsaf.com` and uses `gift-me`. Preview deployments can't sign it in. Both builds use the same key and ID, so only one is installed at a time. | Chrome won't accept a `*.vercel.app` match, because `vercel.app` is a public suffix. Previews aren't needed: test with localhost. **[Claude's call]** |
| How does the route get past `proxy.ts`? | `/api/captures` is added to `isPublicPath`. The route checks the bearer token itself, returns 401 when it's missing or bad, and answers the CORS preflight (`OPTIONS`) for `chrome-extension://{EXTENSION_ID}` only. | Otherwise the proxy would redirect the request to the login page (307) instead of letting the route return 401, and the preflight would fail. |
| Sign out | `supabase.auth.signOut({ scope: "local" })`. | The default, `global`, would also sign the web app out (AC-3). |
| Where does the popup's note go? | A new `note` column on `concierge.captures`. | The mock-up has the field, and the note belongs to that capture's extraction. **[Claude's call]** |
| Who writes to the database and Storage? | The route checks the bearer token and then uses a Supabase client acting as that user, so RLS applies. The extension reads and adds people directly with supabase-js under the same RLS. | T26: captures and people are user-writable, so they don't need the admin key. **[Claude's call]** |
| Popup UI | React plus Tailwind with the T28 tokens, built by Vite (`@crxjs/vite-plugin` or a plain multi-entry Vite build). | It matches the web app's stack and the shared tokens (T15). **[Claude's call]** |
| Screenshot format | `captureVisibleTab` JPEG, quality 70. | The text is the main input, and this keeps files small. Tune it if extraction needs more detail. **[Claude's call]** |
| Relationship options in quick add | One list in `packages/core` (parent, partner, child, sibling, friend, other), which ALL-21's people form reuses. | `relationship` is required free text, and `budget_defaults` holds a user's own rows with nothing seeded. A list of labels is vocabulary, not a business number, so T23 doesn't apply. **[Claude's call]** |
| Database changes | One migration: the private bucket `captures`, `storage.objects` policies scoped to the `{auth.uid()}/` folder, `captures.note`, and the two settings rows. It's applied to `dev` first, and to `prod` after the merge (ask first). | Neither the bucket nor any Storage policies exist yet. |

## Principles check

- **Simplest version?** What we cut: no Web Store listing, no background script work beyond messaging, no client-side trimming, people limited to name and relationship.
- **Hard-coded values?** New env vars: `NEXT_PUBLIC_EXTENSION_ID` (web), plus `VITE_APP_ORIGIN`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (extension build, dev or prod). New settings: `capture_text_max_chars` and `capture_screenshot_max_bytes`. The JPEG quality is an extension build env var, `VITE_CAPTURE_JPEG_QUALITY`.
- **Product boundaries?** The capture route lives in `apps/web/modules/concierge`, and the connect page is shared auth code (`apps/web/app/extension/connect`). The extension reads `public.people` (shared) and writes `concierge.captures`, both through Supabase.
- **Docs and decisions:** `design/technical-design.md` §6.2 (the resolved hand-off) and §2.1 (the extension row; "deleting a person deletes their files" is now marked as pending ALL-21 or ALL-37). `design/decisions.md` gets the next T# for the separate extension session (check `origin/main`'s latest number first). `apps/extension/README.md` gets the install and build steps. `README.md` gets the doc table and env vars. The Linear note goes on ALL-21 about deleting Storage files.

## Plan

Written after the spec is approved (`superpowers:writing-plans`).
