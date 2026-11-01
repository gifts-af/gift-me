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

**Architecture:** one migration finishes the data shape: birth year, photo path, one occasion per kind, a private photo bucket, two photo settings, and an `add_person` function that saves a person and their occasions together. The relationship rules, next-occasion and order-by logic are pure functions in `packages/core`. The screens are server components in `apps/web/app/people/` that call a new `modules/concierge/people/` layer through server actions. Photos are resized in the browser and uploaded straight to Storage under the buyer's own folder.

**Tech stack:** Supabase (Postgres, RLS, Storage, pgTAP), `packages/core` (TypeScript, Vitest), Next.js 16 App Router (server components and actions; read `apps/web/AGENTS.md` first), shadcn/ui, Playwright.

**Branch:** `aarontallen/all-21-people`, in a worktree. PR title `feat: people, occasions and budgets (ALL-21)`, body `Closes ALL-21`.

### Global constraints

- Only name and relationship are required anywhere (decision 45). No address fields in these screens.
- Settings come from `concierge.app_settings` (T23). New rows: `person_photo_max_upload_bytes` = `10485760` (10 MB, the largest file the picker accepts) and `person_photo_px` = `512` (the stored photo's longest side). The schedule values already exist: `planning_delivery_days`, `safety_buffer_days`, `fastest_days_to_arrive`.
- "Today" is the buyer's calendar day in `profiles.timezone`; when that's empty, the request's `x-vercel-ip-timezone` header; otherwise UTC **[Claude's call]**.
- The concierge touches lists only through `lists.link_person` / `lists.unlink_person` (T19). Imports across products go only through `@/modules/<product>`.
- Copy: "Their own list" / "We suggest ideas" (not gendered), "Add birthday", "Add someone you buy for", "Not set", "Too late to ship", "with fast shipping".
- Every task runs `pnpm lint && pnpm typecheck && pnpm test` before its commit. Database tasks also run the pgTAP files (see Task 1 for the shared-database caveat).

### Review focus

1. **Another user's person** by URL, through every server action (update, occasion switch, budget, link, photo, delete), not only the page: must act on nothing. Task 4 tests each action with a foreign id.
2. **A Feb 29 birthday, and occasions today or tomorrow:** next-occasion and order-by must not skip a year or show a past date. Task 2 tests `nextOccasion` with today = the occasion and today = the day after.
3. **Pasted share links in every shape:** full URL, URL with a trailing slash or query, bare token, the buyer's own list. Task 3 tests `parseShareToken`; Task 4 tests the own-list and unknown errors.
4. **Replacing a photo** leaves no orphan file and never shows a broken image if the upload fails halfway. Task 5 tests that `photo_path` changes only after a successful upload, and that the old object is removed after that.
5. **Clearing a budget** stores `null`, not a deleted row (T31: no row means "use the default"). Task 4 tests `setBudget(id, kind, null)`.

---

### Task 1: Data shape for people v1.2 (AC-1, AC-10, AC-11, AC-17)

**Files:**
- Create: `supabase/migrations/20261102120000_people_v1_2.sql`
- Create: `supabase/tests/people_v1_2.test.sql`
- Modify: `packages/core/src/database.types.ts` (regenerated)

**Interfaces:**
- Produces: `public.people.birth_year smallint null` (check 1900–2100) and `public.people.photo_path text null`; `public.people.birthday` is dropped. The column grants for insert and update include both new columns and still exclude `linked_user_id`.
- Produces: unique index `occasions_person_kind_key` on `concierge.occasions (person_id, kind) where deleted_at is null`.
- Produces: the private Storage bucket `person-photos`. Object names are `<user_id>/<person_id>/<random>.jpg`. RLS on `storage.objects` lets a signed-in user select, insert, update and delete only where `bucket_id = 'person-photos' and (storage.foldername(name))[1] = auth.uid()::text`.
- Produces: `concierge.add_person(p_name text, p_relationship text, p_kinds text[], p_birthday_month int, p_birthday_day int, p_birth_year int, p_anniversary_month int, p_anniversary_day int) returns uuid`. It runs as the caller (security invoker, so RLS applies) and inserts the person plus one enabled occasion per kind in one transaction; the birthday and anniversary month and day go on those kinds' rows. Granted to `authenticated` only.
- Produces: the two `app_settings` rows above.

