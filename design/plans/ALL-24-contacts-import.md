# ALL-24 Google Contacts import: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a buyer can bring the people they buy for in from Google Contacts in one pass: tick who they buy for, pick each one's relationship, and they're added with birthdays, addresses, photos and their usual occasions.

**Links:** [ALL-24](https://linear.app/allens-forever/issue/ALL-24) · PRD P-2 · design §6.1, §3 (`people`) · decisions 45, 46 (ALL-21), T42 (collect the minimum), T44 (evidence on the ticket) · builds on ALL-21 (`design/plans/ALL-21-people.md`). Later sources: ALL-67.

## Spec: what it does

### Who it's for and what they can do

1. **Import from Google:** as a buyer, I can connect Google Contacts from Home, only when I choose to, so I don't type everyone in by hand.
2. **Pick who I buy for:** I see my contacts in a "Who do you buy gifts for?" checklist with a search box. Only the ones I tick are saved; nothing about the others is kept.
3. **Say who they are:** each ticked contact needs a relationship (it decides their holidays). It's pre-filled when the contact is obviously "Mom" or "Dad", and Import stays off until every ticked contact has one.
4. **Get what Google knows:** each person is added with their birthday (and birth year when Google has it), their address, and their Google photo, plus the occasions their relationship gives them (ALL-21's rules).
5. **Import again safely:** contacts I've already imported show "Already added" and can't be added twice.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A signed-in buyer on Home | they choose "Import from Google" | Google asks for read-only contacts access (`contacts.readonly`), separate from sign-in, and nothing is asked before they click |
| AC-2 | Access granted | the contacts load | they see a checklist of their named contacts, A–Z, searchable by name; contacts without a name aren't listed |
| AC-3 | The checklist | they tick 3 contacts, pick a relationship for each and import | 3 people are created with the names, birthdays (and birth year when given), addresses and default occasions from ALL-21's relationship table, plus a birthday occasion when Google has one |
| AC-4 | A ticked contact named "Mom" (or nickname "Mom") | the checklist shows it | its relationship is pre-filled as Mother; likewise Dad → Father, Grandma → Grandmother, Grandpa → Grandfather |
| AC-5 | A ticked contact with no relationship picked | they look at the Import button | it's off, and the row says "Pick who they are" |
| AC-6 | A contact with a Google photo (not Google's default letter avatar) | it's imported | the photo is stored in the buyer's private photo folder at the app's photo size and shown on their card |
| AC-7 | Contacts already imported | the buyer imports again | those rows show "Already added", can't be ticked, and no duplicate person is created, even if two imports race |
| AC-8 | An import | it finishes | no Google token is stored anywhere (database, cookies, local storage), and the token is revoked with Google right after the contacts are read |
| AC-9 | Contacts that aren't ticked | the import finishes | nothing about them reached our server |
| AC-10 | A bad row sent to the server (made-up relationship, impossible date, photo URL not on Google's photo host, a contact id in the wrong format) | the import runs | that row is refused with the others still added, and nothing is fetched from a non-Google host |
| AC-11 | Google says no (popup closed, access denied, People API error) | the buyer is on the import page | they see a plain message and can try again; nothing was saved |

### Out of scope

- Phone numbers and emails from contacts (T42: not needed by any feature yet).
- Updating people already imported when their Google contact changes (a later sync).
- Other sources: file upload, Microsoft, Android picker (ALL-67).
- Matching contacts to people added by hand with the same name: only the Google contact id prevents duplicates **[Claude's call]**.

### Open questions

None left. The owner answered the three below on 2026-11-01.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Save the address Google already has? | Yes, for ticked contacts only. Saved unchecked (`address_checked_at` null), so it's checked when the first order needs it | Owner. It's the buyer's own data about someone they chose, and it skips a question at the first order. Fits T42: nothing for unticked contacts, no phone or email |
| How does an imported person get a relationship? | Picked per ticked contact in the checklist, with "Mom"/"Dad"-style names pre-filled; Import is off until each has one | Owner. The relationship decides their holidays. Google has no field for "my relationship to this contact", so names and nicknames are the only hint **[Claude's call]** on the hint list |
| Use the Google photo? | Yes, only when it's a real photo (not Google's default), copied into private storage | Owner, planned in decision 46 |
| How the app gets contacts | Google Identity Services' token popup in the browser (`initTokenClient`, scope `contacts.readonly`), then the browser calls the People API itself and revokes the token. Only the ticked rows go to our server | **[Claude's call]**. The token never reaches our server, so it can't be stored (AC-8), and unticked contacts never leave the browser (AC-9, T42). Reuses the Google client Supabase sign-in already uses, so there's no client secret to manage |
| Photos | The server copies them: it fetches the Google URL at `person_photo_px` size, only from `*.googleusercontent.com`, up to `person_photo_max_upload_bytes`, and uploads into `<user_id>/<person_id>/` with the buyer's own client | **[Claude's call]**. Google's photo host may not allow the browser to read the image bytes; the host allowlist stops the server fetching anything else |
| Duplicates | A unique index on (user, Google contact id) for live people, plus the checklist marking "Already added" | **[Claude's call]**. The index makes AC-7 hold even if two imports race |
| How many contacts | All of them, read page by page (1,000 per request) | People with thousands of contacts still see everyone; the search box makes the long list usable |
| Unverified app | Fine for now: Google shows an "unverified app" notice and allows 100 test users | Design §2 already accepts this for the MVP. Verification comes before the public launch |

## Principles check

Go through CLAUDE.md > Principles. Note anything this plan bends, and why. Write "none" if nothing does.

- **Simplest version?** What we cut: sync, phone and email, name matching, a server-side OAuth flow.
- **Hard-coded values?** Photo size and max bytes come from the existing `app_settings` rows (T23). The Google client ID is an env var (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). The People API page size (1,000, Google's maximum) and the photo host allowlist are API facts, not tunables.
- **Product boundaries?** All in the concierge module and `app/people/import`. No list tables touched (T19).
- **New personal data?** Address, birthday, birth year and photo of ticked contacts, each used by a feature now: occasions (birthday), ideas (age), shipping (address), cards (photo). No phone or email (T42).
- **Docs and decisions** that need updating: design §6.1 (how the import works), README env list and `.env.example` (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`), technical decision for the token-in-browser approach.

## Plan

**Architecture:** a migration extends `concierge.add_person` with an optional Google contact id and address, and adds a unique index on (user, Google contact id). The People API mapping, the relationship hint and the row checks are pure functions with tests. The page `/people/import` is a server component that passes the already-imported contact ids, the client id and the photo size to a client checklist. The checklist loads Google Identity Services, reads contacts, revokes the token, and sends only ticked rows to a server action. The action calls `importPeople` in the concierge people service, which adds each person and copies photos.

**Tech stack:** Supabase (migration, pgTAP), Next.js 16 App Router (server component and action), Google Identity Services and the People API (browser only), Vitest and RTL.

**Branch:** `aarontallen/all-24-contacts-import`. PR title `feat: import people from Google Contacts (ALL-24)`, body `Closes ALL-24`.

### Task 1: Database (AC-3, AC-7)
- [ ] pgTAP test: `add_person` with a Google id and address stores them; a second live person with the same Google id for the same user fails with 23505; another user can use the same Google id; a soft-deleted person's id can be reused.
- [ ] Migration: replace `add_person` with the extra optional parameters (old calls keep working), and add the partial unique index. Regenerate types.

### Task 2: Mapping and checks (AC-2, AC-4, AC-10)
- [ ] `contactsFromPeopleApi(response)`: named contacts only, display name, given and family names, birthday (month, day, optional year), first address, real photo URL, A–Z.
- [ ] `guessRelationship(name, nickname)`.
- [ ] `parseImportRows(json)`: relationship in the list, valid date, birth year range, field lengths, `people/c…` id, photo host `*.googleusercontent.com`.

### Task 3: Service and action (AC-3, AC-6, AC-7, AC-10)
- [ ] `importPeople(store, rows)` with the in-memory store: occasions from the relationship, skips ids already imported, treats 23505 as already added, a photo failure doesn't fail the person, returns added, skipped and failed counts.
- [ ] Photo copy: host allowlist, size from settings, byte limit, image content type only.
- [ ] Server action `importContactsAction`.

### Task 4: Checklist page (AC-1, AC-2, AC-4, AC-5, AC-7, AC-8, AC-11)
- [ ] Component tests with a fake contact loader: search, "Already added", Import off until relationships are picked, only ticked rows sent, errors shown.
- [ ] The Google loader: GIS token popup, People API paging, revoke.
- [ ] "Import from Google" on Home next to "Add someone you buy for".

### Task 5: Evidence and docs (T44)
- [ ] Screenshots of the checklist (phone, desktop, light and dark) with fake contacts, and the result on Home, posted to ALL-24.
- [ ] Live import on giftsaf.com by the owner, after the Google Cloud setup below. Listed as **Still open** until then.

### Setup (owner, as allensforever711)
1. Google Cloud: enable the People API.
2. Google Auth Platform > Data Access: add `contacts.readonly`.
3. Google Auth Platform > Clients > the Web client: add JavaScript origins `https://giftsaf.com` and `http://localhost:3000`.
4. Vercel: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in every environment (Claude sets it; it's the public id Supabase sign-in already uses).

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test (AC-8 and AC-9 are checked by the loader's design and component tests that only ticked rows are posted, plus a live check).
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of what people see and any mock-ups, uploaded into the ticket comment.
- [ ] Live check after deploy, or listed as **Still open**.

## Review focus

1. **The photo fetch** is the only place the server fetches a URL that came from the browser: host allowlist, byte limit and content type (Task 3 tests).
2. **Another user's data:** the action only ever writes through the signed-in user's client, so RLS decides. Photos land in the buyer's own folder.
3. **Duplicates under a race:** the unique index, not just the "Already added" marks (Task 1 test).
4. **Nothing stored from Google but the ticked rows:** no token in any storage (Task 4 review of the loader).
