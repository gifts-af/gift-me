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
- **Docs and decisions:** `design/technical-design.md` §6.2 (the resolved hand-off) and §2.1 (the extension row; "deleting a person deletes their files" is now marked as pending ALL-21 or ALL-37). `design/decisions.md` gets T40 for the separate extension session. `apps/extension/README.md` gets the install and build steps. `README.md` gets the doc table and env vars. The Linear note goes on ALL-21 about deleting Storage files.

## Plan

**Architecture:** the server side lives in `apps/web`. A migration adds the bucket, policies, column and settings. The capture logic is `modules/concierge/capture/`, built behind a store interface with a fake for tests, the same way `notify/` is. The route at `app/api/captures` is thin, and `app/extension/connect` hands over the sign-in. The extension is `apps/extension`: a Vite build with a React popup and a small service worker that only accepts the sign-in message. It reads and writes Supabase directly under RLS and posts captures to the route.

**Tech stack:** Supabase (Storage, pgTAP tests), Next.js 16 route handler and server action, Vite, React, Tailwind (T28 tokens), `@supabase/supabase-js`, Vitest with jsdom, and a fake `chrome` global.

### Global constraints

- Permissions are exactly `["activeTab", "scripting", "storage"]`, with no `host_permissions` and no `content_scripts`.
- Nothing runs on a page except on Save, plus a no-op probe when the popup opens (C-2).
- Settings: `capture_text_max_chars` = 20000 and `capture_screenshot_max_bytes` = 2500000, both in `concierge.app_settings`.
- Storage path: `captures/{user_id}/{capture_id}.jpg`. The bucket is private.
- Sign-out always uses `{ scope: "local" }`.
- No admin key anywhere except the connect page's `generateLink`.
- The popup copy is from the mock-up: "Capture for…", "Save to {name}", "Saved to {name}. We'll show you what we learned.", "Capture another".

### Task 1: Migration, storage policies, settings (AC-5, AC-6, AC-8)

**Files:**
- Create: `supabase/migrations/20261102120000_capture_storage.sql`. Use the next free timestamp after the newest file on `origin/main` and on ALL-44's branch.
- Create: `supabase/tests/capture_storage.test.sql`
- Modify: `packages/core/src/database.types.ts` (`pnpm db:types`)

- [ ] **Write the failing pgTAP test.** In the `soft_delete.test.sql` style, with `tests.create_user` and `tests.act_as`:
  - bucket `captures` exists with `public = false`
  - as user a, inserting `storage.objects` at `'{a}/x.jpg'` succeeds, and at `'{b}/x.jpg'` it throws
  - as user b, selecting a's object returns 0 rows
  - `concierge.captures` has a `note` column
  - `concierge.setting_int('capture_text_max_chars') = 20000` and `setting_int('capture_screenshot_max_bytes') = 2500000`
- [ ] Run `pnpm db:test`. Expected: FAIL.
- [ ] **Write the migration.** Insert into `storage.buckets` (`captures`, private). Add four `storage.objects` policies for `authenticated`: `bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text`. Run `alter table concierge.captures add column note text check (char_length(note) <= 2000)`, plus the column grant if captures uses column grants (check the migration). Add the two settings rows with `on conflict do nothing`.
- [ ] Run `pnpm db:test`. Expected: PASS. Then run `pnpm db:types`.
- [ ] Commit `feat(db): private captures bucket, capture note and limits (ALL-22)`.

### Task 2: Capture logic (AC-4, AC-5, AC-6, AC-7)

**Files:**
- Create: `apps/web/modules/concierge/capture/capture.ts`, `capture/store.ts`, `__tests__/capture.test.ts`, `__tests__/fake-capture-store.ts`
- Modify: `apps/web/modules/concierge/index.ts` (export `saveCapture` and the types)

**Interfaces:**
- Produces:
  ```ts
  type CaptureInput = { personId: string; url: string; title: string; text: string; note: string | null; screenshot: Blob };
  interface CaptureStore {
    limits(): Promise<{ textMaxChars: number; screenshotMaxBytes: number }>;
    personExists(personId: string): Promise<boolean>;          // RLS-scoped: false for someone else's
    insertCapture(row: { personId; url; title; text; note }): Promise<{ id: string; userId: string }>;
    uploadScreenshot(path: string, jpeg: Blob): Promise<void>;  // throws on failure
    setScreenshotPath(id: string, path: string): Promise<void>;
    deleteCapture(id: string): Promise<void>;
  }
  type SaveResult = { ok: true; id: string } | { ok: false; status: 404 | 413 | 500; error: string };
  function saveCapture(store: CaptureStore, input: CaptureInput): Promise<SaveResult>;
  function parseCaptureForm(form: FormData): CaptureInput | null;   // null → 400
  ```

