# ALL-139 Record whose shared address an order ships to: Spec and Plan

**Goal:** a gift approved to a list owner's shared address only ever ships to that same list owner. If the buyer relinks the person to someone else's list before the order is placed, the order ends with nothing bought, as `address_withdrawn`.

**Links:** [ALL-139](https://linear.app/allens-forever/issue/ALL-139), found in ALL-123's final review. Builds on ALL-112 (`design/plans/ALL-112-shared-address-orders.md`). Decisions T61 (shared addresses), T18 (never buy what the buyer didn't approve), E7 (prevention where money moves). Technical design §5 "A list owner's shared address".

## Spec: what it does

Today an order approved to a shared address remembers only `address_source = 'shared'`, not whose address it was. Placing reads the person's shared address again, from whichever list the person links to *now*. So: approve a gift to Sam's shared address, remove the link, link the same person to Alex's list, and the next tick ships Sam's gift to Alex. ALL-123 made that two taps.

### Who it's for and what they can do

1. **Ships where it was approved:** as a buyer, a gift I approved to a list owner's address only goes to that list owner, so relinking a person by mistake can't send a gift to a stranger.
2. **Told, not surprised:** as a buyer whose relink stopped a gift, I get the same "we can't use the address [name] was sharing" email ALL-112 sends, and choose again.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A buyer approves a gift to a list owner's shared address | The order is written (approval or a replacement) | The order records the owner's account id (`address_owner_id`, ids only). Orders not shipping to a shared address record none. The database refuses a shared order whose owner is missing or isn't the person's current link. |
| AC-2 | An order whose address was read fresh at placing turns out to be a shared one | Placing begins | The owner it read the address from is recorded with the address, in the same write. |
| AC-3 | A held order approved to owner A's shared address | The person is relinked to owner B's list (whether or not B shares an address) and the tick places | The order ends as `address_withdrawn`: nothing is bought, the address isn't sent, and the buyer gets ALL-112's email. |
| AC-4 | The same, but the relink happens between the app's check and `begin_placing`, or the app sends the wrong owner or source | `begin_placing` runs | It refuses before writing anything: a stored shared order only places with a shared address from its stored owner, who must still be the current link. The next tick ends the order as in AC-3. |
| AC-5 | A held order approved to owner A, still linked to A (A may have changed address or list) | The tick places | It's placed as today, to A's current shared address. |
| AC-6 | A shared-address order with no recorded owner (none exist on production; see below) | The tick places | It ends as `address_withdrawn` (fail closed). |
| AC-7 | Owner A deletes their account | The tick places | The recorded owner becomes null and the order ends as `address_withdrawn`. |

AC-3 and AC-4 are covered by pgTAP and local-db tests (the ticket's second box). AC-3 is checked on production (E9) by the QA account.

### Out of scope

- An order approved to the buyer's own entry for the person that later finds a shared address at placing: it ships to the shared one, as today (ALL-112), and records that owner (AC-2).
- Shipping the replacement to the new list owner: the fix page keeps ALL-112's rule (never back to "the recipient" while a list owner shares an address). The buyer can send it to themselves or another address.
- Any copy change: ALL-112's wording ("we can't use the address [name] was sharing") already fits.

### Open questions

None. Production has no orders yet (checked 2026-11-23), so no backfill: AC-6 only guards against a missed writer.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Where does the owner id come from? | `public.shared_address_for_person` also returns `owner_id`, so the address and its owner come from one read. | Reading the owner separately leaves a window where the address is A's and the id is B's. The function is service-role only, so the id isn't exposed. Claude's call. |
| Fail or hold on a relink? | End the order as `address_withdrawn`, like a withdrawn share. | T61 already settled that a shared address that can't be used ends the order with nothing bought; relinking is the same case from the buyer's side. Claude's call, matches the ticket. |
| What does "different owner" compare? | The account id, not the list or the address. | The same owner on a new list, or at a new address, is still the person the buyer chose. |
| Owner who gets the "check your address" email after a rejection | Unchanged: `shared_address_owner_to_tell` still goes through the current link and the matching address, so after a relink nobody is emailed. | Correct: the new list's owner has nothing to check. |
| An order approved to the buyer's own entry, then the person is linked to a list that shares an address | Ships to the list's address, as today (ALL-112), and records that owner when placing begins (AC-2). | Owner, 2026-11-23. Linking already shows a ship-to notice (ALL-123). |
| Deleted owner? | `on delete set null`, which then fails closed. | Keeps a dangling id from matching nothing silently; the share is gone anyway. |

Recorded as T88 in `design/decisions.md` (narrows T61).

## Principles check

- **Simplest version?** One column, one extra key in an existing read, a guard in `begin_placing`, one comparison in `place.ts`. No new email, setting or screen.
- **Hard-coded values?** None.
- **Product boundaries?** `concierge` reads `lists.active_link`, as `shared_address_for_person` already does.
- **New personal data?** `orders.address_owner_id`: an account id (ids only, T42). Needed to stop shipping to the wrong person.
- **Docs and decisions:** T88 in `design/decisions.md`; technical design §5 shared-address paragraph; database map (`pnpm db:map`).

## Deploy, seeing it work, turning it off (E9)

- **Ship order:** the migration ships as its own PR first (the migration, its pgTAP tests, the regenerated types and the database map). It merges, and its CI `migrate` job must finish green on dev and prod before the code PR merges, as in `design/operations.md` > My list saving and Inbound notes.
- **In that gap, and after a rollback of the code:** the old code sends no owner.
  - Approving or replacing a gift to a shared address still works: when no owner is sent at all, the database records the person's current link owner (an owner sent as null, or a different one, is refused). The tiny window between the old code reading the address and the database reading the link only exists during this gap. The existing app tests pass against the migration with the old code.
  - A held shared order still linked to its owner places as before. An `own` order whose fresh address turns out to be shared records the current link's owner.
  - A shared order whose person was relinked isn't ended by the old code: `begin_placing` refuses it every tick (`order.begin_refused`) and nothing is bought. The fix is to roll forward to the new code, which ends it as `address_withdrawn`.
- **Seeing it work:** `order.address_withdrawn` on production after the QA account's relink check.
- **Off switch:** `zinc_ordering_enabled` stops all ordering, as today.

## Plan

**Architecture:** the migration adds `concierge.orders.address_owner_id` and recreates the order writers so it travels with `address_source`. `recipientAddress` returns the owner with the address; approval and replacement pass it; `place.ts` ends any shared order whose owner no longer matches; `begin_placing` refuses the same mismatch under the round lock.

**Tech stack:** one Supabase migration with pgTAP, `apps/web/modules/concierge/purchase/*`, local-db Vitest.

### Task 1: database (AC-1, AC-2, AC-4, AC-6, AC-7)

New migration `supabase/migrations/20261124100000_order_address_owner.sql`, header in the style of `20261113100000_order_address_source.sql` (which functions are copied from which migration; lines marked `-- New.`).

- `alter table concierge.orders add column address_owner_id uuid references auth.users (id) on delete set null`, with `check (address_owner_id is null or address_source = 'shared')`. Server-only, like `address_source`: no grant.
- `public.shared_address_for_person`: same signature and grants, adds `'owner_id', link.owner_id`.
- `approve_round` and `replace_failed_order` (latest in `20261122160000_approval.sql`): insert `address_owner_id` from the order JSON when `address_source = 'shared'`, else null. Raise (`P0001`, `... address changed`) when a shared order's owner is null or differs from `lists.active_link(person)`'s owner; the app maps it to the existing `busy` error ("try again"), since trying again reads the address afresh.
- `reapprove_order` and `fail_order_row` stay as they are: a shared order never reaches `fail_order_row`'s replacement insert (it becomes `address_rejected`), and `reapprove_order` is unused (T81). Failing closed covers both.
- `begin_placing`, before any write, refuses (returns nothing) when, for any named held order:
  - it's stored as `shared` and the element carries a fresh address whose source isn't `shared`, or whose `address_owner_id` key is present and differs from the stored owner; or
  - it's stored as `shared` and its stored owner `is distinct from` the current `active_link` owner (covers a null owner and a deleted owner).
  An `own` or null order may gain `shared` plus the element's owner (AC-2), which must equal the current link owner. A stored `shared` order never has its source or owner overwritten.
- pgTAP `supabase/tests/order_address_owner.test.sql`: the column and check; `shared_address_for_person` returns `owner_id`; `approve_round` and `replace_failed_order` store it and refuse a wrong or missing owner; `begin_placing` refuses after a relink (AC-4), when the element lies about the owner or the source, with a null owner (AC-6) and after the owner's account is deleted (AC-7); places when still linked to the same owner (AC-5) and when the element sends no owner (old code); an `own` order gains the owner (AC-2).
- Update `supabase/tests/order_address_source.test.sql` fixtures that write shared orders without an owner.

- [ ] Write the failing pgTAP test; run it red
- [ ] Write the migration; `pnpm db:test` green (whole pgTAP suite)
- [ ] Commit

### Task 2: app (AC-1, AC-3, AC-5)

- `purchase/store.ts`: `recipientAddress` returns `ownerId: string | null` (from `owner_id`; null for `own`). `FailedOrderRow`/held-order selects add `address_owner_id`.
- `purchase/approve.ts`: `Destination` gains `address_owner_id: string | null`; `destinationFor` fills it; approval sends it in the order JSON. `replace.ts` passes it through, and its saved-snapshot branch copies the failed order's.
- `purchase/place.ts` step 3: per held order with `ship_to = 'recipient'` and `address_source = 'shared'`, end it as `address_withdrawn` when the recipient read isn't a shippable shared address **or** `recipient.ownerId !== o.address_owner_id`. The event keeps its shape. Pass `address_owner_id: recipient.ownerId` with each fresh address to `begin_placing`.
- Local-db test in `__tests__/round-engine-held-address.test.ts` (or a new `purchase-relink-db.test.ts` if that file doesn't fit): approve to A's shared address, relink the person to B (B shares), run placing: the order is `failed`/`address_withdrawn`, no Zinc POST, the buyer's email is the ALL-112 one. A relink to an owner who doesn't share, a missing owner (AC-6), a deleted owner (AC-7), and still-linked cases that place (AC-5). Update the fixtures that write shared orders without an owner: `__tests__/round-engine-held-address.test.ts` (around lines 204, 342) and `__tests__/purchase.test.ts` (around 162, 653, 727, 739).

- [ ] Write the failing tests; run them red
- [ ] Implement; `pnpm --filter web typecheck`, `pnpm test:db` and the unit suite green
- [ ] Commit

### Task 3: docs

- [ ] T88 in `design/decisions.md`; technical design §5 paragraph gains one sentence ("and only to the owner it was approved for; a relink ends it as `address_withdrawn`"); `pnpm db:map` and republish the database map.

## Before coding: consistency check

- [ ] Every acceptance criterion maps to a task and a test.
- [ ] Every task traces back to a story or criterion (nothing extra).
- [ ] No open questions are left.
- [ ] Adversarial review of the spec done, and again of the plan; blockers fixed, owner decisions answered.

## Done: evidence on the ticket (T44)

- [ ] Test evidence on ALL-139: tests added (red first), suites and CI.
- [ ] No screen changes; the email is ALL-112's (link its screenshot).
- [ ] Live check (E9): QA account approves to a shared address, relinks, tick ends it as `address_withdrawn`, or listed as **Still open**.
- [ ] Every AC box ticked with a pointer to its evidence.

## Review focus

- A writer that forgets `address_owner_id` ends every shared order (fail closed, not a wrong shipment): the pgTAP test calls each writer.
- The race between `place.ts`'s check and `begin_placing`: AC-4's pgTAP test.
- `begin_placing` must refuse before writing anything, so a refused call leaves the held order and its snapshot untouched.
