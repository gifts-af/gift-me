# ALL-21 People, occasions and budgets: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a buyer can add the people they buy for in seconds (a name and a relationship), see them on Home with a photo and their next occasion, and open each person to adjust occasions, an optional budget, and a link to that person's own list.

**Links:** [ALL-21](https://linear.app/allens-forever/issue/ALL-21) · PRD §6.1, P-1, P-3, P-4, P-5, B-1, B-2 · design §3, §4, §6.1 · product decisions 36, 37, 41–43, and 45–46 (new, below) · mock-ups [`home`](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#home) and [`person`](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#person) (source `design/mockups/ALL-41.html`) · schema as built in ALL-19 and ALL-44.

## Spec: what it does

### The rule behind it: ask late, ask once (decision 45, owner)

The owner wants as little friction as possible between signing up and placing a first order. **Anything not needed to save a person waits until the moment it's needed, and it's asked only once.** Skipping a question only puts it off until it's next needed; an answer is saved and never asked again. There's no setup checklist and no "complete your profile" nagging.

What that means here:

| Information | When it's asked |
|---|---|
| Name, relationship | When you add the person (the only required fields) |
| Photo | Optional when adding; can be added any time from their page |
| Birthday | Optional when adding, with a one-tap skip. If skipped, their card shows a small "Add birthday" link until it's filled in (it has no other natural moment) |
| Anniversary (spouses only) | Same as the birthday |
| Address | Not asked here. Asked when their first gift round needs it (P-5, the round's `needs_address` state, ALL-28) |
| Notes, likes, sizes | Not asked here. They come from capture and guided questions (ALL-25, ALL-26) |
| Budget | Not asked here. Shown on their page as optional (decision 36). It's first offered, still optional, as "Your budget" on the pick screen of their first gift round (ALL-29); what you enter there is saved as their budget for that occasion, so next year it's filled in and shapes the ideas from the start |

### Who it's for and what they can do

1. **Add a person fast:** as a buyer, I can add someone with just their name and relationship (and optionally a photo and birthday) so that they're set up in seconds.
2. **See my people on Home:** as a buyer, I see a card for each person with their photo, name, next occasion and its date, and whether they keep their own list, soonest occasion first, so I know what's coming.
3. **Occasions filled in for me:** as a buyer, I get each person's occasions from their relationship and the calendar (Christmas for everyone, Mother's Day for a mom, Valentine's Day for a partner, and so on), each with an on/off switch, so I don't have to think about which holidays apply.
4. **See and change a person:** as a buyer, I can open a person to see their occasions with dates and order-by dates, change their name, relationship, photo, birthday and anniversary, and turn occasions on or off.
5. **An optional budget per occasion:** as a buyer, I can set, change or clear my own budget for each of a person's occasions, and only I see it (decision 36).
6. **Link to their list:** as a buyer, I can paste someone's GiftsAF share link on their page so that the concierge offers gifts from their own list (decisions 37, 42, 43), and I can unlink it.
7. **Delete a person:** as a buyer, I can delete someone, and they and their data disappear from the app (C-7, soft delete as built in ALL-19).

### Profile photos (decision 46, owner)

The owner wants to see their people with a profile photo. A photo can come from four places, and a later source fills it in only when the person has no photo yet (it never replaces one):

1. **You upload one** (phone camera or files). **Built in this ticket.**
2. **Google Contacts**, when people are imported (ALL-24).
3. **The browser extension**, captured while browsing their profiles (ALL-22, ALL-25).
4. **Their own GiftsAF account**, once their list is linked (later).

Without a photo, the card shows their initials on a colored circle. Photos are private to the buyer, like everything else about their people.

### Relationships and the occasions they get

The relationship is picked from a short list. Each one sets which occasions are added (P-4). Christmas is added for everyone; a birthday is added when one is entered. **[Claude's call]** on the list and the mapping, following PRD §6.1.

| Relationship | Extra occasions added (on) |
|---|---|
| Mother, Grandmother | Mother's Day |
| Father, Grandfather | Father's Day |
| Wife, Husband | Valentine's Day, plus an anniversary if a date is given |
| Girlfriend, Boyfriend, Partner | Valentine's Day |
| Son, Daughter, Sister, Brother, Best friend, Friend, Other | none |

All six occasion kinds the schema knows (birthday, anniversary, Christmas, Valentine's Day, Mother's Day, Father's Day) can be turned on for anyone from their page; the list above only sets the starting point. Changing someone's relationship later doesn't change their occasions **[Claude's call]**: the switches you set are kept.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A signed-in buyer on Home | they add a person with only a name and a relationship | the person is saved and their card appears on Home; no other field was required |
| AC-2 | The add form | the buyer picks "Mother" and enters no birthday | she gets Christmas and Mother's Day, both on, and no birthday occasion; her card shows "Add birthday" |
| AC-3 | The add form | the buyer picks "Wife" and enters a birthday and an anniversary | she gets Christmas, Valentine's Day, birthday and anniversary, all on |
| AC-4 | Each relationship in the table above | a person is added with it | they get exactly the occasions the table lists, plus Christmas (and birthday when given) |
| AC-5 | A person with occasions | the buyer opens their page | each occasion shows its next date and its order-by date, correct for every holiday rule, including Mother's Day, Father's Day and a Feb 29 birthday. The order-by date is the normal deadline (`shipByDeadline`); once that has passed, the fast-shipping deadline, labelled "with fast shipping" (the same rule as `planRoundStart`); once that has passed too, "Too late to ship" for this year's date |
| AC-6 | Several people | the buyer views Home | cards are ordered by soonest next occasion that's on; a person with every occasion off comes last; each card shows photo or initials, name, next occasion and date, and "Their own list" or "We suggest ideas" |
| AC-7 | A person's page | the buyer turns an occasion off | it no longer counts as their next occasion on Home, and it's kept (off) for later |
| AC-8 | A person's page | the buyer sets a budget of $75 for Christmas, then clears it | the budget is stored, then stored as "no budget" (`amount_cents` null, decision 36 and T31); the page says "Not set" |
| AC-9 | A buyer with no budget set for a person | they view the person | no budget is shown as set and nothing asks for one |
| AC-10 | The add form or a person's page | the buyer uploads a photo | it's shown on the card and page; it's resized before storing; only that buyer can read it |
| AC-11 | Another signed-in user | they try to read the buyer's person photo | they get nothing |
| AC-12 | A person's page | the buyer pastes a valid GiftsAF share link | the person is linked (`lists.link_person`), and their card and page say "Their own list" |
| AC-13 | A person's page | the buyer pastes something that isn't a share link, an unknown link, or their own list's link | they see a plain error and nothing changes |
| AC-14 | A linked person | the buyer unlinks them | they show "We suggest ideas" again |
| AC-15 | A person | the buyer deletes them (with a confirm step) | they disappear from Home and can't be opened (soft delete, `public.delete_person`) |
| AC-16 | Another user's person id | the buyer opens `/people/<that id>` | they see "not found", never that person's data |
| AC-17 | A person with no birthday | the buyer taps "Add birthday" on their card and saves one | the birthday occasion is added, on, and the link disappears |

### Out of scope

- **"My address" in Settings and the "let people with my list ship to me" switch:** a separate small ticket (to be created), before anything ships to a list owner (ALL-30).
- **Asking for the address:** the round asks when it needs it (ALL-28, P-5). This ticket's forms don't show address fields.
- **Notes, facts, sizes, readiness line, past gifts** on the person page: ALL-25, ALL-26, ALL-34. The page leaves room for them.
- **Photos from contacts, the extension or a linked account:** ALL-24, ALL-22/ALL-25, later. This ticket adds the photo field they fill.
- **Relationship budget defaults (B-2, "S" priority):** no screen to set them. `budget_defaults` stays empty, so a person has no budget until you set one on their page **[Claude's call]**; a defaults screen can come later if wanted.
- **Google Contacts import:** ALL-24.

### Open questions

None left for the owner. Calls marked **[Claude's call]** are listed in "What was decided".

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| What must be entered to add a person? | Name and relationship only | Owner: least friction before the first order; ask late, ask once (decision 45) |
| When is the birthday asked? | Optional on the add form with a one-tap skip; "Add birthday" on the card until filled | Owner: birthdays have no natural just-in-time moment |
| When is the address asked? | Not in this ticket; the round asks when it needs it | Owner (decision 45); revises design §6.1 step 4, which had the add form ask for it |
| Photos? | Yes, private, with initials as the fallback; upload now, other sources later fill only an empty photo | Owner (decision 46) |
| Link to their list, My address, sharing switch? | Only "Link to their list" here; the other two get their own ticket | Owner, on Claude's recommendation: the person page and cards need the link; the other two are about your own account |
| Relationship list and occasion mapping | The table above | **[Claude's call]**, following PRD §6.1 |
| Budget defaults by relationship | None set; no screen in this ticket | **[Claude's call]**: decision 36 makes budgets optional, and the owner wants nothing asked |
| When is a budget first asked? | On the pick screen of the first gift round (ALL-29), optional; saved for that person and occasion | Owner (part of decision 45): the first moment a budget matters. The first year's ideas aren't filtered by price; the budget only marks them |
| Where's "Upcoming"? | Home's cards, ordered by the next occasion, plus each person's occasion list with order-by dates | **[Claude's call]**: the signed-off Home mock-up already shows the next occasion per person; a separate page would repeat it |
| Changing relationship later | Keeps the existing occasion switches | **[Claude's call]**: never undo something the buyer set |
| Photo on a soft delete | Kept with the person. A soft delete hides them; there's no restore screen in this ticket | **[Claude's call]**, consistent with T27 |
| Photo on a hard delete | Not in this ticket. `admin.hard_delete_person` / `hard_delete_account` don't remove Storage files yet, for screenshots either; a follow-up ticket adds one admin cleanup path for both | **[Claude's call]**: hard deletes are rare, manual admin actions, and one cleanup path should cover photos and captures together |
| Where the birthday lives | The occasion is the record: a `birthday` (or `anniversary`) row in `concierge.occasions` with month and day. The year is optional and goes in a new `people.birth_year` (age matters for ideas, e.g. a child's). The unused `people.birthday` date column is dropped, so there are never two copies to keep in step. ALL-24 writes the same way | **[Claude's call]** on the data shape: the owner chose "year optional", and a `date` needs a year |
| Order-by date when it's late | Normal deadline; then the fast-shipping deadline; then "Too late to ship" (AC-5) | **[Claude's call]**: reuses the late-round rule the round engine already uses, so the page and the heads-up agree |
| One Christmas for everyone, or one per person? | One row per person for every occasion, holidays included, each with its own switch. `occasions.person_id` stays non-null in practice | **[Claude's call]**: the switch is per person (P-3), and per-person rows keep the round engine simple |

## Principles check

- **Simplest version?** What we cut: the separate Upcoming page, budget defaults, address fields, and photos from other sources.
- **Hard-coded values?** The photo's largest file size and stored pixel size become `app_settings` rows (T23), read on the server and passed to the upload form. The relationship-to-occasion table is product behavior, kept in `packages/core` with tests, like the holiday rules.
- **Product boundaries?** The concierge links lists only through `lists.link_person` / `lists.unlink_person` and reads "keeps a list" from `people.linked_user_id` (T19).
- **Docs and decisions** that need updating: planning decisions 45 and 46; design §6.1 step 4 (no address on the add form); design §3 (`people.photo_path`, `people.birth_year`, `people.birthday` dropped, the photo bucket); `design/ui.md` (avatar and initials); README doc table if needed.

## Plan

To be written with superpowers:writing-plans once this spec is approved.
