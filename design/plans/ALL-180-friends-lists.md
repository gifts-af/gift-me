# ALL-180 Friends' lists: Spec (first part, before Christmas)

> **Status: reviewed (T55) and revised; waiting on Jim's approval.** Direction approved by Jim, 2026-11-25 (planning decision 62), scope-freeze exception included. PRs say `Part of ALL-180`. Sharing back is the second part (`ALL-180-share-back-later.md`). Built after ALL-179's second PR; AC-6 for new sign-ups also needs its third PR and the sign-up steps.

**Goal:** any signed-in account can keep the lists people send them and open them again from My list.

**Links:** [ALL-180](https://linear.app/allens-forever/issue/ALL-180), planning decisions 39, 42, 43, 55, 62; T19, T61, T72, T78; ALL-179.

## Spec: what it does

1. **Keep a list:** as any user, I can save a list I was sent and find it at the bottom of My list (`/lists`).

A saved list is a bookmark: `lists.saved_lists`, key (user, list), with the share token. It creates no person, link, address access or round, so it can't affect a gift.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed in, on someone else's current share link | they tap "Save to friends' lists" | it's saved and the button reads "Saved", with Remove. Saving again keeps one row, at the limit too |
| AC-2 | saved lists | they open `/lists` | "Friends' lists" shows only their bookmarks, newest first: owner's `display_name`, or "Their list" when blank or `list_link_card_enabled` isn't 1; the list's title when it isn't the default; the saved date. No gifts or claims (39). None: "Lists you save will show here." |
| AC-3 | an account with no list of its own, or whose own list failed to load | they open `/lists` | the section still shows. Signed-out visitors don't see it |
| AC-4 | any account, with or without concierge access, or the access check failed, or the concierge card off | they open a share link | Save still shows. It doesn't replace or change T78's card, and sits below it as the quieter action |
| AC-5 | a saved list | they tap Remove, on either page | only the bookmark goes; people and links are untouched |
| AC-6 | signed out, with Save on | they open a share link | the sign-in way back to that list is offered, even with the concierge card off |
| AC-7 | the share token changes, or the list, owner or saver's account is deleted | anyone reads | it's gone, silently. Two layers: a delete on token change (cascade on deletion), and reads require the stored token to equal the current one. Saving again takes the new link |
| AC-8 | a saver and a reset at once | both run | the save locks the list row (`for key share`), so no old token is kept. The limit is counted under a per-user lock |
| AC-9 | own list, an old token, or no session | save is called | the database refuses |
| AC-10 | the table | anyone reads or writes it directly | refused: RLS on, all grants revoked; save, remove and read functions only, for signed-in users, and only their own rows. Owners can't see who saved their list |
| AC-11 | `friends_lists_enabled` isn't exactly 1, or missing | save or read is called | save refuses, read returns nothing, Remove still works, the pages show nothing. Nothing is deleted |
| AC-12 | `friends_lists_max` bookmarks, or the setting is missing | they save another | it refuses, and the page says to remove one first |
| AC-13 | the read fails, or a tap hits a reset list | the page shows | a retry line in that section only, or "This link no longer works"; My list still works |
| AC-14 | save or remove | it runs | one event with `user_id` and `list_id` only, never the token: `lists.friend_saved`, `lists.friend_removed`; failures log ids and an error code |

**Tests:** AC-1, 5, 7, 9 to 12 in pgTAP; AC-8 local-db, two sessions; AC-2 to 4, 6, 13 component tests; AC-14 unit. One `@layout` journey: a list-only account with no list saves, opens and removes.

**Settings:** `friends_lists_enabled` (ships 0, 1 after the live check), `friends_lists_max` (200) **[Claude's call]**.

**E9:** seen through the events; turned off by the setting.

**Out of scope:** sharing back, toggles, linked people in the section, finding people (ALL-122), contact matching, undo.

**Approaches:** a bookmark table (picked); reusing people and links (gives savers the owner's city and shipping access, and duplicate people); also listing linked people (a second source nobody asked for).

## Open questions

None, once Jim approves.

## Principles check

Simplest: one table, three functions. New personal data: which lists an account saved, removed with either account. Boundaries: stays in `lists`; the setting is read in SQL as `get_shared_list` does. Docs: a T# for the table and T78's page, technical design, database map, screens page, and **the privacy page** (what's kept, that owners can't see it, when it goes).
