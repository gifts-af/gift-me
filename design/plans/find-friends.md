# Find friends and share lists back: Spec

> **Status: draft, not approved, parked under the scope freeze.** No ticket yet; renamed to `ALL-<n>-find-friends.md` when the owner makes an exception or lifts the freeze. Direction from Jim, 2026-11-25. No plan or code yet.

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
4. **Find friends:** I can see which Google contacts are on GiftsAF and findable, and ask for their list.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | any signed-in user with linked people | they open Get | "Friends' lists" shows each one's name and opens their list; only their own links show |
| AC-2 | signed in, on Sam's current share link, Sam's "added" toggle on | they open it | "Share yours back" is offered, saying they'll be added to Sam's people |
| AC-3 | the same, and they confirm | the server runs it | Sam gets a person with their display name, relationship `friend`, linked to the list they chose to share |
| AC-4 | the added person | it is created | it has no occasion, birthday, address or budget, and no round or email about a gift starts until Sam adds an occasion |
| AC-5 | Sam already has a person linked to the sharer's account, through any of their lists | they share back | nothing is added or changed, and it still says shared |
| AC-6 | Sam has an unlinked person with the same display name | they share back | no duplicate is created and nothing is linked until Sam answers "Is this your <name>?" (Yes links; No adds) |
| AC-7 | someone was added | Sam opens Get or Give | Sam sees "<name> shared their list with you", with Keep and Remove. Remove deletes the person like any other |
| AC-8 | Sam removed someone | they share back again | they are added again (the toggle is the way to stop it) |
| AC-9 | Sam's "added" toggle off, or an old or reset token, or Sam's own list | someone offers or calls it directly | it isn't offered, and the database refuses |
| AC-10 | the sharer has no list, or no display name | they share back | they're asked for it first; the email is never used as a name |
| AC-11 | two tries at once | both run | one person is created |
| AC-12 | the sharer resets their link or turns sharing off | Sam opens it | access ends, as in decision 43 |
| AC-13 | the sharer has address sharing on | they confirm | they're told first that Sam could send gifts to it (decision 42, T61) |
| AC-14 | a new account | it is created | "Let people find me by email" is off; "Let people add themselves to my people" is on. Both show in Settings > Friends to every user |
| AC-15 | an existing account | this ships | finding is off; adding is off, with one prompt offering it **[Claude's call]** |
| AC-16 | import on, after the Google popup | they tap "Check who's on GiftsAF" | only contact emails are sent; the answer holds only contacts whose owner is findable with a verified email. Emails aren't stored or logged |
| AC-17 | a match | it shows | the name is the one in their own contacts; the friend's list, items and photo aren't shown |
| AC-18 | they tap "Ask for their list" | it is saved | the friend sees the request, and can Share or Not now. Share follows AC-3 in the asker's direction: the friend's list is linked to a person of the asker's. Not now is never told, and that asker can't ask again |
| AC-19 | the friend turns finding off | anyone checks again | no match; an open request stays theirs to answer |
| AC-20 | a daily cap is reached (shares, emails checked, requests), or an off switch is 0 | anyone tries | it refuses with a plain message |
| AC-21 | any action here | it runs | one event with ids only (E6) |

### Settings (T23)

`friends_share_back_enabled`, `friends_find_enabled` (both ship at 0), `friends_shares_per_day` (20), `friends_emails_checked_per_day` (2000), `friends_requests_per_day` (20). Amounts are **[Claude's call]**. A missing setting refuses.

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

- **[Owner]** Exception to the scope freeze.
- **[Owner]** Any holder of Sam's link can be added to Sam's people while Sam's toggle is on (Jim chose this; a forwarded link lets in a stranger). It bends principle 6 and needs a decision number.
- **[Owner]** Revise T45: contact emails reach our server when the user taps Check.
- **[Verify]** Contacts access needs Google's review before story 4 can open; `google_import_enabled` is 0.
- **[Verify]** Which existing emails are really verified. Google sign-ins are; password accounts made while confirmation wasn't required aren't proof.
- **[Verify]** T78's "never a second person on one list" holds when AC-6's question is answered late.

## Principles check

- **Simplest version?** Stories 1 to 3 ship without any contact data; 4 follows.
- **Hard-coded values?** The settings above.
- **Product boundaries?** Functions live in `lists`; they write `public.people` (shared), never `concierge` tables. Import changes sit with the existing import.
- **New personal data?** Two toggles, requests between account ids, counts for caps. No contact emails kept.
- **Docs and decisions:** T45, T78, decisions 42 and 55, technical design §6.1, database map, screens page, when built.