- [x] **Step 1: Write `people_v1_2.test.sql`.** Checks:
  - `add_person` saves a person with only a name, a relationship and the kinds given.
  - A birthday kind without a month and day is refused (`23514`).
  - Two enabled occasions of the same kind for one person are refused (`23505`), but a soft-deleted one doesn't block a new one.
  - A `birth_year` of 1899 is refused.
  - Another user can't see the person or its occasions.
  - A signed-out visitor can't call `add_person` (`42501`).
  - A user can insert an object at `<own id>/<person>/a.jpg` but not at `<other id>/…`, and another user selects 0 rows of it.
  - Both settings are readable through `concierge.setting_int`.
- [x] **Step 2: Run it to see it fail.** The local database is shared with other sessions, so don't `db reset` or `migration up` it. Instead, run the migration and the test in one transaction that's rolled back, the way ALL-44 did, or use a fresh local stack. Expected: errors for the missing function, columns and bucket.
- [x] **Step 3: Write the migration.** First check that nothing reads `people.birthday` (`grep -rn birthday apps/web supabase/tests`): today only occasion rows hold birthdays.
- [x] **Step 4: Run the new and all existing pgTAP files.** Expect all to pass.
- [x] **Step 5: Regenerate the types** (`pnpm db:types` against a database with the migration; CI checks they match). Expected diff: `birth_year`, `photo_path` and `add_person` appear, and `birthday` is gone from `people`.
- [x] **Step 6: Commit** `feat(db): birth year, profile photos and add_person (ALL-21)`.

### Task 2: Relationship and date rules in core [P] (AC-2 to AC-7)

**Files:**
- Create: `packages/core/src/people.ts`, `packages/core/src/people.test.ts`
- Modify: `packages/core/src/schedule.ts`, `packages/core/src/schedule.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Produces: `RELATIONSHIPS` (readonly, in this order): `mother, father, wife, husband, girlfriend, boyfriend, partner, son, daughter, grandmother, grandfather, sister, brother, best_friend, friend, other`; `type Relationship`; `relationshipLabel(r: Relationship): string` ("Mother", …, "Best friend").
- Produces: `startingOccasions(r: Relationship, o: { birthday: boolean; anniversary: boolean }): OccasionKind[]`, following the spec's table: always `christmas`; `birthday` when given; `mothers_day` for mother and grandmother; `fathers_day` for father and grandfather; `valentines_day` for wife, husband, girlfriend, boyfriend and partner; `anniversary` only for wife and husband, and only when given.
- Produces: `nextOccasion(occasions: { kind: OccasionKind; month: number | null; day: number | null; enabled: boolean }[], today: CalendarDate): { kind: OccasionKind; date: CalendarDate } | null`. It returns the soonest enabled occasion on or after today (ties go to list order), or `null` when none is enabled.
- Produces (in `schedule.ts`): `orderBy(occasionDate: CalendarDate, today: CalendarDate, s: Pick<ScheduleSettings, "planningDeliveryDays" | "safetyBufferDays" | "fastestDaysToArrive">): { date: CalendarDate; fast: boolean } | null`. It returns the normal `shipByDeadline` if that's after today; otherwise the fast-shipping deadline (`fast: true`) if that's after today; otherwise `null` ("Too late to ship"). This is the same rule as `planRoundStart`'s deadline, so refactor `planRoundStart` to use it.

- [x] **Step 1: Write failing tests.**
  - `startingOccasions`: one test per row of the spec's table. Mother → `[christmas, mothers_day]`. Wife with both dates → `[christmas, birthday, anniversary, valentines_day]`, in any order. Girlfriend with the anniversary flag set still gets no anniversary. Son → `[christmas]`.
  - `nextOccasion`, with Christmas and a Mar 14 birthday: on 2026-03-01 → the birthday, 2026-03-14; on 2026-03-14 → 2026-03-14; on 2026-03-15 → Christmas, 2026-12-25. A Feb 29 birthday on 2027-02-01 → 2027-02-28. All occasions disabled → `null`.
  - `orderBy` with settings 7/2/1 and an occasion on 2026-12-25: today 2026-12-01 → `{ date: "2026-12-16", fast: false }`; today 2026-12-20 → `{ date: "2026-12-22", fast: true }`; today 2026-12-22 → `null`.
  - The existing `planRoundStart` tests must keep passing.
- [x] **Step 2: Run** `cd packages/core && npx vitest run`. Expect the new tests to fail.
- [x] **Step 3: Implement** in `people.ts` and `schedule.ts`, and export from `index.ts`.
- [x] **Step 4: Run** the core tests with coverage. Expect them to pass, with 100% lines on `people.ts`.
- [x] **Step 5: Commit** `feat(core): relationship occasions, next occasion and order-by date (ALL-21)`.

### Task 3: Form and link parsing rules [P] (AC-1, AC-8, AC-13)

**Files:**
- Create: `apps/web/modules/concierge/people/rules.ts`, `apps/web/modules/concierge/__tests__/people-rules.test.ts`

**Interfaces:**
- Produces: `parsePersonForm(f: FormData): { ok: true; value: PersonInput } | { ok: false; error: string }`, where `PersonInput = { name: string; relationship: Relationship; birthday: { month: number; day: number } | null; birthYear: number | null; anniversary: { month: number; day: number } | null }`. Rules and their errors:
  - The name is trimmed and must be 1–120 characters ("Enter a name.").
  - The relationship must come from `RELATIONSHIPS` ("Pick a relationship.").
  - A date needs both a month and a day, and must exist in a leap year ("That date doesn't exist.").
  - The year is optional, from 1900 to the current year.
  - The anniversary is kept only for a wife or husband.
- Produces: `parseBudget(input: string): { ok: true; cents: number | null } | { ok: false; error: string }`. `""` → `null`; `"75"` and `"$75"` → `7500`; `"75.5"` and `"75.50"` → `7550`. A negative amount, more than 2 decimals, or anything that isn't a number → "Enter an amount like 75 or 75.50."
- Produces: `parseShareToken(input: string): string | null`. It returns the UUID from `https://<any host>/share/<uuid>` (ignoring a trailing slash, query and hash) or a bare UUID, and `null` for anything else.

