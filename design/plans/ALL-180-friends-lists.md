# ALL-180 Friends' lists: Spec (first part, before Christmas)

> **Status: draft, not approved.** Rewritten after two adversarial reviews; this version isn't reviewed yet. Direction approved by Jim, 2026-11-25. Sharing back is a later part (`ALL-180-share-back-later.md`). Blocked by ALL-179's gate (its second PR).

**Goal:** any signed-in account can keep the lists people send them and open them again from Get.

**Links:** [ALL-180](https://linear.app/allens-forever/issue/ALL-180), planning decisions 39, 42, 43, 55, 62; T19, T61, T78; ALL-179.

## Spec: what it does

1. **Keep a list:** as any user, I can save a list I was sent and find it under Get.

A saved list is a bookmark: `lists.saved_lists` (user, list, share token). It creates no person, link, address access or round, so it can't affect a gift.

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed in, on someone else's current share link, not saved | they tap Save to friends' lists | it's saved; tapping twice keeps one row |
| AC-2 | saved lists, or existing active links to their people | they open My list | a Friends' lists section shows each list once, by owner name, or "Their list" with no name; none shows a short empty line |
| AC-3 | a saved list | they tap Remove | only the bookmark goes; people and links are untouched. A list that shows through a linked person has no Remove here |
| AC-4 | the list's share token changes, or the list or owner is deleted | anyone opens Friends' lists | it's gone (decision 43) |
| AC-5 | their own list, an old token, or signed out | they call save | the database refuses; signed-out visitors see sign-in, which brings them back to the list, and Save is then offered |
| AC-6 | any account | it reads or removes bookmarks | only its own; owners can't see who saved their list |
| AC-7 | a list-only account | it does AC-1 to AC-3 | it works, and My list makes no concierge query (ALL-179 AC-4); active links are read inside `lists` SQL |
| AC-8 | a concierge account on a list | the page shows | today's add and link card is unchanged; Save isn't shown when one of their people is already linked to that list |
| AC-9 | `friends_lists_enabled` isn't 1 | anyone opens these pages | no Save or section; nothing is deleted |
| AC-10 | `friends_lists_max` bookmarks | they save another | it refuses plainly |
| AC-11 | save or remove | it runs | one event with ids only: `lists.friend_saved`, `lists.friend_removed` |

AC-1, 4, 5, 6 and 10 are proven in pgTAP; one browser journey walks AC-1 to AC-3 as a list-only account.

**Settings:** `friends_lists_enabled` (ships 0, then 1 after the live check), `friends_lists_max` (200) **[Claude's call]**.

**How we'll see it working / turn it off (E9):** the events; the setting.

**Out of scope:** sharing back, the toggles, finding people (ALL-122), contact matching.

**Approaches:** a bookmark table (picked); reusing people and links (gives savers the owner's city and shipping access, and can create duplicate people).

**Principles:** stays in `lists`; new data is which list an account saved; update technical design, database map, screens page and the privacy page if needed.
