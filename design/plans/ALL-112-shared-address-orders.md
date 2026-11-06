# ALL-112 Orders to a shared address: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a gift approved for a list owner's shared address never ships somewhere else, and when that address can't be used, the order ends with nothing bought and the people who can act are told.

**Links:** [ALL-112](https://linear.app/allens-forever/issue/ALL-112) · blocks [ALL-63](https://linear.app/allens-forever/issue/ALL-63) (`design/plans/ALL-63-my-address.md`) · orders [ALL-30](https://linear.app/allens-forever/issue/ALL-30), [ALL-32](https://linear.app/allens-forever/issue/ALL-32) (`design/plans/ALL-32-zinc-connection.md`) · choosing again [ALL-29](https://linear.app/allens-forever/issue/ALL-29) · T18, T19, T23, T42, T51, T56, T61 · planning decisions 38, 39, 41, 43, 53 · mock-ups: `design/mockups/ALL-112-emails.html`, rendered through the real email template.

## Spec: what it does

### Why

The owner decided on 2026-11-06 (T61) that a withdrawn share must not ship anywhere else, and that a rejected shared address needs honest wording and a neutral email to the owner. ALL-32 merged without them. Two paths are open on `main`, and both become reachable once ALL-63 lets people share an address:

1. **Sharing stops after approval.** The order is held for funds, and the owner turns sharing off. `recipientAddress` (`purchase/store.ts`) falls back to the buyer's own entry on `people`, which was hidden while sharing was on and may be an old unchecked import (T45). `placeRound` then buys, which can't be undone (T18).
2. **Zinc rejects a shared address.** `fail_order_row` creates a replacement order held as `address`. The buyer gets "Fix the address", which leads to a read-only page, and the owner, the only person who can fix it, is never told.

Until ALL-63 ships, `shared_address_for_person` returns nothing for everyone, so none of this changes behavior.

### The design: both cases end the order

Owner decision, 2026-11-06, replacing an earlier hold-and-auto-retry design that a review found fragile. The order fails with nothing bought, the buyer is told through the existing failure path, and choosing again (ALL-29) reads the address fresh. **There's no retry and no resume.** The cost is that a gift doesn't send itself after a fix: the buyer chooses again.

### Who it's for and what they can do

1. **Buyer, sharing stopped:** I'm told we can't use the address, that nothing was bought, and I can open the person's page to decide what to do.
2. **Buyer, address rejected:** I'm told the store couldn't use it, that nothing was bought, and that the owner will be asked to check it.
3. **List owner, address rejected:** I get a neutral email asking me to check my saved address. It doesn't say anything was attempted, and it names no gift, item or sender (decision 39).

### What people see

Copy is in the mock-ups. Emails 1 and 2 are the existing `needs_attention` email, with a new reason. Email 3 is a new kind, `check_your_address`, with its button opening Settings > My address.

| Email | To | Reason or body |
|---|---|---|
| 1. Sharing stopped | Buyer | "we can't use the address {name} was sharing, so we didn't buy the {gifts} and you haven't been charged for it." |
| 2. Address rejected | Buyer | "the store couldn't use the address {name} saved, so we didn't buy the {gifts} and you haven't been charged for it." Then, only when the owner was asked (owner, 2026-11-06): " We'll ask {name} to check it, without mentioning a gift." |
| 3. Check your address | List owner | "Please check your saved address is current. It's used if someone sends you a gift through your list." |

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An order shipping to the recipient, approved against a shared address | `approve_round` runs | `orders.address_source` is `shared`. Against the buyer's own entry, it's `own`. Null for any other `ship_to` |
| AC-2 | `reapprove_order` makes a replacement | It runs | The replacement keeps the old order's `address_source` |
| AC-3 | Held orders with source `shared`, one or several on a round, and nothing is shared now (sharing off, address removed, link revoked), with or without a shippable own entry for the buyer | `placeRound` reaches its address step | No Zinc call. **Every** such order fails as `address_withdrawn`, each one's snapshot is deleted and its `ship_city` and `ship_state` are blanked (decision 43), in the failure's own transaction. The round goes to `needs_attention` / `failed` |
| AC-4 | A held order with source `shared`, and a shared row that fails `isShippableAddress` | `placeRound` runs | The same as AC-3 |
| AC-5 | AC-3 | The engine handles the round | The buyer gets email 1 once, naming every gift it ended. The buyer's own entry on `people` isn't used or changed |
| AC-6 | A held order with source `shared`, sharing still on, and the owner changed their address | `placeRound` runs | It places to the new address (`recipientAddress` already reads it fresh) |
| AC-7 | A held order with source `own`, and the owner starts sharing | `placeRound` runs | It places to the shared address, and `begin_placing` writes the source `shared` with the fresh snapshot |
| AC-8 | Zinc rejects an order with source `shared`, by webhook, sweep or the placing response | The failure is recorded | The order ends as failed type `address_rejected`, unresolved. **No replacement order is created.** The round goes to `needs_attention` / `failed` |
| AC-9 | AC-8, even when a price or stock failure is also open on the round | The engine handles the round | The buyer gets email 2 once, naming every gift rejected. The email is chosen from the failed orders' types, not the round's reason |
| AC-10 | AC-8, and the address shared now equals the failed order's snapshot, comparing names, both address lines, city, state, ZIP and country, not phone | The buyer's notice is about to go, or the daily tick runs, even if the round has closed or the buyer cancelled | The owner gets email 3 once per round, however many picks were rejected, and before the buyer's email when both are due. A refused send doesn't stop the buyer's email, and the tick tries again |
| AC-11 | AC-8, and the owner has since changed the address, stopped sharing, the buyer's person now links someone else, or the owner has no email | The same | No email 3. A failed lookup isn't treated as this, and is tried again |
| AC-12 | Email 3 | It's sent | `round_id` is null, its link belongs to the owner, and nothing in it or its link points at the round, gift or buyer. It opens `/settings#my-address` |
| AC-13 | AC-10 has sent or been ruled out | The same step | The round's rejected orders' snapshots are deleted, and their `ship_city` and `ship_state` blanked (T42, decision 43). A snapshot still existing is what marks the step as not done |
| AC-14 | Zinc rejects an order with source `own` or null | The failure is recorded | Exactly as on `main`: a replacement held as `address`, and "Fix the address" |
| AC-15 | Any of these | The output is captured in a test | Events carry ids and an outcome only. No address, name or city (E6). The owner's id isn't in the buyer's round events |
| AC-16 | A round with a sibling pick placed, placing or unconfirmed when AC-3 or AC-8 happens | The engine handles the round | The sibling is untouched, and the buyer's email is about the failed picks only. It never says they weren't charged for the sibling |

### Out of scope

| What | Where it goes instead |
|---|---|
| Sending the gift by itself after a fix | Not built, on purpose (owner, 2026-11-06). The buyer chooses again through ALL-29 |
| Choosing again after an ended order | **ALL-29**, noted on that ticket: `approve_round` refuses anything not `awaiting_approval`, and `reapprove_order` is `price_up` only, which is correct because it can't resend a rejected address. ALL-29 needs a way to re-approve from `needs_attention` that resolves the failure and reads the address fresh. Until it's built, the email's button opens the person's page, with nothing there about the order. Rounds stay off on production and only test and admin users can buy (decision 53) |
| Deleting shared-address snapshots on other ended orders (cancelled, out of stock) | Not built. Noted on ALL-37, the privacy pass |
| Re-reading the address after the wallet check, just before `begin_placing` | Not built. A withdrawal in those seconds is the same as one just after the POST, which can't be stopped. **[Claude's call]** |
| Sharing stopped during `awaiting_approval` | ALL-29. `approveAndBuy` already reads the address at approval |
| Removing "Alpha:" from the other hold emails | ALL-114 |
| Moving off personal Zinc accounts | ALL-98 |