- [x] **Step 1: Write failing tests** for each case above, including the link shapes in Review focus 3.
- [x] **Step 2: Run** `cd apps/web && npx vitest run modules/concierge/__tests__/people-rules.test.ts`. Expect them to fail.
- [x] **Step 3: Implement** `rules.ts`.
- [x] **Step 4: Run.** Expect them to pass.
- [x] **Step 5: Commit** `feat(concierge): parse person forms, budgets and share links (ALL-21)`.

### Task 4: People data layer and server actions (AC-1, AC-6 to AC-9, AC-12 to AC-17)

**Files:**
- Create: `apps/web/modules/concierge/people/people.ts` (server only), `apps/web/app/people/actions.ts`
- Create: `apps/web/modules/concierge/__tests__/people.test.ts`
- Modify: `apps/web/modules/concierge/index.ts`

**Interfaces:**
- Consumes: Task 1's schema and `add_person`; Task 2's `startingOccasions`, `nextOccasion` and `orderBy`; Task 3's parsers.
- Produces two reads, exported from `@/modules/concierge`:
  - `listPeople(today: CalendarDate): Promise<PersonCard[]>`, sorted by `nextOccasion` date, then by name, with people who have no next occasion last. `PersonCard = { id; name; relationship; photoUrl: string | null; next: { kind; date } | null; keepsList: boolean; hasBirthday: boolean }`.
  - `getPerson(id, today): Promise<PersonDetail | null>`, which returns `null` for an unknown, deleted or someone else's person. `PersonDetail` adds `birthYear`, `birthday`, `anniversary`, and `occasions: { kind; enabled; date; orderBy: { date; fast } | null; budgetCents: number | null }[]`.
- Produces mutations, each returning `SaveResult`:
  - `addPerson(input: PersonInput)` and `updatePerson(id, input)`.
  - `setOccasionEnabled(id, kind, enabled)`.
  - `setBudget(id, kind, cents | null)`: an upsert on `(person_id, occasion_kind)` that stores `null` as `null`.
  - `linkList(id, token)` and `unlinkList(id)`.
  - `setPhoto(id, path | null)` and `deletePerson(id)`.
- Behavior:
  - Photo URLs are signed on the server when people are listed (`createSignedUrl`, 1 hour).
  - `updatePerson` adds, moves or removes the birthday and anniversary rows to match the input, and never touches other switches. A birthday added later is added enabled (AC-17).
  - `linkList` maps `P0002` to "That link doesn't match a GiftsAF list." and `22023` to "That's your own list."
  - `app/people/actions.ts` wraps these as server actions with `(prev, formData)` signatures, working out "today" as the Global constraints say.

