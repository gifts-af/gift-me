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

Written after the spec's adversarial review.
