# ALL-93 Saved gifts for someone: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a buyer can keep gifts they've spotted for someone (like Dad, who has no GiftsAF list) on that person's page, and only that buyer ever sees them.

**Links:** [ALL-93](https://linear.app/allens-forever/issue/ALL-93) · planning decision 54 (revises 52, narrows 48) · decisions 39, 50 · [ALL-27 plan](ALL-27-idea-engine.md) (ideas made on demand) · ALL-77 (linking) · mock-up: posted on the ticket.

**Rescoped 2026-11-16 (owner).** The ticket began as "a private list that is a real list in the lists product, which you can later link to theirs" (decision 52). The owner dropped the linking half: your saved gifts are your own surprise ideas, and showing them to the person's other buyers would make them read as things the person asked for, and let someone else buy your surprise. Once nothing is ever shared, a real list (with its share link, claims and "my list" rules to guard) isn't needed. Saved gifts are a small table in the concierge instead.

## Spec: what it does

### Who it's for and what they can do

1. **Save a gift I spotted:** as a buyer, on Dad's page, I can paste a link to a gift, or type one in by hand, and it's kept under "Saved gifts", so it's there when his birthday comes.
2. **Only me:** as a buyer, I know nobody else ever sees my saved gifts: not Dad, not his other buyers, not anyone with a link, not even after Dad joins and I link his own list.
3. **Tidy up:** as a buyer, I can open a saved gift's store page, and remove a saved gift.
4. **No link needed:** as a buyer, Dad's page makes it clear I don't need his list link to buy for him. Today "Paste the link they shared" reads as if one is required.

"Save" on an idea the engine suggested is ALL-128, blocked by ALL-27 and this ticket (see Out of scope).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A buyer on their person's page | The page loads | A "Saved gifts" section shows "Only you see these", a link box, name and price fields, and Save. With none saved, one line says what it's for |
| AC-2 | A pasted link | The buyer pastes it | Name, price and photo are filled in where the link can be read: Amazon gives the name and photo from the link (the buyer types the price), other stores go through the server's page read (decision 50). Whatever can't be read, the buyer types. Nothing is saved until they tap Save |
| AC-3 | No link | The buyer types a name and price and taps Save | The gift is saved with no link |
| AC-4 | A saved gift | The buyer reloads the page | It's still there, newest first, with photo, name, price and the store's name (worked out from the link) |
| AC-5 | A saved gift with a link | The buyer taps it | The store page opens in a new tab |
| AC-6 | A saved gift | The buyer taps remove | It's gone after a reload |
| AC-7 | A save that fails (the cap, a bad price, the network) | The buyer taps Save | A plain message shows, and what they typed stays in the form. Nothing claims it was saved |
| AC-8 | Another signed-in user (including the person, once they've joined and their list is linked), or a signed-out visitor | They try to read, add, change or remove the buyer's saved gifts through the API, including saving against someone else's person | Every attempt is refused or returns nothing (pgTAP as another user and as anon) |
| AC-9 | Rows written straight to the API, skipping the app | A script inserts | The database itself enforces the cap (`saved_gifts_max` from `concierge.app_settings`, T23), the length and price limits, and `http(s)` links only. Nobody can update a row (editing is out of scope) |
| AC-10 | A person is soft-deleted, then hard-deleted | — | Saving against a soft-deleted person is refused. Their saved gifts don't show (the page is a 404) and go with the person on hard delete (`(person_id, user_id)` foreign key, cascade) |
| AC-11 | The person page's list section | The page loads with no list linked | It's titled "Link to their list" and says a link isn't needed to buy for them |
| AC-12 | Saving or removing | It happens | One `saved_gifts.save` / `saved_gifts.remove` event with the user and person ids only, never the gift's name or link (E6) |

### Out of scope

| What | Where |
|---|---|
| **"Save" on an idea the engine suggested** | **ALL-128**, blocked by ALL-27 and this ticket (owner, 2026-11-16). Notes for it: `gift_ideas` has no photo column, so copy title, price, link and store; on-demand ideas are deleted and re-made on every run, so match "Saved" on `retailer_product_id`, unique per buyer and person when not null, which also stops double taps |
| Rounds buying from saved gifts, or offering them as picks | Later, with its own ticket. Typed and page-read prices aren't checked, so a round must re-check any saved gift's price before using it (carried from 52 into 54) |
| Sharing saved gifts with anyone, or joining them to the person's own list | Never (decision 54). ALL-77 loses that half |
| Saved gifts on the Home card | Not needed now **[Claude's call]** |
| Editing a saved gift | Remove and re-add. Later if people ask |
| A limit on how often a buyer can make the server read store pages | ALL-90, same as My list |

### Open questions

None left.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| A real list, or saved gifts? | Saved gifts in a concierge table | Owner, 2026-11-16 (decision 54). Nothing is shared, so the lists product's share link, claims and "my list" rules would only be risks to guard |
| Who sees them? | Only the buyer who saved them. Mom and you each keep your own for Dad | Carried over from 52's **[Claude's call]**, plain in 54 |
| Its own table, or Jim's `gift_ideas`? | Its own: `concierge.saved_gifts` **[Claude's call]** | ALL-27 deletes a person's previous on-demand ideas on every run, and is reworking that table now |
| Reuse My list's paste box (`AddGiftPanel`)? | **No.** A small form of the concierge's own **[Claude's call]** | Its `onAdd` is fire-and-forget: it clears the form and says "Added" before anything is saved, which only works on My list because a separate Save button persists the list. Changing it means changing Jim's lists component. The new form saves for real and keeps the input on failure (AC-7) |
| How is a link read? | One new server-side export from `@/modules/lists`, `readGiftLink(url)`, that wraps what My list already uses (`lookupProductLink` for Amazon, `lookupStorePage` for other stores) and returns name, price, photo and a clean link **[Claude's call]** | One way to read a link (E2), through the lists module's public interface (T19). No list component changes. Called from a server action in `app/people/actions.ts`, so no client code imports the lists barrel |
| Where are the rules enforced? | In the database: check constraints for lengths, price and `http(s)` links; a before-insert trigger for the cap via `concierge.setting_int('saved_gifts_max')`; select, insert and delete policies for the owner only, and no update grant. The server action also refuses a soft-deleted person | Default privileges let any signed-in user write new concierge tables through the API, so checks only in the action would be skipped by a script (E4, T26) |
| A cap on how many? | `saved_gifts_max` = 100 per person **[Claude's call]** | Stops a runaway script filling a table. Far above real use |
| Store name stored? | No: worked out from the link with `storeName()` | One less field to keep in sync (E2) |
| Do rounds use them? | No, not in this ticket | Owner, 2026-11-16 |
| "Save" on an idea: here, or its own ticket? | Its own, ALL-128, blocked by ALL-27 and this ticket. ALL-93 closes when saved gifts ship | Owner, 2026-11-16. Keeps the button tracked without holding this ticket open |
| Decision 48 place 3: will engine ideas still show to you next to a linked person's own list (ALL-77)? | Yes, to you only. 54 drops only showing anything to the person's other buyers **[Claude's call]** | Place 3 was always "which they never see"; sharing with other buyers came in with 52 |

## Principles check

- **Simplest version?** One table, one section, one small form. Cut: a list page, share links, editing, Home card changes, rounds, and reworking My list's paste box.
- **Hard-coded values?** `saved_gifts_max` in `concierge.app_settings`.
- **Product boundaries?** The concierge calls one new server-side export, `readGiftLink`, from `@/modules/lists`. No list tables are read or written, and no lists component changes.
- **New personal data?** The gift's name, price, photo and link, which the buyer typed or pasted for this feature. Not sent anywhere except the store page read that My list already does. Events carry ids only.
- **E9:** seen working on production by a live check (save, reload, remove, as the production test account). Turned off with Vercel's instant rollback: no money moves, and the table is harmless left behind.
- **Collisions with ALL-27:** both touch `person-view.tsx`, `app/people/actions.ts`, `database.types.ts`, and add a migration. Saved gifts stay one line in `person-view.tsx`. ALL-27's migration (dated 2026-11-15 in its plan) is already earlier than `main`'s latest (2026-11-16), so it needs a later timestamp whichever merges first; told Jim on ALL-27.
- **Docs and decisions:** planning decision 54 (done, including 48, 52's price re-check and place 3), `planning/strategy.md` (done), `design/technical-design.md` (the table), `design/ui.md` if the section adds a pattern. ALL-27's plan still says "Add to private list"; Jim updates it in his own ticket (comment posted).

## Plan

**Architecture:** a new `concierge.saved_gifts` table holds the rules itself: owner-only policies, no updates, checks and a cap trigger. A small `modules/concierge/saved-gifts/` folder (rules, store, service, bound wrapper) reads and writes it as the signed-in user. It sits beside `people/` rather than inside it, so ALL-27's edits to the people files don't collide. The person page gets one `<SavedGifts>` section. Reading a pasted link goes through one new server-side export from `@/modules/lists`.

**Tech stack:** Postgres migration and pgTAP; Next.js server actions; a React client component; Vitest; one Playwright journey.

**Global constraints**
- Setting `saved_gifts_max` = `100` in `concierge.app_settings` (T23). No fallback constant in code.
- Limits, in the database and mirrored in the form parser: name 1–200 characters; `product_url` and `image_url` at most 2048 characters and starting `http://` or `https://`; `price_cents` null or 0–10,000,000.
- Price is optional **[Claude's call]**: a spotted gift may have no known price. It shows as "No price".
- Copy: heading "Saved gifts"; note "Only you see these. {name} never does."; empty state "Keep gifts you spot for {name} here."; button "Save"; the list section's note "You don't need their list to buy for them."
- Events: `saved_gifts.save` and `saved_gifts.remove`, with `user_id` and `person_id` only (E6).
- Migration file `supabase/migrations/20261116120000_saved_gifts.sql`, renamed later than `main`'s latest if needed when this merges.

### Task 1: the table and its rules (AC-8, AC-9, AC-10)

**Files:** create `supabase/migrations/20261116120000_saved_gifts.sql` and `supabase/tests/saved_gifts.test.sql`; regenerate `packages/core/src/database.types.ts` (`pnpm db:types`).

**Produces:** `concierge.saved_gifts (id uuid pk default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, person_id uuid not null, name text not null, price_cents integer, product_url text, image_url text, created_at timestamptz not null default now(), foreign key (person_id, user_id) references public.people (id, user_id) on delete cascade)`, with an index on `(person_id, created_at desc)`.

- [ ] **Step 1: pgTAP first.** In `saved_gifts.test.sql` (pattern: `supabase/tests/person_links.test.sql`), with users buyer, other and dad:
  - buyer inserts a gift for their person: lives_ok; reads it back: 1 row.
  - other selects buyer's rows: 0 rows. Other's delete of buyer's row removes nothing. Other inserting with buyer's `person_id` throws.
  - `tests.act_as_anon()` select throws permission denied.
  - dad, after buyer links dad's list with `lists.link_person` as in `person_links.test.sql`, reads 0 rows.
  - buyer's `update` of their own row throws permission denied.
  - a 201-character `name`, `product_url` `javascript:alert(1)` and `price_cents` -1 each throw a check violation.
  - with `saved_gifts_max` set to 2 for the test, a third insert for the same person throws with message `saved_gifts_max`; a gift for a second person still saves.
  - after `public.delete_person` and a hard delete of the person row as server, the gifts are gone.
- [ ] **Step 2:** `pnpm db:test` fails (no table).
- [ ] **Step 3: the migration.** The table, with check constraints from Global constraints. Row level security on, and three policies written by hand (select, insert, delete, each `user_id = (select auth.uid())`). Don't use `concierge.enable_owner_rls`: it adds an update policy and an `updated_at` trigger. `revoke update on concierge.saved_gifts from authenticated`. A `before insert` trigger function `concierge.saved_gifts_cap()` (`security definer`, `set search_path = ''`, execute revoked from public) raises `'saved_gifts_max'` with errcode `P0001` once the person already has `concierge.setting_int('saved_gifts_max')` rows. Insert the setting row with a description.
- [ ] **Step 4:** `pnpm db:test` passes; run `pnpm db:types`.
- [ ] **Step 5:** commit `feat(db): saved gifts table, private to the buyer (ALL-93)`.

### Task 2: reading a gift link, from the lists module (AC-2) [P]

**Files:** create `apps/web/modules/lists/lib/gift-link.ts` and `apps/web/modules/lists/lib/__tests__/gift-link.test.ts`; modify `apps/web/modules/lists/index.ts` (one export).

**Produces:** `readGiftLink(url: string, readPage: (url: string) => Promise<LookupStorePageResult | { ok: false; reason: "signed_out" }>): Promise<GiftLinkRead>`, where `GiftLinkRead = { ok: true; name: string | null; priceCents: number | null; imageUrl: string | null; productUrl: string } | { ok: false; error: string }`. Exported from `@/modules/lists` with its type. The caller passes `readStorePage` from `actions/store-page.ts` as `readPage` (E3).

- [ ] **Step 1: tests.**
  - An Amazon link `https://www.amazon.com/Fly-Reel/dp/B0TESTREEL` gives `productUrl` `https://www.amazon.com/dp/B0TESTREEL`, a name from the slug, a null `priceCents` and an image URL. `readPage` is never called.
  - A store link whose `readPage` returns `{ ok: true, product: { name: "Mug", priceCents: 1200, imageUrl: "https://x/i.jpg" } }` gives those three values.
  - A store link whose `readPage` returns `{ ok: false, reason: "blocked" }`, or throws, still gives `ok: true` with the slug name and a null price.
  - `"not a link"` gives `ok: false` with `lookupProductLink`'s message.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement with `lookupProductLink`, overlaying the page's non-null fields as `AddGiftPanel`'s `withStorePage` does.
- [ ] **Step 4:** the tests pass.
- [ ] **Step 5:** commit `feat(lists): read a gift link for other modules (ALL-93)`.

### Task 3: the saved-gifts service (AC-3, AC-6, AC-7, AC-10, AC-12)

**Files:** create `apps/web/modules/concierge/saved-gifts/{rules,store,service,saved-gifts}.ts`, `apps/web/modules/concierge/__tests__/saved-gifts.test.ts` and `apps/web/modules/concierge/__tests__/fake-saved-gifts-store.ts`; modify `apps/web/modules/concierge/index.ts` (exports).

**Produces (from `@/modules/concierge`):**
- `type SavedGift = { id: string; name: string; priceCents: number | null; productUrl: string | null; imageUrl: string | null; store: string | null }`, where `store` is the link's hostname without `www.`.
- `parseSavedGiftForm(formData: FormData): { ok: true; value: SavedGiftInput } | { ok: false; error: string }`, with fields `name`, `price` (via `parseBudget`), `link` and `image`.
- `listSavedGifts(personId: string): Promise<SavedGift[]>`, newest first; `[]` for a person who isn't the caller's.
- `saveGift(personId: string, input: SavedGiftInput): Promise<SaveResult>` and `removeSavedGift(personId: string, giftId: string): Promise<SaveResult>`.

- [ ] **Step 1: tests**, against the fake store.
  - `parseSavedGiftForm`: an empty name gives "Give the gift a name."; price "abc" gives `parseBudget`'s error; link `ftp://x` gives "That link doesn't look right."; a 201-character name gives an error.
  - `saveGift` for a person the store doesn't return (another user's, or soft-deleted) gives `{ ok: false }` with the people module's not-found text, and nothing is stored.
  - `saveGift` when the store throws `{ message: "saved_gifts_max", code: "P0001" }` gives "You've saved as many gifts for them as we keep. Remove one to add another."
  - `saveGift` and `removeSavedGift` each log exactly one event, whose fields are `{ user_id, person_id }` only.
  - `removeSavedGift` for a gift that's already gone returns ok.
  - `listSavedGifts` maps `www.amazon.com` to store `amazon.com`, and a null link to a null store.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement. Before inserting, the store checks the person with `people.select("id").eq("id", personId).is("deleted_at", null)` (AC-10).
- [ ] **Step 4:** the tests pass.
- [ ] **Step 5:** commit `feat: saved gifts service (ALL-93)`.

### Task 4: the Saved gifts section and the list wording (AC-1–7, AC-11)

**Files:** create `apps/web/app/people/[id]/saved-gifts.tsx` and `apps/web/app/people/[id]/__tests__/saved-gifts.test.tsx`; modify:
- `apps/web/app/people/actions.ts`: three actions.
- `apps/web/app/people/[id]/person-view.tsx`: load the gifts, and render the section just above `<ListLink>`.
- `apps/web/app/people/[id]/list-link.tsx` and its test: the note under the heading when no list is linked.

**Consumes:** Task 2's `readGiftLink` and Task 3's functions.
**Produces:** `readGiftLinkAction(url: string): Promise<GiftLinkRead>`, which wraps `readGiftLink(url, readStorePage)`; `saveGiftAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult>`; and `removeSavedGiftAction(_prev: SaveResult | null, formData: FormData): Promise<SaveResult>`. Each revalidates the person page, as `refresh()` does.

- [ ] **Step 1: component tests**, with fake actions as in `list-link.test.tsx`.
  - With no gifts: the heading, the privacy note with the name, and the empty-state line.
  - Pasting a link calls `readAction` and fills in the name and price. A failed read leaves a typed name alone.
  - Save returning `{ ok: false, error: "x" }` shows "x" in a `role="alert"` and keeps the name and price in the fields (AC-7).
  - Save returning `{ ok: true }` clears the form. A second click while saving doesn't call the action twice.
  - A gift with a link renders a link to `productUrl` with `target="_blank"` and `rel="noopener noreferrer"`. Remove calls `removeAction` with the gift's id.
  - `ListLink` with no list linked shows "You don't need their list to buy for them."
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3:** implement with `Input` and `Button`, in the card style of the person form. Format money with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`. Show the photo as a plain `<img alt="">`, like the gift cards. Read the inputs from `FormData` on submit, as `list-link.tsx` does, so a paste before hydration isn't lost.
- [ ] **Step 4:** the tests pass.
- [ ] **Step 5:** commit `feat: Saved gifts on a person's page (ALL-93)`.

### Task 5: the journey, layout and docs (AC-1–6, AC-11)

**Files:** modify `apps/web/e2e/people.spec.ts`; `apps/web/e2e/gallery.shots.ts` if the person page shot needs a saved gift; `design/technical-design.md` (the table among the concierge's tables, and decision 54); and `design/ui.md` only if the section adds a pattern.

- [ ] **Step 1:** in `people.spec.ts`, add the test "save a gift for someone, then remove it":
  1. A fresh user with `addMother`. Wait for Save to be enabled before typing (ALL-110).
  2. Paste `https://www.amazon.com/Fly-Reel/dp/B0TESTREEL` and check the name fills in. Type price `49` and Save.
  3. Add "Coffee sampler" by hand, with price `20`.
  4. Reload. Both show, newest first, with "$49.00". The reel's link has the `href` `https://www.amazon.com/dp/B0TESTREEL`.
  5. Remove the sampler and reload. It's gone.
- [ ] **Step 2:** the existing `@layout` test adds a saved gift with a 120-character name before checking the person page, so `phoneLayoutProblems` covers the section on all three browsers.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass, as do `pnpm db:test` and the e2e specs. Run `pnpm gallery`, then republish the screens page.
- [ ] **Step 4:** update the docs, then commit `test: saved gifts journey, and docs (ALL-93)`.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task:
  - AC-1–7: Tasks 4 and 5
  - AC-2: also Task 2
  - AC-8–10: Task 1 (AC-10's soft delete is also in Task 3)
  - AC-11: Task 4
  - AC-12: Task 3
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.
- [ ] Adversarial review of the plan.

## Review focus

1. **A pasted link to one of our own pages, or to a private address.** `readStorePage` already refuses those (ALL-10's checks), and Task 2 goes through it, not around it.
2. **The same gift saved twice by a double tap.** Save is disabled while pending (Task 4 test).
3. **Removing a gift that's already gone,** from two tabs. `removeSavedGift` returns ok and the page refreshes (Task 3 test).
4. **A long name or a big photo breaking the phone layout.** Task 5's `@layout` check uses a 120-character name.
5. **A person deleted in another tab while the form is open.** Save returns the not-found error (Task 3 test).

## Done: evidence on the ticket (T44)

- [ ] Tests added, shown failing first, with suite and CI results.
- [ ] Screenshots of the section at phone width in light and dark mode and at desktop width, plus the mock-up.
- [ ] Live check on production with the test account: save, reload, remove.
- [ ] Every acceptance-criteria box ticked, each with a pointer to its evidence.