- [x] **Step 1: Write failing tests** against a real local database through the user client, connecting the way `e2e/local-supabase.ts` does (or with a fake client, if the existing concierge tests use one; match `notify.test.ts`). Cover:
  - adding a person, then listing them, and the sort order;
  - a budget set, then cleared, stores `null`;
  - turning an occasion off drops it from `next`;
  - linking with a valid, an unknown and an own token, then unlinking;
  - deleting hides the person;
  - **every mutation with another user's person id returns an error and changes nothing** (Review focus 1).
- [x] **Step 2: Run.** Expect them to fail.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expect them to pass.
- [x] **Step 5: Commit** `feat(concierge): people data layer and actions (ALL-21)`.

### Task 5: Photo upload and avatar [P after Task 1] (AC-10, AC-11)

**Files:**
- Create: `apps/web/components/person-avatar.tsx`, `apps/web/app/people/photo-picker.tsx` (client), `apps/web/app/people/__tests__/photo-picker.test.tsx`, `apps/web/components/__tests__/person-avatar.test.tsx`

**Interfaces:**
- Produces: `<PersonAvatar name photoUrl size />`, which shows the photo, or up to two initials on a colored circle. The color comes from the name (so it stays the same) and uses the existing tokens.
- Produces: `<PhotoPicker personId maxUploadBytes px onSaved />`. Steps, in order:
  1. Pick or take an image (`accept="image/*"`, `capture="user"` allowed).
  2. Refuse a file over `maxUploadBytes` ("That photo is too big.").
  3. Draw it onto a canvas with the longest side `px`.
  4. Upload it as a JPEG through the browser Supabase client to `<user>/<person>/<random>.jpg`.
  5. Call the `setPhoto` action.
  6. Only then delete the old object.

  On any failure, the old photo stays.
- `maxUploadBytes` and `px` are read on the server (`appSettingInt`) and passed in.

- [x] **Step 1: Write failing tests:**
  - initials: "Mom" → "M", "Mary Ann Allen" → "MA";
  - the picker refuses an oversized file;
  - on an upload failure, `setPhoto` isn't called and the old photo is kept;
  - on success, the old object is removed after `setPhoto` (Review focus 4).
- [x] **Step 2: Run.** Expect them to fail.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expect them to pass.
- [x] **Step 5: Commit** `feat: profile photos with an initials fallback (ALL-21)`.

### Task 6: Home cards and Add person (AC-1 to AC-4, AC-6, AC-17)

**Files:**
- Modify: `apps/web/app/page.tsx` (the People section)
- Create: `apps/web/components/home/person-card.tsx`, `apps/web/app/people/new/page.tsx`, `apps/web/app/people/person-form.tsx` (client, shared with Task 7), with tests beside them in `__tests__/`

**Interfaces:**
- Consumes: `listPeople`, the `addPerson` action, `PersonAvatar` and `PhotoPicker`. On the add form, the photo is uploaded right after the person is saved.
- Each card shows:
  - the avatar and name;
  - the next occasion, e.g. "Birthday · Sat, Mar 14";
  - "Their own list" or "We suggest ideas";
  - "Add birthday" (linking to `/people/<id>#birthday`) when `hasBirthday` is false.
- The grid is `grid gap-3 md:grid-cols-2 lg:grid-cols-3`, as the placeholder comment says. The empty state keeps today's sentence plus an "Add someone you buy for" button; once there are people, the button comes after the grid.
- `PersonForm` fields:
  - name;
  - relationship (a select of `RELATIONSHIPS`);
  - an optional photo;
  - birthday (month, day and an optional year), with a "Skip" button that clears it;
  - anniversary, shown only when Wife or Husband is picked.

  It saves through `addPerson`, then goes to Home.

- [x] **Step 1: Write failing component tests:**
  - the form submits with only a name and a relationship;
  - the anniversary appears only for Wife or Husband;
  - Skip clears the birthday;
  - the card shows "Add birthday" only when there's no birthday;
  - the card shows "Their own list" or "We suggest ideas" correctly.
- [x] **Step 2: Run.** Expect them to fail.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expect them to pass.
- [x] **Step 5: Commit** `feat: people on Home and adding a person (ALL-21)`.

### Task 7: Person page (AC-5, AC-7 to AC-9, AC-12 to AC-17)

