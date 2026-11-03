# ALL-28 Round engine: daily tick, round statuses, reminders, skip: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gift rounds start on time, remind the user, and close out by themselves. The engine is fully built and proven with a test clock, and it ships **switched off on production** until the idea engine (ALL-27) gives it real ideas.

**Links:** [ALL-28](https://linear.app/allens-forever/issue/ALL-28) · design §4.1 (schedule), §5 (statuses), §5.1 (round engine), §6.1 step 4 (missing address), §6.4 (notifications) · PRD A-2 (reminders, then skip), P-5 (address asked late) · decisions T8 and T9 (daily tick), T14 (nine statuses), T22 (Vercel Cron keep-alive), T23 (settings), T26 (server writes rounds), new **T49** (below) · switch-on lives in [ALL-27](https://linear.app/allens-forever/issue/ALL-27) (MVP acceptance criterion added 2026-11-02).

## Spec: what it does

### Why

Today nothing happens on its own. A person's birthday can come and go without the app doing anything. The round engine is the clock: each morning it starts rounds that are due, sends the next email a round needs, and closes rounds nobody answered, so a gift is never forgotten and nothing is ever bought without a yes.

The idea engine (ALL-27) isn't built yet. Without it, a round on production would start with no ideas in it. So this ticket builds and proves the whole engine with a test clock, and ships it **off** on production behind a setting. ALL-27 replaces the idea stub and switches it on (Jim, 2026-11-02).

### Who it's for and what they can do

1. **Rounds start by themselves:** as a buyer, a round starts for each occasion 28 days before its planning deadline, without my doing anything, so I'm never caught out.
2. **I'm told, then reminded:** as a buyer, I get a heads-up when ideas are ready, then reminder 1, reminder 2 and a final notice on the schedule in design §4.1, each on the morning it's due.
3. **Unanswered rounds close cleanly:** as a buyer who never answered, the round is marked skipped at the deadline, nothing is bought, and I get one short email saying so (Jim, 2026-11-02).
4. **Late additions still work:** as a buyer who adds someone close to their birthday, the round starts the next morning on a squeezed schedule, and the heads-up says time is short.
5. **No address, no guessing:** as a buyer whose person has no address, the round asks me for it on the same reminder schedule, carries on as soon as I add it, and is skipped at the deadline if I never do.
6. **Off switch (owner):** as the owner, one settings row turns the engine on or off on any environment without a deploy.
7. **Builders can advance a round (developer):** as a developer on a later ticket (approval ALL-29, orders ALL-30, address form here), I call one function to move a round on right away, safely alongside the daily run.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A request to the tick route without `Authorization: Bearer $CRON_SECRET` (missing or wrong) | It's called | 401; no round is created, claimed or changed |
| AC-2 | `round_engine_enabled` = 0 | The tick runs with the right secret | It returns OK, does nothing else, and logs one `round_tick` event with `enabled: false` |
| AC-3 | Engine on; an enabled occasion of a live person whose start date (design §4.1) is today or earlier, with no round yet this year | The tick runs | One `gift_rounds` row is created with the occasion's date, the planning deadline, the budget (the person's budget for that occasion kind, else the relationship default, else none) and `late` set if it started after its normal start |
| AC-4 | The same tick, or a second tick the same day | The tick runs again | No second round is created (unique person, occasion, year) |
| AC-5 | Engine on, a test clock run outside production | One round runs day by day from `scheduled` | It goes `scheduled → generating → awaiting_approval`, sends the heads-up on day 0, reminder 1 on heads-up + 5, reminder 2 at deadline − 7, the final notice at deadline − 2, then becomes `skipped` and sends the skipped email at the deadline. Each email goes exactly once, and no other email is sent |
| AC-6 | A person added so late that some reminders would land on or before the heads-up | Their round runs with the test clock | It follows `reminderSchedule`'s compression (design §4.1): only the reminders still ahead are sent, the skip stays at the deadline, and the heads-up says time is short |
| AC-7 | An occasion whose fastest-shipping deadline has also passed | The tick runs | No round is created this year (`planRoundStart` returns null), and nothing is sent |
| AC-8 | A due round with no address on the person | It's advanced | It moves to `needs_address`, sends the needs-address email, then sends address reminders on the same dates as AC-5 (reminder 1, reminder 2, final notice), and is skipped with the skipped email at the deadline |
| AC-9 | A round in `needs_address` | The buyer saves a full address for that person | The round is advanced at once to `generating` and on to `awaiting_approval` with the heads-up, without waiting for the next tick (only when the engine is on). The reminder schedule restarts from that heads-up, squeezed as in AC-6 |
| AC-10 | A round claimed by the tick (lock not expired) | A user action tries to advance it at the same moment | Only one of them works on the round; the other leaves it alone. No step runs twice and no email is sent twice |
| AC-11 | A step that dies partway (after claiming, before finishing) | The next tick runs after the lock has expired | The step is retried; an email that was already sent for that step is not sent again |
| AC-12 | A round whose step has failed on 3 ticks in a row (`round_max_attempts`), for example the email service refusing the send | The next tick runs | The round keeps its status and is retried each day; once a round has had more than `round_max_attempts` (3) claims end without a successful finish, each retry logs a `round_stuck` event at claim time for the owner's health email (W5-3). The deadline skip still happens. The buyer isn't emailed about our own failure. A success resets the count |
| AC-13 | Production (`VERCEL_ENV=production`) | The tick is called with a test-clock "now" | The override is ignored and real time is used |
| AC-14 | Any tick or step | It logs | One JSON event per line with ids and counts only (round id, user id, status, counts), never names, emails or addresses (E6, T27) |
| AC-15 | The final notice | It's rendered | It no longer says "this is the last day"; it says the order-by date, which is 2 days away |

