# ALL-78 Add to my list from the extension, and clear feedback after every save: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** on a product page, one click in the extension adds the product (name, price, photo, link) to your own list, and every save in the popup ends on a clear success screen that says what happens next.

**Links:** [ALL-78](https://linear.app/allens-forever/issue/ALL-78) (folds in ALL-138; ALL-137's store-update checks run on this release). Approved mock-ups (owner, 2026-11-20): https://claude.ai/artifact/YU7tRxcSdDyP8GRCs1SjkP. Related: ALL-10 (store-page reader, planning decision 49/50, T52), ALL-141 (the website keeps its own photo copy too), ALL-22/ALL-25 (extension, capture), ALL-94 (paid features), PRD C-2.

## Spec: what it does

### Who it's for and what they can do

1. **Add to my list:** as a list owner browsing a store, I open the extension on a product page and see the product (photo, name, price, store) already filled in, so one click puts it on my list.
2. **Fix it first:** I can edit the name and price, and switch to another large image on screen with ‹ ›, before adding. If the page has no price, I type one.
3. **Know it worked:** after adding, the popup says "Added to your list" with the item, or "Already on your list" if that link is there already, and offers "See your list".
4. **Save for someone without scrolling twice:** on a product page, my 3 most recent people are one tap each; "Someone else…" opens a full-height list where only the names scroll, with search at the top and Save at the bottom.
5. **Know a capture worked:** after "Save to Jimmy", every outcome starts with the same "✓ Saved to Jimmy" banner, then what happened (learned facts, not read yet because the account has no paid features, read later, couldn't read with Try again, nothing new), and links to Jimmy's profile.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | a page with a JSON-LD, microdata or Open Graph product (fixtures from ALL-10: Banana Republic, Walmart, Target) | the popup opens | the product card shows that name, price and store; the reader is the same code the website uses |
| AC-2 | a product page whose photo is on screen | the popup opens | the card's photo is cropped from one screenshot of the visible tab at the product image's box (the image matching the product's image URL, else the largest visible image), so a store blocking hotlinks can't stop it. The box is scaled by the screenshot's width ÷ `innerWidth` (right at any page zoom), clipped to the visible area, and an image less than half visible isn't a candidate. Tested with a unit test on the crop maths and by hand in the built extension at 100% and 125% zoom |
| AC-3 | several large images on screen | ‹ or › is pressed | the photo switches to the next candidate from the same screenshot (no new capture), "n of m" shows the position, and the chosen crop is what gets saved. Tested in the popup's component tests and by hand |
| AC-4 | no product photo on screen | the popup opens | the card shows "No photo" and Add still works (the gift saves without a photo) |
| AC-5 | the page has a product but no price | the popup opens | the price box is empty and focused with "Not on the page. Type it in.", and Add is off until a valid price is entered |
| AC-6 | a product card | Add to my list is pressed | one gift is added at the top of the signed-in user's list with the edited name and price, the cleaned link (see "Duplicate check"), the page's product ID if it has one, `source` = `extension`, and a stored photo copy at most `list_photo_width_px` wide that the list card and the shared list show |
| AC-6b | a double-click on Add, or two adds of the same product at once | both reach the server | exactly one gift is added; the other gets "Already on your list" (local-database race test) |
| AC-6c | a list with `MAX_ITEMS` (500) gifts | Add is pressed | nothing is added and the popup says the list is full; the server enforces it, not only the app |
| AC-7 | a user with no list yet | they add from the extension while a My list tab also creates their list | exactly one list exists and the gift is on it (same advisory lock as `save_list_checked`; local-database race test) |
| AC-8 | a gift for the same product is already on the list, including one whose link differs only by tracking or other non-variant query values (`?ref=…`, `?from=search`), `www.` or a trailing slash | Add is pressed | nothing is added and the popup says "Already on your list"; a link that differs by a variant parameter (`?variant=…`, `?size=…`, `?color=…`) is added as a new gift |
| AC-8b | no exact match, but a gift on the list is from the same store and has the same product ID (`sku`, `gtin*`, `mpn` or `productID` from the page's product data) or the same name ignoring case and punctuation | Add is pressed | the popup asks "This looks like a gift already on your list" with that gift's photo, name and price, and "Add anyway" / "Don't add"; nothing is saved until one is chosen. Two different stores never match. |
| AC-9 | My list is open in a tab | a gift is added from the extension | the add moves the list's `updated_at` (`clock_timestamp()`), so the tab's next save is refused as stale and merged, and the new gift isn't removed (local-database test) |
| AC-9b | a gift with a stored photo | it's removed from My list, its list is deleted, or the account is deleted | the photo is deleted from storage by the next daily tick (an after-delete trigger records the path; the tick removes it through the Storage API) |
| AC-9c | an add that fails, or turns out to be a duplicate, after its photo was uploaded | the route finishes | the uploaded photo is deleted |
| AC-9d | a signed-in user with a token | they try to upload to or list `list-photos` directly | refused: there are no insert or select policies for users; only the route uploads, after checking the file is a JPEG under the size limit (the bucket also allows only `image/jpeg` and has a `file_size_limit`) |
| AC-10 | a page with no product (Instagram, a blog) | the popup opens | one line explains there's nothing to add, and the full-height people list shows |
| AC-11 | a product page | the popup opens | the 3 people (not deleted) the user most recently captured for show as buttons, plus "Someone else…"; with fewer captures, the rest are filled alphabetically. Read with one ordered, limited query, not every capture |
| AC-12 | the full-height people list | the list is longer than the space | only the names scroll; search, note and Save stay in view; the popup never scrolls as a whole |
| AC-13 | "Someone else…" from a product page | ‹ Back is pressed | the product card comes back with any name, price and photo edits kept |
| AC-14 | a capture is saved | each outcome (read with facts, not read for an account without paid features, read later, couldn't read, nothing new) | the popup shows "✓ Saved to {name}" first, then the outcome text from the mock-ups, then "See {name}'s profile" and "Capture another" |
| AC-15 | a save in the popup | Save or Add is pressed | the popup stays open on the result screen (checked by hand in the built extension; if it closes, that's fixed in this ticket) |
| AC-16 | the popup is open | before Add or Save is pressed | nothing from the page leaves the device: reading the product and cropping the photo happen in the popup (C-2) |
| AC-17 | the extension manifest | built for the store | permissions are still `activeTab`, `scripting`, `storage` only |
| AC-18 | signed out, or a token that has expired | Add is pressed | the popup shows sign-in, as Save does today |
| AC-19 | the store listing (summary, description, single purpose, permission reasons in `apps/extension/README.md`) and `/privacy` | the release is submitted | they say the extension reads the open tab when you click its icon, that nothing leaves your computer until you press Add or Save, and that the single purpose is "Save gifts and gift ideas from any page to GiftsAF"; the listing and `/privacy` match (T69) |
| AC-20 | `extension_add_enabled` = 0 | Add is pressed | the route refuses with a message the popup shows ("Adding from the extension is paused"), and nothing is saved; saving for a person still works |
| AC-21 | an older extension build, or a request without the current shape version | it posts to the add route | the route answers 400 with a clear "Update the GiftsAF extension" message, never a half-save (E4) |
| AC-22 | an add | it succeeds, is a duplicate, is a likely duplicate, or fails | events `list.extension_add` with `outcome` and ids only (list id, item id), never the link, name or price (E6, T52) |

### Out of scope

- Adding to someone else's list as a buyer-only suggestion: ALL-77.
- Choosing between several lists: ALL-7 (everyone has one list for now).
- The website's own photo copy for pasted links: ALL-141 (shares this ticket's storage).
- Prices in other currencies: only USD, as ALL-10.
- Picking a photo by clicking on the page: Chrome closes the popup when the page is clicked, so ‹ › in the popup does this instead (owner, 2026-11-20).

### Open questions

None open. See below.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Popup layout | Product card on top, "or save it for someone" below (layout A) | Owner, 2026-11-20. Adding is the one-click move on a product page. |
| Photos | Our own copy, cropped from the visible-tab screenshot, chosen with ‹ › in the popup | Owner, 2026-11-20. Stores block hotlinking; the screenshot can't be blocked and needs no new permission. |
| Scrolling | 3 recent people as buttons on a product page; the full list gets the whole popup with search and Save pinned | Owner, 2026-11-20, after testing showed the nested scroll is cumbersome. |
| Feedback after saving | One success banner for every outcome, outcome text below, separate amber note when not read | Owner, 2026-11-20 (from ALL-138). |
| One store submission | All remaining extension changes ship in this release | Owner, 2026-11-20. |
| Reading the product when the popup opens | Allowed: clicking the extension's icon is the click C-2 asks for, and nothing leaves the device until Add or Save. The store listing, permission reasons and `/privacy` are rewritten in this release to say so (AC-19). New decision T# records this reading of C-2. | Owner, 2026-11-20, after the spec review (B1). |
| Single purpose | "Save gifts and gift ideas from any page to GiftsAF" | Owner, 2026-11-20. Covers adding to your list and saving for a person as one purpose. |
| Where the product reader runs | In the popup. The in-page script returns only what the reader needs (JSON-LD scripts, `itemprop` elements, `meta` tags, `link[rel=canonical]`, Walmart's `__NEXT_DATA__`), not the whole page. ALL-10's reader moves to `packages/core`, exported from its own subpath `@gifts-af/core/store-page` with `"sideEffects": false`, so web pages that import budget maths don't pull in the parser; `MAX_PRICE_CENTS` moves with it. | **[Claude's call]**, revised after the spec review (S4). One reader, no round trip, no page sent to us. |
| Duplicate check | Two gifts are the same product when their match keys are equal. The saved link is the page's canonical link (`link[rel=canonical]`, else `og:url`, else JSON-LD `url`) when it's on the same site, else the page address, with ALL-10's tracking clean-up widened to campaign and session tokens (`_kx`, `mkt_tok`, `_hsenc`, `_hsmi`, `srsltid`, and similar). The match key: Amazon by product code (ASIN); otherwise host without `www.`, plus path without a trailing slash, ignoring the query string except variant parameters (`variant`, `sku`, `skuid`, `size`, `color`) and query product ids (`id`, `pid`, `productid`, `itemid`), any case. The key is computed by the database for every gift, including ones added on the website. | Owner, 2026-11-20: extra query-string values mustn't make the same product look different, but a different size, colour or query product id stays separate; website gifts are covered. |
| Amazon | Read specially: name from `#productTitle`, price from the core price element, product ID = the ASIN | Owner, 2026-11-20. Amazon has no standard product tags, and it's the most common store. |
| A likely duplicate | Ask before adding when there's no exact match but the same store has the same product ID or the same name. The page's product ID is stored with the gift so later adds can compare it. | Owner, 2026-11-20: links that differ in ways the rule can't see (mobile site, renamed slug, variant in the path) should prompt, not silently duplicate. |
| Photo storage | A public bucket, `list-photos`, path `{gift id}.jpg` (the gift's own random id, so no user or list id shows, and a deletion can only ever name the gift's own file), at most `list_photo_width_px` wide JPEG. Only the route uploads (no user insert or select policy; `image/jpeg` only; a `file_size_limit` ceiling). Deleted by the daily tick after the gift, list or account is removed (AC-9b). | Owner, 2026-11-20: accept that a photo's address keeps working after sharing is turned off or reset, until the gift is removed, which bends decision 43 for photos only. A product photo isn't sensitive and its address can't be guessed. |
| How the add is written | A new `lists.add_item` SQL function: takes the list's row lock (`for update`), creates the list if there is none under the same advisory lock key as `save_list_checked`, checks the exact and likely duplicates under that lock, enforces `MAX_ITEMS`, inserts at the top, and sets `updated_at = clock_timestamp()` so open tabs see a new version (T74). | Spec review S1. |
| Extension route | `POST /api/lists/items`, in the lists module, same pattern as `/api/captures` (bearer token, CORS for the extension's origin only; the CORS helpers move to `apps/web/lib`). Carries a shape version; refuses older shapes (AC-21). Ships to production before the extension build is submitted. Off switch: `extension_add_enabled` in `app_settings` (AC-20). | Spec review S5; E4, E7, E9. |
| Where "recent" comes from | The newest capture per person (`captures.created_at`) | **[Claude's call]**. Already stored; no new column. |

## Principles check

- **Simplest version?** Cut: picking a photo on the page, multiple lists, server-side reading, a photo editor. One new route, one SQL function, one bucket.
- **Hard-coded values?** New `app_settings` rows: `list_photo_width_px` (400), `list_photo_jpeg_quality` (80), `list_photo_max_bytes` (the route's size check; the bucket's `file_size_limit` matches it), `extension_add_enabled` (1). Recent people count (3) is layout, not a tunable: [Claude's call].
- **Product boundaries?** The route and `add_item` live in the lists module; the extension talks to it over HTTP. "Recent people" reads the concierge's people and captures from the extension under the user's own RLS, as the popup already reads people.
- **New personal data?** (T42) Three new things on a list that anyone with its share link can see: (1) a photo cropped from the user's screen, needed because stores block hotlinked photos; a crop can catch an overlay on the page (a cookie banner, a "Hi, Sam" bar), so the user sees the exact crop before adding and can switch it with ‹ ›; (2) the product link from the open tab, needed so the list owner's people can buy it; cleaned of tracking parameters and replaced by the page's canonical link when there is one, so campaign and session tokens aren't shared; (3) the page's product ID, needed for the likely-duplicate check, not shown to anyone. Events carry ids only (E6).
- **Docs and decisions:** a new T# for reading on open (C-2), the single purpose, and the shared reader in core; decision 43's photo exception; `apps/extension/README.md` store listing and `/privacy` (AC-19); `design/technical-design.md` §6.2 (extension); `design/operations.md` (the off switch and the photo cleanup); `design/ui.md` mock-up link.

## Plan

**Architecture:** the popup reads the product from slim page fragments with the shared reader in `@gifts-af/core/store-page`, crops the photo from one `captureVisibleTab` screenshot, and posts the add to a new lists route, `POST /api/lists/items`. The route uploads the photo with the service role to the public `list-photos` bucket and calls `lists.add_item`, which does the duplicate checks, the 500 limit and the list creation under the list's locks. An after-delete trigger queues removed photos, and the daily tick deletes them.

**Tech stack:** Supabase (migration, pgTAP, Storage), Next.js route handler, Vitest (core, web, extension), the extension's React popup.

### Global constraints

- Extension permissions stay `activeTab`, `scripting`, `storage` (AC-17). No content scripts, no host permissions.
- Nothing from the page leaves the device before Add or Save (AC-16).
- Settings are `app_settings` rows, never defaults in code (T23): `list_photo_width_px` 400, `list_photo_jpeg_quality` 80, `list_photo_max_bytes` 200000, `extension_add_enabled` 1. Check where lists reads settings (`appSettingInt`) and add the rows to the same table.
- Grants per T26(7): every new function names who may run it, and pgTAP checks the refusals.
- Events carry ids and outcomes only (E6).
- Copy is exactly the mock-ups' (approved 2026-11-20).
- New decision is **T77** (T76 is taken by ALL-125's PR). Before committing it, fetch `origin/main` and check the latest T# (parallel sessions).
- The route ships to production before the extension build goes to the store.

### Review focus

1. **Lazy-loaded and tiny images:** placeholders (1×1, `data:` sources, images under 120 px on a side) are never candidates. A page whose only images are placeholders shows "No photo" (Task 6 test).
2. **Prices the reader can't pin down:** sale and list price, or a range ("$20 – $40"). Take the offer price; a range gives no price and the "type it in" box (Task 1 test).
3. **Very long product names:** names over 300 characters are cut to 300 in the popup and stay editable; the server refuses anything longer (Task 3 and Task 7 tests).
4. **Pages that can't be captured** (`chrome://`, the Web Store): the popup shows "This page can't be captured" and neither the card nor the list breaks (Task 6 test).
5. **High-DPI screens and page zoom:** the crop scales by screenshot width ÷ `innerWidth`, so a 2× screen at 125% zoom crops the right box (Task 6 test).

### Task 1: Shared product reader in core (AC-1, AC-8b, AC-10)

**Files:** move `apps/web/modules/lists/lib/store-page.ts` (`readProductFromHtml`) → `packages/core/src/store-page/read.ts` (and its test); move `MAX_PRICE_CENTS` from `apps/web/modules/lists/lib/format.js` → `packages/core/src/store-page/limits.ts` and re-export it from `format.js` so `save-list.ts` and the components keep working. Create `packages/core/src/store-page/amazon.ts` and test. Modify `packages/core/package.json` (`"exports": { ".": "./src/index.ts", "./store-page": "./src/store-page/index.ts" }`, `"sideEffects": false`, dependency `node-html-parser` 7.0.1) and the lists module's imports.

**Interfaces:**
- Produces: `readProductFromHtml(html: string, pageUrl: string): PageProduct` with `PageProduct = { isProduct: boolean; name: string | null; priceCents: number | null; imageUrl: string | null; productId: string | null; canonicalUrl: string | null }`.
  - `isProduct` is true only with a product signal: JSON-LD `Product`/`ProductGroup`, a microdata `itemtype` ending `/Product`, `og:type` = `product`, or a `product:price:*` meta tag. Open Graph alone (Instagram, blogs) is not a product.
  - `productId` comes from JSON-LD `sku`, `gtin8|12|13|14`, `mpn` or `productID` (first present), else microdata of the same names.
  - `canonicalUrl` comes from `link[rel=canonical]`, else `og:url`, else JSON-LD `url`, kept only when its host matches the page's host ignoring `www.`.
- Produces: `readAmazonProduct(html: string, pageUrl: string): PageProduct | null` (owner, 2026-11-20): for Amazon hosts only, name from `#productTitle`, price from `.a-price .a-offscreen` inside `#corePrice_feature_div` (or `#apex_desktop`), product ID = the ASIN from the link; null elsewhere. `readProductFromHtml` calls it first on Amazon hosts.

- [ ] Move the existing tests with the file. One changes on purpose: a price range (`lowPrice` ≠ `highPrice`) now gives no price on the website too (recorded in T77); update that test.
- [ ] Write failing tests: a JSON-LD product with `sku` gives `productId`; a canonical link on another host gives `canonicalUrl: null`, and `www.`-only differences are kept; a sale and list price gives `offers.price`; a page with only `og:title` and `og:image` gives `isProduct: false`; an Amazon fixture (saved product page HTML, trimmed) gives its title, price and ASIN.
- [ ] Make them pass. Update the website's caller (`store-page-fetch.ts`) to the new import; its tests pass. Commit.

### Task 2: Link cleaning and the match key (AC-8)

**Files:** create `packages/core/src/store-page/link.ts` and test. Move ALL-10's `cleanStoreUrl` and tracking list here; `product-link.js` re-uses it.

**Interfaces:**
- Produces: `cleanLink(url: string): string` (drops the hash, `utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_eid`, `mc_cid`, `_kx`, `mkt_tok`, `_hsenc`, `_hsmi`, `srsltid`, `si`, `spm`, `ref_`); `matchKey(url: string): string` (Amazon: `amazon:<ASIN>`; else lower-case host without `www.` and `m.`, then the path without a trailing slash, then the kept parameters sorted, lower-case keys: variants `variant`, `sku`, `skuid`, `size`, `color`, and query product ids `id`, `pid`, `productid`, `itemid` (owner, 2026-11-20)); `storeHost(url: string): string` (lower-case host without `www.` and `m.`; `amazon` for every Amazon host).
- The same rules exist in SQL (Task 3). A shared fixture file, `packages/core/src/store-page/match-key-cases.json` (`[{ url, key, host }]`), is the single list of examples both test suites check.

- [ ] Failing tests from the fixture: `matchKey` is equal for `https://www.rei.com/product/123/yeti?ref=search` and `https://rei.com/product/123/yeti/`; equal for `m.walmart.com` and `www.walmart.com` paths; different for `?variant=1` vs `?variant=2` and for `product.aspx?id=1` vs `?id=2`; Amazon `/gp/product/B0X…` and `/dp/B0X…?th=1` are equal. `cleanLink` drops `mkt_tok` and keeps `variant` and `id`.
- [ ] Make them pass; the existing `product-link.test.js` still passes. Commit.

### Task 3: Migration: `add_item`, photos bucket, cleanup queue, recent people (AC-6 to AC-9d, AC-11, AC-20)

**Files:** create `supabase/migrations/<timestamp>_extension_add.sql`, `supabase/tests/extension_add.test.sql`, `apps/web/modules/lists/__tests__/add-item-db.test.ts` (races against local Supabase, the pattern of `fanout-db.test.ts`). Regenerate `packages/core/src/database.types.ts`.

**Interfaces (produces):**
- Columns on `lists.list_items` (expand-only, E7; the old app ignores them, so a Vercel rollback keeps working):
  - `product_id text` (≤ 128);
  - `has_photo boolean not null default false`: the photo is ours, at `list-photos/{id}.jpg`;
  - `match_key text` and `store_host text`, both **stored generated columns** from `product_url` (and `asin`) by the immutable SQL functions `lists.match_key(url text, asin text)` and `lists.store_host(url text)`, implementing Task 2's rules. Every gift gets them, including website gifts and existing rows (owner, 2026-11-20). Index on `(list_id, match_key)` and `(list_id, store_host)`.
- Bucket `list-photos`: public, `allowed_mime_types = {image/jpeg}`, `file_size_limit` 1 MB (a ceiling above `list_photo_max_bytes`; `design/operations.md` says the setting must stay below it). No policies on `storage.objects` for it.
- Table `lists.photo_deletions (path text primary key, queued_at timestamptz not null default now())`: RLS on, all revoked from `anon` and `authenticated`, no policies. An after-delete trigger on `list_items` (`security definer`, `search_path = ''`) queues `old.id || '.jpg'` when `old.has_photo`. The path comes from the row's id, never from user input, so nobody can queue someone else's file.
- Service-role only: `lists.queue_photo(p_item_id uuid)` (the route queues the path *before* uploading), `lists.take_photo_deletions(p_limit int, p_older_than interval) returns setof text`, `lists.forget_photo_deletions(p_paths text[])`.
- `lists.add_item(p_item_id uuid, p_name text, p_price_cents int, p_product_url text, p_product_id text, p_has_photo boolean, p_confirm_likely boolean, p_max_items int) returns table (outcome text, list_id uuid, item_id uuid, existing jsonb)`.
  - Same security mode, grants and advisory lock key (`'lists.save_list_checked:' || auth.uid()`) as `save_list_checked`. Granted to `authenticated` only.
  - The list is the user's oldest (`owner_id = auth.uid()` order by `created_at` limit 1, as `getMyList`), created if none, then locked `for update`.
  - `duplicate`: same `match_key`. `likely` (with `existing` = `{id, name, price_cents, image_url}`): same `store_host` and equal `product_id`, or equal names after `lower(regexp_replace(name, '[^[:alnum:]]+', '', 'g'))`; skipped when `p_confirm_likely`. `full`: at `p_max_items`.
  - `added`: inserts `p_item_id` at position 0 (shifting the rest), `source = 'extension'`, `image_url` = the photo's public URL when `p_has_photo`; deletes its `photo_deletions` row; sets `updated_at = clock_timestamp()`.
  - Name length and price range are already table constraints; nothing extra.
- `MAX_ITEMS` stays the one source in `save-list.ts`; the route passes it as `p_max_items`.
- `concierge.recent_people(p_limit int) returns table (person_id uuid)`: security invoker, granted to `authenticated` only; the user's non-deleted people ordered by their newest capture, limited.
- Settings rows from Global constraints.

- [ ] Failing pgTAP tests:
  - each outcome (added, duplicate, likely, likely then confirmed, full); the new gift is at position 0 with our `image_url`; `updated_at` moves;
  - a website-shaped insert through `save_list_checked` gets a `match_key`, and `add_item` reports it as `duplicate`; the `match_key-cases.json` examples give the same keys in SQL as in Task 2;
  - deleting an item, a list and a user queues `<id>.jpg` and nothing else; the queue can't be read or written by `authenticated`; a user's update to someone else's row is refused, and no update can change the queued path;
  - `anon` can't run `add_item` or `recent_people`; `authenticated` can't run the photo-queue functions;
  - a signed-in user can't insert into or list `list-photos`;
  - `recent_people` skips deleted people and orders by newest capture.
- [ ] Failing race tests (local Supabase, 10 connections): two `add_item` calls for the same product add one gift; `add_item` and `save_list_checked` creating a first list at once leave one list; `save_list_checked` with the version read before an `add_item` gets `GL409`.
- [ ] Write the migration; run them with the rolled-back pgTAP script and `pnpm --filter web test add-item-db`. All pass.
- [ ] Commit.

### Task 4: Photo cleanup on the tick (AC-9b)

**Files:** create `apps/web/modules/lists/lib/photo-cleanup.ts` and test; export from `modules/lists/index.ts`; modify `apps/web/app/api/rounds/tick/route.ts` to run it after `runTick`, in its own try/catch so a failure never affects rounds.

**Interfaces:** `removeDeletedPhotos(db: SupabaseClient<Database>): Promise<{ removed: number }>`: takes up to 500 paths queued more than an hour ago (so an add still in flight isn't touched), removes them from `list-photos` through the Storage API (a missing file counts as removed), then forgets them. A failed remove forgets nothing (tomorrow retries) and logs `list.photos_left` with the count.

- [ ] Failing tests with a fake client: removes then forgets; a remove error forgets nothing and throws; no paths does nothing. The tick route test: a cleanup that throws still returns the tick's result.
- [ ] Make them pass. Commit.

### Task 5: The extension route (AC-6, AC-9c, AC-18, AC-20, AC-21, AC-22)

**Files:** move `apps/web/app/api/captures/http.ts` → `apps/web/lib/extension-http.ts` (allow-methods unchanged); create `apps/web/app/api/lists/items/route.ts` and test; `apps/web/modules/lists/lib/extension-add.ts` and test (the logic, store-injected like captures). Add the path to the proxy's public list (`lib/supabase/proxy.ts`) and its test.

**Interfaces:**
- Request: multipart with `v` = `1`, `name`, `priceCents`, `pageUrl`, `canonicalUrl?`, `productId?`, `confirmLikely?` (`1`), `photo?` (JPEG ≤ `list_photo_max_bytes`). No store image link: the server doesn't need it (T42).
- Response: `201 { outcome: "added", itemId }`; `200 { outcome: "duplicate" }`, `{ outcome: "likely", existing: { name, priceCents, imageUrl } }` or `{ outcome: "full" }`; `401` sign in again; `400 { error: "Update the GiftsAF extension." }` when `v` isn't `1`; `503 { error: "Adding from the extension is paused." }` when `extension_add_enabled` ≠ 1 (read in the route with `appSettingInt`, not in SQL).
- Produces: `addFromExtension(store: ExtensionAddStore, input: ExtensionAddInput): Promise<ExtensionAddResult>`. The link saved is `cleanLink(canonicalUrl ?? pageUrl)`. The route makes the item id, calls `queue_photo(id)`, uploads to `list-photos/{id}.jpg` with the service client, then runs `add_item` with the user's token (which removes the queue row only when `added`). Any other outcome or an error deletes the upload straight away; a crash leaves the queue row, and the tick deletes it after an hour (AC-9c).

- [ ] Failing tests: each outcome above; a non-JPEG or oversize photo is refused before anything is queued; the order is queue, upload, add; a duplicate deletes the upload; a thrown `add_item` deletes it and logs `list.extension_add` with `outcome: "failed"`; the event never contains the name or link (assert on the logged object's keys); CORS headers only for the extension's origin; `getMyList` and the shared list return the stored photo's public URL for an added gift (AC-6).
- [ ] Rename `allowedOrigin`'s log message from "capture routes" to "extension routes".
- [ ] Make them pass; the captures route's tests still pass after the helper move. Commit.

### Task 6: Reading the page in the popup (AC-1 to AC-5, AC-10, AC-11, AC-16)

**Files:** modify `apps/extension/src/lib/page.ts` (and its test), `apps/extension/src/popup/load.ts`; create `apps/extension/src/lib/photo.ts` and test.

**Interfaces:**
- `type ProductPage = { product: PageProduct; pageUrl: string; screenshot: Blob; candidates: PhotoBox[]; viewportWidth: number }`.
- `readProductPage(tabId: number): Promise<ProductPage>`: one `executeScript` returns only what the reader uses, rebuilt into a small HTML string for `readProductFromHtml`: the `script[type="application/ld+json"]` texts; flat microdata records for the props the reader reads (`name`, `price`, `priceCurrency`, `image`, `sku`, `gtin*`, `mpn`, `productID`; each as prop, `content`, `src`, `href`, text capped at 300 characters) plus the `itemtype` values; `meta` tags; `link[rel=canonical]`; Walmart's `#__NEXT_DATA__`; and on Amazon hosts `#productTitle` and the core price element's text. Also the boxes of `img` elements at least 120 px on both sides, more than half visible, not `data:` sources, and the viewport width. Then one `captureVisibleTab`.
- `PhotoBox = { src: string; x: number; y: number; width: number; height: number }` in CSS pixels, clipped to the viewport.
- `orderCandidates(boxes: PhotoBox[], productImageUrl: string | null): PhotoBox[]`: the box whose `src` matches the product image first (same path, ignoring the query), then by area, largest first.
- `cropPhoto(screenshot: Blob, box: PhotoBox, scale: number, widthPx: number, quality: number, deps?: { encode: EncodeCrop }): Promise<Blob>`: `scale` = screenshot width ÷ viewport width; output at most `widthPx` wide, JPEG at `quality`. `encode` defaults to `OffscreenCanvas`/`createImageBitmap` and is injected in tests (jsdom has neither), like `fitScreenshot`. Tests check the source rectangle and output size passed to `encode`.
- `loadPopup` adds `recentPeople: Person[]` (from `recent_people(3)`, padded alphabetically), `photoWidthPx`, `photoJpegQuality`, and `page: ProductPage | null` (null when not capturable or the read fails).

- [ ] Failing tests: `orderCandidates` puts the product image first; a 1×1 and a `data:` image aren't candidates; `cropPhoto` with `scale` 2.5 crops the box at 2.5× (fake canvas); `loadPopup` on a non-capturable tab returns `page: null` with the people still loaded; `recentPeople` keeps the RPC's order and pads alphabetically.
- [ ] Make them pass. Commit.

### Task 7: Popup screens (AC-3 to AC-5, AC-8, AC-8b, AC-10 to AC-15, AC-18)

**Files:** create `apps/extension/src/popup/ProductCard.tsx`, `RecentPeople.tsx`, `PeopleScreen.tsx`, `AddResult.tsx`, `SuccessBanner.tsx`, tests for each in `popup/__tests__/`; modify `App.tsx`, `Learned.tsx`, `CaptureForm.tsx`, `styles.css`, `lib/upload.ts` (`addToMyList(token, input): Promise<AddResponse>`).

**Interfaces:** `ProductCard` props `{ page, photoIndex, onPhotoIndex, name, onName, price, onPrice, busy, onAdd }`; App state keeps the card's edits when the people screen opens and returns (AC-13). Names over 300 characters are cut to 300 when the card fills in.

- [ ] Failing component tests, one per state in the mock-ups: card filled; ‹ › changes "n of m" and the photo sent; empty price focuses the box and disables Add; no product shows the line and the full list; recent people buttons and "Someone else…"; Back keeps edits; Added, Already, Likely ("Add anyway" resends with `confirmLikely`, "Don't add" returns to the card), full; each capture outcome starts with "Saved to {name}" and shows its text and both buttons; a 401 on Add shows sign-in; a 404 or 503 on Add shows "Adding from the extension is paused" (covers a Vercel rollback after the store build is live). The pinned layout (AC-12) is checked by hand in Task 9, since jsdom doesn't load the styles.
- [ ] Make them pass. `pnpm --filter extension test` and `typecheck` pass. Commit.

### Task 8: Copy, docs and decisions (AC-17, AC-19)

**Files:** `apps/extension/README.md` (store listing: summary, description, single purpose, permission reasons), `apps/extension/src/manifest.ts` (description "Save gifts and gift ideas from any page to GiftsAF"; version 0.2.0) and its test, `apps/web/app/privacy/page.tsx` (the extension paragraph), `design/decisions.md` (T77: reading on open under C-2, the single purpose, the shared reader in core, the photo exception to decision 43), `design/technical-design.md` §6.2, `design/operations.md` (the off switch, photo cleanup, release order), `design/ui.md` (mock-up link).

- [ ] Manifest test: permissions are exactly `activeTab`, `scripting`, `storage`; description as above.
- [ ] Update the copy so the listing and `/privacy` say the same thing. Commit.

### Task 9: Hand checks, release order and the gallery

- [ ] Build the extension (`pnpm --filter extension build:dev`), load it unpacked against local or dev, and check by hand: a Walmart, Target and Amazon product page (card, photo, add, duplicate, likely), a page at 125% zoom, a non-product page, a long people list where only the names scroll (AC-12), the popup stays open after Add and Save (AC-15; fix it here if it closes).
- [ ] Gallery: add the popup states to `pnpm gallery` if the extension is covered there; otherwise screenshots of the built popup go on the ticket.
- [ ] After merge and the migrate job: check the route on production with the switch on, then build and submit the store package (`pnpm --filter extension package`). ALL-137's checks run on this submission.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task: AC-1 T1/T6, AC-2 to AC-5 T6/T7, AC-6 to AC-9d T3/T5, AC-9b T4, AC-10 to AC-14 T6/T7, AC-15 T9, AC-16 T6, AC-17 T8, AC-18 T5/T7, AC-19 T8, AC-20 to AC-22 T3/T5.
- [x] Every task traces back to a criterion.
- [x] No open questions are left.
- [x] Adversarial review of the plan done (2026-11-20): 4 blockers and 9 should-fixes folded in; owner answered query ids, Amazon and website gifts.