**Files:**
- Create: `apps/web/app/people/[id]/page.tsx`, `apps/web/app/people/[id]/occasions.tsx`, `apps/web/app/people/[id]/budgets.tsx`, `apps/web/app/people/[id]/list-link.tsx`, `apps/web/app/people/[id]/delete-person.tsx`, with tests in `apps/web/app/people/[id]/__tests__/`
- Add shadcn components only as needed (`switch`, `sonner`), per `design/ui.md`.

**Interfaces:**
- Consumes: `getPerson`, the Task 4 actions, `PersonForm` (in edit mode), `PersonAvatar` and `PhotoPicker`.
- The layout follows the `person` mock-up, top to bottom:
  1. The avatar, name, relationship and next occasion.
  2. "Their own list", or "No list of their own, so we suggest ideas".
  3. Edit: the form, with `id="birthday"` on the birthday field.
  4. **Occasions:** each with a switch, its next date, and "Order by Mon, Dec 16", "Order by Mon, Dec 22 with fast shipping" or "Too late to ship".
  5. **Your budget:** "Optional. Only you see it.", then one amount per enabled occasion, showing "Not set" when empty.
  6. **Link to their list:** a paste field and "Link", or "Unlink".
  7. **Delete <name>** at the bottom, with a confirm dialog, then back to Home.

  Room is left for the ALL-25 and ALL-26 sections, with no placeholders.
- An unknown, deleted or another user's id → `notFound()`.

- [x] **Step 1: Write failing component tests:**
  - each order-by wording;
  - the switch calls `setOccasionEnabled`;
  - the budget field shows "Not set", and an error for "abc";
  - the link field shows each error;
  - delete asks to confirm.
- [x] **Step 2: Run.** Expect them to fail.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expect them to pass.
- [x] **Step 5: Commit** `feat: person page with occasions, budget and list link (ALL-21)`.

### Task 8: End-to-end check and docs (all ACs)

**Files:**
- Create: `apps/web/e2e/people.spec.ts`
- Modify:
  - `design/technical-design.md` §3 (the bucket and `add_person`);
  - `design/ui.md` (the avatar and initials, and the card wording);
  - `design/decisions.md`: the next T#. Fetch `origin/main` first; numbers collide between parallel sessions;
  - Linear: a comment on ALL-24 and ALL-22 saying to fill `people.photo_path` only when it's empty.

- [x] **Step 1: Write the Playwright spec.** On a phone viewport, as `TEST_USER`:
  1. Add "Mom" with only a name and Mother.
  2. Home shows her card with "Add birthday", Christmas or Mother's Day as next, and "We suggest ideas".
  3. Open her page, turn Christmas off, set a $75 Mother's Day budget, then clear it ("Not set").
  4. `SECOND_USER` creates a list; the first user pastes its share link and sees "Their own list".
  5. Delete Mom, and she's gone.

  No horizontal scroll at 375 px.
- [ ] **Step 2: Run** the repo's e2e script. Expect it to pass.
- [x] **Step 3: Update the docs** listed above.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expect all to pass.
- [ ] **Step 5: Commit** `test: people end to end, plus docs (ALL-21)`, then open the PR.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test:

  | Criteria | Tasks |
  |---|---|
  | AC-1 | 1, 3, 6, 8 |
  | AC-2 to AC-4 | 2, 6 |
  | AC-5 | 2, 7 |
  | AC-6 | 2, 4, 6 |
  | AC-7 | 2, 4, 7 |
  | AC-8, AC-9 | 3, 4, 7 |
  | AC-10, AC-11 | 1, 5 |
  | AC-12 to AC-14 | 3, 4, 7, 8 |
  | AC-15, AC-16 | 4, 7, 8 |
  | AC-17 | 1, 4, 6 |
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.

## As built

What changed from the plan while building:

- `addPerson` returns the new person's id.
- `PhotoPicker` takes `currentPath`, and one upload function is shared with the add form.
- Tests use a fake store; the database guarantees are checked in pgTAP.
- No `capture` attribute on the photo input.
- If a photo fails after the person is added, we go to the person's page with a note.
- A malformed id shows "not found".
- Delete redirects Home from the server.
- One relationship list serves the app and the extension.
- The end-to-end spec (`apps/web/e2e/people.spec.ts`) was written but first runs in CI's e2e job, which has a fresh database with every migration.
