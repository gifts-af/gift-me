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
| Duplicate check | Two gifts are the same product when their match keys are equal. The saved link is the page's canonical link (`link[rel=canonical]`, else `og:url`, else JSON-LD `url`) when it's on the same site, else the page address, with ALL-10's tracking clean-up widened to campaign and session tokens (`_kx`, `mkt_tok`, `_hsenc`, `_hsmi`, `srsltid`, and similar). The match key: Amazon by product code (ASIN); otherwise host without `www.`, plus path without a trailing slash, ignoring the query string except variant parameters (`variant`, `sku`, `skuid`, `size`, `color`, any case). | Owner, 2026-11-20: extra query-string values mustn't make the same product look different, but a different size or colour stays a separate gift. |
| A likely duplicate | Ask before adding when there's no exact match but the same store has the same product ID or the same name. The page's product ID is stored with the gift so later adds can compare it. | Owner, 2026-11-20: links that differ in ways the rule can't see (mobile site, renamed slug, variant in the path) should prompt, not silently duplicate. |
| Photo storage | A public bucket, `list-photos`, path `{random id}.jpg` (no user or list id in the address), at most `list_photo_width_px` wide JPEG. Only the route uploads (no user insert or select policy; `image/jpeg` only; `file_size_limit`). Deleted by the daily tick after the gift, list or account is removed (AC-9b). | Owner, 2026-11-20: accept that a photo's address keeps working after sharing is turned off or reset, until the gift is removed, which bends decision 43 for photos only. A product photo isn't sensitive and its address can't be guessed. |
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

To be written after the spec review.
