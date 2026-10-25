# ALL-19 (part 1): Core domain logic in `packages/core`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the pure business rules every other ticket relies on: occasion dates, the ship-by deadline and reminder schedule, budget math, and round statuses. Everything is unit-tested with 90%+ coverage.

**Architecture:** small modules in `packages/core/src`, one job each, with no I/O and no dependencies. Dates are plain calendar dates (`YYYY-MM-DD` strings), never `Date` objects with a time zone, so a time zone can't move a date by a day. Money is integer cents. Part 2 of ALL-19 (migrations, RLS, generated types) follows once Docker and the Supabase CLI are installed.

**Tech stack:** TypeScript (strict), Vitest 5 with `@vitest/coverage-v8`.

**Spec:** `design/technical-design.md` §4 and §5, including the W1-2 spike's §4.2 changes on branch `aarontallen/all-16-zinc-checkout-spike` (Zinc's `max_price` covers item, shipping and tax, and doesn't include Zinc's $1 fee). The choices agreed in chat on 2026-10-25 are listed under Global constraints.

> **Changed after the plan (T23, 2026-10-25):** the fee isn't a constant. `ZINC_ORDER_FEE_CENTS` was removed, and `estimatedTotalCents`, `maxPriceCents` and `walletRequiredCents` take a required `feeCents`, read from `concierge.app_settings`. The schedule constants were removed the same way. Every schedule function takes a required `ScheduleSettings` object, and the values listed under Global constraints are now the seeded settings, not code.

## Global constraints

- `packages/core` has no runtime dependencies and does no I/O. Only dev dependencies are added.
- **Dates:** `type CalendarDate = string` in `YYYY-MM-DD` format. Every function takes and returns that format. No date library.
- **Money:** integer cents. Wherever rounding is needed, round **down** (`Math.floor`).
- **Occasions are US dates:** Christmas is Dec 25, Valentine's Day Feb 14, Mother's Day the 2nd Sunday of May, Father's Day the 3rd Sunday of June.
- **Leap day:** a Feb 29 birthday or anniversary falls on **Feb 28** in years without a Feb 29.
- **Schedule values (§4.1):** planning delivery default 7 days, safety buffer 2 days, round starts 28 days before the deadline, reminder 1 is 5 days after the heads-up, reminder 2 is 7 days before the deadline, the final notice 2 days before it, and the round is skipped at the deadline.
- **Budget values (§4.2):** the over-budget limit is `budget × (1 + over_budget_pct / 100)`, with the limit itself counting as over-budget (not dropped). Zinc's order fee is 100 cents.
- Before calling the work done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo root.

## Review focus

1. **Year rollover:** an occasion that's already passed this year (or is today) must give next year's date. "Today" counts as still upcoming.
2. **A late start very close to the occasion:** a person added 3 days before their birthday. The round still starts today, and every reminder that has already passed is dropped. Nothing is scheduled in the past.
3. **Several ideas picked at once:** the first order's `max_price` must not use up the whole budget and leave nothing for the second (see `reservedCents` in Task 4).
4. **Rounding at the over-budget limit:** a $33.33 budget at 15% gives a limit of 3832 cents (rounded down), and 3832 counts as over budget, not dropped.
5. **Bad input:** malformed dates (`2026-02-30`, `2026-2-3`) and negative cents throw a clear error rather than giving a wrong answer.

---

### Task 1: Calendar dates and the coverage setup

**Files:**
- Create: `packages/core/src/dates.ts`, `packages/core/src/dates.test.ts`, `packages/core/vitest.config.ts`
- Modify: `packages/core/package.json` (add `@vitest/coverage-v8` at the same version as `vitest`; `"test": "vitest run --coverage"`)

**Interfaces:**
- Produces:
  - `type CalendarDate = string`
  - `parseDate(s: string): { year: number; month: number; day: number }`, which throws `RangeError` on a malformed or impossible date
  - `toDate(year: number, month: number, day: number): CalendarDate`, which throws on an impossible date
  - `addDays(d: CalendarDate, n: number): CalendarDate` (n can be negative)
  - `daysBetween(from: CalendarDate, to: CalendarDate): number` (`to − from`, in days)
  - `compareDates(a, b): -1 | 0 | 1`, `minDate(a, b)`, `maxDate(a, b)`
  - `isLeapYear(year: number): boolean`
  - `dayOfWeek(d: CalendarDate): number` (0 = Sunday)

- [ ] **Step 1:** Write the failing tests:
  - `addDays("2026-12-30", 3) === "2027-01-02"`
  - `addDays("2028-03-01", -1) === "2028-02-29"`
  - `daysBetween("2026-10-25", "2026-12-25") === 61`
  - `isLeapYear(2028)`, `!isLeapYear(2100)`, `isLeapYear(2000)`
  - `dayOfWeek("2026-10-25") === 0`
  - `parseDate("2026-02-30")` and `parseDate("2026-2-3")` throw `RangeError`
