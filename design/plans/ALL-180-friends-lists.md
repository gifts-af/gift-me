# ALL-180 Friends' lists and share back: Spec

> **Status: draft, reviewed once (T55) and revised; not re-reviewed or approved.** Scope-freeze exception by Jim, 2026-11-25. Before Christmas: story 1 only, then stories 2 and 3. No plan or code yet.

**Goal:** people can find friends who are already on GiftsAF and see each other's lists without passing links back and forth.

**Links:** `planning/ideas.md` > Parked; decisions 37, 39, 41, 42, 43, 55; T42, T45, T61, T78; ALL-179 (list-only accounts); ALL-67 (contacts file).

**Would make it a failure even if it works:** a list opens to someone its owner didn't share it with; an automatic add starts a gift round or spends money; someone can harvest who has an account.

## Spec: what it does

### Who can use it

Every signed-in account, with or without concierge access. Lists, claiming, sharing and friends are for everyone. Rounds, reminders and ideas still need concierge access (ALL-179).

### Stories, in build order

1. **Friends' lists:** as any user, I can see the lists of people I'm connected to, under Get.
2. **Share back:** after opening Sam's list, I can share mine with Sam, and I'm added to Sam's people.
3. **Control it:** I can turn off being added, or turn on being found, in Settings > Friends.
4. **Find friends (not this ticket; AC-16 to AC-19 are parked):** exact-email search with the owner's approval is ALL-122, whose decisions are made. Checking all Google contacts is undecided (T45).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | any signed-in user, concierge or not | they open a share link and tap "Save to friends' lists", or someone shares with them | the list is under Friends' lists in Get, with Open and Remove; nobody else's links show |
| AC-2 | signed in, on Sam's current share link, Sam's "added" toggle on | they open it | "Share yours back" is offered, saying they'll be added to Sam's people |
| AC-3 | the same, and they confirm | the server runs it | Sam gets a person with their display name, relationship `friend`, linked to the list they chose to share |
| AC-4 | the added person | it is created | there are no occasions, person or occasion budgets, birthday or address, and no round or gift email. The owner's `friend` budget default applies as usual once they add an occasion |
| AC-5 | Sam already has a live person linked to the sharer's account, through any list | they share back | nothing is added; the sharer sees the same answer as for a new add (so it can't be used to probe Sam's people) |
| AC-6 | Sam has an unlinked person who may be the sharer | they share back | no name matching: a separate person is added. Sam (with concierge access) can move the link to one of their own people; it shows the shared city first, and refuses while that person has an open round or a held order |
| AC-7 | someone was added | Sam opens Get or Give | Sam sees "<name> shared their list with you", with Keep and Remove. **A link made by share back never supplies a shipping address until Keep, and not before ALL-98 is live (T61).** Keep is stored on the link |
| AC-8 | Sam removed someone | they share back again | they are added again (the toggle is the way to stop it) |
| AC-9 | Sam's "added" toggle off, or an old or reset token, or Sam's own list | someone offers or calls it directly | it isn't offered, and the database refuses |
| AC-10 | the sharer has no list, or no display name | they share back | they're asked for it first; the email is never used as a name |
| AC-11 | share back, add from link, `link_unlinked_person` or `link_person` run at once, on any lists | all run | one live person per (owner, linked account): one lock or unique index, shared by every linking path (revises T78) |
| AC-12 | I shared with Sam | I open Settings > Friends and tap Stop sharing | Sam's link to my list is removed and nobody else's is |
| AC-13 | the sharer is about to share, in either direction | they confirm | if address sharing is on they're told Sam could ship there; the address switch says how many people can |
| AC-14 | a new account | it is created | "Let people find me by email" is off; "Let people add themselves to my people" is on. Both show in Settings > Friends to every user |
| AC-15 | an existing account | this ships | finding is off; adding is off, with one prompt offering it **[Claude's call]** |
| AC-16 | import on, after the Google popup | they tap "Check who's on GiftsAF" | only emails are sent, capped per request, per person and in total per day. The answer holds only findable accounts whose email is proven: a Google identity, or confirmed after a recorded cutover. An older password account never matches. Emails aren't stored, logged or in error reports |
| AC-17 | a match | it shows | the name is the one in their own contacts; the friend's list, items and photo aren't shown |
| AC-18 | they tap "Ask for their list" | it is saved | the friend sees the request, and can Share or Not now. Share follows AC-3 in the asker's direction: the friend's list is linked to a person of the asker's. Not now is never told, and that asker can't ask again |
| AC-19 | the friend turns finding off | anyone checks again | no match; an open request stays theirs to answer |
| AC-20 | a cap is reached (shares sent, shares received, emails checked by one person or by everyone, requests), or a switch is 0 | anyone tries | it refuses plainly. Switches stop new adds or checks only; existing friends' lists keep working |
| AC-21 | any action here | it runs | one event with ids only (E6) |

| AC-22 | any share-back call | the database runs it | signed-in only; refuses a list the caller doesn't own; takes no name, user id or person id from the client (the name is `profiles.display_name`); toggles and requests are readable by their owner only |
| AC-23 | a sharer deletes their account | it is deleted | people they were auto-added as go too, if untouched |
| AC-24 | a list-only account on either side | it walks stories 1 to 3 | every step works without a concierge page (revises ALL-179 AC-5, AC-7, AC-8) |

### Settings (T23)

`friends_share_back_enabled`, `friends_find_enabled` (both ship at 0), `friends_shares_per_day` (20), `friends_received_per_day` (20), `friends_emails_checked_per_day` (1000), `friends_emails_checked_per_day_total` (5000), `friends_requests_per_day` (20). Amounts are **[Claude's call]**. A missing setting refuses.

### Out of scope

Phone numbers, native address books, contact files (ALL-67), suggesting friends of friends, notification emails, remembering removals, blocking one person.

### Approaches considered

| | Trade-off |
|---|---|
| **Picked: create the person in Sam's people at once, through one narrow server function, reusing `public.people` and `lists.person_links`** | Automatic, one model for Get and Give; the first write by one user into another's private rows |
| Pending share until Sam accepts | Safer, but not automatic |
| Separate friends table | Keeps people private, but two records of one human, to reconcile when Sam gets concierge access |

Matching: the server compares the emails and discards them. Hashing was rejected, because emails are easy to guess. Phone matching was rejected (texts, native app, T42).

### Open questions

Decided by Jim, 2026-11-25 (planning decision 62): an exception to the scope freeze; any holder of Sam's link can be added while Sam's toggle is on, which is on by default; links made by share back wait for ALL-98 as well as Keep before supplying an address.

- **[Owner]** Story 4 only: may contact emails reach our server for the check (revises T45)? Undecided, so story 4 stays parked. It doesn't hold up stories 1 to 3.
- **[Verify]** Contacts access needs Google's review before story 4 can open; `google_import_enabled` is 0.
- **[Verify]** Which existing emails are really verified. Google sign-ins are; password accounts made while confirmation wasn't required aren't proof.
- **[Verify]** T45 and ALL-179 tell Google only ticked contacts are saved, so story 4 needs new review text and a privacy page change.

## Principles check

- **Simplest version?** Stories 1 to 3 ship without any contact data; 4 follows.
- **Hard-coded values?** The settings above.
- **Product boundaries?** Functions live in `lists`; they write `public.people` (shared), never `concierge` tables. Import changes sit with the existing import.
- **New personal data?** Two toggles, requests between account ids, counts for caps. No contact emails kept.
- **Docs and decisions:** T45, T78, decisions 42 and 55, technical design §6.1, database map, screens page, when built.
