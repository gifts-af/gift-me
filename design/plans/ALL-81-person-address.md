# ALL-81 Add and edit a person's shipping address on their page: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a buyer can add, change or remove the shipping address of someone they buy for, from that person's page. Saving an address moves a round waiting in `needs_address` on at once, so the round engine can be switched on (ALL-27).

**Links:** [ALL-81](https://linear.app/allens-forever/issue/ALL-81) · design §6.1 steps 4–5 (missing address, address check on entry), §3 `people` row · PRD P-5 (ask for the address before the first round) · product decisions 38 and 41 (shared addresses: the buyer sees only city and state), 45 (ask late, ask once) · T23 (no hard-coded values), T26 (users write their own people rows), T42 (collect the minimum), T45 (contacts import saves addresses unchecked), T50 (migrations apply on merge) · round engine [ALL-28](https://linear.app/allens-forever/issue/ALL-28) (`design/plans/ALL-28-round-engine.md`, AC-8 and AC-9) · blocks [ALL-27](https://linear.app/allens-forever/issue/ALL-27) · related [ALL-24](https://linear.app/allens-forever/issue/ALL-24) (import), [ALL-63](https://linear.app/allens-forever/issue/ALL-63) (your own address and sharing it) · mock-ups: option C below (agreed with Jim, 2026-11-03).

## Spec: what it does

### Why

The round engine (ALL-28) asks for a missing address by email, on the reminder schedule, and saving an address moves the waiting round on straight away. But the person page has no address fields, so the email's "Add an address" button leads nowhere. Today an address only arrives through the Google Contacts import. The engine ships switched off on production, so nothing is broken yet, but ALL-27 can't switch it on until this lands.

The second goal is to catch bad addresses when they're entered, not on the day of purchase (design §6.1 step 5). Zinc has no address check of its own and rejects an incomplete address at order time.

### Who it's for and what they can do

1. **Add an address when asked:** as a buyer who got an "Add an address" email, I tap the button and land on the person's page with the address form already open. When I save, the waiting round goes ahead and I get the heads-up.
2. **Add or change an address any time:** as a buyer, I can add an address from the person's page when I choose, or change one, at phone and desktop width. Having no address is normal and the page doesn't nag about it.
3. **Plain errors, nothing half-saved:** as a buyer who leaves out a field or types a bad ZIP, I get a plain message next to the field, and nothing is saved until the whole address is right.
4. **Remove an address:** as a buyer, I can remove an address I entered, after confirming. The next round asks for it again.
5. **Someone else's own address is theirs:** as a buyer whose person keeps their own list and shares their address with gift givers (decisions 38 and 41), I see only their city and state and can't change or remove it.
6. **Imported addresses are checked too:** as a buyer who imported a contact with an incomplete or badly formatted address, the round asks me to fix it before buying, and the form opens with what Google had already filled in.

### What the buyer sees (option C, agreed 2026-11-03)

A **Shipping address** section on the person's page, **below Budgets and above the List section**, alongside the other "how gifts happen" settings. It has its own Save; the existing Edit form is unchanged.

| State | What shows |
|---|---|
| **No address** (the default) | "Optional for now. We'll ask before their first gift ships." and a plain (secondary) **Add an address** button. Nothing is marked missing or in error. |
| **Adding or changing** | The form: first name and last name, street address, apt/suite (optional), city, state (dropdown), ZIP, the note "US addresses only for now.", then **Save address** and **Cancel**. Opens when the buyer taps Add or Change, or already open when they arrive from a `needs_address` email (the page scrolls to it). |
| **Saved** | The address as a short card (name, street and apt, "City, ST ZIP"), with **Change address** and **Remove**. Remove asks to confirm: "Remove {name}'s address? We'll ask for it again before their next gift." |
| **Shared by the list owner** | A read-only line: "Gifts ship to {name}'s own address in {City, ST}. They keep it up to date." No fields, no Change, no Remove. The street is never sent to the buyer's browser. |

When the address is empty and the form opens, the recipient's first and last name start out filled from the person's name: the last word is the last name, everything before it is the first name ("Mary Jane Smith" → "Mary Jane" / "Smith"; a one-word name fills the first name only). The buyer can edit both. When an address is saved, or imported with names, the stored names are shown instead.

### The fields and their checks

The form requires everything Zinc needs for an order except the phone, so a saved address is ready to order with. US only for now: the country is stored as `US` and isn't shown as a field.

| Field | Column | Required | Check (after trimming spaces) |
|---|---|---|---|
| First name | `recipient_first_name` | Yes | 1–200 characters |
| Last name | `recipient_last_name` | Yes | 1–200 characters |
| Street address | `address_line1` | Yes | 1–200 characters |
| Apt, suite | `address_line2` | No | Up to 200 characters; empty saves as null |
| City | `city` | Yes | 1–200 characters |
| State | `state` | Yes | One of the 50 states or DC, as the two-letter code. A lowercase or full state name from an import doesn't pass and is fixed in the form. |
| ZIP | `zip` | Yes | 5 digits, or 5 + hyphen + 4 (`33602`, `33602-1234`). 9 digits typed without the hyphen are accepted and saved with it. |
| (country) | `country` | Set by the server | Always `US` |

The 200-character limit is the one the contacts import already uses (`MAX_ADDRESS_FIELD` in `people/rules.ts`), an input-size guard rather than a business value. The list of states is a true constant (T23). Error messages are plain and per field, for example "Add a city", "Pick a state", "Enter a 5-digit ZIP code".

**The check is a format check only** (Jim, 2026-11-03). No address is sent to any outside service to check it (T42). The address is "complete" when every required field passes the table above. One function in the people module decides this, and both the form and the round engine use it (see AC-10).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A person with no address | The buyer opens their page | The Shipping address section shows the "Optional for now" note and an **Add an address** button, below Budgets, with no form fields showing |
| AC-2 | A person with no address, page open | The buyer taps Add an address, fills every required field correctly and saves | The address is saved with `country = 'US'` and `address_checked_at` set to now. The section shows the saved card. Works at phone (375 px) and desktop (1280 px) width |
| AC-3 | The form open for a person named "Mary Jane Smith" with no address | — | First name shows "Mary Jane" and last name "Smith", editable |
| AC-4 | A saved address | The buyer taps Change address, edits a field and saves | The new value is saved and `address_checked_at` is updated |
| AC-5 | The form open | The buyer saves with a required field empty, a state that isn't one of the 51, or a bad ZIP | Nothing is saved (every address column is unchanged). Each bad field shows a plain message, and what the buyer typed stays in the form |
| AC-6 | A saved address the buyer entered | The buyer taps Remove and confirms | The names, both lines, city, state, ZIP and `address_checked_at` become null in one save, and `country` goes back to its default `US` (the column is `not null`). The section shows the "No address" state. Cancelling the confirm changes nothing |
| AC-7 | The engine on, and a round for this person in `needs_address` | The buyer saves a complete address | The round moves to `awaiting_approval` and the heads-up is sent, without waiting for the next tick (the ALL-28 hook). `round-engine.spec.ts` drives this through the form, not the service key |
| AC-8 | A `needs_address` email (first request, reminders and final notice) | The buyer taps "Add an address" and confirms | They land on the person's page with the address form open and in view |
| AC-9 | Other round emails that open the person's page (not about the address) | The buyer taps and confirms | They land on the person's page as today, with the form closed |
| AC-10 | A person whose address fails the format check (e.g. imported without recipient names, or with state "Florida") | A round for them starts, or a round in `needs_address` is advanced | The engine treats them as having no address: the round goes to (or stays in) `needs_address`. When the form opens, it shows the imported values with the failing fields marked |
| AC-11 | A person whose imported address passes the format check | A round starts | The round goes ahead without asking (no `needs_address`) |
| AC-12 | A person linked to a list whose owner shares their address (`public.shared_city_for_person` returns a city) | The buyer opens their page | The section shows the read-only "Gifts ship to {name}'s own address in {City, ST}" line, with no form, Change or Remove, even if the buyer saved an address of their own earlier (that one is kept, unshown, and comes back if the owner stops sharing). The page's HTML contains no street address |
| AC-13 | Another user's person id, or a person that doesn't exist | The address save or remove is called | Nothing changes, and the buyer sees the same not-found result as the other person-page actions |
| AC-14 | Any address save, remove or failed save | — | No log event or `round_*` event contains any address field or recipient name: ids only (E6). No outside service is called (T42) |

### Out of scope

| What | Where it goes instead |
|---|---|
| A phone number for the recipient | Not collected (T42: nothing uses it until checkout, and for a gift the buyer often won't know it or want to share it). The `people.phone` column stays and stays empty. |
| The buyer's own phone, which Zinc needs on every order | **The checkout setup ticket** (§6.1 step 6, ALL-30's checkout setup) asks the buyer once for their own phone, because ordering can't work without one. Noted on that ticket. |
| Checking that an address really exists (USPS, Google) | Not now (Jim, 2026-11-03). If Zinc's invalid-address errors show up in real orders, a later ticket adds one with its own T# decision. |
| The round engine and orders using a list owner's shared address (counting it as "ready", and shipping to it ahead of the buyer's own entry) | **ALL-63**, which turns sharing on. Until then no address can be shared, so the engine reading only the person's own row is correct. Noted on ALL-63, so a shared address never leads to `needs_address` emails pointing at a read-only page. |
| What happens when Zinc rejects an address at order time, or an order would ship to a removed address | **The order ticket (ALL-30)**: refuse to order without a complete address, and send the round back to `needs_address` with the address email, the same way for a Zinc "invalid address" error. Noted on that ticket. |
| Suggesting an address update to a list owner who shares their address | New follow-up ticket "Suggest an address update to a list owner", blocked by ALL-63 (Jim, 2026-11-03). |
| Turning on address sharing, and your own "My address" | ALL-63. Until it ships nobody can share an address, so every buyer sees the normal form. |
| Addresses outside the US, military (AA/AE/AP) and territory addresses | Later, when there's a need. |
| Asking for the address when a person is added | Not done, on purpose (decision 45: ask late, ask once). |

