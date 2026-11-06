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

**Settings > My address**, a section on the Settings page, with its own Save, separate from the time zone form.

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
| **Off** | Switch and "Let people with my list ship gifts to me", with "Anyone who has linked your list, now or earlier, sees your city and state in GiftsAF. The person ordering may be able to see your full address in their Zinc account." |
| **On** | Switch on, with "They see {City, ST} in GiftsAF. The person ordering may be able to see your full address in their Zinc account." and a **Change my address** link to Settings. |
| **Turning on, no address** | A dialog, "Where should gifts ship?", "Saving this turns sharing on.", the same form, **Save and share**, **Cancel**. Cancel leaves the switch off. |

All controls use the app's `Button`, `Switch`, `Input` and `Dialog` components, so the primary action is the standard teal button. Errors speak to the owner: "Add your first name.", not "Add their first name."

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | No address | I open Settings | The section shows the note and **Add my address**, with no form fields |
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
| AC-20 | A round waits in `needs_address`, sharing already on | The buyer links that person's list | The round moves on straight away, through the same hook as saving an address |
| AC-21 | Sharing is turned on after the last tick before the deadline | The deadline tick runs | The round is skipped and the buyer gets the usual skip email. The deadline skip still comes first |
| AC-22 | A failed save, remove or sharing change | The log output is captured in a test | It holds `user_id`, an outcome and an error code. No address field or name appears (E6, T42) |

### Out of scope

| What | Where it goes instead |
|---|---|
| Sharing withdrawn after approval: hold and ask (owner decision) | **ALL-30/ALL-32**, noted on ALL-32. **Sharing isn't ready for real orders until this lands** |
| Zinc rejects a shared address: no blind retry, honest wording, neutral email to the owner (owner decision) | **ALL-30/ALL-32**, noted on ALL-32, same condition |
| Reading the address just before `begin_placing` | **ALL-30/ALL-32**, noted on ALL-32 |
| What the approval screen does when sharing is withdrawn during `awaiting_approval` | **ALL-29**, with a note on that ticket. `approveAndBuy` already refuses with `no_address` on the ALL-32 branch |
| Moving off personal Zinc accounts | **ALL-98**, required before anyone outside friends can order (T61) |
| Shipping a gift to "My address" (buy it to hand over yourself) | Not built: `approve.ts` sets `ship_to: "recipient"`. The wording doesn't promise it |
| A "reset my share link" button | Not built (owner decision). The switch stops address sharing, not the list link. AC-15 proves the database rule |
| Stopping one particular person, or seeing who linked my list | Not built. Decision 42: everyone with the link is treated alike |
| Resuming rounds the moment sharing is turned on | Not built. The next daily tick does it (AC-19) |
| A phone number from the list owner | Not collected (T42). `account_addresses.phone` stays empty. Zinc gets the buyer's phone, accepted for friends and family (owner decision) and re-checked in ALL-98 |
| Stopping a person who writes a malformed row to their own address through the API | Not handled. It only harms them: their buyer's round asks for an address, then skips at the deadline with the usual email |
| Suggesting an address update | ALL-86 |
| Moving every primary button to `Button` | ALL-96 |

### Open questions

None left. The owner answered all six on 2026-11-06.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Can a buyer see the street in their Zinc account? | Possibly, and that's accepted for friends and family, with plain wording on the switch. (Owner) **[Verify]** the dashboard during ALL-98 | Zinc's [order API](https://www.zinc.com/docs/v2/api-reference/orders/get-order.md) returns `shipping_address`. Only test and admin users can order today (decision 53). |
| What protects strangers later? | Moving off personal Zinc accounts is required before anyone outside friends can order. (Owner, T61, ALL-98) | T16 had no date or launch link. Decision 42 lets anyone with the link connect. |
| Sharing withdrawn after approval | Hold and ask. (Owner) Built in ALL-32 | A purchase can't be undone (T18), and the fallback entry is hidden and may be an old import (T45). |
| Zinc rejects a shared address | Email the owner neutrally, with no item or sender. (Owner) Built in ALL-32 | The buyer can't fix it, and the surprise holds (decision 39). |
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
- **Off switch (E7, E9)?** Rolling back on Vercel removes the screens and restores the old engine, but shares already turned on stay on. The real off switch is `update public.account_addresses set share_for_gifts = false`, run with the owner's approval, recorded in the PR. Shipping is separately gated by `zinc_ordering_enabled`.
- **How we'll see it working on production:** `account_address_saved` and `address_sharing_changed` events, and a live check with the QA account (T60): add, change, share, unshare and remove. Buyer-side sharing needs two accounts, and rounds are off on production (AC-16 to AC-21), so those are proven in CI's e2e on local Supabase and listed as such in the evidence.
- **Docs and decisions:** T61 in `design/decisions.md`, §3 and §6.1 of `design/technical-design.md`, and a pointer on decision 41. Linear: ALL-30, ALL-32 and ALL-29 notes.
