# ALL-120 A base budget for each person: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a buyer sets one budget for a person ("$75 for Mom"), each occasion uses it unless given its own amount, and rounds pick the budget in the owner's order.

**Links:** [ALL-120](https://linear.app/allens-forever/issue/ALL-120) · PRD B-2 · product decisions 4 and 36 · T31 (revised here) · T71 (lists of rows; money keeps a Save) · ALL-44 · mock-up: https://claude.ai/artifact/Lk59BMJdQvVZgnB4oGTUXT (owner approved 2026-11-16).

## Spec: what it does

### Who it's for and what they can do

1. **One number per person:** as a buyer, I set "$75 for Mom" once, so every occasion's round has a budget without me setting each one.
2. **A different amount for one occasion:** as a buyer, I give Mother's Day its own $50, and the rest keep using $75.
3. **See it at a glance:** as a buyer, Mom's page shows one Budget row with its value ("$75 · Mother's Day $50 ›"), and tapping it opens the Budget screen (T71).
4. **Rounds use it:** as a buyer, a round for Mom starts with the right budget: the occasion's own, else the base, else my relationship default, else none.

### How a round's budget is chosen

1. The person's own budget for that occasion, if set.
2. Otherwise, the person's base budget ("any occasion").
3. Otherwise, the user's default for the person's relationship (`budget_defaults`).
4. Otherwise, no budget.

Owner, 2026-11-07, as revised 2026-11-16: an occasion with no amount of its own simply falls through to step 2. A stored "no budget for this occasion" (a null row, ALL-44) is retired: it now means the same as no row.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Mom has no budgets and no relationship default applies | Her page loads | A "Budget" row reads "Not set" and links to `/people/{id}/budget`. The old "Your budget" section with pencils is gone |
| AC-2 | The Budget screen | The buyer enters 75 under "Any occasion" and taps Save | Mom's base budget is $75. Her row reads "$75" |
| AC-3 | A $75 base | The buyer enters 50 for Mother's Day and taps Save | Mother's Day's own budget is $50. The row reads "$75 · Mother's Day $50". Christmas's field shows the placeholder "Uses $75" |
| AC-4 | Mother's Day at $50 | The buyer empties its field and taps Save | Its own budget is removed, so it uses the base again |
| AC-5 | A $75 base | The buyer empties "Any occasion" and taps Save | No base budget. Occasions with their own amounts keep them |
| AC-6 | Any field | The buyer enters "abc", a negative or a too-large amount | A plain message by that field, and nothing at all is saved |
| AC-7 | Only occasion budgets, no base | The row is shown | It lists the switched-on occasions' own amounts: "Christmas $100 · Mother's Day $50", cut with an ellipsis when long. Switched-off occasions aren't listed |
| AC-8 | A switched-off occasion with a saved budget | The buyer saves the Budget screen | Its budget is left as it is (only the switched-on kinds are sent) |
| AC-9 | Each step of the order | `round_candidates` runs | It returns the right budget for each step, and a null occasion row falls through like no row |
| AC-10 | Another user, or a signed-out visitor | They read or write Mom's budgets, directly or through `save_budgets` | Refused or nothing changes (pgTAP). A negative or null base amount is refused |
| AC-11 | A base budget larger than any occasion budget or default | `largestBudgetCents` sizes the wallet's suggested minimum | It uses the base. A null occasion row doesn't hide the largest amount |
| AC-12 | No base and no own amount, but a relationship default of $60 | The row and screen show | The row reads "$60 default" and empty fields show "Uses $60" |
| AC-13 | A round that already started for Mom | The buyer changes her budget | The round keeps the budget it started with. The Budget screen says "Rounds already started keep their budget." |
| AC-14 | 375 px light and dark, and desktop | The row and the Budget screen show | No sideways scroll (`@layout`) |

### Out of scope

| What | Where |
|---|---|
| A screen for relationship defaults (B-2) | Later (owner, 2026-11-07) |
| Scaling the base down for smaller holidays | Later, as a setting (owner, 2026-11-07) |
| Making `budgets.amount_cents` not null again | The contract step, in a later migration once no live code writes null (E7) |
| Turning Mom's other sections into rows | Not now; T71 says a person's details *may* follow |

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Where does the base budget live? | A `concierge.budgets` row with `occasion_kind = 'any'`, never null (check constraint) | Owner, 2026-11-16 (review pick). It inherits the owner policies, the `(person_id, user_id)` cascade, `unique(person_id, occasion_kind)` and the existing tests, and `largestBudgetCents` counts it for free |
| Does an empty occasion mean "use the base"? | Yes; the row is deleted | Owner, 2026-11-16 |
| Is a stored "no budget for this occasion" kept? | No: a null row means the same as no row. Revises T31's "a null row overrides the default" and narrows decision 36 | Owner, 2026-11-16 (review pick). The screen can't show it truthfully, and nobody can set it any more |
| Existing null rows | Deleted by the migration | Under the new rule a null row behaves exactly like no row in `round_candidates`, so deleting them changes no round, whatever production holds. Dev has none (checked 2026-11-16) |
| Does a budget change reach rounds already started? | No. A round copies its budget when it starts, and the screen says so | Owner, 2026-11-16 (review pick); "no silent states" |
| How is it saved? | One database function, `concierge.save_budgets(p_person_id uuid, p_amounts jsonb)`, `security invoker`, granted to `authenticated`. It first refuses (P0002) a person who isn't the caller's or is deleted. Keys must be `any` or an occasion kind; values must be whole numbers 0–2147483647 or null; a number upserts, null deletes. All or nothing. A check constraint also limits `budgets.occasion_kind` to those kinds, since signed-in users can write the table directly | One Save for money (T71). Invoker keeps the owner policies in force (T26); the rules live in the database (T72's pattern) |
| Where does the order live in code? | Only in SQL (`round_candidates`). The screen just shows `base ?? default` as the placeholder | Plan review: a second copy in TypeScript had no caller beyond that placeholder (E2). ALL-27 adds a shared helper if its on-demand run needs one (told on ALL-27) |
| What does the page get? | `PersonDetail` gains `baseBudgetCents` and `defaultBudgetCents`; each occasion keeps `budgetCents`, its own amount | |
| The row's look | Matches ALL-115's `SettingsRow`. If ALL-115 merged first, move it to `components/` and share it; otherwise copy it and share when the second lands **[Claude's call]** | One look for rows (T71) |
| Collision with ALL-27's `round_candidates` change | Whichever merges second dates its migration after the other's and re-creates the function with both changes; both pgTAP tests stay. After deploy, check the live function shows both | Two migrations replacing one function |
| Rollback | Vercel rollback, then `delete from concierge.budgets where occasion_kind = 'any'` so rounds stop using base budgets the old page can't show. This deletes typed base budgets for good, which is fine before launch. Written in `design/operations.md` | E7, E9 |

## Principles check

- **Simplest version?** No new table. One small invoker function. Cut: defaults screen, scaling, a stored "no budget".
- **Hard-coded values?** None new. Amounts are capped by `MAX_BUDGET_CENTS`, the column's own range.
- **Product boundaries?** Concierge only.
- **New personal data?** None: a budget amount per person, typed by the buyer, kept in the concierge.
- **E7:** expand-only. A check constraint, `round_candidates` replaced with the same signature, null rows deleted (same meaning now), and the not-null contract left for later.
- **E9:** seen working on production by a live check (set a base, see the row, clear it). Turned off as in "Rollback" above.
- **Decisions changed:** T31 revised (null row), decision 36 narrowed, decision 4 kept (budgets per person and occasion, now with a base). Recorded as T73.

## Plan

**Architecture:** the base is a `budgets` row with kind `any`. Only `round_candidates` applies the order. Mom's page shows a `BudgetRow` link; `/people/[id]/budget` holds a client form that posts to one server action, which calls `concierge.save_budgets`.

**Tech stack:** Postgres migration and pgTAP; `packages/core`; Next.js page, server action and client form; Vitest; Playwright.

**Global constraints**
- Kind for the base: `'any'` (`BASE_BUDGET_KIND` in `packages/core/src/budget.ts`).
- Copy: row label "Budget"; values "Not set", "$75", "$75 · Mother's Day $50", "$60 default". Screen title "Budget for {name}"; field "Any occasion" with help "What you usually spend on {name}."; group "Different for an occasion?" with "Optional"; placeholder "Uses $75"; note "Leave an occasion empty to use the amount above. Rounds already started keep their budget."; button "Save".
- Money shown as today's `money()` ("$75", "$75.50"), moved from `budgets.tsx` to `app/people/[id]/money.ts` so the row and the form share it.
- Event: `budgets.save` with `user_id` and `person_id` only (E6).
- Migration `supabase/migrations/20261116130000_base_budget.sql` (after `main`'s latest; renamed if ALL-27 lands first).

### Task 1: database (AC-9, AC-10, AC-11 in SQL)

**Files:** create the migration and `supabase/tests/base_budget.test.sql`; in `supabase/tests/optional_budgets.test.sql`, replace only "a person can have no budget for an occasion" with a fall-through check and keep its other assertions; leave `round_engine.test.sql` alone (its count of 4 candidates is already the check that `any` doesn't leak); regenerate types.

- [ ] **Step 1: pgTAP first.**
  - `round_candidates` for four people: own amount wins over base and default; base wins over default; default when no base; null when nothing. A null occasion row falls through to the base.
  - `save_budgets` as the owner: `{"any": 7500, "christmas": 10000}` stores both; `{"christmas": null}` deletes Christmas and keeps `any`; `{"any": -1}`, `{"any": 75.5}` and `{"bogus": 100}` each throw and store nothing (all or nothing); `{"birthday": 5000}` leaves a saved `fathers_day` row untouched; saving nulls leaves no null rows.
  - Another user's `save_budgets` on the owner's person throws P0002 and the owner's rows are unchanged. The owner's `save_budgets` on their own soft-deleted person throws P0002. Anon can't execute it.
  - Inserting `occasion_kind = 'any'` with a null amount, or `occasion_kind = 'bogus'` directly, throws a check violation.
- [ ] **Step 2:** `pnpm db:test` fails.
- [ ] **Step 3: migration:** delete null rows; add `check (occasion_kind <> 'any' or amount_cents is not null)` and `check (occasion_kind in ('any', 'birthday', 'anniversary', 'christmas', 'valentines_day', 'mothers_day', 'fathers_day'))`; update the column comment; `create or replace function concierge.round_candidates` with `coalesce(own.amount_cents, base.amount_cents, d.base_amount_cents)` and a left join on `budgets base … occasion_kind = 'any'`; create `concierge.save_budgets` (`security invoker`, `set search_path = ''`; first `perform 1 from public.people where id = p_person_id and deleted_at is null`, raising P0002 if not found; validates every key is `any` or an occasion kind and every value is null or a whole number 0–2147483647 (`jsonb_typeof = 'number'`, no fraction) before writing; upserts numbers on `(person_id, occasion_kind)`, deletes nulls; revoke from public and anon, grant to authenticated).
- [ ] **Step 4:** `pnpm db:test` passes; `pnpm db:types`.
- [ ] **Step 5:** commit `feat(db): base budget per person, and rounds use it (ALL-120)`.

### Task 2: (folded into Task 3 after the plan review)

`BASE_BUDGET_KIND = "any"` goes in `packages/core/src/budget.ts` with Task 3. No `appliedBudget` helper: the order lives only in SQL.

### Task 3: the people service and wallet sizing (AC-1–8, AC-11, AC-12)

**Files:** modify `modules/concierge/people/{service,store,rules}.ts`, `modules/concierge/zinc/connect.ts`, `modules/concierge/index.ts`, and their tests.

**Produces:**
- `PersonDetail` gains `baseBudgetCents: number | null` and `defaultBudgetCents: number | null` (a new store read of the user's `budget_defaults` row for the person's relationship, with its fake-store version). `budgetCents` stays the occasion's own; `listPeople`/`PersonCard` unchanged. The `any` row is never treated as an occasion.
- `saveBudgets(id: string, amounts: Record<string, number | null>): Promise<SaveResult>` and `parseBudgetForm(formData: FormData): { ok: true; amounts } | { ok: false; errors: Record<string, string> }`. Keys come only from the fixed list `["any", ...OCCASION_KINDS]`, read with `formData.has(k)`, never from a list the client sends; values via `parseBudget`, plus `MAX_BUDGET_CENTS`. P0002 from the database maps to the not-found text through `onOwnPerson`; failures log ids only (E6).
- `setBudget` and `setBudgetAction` are removed (no caller left).
- `largestBudgetCents` filters `amount_cents` not null instead of relying on sort order. (It also counts soft-deleted people's budgets; that's existing behaviour, left as it is.)

- [ ] **Step 1: tests:** `getPerson` maps an `any` row to `baseBudgetCents` and not to an occasion, and fills `defaultBudgetCents`; `parseBudgetForm` ignores unknown fields such as `bogus`; `parseBudgetForm` returns per-field errors and accepts empty fields as null; `saveBudgets` refuses another user's person (not-found text) and logs `budgets.save` with ids only; `largestBudgetCents` returns the base when it's the largest and ignores a null row that sorts first.
- [ ] **Step 2–4:** fails, implement, passes.
- [ ] **Step 5:** commit `feat: base budget in the people service (ALL-120)`.

### Task 4: the Budget row and screen (AC-1–8, AC-12, AC-13)

**Files:** create `app/people/[id]/budget/page.tsx`, `app/people/[id]/budget/budget-form.tsx`, `app/people/[id]/budget-row.tsx` and tests; modify `app/people/actions.ts` (`saveBudgetsAction`), `app/people/[id]/person-view.tsx` (the row replaces `<Budgets>`) and its test; delete `app/people/[id]/budgets.tsx` and its test.

- [ ] **Step 1: component tests:** the row's value for each case in Global constraints and AC-7, AC-12, as a link to `/people/p1/budget` with a chevron; the form shows the base and each switched-on occasion, placeholders "Uses $75" (or the default), the note, sends `id`, `any` and each kind; per-field errors shown by their fields and the typed values kept; a rejected action shows "That didn't save. Try again."; Save disabled while saving.
- [ ] **Step 2–4:** fails, implement (page like `questions/page.tsx`; after Save, back to Mom's page), passes.
- [ ] **Step 5:** commit `feat: a Budget row and screen for each person (ALL-120)`.

### Task 5: journey, layout, docs

**Files:** modify `e2e/people.spec.ts` (the budget steps of the journey; the `@layout` test waits for the Budget row and opens the Budget screen too); `design/technical-design.md` (§3 budgets, §4.2 order), `design/decisions.md` (T73), `design/operations.md` (rollback step), `design/ui.md` (person page budget row).

- [ ] **Step 1:** the journey sets a $75 base and a $50 Mother's Day, checks the row "$75 · Mother's Day $50", empties Mother's Day, and checks the row "$75".
- [ ] **Step 2:** full checks: lint, typecheck, test, build, `pnpm db:test`, e2e people and paying-for-gifts (unchanged, but run).
- [ ] **Step 3:** commit `test: base budget journey, and docs (ALL-120)`.

## Before coding: consistency check

- [x] Every AC maps to a task: AC-9, AC-10 → 1; AC-3, AC-12 → 3, 4; AC-11 → 1, 3; AC-1–8, AC-13 → 3, 4, 5; AC-14 → 5.
- [x] No open questions left.
- [x] Adversarial review of the spec (2026-11-16): 2 blockers, 8 should-fixes, 3 owner decisions, all folded in above.
- [x] Adversarial review of the plan (2026-11-16): no blockers; 4 should-fixes and 5 nits folded in above.

## Review focus

1. **Another user calling `save_budgets`** with the owner's person id: invoker plus owner policies, pinned by pgTAP.
2. **The `any` row leaking into occasion lists**, the Home card or the engine's candidates (it isn't an occasion). Task 3 test and Task 1's candidate count.
3. **A half-saved screen** when one amount is bad: one call, all or nothing (Task 1).
4. **ALL-27 landing first** and its paid filter being dropped from `round_candidates`: the merge rule above.
5. **A long row value** ("$75 · Christmas $100 · Mother's Day $50 · Birthday $40") pushing the page sideways: truncated, checked by `@layout`.