### Out of scope

- **Real gift ideas.** A stub stands in: outside production it writes sample ideas so the flow can be tested; ALL-27 replaces it and switches the engine on.
- **Approving, rejecting, choosing a gift, skipping on purpose:** the approval screen is ALL-29. Until then the heads-up's "Choose a gift" button opens the person's page.
- **`ordered`, `delivered`, `complete`, the late-risk check and reaction prompts:** ALL-30, ALL-33, ALL-34. The engine leaves rounds in those statuses alone.
- **The owner's health email and alerting:** W5-3 (ALL-35). This ticket only logs the event it will read.
- **Auto-buy heads-up** (decision 40's second heads-up kind). Only the "reminder" kind is sent.
- **Stale list check** (Jim, 2026-11-02): asking a list owner to confirm a list untouched for 9 months, and a "this list may be out of date" note in buyers' round emails. It belongs to the lists product and needs rounds that offer list picks (ALL-27), so it's [ALL-80](https://linear.app/allens-forever/issue/ALL-80).
- **Fanning each round out to its own function call** (design §5.1). Not needed while the idea step is a stub; see "What was decided".

### Open questions

None left for the owner except **T49** (Vercel Cron instead of `pg_cron`), which reverses the owner's T8 and needs their OK before merging. To keep a "no" cheap, the cron wiring is the last, smallest task: the route, step function and SQL don't depend on what calls the tick. If the owner says no, that task becomes a `pg_cron` + `pg_net` migration that POSTs to the same route. **[Verify]** marks are facts to check while building.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| What happens on production before ALL-27? | **The engine ships off** (`round_engine_enabled` = 0). ALL-27's MVP criterion switches it on after replacing the stub. | Jim, 2026-11-02. A live engine without ideas would start empty rounds. E7: a risky path ships with an off switch. |
| What wakes the engine? | **Vercel Cron**, once a day at 12:00 UTC, calling `GET /api/rounds/tick` with `CRON_SECRET`, like `/api/keepalive` (T22). Recorded as **T49**, reversing T8's `pg_cron` + `pg_net` + Vault secret. **Needs the owner's OK.** | Jim, on Claude's recommendation. One scheduler instead of two, no `pg_net` or Vault secret, and Vercel runs crons only on production, which gives "dev schedule off" for free. Hobby fires within the hour (12:00–12:59 UTC), which is fine for morning emails. |
| Email when a round is skipped? | **Yes**, a short `skipped` email on the deadline: no gift was chosen, nothing was bought, you can still buy one yourself. | Jim, 2026-11-02. |
| What if the `skipped` email is refused? (ruling 12) | **The round is skipped anyway.** The send record is removed and `round_skip_email_failed` is logged; the email isn't retried. | The deadline is the deadline: a round must never stay open past it waiting on an email. Every other step still fails and retries on a refusal. |
| Who gets the `skipped` email? (ruling 13) | **Only a buyer we already asked**: the round sent its `heads_up` or `address_request`. Otherwise it's skipped silently and `round_skipped_silently` is logged. Switching an occasion off skips its open round silently too (a database trigger, like deleting it). **[Claude's call]** | "No gift was chosen" makes no sense to someone who never heard about the round, e.g. one stuck in `generating` by our own fault; the owner sees it in the event instead. |
| Final notice wording | Says the order-by date instead of "this is the last day". | It's sent 2 days before the deadline, so "last day" was wrong. |
| Fan out one function call per round? | **No, not in this ticket.** The tick advances due rounds one after another, each in its own try/catch, so one failing round can't stop the rest. ALL-27 revisits this when generating ideas takes minutes. **[Claude's call]** | E1 and E2: the stub is instant and the MVP has about a dozen rounds a month. Fanning out now would add machinery with nothing to protect. |
| How is "now" overridden for tests? | `?now=<ISO time>` on the tick route, honoured only when `VERCEL_ENV` isn't `production`; the route reads env and passes `now` in (E3). **[Claude's call]** | Design §5.1 test clock. |
| When is a late round created? | At the next morning's tick, not the moment the person is added. **[Claude's call]** | One code path. The heads-up arriving the next morning matches every other email. |
| What counts as "has an address"? | The person has `address_line1`, `city`, `state` and `zip`. Shipping to the buyer instead is chosen at approval (D38), so the round asks for the recipient's address. **[Claude's call]** | Design §6.1 step 4: ideas need the address for delivery and tax. |
| How do we stop duplicate emails? | Each email step a round sends is recorded once per round (a row in `concierge.round_sends`, unique on round and step, e.g. `address_reminder_1`, `reminder_1`, `skipped`), written before sending. If the send then fails cleanly (the email service says no), the record is removed and the step fails, so the next tick retries it and it counts toward AC-12. If the process dies mid-send, the record stays and the email isn't sent again. **[Claude's call]** | AC-10, AC-11. At-most-once on a crash: a missed reminder is better than a doubled one, and the next one still comes. A clean refusal is retried, so a heads-up is never silently lost. |
| Who supplies a missing recipient address? | **Nobody yet.** There is no recipient-address form, so it is a separate ticket, [ALL-81](https://linear.app/allens-forever/issue/ALL-81), which **blocks ALL-27's switch-on**. Here, saving a person (`updatePerson`) resumes their `needs_address` rounds, so the form only has to save the address. | Jim, 2026-11-02. A form is its own screen and its own spec; the engine can be built and tested without it, and stays off until it exists. |
| What if a step keeps failing? | The round **stays in its status** and is retried every tick; once a round has had more than `round_max_attempts` (3) claims end without a successful finish, each retry logs `round_stuck` at claim time for the owner. It doesn't move to `needs_attention`. **[Claude's call]** | The core rules only allow `needs_attention` from `generating` or `ordered`, and design §5 means it as something the *buyer* acts on (failed order, price rise). Parking a round there for our own bug would need a way back and a buyer email we don't want. Staying put means the round recovers by itself once the fault is fixed, and the deadline skip still applies (E7, recovery over prevention). Design §5.1's "after 3 failed days → `needs_attention`" is updated to match. |
| After an address arrives, do reminders start over? | Yes. The heads-up date becomes the day ideas are ready, and `reminderSchedule` runs from there (squeezed if late). Address reminders and gift reminders have separate step keys. **[Claude's call]** | The heads-up is new news (ideas to pick from), so the buyer should get the full nudge sequence that's still possible. |
| New email templates | `skipped` (new) and an address reminder, which reuses `needs_address` with a "reminder" line rather than a new kind. **[Claude's call]** | The address email's ask doesn't change, only its urgency. |
| How do we know which reminder is next? | The round stores its heads-up date (new column `heads_up_on`); `reminderSchedule(deadline, heads_up_on)` gives the rest, and the sent-step records say which are done. **[Claude's call]** | The schedule is recomputed from two dates instead of being stored twice. Expand-only migration (E7). |
| Who hears about engine failures? | The owner, through the `round_needs_attention` event (W5-3 turns it into an email). The buyer isn't emailed. **[Claude's call]** | It's our failure, and the 28-day runway leaves time to fix it. |
| What does the "Choose a gift" button open before ALL-29? | The person's page in the app. ALL-29 points it at the approval screen. **[Claude's call]** | Every email button needs somewhere real to go. |
| Logging | Reuse ALL-25's `logEvent` (`apps/web/lib/log.ts`). If ALL-25 hasn't merged when this branch needs it, rebase on `main` first; don't make a second copy. | E6, one helper. |

## Principles check

- **Simplest version?** Cut: `pg_cron`, `pg_net` and the Vault secret (T49); fanning out per round; the auto-buy heads-up; a separate alerting path. The engine is one route, one step function and a few SQL functions.
- **Hard-coded values?** New `app_settings` rows: `round_engine_enabled` (0 on every environment by default; the owner sets it), `round_lock_minutes` (10), `round_max_attempts` (3, failures in a row before `round_stuck` is logged). Schedule timings already exist (`round_lead_days` and the rest). Secret: the existing `CRON_SECRET`.
- **Product boundaries?** All inside `modules/concierge`. Reads `public.people` (shared) and `concierge` tables only. No `lists` reads in this ticket.
- **New personal data?** None. New columns hold dates and step keys; events carry ids and counts only.
- **Docs and decisions:** done in Task 7: T49 added to `design/decisions.md` (pending the owner's OK); `design/technical-design.md` updated in §2 (diagram and background jobs row), §4.1 table (skipped email), §5.1 (Vercel Cron, off switch, sequential steps, `round_sends`, stuck rounds stay put, test clock, outbox) and §6.1 step 4 (no address form yet, ALL-81); README runbook line for the off switch. No new script, so no commands-table change. ALL-27 already updated.

## Plan

Spec approved by Jim, 2026-11-02.

**Architecture:** the decisions live in pure functions in `packages/core` (`round-plan.ts`): what round to create, and what a round should do next on a given day. A thin engine in `apps/web/modules/concierge/rounds/` claims rounds through SQL functions (locks, leases, one-send-per-step records), runs the next step and writes the result. `GET /api/rounds/tick` builds the clients, settings and clock and calls the engine. Saving a person's address calls the same engine for that person's waiting rounds.

**Tech stack:** Postgres migration and pgTAP (`supabase/`), TypeScript in `packages/core` (Vitest), Next.js 16 route handler and the concierge module (Vitest with in-memory fakes, following `fake-store.ts` and `fake-people-store.ts`), Playwright against local Supabase, `vercel.json` cron.

### Global constraints

- Engine "today" is the UTC calendar day of `now` (`now.toISOString().slice(0, 10)`). The tick runs at 12:00 UTC, which is morning in every US zone. **[Claude's call]**
- A round due on a calendar day has `next_action_at = <that day>T00:00:00Z`, so that day's tick picks it up whenever the cron fires within the hour.
- Settings (T23), all new rows `on conflict do nothing`: `round_engine_enabled` = `0`, `round_lock_minutes` = `10`, `round_max_attempts` = `3`. Read through the store's `setting(key)`; never defaulted in code.
- Events go through `logEvent` from `apps/web/lib/log.ts` (ALL-25). Ids, statuses, kinds and counts only.
- Server-only tables and functions: grant to `service_role` only; revoke from `public, anon, authenticated` (T26, as in `action_links`).
- Step keys (the `round_sends.step` values): `heads_up`, `reminder_1`, `reminder_2`, `final_notice`, `skipped`, `address_request`, `address_reminder_1`, `address_reminder_2`, `address_final_notice`.
- Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before writing the route handler.
- The database may be used freely now. Run `pnpm db:types` after the migration and commit the result.

### Task 1: Schema: settings, heads-up date, send records, claim functions (AC-3, AC-4, AC-10, AC-11)

**Files:**
- Create: `supabase/migrations/20261103100000_round_engine.sql`
- Create: `supabase/tests/round_engine.test.sql`
- Modify: `packages/core/src/database.types.ts` (generated)

**Interfaces (produces):**
- `concierge.gift_rounds.heads_up_on date` (nullable).
- `concierge.round_sends (round_id uuid, user_id uuid, step text, created_at timestamptz)`, primary key `(round_id, step)`, FK `(round_id, user_id)` → `gift_rounds (id, user_id)` on delete cascade. Server-only.
- `concierge.round_candidates(p_today date) returns table (user_id uuid, person_id uuid, occasion_id uuid, kind text, month int, day int, budget_cents int, has_round_this_year … )`: every enabled, live occasion of a live person, with the budget already resolved: the `budgets` row for (person, kind), else `budget_defaults.base_amount_cents` for (user, person's relationship), else null. **[Verify]** whether ALL-21's people service already resolves this; if so, match its rule exactly. Year matching is left to the caller.
- `concierge.claim_due_rounds(p_now timestamptz) returns setof concierge.gift_rounds`: rows with `next_action_at <= p_now`, status not in (`complete`, `skipped`, `ordered`, `delivered`), and `locked_until` null or `< p_now`. Uses `for update skip locked`, sets `locked_until = p_now + round_lock_minutes`, `attempts = attempts + 1`, and returns the updated rows.
- `concierge.claim_round(p_round_id uuid, p_now timestamptz) returns concierge.gift_rounds`: the same rules for one round; returns null if it's locked or not claimable.
- `concierge.finish_round(p_round_id uuid, p_lock timestamptz, p_status concierge.round_status, p_next_action_at timestamptz, p_heads_up_on date) returns boolean`: updates only `where id = p_round_id and locked_until = p_lock` (the holder's lease). Sets status, `next_action_at`, `heads_up_on` (coalesced with the existing value), `locked_until = null` and `attempts = 0`. Returns whether a row changed.
- All four functions: `security definer`, `set search_path = ''`, execute granted to `service_role` only.

- [ ] **Step 1: Write the failing pgTAP tests** in `round_engine.test.sql` (use `_helpers.psql` like the others):
  - The three settings exist with values 0, 10 and 3.
  - `round_sends` rejects a second `(round_id, 'reminder_1')`. `authenticated` can't select or insert it.
  - `claim_due_rounds(now)` returns a due round once. A second call at the same `now` returns nothing (leased). A call at `now + 11 minutes` returns it again with `attempts = 2`.
  - `claim_round` returns null while the lease is live.
  - `finish_round` with a stale lease returns false and changes nothing. With the right lease it sets the status, clears the lock and resets `attempts` to 0.
  - `round_candidates` leaves out disabled occasions, soft-deleted people and soft-deleted occasions. It resolves the budget as person row > relationship default > null.
  - `authenticated` can't execute any of the four functions.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: the new file fails (functions missing).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `supabase db reset` (local), then `pnpm db:test`. Expected: all pass. Then `pnpm db:types` and `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(db): round engine claims, leases and send records (ALL-28)`.

### Task 2: Core: what to create and what to do next (AC-3, AC-5, AC-6, AC-7, AC-8) [P with Task 3]

**Files:**
- Create: `packages/core/src/round-plan.ts`, `packages/core/src/round-plan.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces (produces):**
```ts
export type StepKey =
  | "heads_up" | "reminder_1" | "reminder_2" | "final_notice" | "skipped"
  | "address_request" | "address_reminder_1" | "address_reminder_2" | "address_final_notice";

export type NewRound = {
  occasionDate: CalendarDate; occasionYear: number;
  shipByDeadline: CalendarDate; late: boolean;
};
/** null = not due yet, or too late this year (planRoundStart null). */
export function roundToCreate(rule: OccasionRule, today: CalendarDate, s: ScheduleSettings): NewRound | null;

export type RoundView = {
  status: RoundStatus; shipByDeadline: CalendarDate;
  headsUpOn: CalendarDate | null; hasAddress: boolean; sent: ReadonlySet<StepKey>;
};
export type NextAction =
  | { do: "request_address"; send: "address_request" }   // scheduled, no address → needs_address
  | { do: "generate" }                                     // scheduled with address, or needs_address now has one → generating
  | { do: "send"; send: StepKey }                          // a reminder due today
  | { do: "skip"; send: "skipped" }                        // deadline reached → skipped
  | { do: "wait"; until: CalendarDate };                   // nothing due; next due day
export function nextAction(r: RoundView, today: CalendarDate, s: ScheduleSettings): NextAction;
```
- `roundToCreate`: the occasion's `nextOccurrence(rule, today)`, then `planRoundStart`. Returns a round when `startDate <= today`.
- `nextAction` for `awaiting_approval`: the reminders come from `reminderSchedule(shipByDeadline, headsUpOn)`, mapped `reminder_1/reminder_2/final_notice/skip`. It returns the earliest entry dated on or before today that isn't in `sent`. If several are overdue (a missed tick), it sends only the **latest** overdue reminder, and an overdue skip always wins. Otherwise it waits until the next entry's date.
- For `needs_address` it does the same, using the `address_*` keys and `headsUpOn` = the address request day. If `hasAddress` is now true, it returns `generate`.
- For `needs_attention` it returns `skip` only at the deadline, and `wait` otherwise.

- [ ] **Step 1: Write failing tests** with the default settings (7, 2, 28, 5, 7, 2, 1) and an occasion on `2027-03-31` (deadline `2027-03-22`, normal start `2027-02-22`):
  - `roundToCreate` returns null on `2027-02-21` and a round with `late: false` on `2027-02-22`.
  - On `2027-03-20` it returns `late: true` with deadline `2027-03-22`.
  - On `2027-03-29` (fast deadline `2027-03-28` already passed) it returns null (AC-7).
  - Walking `nextAction` day by day from a heads-up on `2027-02-22` gives exactly `reminder_1@02-27`, `reminder_2@03-15`, `final_notice@03-20` and `skip@03-22`, with `wait` in between (AC-5).
  - A heads-up on `2027-03-17` gives only `final_notice@03-20` and `skip@03-22` (AC-6).
  - A missed tick on `03-21` with nothing sent gives `final_notice`, not `reminder_2`.
  - The address path mirrors this with the `address_*` keys (AC-8).
  - `needs_address` with `hasAddress: true` gives `generate`.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/core test round-plan`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS, and coverage stays at the package's threshold.
- [ ] **Step 5: Commit** `feat(core): round plan: when to start and what to send next (ALL-28)`.

### Task 3: Emails: skipped, address reminders, late heads-up, final-notice wording (AC-6, AC-15, story 3) [P with Task 2]

**Files:**
- Modify: `apps/web/modules/concierge/notify/templates.ts`, `notify/samples.ts` (if samples are listed there), `__tests__/templates.test.ts`, `__tests__/samples.test.ts`

**Interfaces (produces):**
- `NotificationKind` gains `"skipped"`. `TemplateData.skipped = Occasion`, `TemplateLinks.skipped = { open: string }`.
- `TemplateData.needs_address` gains `reminder?: boolean`. When true, the copy adds a line saying it's a reminder and gives the order-by date.
- `TemplateData.heads_up` (both modes) gains `late?: boolean`. When true, the copy adds a line saying time is short.
- `TemplateData.final_notice` gains `orderByText: string`.
- `ActionName` gains `"open_person"` in `notify/actions.ts`. Its confirm page says "Open <name>'s page" and `run` returns ok. The engine sends the user to `/people/<personId>` after confirming. **[Verify]** that the confirm-then-redirect fits `links.ts`; if not, the action's `done` page links there instead.

Copy (exact):
- skipped subject: `No gift for ${personName}'s ${occasion} this time`. Paragraphs: `No gift was chosen for ${personName}'s ${occasion} (${dateText}), so nothing was bought.` and `You can still buy something yourself. We'll be back for the next occasion.` Button: `Open GiftsAF`.
- final_notice first paragraph: `${personName}'s ${occasion} is ${dateText}. Choose a gift by ${orderByText} so it arrives in time.` (replaces "this is the last day…").
- heads_up late line: `${personName}'s ${occasion} is close, so we've kept only gifts that can still arrive in time.`
- needs_address reminder line: `A reminder: we still need ${personName}'s address to find gifts that arrive by ${dateText}.`

- [ ] **Step 1: Write failing tests:**
  - `skipped` renders the subject and both paragraphs and has one button.
  - `final_notice` doesn't contain "last day" and contains the order-by text.
  - `heads_up` with `late: true` contains the late line, and without it doesn't.
  - `needs_address` with `reminder: true` contains the reminder line.
  - Every kind is in `SAMPLE_DATA` and escapes HTML (extend the existing loop).
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test templates samples`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notify): skipped email, address reminders, honest final notice (ALL-28)`.

### Task 4: The engine: tick, advance, idea stub (AC-3 to AC-12, AC-14)

**Files:**
- Create: `apps/web/modules/concierge/rounds/store.ts` (interface plus the Supabase version on `createAdminClient`)
- Create: `apps/web/modules/concierge/rounds/engine.ts`
- Create: `apps/web/modules/concierge/rounds/ideas.ts` (stub)
- Create: `apps/web/modules/concierge/__tests__/fake-round-store.ts`, `__tests__/round-engine.test.ts`
- Modify: `apps/web/modules/concierge/index.ts` (export `runTick`, `advanceRound`, `resumeRoundsForPerson`, `createSupabaseRoundStore` and their types)

**Interfaces:**
- Consumes: Task 1's SQL functions, Task 2's `roundToCreate` and `nextAction`, Task 3's templates, `notify()` and `NotifyDeps`.
- Produces:
```ts
export interface RoundStore {
  setting(key: string): Promise<number>;
  scheduleSettings(): Promise<ScheduleSettings>;          // the seven §4.1 rows
  candidates(today: CalendarDate): Promise<Candidate[]>;  // round_candidates
  insertRound(r: NewRoundRow): Promise<boolean>;          // on conflict do nothing; true if inserted
  claimDue(now: Date): Promise<ClaimedRound[]>;
  claim(roundId: string, now: Date): Promise<ClaimedRound | null>;
  finish(roundId: string, lock: Date, next: { status: RoundStatus; nextActionAt: Date | null; headsUpOn?: CalendarDate }): Promise<boolean>;
  sentSteps(roundId: string): Promise<Set<StepKey>>;
  recordSend(roundId: string, userId: string, step: StepKey): Promise<boolean>; // false = already recorded
  forgetSend(roundId: string, step: StepKey): Promise<void>;
  roundContext(roundId: string): Promise<RoundContext>;   // person name, occasion label, dates, hasAddress, personId, ideas
  waitingRoundsForPerson(personId: string): Promise<string[]>; // needs_address round ids
}
export type EngineDeps = { store: RoundStore; notify: NotifyDeps; now: Date; generateIdeas: GenerateIdeas };
export function runTick(deps: EngineDeps): Promise<TickSummary>;      // { enabled, created, advanced, failed }
export function advanceRound(roundId: string, deps: EngineDeps): Promise<"advanced" | "busy" | "failed">;
export function resumeRoundsForPerson(personId: string, deps: EngineDeps): Promise<void>;
export type GenerateIdeas = (roundId: string) => Promise<void>;
```
- `runTick`: if `round_engine_enabled` isn't 1, log `round_tick {enabled:false}` and return. Otherwise insert a round for each candidate where `roundToCreate` is non-null (`status: scheduled`, `next_action_at = now`). Then claim due rounds and advance each one in its own try/catch, one after another. Finally log `round_tick {enabled, created, advanced, failed}`.
- One step:
  - Claimed round → `nextAction`.
  - For a `send` or `skip` action: first `recordSend`. If it returns false, skip the send (AC-11). Otherwise `notify`. If notify returns `{ok:false}`, call `forgetSend` and throw.
  - Then `finish`, with the next `wait` day as `nextActionAt`.
  - `generate` calls `generateIdeas` and then runs the `heads_up` send in the same claim (status `generating` → `awaiting_approval`, `headsUpOn = today`).
  - On a throw, leave the lease to expire (no `finish`). If `attempts >= round_max_attempts`, log `round_stuck {round_id, user_id, status, attempts}` (AC-12).
- `advanceRound` uses `claim`, and returns `busy` when that gives null (AC-10).
- `resumeRoundsForPerson` does nothing when the engine is off.
- Link expiry for every email: the round's deadline at 23:59 UTC. Links: `choose` / `addAddress` / `open` all use `open_person`.
- `ideas.ts` stub: in production it throws `"Idea engine not built yet (ALL-27)"`. Elsewhere it inserts 3 sample `gift_ideas` (source `generated`, status `proposed`, plain titles, budget-safe prices). ALL-27 replaces this file.

- [ ] **Step 1: Write failing tests** in `round-engine.test.ts`, with the fake store, a fake channel that records sends, and a clock advanced day by day:
  - Engine off: no store writes, and one `round_tick` event with `enabled:false` (AC-2).
  - Creation runs once, even across two ticks (AC-3, AC-4).
  - **The full run, scheduled → skipped:** the recorded sends are exactly `heads_up, reminder_1, reminder_2, final_notice, skipped` on the AC-5 dates, and the final status is `skipped` (AC-5).
  - A late person gets the compressed sends and `late: true` in the heads-up (AC-6).
  - The address path: `address_request` and its reminders, then `skipped` (AC-8).
  - `resumeRoundsForPerson` after the address arrives → `heads_up` the same day, with reminders restarting from that day (AC-9).
  - `advanceRound` on a round the tick holds returns `busy` and sends nothing (AC-10).
  - A step that throws after `recordSend`, retried after the lease expires, sends nothing twice (AC-11).
  - The channel refusing 3 days running → status unchanged, the round retried daily, and `round_stuck` logged on the 3rd. A success then resets the count (AC-12).
  - Every logged event's keys are a subset of the allowed id/count/status keys, with no name or email values (AC-14).
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test round-engine`. Expected: FAIL.
- [ ] **Step 3: Implement** the store (the Supabase version calls the Task 1 functions through `.schema("concierge").rpc(...)`), then the engine and the stub.
- [ ] **Step 4: Run** the same command, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(concierge): round engine: create, claim, remind, skip (ALL-28)`.

### Task 5: Tick route and address hook (AC-1, AC-2, AC-9, AC-13)

**Files:**
- Create: `apps/web/app/api/rounds/tick/route.ts`, `apps/web/app/api/rounds/tick/tick.ts` (handler with injected deps), `apps/web/app/api/rounds/tick/__tests__/tick.test.ts`
- Modify: `apps/web/modules/concierge/people/people.ts` (`updatePerson`: after a successful save, `resumeRoundsForPerson(id, …)` with server-built deps; failures logged, never shown to the user), `apps/web/modules/concierge/notify/channels.ts` (see the outbox below), and the public-paths test or proxy allow-list if API routes need listing **[Verify]** against `lib/supabase/proxy.ts`

**Interfaces:**
- `handleTick(request: Request, env: { cronSecret?: string; vercelEnv?: string }, run: (now: Date) => Promise<TickSummary>): Promise<Response>`.
  - Returns 401 unless `Authorization` equals `Bearer ${cronSecret}` and the secret is set.
  - Reads `?now=` only when `vercelEnv !== "production"` and it parses as a date; otherwise uses `new Date()`.
  - Returns `200 {ok:true, ...summary}`, or `500 {ok:false}` (logged) on a throw.
- `route.ts` `GET` builds `EngineDeps`: `createSupabaseRoundStore()`, `createSupabaseNotifyStore()`, `defaultChannels()`, `baseUrl: siteUrl()` and the stub `generateIdeas`. Reads env here only (E3).
- **Local email outbox** **[Claude's call]**: `defaultChannels()` returns a channel that logs an `email_outbox {to_user: false, subject_kind}` event and returns `{ok:true, id:"outbox-<uuid>"}` instead of Resend when `EMAIL_OUTBOX=log` and `VERCEL_ENV !== "production"`. Playwright sets it, so engine e2e runs need no Resend key. Add `EMAIL_OUTBOX` to the README env table.

- [ ] **Step 1: Write failing tests** in `tick.test.ts`:
  - No header, a wrong secret, or an unset secret → 401, and `run` isn't called (AC-1).
  - `?now=2027-03-20T12:00:00Z` with `vercelEnv: "preview"` passes that date to `run`.
  - With `vercelEnv: "production"` it passes the real time (AC-13).
  - A throw in `run` → 500.
  - A channels test: the outbox is used only with `EMAIL_OUTBOX=log` and outside production.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test tick channels`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, the handler, the outbox and the `updatePerson` hook.
- [ ] **Step 4: Run** the same command, then `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): daily round tick route with test clock (ALL-28)`.

### Task 6: End to end against local Supabase (AC-3, AC-5, AC-8, AC-9)

**Files:**
- Create: `apps/web/e2e/round-engine.spec.ts`
- Modify: `apps/web/playwright.config.ts` (webServer env: `EMAIL_OUTBOX: "log"`, `CRON_SECRET: "e2e-cron-secret"`)

- [ ] **Step 1: Write the spec** (desktop project only, `test.skip` on the phone projects):
  - Set `round_engine_enabled = 1` with the service key and restore it afterwards.
  - Seed a person with no address and a birthday 30 days after a fixed test date, through the service key.
  - Call `/api/rounds/tick?now=<start day>` with the secret → the round is `needs_address` and a `notifications` row of kind `needs_address` has `sent_at`.
  - Sign in as `TEST_USER`, add a full address on the person's page → the round is `awaiting_approval` with a `heads_up` notification.
  - Tick at the deadline → `skipped` and a `skipped` notification.
  - Tick again → no new notifications.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web e2e round-engine`. Expected: it fails first, if run before Task 5 is complete. Otherwise confirm it fails when the hook in `updatePerson` is commented out, then restore it.
- [ ] **Step 3: Run** the full e2e suite. Expected: PASS.
- [ ] **Step 4: Commit** `test(e2e): a round from start to skip with the test clock (ALL-28)`.

### Task 7: Cron, docs and decision (T49)

**Files:**
- Modify: `apps/web/vercel.json` (add `{ "path": "/api/rounds/tick", "schedule": "0 12 * * *" }`), `design/decisions.md` (T49), `design/technical-design.md` (§2 background jobs row, §4.1 table: the skipped email, §5.1: Vercel Cron, sequential steps, stuck rounds stay put, test clock, outbox), `README.md` (env table: `EMAIL_OUTBOX`; a runbook line: "Round engine on/off: `round_engine_enabled` in `concierge.app_settings`")

- [ ] **Step 1:** Write T49: "Vercel Cron triggers the round engine (reverses T8's `pg_cron` + `pg_net` + Vault). Why: one scheduler (T22 already uses Vercel Cron), crons run only on production, no new secret. Hobby fires within the hour. **Pending the owner's OK.**"
- [ ] **Step 2:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all pass.
- [ ] **Step 3: Commit** `feat: schedule the round tick with Vercel Cron (ALL-28)`.

### Review focus

The riskiest things to check in review, each with the test that covers it.

1. **Double emails when the tick and a user action overlap.** Covered by the pgTAP lease tests (Task 1) and `advanceRound … busy` (Task 4).
2. **A crash between "recorded" and "sent".** At-most-once is intended: `round-engine` "throws after recordSend" (Task 4).
3. **Missed ticks** (Vercel didn't fire, or the app was down for a day). Only the latest overdue reminder goes out, and an overdue skip still skips: the `round-plan` "missed tick" test (Task 2).
4. **The test clock leaking into production.** `tick.test` with `vercelEnv: "production"` (Task 5).
5. **Wrong budget on a new round** (person budget versus relationship default versus none): `round_candidates` pgTAP (Task 1).

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test: AC-1 T5 · AC-2 T4, T5 · AC-3 T1, T2, T4, T6 · AC-4 T1, T4 · AC-5 T2, T4, T6 · AC-6 T2, T3, T4 · AC-7 T2 · AC-8 T2, T4, T6 · AC-9 T4, T5, T6 · AC-10 T1, T4 · AC-11 T1, T4 · AC-12 T4 · AC-13 T5 · AC-14 T4 · AC-15 T3.
- [x] Every task traces back to a story or criterion. The local email outbox (T5) exists only so T6 can prove AC-5, AC-8 and AC-9 without a Resend key.
- [x] No open questions are left, except the owner's OK on T49, which blocks merging, not building.

## Done: evidence on the ticket (T44)

- [ ] Tests posted on ALL-28: the new pgTAP, core, web and e2e tests (each seen failing first), suite counts, lint, typecheck and the CI result.
- [ ] Screenshots of the four changed or new emails (skipped, address reminder, late heads-up, final notice) at phone width, from `email-samples`.
- [ ] Live check after deploy: `GET /api/rounds/tick` without the secret returns 401 on giftsaf.com. The next morning's Vercel log shows `round_tick {enabled:false}`. The engine stays off until ALL-27.
- [ ] The owner's OK on T49 recorded on the ticket.