- [ ] **Write the failing tests** against `FakeCaptureStore`:
  - `trims text to textMaxChars` (21,000 chars in, exactly 20,000 stored)
  - `rejects a screenshot over the limit with 413 and writes nothing`
  - `returns 404 for an unknown or foreign person and writes nothing`
  - `stores row then screenshot at {userId}/{id}.jpg and sets screenshot_path`
  - `deletes the row and returns 500 when the upload throws`
  - `parseCaptureForm returns null when person_id or screenshot is missing`, and blank notes become `null`
- [ ] Run `pnpm --filter @gifts-af/web test capture`. Expected: FAIL.
- [ ] **Implement it.** The order is limits, size check, person check, insert, upload, set path. Rollback happens on the upload or set-path failure.
- [ ] Run the tests again. Expected: PASS. Commit `feat(concierge): save a capture with its screenshot (ALL-22)`.

### Task 3: `POST /api/captures` route (AC-6)

**Files:**
- Create: `apps/web/app/api/captures/route.ts`, `apps/web/modules/concierge/capture/supabase-store.ts`, `apps/web/app/api/captures/__tests__/route.test.ts`
- Modify: `apps/web/lib/supabase/proxy.ts` (`isPublicPath` adds `/api/captures`), `apps/web/test/public-paths.test.ts`

**Interfaces:**
- Consumes: `saveCapture` and `parseCaptureForm` (Task 2), `supabaseUrl` and `supabaseKey` (`lib/supabase/env`)
- Produces: `createSupabaseCaptureStore(accessToken: string): Promise<CaptureStore | null>`. This uses `createClient(url, key, { global: { headers: { Authorization: "Bearer …" } }, auth: { persistSession: false } })` and returns `null` when `auth.getUser(token)` fails. `limits()` calls `rpc('setting_int')` on the `concierge` schema.
- Env: `NEXT_PUBLIC_EXTENSION_ID`. A missing value is a thrown error, not a default.

- [ ] **Write the failing tests,** with `createSupabaseCaptureStore` mocked:
  - `OPTIONS from chrome-extension://{id} returns 204 with Allow-Origin, Allow-Headers authorization`
  - `OPTIONS or POST from another origin gets no Allow-Origin`
  - `POST without bearer → 401`, and `with a token the store rejects → 401`
  - `bad form → 400`
  - `success → 201 {id}`
  - Add `/api/captures` to the public-paths `it.each`.
- [ ] Run them. Expected: FAIL.
- [ ] Implement `OPTIONS` and `POST`, plus the store adapter (`schema("concierge").from("captures")`, `storage.from("captures").upload(path, blob, { contentType: "image/jpeg" })`).
- [ ] Run the tests again. Expected: PASS. Commit `feat(concierge): capture-upload route for the extension (ALL-22)`.

### Task 4: Connect page (AC-1) [P with Tasks 2 and 3]

**Files:**
- Create: `apps/web/app/extension/connect/page.tsx`, `connect/actions.ts`, `connect/connect-client.tsx`, `connect/__tests__/actions.test.ts`

**Interfaces:**
- Produces: the server action `createExtensionToken(): Promise<{ tokenHash: string } | { error: string }>`. It gets the signed-in user's email from the cookie client and calls `createAdminClient().auth.admin.generateLink({ type: "magiclink", email })`, returning `properties.hashed_token`. No email is sent.
- Message to the extension: `{ type: "connect", tokenHash: string }`, sent with `chrome.runtime.sendMessage(NEXT_PUBLIC_EXTENSION_ID, msg)`. The reply is `{ ok: boolean, error?: string }`.

- [ ] **Write the failing tests:**
  - `returns the hashed token for the signed-in user` (mocked admin and cookie clients)
  - `returns an error when signed out`
  - `never returns action_link`
