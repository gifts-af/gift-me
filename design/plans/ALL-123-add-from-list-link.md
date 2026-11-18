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
| AC-22 | My linked person has a gift waiting on an address, or an order not yet placed, that would ship to the shared address | I tap Remove | The confirm also says that gift will be stopped |
| AC-23 | Any share page | A search engine fetches it | It's marked `noindex, nofollow`, like `/a/[token]` |
| AC-24 | Signed out, not invited (T34) | I tap the card | I can Request access; once I'm in, I come back to this share page |
| AC-25 | `app_settings` row `list_link_card_enabled` = 0 | Anyone opens a share page or a person page | No add/link/remove card shows and pasting on the person page still works (off switch, E7) |
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
| Can two of my people be linked to the same list? | **Blocked on the new paths** (picker and Add). Pasting on the person page keeps today's behaviour | Two people for one human means two gift rounds and a double buy (T18). The new flow makes it one tap away (adversarial review B3) |
| Can the picker replace an existing link? | No. New paths only link a person who has no link (AC-20) | Swapping a link silently changes where a held gift ships (T26, T61; review B2) |
| Where does the owner's name come from? | `public.profiles.display_name` only, with no fallback (not `viewer_display_name()`, which falls back to email; not Google's `full_name`) | T42: don't infer a name we weren't given. Note: Google sign-ins have no display name today, so most owners will show as "Their list" until they set one **[Verify]** |
| Name format | The same string everywhere, page and preview: the full display name | No first-name parsing ("Mary Ann", "Dr. Lee") (review N1) |
| Off switch | `app_settings.list_link_card_enabled` hides the card and prompt; pasting still works | E7, E9 |
| New database functions | `lists.get_shared_list` adds `owner_name` and, for a signed-in non-owner, `linked_person {id, name}` (their live person on an active link to this list). `lists.person_share_token(person_id)` returns the active link's token, for the redirect. `lists.link_unlinked_person(token, person_id)` links only when the person has no link and none of the caller's live people is linked to this list. `concierge.add_person` gains `p_share_token uuid default null` and calls `lists.link_unlinked_person` in the same transaction; added with a default, not dropped, so rolled-back code still works (E7). Recorded as a new T# | T19, T31: lists stays the only reader and writer of its tables; the concierge calls lists' public functions (review S3) |
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

To be written after the spec's adversarial review and Jim's approval.

## Before coding: consistency check

- [ ] Every acceptance criterion maps to a task and a test.
- [ ] Every task traces back to a story or criterion (nothing extra).
- [ ] No open questions are left.
- [ ] Adversarial review of the spec done, and again of the plan (below); blockers fixed, owner decisions answered.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of the list screen (each viewer state) and the person-page prompt, phone and desktop, light and dark, plus before and after.
- [ ] Mock-up approved before building (ticket AC).
- [ ] Live check after deploy, including a real link unfurl, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.
