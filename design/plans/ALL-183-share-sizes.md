# ALL-183 Share your sizes and favorite color: Spec and Plan

> **Status:** spec approved by the owner 2026-11-26 (scope-freeze exception), spec and plan reviewed adversarially and fixed. Building starts after the owner's family test.

**Goal:** someone with a list saves their sizes once, and a person claiming a gift from that list sees the sizes that fit that gift, so they buy the right option.

**Links:** [ALL-183](https://linear.app/allens-forever/issue/ALL-183). Pattern: [ALL-182](ALL-182-share-birthday.md) (T97). Related: T42, D31, `design/ui.md` principle 7.

## Spec: what it does

### Who it's for and what they can do

1. **Save and share:** as someone with a list, I can save my sizes and favorite color in Settings and choose which ones to share, so people buying for me pick the right size.
2. **See before buying:** as someone looking at a gift on a list, signed in or not, I see the owner's shared sizes that fit that gift, in "Going to buy it?" and in the claim box, before I buy or commit.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed in, with a list (or their list failed to load) | they open Settings | a "Sizes and favorites" row under You reads "Not added", "3 saved, none shared", "3 saved, 1 shared", "3 shared" (everything saved is shared) or "Couldn't load". With no list and nothing saved, there's no row. Sign-up never asks |
| AC-2 | the Sizes and favorites screen | it opens | seven optional boxes in this order: Shirt or top, Pants, Dress, Shoe, Ring, Hat, Favorite color, each with a Share switch. It says "Optional. Shared ones are shown to anyone with your list link when they go to claim a gift." |
| AC-3 | the screen | they fill boxes, flip switches and tap Save | all of it is saved in one upsert and "Saved" shows. Text is trimmed; a value is at most 30 characters, counted the same way by the form and the database, with no line breaks or control characters, refused in plain words. A Share switch is disabled while its box is empty, and emptying a box clears its value and its Share |
| AC-4 | a saved item | they turn Share off and Save | from then on nobody else can read it |
| AC-5 | "Going to buy it?" or the claim box opens on someone else's list, from its current link, with at least one shared item | it opens | a "<Name>'s sizes" panel (in "Going to buy it?", right after the sentence that names the gift; in the claim box, under the gift name) lists the shared items that fit the gift (AC-6) as "Label: value", joined by " · ". The name is the one the list heading uses, else "Their sizes". The sizes are fetched once, after the list page loads, so they're normally there before any box opens. A box that opens before they arrive shows no panel, rather than one that pushes things down. The fetch never delays the page, a box, the store link or the claim |
| AC-6 | the gift's name | the panel picks items | a whole-word, case-insensitive match, singular or plural (s/es), picks the size types the name is about (shoe: shoe, sneaker, boot, slipper, sandal, loafer, heel, cleat; top: shirt, tshirt, tee, sweater, sweatshirt, hoodie, jacket, coat, fleece, vest, blouse, polo, top, pullover, cardigan, pajama, onesie; pants: pants, jeans, trousers, shorts, leggings, joggers, chinos, sweatpants, skirt; dress: dress, gown; ring: ring; hat: hat, cap, beanie, beret). Favorite color always shows when it's shared. Phrases: "high", "hi", "low" or "mid" before "top", and "cap toe", count as shoe; "dress" before shirt, shoe or pants counts as that word, and before sock, belt, tie or watch matches nothing. A name that matches a kind shows only that kind's shared items plus favorite color (or nothing, when none of those kinds is shared). "Show all" happens only when no kind matches. A wrong hit narrows the list (a "Ring Light" shows ring size and color). A table of at least 30 real store names pins the behavior in a test |
| AC-7 | nothing shared, the feature off, the read failed, or the list is the viewer's own | either box opens | no panel, and both work as today. A failed read is logged |
| AC-8 | anyone | reads or writes the table | only their own row; anon gets nothing from the table. `lists.owner_sizes(p_token)` is granted to anon and authenticated. It returns only shared items, only for the list's current token, and nothing to the list's owner (`owner_id is distinct from auth.uid()`, so signed-out callers do get them). pgTAP calls it as anon, as a signed-in stranger and as the owner |
| AC-9 | the list page, its preview and `get_shared_list` | anyone opens them | no sizes in the page's HTML or data, or in the preview. The browser fetches them afterwards from a separate address. **The real boundary:** anyone holding the current token can read every shared item, because the function is public, as the Settings copy says. Resetting the link cuts them off |
| AC-10 | `list_sizes_enabled` or `list_link_card_enabled` isn't exactly 1 | a box or Settings opens | the function returns nothing. Settings hides the row unless something is saved; its screen then offers only Remove all, and saving is refused. A failed or missing setting counts as off |
| AC-11 | save, remove all, or a failed read | it happens | one event: the user id on save and remove, and the error code alone on a failed read (as `lists.owner_birthday_failed`). Never the token, a size or a label |
| AC-12 | the account is deleted, or the erase runbook runs | | its row goes. The runbook's step 1 deletes it straight away, without waiting for gifts in flight, and the runbook test covers it |

### Out of scope

The address (stays as it is). Sizes for people you buy for (the concierge's profile already has those). Free-form extra fields. Using AI to pick sizes. Telling the owner who saw them. Asking for sizes at sign-up or in tips.

### Open questions

None.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Which fields? | Shirt or top, pants, dress, shoe, ring, hat, favorite color; a fixed list | Owner: settings that help buy the right option. Adding one later is a small change. **[Claude's call]** the exact list, which the owner saw in the mock-up |
| Sharing? | A switch per item, off by default | Owner |
| Who sees shared items? | Anyone claiming from the list, signed in or not | Owner: family often claim without signing in |
| Where? | In "Going to buy it?" and the claim box | Owner, 2026-11-26, after the review showed people often buy before they claim |
| Forwarded links? | Anyone holding the link can read shared items with no sign-in, until the link is reset | Owner, 2026-11-26: sizes are low-risk and each is shared by choice |
| Which items show? | Keywords in the gift's name; favorite color always; all shared when nothing matches | Owner asked for "smart, else all". **[Claude's call]** keywords over AI: free, instant, the same every time, and a wrong guess only adds a line. The words are product logic, kept in code next to their tests, like the guided questions' categories |
| Address? | Left as it is | Owner |
| Free text or picklists? | Free text, 30 characters | **[Claude's call]** sizes vary too much ("34 x 32", "10.5 wide", "M or L") |
| Stored where? | `public.account_sizes`, one row per account: seven nullable text columns, and a Share boolean for each | **[Claude's call]** like `account_birthdays`; one row makes a save one upsert, so it can't half-succeed |
| When are sizes fetched? | Once per page visit, after the page loads, from a GET route, not a server action | **[Claude's call]** from the plan review: Next runs a tab's server actions one at a time, so a slow read could hold up a claim. Fetching early means the panel is ready when a box opens, so it can sit under the gift name without moving anything |
| Setting ships on? | Yes, 1 | **[Claude's call]** nothing shows until someone saves and shares something |

## Principles check

- **Simplest version?** One table, one read function, one Settings screen, one panel in the existing claim box. No AI, no picklists, no new email.
- **Hard-coded values?** `list_sizes_enabled` (setting). The 30-character limit is a column check, like other text limits. The keywords are product logic, not tunables.
- **Product boundaries?** Account data in `public`; the token read is `lists.owner_sizes` in the lists schema, called from the lists module only.
- **New personal data?** Up to seven short size or color values the person chose to enter, for the claim box now. Off by default, deleted on remove or with the account, never sent to a vendor, never logged. **Exposure, said plainly:** a shared item can be read by anyone holding the list link, because signed-out people can claim. The screen says so (AC-2).
- **Revises:** T42 (1) (asks people for their own sizes, optionally), T97's pattern (signed-out readers here, where the birthday needs sign-in).
- **E9:** `account_sizes.saved`, `.removed` and `lists.owner_sizes_failed` events. Live check with the QA account (share one size, open a claim box signed out, then remove it). Off: `list_sizes_enabled` = 0.
- **Docs:** next T# and product decision, `operations.md` > Erasing data step 1 and its runbook test, `ui.md` (screen and panel), `technical-design.md`, `operations.md` (setting), the privacy page, the database map, the screens page, and CLAUDE.md's exception line.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the spec's AC-1 to AC-12, in two PRs: the database (Task 1), then the app (Tasks 2 to 4).

**Architecture:** this copies ALL-182 (`account_birthdays`, `lib/account-birthday.ts`, `/settings/birthday`, `getOwnerBirthday`), with three changes: the read is open to anon; the browser fetches it once per page visit from a GET route (`app/share/[token]/sizes/route.ts`), after the page loads, never with the page and never through a server action (Next runs a tab's actions one at a time, so a slow read could hold up a claim); and the panel filters the items by gift name in the browser.

**Tech stack:** Supabase (migration, pgTAP), a Next.js 16 route handler and server actions (Settings only), React client components, Vitest, Playwright. Paths below are from the repo root; web commands run as `pnpm --filter @gifts-af/web test <path>`.

### Global Constraints

- Kinds, in this order, with these labels (form field names are the kind and `<kind>_shared`): `top` "Shirt or top", `pants` "Pants", `dress` "Dress", `shoe` "Shoe", `ring` "Ring", `hat` "Hat", `color` "Favorite color".
- A value is trimmed, 1 to 30 characters (`char_length`, and the form counts code points the same way, with `[...s].length`), with no character below U+0020 and no U+007F.
- Setting `list_sizes_enabled`, on only at exactly 1, shipped as `'1'`. The read also needs `list_link_card_enabled` = 1.
- Settings copy, exactly: "Optional. Shared ones are shown to anyone with your list link when they go to claim a gift."
- Panel: "<Name>'s sizes" (the name `shared-list.tsx` already computes as `name`), else "Their sizes". Items read "Label: value", joined by " · ".
- Events are `account_sizes.saved`, `account_sizes.removed` and `lists.owner_sizes_failed`. They carry ids and error codes only, never a token, label or value.
- Comments say why, without ticket ids (T86). Catch blocks around request data start with `unstable_rethrow`.

### Review Focus

1. A signed-out claimer on a phone must see the panel. Test it as anon in pgTAP (Task 1) and signed out in e2e (Task 4).
2. Plural, capitalised and hyphenated store names ("Women's Ankle BOOTS", "Graphic T-Shirt") must still match. Covered by the store-name table (Task 3).
3. A value with emoji, at exactly 30 code points, must pass both the form and the database. Tested in Task 1 and Task 2.
4. A box opened before the sizes arrive shows no panel and doesn't grow later; nothing you can tap moves. Component test (Task 3) and an `@layout` e2e with a delayed response (Task 4).
5. A reset link must stop the old token's reads. Covered in pgTAP (Task 1).

### Task 1: Database (AC-3, 4, 8, 9, 10, 12)

**Files:**
- Create: `supabase/migrations/<timestamp>_account_sizes.sql` and `supabase/tests/account_sizes.test.sql`
- Modify: `supabase/tests/app_settings.test.sql`, `packages/core/src/database.types.ts` (`pnpm db:types`), `design/database-map.html` and `apps/web/scripts/db-map/layout.json` (`pnpm db:map`, account lane next to `account_birthdays`), and `design/operations.md` > Erasing data step 1 plus `apps/web/test/erase-runbook-db.test.ts`

**Interfaces:**
- Produces: table `public.account_sizes(user_id uuid pk default auth.uid() references auth.users on delete cascade, top, pants, dress, shoe, ring, hat, color text null, top_shared … color_shared boolean not null default false, created_at, updated_at)`. A check on each value as in Global Constraints. A check that `<kind>_shared` implies `<kind> is not null`.
- Produces: `lists.owner_sizes(p_token uuid) returns jsonb`: an array of `{kind, value}` in kind order, shared items only, built with `cross join lateral (values (1,'top',s.top,s.top_shared), …) v(ord, kind, value, shared) where v.shared` and `jsonb_agg(… order by ord)`. It returns null for every "nothing" case (the owner, nothing shared, a switch off, an unknown token). It's `security definer` with `search_path = ''`, uses `owner_id is distinct from auth.uid()`, needs both settings, and is granted to anon and authenticated.

- [ ] **Step 1:** write pgTAP first.
  - The function as anon, as a signed-in stranger and as the owner (the owner gets null).
  - Unshared items are left out.
  - The old token returns null after a reset.
  - Either setting at 0 returns null.
  - Anon can't select from the table, and a user can't read another user's row.
  - Share without a value is refused.
  - 31 characters, a newline, or 30 emoji: refused, refused, accepted.
  - The cascade on account delete.
- [ ] **Step 2:** add the `list_sizes_enabled` key to `app_settings.test.sql`. Run `pnpm db:test` and expect it to fail.
- [ ] **Step 3:** write the migration. RLS policies copy `account_birthdays`; `revoke all … from anon`.
- [ ] **Step 4:** `pnpm db:test` passes. Then run `pnpm db:types` and `pnpm db:map`.
- [ ] **Step 5:** add `delete from public.account_sizes where user_id = …` to erase step 1, and assert in the runbook test that the row is gone after step 1. With the local stack running (the test skips without it), `pnpm --filter @gifts-af/web test test/erase-runbook-db.test.ts` passes.
- [ ] **Step 6:** commit, then open PR 1, `feat(db): sizes you can share from your list's link (ALL-183)`.

### Task 2: Settings (AC-1, 2, 3, 4, 10, 11)

**Files:**
- Create: `apps/web/lib/size-kinds.ts` (no imports: `SIZE_KINDS` and `SizeKind`, safe for the browser), `apps/web/lib/account-sizes.ts`, `app/settings/sizes/page.tsx`, `app/settings/sizes-form.tsx` and `app/settings/sizes-actions.ts`, with tests next to their birthday counterparts
- Modify: `app/settings/page.tsx` and `app/settings/rows.ts`

**Interfaces:**
- Produces, in `lib/size-kinds.ts`: `SIZE_KINDS`, the ordered `{ kind, label }` list from Global Constraints, and `type SizeKind`.
- Produces, in `lib/account-sizes.ts`:
  - `type MySizes = { status: "unavailable" } | { status: "loaded"; items: Record<SizeKind, { value: string; shared: boolean } | null> }`.
  - `getMySizes(db, userId): Promise<MySizes>`.
  - `parseSizesForm(form: FormData): { ok: true; row } | { ok: false; errors: Partial<Record<SizeKind, string>> }`.
  - `saveMySizes(db, userId, row)`, which is one upsert.
  - `removeMySizes(db, userId)`.
  - `sizesSharingOn(appSettingInt): Promise<boolean>`.
- Produces, in `rows.ts`: `sizesRowText(s: MySizes): string` and `showSizesRow(s, myList, on): boolean`.

- [ ] **Step 1:** write the failing tests.
  - `sizesRowText` gives "Not added", "3 saved, none shared", "3 saved, 1 shared", "3 shared" and "Couldn't load".
  - `showSizesRow` mirrors `showBirthdayRow`.
  - `parseSizesForm`: trims; refuses 31 code points and a newline; accepts 30 emoji; an empty box clears both value and share; Share with an empty box is dropped.
  - The form: Share is disabled while its box is empty, it shows the Settings copy exactly, and it shows "Saved" after the action succeeds.
  - The actions: each logs its one event with the user id only. With the feature off, save is refused and Remove all works; the page then shows only Remove all.
- [ ] **Step 2:** run `pnpm --filter @gifts-af/web test app/settings lib/__tests__/account-sizes.test.ts` and expect it to fail.
- [ ] **Step 3:** implement, copying the birthday screen's layout. The row goes under You, after Birthday, linking to `/settings/sizes`.
- [ ] **Step 4:** run the tests again and expect them to pass. Then commit.

### Task 3: The panel and the matching (AC-5, 6, 7, 9, 11)

**Files:**
- Create:
  - `modules/lists/lib/relevant-sizes.ts` and its test.
  - `apps/web/app/share/[token]/sizes/route.ts`: a GET that returns `getOwnerSizes(token)` as JSON with `Cache-Control: no-store`, importing it through `@/modules/lists`.
  - `modules/lists/components/sizes-panel.tsx` and its test.
- Modify:
  - `modules/lists/lib/lists.ts`, adding `getOwnerSizes(token)` beside `getOwnerBirthday`.
  - `modules/lists/index.ts`, exporting `getOwnerSizes`.
  - `modules/lists/components/shared-list.tsx`: unless the viewer owns the list, it fetches `/share/<token>/sizes` once after mount (an `AbortController` cancels it on unmount) and keeps the result in state.
  - `modules/lists/components/view-dialog.tsx` and `claim-dialog.tsx`: they take `sizes: SharedSize[] | null` and `ownerName`, and render `<SizesPanel>` under the gift name.

**Interfaces:**
- Consumes: `SIZE_KINDS` and `SizeKind` from `lib/size-kinds.ts` (Task 2), and `lists.owner_sizes` from Task 1.
- Produces:
  - `relevantSizes(giftName: string, shared: SharedSize[]): SharedSize[]`, where `type SharedSize = { kind: SizeKind; value: string }`.
  - `getOwnerSizes(token: string): Promise<SharedSize[]>`. It returns `[]` on a bad token, on null, or on an error (logged as `lists.owner_sizes_failed` with the code only). It checks the JSON: keeps entries whose kind is in `SIZE_KINDS` and whose value is a string, and drops the rest.
  - `<SizesPanel sizes name giftName />`, a pure component that renders `relevantSizes(giftName, sizes)`. Each box snapshots `sizes` when it opens: null or `[]` then means no panel for that opening, even if the fetch finishes later.

- [ ] **Step 1:** write `relevant-sizes.test.ts` as a table of at least 30 real store names and the kinds expected. It must include:
  - "Allbirds Wool Runners Sneakers" → shoe
  - "Women's Ankle BOOTS" → shoe
  - "Graphic T-Shirt" → top
  - "Men's Dress Shirt" → top
  - "Dress Shoes" → shoe
  - "Wrap Dress" → dress
  - "Levi's 501 Jeans" → pants
  - "Ring Video Doorbell" → ring (a wrong hit that's allowed)
  - "Wool Beanie" → hat
  - "Bambu Lab A1 mini 3D Printer" → no match, so all
  - "Rage Against the ML" → all

  Favorite color always comes back when it's shared, and the results keep `SIZE_KINDS` order.
- [ ] **Step 2:** write the component tests.
  - The panel shows "Aaron's sizes" and "Shoe: 10.5 · Favorite color: Green" for a sneaker.
  - It shows "Their sizes" when `name` is null.
  - It renders nothing for `[]` and for null.
  - A box opened with `sizes` null stays without a panel after `sizes` arrives.
  - ViewDialog and ClaimDialog both include it, under the gift name.
  - `shared-list`: one fetch per visit, none on your own list, and a failed fetch (rejected or non-200) leaves `sizes` null with no error shown.
  - `getOwnerSizes`: a bad token, a database error (logged, code only) and a malformed result each give `[]`.
- [ ] **Step 3:** run `pnpm --filter @gifts-af/web test modules/lists` and expect it to fail.
- [ ] **Step 4:** implement. Matching lowercases the name, splits on `/[^\p{L}\p{N}]+/u`, and tries each word as it is, without a trailing "s" and without a trailing "es". When "dress" is followed by a shirt, shoe or pants word, it counts as that word. The word lists are exactly AC-6's, plus "tshirt"; "t-shirt" splits into "t" and "shirt", so it matches through "shirt".
- [ ] **Step 5:** run the tests again and expect them to pass. Then commit.

### Task 4: Journey, docs and PR 2 (AC-1 to 11)

**Files:**
- Create: `apps/web/e2e/share-sizes.spec.ts`, plus a seed helper in `apps/web/e2e/seed.ts` that saves "Allbirds Wool Runners Sneakers" with a product URL ("Going to buy it?" needs one)
- Modify: `design/decisions.md` (next T#, "Revises T42 (1), T97"), `planning/decisions.md` (next number), `design/ui.md` (the screen and the panel), `design/technical-design.md`, `design/operations.md` (the setting), `app/privacy/page.tsx` (with its test), and `apps/web/e2e/gallery.shots.ts` (the Settings screen and the claim box with the panel)

- [ ] **Step 1:** write the e2e, using `createFreshUser`.
  - The owner saves a shoe size and a hat size, and shares only the shoe.
  - A signed-out visitor opens "Going to buy it?" on a sneaker gift and sees "Shoe: 10.5" but no hat.
  - The claim box shows the same.
  - Before any box opens, the page's HTML doesn't contain "10.5" (AC-9).
  - With Share turned off, the visitor sees no panel. Assert it after waiting for the `/sizes` response, so the check can't pass by being early.
  - `@layout`: the Settings screen at 320 px. And with `page.route` delaying `/sizes`, a box opened early has a Claim gift button that doesn't move once the response lands.
- [ ] **Step 2:** run `pnpm e2e e2e/share-sizes.spec.ts` (from `apps/web`) and expect it to pass. Then run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Step 3:** update the docs and privacy page, then run `pnpm gallery`.
- [ ] **Step 4:** commit, then open PR 2, `feat: share your sizes with people buying from your list (ALL-183)`, with `Closes ALL-183`. After it merges:
  - Live check with the QA account, signed out in a second browser.
  - Remove the QA account's sizes afterwards.
  - Republish the screens page.
  - Post the evidence on ALL-183.