### Open questions

None left. Each was settled with Jim on 2026-11-03 (below).

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| How is an address checked on save? | **Format checks only**: required fields, a real state code, ZIP shape, lengths. `address_checked_at` means "passed our format check". (Jim) | Keeps the address with us (T42), adds no vendor (E1) and costs nothing. What's left is a real-looking address that doesn't exist or is missing an apartment number. That comes back as Zinc's invalid-address error at checkout and is handled by the order ticket (Out of scope). USPS (free, OAuth, sends every address to USPS) and Google (about 1.7¢ a check) were the alternatives. |
| Which fields are required? | First and last name, street, city, state, ZIP. Apt/suite optional. **[Claude's call]**, Jim deferred to best practice | Everything Zinc needs except the phone, so a saved address can be ordered with as is. |
| US only? | Yes. Country is stored as `US` and not shown; 50 states plus DC. **[Claude's call]** for leaving out military and territories | The ticket's scope; Zinc's US retailers. |
| Pre-fill the recipient's name? | Yes, from the person's name when the address is empty, split on the last space. **[Claude's call]** | Saves typing on a phone. It's a name the buyer gave us, so it's not inferring anything (T42). |
| Ask for a phone? | **No.** The checkout setup ticket asks for the buyer's own phone. (Jim) | T42: no fields "for later". The carrier is the only user of the number. |
| Clearing an address | A **Remove** link with a confirm step clears every address column at once. Emptying a required field and saving is an error, not a removal. Rounds already past `needs_address` stay where they are. (Jim) | Nothing half-filled is ever saved (the ticket's rule). Gift ideas don't depend on the address, so there's nothing to undo. The order ticket refuses to buy without a complete address. |
| A list owner's shared address | **Read-only** for the buyer: city and state only, no edit or remove. "Suggest an update" is a separate ticket. (Jim) | The address belongs to the list owner (decisions 38 and 41), and the street must never reach the buyer. The suggest flow needs ALL-63 and a new email, and would hold up the critical path. |
| When is an address "ready" for the engine? | **The same format check the form uses**, run when the round store loads the person, replacing today's "line 1, city, state and ZIP are filled". (Jim) | One definition of a complete address. Good imports go ahead with no extra question; bad ones are caught before buying. No migration or backfill. The stricter "trust only form-saved addresses" would ask about every imported person once. |
| Imported non-US addresses | The format check also requires `country = 'US'`, so a round for such a person goes to `needs_address`. The form opens with the imported fields, and saving stores `US`. If the buyer can't give a US address, the round is skipped at the deadline as usual. **[Claude's call]** | US only for now; Zinc's retailers ship within the US. |
| A shared address and the buyer's own entry both exist | The shared one wins on the page (AC-12). The buyer's own entry is kept but not shown, and comes back if the owner stops sharing. Which one the engine and orders use is ALL-63's. **[Claude's call]** | The list owner knows their address best (decision 38). Keeping the buyer's entry means turning sharing off never loses data. |
| Where on the page? | **Option C**: its own section below Budgets. The "No address" state is a quiet note and a secondary button, not an open form. (Jim) | Having no address is normal until a round needs one (decision 45). The email opens the form directly, so its position lower on the page doesn't cost the buyer a scroll. |
| Its own Save, or part of the Edit form? | Its own section and Save. **[Claude's call]**, follows option C | Fixing an address shouldn't re-save the name and dates. Keeps each form short on a phone. |
| How the email opens the form | The `needs_address` emails get their own action whose done page goes to `/people/{id}?address=open#address`; the person page opens the form when it sees that. Other round emails keep `open_person`. **[Claude's call]** | AC-8 and AC-9. A query flag (not only a `#` anchor) lets the server render the form open, with no extra client code. |
| How saving reaches the round engine | The address save calls the same `resumeRoundsForPerson` hook as `updatePerson`, through one shared helper in `people/people.ts`. **[Claude's call]** | The ticket asks for saving to go "through `updatePerson`" so the hook fires. A separate save with the same hook gives the same result without making the Edit form carry the address. |

## Principles check

- **Simplest version?** Format checks only, no vendor. No migration: every column and the owner's update grant already exist (`20261102150000_people_v1_2.sql`). No new settings: the only numbers are an input-size guard and the list of states, both constants. No phone, no non-US, no suggest-an-update.
- **Hard-coded values?** None new (T23). The 200-character guard is the existing `MAX_ADDRESS_FIELD`; US states are a true constant.
- **Product boundaries?** Concierge only. Reading a shared city goes through the existing `public.shared_city_for_person` function (`20261101180000_list_links_follow_sharing.sql`), which nothing in the app calls yet; it raises P0002 for a person that isn't the caller's, and the page has already returned 404 before calling it. No lists table is read or written (T19).
- **New personal data?** No new columns or fields beyond the address the round engine needs now (P-5, T42 (1)). The address is written only to `public.people`, which only its owner can read (T26). It never goes into logs, events or outside services (E6, T42 (4)). The phone is deliberately not collected.
- **Breaking changes / migrations?** None expected. If one turns out to be needed, it must be expand-only, because CI applies it to dev then prod on merge (T50).
- **Off switch (E7, E9)?** The form only writes the buyer's own rows. Rounds resume only when `round_engine_enabled` = 1, which stays 0 on production until ALL-27. Rolling back is Vercel's instant rollback; the columns already existed.
- **Docs and decisions** that need updating: design §6.1 step 5 (resolve the **[Verify]**: format check only, and why), §6.1 step 4 (the form exists), the §3 `people` row (`address_checked_at` meaning). Decisions: a new **T51** for "format checks only, and the engine uses the same check". Linear: notes on ALL-30 (buyer's phone at checkout setup; refuse or bounce on a missing or rejected address), and the new suggest-an-update ticket.

## Plan

**Architecture:** the address check is pure logic in `packages/core/src/address.ts`, because the client form (state list), the people service (save) and the round store (is it ready?) all need it, and ALL-63's "My address" will reuse it. The people module gets `saveAddress` and `removeAddress` (service, store, `people.ts`), sharing the round-resume hook with `updatePerson`. The person page gets a client `AddressSection` below Budgets, opened by `?address=open` from a new `add_address` email action. No migration.

**Tech stack:** TypeScript, Next.js 16 server actions and server components, Supabase (signed-in client, RLS), Vitest (core, web with jsdom), Playwright (android, iphone and desktop projects; the round-engine spec is desktop only).

**Global constraints** (from the spec; every task includes them):
- The address, recipient names and form values never appear in `logEvent`, `console.*` or events. Ids only (E6, AC-14).
- No outside service gets the address (T42). No new settings or env vars (T23). No migration; if one turns out to be needed, it's expand-only (T50).
- Country is always `US`. The fields and checks are exactly the spec's table: 200-character maximum, 50 states plus DC, ZIP `NNNNN` or `NNNNN-NNNN`, 9 bare digits saved as `NNNNN-NNNN`.
- Copy is exactly as in the spec ("Optional for now. We'll ask before their first gift ships.", "Add an address", "Save address", "Change address", "Remove", "US addresses only for now.", the Remove confirm, the shared line).
- Don't mock our own code or Supabase in new tests (E5). New component tests take actions as props. The existing `person-view.test.tsx` mocks `@/modules/concierge`; we only add cases to it and don't spread that pattern.

**Review focus** (failure modes the ACs don't name; each has a test in the task shown):
1. A buyer pastes a ZIP with spaces (`" 33602 "`) or a ZIP+4 without the hyphen: it's trimmed and normalized, not refused (Task 1).
2. An imported address with a lowercase state (`"fl"`) or a full state name: it fails the check and isn't silently uppercased into a pass (Task 1).
3. Saving a shared-address person through a forged form post is refused on the server, not only hidden in the UI (Task 2).
4. Any address save or remove (Task 2), and any failed round resume (Task 2), leaves no address text in logs.
5. A person whose imported address is incomplete shows a card that says it needs fixing, rather than looking finished (Task 5).

### Task 1: The address check, in core [P] (AC-3, AC-5, AC-10, AC-11)

**Files:**
- Create `packages/core/src/address.ts` and `packages/core/src/address.test.ts`.
- Modify `packages/core/src/index.ts` to export it.
- Modify `apps/web/modules/concierge/people/rules.ts:155` to import `ADDRESS_FIELD_MAX` instead of declaring `MAX_ADDRESS_FIELD`.

**Produces:**
```ts
export const ADDRESS_FIELD_MAX = 200; // input-size guard, not a tunable
export const US_STATES: readonly { code: string; name: string }[]; // 50 states + DC, A–Z by name
export type AddressField = "firstName" | "lastName" | "line1" | "line2" | "city" | "state" | "zip";
export type AddressDraft = Partial<Record<AddressField, string | null>>;
export type Address = { firstName: string; lastName: string; line1: string; line2: string | null; city: string; state: string; zip: string };
export function checkAddress(d: AddressDraft): { ok: true; value: Address } | { ok: false; errors: Partial<Record<AddressField, string>> };
export function isShippableAddress(d: AddressDraft & { country?: string | null }): boolean; // country === "US" && checkAddress ok
export function splitRecipientName(name: string): { firstName: string; lastName: string };
```

- [ ] **Step 1: Write the failing tests** in `address.test.ts`:
  - **Valid address:** trims every field; `line2: ""` → `null`; `zip: "336021234"` → `"33602-1234"`; `" 33602 "` → `"33602"`; `state: "DC"` passes.
  - **Errors by field:** each required field missing gives exactly these messages: `firstName` "Add their first name.", `lastName` "Add their last name.", `line1` "Add a street address.", `city` "Add a city.", `state` "Pick a state.", `zip` "Enter a 5-digit ZIP code."
  - **Bad values:** `state` `"fl"`, `"Florida"` and `"PR"` → "Pick a state."; `zip` `"3360"`, `"ABCDE"` and `"33602-12"` → the ZIP message; any field longer than 200 characters → "Keep this under 200 characters."; several bad fields give several errors.
  - **`isShippableAddress`:** false for `country` `"CA"`, null or missing; true for a valid address with `"US"`; false when the names are missing.
  - **`splitRecipientName`:** "Mary Jane Smith" → "Mary Jane"/"Smith"; "Cher" → "Cher"/""; "  Ann  Lee " → "Ann"/"Lee"; "" → ""/"".
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/core test address`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `address.ts`. A state is exact-match against `US_STATES` codes; no case folding (Review focus 2). Point `rules.ts` at `ADDRESS_FIELD_MAX`.
- [ ] **Step 4: Run** `pnpm --filter @gifts-af/core test` and `pnpm --filter @gifts-af/web test people-rules`. Expected: PASS; the import tests are unchanged.
- [ ] **Step 5: Commit** `feat(core): address format check for US shipping (ALL-81)`

### Task 2: Save and remove an address in the people module (AC-2, AC-4, AC-5, AC-6, AC-12 server side, AC-13, AC-14)

**Files:**
- Modify `apps/web/modules/concierge/people/rules.ts`: add `parseAddressForm`.
- Modify `store.ts`, `service.ts`, `people.ts` and `apps/web/modules/concierge/index.ts`.
- Modify `apps/web/modules/concierge/__tests__/fake-people-store.ts`.
- Test in `__tests__/people-rules.test.ts` and `__tests__/people.test.ts`.

**Consumes:** Task 1's `checkAddress`, `Address`, `AddressField` and `isShippableAddress`.

**Produces:**
```ts
// rules.ts. FormData fields: firstName, lastName, line1, line2, city, state, zip
export type AddressSaveResult = { ok: true } | { ok: false; error: string; fields?: Partial<Record<AddressField, string>> };
export function parseAddressForm(f: FormData): { ok: true; value: Address } | { ok: false; error: "Check the address below."; fields: Partial<Record<AddressField, string>> };
// store.ts (PeopleStore)
address(personId: string): Promise<(AddressDraft & { country: string | null }) | null>; // null = not yours
sharedCity(personId: string): Promise<{ city: string; state: string } | null>;     // rpc shared_city_for_person
saveAddress(personId: string, a: (Address & { checkedAt: string }) | null): Promise<boolean>; // null clears
// service.ts
export type PersonAddress =
  | { kind: "none" }
  | { kind: "own"; address: AddressDraft; problems: Partial<Record<AddressField, string>> } // problems empty = complete
  | { kind: "shared"; city: string; state: string };
PersonDetail gains `address: PersonAddress`.
export function saveAddress(store, id, a: Address, now: Date): Promise<SaveResult>;
export function removeAddress(store, id): Promise<SaveResult>;
// people.ts (server): saveAddress(id, a: Address) runs the resume hook; removeAddress(id) doesn't
```

- [ ] **Step 1: Write the failing tests.**
  - `people-rules.test.ts`: `parseAddressForm` returns the value from good FormData and per-field errors from bad.
  - `people.test.ts`, against the fake store:
    - (a) `saveAddress` writes the trimmed fields, `country` "US" and `checkedAt` equal to `now.toISOString()` (AC-2, AC-4).
    - (b) `removeAddress` calls `saveAddress(id, null)` (AC-6).
    - (c) Another user's id, a non-uuid, or a deleted person gives "That person wasn't found." and no write (AC-13).
    - (d) When `sharedCity` returns a city, both save and remove give "Their address is kept by them." and nothing is written (Review focus 3).
    - (e) `getPerson` maps addresses to `PersonAddress`:
      - all columns null → `none`
      - a valid row → `own` with no problems
      - an imported row with state "Florida" and no names → `own`, with problems on `state`, `firstName` and `lastName`
      - `sharedCity` set → `shared` with no street anywhere in the result (`JSON.stringify` has no `line1`)
    - (f) A failing store write gives "That couldn't be saved. Try again.", and the spied `console.error` calls contain none of the address strings (AC-14, Review focus 4).
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test people`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Store.** `address()` selects `recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country` for one live person. `saveAddress(null)` sets those to null, `country` to `'US'` and `address_checked_at` to null (the column is `not null default 'US'`). Either way it returns whether a row changed. `sharedCity()` calls `rpc("shared_city_for_person", { p_person_id })` on the `public` client.
  - **Fake store.** It mirrors these, with a settable `shared` map.
  - **Service.** `saveAddress` and `removeAddress` go through `onOwnPerson`, then refuse when shared. `getPerson` adds `address` and `sharedCity` to its `Promise.all`. Shared wins over the buyer's own row; an own row with every field null is `none`.
  - **`people.ts`.** Pull the resume block out of `updatePerson` into `async function resumeWaitingRounds(id: string): Promise<void>`. Call it from `updatePerson` and from `saveAddress` (after `ok`), with `new Date()` passed into the service.
  - **Index.** Export `saveAddress`, `removeAddress`, `parseAddressForm`, and the types `PersonAddress` and `AddressSaveResult`.
- [ ] **Step 4: Run** `pnpm --filter @gifts-af/web test people`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(people): save and remove a person's address (ALL-81)`

### Task 3: The round engine uses the same check [P with Task 2] (AC-10, AC-11)

**Files:**
- Modify `apps/web/modules/concierge/rounds/store.ts:263-287`.
- Test in `apps/web/e2e/round-engine.spec.ts` (Task 6).

**Consumes:** Task 1's `isShippableAddress`.

- [ ] **Step 1:** In `roundContext`, select `name, recipient_first_name, recipient_last_name, address_line1, address_line2, city, state, zip, country`, and set `hasAddress: isShippableAddress({...})` mapped from those columns. Remove `filled` if it no longer has a use.
- [ ] **Step 2:** Run `pnpm --filter @gifts-af/web test round-engine` and `pnpm typecheck`. Expected: PASS. The engine test uses the fake store's boolean, and the real query is proven by Task 6's e2e, which fails before this change: an imported "Florida" address would let the round go ahead.
- [ ] **Step 3: Commit** `feat(rounds): a round needs a complete, well-formed address (ALL-81)`

### Task 4: The "Add an address" email opens the form [P] (AC-8, AC-9)

**Files:**
- Modify `apps/web/modules/concierge/notify/actions.ts` and `rounds/engine.ts:276,299-306`.
- Test in `__tests__/links.test.ts` and `__tests__/round-engine.test.ts`.

**Produces:** `ActionName` gains `"add_address"`, whose done page goes to `/people/{personId}?address=open#address`.

- [ ] **Step 1: Write the failing tests.**
  - `links.test.ts`: `add_address` with a round gives `next: "/people/person-1?address=open#address"`; with no round, a plain done page.
  - `round-engine.test.ts`, in the existing address-path test (AC-8): every link created for a `needs_address` email has `action: "add_address"`, and the heads-up, reminder, final notice and skipped links stay `open_person`. That's the AC-5 assertion at line 189, plus a new one.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test links round-engine`. Expected: FAIL.
- [ ] **Step 3: Implement.** `add_address` has confirm copy title "Add their address", body "Confirm to open this person's page at their address.", button "Add an address", and done copy title "Done", body "Open their page to add the address." `next` reuses `store.roundPersonId`. In `sendEmail`, the three `needs_address` cases use `{ ...link, action: "add_address" }`. No migration: `action_links.action` has no check constraint (verified).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notify): address emails open the address form (ALL-81)`

### Task 5: The Shipping address section on the person page (AC-1 to AC-6, AC-12; layout option C)

**Files:**
- Create `apps/web/app/people/[id]/address.tsx` and `app/people/[id]/__tests__/address.test.tsx`.
- Modify `app/people/actions.ts` (add `saveAddressAction` and `removeAddressAction`), `app/people/[id]/person-view.tsx`, `app/people/[id]/page.tsx` and `__tests__/person-view.test.tsx`.

**Consumes:** Task 2's `PersonAddress`, `AddressSaveResult`, `parseAddressForm`, `saveAddress` and `removeAddress`; Task 1's `US_STATES` and `splitRecipientName`; Task 4's `?address=open`.

**Produces:**
- `AddressSection({ personId, name, address, startOpen, saveAction, removeAction })` renders `<section id="address" aria-labelledby="address-heading">` with the heading "Shipping address".
- `saveAddressAction(prev, formData): Promise<AddressSaveResult>` parses the form, saves, and revalidates `/people/{id}`.
- `removeAddressAction(prev, formData): Promise<SaveResult>`.

- [ ] **Step 1: Write the failing tests** in `address.test.tsx`, with `vi.fn` actions as props:
  - **`none`:** shows the note and an "Add an address" button and no textboxes (AC-1). Clicking it shows the fields, with First name "Mary Jane" and Last name "Smith" for "Mary Jane Smith" (AC-3), the state `<select>` with 51 options plus a "Choose…" placeholder, and the US-only note.
  - **`startOpen`:** the form shows at once.
  - **Save:** sends `id` plus the seven fields; on `{ok:true}` the form closes. On `{ok:false, fields}`, each message shows under its field (`aria-describedby`), and the typed values are kept (AC-5).
  - **`own`, complete:** the card shows "Mary Smith", "12 Oak Lane, Apt 3" and "Tampa, FL 33602", plus "Change address" and "Remove". Change opens the form filled with the stored values (AC-4).
  - **`own`, with problems:** the card adds "Something's missing. Change the address to fix it.", and opening the form shows the problem messages.
  - **Remove:** opens the dialog "Remove Mary Smith's address?" (it uses the person's `name`) with the body "We'll ask for it again before their next gift.". Cancel calls nothing; Remove calls `removeAction` with `id` (AC-6).
  - **`shared`:** shows "Gifts ship to Mom's own address in Tampa, FL. They keep it up to date." with no buttons or textboxes (AC-12).

  In `person-view.test.tsx`:
  - The section comes after the Budgets heading and before "Link to their list".
  - `openAddress` passes `startOpen`.
  - A `shared` person's rendered HTML has no `line1` text.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test address person-view`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Component.** Follow `list-link.tsx` and `delete-person.tsx`: a plain client component with `useState` and a `Dialog` for the confirm. Inputs use `autoComplete`: `given-name`, `family-name`, `address-line1`, `address-line2`, `address-level2`, `address-level1`, `postal-code`. The ZIP uses `inputMode="numeric"`.
  - **Opening from the email.** When the form starts open, scroll the section into view on mount.
  - **Page.** `page.tsx` reads `searchParams.address === "open"` and passes `openAddress` to `PersonView`, which renders the section between `<Budgets>` and `<ListLink>`.
  - **Next.js.** Check `node_modules/next/dist/docs/` for `searchParams` and server actions before writing them.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(people): shipping address section on the person page (ALL-81)`

### Task 6: End-to-end, at phone and desktop width (AC-1, AC-2, AC-4 to AC-8, AC-10)

**Files:**
- Create `apps/web/e2e/person-address.spec.ts`. It runs on all three projects.
- Modify `apps/web/e2e/round-engine.spec.ts` (desktop only).

- [ ] **Step 1: Write `person-address.spec.ts`.** Sign in as `TEST_USER`, add a person named "Rita Address Test" through `add_person`, then:
  1. See "Add an address" and no textboxes (AC-1).
  2. Open the form; save with City empty and ZIP "123" to get "Add a city." and the ZIP message. The service key confirms `address_line1` is still null (AC-5).
  3. Fill everything and save to get the card. The service key reads `country` "US" and a non-null `address_checked_at` (AC-2).
  4. Change the city and save to see the new city (AC-4).
  5. Remove, cancel and confirm the card is still there; Remove and confirm to see the empty state, with every column null except `country` "US" (AC-6).

  Delete the person in `afterAll`. Name the person per project, so parallel runs don't collide.
- [ ] **Step 2: Rewrite step 2 of `round-engine.spec.ts`** (AC-7, AC-8, AC-10):
  - Seed the person through the service key with an imported-style address (state "Florida", no names). The first tick still gives `needs_address`, which proves Task 3.
  - Make an `add_address` action link the way `action-links.spec.ts` does (raw token, SHA-256 hash, inserted with the service key, `round_id` set).
  - Open `/a/{token}`, confirm, and follow the done button. The URL has `?address=open`, and the form is visible, filled with the imported values, with "Pick a state." and the name messages shown.
  - Fix them in the form and Save address. Then the round reaches `awaiting_approval` and one `heads_up` is sent.
  - Remove the service-key PATCH and the bare Save click.
- [ ] **Step 3: Run** `pnpm --filter @gifts-af/web e2e person-address round-engine` (the README's script; local Supabase running). Expected: both FAIL before Tasks 3 to 5 if run against `main`, and PASS on the branch. Record both runs for the evidence.
- [ ] **Step 4: Commit** `test(e2e): address form on phone and desktop, and the address email path (ALL-81)`

### Task 7: Docs and Linear (done alongside the spec push, on `main`)

- [x] `design/decisions.md`: add **T51** ("A person's address is checked by format only, and the round engine uses the same check").
- [x] `design/technical-design.md`:
  - §6.1 step 4: the form exists (ALL-81).
  - §6.1 step 5: resolve the **[Verify]** with the T51 answer.
  - §3 `people` row: `address_checked_at` means "passed our format check"; the phone isn't collected.
- [x] Linear:
  - Comment on ALL-30: refuse without a complete address; send the round back to `needs_address` on a missing or rejected address; ask the buyer for their own phone at checkout setup.
  - Comment on ALL-63: the engine and orders should count a shared address as ready, and a shared address wins.
  - Created [ALL-86](https://linear.app/allens-forever/issue/ALL-86) "Suggest an address update to a list owner", blocked by ALL-63, priority Low.
  - Move ALL-81 to In Progress.

### Task 8: Verify, review, ship, evidence

- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo root, plus the e2e from Task 6. Every one passes; note the counts.
- [ ] Get a code review with superpowers:requesting-code-review, and fix what it finds.
- [ ] Open the PR. Title: `feat: add and edit a person's shipping address on their page (ALL-81)`. The body says how we'll see it working on production (the form on giftsaf.com) and how to turn it off (instant rollback; no data change). Use **`Part of ALL-81`**, because the live check on giftsaf.com happens after merge.
- [ ] Screenshots of the address section in the "No address", form-open, form-with-errors and saved states, at 375 px and 1280 px, light and dark, taken with a throwaway Playwright script in the scratchpad. Upload them into the Linear evidence comment along with the tests (each seen failing first), the suite counts, CI, and the round-engine e2e result.
- [ ] After merge: on giftsaf.com, add a test person, add, change and remove an address, then delete the test person. Post the result. Move ALL-81 to Done only when nothing is Still open.

## Before coding: consistency check

- [x] **Every acceptance criterion maps to a task and a test:**
  - AC-1 → 5, 6
  - AC-2 → 2, 5, 6
  - AC-3 → 1, 5
  - AC-4 → 2, 5, 6
  - AC-5 → 1, 2, 5, 6
  - AC-6 → 2, 5, 6
  - AC-7 → 6
  - AC-8 → 4, 6
  - AC-9 → 4
  - AC-10 → 1, 2, 3, 6
  - AC-11 → 1, 3
  - AC-12 → 2, 5
  - AC-13 → 2
  - AC-14 → 2
- [x] **Every task traces back to a story or criterion.**
  - Task 7 is the docs the Principles check lists.
  - Task 8 is CLAUDE.md's evidence rule.
  - Core placement (Task 1) is needed because a client component can't import `@/modules/concierge` (it's server-only).
- [x] **No open questions are left.**
- [x] **The types line up:**
  - `Address`, `AddressDraft`, `AddressField`, `checkAddress`, `isShippableAddress`, `splitRecipientName` and `US_STATES` are defined in Task 1 and used under the same names in Tasks 2, 3 and 5.
  - `PersonAddress` and `AddressSaveResult` are defined in Task 2 and used in Task 5.
  - `add_address` and `?address=open` are defined in Task 4 and used in Tasks 5 and 6.

## Done: evidence on the ticket (T44)

- [ ] Test evidence on ALL-81: the tests added (each seen failing first), suite counts, lint, typecheck, build and CI.
- [ ] Screenshots of the address section at phone and desktop width, light and dark, uploaded into the comment.
- [ ] The round-engine e2e: imported bad address → `needs_address` → email link → form → `awaiting_approval` + heads-up.
- [ ] A live check on giftsaf.com after deploy, with the test person deleted, or listed as **Still open**.