- [ ] **Step 2:** Run `pnpm --filter @gifts-af/core test`. They fail because the module doesn't exist yet.
- [ ] **Step 3:** Implement the functions using UTC-only `Date` math internally (`Date.UTC`, `getUTC*`), never local time.
- [ ] **Step 4:** Add `vitest.config.ts` with v8 coverage over `src/**/*.ts`, excluding tests and `index.ts`, and thresholds of 90 for lines, branches, functions and statements. Run the tests and confirm they pass.
- [ ] **Step 5:** Commit: `ALL-19: calendar date helpers and coverage gate`.

### Task 2: Occasion dates

**Files:**
- Create: `packages/core/src/occasions.ts`, `packages/core/src/occasions.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type Holiday = "christmas" | "valentines_day" | "mothers_day" | "fathers_day"`
  - `type OccasionKind = Holiday | "birthday" | "anniversary"`. These names match the database's `occasions.kind`.
  - `type OccasionRule = { kind: Holiday } | { kind: "birthday" | "anniversary"; month: number; day: number }`
  - `occasionDateInYear(rule: OccasionRule, year: number): CalendarDate`
  - `nextOccurrence(rule: OccasionRule, onOrAfter: CalendarDate): CalendarDate`

- [ ] **Step 1:** Write the failing tests:
  - Mother's Day 2026 is `2026-05-10`, and 2027 is `2027-05-09`
  - Father's Day 2026 is `2026-06-21`
  - Christmas 2026 is `2026-12-25`, Valentine's Day 2027 is `2027-02-14`
  - A Feb 29 birthday gives `2027-02-28` in 2027 and `2028-02-29` in 2028
  - `nextOccurrence(christmas, "2026-12-25") === "2026-12-25"` (today counts) and `nextOccurrence(christmas, "2026-12-26") === "2027-12-25"`
  - A birthday rule with `month: 13` or `day: 31` in a 30-day month throws `RangeError`
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement it. The Nth Sunday of a month is the first Sunday on or after day `1 + 7 × (N − 1)`.
- [ ] **Step 4:** Run the tests. They pass.
- [ ] **Step 5:** Commit: `ALL-19: occasion date rules`.

### Task 3: Ship-by deadline and reminder schedule