### Open questions

None.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Hold and retry, or end the order? | End the order. (Owner, 2026-11-06) | The retry design needed a new function, changes to four more, and a reversal of an ALL-32 rule, and still had ways to lose a confirmation or resend a rejected address. This case should be rare among friends and family. |
| Owner's email wording | No "delivery" or failure language. (Owner, 2026-11-06) | "A delivery couldn't go through" tells them something was being sent, and reads like phishing. |
| No "Alpha:" note | Owner, 2026-11-06 | These emails say nothing was bought, so there's no cost to state. ALL-114 covers the rest. |
| How do we know where the approval pointed? | A nullable `orders.address_source`, written by `approve_round`. **[Claude's call]** | A snapshot comparison can't tell "sharing stopped" from "the buyer edited their entry". Expand-only (E7). |
| Who is "the owner" for email 3? | `people.linked_user_id`, only when the address shared now equals the failed order's snapshot. **[Claude's call]** | A relink or a changed address mustn't email the wrong person, or someone who already fixed it (decision 43). |
| Keeping the street on an ended order | Delete its snapshot and blank its city and state, on the two failure types here. **[Claude's call]** | It never shipped there, ALL-63 only promises that past orders keep the address they shipped to (T42), and a revoked buyer mustn't see the city (decision 43). |
| Is email 3 tied to the round? | No: `round_id` is null, and `round_sends` on the buyer's round records that it went. **[Claude's call]** | Nothing on the owner's side should point at a gift (decision 39). |
| How long does email 3's link last? | A new `app_settings` value, `check_address_link_days`, 30 days by default. **[Claude's call]** | The round's deadline may already be past (T23). |
| If email 3 keeps being refused | Stop after `check_address_retry_days`, 7 by default, delete the address, and raise an alert. The buyer was told we'd ask. (Owner, 2026-11-06) | Otherwise we'd keep the street and alert daily forever (T42, E8). |
| Zinc's rejection code | `invalid_shipping_address`, sent at once on the POST as `code`, per [Zinc's sandbox docs](https://www.zinc.com/docs/v2/api-reference/introduction/sandbox.md). Our adapter reads that, with a test through the immediate path. **[Verify]** on a real sandbox order during ALL-32's live checks | Any other code would become plain `failed`, with generic wording and no owner email. |
| When a rejection comes after the round closed, does the owner hear first? | No. `failed_late` goes at once, and the owner hears at the next tick. **[Claude's call]** | `failed_late` promises nothing about the owner. |
| A buyer missing a failed gift when several picks fail around the same time | **[ALL-116](https://linear.app/allens-forever/issue/ALL-116)**, required before ALL-29 ships. (Owner, 2026-11-06) | It's on `main` for every failure type, and needs several picks, which ALL-29 adds. |

## Principles check

- **Simplest version?** No hold, resume, retry or new job. One nullable column, one setting, one new email kind, one new action.
- **Hard-coded values?** One new setting, the link's lifetime (T23).
- **Product boundaries?** All in the concierge. It reads `public.shared_address_for_person` with the server's client and writes neither public nor lists tables (T19).
- **New personal data?** None. The column holds only `shared` or `own`, server-only like `hold_reason`. This removes street snapshots rather than adding any.
- **Bends a recorded decision?** It narrows T56's "buy by itself" for these two cases only, noted on T61.
- **Breaking changes / migrations?** Expand-only (E7, T50): a nullable column, a settings row, and `approve_round`, `fail_order_row`, `reapprove_order` and `begin_placing` copied with marked lines, keeping their signatures and grants.
- **Off switch (E7, E9)?** `zinc_ordering_enabled` still stops all buying. Rolling back on Vercel leaves the column unused. On production, `order.address_withdrawn` and `order.shared_address_notice` can't appear until sharing and ordering are both live, so that check stays **Still open** on the ticket until then.
- **Docs and decisions:** T61 (add this design), §6.1 of `design/technical-design.md`, and the gate in `design/plans/ALL-63-my-address.md`.

## Plan

**Architecture:** one migration adds the column and threads it through the four order-writing functions, turning a rejected shared address into a plain failure and clearing a withdrawn order's address in the same transaction. `placeRound` ends every shared-source order when nothing shippable is shared. The engine picks the buyer's email from the failed orders' types. One function, driven by "rejected orders whose snapshot still exists", tells the owner and cleans up; it's called just before the buyer's notice and from the tick.

**Tech stack:** SQL (pgTAP), TypeScript, Vitest (`pnpm test:db` runs the `local-db` project against real Postgres, with only Zinc faked). Work in a new worktree `.claude/worktrees/all-112` on `aarontallen/all-112-shared-address-orders`, from `origin/main`. Re-check `origin/main` for the newest migration timestamp before naming the file.

**Global constraints**

- Ids and an outcome only in events (E6). Never a Supabase error object in a log.
- Any function copied from an earlier migration keeps its signature, and marks new lines with a comment. Copy from the newest definition of each.
- Existing hold-email tests and `PLACEABLE_HOLDS` don't change. `address` stays non-placeable.
- Only `ship_to = 'recipient'` orders use `address_source`.

**Review Focus**

1. A round with two picks, one placed and one ended, and two picks both ended: the status and emails stay right (Tasks 2 and 3, AC-3, AC-16).
2. A failure arriving twice, by webhook and by sweep: one failure, one owner email, one buyer email (Task 1, Task 3).
3. A rejection after the round closed: `failed_after_close` still sends `failed_late`, and no owner email is lost or doubled (Task 3).
4. `round_fail_count` counts `address_rejected`, so `fail:<n>:notice` is a new step and really sends (Task 1).
5. The owner's step records first, as `trySend` does: a refused send removes the record and keeps the snapshot, so the tick tries again; a crash after recording means no email, not two (Task 3).

### Task 1: The column and the three order functions (AC-1, AC-2, AC-8, AC-14)

**Files:**
- Create: `supabase/migrations/<next>_order_address_source.sql`, `supabase/tests/order_address_source.test.sql`
- Modify: `packages/core/src/database.types.ts` (through `pnpm db:types`)

**Produces:** `concierge.orders.address_source text check (address_source in ('shared','own'))`, server-only with no grant to users. `approve_round` reads `address_source` from each `p_orders` element. `reapprove_order` copies it. `begin_placing` writes it when a `p_orders` element has one, beside the fresh snapshot. `fail_order_row`: when `p_failure_type = 'invalid_shipping_address'` and the order's source is `shared`, it records `address_rejected`, `resolved = false`, and no replacement; when `p_failure_type = 'address_withdrawn'`, it also deletes the snapshot and blanks `ship_city` and `ship_state` to `''`. Otherwise it's unchanged. `app_settings` gains `check_address_link_days`, 30. Also the two server-only functions Task 3 lists.

- [ ] Write failing pgTAP: AC-1, AC-2, AC-8 through `fail_order`, `record_outcomes` and `settle_order` each (no replacement, unresolved, attention reason `failed`, `round_fail_count` goes up), AC-14 (source `own` and null get the replacement and `resolved = true`), `address_withdrawn` clearing the snapshot and city, `begin_placing` writing the source, and a second `fail_order` on the same order changing nothing.
- [ ] Run `pnpm db:test`. Expected: the new file FAILS.
- [ ] Write the migration, copying each function from its newest definition.
- [ ] Run `pnpm db:test` and `pnpm db:types`. Expected: PASS, and the only type change is the column.
- [ ] Commit `feat(db): orders remember which address was approved (ALL-112)`.

### Task 2: Placing ends a shared-source order when the address is gone (AC-1, AC-3, AC-4, AC-6, AC-7, AC-16)

**Files:**
- Modify: `apps/web/modules/concierge/purchase/store.ts`, `place.ts`, `approve.ts`
- Test: `apps/web/modules/concierge/__tests__/purchase.test.ts`, with a new fixture for a shared address: a list, a `person_links` row with the current token, and an `account_addresses` row, because `active_link` checks the token

**Produces:** `recipientAddress` also returns `source: "shared" | "own"`. A shared row is returned as `shared` even when malformed, as today.

- [ ] Write failing tests in `purchase.test.ts`, which runs against real Postgres:
  - Approving records the source, for both kinds.
  - AC-3, with and without an own entry, from a funds hold: no Zinc call, `address_withdrawn`, snapshot gone, city blank, attention reason `failed`.
  - AC-3 with two held picks: both end in the same run.
  - AC-4: a malformed shared row, with a good own entry: ended, never shipped to the own entry.
  - AC-6: the new shared address reaches Zinc.
  - AC-7: source becomes `shared`, and the shared address reaches Zinc.
  - AC-16: one pick placed, the other ended: the placed one is untouched.
  - An existing `own` order with no shared row places as today.
- [ ] Run `pnpm test:db purchase`. Expected: FAIL.
- [ ] Implement in `placeRound` step 3, before the existing per-order loop. For **each** held recipient order with source `shared`: unless `recipient.source === "shared"` and the address is shippable, call `fail_order` with `address_withdrawn` and log `order.address_withdrawn` with ids. If any ended, return the outcome after the loop, as step 2 does. For a fresh order, pass `recipient.source` as `address_source` in `begin_placing`'s `p_orders`. Other cases are unchanged.
- [ ] Run the same command. Expected: PASS.
- [ ] Commit `fix(concierge): a withdrawn shared address ends the order instead of shipping elsewhere (ALL-112)`.

### Task 3: The emails (AC-5, AC-9 to AC-13, AC-15)

**Files:**
- Modify: `apps/web/modules/concierge/notify/templates.ts`, `actions.ts`, and the samples and their tests (`samples.ts`, `samples.test.ts`, `links.test.ts`, `e2e/emails.spec.ts` including its "27 concierge" title, `templates.test.ts`)
- Modify: `apps/web/modules/concierge/rounds/engine.ts`, `rounds/store.ts`, `packages/core/src/round-plan.ts`
- Test: `apps/web/modules/concierge/__tests__/round-engine.test.ts`, `__tests__/fake-round-store.ts`, `__tests__/zinc-events.test.ts` (one webhook rejection end to end)

**Produces:**
- `check_your_address` kind, with `links: { open: string }`, no round data, the mock-up's copy and the real shell.
- `check_my_address` action, with `straight: true` as `open_settings` has, whose next page is `/settings#my-address`, with confirm copy "Check your address" / "Confirm to open your saved address." / "Open Settings". Its link lasts `check_address_link_days`.
- `StepKey` gains the plain step `"shared_address"`, one per round, also excluded in `PlainStep`.
- `tellOwnerOfRejection(roundId, deps): Promise<"asked" | "ruled_out" | "retry">` in the engine.
- SQL function `concierge.shared_address_owner_to_tell(p_round_id uuid)`, server-only: the owner's id when the address shared now equals the round's newest `address_rejected` snapshot on the named fields. `concierge.clear_rejected_addresses(p_round_id uuid)`, server-only: deletes those snapshots and blanks their city and state. Both go in Task 1's migration, with pgTAP.
- `RoundStore.roundsWithRejectedAddresses(): Promise<string[]>`: the to-do list, rounds with an `address_rejected` order whose snapshot still exists.

- [ ] Write failing tests:
  - The failure email is chosen from the failed orders' types, with exact strings from the spec, naming every failed gift through `giftList`, including with a `price_up` failure already open (AC-5, AC-9).
  - Two picks ended together give one email naming both. A sibling placed gets no "not charged" claim about it (AC-16).
  - The owner's email goes before the buyer's, once across ticks and however many picks were rejected, with `round_id` null and no gift, buyer or round in it (AC-10, AC-12).
  - No owner email when the address changed, sharing stopped, the person now links someone else, or the owner has no email. A failed lookup retries (AC-11).
  - A refused owner send: the buyer is still told, and the next tick tries again. A sent or ruled-out step clears the snapshots (AC-10, AC-13).
  - Rounds that closed, or that the buyer cancelled, are still handled by the tick (AC-10).
  - A rejection after close sends `failed_late` and still tells the owner, once (Review Focus 3).
  - The action link opens `/settings#my-address` (`links.test.ts`, AC-12).
  - The captured output has no address, name or owner id (AC-15).
- [ ] Run `pnpm test:db round-engine` and `pnpm --filter @gifts-af/web test templates samples`. Expected: FAIL.
- [ ] Implement. `tellOwnerOfRejection`, with its own try/catch: if `shared_address_owner_to_tell` finds an owner and `shared_address` isn't recorded, record it and send; on refusal remove the record and return `retry`, keeping the snapshots. Otherwise clear the snapshots. Call it in `runHeld` immediately before a `fail:` notice about `address_rejected`, and in the tick for every round in `roundsWithRejectedAddresses`, next to `retryOrderedEmails`, which runs even with the engine off. Add the email to the sample lists.
- [ ] Run the same commands, plus `pnpm typecheck`. Expected: PASS.
- [ ] Commit `feat(concierge): tell the buyer and the owner when a shared address can't be used (ALL-112)`.

### Task 4: Docs, review, ship, evidence

- [ ] Re-read the ticket and its comments (T57). Rebase on `main`.
- [x] Update T61, `design/technical-design.md` §6.5, and the gate in `design/plans/ALL-63-my-address.md`.
- [ ] Run `pnpm lint; pnpm typecheck; pnpm test; pnpm test:db; pnpm build`, checking each exit code, plus `pnpm --filter @gifts-af/web e2e emails` with no `EADDRINUSE` in the output.
- [ ] Check Zinc's rejection code against the sandbox's invalid-address test product. Record the result, and fix `failureType` if the code differs.
- [ ] Comment on ALL-29 (what choosing again needs) and ALL-37 (other ended orders' snapshots).
- [ ] Get an adversarial code review through superpowers:requesting-code-review, and fix what it finds.
- [ ] Open the PR: `fix: orders to a shared address end safely when it can't be used (ALL-112)`, with **`Closes ALL-112`** only if nothing but the E9 check is open; otherwise **`Part of ALL-112`**. Answer E9 in the body. Read PR feedback while CI runs (T59).
- [ ] Post the evidence: tests seen failing first, counts, CI, and the three rendered emails.

## Before coding: consistency check

- [x] **Every acceptance criterion maps to a task and a test:** AC-1 → 1, 2 · AC-2 → 1 · AC-3, AC-4 → 1, 2 · AC-5 → 3 · AC-6, AC-7 → 1, 2 · AC-8 → 1, 3 · AC-9 to AC-13 → 3 · AC-14 → 1 · AC-15 → 3 · AC-16 → 2, 3.
- [x] **Every task traces back to a story or criterion.**
- [x] **No open questions are left.**
- [x] **Types line up:** `address_source` (1) is used in 2 and 3. `address_withdrawn` and `address_rejected` (1, 2) are used in 3. `recipientAddress().source` (2) is used only in 2.
- [x] Adversarial reviews of the spec and plan done (2026-11-06). The first led the owner to replace hold-and-retry; the second's findings are in this version.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted: tests added (each seen failing first), suite and CI results.
- [ ] Screenshots of the three emails.
- [ ] Live check after deploy, or listed as **Still open**.
- [ ] Every acceptance-criteria box ticked, each with a pointer to its evidence.
