# ALL-63 "My address" in Settings, and "Let people with my list ship gifts to me": Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a list owner can save their own address and choose to let people who linked their list ship gifts to them, and a round for such a person goes ahead without asking the buyer for an address.

**Links:** [ALL-63](https://linear.app/allens-forever/issue/ALL-63) · schema [ALL-44](https://linear.app/allens-forever/issue/ALL-44) (`design/plans/ALL-44-schema-v1-1.md`) · buyer's side [ALL-81](https://linear.app/allens-forever/issue/ALL-81) (`design/plans/ALL-81-person-address.md`, AC-12) · orders [ALL-30](https://linear.app/allens-forever/issue/ALL-30) and [ALL-32](https://linear.app/allens-forever/issue/ALL-32) · launch requirement [ALL-98](https://linear.app/allens-forever/issue/ALL-98) · product decisions 38, 39, 41, 42, 43, 45, 53 · T16, T19, T23, T42, T51, T61 · follow-ups [ALL-86](https://linear.app/allens-forever/issue/ALL-86), [ALL-96](https://linear.app/allens-forever/issue/ALL-96) · mock-ups: v2, owner-approved 2026-11-06, posted on the ticket (the wording below replaces theirs where they differ).

## Spec: what it does

### Why

The table, the sharing functions and the buyer's read-only line all exist, but nobody can save their own address or turn sharing on. ALL-81 left one job here: the round engine only looks at the address the buyer typed, so once sharing exists, a person with a shared address would get "add an address" emails that lead to a read-only page.

### Who can see the street (T61)

Inside GiftsAF, a buyer sees only the owner's city and state. But buyers order through their own Zinc account, and Zinc's order API returns the shipping address, so the person ordering may be able to see the street there. The owner accepted this for friends and family (2026-11-06), so the switch says so plainly. Today only test and admin users can connect a wallet (decision 53). ALL-98 makes moving off personal Zinc accounts a requirement before anyone else can order.

### Who it's for and what they can do

1. **Save my address:** as a signed-in person, I can add, change or remove my address in Settings. Only I can read it in GiftsAF.
2. **Share it with gift givers:** as someone with a list, I can turn on "Let people with my list ship gifts to me" on my list page. People who linked my list through my current share link see my city and state in GiftsAF.
3. **Turn it on in one go:** with no address saved, turning the switch on asks for my address once, and saving also turns sharing on.
4. **Stop sharing:** I can turn the switch off. My address stays saved, so turning it back on is one tap. Removing my address also stops sharing, and the confirm says so.
5. **No needless asking:** as a buyer whose person shares their address, my round goes ahead without asking me for one, including when sharing starts or I link their list while the round is waiting.

### What people see

**Settings > My address**, a section on the Settings page, with its own Save, separate from the time zone form. It shows only once the person has a list or a saved address (owner, 2026-11-06), because it does nothing for them otherwise (principle 10).

| State | What shows |
|---|---|
| **No address** | "Only you can see this here. It's used only if you let people with your list ship gifts to you." and an outline **Add my address** button. |
| **Adding or changing** | The ALL-81 form: first name, last name, street, apt/suite (optional), city, state, ZIP, "US addresses only for now.", **Save address**, **Cancel**. Name fields start empty. |
| **Saved** | A card with name, street and apt, "City, ST ZIP", then **Change address** and **Remove**. Below: "Not shared. Change this on your list." or "Shared with people who have your list. Change this on your list.", linking to `/lists`. |
| **Remove, not shared** | Confirm: "Remove your address?" with "Past orders keep the address they shipped to." |
| **Remove, shared** | Confirm: "Remove your address?" with "People with your list won't be able to ship gifts to you until you add it and turn sharing on again. Past orders keep the address they shipped to." |

**List page**, below the list, only once the signed-in person has a saved list.

| State | What shows |
|---|---|
| **Off** | Switch and "Let people with my list ship gifts to me", with "Anyone with your list link can see your city and state in GiftsAF. The person ordering may be able to see your full address in their Zinc account." |
| **On** | Switch on, with "They see {City, ST} in GiftsAF. The person ordering may be able to see your full address in their Zinc account." and a **Change my address** link to Settings. |
| **Turning on, no address** | A dialog, "Where should gifts ship?", "Saving this turns sharing on.", the same form, **Save and share**, **Cancel**. Cancel leaves the switch off. |

All controls use the app's `Button`, `Switch`, `Input` and `Dialog` components, so the primary action is the standard teal button. Errors speak to the owner: "Add your first name.", not "Add their first name."

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | No address, and I have a list | I open Settings | The section shows the note and **Add my address**, with no form fields. With no list and no address, the section isn't shown |
| AC-2 | No address | I add a valid address and save | One row exists with `country = 'US'`, `address_checked_at` now, `share_for_gifts` false and `phone` null. The card shows. Works at 375 px and 1280 px |
| AC-3 | A saved address | I change a field and save | The value and `address_checked_at` update, and `share_for_gifts` is unchanged |
| AC-4 | The form open | I save with a missing field, a bad state or a bad ZIP | Nothing is saved. Each bad field shows a message in the owner's voice, and what I typed stays |
| AC-5 | A saved address | I tap Remove and confirm | The row is deleted and the section returns to No address. Cancel changes nothing. The wording depends on whether it's shared. Adding again starts with sharing off |
| AC-6 | Another user's address | I read, write or delete it through the API | I get nothing and change nothing (RLS). The actions never take a user id from the form |
| AC-7 | A saved address, switch off | I turn the switch on | `share_for_gifts` is true, and the wording shows my city and state |
| AC-8 | Switch on | I turn it off | `share_for_gifts` is false, and the address is still saved |
| AC-9 | No address | I turn the switch on, fill the dialog and save | One write creates the row with `share_for_gifts` true. A bad field keeps the dialog open with nothing saved. Cancel saves nothing and leaves the switch off |
| AC-10 | A stale page: no row now | The sharing action is called | It writes nothing and returns a message telling me to add my address |
| AC-11 | A signed-in person with no saved list, or a guest | They open the list page | There's no switch. Saving a first list shows it without a reload |
| AC-12 | Any signed-in person on the list page | The page loads | The street and recipient names aren't in the page's HTML or data. It reads only `city`, `state` and `share_for_gifts` |
| AC-13 | A buyer's person linked through my current share link, sharing on | The buyer opens the person's page | They see "Gifts ship to {name}'s own address in {City, ST}…", and the page's HTML has no street |
| AC-14 | The same, sharing off or my address removed | The buyer opens the page | They see their own entry or the empty state, with no city of mine |
| AC-15 | A linked buyer, sharing on | My list's share token is reset | The buyer sees no city, and `shared_address_for_person` returns null (`lists.active_link`, decision 43). Proven in pgTAP, since the app has no reset button |
| AC-16 | A round for a linked person with no address of the buyer's, sharing on | A round starts, or a `needs_address` round is advanced | `hasAddress` is true, no address email goes out, and the round moves on |
| AC-17 | The same, sharing off or the link revoked | A round starts or is advanced | It goes to, or stays in, `needs_address` |
| AC-18 | A shared row exists but fails `isShippableAddress`, and the buyer has a good entry of their own | A round is advanced | `hasAddress` is false. The shared row alone decides, the same as `recipientAddress` on the ALL-32 branch |
| AC-19 | A round waits in `needs_address`, with its next reminder days away | Sharing is turned on, and the next daily tick runs | The round moves on with no address email. On days with no reminder due and no address, it stays silent |
| AC-20 | A round waits in `needs_address`, sharing already on | The buyer links that person's list | The same thing happens as when the buyer saves an address: the same hook runs, and any address hold is tried again. Whether that's in the request or the next tick is T54's and ALL-27's call |
| AC-21 | Sharing is turned on after the last tick before the deadline | The deadline tick runs | The round is skipped and the buyer gets the usual skip email. The deadline skip still comes first |
| AC-22 | A failed read, save, remove or sharing change | The log output is captured in a test | It holds `user_id`, an outcome and an error code. No address field or name appears (E6, T42) |
| AC-23 | Reading my address fails | I open Settings or the list page | It never looks like "no address". Settings says it couldn't load, the switch is hidden, and nothing can overwrite my real address |

### Out of scope

| What | Where it goes instead |
|---|---|
| Sharing withdrawn after approval: hold and ask (owner decision) | **ALL-30/ALL-32**, not built yet. **ALL-63 doesn't merge until this is on `main` with a test** (Task 8) |
| Zinc rejects a shared address: no blind retry, honest wording, neutral email to the owner (owner decision) | **ALL-30/ALL-32**, not built yet, same gate |
| Reading the address just before `begin_placing` | **ALL-30/ALL-32**, noted on ALL-32 |
| What the approval screen does when sharing is withdrawn during `awaiting_approval` | **ALL-29**, with a note on that ticket. `approveAndBuy` already refuses with `no_address` on the ALL-32 branch |
| Moving off personal Zinc accounts | **ALL-98**, required before anyone outside friends can order (T61) |
| Shipping a gift to "My address" (buy it to hand over yourself) | Not built: `approve.ts` sets `ship_to: "recipient"`. The wording doesn't promise it |
| A "reset my share link" button | Not built (owner decision). The switch stops address sharing, not the list link. AC-15 proves the database rule |
| Stopping one particular person, or seeing who linked my list | Not built. Decision 42: everyone with the link is treated alike |
| Resuming rounds the moment sharing is turned on | Not built. The next daily tick does it (AC-19) |
| A phone number from the list owner | Not collected (T42). `account_addresses.phone` stays empty. Zinc gets the buyer's phone, accepted for friends and family (owner decision) and re-checked in ALL-98 |
| Stopping a person who writes a malformed row to their own address through the API | Not handled. It's only reachable by going around our forms. Their buyer gets address emails leading to a page with no form, then the usual skip email at the deadline |
| Suggesting an address update | ALL-86 |
| Moving every primary button to `Button` | ALL-96 |

### Open questions

None left. The owner answered all six on 2026-11-06.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Can a buyer see the street in their Zinc account? | Possibly, and that's accepted for friends and family, with plain wording on the switch. (Owner) **[Verify]** the dashboard during ALL-98 | Zinc's [order API](https://www.zinc.com/docs/v2/api-reference/orders/get-order.md) returns `shipping_address`. Only test and admin users can order today (decision 53). |
| What protects strangers later? | Moving off personal Zinc accounts is required before anyone outside friends can order. (Owner, T61, ALL-98) | T16 had no date or launch link. Decision 42 lets anyone with the link connect. |
| Sharing withdrawn after approval | Hold and ask. (Owner) To be built in ALL-32 | A purchase can't be undone (T18), and the fallback entry is hidden and may be an old import (T45). |
| Zinc rejects a shared address | Email the owner neutrally, with no item or sender. (Owner) To be built in ALL-32 | The buyer can't fix it, and the surprise holds (decision 39). |
| The buyer's phone on a shipment to a list owner | Accepted for friends and family. (Owner) | Zinc needs a phone on every order. Re-checked in ALL-98. |
| The reset-link criterion | A database test is enough, with no button, and the switch warns about earlier links. (Owner) | The rule exists and is tested in `link_revocation.test.sql`. |
| Where does the switch go? | The list page, below the list. (Owner) | It's where the owner thinks about who has their list. |
| Turning on with no address | A dialog asks once, and saving turns sharing on. (Shown to the owner) | Ask late, ask once (decision 45). |
| When sharing goes off, does the address go? | No. Remove does that. **[Claude's call]** | Turning it back on is one tap. Past orders' snapshots stay in `order_addresses`, and the Remove confirm says so. |
| How do waiting rounds notice a new share? | `needs_address` rounds are looked at on every daily tick, silently unless a reminder is due. Linking a list uses the same resume hook as saving an address. **[Claude's call]** | No new job (E1), and nothing reaches across accounts. A reminder's schedule could otherwise leave a round waiting for up to 16 days. |
| Which address decides "ready"? | A shared row if one exists, judged by `isShippableAddress` alone, otherwise the buyer's own. **[Claude's call]** | Matches `recipientAddress` and ALL-81's page, so there's one definition (T51). |
| Where does the code live? | `apps/web/lib/account-address.ts` for reads and writes, taking the Supabase client as an argument. The form moves to `components/address/`, and its result type moves to `packages/core`. **[Claude's call]** | `account_addresses` is shared by both products (decision 41), so it can't sit in either module (T19). A shared component can't depend on a product. |
| How does the list page show the switch? | `app/lists/page.tsx` loads the state and passes the switch to `GiftApp` as a `footer` prop, shown once a list id exists. **[Claude's call]** | The list can be created on the client, so a sibling wouldn't know. `modules/lists` learns nothing about addresses. |

## Principles check

- **Simplest version?** No migration, no new settings and no new job. No reset button, per-person control, phone, or resume across accounts.
- **Hard-coded values?** None new (T23). "Daily" is the existing tick. Field limits and the state list are constants in `packages/core`.
- **Product boundaries?** `lib/account-address.ts` touches only `public.account_addresses`. The concierge reads a shared address only through `public.shared_address_for_person` (T19). `modules/lists` gets one generic prop.
- **New personal data?** No new fields. An address is collected only when the person chooses to add one or turn sharing on (T42). The street stays off the list page (AC-12), and `roundContext` keeps only a true or false.
- **Bends a recorded decision?** Yes, on purpose. T61 narrows decision 41: "they see only your city and state" holds inside GiftsAF, while the person ordering may see more in their own Zinc account, until ALL-98.
- **Breaking changes / migrations?** None.
- **Off switch (E7, E9)?** Rolling back on Vercel removes the screens and restores the old engine, but shares already turned on stay on. The real off switch is `update public.account_addresses set share_for_gifts = false`, run with the owner's approval after saving the affected user ids, because it can't otherwise be undone. It's recorded in the PR. Shipping is separately gated by `zinc_ordering_enabled`.
- **How we'll see it working on production:** `account_address_saved` and `address_sharing_changed` events, and a live check with the QA account (T60): add, change, share, unshare and remove. Buyer-side sharing needs two accounts, and rounds are off on production (AC-16 to AC-21), so those are proven in CI's e2e on local Supabase and listed as such in the evidence.
- **Docs and decisions:** T61 in `design/decisions.md` (done), §3 of `design/technical-design.md` (done), and a pointer on decision 41 (done). Linear: ALL-32 note (done), ALL-29 and ALL-30 notes (Task 7).

## Plan

**Architecture:** account address reads and writes live in `apps/web/lib/account-address.ts`, taking the signed-in Supabase client as an argument. The ALL-81 form moves to `components/address/address-form.tsx`, used by the person page, Settings and the switch's dialog. The round store decides "ready" with a small pure function, and `needs_address` rounds get looked at on every daily tick. No migration.

**Tech stack:** TypeScript, Next.js 16 server actions and server components, Supabase (signed-in client, RLS), Vitest, pgTAP, Playwright. Read `apps/web/node_modules/next/dist/docs/` before writing Next-specific code, including `01-app/02-guides/preserving-ui-state.md`: with `cacheComponents`, visited routes stay in the DOM, hidden, with their state. Work in the worktree `.claude/worktrees/all-63` on `aarontallen/all-63-my-address`.

**Order:** ALL-32 merges first, because it rewrites `rounds/engine.ts`, `rounds/store.ts` and `people/people.ts`. Tasks 1 to 5 can be built now. Tasks 6 to 8 wait until ALL-32 is on `main`, and the branch rebases onto it.

**Global constraints**

- Copy is exactly as in the spec's "What people see" tables.
- Address fields, names and cities never appear in `logEvent`, `console.*` or events. Log `user_id`, an outcome and `error.code` only (AC-22). Never pass a Supabase error object to a log, because its `details` can hold the failing row.
- Actions get the user id from `supabase.auth.getClaims()`, never from the form.
- The list page's read selects only `city, state, share_for_gifts` (AC-12).
- `country` is always `US`. `phone` is never written.
- Don't mock our own code or Supabase (E5). The one exception is a fake client that injects a failed query for AC-22 and AC-23, where a real failure can't be forced. Normal behavior is proven in e2e against local Supabase.
- `components/address/` and `lib/account-address.ts` import nothing from `@/modules/*` (T19).
- Any `catch` around request data starts with `unstable_rethrow` (ALL-87).
- Switch state comes from props, not copied into `useState`, because the route can come back from hidden.
- Don't edit `apps/web/app/settings/actions.ts` or `modules/concierge/purchase/`. After the rebase, Task 6 edits only the three rounds and people files it names, plus `app/people/actions.ts`.

**Review Focus**

1. A person changes their address while sharing is on: the save must not turn sharing off (Task 7, against the real database).
2. The owner removes their address in one tab, then flips a stale switch in another: a plain message, no row, no crash (Task 7).
3. A first list is saved on the client: the switch appears without a reload, and a failed list load shows no switch (Task 5). Also: Settings is opened first, the list dialog saves, and Settings shows the new card when revisited, not stale state (Task 7).
4. The daily look at a waiting round sends no duplicate reminder, and a reminder that's due still goes out on its own day (Task 6).
5. A buyer has a good entry of their own and the shared row is malformed: the round isn't ready (Task 6, AC-18).

### Task 1: The owner's wording, in core (AC-4)

**Files:**
- Modify: `packages/core/src/address.ts`, `packages/core/src/address.test.ts`

**Produces:**
```ts
// packages/core/src/address.ts
export function checkOwnAddress(d: AddressDraft): ReturnType<typeof checkAddress>; // "Add your first name." / "Add your last name."
```

- [ ] Write failing tests: `checkOwnAddress` with empty names gives "Add your first name." and "Add your last name."; other messages match `checkAddress`; a valid address returns the same value as `checkAddress`.
- [ ] Run `pnpm --filter @gifts-af/core test address`. Expected: FAIL.
- [ ] Implement by mapping the two messages from `checkAddress`.
- [ ] Run `pnpm --filter @gifts-af/core test`. Expected: PASS.
- [ ] Commit `feat(core): address messages for your own address (ALL-63)`.

### Task 2: Reading and writing your own address (AC-2, AC-3, AC-5, AC-6, AC-8, AC-10, AC-22, AC-23)

**Files:**
- Create: `apps/web/lib/account-address.ts`, `apps/web/lib/__tests__/account-address.test.ts`
- Create: `apps/web/app/settings/address-actions.ts`
- Modify: `supabase/tests/account_addresses.test.sql` (only if a case below is missing)

**Consumes:** Task 1.

**Produces:**
```ts
// lib/account-address.ts. `db` is the signed-in client, narrowed to what's used.
export type MyAddress = { kind: "unavailable" } | { kind: "none" } | { kind: "saved"; address: Address; shared: boolean };
export type Sharing = { kind: "unavailable" } | { kind: "none" } | { kind: "off"; city: string; state: string } | { kind: "on"; city: string; state: string };
export type AccountAddressResult = { ok: true } | { ok: false; error: string; fields?: Partial<Record<AddressField, string>> };
export function getMyAddress(db, userId: string): Promise<MyAddress>;     // Settings: the full row
export function getSharing(db, userId: string): Promise<Sharing>;         // list page: city, state, share_for_gifts only
export function saveMyAddress(db, userId: string, a: Address, now: Date, opts?: { share: true }): Promise<boolean>;
export function removeMyAddress(db, userId: string): Promise<boolean>;
export function setSharing(db, userId: string, on: boolean): Promise<"ok" | "no_address" | "failed">;
export function parseMyAddressForm(f: FormData): ReturnType<typeof checkOwnAddress>; // non-string values count as empty (E4)
// settings/address-actions.ts ("use server")
saveMyAddressAction(form: FormData): Promise<AccountAddressResult>;       // form field share=1 means "save and share"
removeMyAddressAction(): Promise<AccountAddressResult>;
setSharingAction(on: boolean): Promise<AccountAddressResult>;
```

- [ ] Write failing tests:
  - `parseMyAddressForm`: good values, bad values with the owner's wording, and a `File` in a field counting as empty.
  - With the fake client from Global constraints: a failure whose error carries `details: "Failing row contains (44 Elm St)"` returns false or `unavailable`, and the captured `console` and `logEvent` output has none of that text, for each read and write (AC-22, AC-23).
- [ ] Run `pnpm --filter @gifts-af/web test account-address`. Expected: FAIL.
- [ ] Implement. `saveMyAddress` upserts on `user_id` with `country: "US"` and `address_checked_at: now`, with no `phone` key, and with no `share_for_gifts` key unless `opts.share` is set. `setSharing` is an update that returns `"no_address"` when no row changed. Events are `account_address_saved`, `account_address_removed`, `address_sharing_changed` (with `on`), and `account_address_failed` (with `code`). Actions revalidate `/settings` and `/lists`, and a `"no_address"` result returns "Add your address first." A missing session returns "Your session ended. Sign in again."
- [ ] Run the test again. Expected: PASS.
- [ ] Check `account_addresses.test.sql` covers another user's select, update and delete, and add what's missing (AC-6). Run `pnpm db:test`. Expected: PASS.
- [ ] Commit `feat: read and write your own address (ALL-63)`.

### Task 3: Move the address form so it can be shared (no behavior change)

**Files:**
- Create: `apps/web/components/address/address-form.tsx`
- Modify: `apps/web/app/people/[id]/address.tsx`
- Test: `apps/web/app/people/[id]/__tests__/address.test.tsx`, `apps/web/components/address/__tests__/address-form.test.tsx`

**Produces:**
```ts
export type AddressValues = Record<AddressField, string>;
export function AddressForm(props: {
  start: AddressValues;
  startErrors?: Partial<Record<AddressField, string>>;
  submitLabel: string;                                     // "Save address" or "Save and share"
  save: (form: FormData) => Promise<{ ok: true } | { ok: false; error: string; fields?: Partial<Record<AddressField, string>> }>; // the caller adds its own fields, such as the person id
  onDone: () => void;
}): JSX.Element;
```

The result is written out as a local type. `AddressSaveResult` and `AccountAddressResult` both fit it.

- [ ] Write failing tests in `address-form.test.tsx`: `submitLabel` shows; bad fields show messages and keep typed values; `ok` calls `onDone`; a thrown `save` shows "That didn't save. Try again."
- [ ] Run `pnpm --filter @gifts-af/web test address`. Expected: the new file FAILS, and the existing `address.test.tsx` passes.
- [ ] Move the form. `AddressSection` wraps its action to add `id` and passes `submitLabel="Save address"`.
- [ ] Run `pnpm --filter @gifts-af/web test address person-view`. Expected: PASS, with no existing test edited.
- [ ] Commit `refactor: share the address form (ALL-63)`.

### Task 4: Settings > My address (AC-1 to AC-5)

**Files:**
- Create: `apps/web/app/settings/my-address.tsx`, `apps/web/app/settings/__tests__/my-address.test.tsx`
- Modify: `apps/web/app/settings/page.tsx`

**Consumes:** Task 2's `getMyAddress` and actions, Task 3's `AddressForm`.

**Produces:** `MyAddressSection({ address: MyAddress, saveAction, removeAction })`, rendering `<section id="my-address">` with the heading "My address". Actions are props, as in `address.tsx`.

- [ ] Write failing tests, with `vi.fn` actions: no address shows the note, **Add my address** and no textboxes; the form's name fields start empty; saved shows the card, **Change address**, **Remove** and the right "Not shared" or "Shared" line linking to `/lists`; the Remove confirm has the exact wording for each case; cancel calls nothing; `unavailable` says "We couldn't load your address. Try again." with no Add button (AC-23).
- [ ] Run `pnpm --filter @gifts-af/web test my-address`. Expected: FAIL.
- [ ] Implement. In `page.tsx`, load the address and `getMyListSummary` from `@/modules/lists` alongside the existing data in `LoadedForm`, and render the section after `TestEmailButton`, unless there's no list and no saved address. A failed read shows the section as `unavailable` rather than hiding it. If ALL-32 has merged, keep its section too. Close the form in a `useLayoutEffect` cleanup, as the preserving-ui-state guide shows. When the URL's hash is `#my-address`, scroll to the section in an effect, as `address.tsx` does, because it renders inside `Suspense`.
- [ ] Run the test. Expected: PASS.
- [ ] Commit `feat: My address in Settings (ALL-63)`.

### Task 5: The sharing switch on the list page (AC-7 to AC-12)

**Files:**
- Create: `apps/web/components/address/share-address-switch.tsx` and its test
- Modify: `apps/web/modules/lists/components/gift-app.jsx`, `apps/web/app/lists/page.tsx`
- Test: `apps/web/modules/lists/components/__tests__/gift-app.test.jsx`

**Consumes:** Task 2's `getSharing` and actions, Task 3's `AddressForm`.

**Produces:** `ShareAddressSwitch({ sharing: Sharing, saveAction, setSharingAction })`. `GiftApp` gains an optional `footer` prop, rendered below the list only when `listId` is set and there's no `loadError`.

- [ ] Write failing tests:
  - Switch: off and on show the exact wording, and on names the city and state.
  - Switch: turning on with an address calls `setSharingAction(true)`; a `no_address` message shows and the switch stays off.
  - Dialog: with `kind: "none"`, turning on opens "Where should gifts ship?" with **Save and share**. The save sends `share=1`, a bad field keeps it open, and Cancel leaves the switch off with nothing called.
  - `GiftApp`: no `footer` with no list or a guest; it appears after a first save returns a list id; no `footer` when `loadError` is set (AC-11, Review Focus 3).
  - The list page renders no switch when `getSharing` returns `unavailable` (AC-23).
- [ ] Run `pnpm --filter @gifts-af/web test share-address gift-app`. Expected: FAIL.
- [ ] Implement. `ListLoader` calls `getClaims` for the user id, because `MyList` has none. It passes the footer only for a signed-in user, and loads `getSharing` for it. The "Change my address" link goes to `/settings#my-address`.
- [ ] Run the test. Expected: PASS.
- [ ] Commit `feat: let people with my list ship gifts to me (ALL-63)`.

### Task 6: Rounds count a shared address, and notice it (AC-16 to AC-21)

**Starts after ALL-32 is on `main`.** Before starting, re-read these files and ALL-27's current hook (T54), because both tickets change them. Names below are from the ALL-32 branch as of `456c5b9`.

**Files:**
- Modify: `packages/core/src/round-plan.ts` and its test
- Modify: `apps/web/modules/concierge/rounds/store.ts`, `people/people.ts`, `app/people/actions.ts`
- Test: `apps/web/modules/concierge/__tests__/round-engine.test.ts` (on the branch it runs in the `local-db` Vitest project, so local Supabase must be up)

- [ ] Write failing tests:
  - `round-plan.test.ts`: `nextAction` for `needs_address` with no address, when the next reminder is days away, returns `wait` with `until` tomorrow, never later. When a reminder is due today it still sends. Check how `walk` in that test file handles `until`.
  - Engine: on the days in between no email is sent, and a reminder goes out once, on its own day. When `hasAddress` turns true between ticks, the next tick generates with no address email (AC-19, Review Focus 4). Sharing that arrives after the last tick before the deadline still skips with the skip email (AC-21).
- [ ] Run `pnpm --filter @gifts-af/core test round-plan` and `pnpm --filter @gifts-af/web test round-engine`. Expected: FAIL.
- [ ] Implement:
  - `nextAction` as tested. Core decides the schedule, so `finishStep` doesn't change.
  - `roundContext` calls `rpc("shared_address_for_person", { p_person_id })` on the admin client and sets `hasAddress: isShippableAddress(shared ?? own)`, keeping only the true or false. An RPC error fails the step, so the next tick retries.
  - `linkList` takes the same `wiring` as `saveAddress` and does the same after an `ok` result: `placeHeld`, then `resumeWaitingRounds` (AC-20). `app/people/actions.ts` passes the wiring.
- [ ] Run the same tests plus `pnpm --filter @gifts-af/web test people`. Expected: PASS. Existing lists of reminder dates (`round-engine.test.ts:227`) must pass unedited, because the dates emails go out don't change. If one needs editing, stop and find out why.
- [ ] Note in the PR that `round_tick`'s `advanced` count now includes silent daily looks at waiting rounds (E6), and tell ALL-27 that `linkList` is a new caller of the hook.
- [ ] Commit `feat(rounds): a shared address counts, and waiting rounds notice it daily (ALL-63)`.

### Task 7: End-to-end, docs and Linear (AC-1 to AC-20)

**Files:**
- Create: `apps/web/e2e/my-address.spec.ts` (all projects)
- Modify: `apps/web/e2e/round-engine.spec.ts` (desktop only)

- [ ] Write `my-address.spec.ts`. **Every test uses `createFreshUser()`** for each owner and buyer, as `top-bar.spec.ts` does, because the table has one row per account and the projects run in parallel. Never turn sharing on for `TEST_USER` or `SECOND_USER`. Get ids from `signInApi`, and check the database with the service key:
  1. Settings: add with errors, save, change, remove with cancel and confirm (AC-1 to AC-5).
  2. Change an address while sharing is on: `share_for_gifts` stays true (AC-3, Review Focus 1).
  3. List page: no switch before a list is saved, and it appears after saving a first gift without a reload (AC-11). No address, turn on, bad field, **Save and share**, row has `share_for_gifts` true (AC-9). Off, then on (AC-7, AC-8).
  4. Delete the row with the service key, then flip the stale switch: the plain message, and no row (AC-10).
  5. A fresh `request.get("/lists")` has no street (AC-12). Don't check `page.content()` after client navigation, because a hidden route's DOM stays in the page.
  6. Open Settings, go to the list page, **Save and share**, then "Change my address": it lands on the section in view, showing the new card with the form closed (Review Focus 3).
  7. Two fresh accounts: the owner shares, and the buyer links the owner's list to a person. That person's page shows the city and no street (AC-13). Sharing off shows no city, and so does removing the address (AC-14).
- [ ] Add to `round-engine.spec.ts`, with `TEST_USER` as buyer and a fresh owner set up through the API. Every next tick uses `today + 1` in `?now=`, because a waiting round isn't due again until tomorrow:
  - A round waits in `needs_address`, the owner turns sharing on, and the next day's tick moves it to `awaiting_approval` with one `heads_up` and no further address email (AC-16, AC-19).
  - The buyer links the list with sharing on: the round does what saving an address does today (AC-20).
  - Sharing off, or the link revoked with the service key resetting the token: it stays in `needs_address` (AC-17).
  - A malformed shared row seeded with the service key, with a good buyer entry: it stays in `needs_address` (AC-18).
- [ ] Run `pnpm --filter @gifts-af/web e2e my-address round-engine`. Expected: PASS. Confirm `link_revocation.test.sql` still passes (AC-15).
- [ ] Comment on ALL-29 (what the approval screen does when sharing is withdrawn) and ALL-30 (the engine side is done).
- [ ] Commit `test(e2e): my address, sharing, and rounds that count it (ALL-63)`.

### Task 8: Verify, review, ship, evidence

- [ ] Re-read the ticket and its comments (T57). Rebase on `main`.
- [ ] **Gate, before merging:** ALL-32 is on `main`, with failing-then-passing tests for sharing withdrawn after approval (hold and ask) and a rejected shared address (no blind retry, neutral owner email). If either is missing, don't merge. Tell the owner.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the Task 7 e2e. Note the counts.
- [ ] Get an adversarial code review through superpowers:requesting-code-review, and fix what it finds.
- [ ] Open the PR: `feat: my address, and let people with my list ship gifts to me (ALL-63)`, with **`Part of ALL-63`**, since the live check comes after merge. The body answers E9: how we see it on production (the events and the QA account check) and how to turn it off (the spec's SQL, with the owner's approval). It also says real shipping to a shared address waits on ALL-32's fixes. Read PR feedback while CI runs (T59).
- [ ] Screenshots at 375 px and 1280 px, light and dark, of each state, uploaded into the evidence comment. Tick the ticket's boxes with pointers.
- [ ] After merge: live check on giftsaf.com with the QA account (T60): save one gift so the switch shows, then add, change, share, unshare and remove, then remove the gift, leaving no address row or list items behind. Check for `account_address_failed` events. Move to Done only when nothing is Still open.

## Before coding: consistency check

- [x] **Every acceptance criterion maps to a task and a test:** AC-1 to AC-5 → 4, 7 · AC-6 → 2 (pgTAP) · AC-7, AC-8 → 5, 7 · AC-9 → 5, 7 · AC-10 → 7 · AC-11 → 5, 7 · AC-12 → 7 · AC-13, AC-14 → 7 · AC-15 → 7 (pgTAP) · AC-16, AC-17, AC-18 → 7 · AC-19 → 6, 7 · AC-20 → 7 · AC-21 → 6 · AC-22 → 2 · AC-23 → 2, 4, 5.
- [x] **Every task traces back to a story or criterion.** Task 3 is needed because Tasks 4 and 5 use the same form. Task 8 is CLAUDE.md's evidence rule.
- [x] **No open questions are left.** The owner answered the plan review's questions on 2026-11-06: ALL-32 merges first, My address waits for a list or a saved address, and the switch says "Anyone with your list link".
- [x] **Types line up:** `checkOwnAddress` (1) is used in 2. `MyAddress`, `Sharing`, `AccountAddressResult` and the actions (2) are used in 4, 5. `AddressForm` (3) is used in 4, 5.
- [x] Adversarial review of the spec and of the plan done (2026-11-06). Blockers fixed in this plan; the ALL-32 gate is in Task 8.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted: tests added (each seen failing first), suite and CI results.
- [ ] Screenshots of each state, phone and desktop, light and dark, plus the mock-ups (posted).
- [ ] Live check after deploy, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.