**Files:**
- Create: `packages/core/src/schedule.ts`, `packages/core/src/schedule.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Constants: `PLANNING_DELIVERY_DAYS = 7`, `SAFETY_BUFFER_DAYS = 2`, `ROUND_LEAD_DAYS = 28`, `REMINDER_1_AFTER_HEADS_UP_DAYS = 5`, `REMINDER_2_BEFORE_DEADLINE_DAYS = 7`, `FINAL_NOTICE_BEFORE_DEADLINE_DAYS = 2`
  - `shipByDeadline(occasionDate: CalendarDate, worstCaseDeliveryDays = PLANNING_DELIVERY_DAYS): CalendarDate`
  - `roundStartDate(occasionDate: CalendarDate): CalendarDate`, which is the deadline under the planning default, minus 28 days
  - `planRoundStart(occasionDate, today): { startDate: CalendarDate; deadline: CalendarDate; late: boolean }`. `startDate = max(today, roundStartDate)`, and `late` is true when today is after the normal start.
  - `type ReminderKind = "reminder_1" | "reminder_2" | "final_notice" | "skip"`
  - `reminderSchedule(deadline: CalendarDate, headsUpDate: CalendarDate): { kind: ReminderKind; date: CalendarDate }[]`, in date order
  - `arriveBy(orderDate: CalendarDate, handlingDaysMax: number, deliveryDaysMax: number): CalendarDate`
  - `canArriveInTime(arriveByDate: CalendarDate, occasionDate: CalendarDate): boolean` (on or before the occasion)

The **compression rule** (agreed 2026-10-25): compute the three reminders from the rules. Drop any that land on or before the heads-up date or on or after the deadline. Drop reminder 1 if it lands on or after reminder 2's date. Then add `skip` at the deadline.

- [ ] **Step 1:** Write the failing tests:
  - `shipByDeadline("2026-12-25") === "2026-12-16"`, and `shipByDeadline("2026-12-25", 3) === "2026-12-20"`
  - `roundStartDate("2026-12-25") === "2026-11-18"`
  - On time: `planRoundStart("2026-12-25", "2026-11-01")` gives a start of `"2026-11-18"`, a deadline of `"2026-12-16"` and `late: false`
  - Late: `planRoundStart("2026-12-25", "2026-12-01")` gives a start of `"2026-12-01"` and `late: true`
  - Normal schedule: a deadline of `2026-12-16` with the heads-up on `2026-11-21` gives reminder 1 on `11-26`, reminder 2 on `12-09`, the final notice on `12-14` and skip on `12-16`
  - Compressed: the same deadline with the heads-up on `2026-12-10` gives only the final notice (`12-14`) and skip
  - Very late: the heads-up on `2026-12-15` gives only skip on `12-16`
  - `arriveBy("2026-12-01", 1, 5) === "2026-12-07"`, and `canArriveInTime` is true on the occasion day itself and false the day after
  - A negative number of delivery days throws `RangeError`
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement it. Delivery days are calendar days **[Claude's call]**. The slowest case already leaves margin, and the 2-day buffer covers weekends.
- [ ] **Step 4:** Run the tests. They pass.
- [ ] **Step 5:** Commit: `ALL-19: ship-by deadline and reminder schedule`.

### Task 4: Budget math

**Files:**
- Create: `packages/core/src/budget.ts`, `packages/core/src/budget.test.ts`

**Interfaces:**
- Produces:
  - `ZINC_ORDER_FEE_CENTS = 100`
  - `type BudgetFit = "within" | "over" | "dropped"`
  - `estimatedTotalCents(p: { priceCents; shippingCents; taxCents; feeCents? }): number`. `feeCents` defaults to `ZINC_ORDER_FEE_CENTS`.
  - `overBudgetLimitCents(budgetCents: number, overBudgetPct: number): number`, which is `floor(budget × (100 + pct) / 100)`
  - `classifyTotal(totalCents: number, budgetCents: number, overBudgetPct: number): BudgetFit`. This one function is used both for a single idea and for the sum of several picks.
  - `approvalCeilingCents(selectedTotalsCents: number[], budgetCents: number, overBudgetPct: number, overBudgetConfirmed: boolean): number | null`. It returns the budget when the sum is within budget, the sum when it's over budget and `overBudgetConfirmed` is true, and `null` otherwise (the approval is refused).
  - `type CommittedOrder = { status: "placing" | "placed" | "failed" | "shipped" | "delivered" | "cancelled" | "refunded"; maxPriceCents: number; finalTotalCents: number | null; feeCents: number }`
  - `committedSpendCents(orders: CommittedOrder[]): number`. Failed, cancelled and refunded orders count 0. The others count `(finalTotalCents ?? maxPriceCents) + feeCents`.
  - `maxPriceCents(p: { ceilingCents; committedCents; reservedCents }): number`, which is `ceiling − committed − reserved − ZINC_ORDER_FEE_CENTS`. `reservedCents` is the estimated totals of the other picks that haven't been ordered yet. It throws `RangeError` if the result is 0 or less, since that's a budget bug and must never become an order.
  - `walletRequiredCents(maxPrice: number): number`, which is `maxPrice + ZINC_ORDER_FEE_CENTS`

- [ ] **Step 1:** Write the failing tests:
  - `overBudgetLimitCents(10000, 15) === 11500` and `overBudgetLimitCents(3333, 15) === 3832`
  - Classifying a $100 budget at 15%: 10000 is within, 10001 is over, 11500 is over, 11501 is dropped
  - Several picks: `[4000, 5000]` on a 10000 budget is within (the ceiling is 10000). `[6000, 5000]` is over budget: it's refused without confirmation and gives a ceiling of 11000 with it. `[6000, 6000]` is dropped and refused even with confirmation.
  - `committedSpendCents`: a placing order (max 5000, fee 100) counts 5100. The same order once placed with a final total of 4200 counts 4300. A refunded order counts 0.
  - `maxPriceCents({ ceilingCents: 10000, committedCents: 0, reservedCents: 4000 }) === 5900`, and it throws when the ceiling is used up
  - `walletRequiredCents(5900) === 6000`
  - Negative or non-integer cents throw `RangeError`
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement it. Divide last and floor once (`Math.floor(budget * (100 + pct) / 100)`), so the math stays exact in integers.
- [ ] **Step 4:** Run the tests. They pass.
- [ ] **Step 5:** Commit: `ALL-19: budget math`.

### Task 5: Round statuses, exports, docs and PR

**Files:**
- Create: `packages/core/src/rounds.ts`, `packages/core/src/rounds.test.ts`
- Modify: `packages/core/src/index.ts` (re-export every module); `design/technical-design.md` §4.1 and §4.2 (record the leap-day, compression, `reservedCents` and calendar-day calls)

**Interfaces:**
- Produces:
  - `ROUND_STATUSES`: a readonly tuple of the 9 statuses in §5 order: `scheduled`, `generating`, `awaiting_approval`, `ordered`, `delivered`, `complete`, `needs_address`, `needs_attention`, `skipped`
  - `type RoundStatus = (typeof ROUND_STATUSES)[number]`
  - `canTransition(from: RoundStatus, to: RoundStatus): boolean`, using these allowed moves:
    - `scheduled` → `generating`, `needs_address`
    - `generating` → `awaiting_approval`, `needs_attention`
    - `awaiting_approval` → `ordered`, `generating`, `skipped`
    - `ordered` → `delivered`, `needs_attention`
    - `delivered` → `complete`
    - `needs_address` → `generating`, `skipped`
    - `needs_attention` → `ordered`, `generating`, `skipped`
    - `complete` and `skipped` are final

- [ ] **Step 1:** Write the failing tests: there are 9 statuses, every allowed move above returns true, `complete` and `skipped` have no way out, and `ordered → generating` is false.
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement it, then re-export everything from `index.ts`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo root. Everything passes, and core coverage is at least 90%.
- [ ] **Step 5:** Update design §4 with the calls above. Commit, push, and open a **draft** PR linked to ALL-19 (it stays a draft until part 2, the migrations, lands).