- [ ] Implement the action. The client component sends the message on mount and shows "Extension connected. You can close this tab." When `chrome.runtime` is undefined or the message is rejected, it shows the install steps with a link to the README.
- [ ] Run the tests. Expected: PASS. Commit `feat: sign the extension in from giftsaf.com (ALL-22)`.

### Task 5: Relationship list in core [P]

**Files:** `packages/core/src/relationships.ts`, `relationships.test.ts`, `index.ts` export

- [ ] Write the failing test: `RELATIONSHIPS` equals `["parent","partner","child","sibling","friend","other"]`, each with a display `label`.
- [ ] Implement it, run the test (PASS), commit `feat(core): relationship list (ALL-22)`.

### Task 6: Extension scaffold and manifest (AC-11)

**Files:**
- Create: `apps/extension/package.json` (`@gifts-af/extension`; scripts `build` = `vite build --mode production`, `build:dev` = `vite build --mode development`, `test`, `typecheck`, `lint`), `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts` (T28 tokens, the same values as the web app's), `src/manifest.ts`, `src/manifest.test.ts`, `src/popup/index.html`, `src/background.ts`, `.env.development`, `.env.production`
- Modify: `apps/extension/README.md`, `.gitignore` (`apps/extension/dist`)

**Interfaces:**
- Produces: `buildManifest(env: { appOrigin: string; key: string; name: string }): chrome.runtime.ManifestV3`. `externally_connectable.matches` is `[`${appOrigin}/*`]`. The background is a module service worker, and `action.default_popup` is the popup.
- Env (committed, all public): `VITE_APP_ORIGIN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_EXTENSION_KEY`, `VITE_CAPTURE_JPEG_QUALITY=70`. Dev uses `http://localhost:3000` with `gift-me-dev`. Prod uses `https://giftsaf.com` with `gift-me`.
- Key: run `openssl genrsa 2048` once and commit the public key as `VITE_EXTENSION_KEY`. The private key isn't needed for unpacked installs, so it isn't kept. Put the derived ID in the README and in Vercel env `NEXT_PUBLIC_EXTENSION_ID` for all environments. Admin step: allensforever711 does this through the Vercel CLI.

- [ ] **Write the failing tests:**
  - `permissions are exactly activeTab, scripting, storage`
  - `no host_permissions or content_scripts`
  - `externally_connectable matches only the app origin`
  - `key is set`
- [ ] Implement it. Vite writes `dist/manifest.json` from `buildManifest` (a small plugin or `@crxjs/vite-plugin`).
- [ ] Run `pnpm --filter @gifts-af/extension test` (PASS) and `build:dev`, which produces `dist/` that Chrome loads unpacked. Commit `feat(extension): MV3 scaffold with three permissions (ALL-22)`.

### Task 7: Extension session (AC-1, AC-2, AC-3)

**Files:** `apps/extension/src/lib/storage.ts`, `lib/supabase.ts`, `lib/auth.ts`, `src/background.ts`, `src/test/fake-chrome.ts`, `src/lib/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `chromeStorage: SupportedStorage`, with `getItem`, `setItem` and `removeItem` over `chrome.storage.local`
  - `getSupabase(): SupabaseClient<Database>`, a singleton per context with `{ storage: chromeStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }`
  - `connect(tokenHash: string): Promise<{ ok: true } | { ok: false; error: string }>`, which calls `verifyOtp({ token_hash, type: "magiclink" })`
  - `signOut(): Promise<void>`, which uses `signOut({ scope: "local" })`
  - `background.ts`: `chrome.runtime.onMessageExternal` accepts `{type:"connect"}` only when `new URL(sender.url).origin === VITE_APP_ORIGIN`, calls `connect`, and replies with the result

- [ ] **Write the failing tests:**
  - the storage adapter round-trips
  - `connect` calls `verifyOtp` with the hash
  - `signOut` passes `scope: "local"`
  - the background ignores messages from another origin and messages of another type
- [ ] Implement it, run the tests (PASS), commit `feat(extension): its own Supabase session, signed in from the web app (ALL-22)`.

### Task 8: Popup (AC-4, AC-7, AC-9, AC-10)

**Files:** `apps/extension/src/popup/App.tsx`, `popup/PersonPicker.tsx`, `popup/AddPerson.tsx`, `src/lib/page.ts`, `src/lib/upload.ts`, `src/popup/__tests__/App.test.tsx`, `src/lib/__tests__/page.test.ts`, `src/lib/__tests__/upload.test.ts`

**Interfaces:**
- Consumes: `getSupabase` and `signOut` (Task 7), `RELATIONSHIPS` (Task 5)
- Produces:
  - `canCapture(tabId: number): Promise<boolean>`: `executeScript` with `() => true`, returning false when it throws
  - `collectPage(tabId: number, opts: { jpegQuality: number; textMax: number }): Promise<{ url, title, text, screenshot: Blob }>`, where `text` is `document.body.innerText.slice(0, textMax)` and the popup gets `textMax` from `rpc('setting_int', { p_key: 'capture_text_max_chars' })` read when the popup opens
  - `uploadCapture(accessToken: string, input: {...}): Promise<{ ok: true; id } | { ok: false; status: number; error: string }>`: a multipart POST to `${VITE_APP_ORIGIN}/api/captures`

- [ ] **Write the failing tests,** with RTL and fake chrome:
  - signed out → **Sign in** opens `${APP_ORIGIN}/extension/connect` with `chrome.tabs.create`
  - people are listed by name, and selecting one makes the button read "Save to Mom"
  - no people → the add form; submitting "Sam" plus `friend` inserts into `people` and shows "Save to Sam" (AC-9)
  - `canCapture` false → "This page can't be captured" with Save disabled (AC-10)
  - a successful save → "Saved to Mom. We'll show you what we learned." and **Capture another** resets the form
  - an upload failure → an inline error and a **Try again** that resends
  - a 401 → the Sign in view
  - `collectPage` trims the text, and the upload builds a FormData with every field
- [ ] Implement it to the mock-up. Run the tests (PASS), then commit `feat(extension): capture popup with person picker and quick add (ALL-22)`.

### Task 9: Docs, rollout, manual acceptance (AC-2, AC-4, AC-11)

- [ ] **Docs:**
  - `design/technical-design.md` §6.2 step 1 becomes the decided hand-off, with the [Verify] removed. In §2.1, the files clean-up is marked pending ALL-21 or ALL-37.
  - `design/decisions.md` gets the next T# ("the extension has its own Supabase session"). Fetch `origin/main` first.
  - `apps/extension/README.md` covers build, loading unpacked, dev vs prod, and the ID.
  - `README.md` gets the doc table and env rows.
- [ ] **Linear:** comment on ALL-21 that deleting a person must remove `captures/{user}/` files, or link it to ALL-37.
- [ ] **dev:** run `pnpm supabase db push --linked` (dev). Add `NEXT_PUBLIC_EXTENSION_ID` to Vercel. Run `pnpm dev` and `build:dev`, then load unpacked. Check AC-4 on Instagram, Pinterest and a product page by querying `concierge.captures` and the bucket. Check AC-2 by quitting Chrome, waiting past one hour, and reopening. Check AC-1 and AC-3 by confirming the web app stays signed in.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then open the PR `feat: Chrome extension MVP with capture upload (ALL-22)` with `Closes ALL-22`.
- [ ] **After the merge:** ask, then push the migration to prod and relink the CLI to dev.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test:
  - AC-1: Tasks 4, 7 and 9
  - AC-2: Tasks 7 and 9 (manual)
  - AC-3: Task 7
  - AC-4: Tasks 2, 8 and 9
  - AC-5: Tasks 1 and 2
  - AC-6: Tasks 2 and 3
  - AC-7: Tasks 2 and 8
  - AC-8: Task 1
  - AC-9: Tasks 5 and 8
  - AC-10: Task 8
  - AC-11: Task 6
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.

## Review focus

1. **Auth leaking across apps:** signing out of, or refreshing in, either app must leave the other alone (Task 7 tests plus the manual check in Task 9).
2. **Cross-user access:** someone else's `person_id`, or a Storage path outside your own folder (Task 2's 404 test, Task 1's policy tests).
3. **Origin trust:** the background ignores messages from other origins, and the route sends no CORS headers to other origins (Tasks 7 and 3).
4. **Large pages:** a long page's text and a retina screenshot stay under Vercel's 4.5 MB limit (the trim in Task 8 and the 413 in Task 2). Add a test in Task 8: `collectPage on 1 MB of text sends at most textMax chars`.
5. **Orphans:** an upload that fails after the insert leaves no row behind (Task 2's rollback test). A row whose path update fails is also rolled back.
