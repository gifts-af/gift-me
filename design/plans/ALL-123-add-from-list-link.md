# ALL-123 Opening someone's list link offers "Add them to your people": Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** someone else's list looks the same and says whose it is wherever you open it, and from that one screen a signed-in buyer can add the owner to their people, link the list to someone they already have, or unlink it.

**Links:** [ALL-123](https://linear.app/allens-forever/issue/ALL-123) (owner's ticket, Jim's additions of 2026-11-18). Related: ALL-122 (find a list without a link, comes after this), ALL-55 (link previews), ALL-77. Product decisions 37, 39, 42, 43, 45. Technical design §"Picks from a person's own list". Code today: `apps/web/app/share/[token]/page.tsx`, `apps/web/modules/lists/components/shared-list.jsx`, `apps/web/app/people/[id]/list/page.tsx`, `apps/web/app/people/[id]/list-link.tsx`, `apps/web/app/people/[id]/person-view.tsx`.

## Spec: what it does

### Why

Linking someone's list is the best source of gifts (decision 37), but today it's hard to find and awkward to do:

- A buyer has to copy the share link, find the person's page, open the "Their list" row (which reads like a setting) and paste.
- The share page has no way to add or link the owner.
- A shared list shows the list's own title, which is "My list" by default, so a buyer reads "My list" on someone else's list.
- The person page's "Their list" screen is only a paste box; it never shows the gifts.

### Who it's for and what they can do

1. **One list screen:** as a buyer, when I open Sam's list from Sam's page or from a link Sam sent, I see the same screen, headed "Sam's list", with Sam's gifts and Claim buttons.
2. **Add from a link:** as a signed-in buyer opening a list link from someone not in my people, I can tap "Add Sam to your people", fill in the usual person form (name filled in), and end up with Sam as a person with this list linked.
3. **Link to someone I already have:** as a signed-in buyer who already has Sam as a person, I can link this list to them from the list screen, without copying the link anywhere.
4. **Remove a link:** as a buyer whose person is linked to this list, I can tap Remove, confirm, and the list is unlinked. The person keeps their occasions, budgets, saved gifts and history.
5. **Prompt on the person page:** as a buyer looking at a person with no list linked, I see a clear prompt at the top asking whether they have a GiftsAF list, with the paste box right there.
6. **Signed out:** as a visitor who isn't signed in, I see the list as today, plus an invitation to sign in that brings me back here to add Sam.
7. **Link preview:** as a list owner who texts my link, the preview says it's my list and how many wishes it has, and never shows any gift or claim.

### What each viewer sees at the top of the list screen

| Viewer | Top of the list screen |
|---|---|
| Signed out | "Add Sam to your people": sign in (or request access) and come back to this page |
| Signed in, the list's owner | No card. The heading stays the list's own title, and the existing "This is your list. Claims are hidden from you" banner stays (decision 39) |
| Signed in, none of their people linked to this list | "Add Sam to your people" (primary), and "Already in your people? Link to…" with a picker of their people who have no list linked. The picker is hidden when there's nobody to pick |
| Signed in, one of their people linked to this list | "Sam is in your people" linking to that person's page, and a **Remove** button. Remove asks "Unlink Sam's list? Sam stays in your people with their occasions, budgets and saved gifts." and only then unlinks |

"Sam" is the buyer's own name for the person when one of their people is linked; otherwise it's the owner's display name.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A list whose owner has display name "Sam Lee" and title "My list" | Anyone but the owner opens its share link | The heading reads "Sam Lee's list". The owner's email never appears on the page or in the data sent to the browser |
| AC-2 | The owner has no display name | Someone else opens the link | The heading reads "Their list", and cards say "Add them to your people". No email is shown or sent |
| AC-3 | The owner set a title other than "My list" (e.g. "Birthday 2026") | Someone else opens the link | The heading is "Sam Lee's list" and the title shows as a smaller line under it |
| AC-4 | The owner opens their own share link | — | The heading is the list's own title, the existing owner banner shows, and no add/link/remove card shows |
| AC-5 | A buyer's person "Mom" is linked to a list | The buyer opens Mom's page and taps "Their list" | They land on the same list screen as the share link (same gifts, Claim buttons, heading "Mom's list"), with "Mom is in your people" and Remove |
| AC-6 | Signed in, none of my people linked to this list | I open the share link | I see "Add Sam to your people", plus "Already in your people? Link to…" when I have at least one person with no list linked |
| AC-7 | AC-6 | I tap "Add Sam to your people" | The person form opens with the name filled in from the owner's display name (empty when there is none) and nothing else filled in (relationship asked as usual) |
| AC-8 | AC-7 | I save the form | One person is created and linked to this list in one transaction; I see their page with "Their list: Linked" |
| AC-9 | AC-7, and the list's link is reset (or the list deleted) before I save | I save | Nothing is saved, and the form says the list link no longer works |
| AC-10 | AC-6 | I pick "Mom" from "Link to…" and confirm | Mom is linked to this list, and the card changes to "Mom is in your people" |
| AC-11 | One of my people is linked to this list | I tap Remove, then Cancel | Nothing changes |
| AC-12 | One of my people is linked to this list | I tap Remove, then confirm | The link is removed; the person, their occasions, budgets, saved gifts and history are untouched; the card goes back to the AC-6 state |
| AC-13 | Signed out | I open the share link and tap "Add Sam to your people" | I go to sign in, and afterwards come back to this same share page, now showing the AC-6 card |
| AC-14 | A person with no list linked | I open their page | A prompt at the top reads "Does Mom have a GiftsAF list?", with "Paste the link they sent you, and their gift ideas will come from their own list." and the paste box with Link. The "Their list" row is no longer shown while unlinked |
| AC-15 | AC-14 | I paste a valid link and tap Link | The person is linked and the prompt is replaced by the "Their list: Linked" row |
| AC-16 | A shared list with owner "Sam Lee" and 5 gifts, 2 of them claimed | A chat app fetches the link's preview | Title "Sam Lee's wish list on GiftsAF" and an image with "Sam Lee" and "5 wishes". No gift names, photos, prices or claim information in the tags or the image |
| AC-17 | An unknown or reset share token | A chat app fetches the preview | The generic GiftsAF card, with no name |
| AC-18 | The person-page prompt or the list screen | Viewed at 375 px and desktop, light and dark | It fits without horizontal scroll and matches `design/ui.md` |
| AC-19 | Any way to link (picker, "Add Sam" form, person-page prompt) | Before the buyer confirms | The existing notice shows: "If a gift for them is waiting on an address, it will ship to this list's owner." (ALL-63 AC-24) |
| AC-20 | Mom is already linked to a list (e.g. from another tab), but my page still offers her in "Link to…" | I pick Mom and confirm | Nothing changes; I'm told Mom already has a list linked. The picker and add paths never replace an existing link |
| AC-21 | One of my people is already linked to this list (e.g. a double-tapped Save, or a stale tab still showing "Add Sam") | I add or link another person to this same list | Nothing is saved (no second person is created); I'm sent to, or shown, the person who is already linked. Covered by a local-db test that runs the add twice |
| AC-22 | My linked person's shipping address is the list owner's shared one | I tap Remove | The confirm also says gifts not yet ordered won't ship to that address |
| AC-23 | Any share page | A search engine fetches it | It's marked `noindex, nofollow`, like `/a/[token]` |
| AC-24 | Signed out, not invited (T34) | I look at the card | A Request access link shows next to Sign in. (Coming back to this list after approval is out of scope: the access request must never carry the share token, T42) |
| AC-25 | `app_settings` row `list_link_card_enabled` = 0 | Anyone opens a share page, its preview, or a person page | No add/link/remove card or prompt shows, the owner's name is shown nowhere (heading falls back to "Their list", preview is the generic card), and pasting on the person page's Their list screen still works (off switch, E7) |
| AC-26 | The link-preview image and meta routes | Their output is fetched for a list with claimed gifts | It contains no item or claim fields (tested on our own endpoint's output; chat apps cache previews, so a reset link may keep an old card there) |

### Out of scope

- Finding someone's list without a link: ALL-122.
- Joining your private notes to their list: ALL-77.
- Pre-filling anything but the name (birthday, address). The owner's birthday isn't shared with buyers today (T42).
- A "stop sharing" switch for list owners.
- Changing who can claim, or what claims show, on the list itself.

### Open questions

None left. Answered by Jim on 2026-11-18 after the spec's adversarial review; see the last four rows of "What was decided".

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Should Remove delete the person or unlink? | **Unlink only.** The person keeps everything else | Jim, 2026-11-18 |
| How does the person page's "Their list" show the same screen? | It sends the buyer to the share page for the link's current share token. When the person isn't linked (or the link was revoked), it shows the prompt instead **[Claude's call]** | "Identical" by construction: one screen, one component, one set of tests. The buyer already holds that token (they linked with it), so nothing new is revealed |
| Whose name heads the list? | The owner's **display name** from their account. Never their email; with no display name, "Their list" **[Claude's call]** | Claimers' names already show to anyone with the link, so an owner's chosen name is in line with that. An email is personal data the buyer may not have (T42) |
| When one of my people is linked, which name is shown? | My name for them ("Mom"), not their display name **[Claude's call]** | It's my view of my person |
| What does "Add Sam" pre-fill? | Name only; relationship and dates asked as usual | Ticket's open questions, Claude's calls kept. T42 |
| Add and link at once? | One database transaction: if linking fails, the person isn't created | Ticket AC. A half-done add leaves a duplicate-looking unlinked person |
| Can two of my people be linked to the same list? | **Blocked on every path a buyer sees**: picker, Add, and the person-page prompt. Only the old paste screen behind the off switch keeps today's behaviour | Two people for one human means two gift rounds and a double buy (T18). The new flow makes it one tap away (adversarial review B3) |
| Can the picker replace an existing link? | No. New paths only link a person who has no link (AC-20) | Swapping a link silently changes where a held gift ships (T26, T61; review B2) |
| Where does the owner's name come from? | `public.profiles.display_name` only, with no fallback (not `viewer_display_name()`, which falls back to email; not Google's `full_name`) | T42: don't infer a name we weren't given. Note: Google sign-ins have no display name today, so most owners will show as "Their list" until they set one **[Verify]** |
| Name format | The same string everywhere, page and preview: the full display name | No first-name parsing ("Mary Ann", "Dr. Lee") (review N1) |
| Off switch | `app_settings.list_link_card_enabled` hides the card and prompt; pasting still works | E7, E9 |
| New database functions | `lists.get_shared_list` adds `owner_name` and, for a signed-in non-owner, `linked_person {id, name}` (their live person on an active link to this list). `lists.person_share_token(person_id)` returns the active link's token, for the redirect. `lists.link_unlinked_person(token, person_id)` links only when the person has no link and none of the caller's live people is linked to this list. `concierge.add_person` gains `p_share_token uuid default null` as an 18th argument and calls `lists.link_unlinked_person` in the same transaction. The 17-argument function is dropped and the 18-argument one created in the same migration (two overloads would make PostgREST calls ambiguous); the new argument has a default, so rolled-back code still works (E7). Recorded as a new T# | T19, T31: lists stays the only reader and writer of its tables; the concierge calls lists' public functions (review S3) |
| Search engines | `/share/[token]` gets `noindex, nofollow` | A named list shouldn't become a searchable record (review S2) |
| Show the owner's name on their shared list and its preview? | **Yes**, the display name they set, never their email. A follow-up ticket prompts people without a name (Google sign-ins) to set one | Jim, 2026-11-18 (planning decision 55). The sign-up hint for the name field changes to say it's also shown on your shared list |
| Two of my people on one list | **Blocked** on the new paths (AC-21) | Jim, 2026-11-18 |
| Tabs on the list screen | Signed-in viewers of `/share/[token]` get the Get/Give bar; signed-out visitors keep the plain page. Revises T58 | Jim, 2026-11-18 |
| Link preview | Stays in ALL-123, with AC-26 | Jim, 2026-11-18 |
| Should the person-page prompt be dismissable? | No. It sits at the top until a list is linked, in a compact card **[Claude's call]** | Jim asked for it to be prominent. Revisit if it nags people who know the person has no list |
| Prompt wording | "Does {name} have a GiftsAF list?" / "Paste the link they sent you, and their gift ideas will come from their own list." | Jim's direction 2026-11-18 ("make sense for the context"). "They" because we don't know pronouns |
| Link preview | Display name and wish count only. No gift details and no claim information, not even a count | Owner's default in the ticket; Jim 2026-11-18: claims would spoil it (decision 39) |

## Principles check

- **Simplest version?** One list screen reused for both entry points (redirect, no second view). No new tables. Cut: pre-filling birthday, dismissing the prompt, blocking double links.
- **Hard-coded values?** None. "My list" stays the database default; the page compares against it only to decide whether to show the title as a subtitle **[Verify in plan: read the default from one place, not a second literal]**.
- **Product boundaries?** The share page is in the lists product and gains a card that needs the buyer's people. The page (in `app/`) composes `@/modules/lists` and `@/modules/concierge` through their `index.ts`; the lists component takes the card as a prop or slot and never imports the concierge (T19). The atomic add needs a database function that creates the person and calls `lists.link_person`, lists' public interface.
- **New personal data?** The owner's display name is now sent to anyone holding the share link (it already is to claimers who see each other's names, but not the owner's). No new columns. Events carry ids only (E6).
- **Docs and decisions** to update: `planning/decisions.md` (the owner's display name is shown on their shared list and in its preview; Remove unlinks only), `design/technical-design.md` §"Picks from a person's own list", `design/ui.md` if new card patterns, the screens and emails gallery page.

## Plan

**Architecture:** the share page (`/share/[token]`) becomes the one list screen. The lists component `SharedList` gains a heading built from the owner's name and a `top` slot; the app route fills that slot with a card that composes `@/modules/lists` and `@/modules/concierge` through their `index.ts` (T19). A person's "Their list" redirects to the share page for the link's active token. One migration adds the owner name and the viewer's linked person to `get_shared_list`, a guarded link function, a preview function that never reads items' details or claims, and an optional token on `concierge.add_person` so add-and-link is one transaction.

**Tech stack:** Postgres migration + pgTAP (`pnpm db:test`), Next.js 16 server components and server actions, Vitest (unit and `local-db`), Playwright.

**Global constraints**

- Owner name comes from `public.profiles.display_name` only. Never `viewer_display_name()`, never `auth.users.email`, never Google's `full_name`.
- Copy, exactly: heading `"{name}'s list"` / `"Their list"`; card `"Add {name} to your people"` / `"Add them to your people"`; `"Already in your people? Link to…"`; `"{name} is in your people"`; Remove confirm `"Unlink {name}'s list? {name} stays in your people with their occasions, budgets and saved gifts."`, plus when the person's address is shared: `"Gifts not yet ordered won't ship to their address."`; prompt `"Does {name} have a GiftsAF list?"` / `"Paste the link they sent you, and their gift ideas will come from their own list."`; notice (every link path) `"If a gift for them is waiting on an address, it will ship to this list's owner."`; preview title `"{name}'s wish list on GiftsAF"`.
- New setting: `concierge.app_settings` row `list_link_card_enabled` = `1`. At 0: no card, no prompt, no owner name on the page or in the preview; the old paste screen comes back.
- Events (E6) carry ids only, plus the request id and user id from the log helper: `lists.linked_from_share` `{ person_id, list_id }`, `lists.unlinked_from_share` `{ person_id }`, `people.added_from_share` `{ person_id, list_id }`.
- Every task ends with `pnpm lint && pnpm typecheck` passing for touched files. Browser tests sign in with `signIn(page)`; layout checks are tagged `@layout`.

**Review focus** (input classes the AC tables don't pin, each with its test in the owning task)

1. A display name with an apostrophe or ending in "s" ("James", "O'Neil") renders "James's list" without broken escaping (Task 3 test).
2. A share token that's malformed, reset or deleted while the card is open: every action returns a plain error, never a 500 (Tasks 2, 4).
3. The buyer's linked person was soft-deleted: `linked_person` is null and the card falls back to the add state (Task 1 pgTAP).
4. A buyer with 0 people, or only linked people: the picker is hidden, not empty (Task 4 test).
5. `?list=` on `/people/new` with a garbage or someone's-own token: the form still works as a normal add, with no name filled in and no link attempted (Task 5 test).

### Task 0: Mock-ups approved (ticket AC)

- [ ] Mock the list screen in its four viewer states and the person-page prompt, at 375 px and desktop, light and dark, matching `design/ui.md`.
- [ ] Post them on ALL-123 and get the owner's approval. Note any copy changes back into Global constraints before Task 3.

### Task 1: Database (AC-1–4, 8, 9, 20, 21, 25, 26) [P]

**Files:** create `supabase/migrations/<ts>_add_from_list_link.sql`; create `supabase/tests/add_from_list_link.test.sql`; regenerate types with `pnpm db:types`.

**Produces:**
- `lists.get_shared_list(p_token uuid)` adds `owner_name text|null` (profiles.display_name of the owner, trimmed, null when blank) and `linked_person {id, name}|null`: the caller's live person on an **active** link (token matches) to this list, most recently linked first; always null for the owner and for anon.
- `lists.person_share_token(p_person_id uuid) returns uuid|null`: the token from `lists.active_link` for the caller's own live person.
- `lists.link_unlinked_person(p_token uuid, p_person_id uuid) returns jsonb`: returns `{"status":"linked","list_id":…}`, `{"status":"person_has_list"}` or `{"status":"list_has_person","person_id":…}`. Raises P0002 for an unknown token or person, 22023 for your own list, like `link_person`. **Never overwrites.** Order matters (review B3): (1) lock the person row (`select … from public.people where id = p_person_id and user_id = auth.uid() and deleted_at is null for update`); (2) lock the list row (`… from lists.lists where share_token = p_token for no key update`), which serializes two adds to the same list and waits out a token reset without blocking the owner adding items; (3) as its own statement after the locks, check for another live person of the caller actively linked to this list; (4) `insert … on conflict (person_id) do nothing`, and return `person_has_list` when no row was written; (5) set `people.linked_user_id`.
- `concierge.add_person(<the 17 arguments from 20261103100000_contacts_import.sql>, p_share_token uuid default null)`: `drop function concierge.add_person(text, text, text[], int, int, int, int, int, text, text, text, text, text, text, text, text, text)` and create the 18-argument one in the same migration (two overloads would make PostgREST calls ambiguous; old code passing 17 named args still works, E7). Body unchanged except the link step. When the token is set, call `lists.link_unlinked_person` after the insert and raise on any status but `linked`: `list_has_person` with errcode `P0001`, message `list_has_person`, detail = the existing person id; a missing list rolls back with P0002.
- `lists.share_preview(p_token uuid) returns jsonb|null`: `{owner_name, item_count}` only. Reads no claim table.
- **Grants, written out for every function above** (review B2): `revoke execute … from public, anon; grant execute … to authenticated`, except `get_shared_list` (keeps its grants via `create or replace`) and `share_preview` (`revoke … from public; grant … to anon, authenticated`).
- `owner_name` (in `get_shared_list` and `share_preview`) is null when `list_link_card_enabled` = 0 (AC-25, review S3).
- `insert into concierge.app_settings … ('list_link_card_enabled','1', '…')`.

- [ ] Write pgTAP tests: owner_name from profiles and null when blank, even if the email is set (AC-1, 2); `linked_person` for an active link, null after a token reset, null for a soft-deleted person, null for the owner and anon; `link_unlinked_person` returns each status and leaves an existing link untouched (AC-20); a second person on the same list gets `list_has_person` (AC-21); `add_person` with a token creates and links, and with a reset token or `list_has_person` creates nothing (AC-8, 9, 21); `share_preview` returns exactly the keys `owner_name, item_count` (AC-26); the full 17-named-argument call that `store.createPerson` makes still works; anon has no EXECUTE on `link_unlinked_person`, `person_share_token` or `add_person`; with the person already linked to list A, linking to list B returns `person_has_list` and A stays (AC-20); with the setting at 0, `owner_name` is null.
- [ ] Run `pnpm db:test`. Expected: the new file fails.
- [ ] Write the migration. Run `pnpm db:test`. Expected: all pass. Run `pnpm db:types`.
- [ ] Commit `feat(db): shared list owner name, guarded link and add-and-link (ALL-123)`.

### Task 2: Lists module reads and actions (AC-1, 2, 5, 10, 12, 20)

**Files:** modify `apps/web/modules/lists/lib/lists.ts`, `apps/web/modules/lists/index.ts`; create `apps/web/modules/lists/lib/person-link.ts`; tests in `apps/web/modules/lists/__tests__/person-link.test.ts` (add to `LOCAL_DB_TESTS`).

**Consumes:** Task 1 functions. **Produces:**
- `SharedList` gains `ownerName: string | null` and `linkedPerson: { id: string; name: string } | null`.
- `getPersonShareToken(personId: string): Promise<string | null>`.
- `getSharePreview(token: string): Promise<{ ownerName: string | null; itemCount: number } | null>`.
- Plain functions in `modules/lists/lib/person-link.ts` (not server actions; the only server actions are in Task 4's `app/share/[token]/actions.ts`, review S6): `linkUnlinkedPerson(token: string, personId: string): Promise<{ ok: true; listId: string } | { ok: false; error: string; personId?: string }>` and `unlinkPerson(personId: string): Promise<{ ok: true } | { ok: false; error: string }>`. The callers log the Global events. Error copy: `person_has_list` → "{name} already has a list linked."; `list_has_person` → "This list is already linked to {name}." (with `personId`); P0002 → "This list link no longer works. Ask them for a new one."

- [ ] Write local-db tests: each status maps to its result; unlink keeps the person and their occasions (AC-12); a malformed token returns the P0002 copy, not a throw.
- [ ] Run `pnpm test:db`; expect failure. Implement. Run again; expect pass. Commit.

### Task 3: One list screen (AC-1–5, 23, Review 1)

**Files:** modify `apps/web/modules/lists/components/shared-list.jsx`, `apps/web/app/share/[token]/page.tsx`, `apps/web/app/people/[id]/list/page.tsx`; tests in `apps/web/modules/lists/components/__tests__/shared-list.test.jsx` and `apps/web/app/people/[id]/__tests__/list-page.test.tsx`.

**Produces:** `SharedList` props add `nav?: React.ReactNode` (passed into its `TopBar`; the client component can't build `AppNav` itself, review S5) and `top?: React.ReactNode` (rendered above the heading) and `heading` logic: owner → `list.title`; otherwise `"{linkedPerson.name ?? ownerName}'s list"` or `"Their list"`, with `list.title` as a smaller line when it isn't the default title. Read the default from one exported constant `DEFAULT_LIST_TITLE` in `modules/lists/lib/lists.ts` (T23: it mirrors the column default, so it's a true constant, not a setting).

- [ ] Write component tests: each heading case (AC-1–4), "James's list" and "O'Neil's list" (Review 1), the title subline, `top` renders first.
- [ ] Share page: `robots: { index: false, follow: false }` in its metadata (AC-23; Task 7 turns this into `generateMetadata`); signed-in viewers get `nav={<AppNav />}` (revises T58), signed out get none.
- [ ] `/people/[id]/list`: the whole page renders inside one `<Suspense>` so the redirect happens before any frame is sent (review N3). When `getPersonShareToken` returns a token, `redirect('/share/' + token)`; otherwise, with the card enabled, `redirect('/people/' + id)`; with it disabled, render today's `ListLink` page (AC-25). With the setting at 0, the heading ignores `ownerName`.
- [ ] Run `pnpm test`; expect the new tests to fail, implement, then pass. Commit.

### Task 4: The card on the list screen (AC-6, 10–13, 19, 20, 22, 24, 25, Review 2, 4)

**Files:** create `apps/web/app/share/[token]/list-card.tsx` (client) and `apps/web/app/share/[token]/actions.ts` (the only server actions: call Task 2's functions, log the events with the request id and user id, revalidate `/share/[token]` and `/people/[id]`); modify `apps/web/app/share/[token]/page.tsx`; test `apps/web/app/share/[token]/__tests__/list-card.test.tsx`.

**Consumes:** `SharedList.ownerName/linkedPerson`, `linkUnlinkedPerson`, `unlinkPerson`, `listPeople()` (picker: people with `keepsList === false`), `getPerson()` for the linked person's `address.kind`, `appSettingInt('list_link_card_enabled')`.

**Produces:** `ListCard` props `{ state: "signed-out" | "add" | "linked"; token: string; displayName: string | null; candidates: { id: string; name: string }[]; linked: { id: string; name: string; sharedAddress: boolean } | null; linkAction; unlinkAction }`. The page renders nothing for the owner or when the setting is 0.

- [ ] Write component tests:
  - signed-out shows Sign in with `next=/share/{token}` (AC-13) and a plain Request access link with no token in it (AC-24);
  - add state shows the add link to `/people/new?list={token}`, the picker only when candidates exist (AC-6, Review 4), and the notice (AC-19);
  - picking and confirming calls `linkAction(token, id)`, and an error result shows its copy (AC-20, Review 2);
  - linked state shows the name and link to `/people/{id}`, Remove opens the confirm, Cancel calls nothing (AC-11), Confirm calls `unlinkAction` (AC-12), and the shared-address line shows only when `sharedAddress` is true (AC-22).
- [ ] Fail, implement, pass. Commit.

### Task 5: Add from a link (AC-7–9, 21, Review 5)

**Files:** modify `apps/web/app/people/new/page.tsx`, `apps/web/app/people/person-form.tsx`, `apps/web/app/people/actions.ts`, `apps/web/modules/concierge/people/{service,store,people}.ts`; tests in `apps/web/app/people/__tests__/` and `apps/web/modules/concierge/__tests__/` (fake store) plus a local-db test that fires two `store.createPerson` calls **in parallel** with the same token and asserts exactly one person exists afterwards and the loser gets `list_has_person` with the winner's id (AC-21; the real-thing test behind the fake-store tests, E5, review S7).

**Produces:** `PersonForm` props add `initialName?: string`, `shareToken?: string` (hidden field `list`), and the notice when `shareToken` is set. `addPerson(input, shareToken?)` passes `p_share_token`. On `list_has_person`, return `{ ok: false, error: "…already in your people", existingId }` and the form routes to `/people/{existingId}`. On P0002: "This list link no longer works. Ask them for a new one." When a token was used, the action's result carries the new id and the form routes to `/people/{id}` (it can't be a render-time prop, review N3).

- [ ] Page reads `searchParams.list`. When it matches `UUID_PATTERN` and `getSharedList` returns a non-owner list, it passes `initialName = ownerName ?? ""` and the token; otherwise neither (Review 5).
- [ ] Write the tests (fake-store service tests for each error mapping, form tests for the prefill and notice, local-db double submit). Fail, implement, pass. Log `people.added_from_share`. Commit.

### Task 6: Prompt at the top of the person page (AC-14, 15, 19, 25)

**Files:** modify `apps/web/app/people/[id]/person-view.tsx`, `apps/web/app/people/[id]/list-link.tsx`; test `apps/web/app/people/[id]/__tests__/person-view.test.tsx`.

- [ ] Tests: unlinked shows the prompt first in the page, with the Global copy, the paste box and the notice, and no "Their list" row; linked shows the row "Their list: Linked" (href `/people/{id}/list`) and no prompt; setting 0 shows today's row and no prompt.
- [ ] `ListLink` takes `variant: "prompt" | "page"` and `name`. The prompt variant links through `linkUnlinkedPerson` (never `link_person`, which overwrites, review S1) and shows its error copy; the `page` variant (only behind the off switch) keeps `linkListAction`. Add a `@layout` test of the prompt at phone width (review N4). Fail, implement, pass. Commit.

### Task 7: Link preview (AC-16, 17, 26) [P]

**Files:** create `apps/web/app/share/[token]/opengraph-image.tsx`; add `generateMetadata` to `apps/web/app/share/[token]/page.tsx` (merging the Task 3 robots); test `apps/web/app/share/[token]/__tests__/preview.test.ts`.

- [ ] Tests: title `"Sam Lee's wish list on GiftsAF"`; an unknown token gives the generic `APP_NAME` metadata; the image route uses only `getSharePreview` (mock it and assert `getSharedList` is never called), and its text holds the name and `"5 wishes"`.
- [ ] The image renders per request, never prerendered or cached per token (read the token through `params` and call `connection()` first; check `node_modules/next/dist/docs/` for `opengraph-image` with `cacheComponents`), so a reset link stops showing the name on our endpoint. Add tests: unknown and reset tokens give the generic card. Follow the ALL-55 card style (`app/opengraph-image.tsx`). Fail, implement, pass. Commit.

### Task 8: Journey, copy, docs (AC-18, all)

- [ ] `apps/web/components/sign-up-form.tsx:75` hint becomes "Shown on your shared list and when you claim a gift. Leave it blank to show your email to people you claim with." Update its test.
- [ ] Playwright `apps/web/e2e/add-from-list-link.spec.ts`: as user A, open user B's share link, Add B (relationship chosen), land on B's page with "Their list: Linked", open Their list and see the same screen with Remove, Remove → confirm → the add card returns. One `@layout` test of the card at phone width with `e2e/phone-layout.ts`.
- [ ] Docs: `design/technical-design.md` §"Picks from a person's own list" (new functions, redirect, the guarded link); `design/decisions.md` new T76 (functions, add_person signature, T58 revision); `design/ui.md` if the card is a new pattern; add `list_link_card_enabled` to `design/operations.md`'s settings and off switches.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm build`, then `pnpm gallery` and republish the screens and emails page.
- [ ] PR `feat: open a list link to add or link its owner (ALL-123)`, body says `Closes ALL-123` only if nothing is left, plus E9's answers: seen working through the `lists.linked_from_share` and `people.added_from_share` events; turned off with `list_link_card_enabled = 0`.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test (AC-1–4: Tasks 1, 3; AC-5: 3; AC-6, 10–13, 19, 20, 22, 24: 4; AC-7–9, 21: 1, 5; AC-14, 15: 6; AC-16, 17, 26: 1, 7; AC-18: 0, 6, 8; AC-23: 3; AC-25: 1, 3, 4, 6).
- [x] Every task traces back to a story or criterion (nothing extra).
- [x] No open questions are left, except the owner's confirmation of decision 55 (see the ALL-123 comment).
- [x] Adversarial review of the spec done (3 blockers, 6 should-fix, all fixed or decided), and of the plan (3 blockers, 7 should-fix, 4 nits, all fixed in the plan).

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of the list screen (each viewer state) and the person-page prompt, phone and desktop, light and dark, plus before and after.
- [ ] Mock-up approved before building (ticket AC).
- [ ] Live check after deploy, including a real link unfurl, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.
