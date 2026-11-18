# ALL-125 Fan out round steps so a busy tick fits: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the daily tick hands every due round to its own function call, so a busy morning (the Christmas rush) advances every due round that day, while a round's step still never runs twice at once and placing never buys twice.

**Links:** [ALL-125](https://linear.app/allens-forever/issue/ALL-125) (blocks [ALL-29](https://linear.app/allens-forever/issue/ALL-29), which switches rounds on in production). Design §5.1 (the tick, "Long steps"). Decisions T49 (Vercel Cron), T54, T56 (placing), T68 (idea runs inside the tick), T75 (the deadline bounds only the idea pass). ALL-28 plan, ruling "Fan out one function call per round?". New decision: **T76** (this ticket).

## Spec: what it does

### Why now

The tick is one function call, capped at 300 s on our Vercel plan. Since ALL-32 it also sweeps orders and places held gifts (up to `zinc_place_budget_ms`, 45 s, shared by every round), and since ALL-27 it makes gift ideas, so ALL-27 capped idea runs at `idea_rounds_per_tick` (1). With real users that cap means rounds queue for days on a busy morning.

**Planning figures.** ALL-27's AC-28 timings on dev aren't measured yet (they need paid calls). This spec uses the ALL-27 spike's **~55 s per idea run**, the settings' **worst case of 150 s** (`ideaRunWorstMs` = 2 × `idea_ai_timeout_ms` 60 s + 2 × `idea_zinc_timeout_ms` 15 s), and the **45 s** Zinc placing budget. A round's step is either a money step or an idea run, never both in one call, so one round's call stays under 200 s of its 300 s.

### Vercel Queues on our plan [Verified 2026-11-18]

- **Available on Hobby**, in public Beta on all plans ([Queues docs](https://vercel.com/docs/queues)).
- **Cost: $0.** Hobby includes the first 1,000,000 queue operations a month ([pricing](https://vercel.com/docs/queues/pricing)). One round costs about 5 operations (send with an idempotency key counts 2, plus the push delivery and acknowledgement). A dozen rounds a month is ~60 operations; 10,000 rounds a day would still fit.
- **Compute** for each call counts against Hobby's function allowance like any other request (4 active CPU-hours, 360 GB-hours of memory, 1M invocations a month, [Hobby plan](https://vercel.com/docs/plans/hobby-plan)). An idea run mostly waits on the network: ~55 s at 2 GB is ~0.03 GB-hours, so the allowance covers roughly 10,000 idea runs a month.
- **Hobby never bills.** Going over a limit pauses that feature for up to 30 days instead. That's a real outage risk at scale, and the same one every other request already carries (T25).
- **How it works:** a route sends messages to a topic; a private route (no public URL, only Vercel can call it, configured by `experimentalTriggers` in `vercel.json`) gets one call per message, each with its own `maxDuration` (300 s). Delivery is at least once. Messages go back to the deployment that sent them. The SDK keeps extending a message's lease while the handler runs; a handler that throws or is killed is retried.
- **Local dev:** the SDK needs Vercel credentials (`vercel env pull`), so local runs and CI don't use the real queue (see "Testing" below).

### Who it's for and what they can do

1. **Every buyer on a busy morning:** as a buyer, my heads-up, reminder or gift purchase happens on the day it's due, even when hundreds of other rounds are due that morning.
2. **The owner, when something goes wrong:** as the owner, I can switch fan-out off with one `app_settings` row and the tick goes back to working through rounds itself, exactly as today (E7).
3. **The owner, watching spend:** as the owner, a busy morning can't start more round idea runs than a daily limit I set, because each run costs real money.

### How it fits together

1. **The tick** (Vercel Cron, daily) checks the secret, then in order: sweeps stale orders, retries refused "ordered" emails, clears unfiled notes, creates due rounds (engine on only), sends the rejection summary, then reads what's due **without claiming it** (new read-only `concierge.due_rounds(p_now)`, service role only) and sends the messages.
2. **Messages:** one per buyer for that buyer's due money rounds (`needs_attention`), and one per round for every other due round. A message carries ids only, plus the test time outside production.
3. **The job** (a private route, one call per message) first checks `round_fanout_enabled` and the engine switch, and acknowledges without doing anything if fan-out is off. It then claims each of its rounds by id (`claim_round`), runs the same step code the tick runs today (`advanceClaimed`), and, if the step is an idea run, runs it under the same claim, as the tick's idea pass does. A buyer's money rounds run one after another, earliest deadline first, sharing that buyer's `zinc_place_budget_ms`.
4. **The daily limit** is enforced in the database: `start_idea_run` counts today's round runs under one lock shared by every round run, so concurrent jobs can't race past it. On-demand runs aren't counted.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | `round_fanout_enabled` = 1, engine on, rounds due | the tick runs | it sends one message per buyer with due money rounds and one per other due round, runs no round step itself, and logs `round_fanout` with `due`, `sent`, `failed` counts |
| AC-2 | the tick reads what's due | `due_rounds` runs | it returns due, unleased rounds and changes nothing (no lease, `attempts` untouched); only the service role may call it |
| AC-3 | a message for a round | the job runs | it claims the round by id (`claim_round`, `SKIP LOCKED`), runs its step with today's step code and, when the step is an idea run, runs that under the same claim |
| AC-4 | the round is leased by someone else (another job, an approval, a webhook) or isn't due any more | the job runs | it does nothing to the round, logs `round_job {result: "busy"}` and acknowledges the message |
| AC-5 | two jobs for the same held round at the same moment (a redelivered message) | both run, against the real local database | exactly one runs the step, and Zinc's place call happens once with one idempotency key |
| AC-6 | one buyer with two held rounds and enough balance for one | their message runs, against the real local database | the earlier-deadline round is placed first; the other is held for funds |
| AC-7 | two buyers each with a held round placing slowly | their jobs run | each buyer has their own `zinc_place_budget_ms` from their own job's start |
| AC-8 | a round whose step is an idea run | the job runs | the run's deadline is the job's start + `tick_deadline_ms` (now one call's deadline, no longer the tick's); it doesn't start if its worst case doesn't fit. Money steps have no deadline (T75). The 10-minute lease outlasts the 300 s call, so a job can't outlive its lease |
| AC-9 | `idea_round_runs_per_day` = N and N − 1 round runs started today (UTC, from `p_now`) | 10 `start_idea_run` calls for different people at once, against the real local database | exactly one starts; the rest are refused as `daily_limit`, no run is counted, the rounds are released for tomorrow, and `ideas.daily_limit_reached` is logged with `alert: true` |
| AC-10 | engine off (`round_engine_enabled` = 0) | the tick runs | it sends only money-round messages; a job for any other round does nothing |
| AC-11 | fan-out on | the tick runs | the sweep, the "ordered" email retry, the notes clear-out, round creation and the rejection summary run in that order before anything is read or sent |
| AC-12 | sending fails | the tick sends | a retryable failure is retried once; what's still unsent is logged as `round_fanout_send_failed` with a count and `alert: true`; those rounds stay due for the next tick. A runbook entry in `design/operations.md` says what to do |
| AC-13 | outside production, the tick called with `?now=` | it fans out | each message carries that `now`, the job uses it, and the send's idempotency key uses that day; on production a `now` in a message is ignored |
| AC-14 | `round_fanout_enabled` = 0 (now, or after a rollback) | the tick runs, or a job arrives | the tick behaves exactly as today (the existing tick tests pass unchanged, `idea_rounds_per_tick` still read); a job acknowledges and does nothing |
| AC-15 | 20 due rounds: held rounds for several buyers placing slowly, rounds due a reminder, and rounds needing an idea run with a slow fake AI; `idea_round_runs_per_day` = 5 | one tick fans out with a fake send that runs every job at once, against the real local database | every held round places and every reminder goes out; exactly 5 idea runs start and the other idea rounds are released, uncounted |
| AC-16 | Zinc lookups during idea runs | up to `round_jobs_concurrency` runs at once | together they stay within `zinc_requests_per_second`: each run gets that rate divided by `round_jobs_concurrency`, and a unit test checks `vercel.json`'s `maxConcurrency` matches the setting's default |
| AC-17 | any new event | logged | ids and counts only (E6) |
| AC-18 | the change | merged | T76 recorded; design §5.1 and the round engine page updated; `design/operations.md` has the runbook and switch |

### Out of scope

- **Running a round's ideas straight after the buyer saves an address** (instead of waiting for the next tick, T68). Fan-out makes it possible; it's a follow-up ticket if we want it.
- **Removing the old one-call tick.** It stays as the off path (AC-13). A later cleanup deletes it once fan-out has run on production for a while (E7, expand then contract).
- **Measuring AC-28's real timings.** Still on ALL-27, waiting on Jim's go-ahead to spend.

### Testing (E5)

- **Real local Supabase** for everything that touches the lease, placing or money: local-db Vitest drives the job function directly, including two jobs racing on one round (AC-5), one buyer's wallet (AC-6), the daily-limit race (AC-9) and the busy morning (AC-15). Zinc and the AI are faked (we don't own them), as in ALL-27.
- **The queue is faked** in tests (we don't own it): the tick takes a `send` function, and tests record what it was given or hand each message straight to the job. Local dev and CI keep `round_fanout_enabled` = 0, so the existing Playwright round journey runs unchanged.
- **The real queue is checked on a preview** against dev after merge (switch on for dev, call the preview's tick with `?now=`, see `round_fanout` and one `round_job` per message in the logs, and check the job route has no public URL). No paid calls: `idea_engine_enabled` stays 0 and Zinc is the sandbox.

### Open questions

None left. See "What was decided".

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Vendor for fan-out | **Vercel Queues**, push mode: one topic, one private consumer route (T76) | Jim, 2026-11-18. Free on Hobby (1M operations a month included; ~5 per round), and it brings delivery guarantees and retries. A self-invoking route would need neither a vendor nor Beta software, but a dropped call would make a round wait a day. Beta risk is covered by the off switch. |
| Daily limit on round idea runs | **`idea_round_runs_per_day`, default 5**, added alongside `idea_rounds_per_tick` (which the off path still reads, so rollback works; a later cleanup removes it). Counted in `start_idea_run` under one lock shared by all round runs; on-demand runs not counted | Jim, 2026-11-18: "keep low". The number is **[Claude's call]** on that steer: about $2 a typical day, $5 at most at the $1 cap. It's a money brake, not a speed limit. Counting in the database is the only way 5 concurrent jobs can't race past it (spec review B1). Expand then contract (E7, review B3). |
| Housekeeping as its own scheduled jobs? | **No.** The sweep, the "ordered" email retry, the unfiled-notes clear-out and the rejection summary stay in the tick, before any message is sent. This revises the ticket's draft scope. | Jim, 2026-11-18, as recommended. They're short; the sweep must finish before rounds look at their orders, and separate Hobby crons fire anywhere in the hour, in no order; fewer schedules is simpler (E1, E2). |
| Off switch | `round_fanout_enabled`, shipped **0** everywhere; 1 on dev after merge for the preview check, then 1 on production before ALL-29 switches rounds on | **[Claude's call]**, E7. 0 keeps today's one-call tick. |
| How many jobs at once | **5** (`maxConcurrency` in `vercel.json`), mirrored by a new setting `round_jobs_concurrency` (5) that idea runs use to share `zinc_requests_per_second`; a unit test fails if the two differ | **[Claude's call]**. Vercel reads `maxConcurrency` at deploy time, so it can't live in settings (bends T23, recorded in T76); the mirror keeps Zinc's request rate true across concurrent runs (review S5). 5 at once still clears hundreds of reminders and placings a morning. |
| Message retries | Up to **3** deliveries at the default spacing. They cover a call that dies **before** it claims its rounds. A step that fails after claiming is acknowledged and retried by the next day's tick, as today. Send idempotency key `round:<id>:<date of the message's now>` (`buyer:<id>:<date>` for money messages) | **[Claude's call]** after review S3: the queue redelivers before the 10-minute lease ends, so a same-day retry after a claim isn't possible without more machinery. |
| Held gifts: per buyer or in the tick? | **One message per buyer** for that buyer's due money rounds, run one after another, earliest deadline first, with the buyer's own `zinc_place_budget_ms` (AC-6, AC-7) | Jim, 2026-11-18, as recommended after the spec review (S2). One wallet per buyer means a buyer's held gifts aren't independent; different buyers' are. |
| Idea runs under the daily limit: strictly nearest deadline first? | **No.** Runs go to whichever jobs arrive first; each refused round logs `ideas.daily_limit_reached` with `alert: true`, so the owner sees the limit is too low | Jim, 2026-11-18, as recommended (review S1). Strict order needs the tick to work out which rounds need ideas; it only matters while the limit is too low. |
| When do the limits go up? | **In a separate ticket, [ALL-135](https://linear.app/allens-forever/issue/ALL-135):** switch paid features on formally beyond test and admin users, with `idea_round_runs_per_day`, `round_jobs_concurrency` and the other money limits set from measured tests | Jim, 2026-11-18. |
| Finding due rounds | New read-only `concierge.due_rounds(p_now)`, service role only; the job claims with `claim_round` | Review B2: claiming in the tick would make every job see the tick's lease, and releasing it resets `attempts`, which silences `round_stuck`. |
| What the job runs | Claim, `advanceClaimed`, then the idea run under the same claim, as the tick's idea pass does; `tick_deadline_ms` becomes one call's deadline. `advanceRound` (for user actions) is unchanged | Review S6: `advanceRound` defers idea runs on purpose, so a job built on it would never make ideas. |
| Stopping a bad deployment | Each job checks `round_fanout_enabled` and the engine switch first. Runbook: set the row to 0, then delete the bad deployment (messages stay pinned to the deployment that sent them) | Review S4, E7. |
| Planning timings | ~55 s per idea run (spike), 150 s worst case (settings), 45 s placing | AC-28 isn't measured yet (it needs paid calls); these are the figures from the ALL-27 spike and settings. |

## Principles check

- **Simplest version?** One topic, one consumer, one new setting for the switch and one for the daily limit (which replaces `idea_rounds_per_tick`). The job reuses the tick's step code. Housekeeping stays put. The old path stays only as the off switch.
- **Hard-coded values?** New rows `round_fanout_enabled` (0), `idea_round_runs_per_day` (5) and `round_jobs_concurrency` (5). `maxConcurrency`, retries and the topic name live in `vercel.json` because Vercel reads them at deploy time.
- **Product boundaries?** All inside `modules/concierge` and its routes.
- **New personal data?** None. Messages carry a round id and, outside production, a test time.
- **E1:** a queue is new infrastructure. T76 ties it to "compute that's truly independent": each round's step reads and writes only its own round, its orders and its sends, and takes up to 200 s. Money rounds aren't independent within one buyer (one wallet), so they're grouped per buyer, and the daily idea limit is counted in the database, not in each job.
- **E7:** `round_fanout_enabled` switches it off; Vercel rollback also works, but messages already sent stay pinned to the old deployment until they're handled or expire (24 h), which is harmless because each job re-checks its round in the database.
- **E9:** seen working through `round_fanout` and `round_job` events on production; turned off with the setting.
- **Docs and decisions:** T76 in `design/decisions.md`; T68 and T75 noted as revised; design §5.1; the round engine page; `design/operations.md` (runbook, switch, workspace table if a doc is added).


## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture:** The tick keeps its housekeeping and round creation, then (with `round_fanout_enabled` = 1) reads due rounds without claiming them and sends one queue message per buyer with money rounds and one per other round. A private queue-triggered route runs `runRoundJob`, which claims each round with the existing lease and runs the existing step code, then the idea run under the same claim. The daily idea limit lives in `start_idea_run`. With the switch at 0 the tick runs exactly today's code.

**Tech stack:** Supabase migration + pgTAP; `apps/web/modules/concierge/rounds` (engine, store, new `fanout.ts`); `apps/web/modules/concierge/ideas` (store, run); routes under `apps/web/app/api/rounds/`; `@vercel/queue` **0.11.0** (exact pin, published 2026-11-02); `apps/web/vercel.json`.

**Branch:** `JimtheBurger/all-125-fan-out`. PR title `feat: fan out round steps to one function call per round (ALL-125)`, body `Part of ALL-125` (the preview check on dev comes after merge).

### Global constraints

- Settings (T23), new rows in one migration: `round_fanout_enabled` = 0, `idea_round_runs_per_day` = 5, `round_jobs_concurrency` = 5. `idea_rounds_per_tick` and `tick_deadline_ms` stay (the off path reads both).
- A missing money setting refuses, never allows (`start_idea_run` raises, as today).
- Queue topic `round-jobs`; trigger `maxDeliveries` 3, `maxConcurrency` 5; job route `maxDuration` 300.
- Idempotency keys: `round:<round id>:<YYYY-MM-DD of the message's now>`, `buyer:<user id>:<YYYY-MM-DD>`.
- Events carry ids, counts, statuses and reasons only (E6). New events: `round_fanout {enabled, due, sent, failed}`, `round_fanout_send_failed {count, alert: true}`, `round_job {kind, result, round_id | user_id, rounds}`, `ideas.daily_limit_reached {round_id, user_id, alert: true}`.
- No paid calls in any test: AI Gateway, Zinc and the queue are faked (memory: no money while testing).
- Migration timestamp after `main`'s newest when the PR merges (`db push` refuses out-of-order ones).

### Review focus

1. **A buyer message whose rounds changed since the tick read them** (approved, cancelled, skipped, or leased by an approval): each `claim_round` refuses, nothing is placed, `round_job {result: "busy"}`. Test in Task 4.
2. **A message for a round whose person was deleted** between the tick and the job: the step runs as the tick would today (the deadline closes it); no throw escapes, so the message isn't retried pointlessly. Test in Task 4.
3. **A malformed or unknown message** (wrong `kind`, bad uuid, `now` not a date): the route logs `round_job {result: "invalid"}` and acknowledges, never retries forever. Test in Task 5.
4. **The tick run twice in one day** (a manual re-run): the same idempotency keys, so no second message; and even if delivered, the claim refuses rounds already advanced. Test in Task 3.
5. **Fan-out switched off while messages are in flight**: jobs acknowledge and do nothing; the next day's tick runs inline. Test in Task 4.

---

### Task 1: Database: settings, `due_rounds`, the daily idea limit (AC-2, AC-9)

**Files:**
- Create: `supabase/migrations/<ts>_round_fanout.sql`
- Create: `supabase/tests/round_fanout.test.sql`
- Modify: `packages/core/src/database.types.ts` (via `pnpm db:types`)
- Modify: `apps/web/modules/concierge/ideas/store.ts:14` (`IdeaRefusal` adds `"daily_limit"`)
- Modify: `apps/web/modules/concierge/rounds/engine.ts` (`afterIdeaRun`: `daily_limit` releases like `busy`, and logs `ideas.daily_limit_reached` with `alert: true`)
- Create: `apps/web/modules/concierge/__tests__/idea-daily-limit.test.ts` (local-db; add to `LOCAL_DB_TESTS` in `apps/web/vitest.config.ts`)

**Interfaces:**
- Produces: `concierge.due_rounds(p_now timestamptz) returns table (id uuid, user_id uuid, status concierge.round_status, attention_reason text, ship_by_deadline date, next_action_at timestamptz)`: same `where` as `claim_due_rounds`, no `for update`, no writes, ordered like `claim_due_rounds`; `security definer`, execute for `service_role` only.
- Produces: `start_idea_run` refusal `'daily_limit'`, checked after `'limit'` and before the insert, only when `p_round_id is not null`, under `pg_advisory_xact_lock(hashtext('idea_round_runs_per_day'))` taken after the person lock; counts `idea_runs` with `round_id is not null and started_at >= date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC'`. Null setting raises `'Idea run settings are missing'`.

- [ ] **Step 1: Write the failing pgTAP tests** in `round_fanout.test.sql`:
  - the three settings rows exist with values 0, 5, 5;
  - `due_rounds` returns a due unleased round and skips a leased one, a future one and a finished one; after calling it, that round's `locked_until` is still null and `attempts` unchanged;
  - `due_rounds` is not executable by `anon` or `authenticated`;
  - with `idea_round_runs_per_day` = 2 and two round runs started today, a third round run is refused `daily_limit` and no `idea_runs` row is added; a run started yesterday doesn't count; an on-demand run (`p_round_id` null) is allowed and not counted;
  - with the setting deleted, a round run raises.
- [ ] **Step 2: Run** `supabase test db` → the new file fails (function and rows missing).
- [ ] **Step 3: Write the migration** (settings rows with descriptions in the style of `20261117100000_idea_engine.sql`; `due_rounds`; `create or replace` of `start_idea_run` with the check above, every other line unchanged). Run `supabase db reset` then `pnpm db:types`.
- [ ] **Step 4: Run** `supabase test db` → all pass, including the existing `idea_engine.test.sql`.
- [ ] **Step 5: Write the failing local-db test** `idea-daily-limit.test.ts` (`describe.skipIf(!dbUp)`, pattern of `placing-race.test.ts`): limit 5, four round runs already started today for other people; 10 `pg` clients call `start_idea_run` for 10 different paid people's rounds at once → exactly 1 `run_id`, 9 `daily_limit`; `idea_runs` count today = 5. Restore the setting in `afterAll`.
- [ ] **Step 6: Run** `CI=1 pnpm test:db -- idea-daily-limit` → passes. Check it fails first by running it against the migration with the advisory lock line commented out (expect more than 1 run started).
- [ ] **Step 7: Add the engine case:** in `round-engine.test.ts` (fake store part), a fake `generateIdeas` returning `{ status: "refused", reason: "daily_limit" }` → the round is released (still due, status unchanged), `ideas.daily_limit_reached` logged with `alert: true` and ids only. Run → fails; add `"daily_limit"` to `IdeaRefusal` and the `afterIdeaRun` case; run → passes.
- [ ] **Step 8: Commit** `feat(db): due_rounds and a daily limit on round idea runs (ALL-125)`.

### Task 2: Store reads and Zinc rate sharing (AC-2, AC-16)

**Files:**
- Modify: `apps/web/modules/concierge/rounds/store.ts` (`RoundStore.dueRounds`), `apps/web/modules/concierge/__tests__/fake-round-store.ts`
- Modify: `apps/web/modules/concierge/ideas/store.ts` (`IdeaSettings.roundJobsConcurrency` ← `round_jobs_concurrency`), `apps/web/modules/concierge/ideas/run.ts:202`
- Test: `apps/web/modules/concierge/__tests__/supabase-store.test.ts` (or `idea-store.test.ts`, whichever already covers the store against local Supabase), `idea-run.test.ts`, new `apps/web/app/api/rounds/__tests__/vercel-config.test.ts`

**Interfaces:**
- Produces: `RoundStore.dueRounds(now: Date): Promise<DueRound[]>`, with `type DueRound = { id: string; userId: string; status: RoundStatus; attentionReason: AttentionReason | null; shipByDeadline: CalendarDate }`, in `due_rounds` order.
- Produces: `IdeaSettings.roundJobsConcurrency: number`; `runIdeas` builds its limiter with `zincRequestsPerSecond / roundJobsConcurrency` (a fractional rate is fine). On-demand runs share the same rate: slightly slower lookups, one rule.

- [ ] **Step 1: Failing tests:**
  - store against local Supabase: `dueRounds` maps the row to `DueRound` and leaves the lease alone;
  - `idea-run.test.ts`: with `zincRequestsPerSecond` 10 and `roundJobsConcurrency` 5, 4 lookups take at least 1.5 s on the fake clock (2 a second);
  - `vercel-config.test.ts`: reads `apps/web/vercel.json` and the migration from Task 1; the `round-jobs` trigger's `maxConcurrency` equals the `round_jobs_concurrency` default in the migration (fails now: no trigger yet; it passes in Task 5).
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- idea-run vercel-config` and `CI=1 pnpm test:db` → the new tests fail.
- [ ] **Step 3: Implement** `dueRounds` (RPC `due_rounds`, same error style as `claimDue`), the fake's `dueRounds` (rounds due at `now`, unleased, not finished, held-first then deadline), and the settings read plus the divided limiter.
- [ ] **Step 4: Run** → the store and idea-run tests pass; `vercel-config` still fails until Task 5.
- [ ] **Step 5: Commit** `feat(rounds): read due rounds without claiming; idea runs share Zinc's rate (ALL-125)`.

### Task 3: The tick fans out (AC-1, AC-10, AC-11, AC-13, AC-14)

**Files:**
- Create: `apps/web/modules/concierge/rounds/fanout.ts`
- Modify: `apps/web/modules/concierge/rounds/engine.ts` (`runTick` calls `fanOut` after housekeeping when on), `apps/web/modules/concierge/index.ts` (exports)
- Test: create `apps/web/modules/concierge/__tests__/fanout.test.ts` (fake store)

**Interfaces:**
- Produces, in `fanout.ts`:
  - `type JobMessage = { kind: "round"; roundId: string; now?: string } | { kind: "buyer"; userId: string; roundIds: string[]; now?: string }`
  - `type QueuedJob = { message: JobMessage; idempotencyKey: string }`
  - `type SendJobs = (jobs: QueuedJob[]) => Promise<{ sent: number; failed: number }>`
  - `planJobs(due: DueRound[], engineOn: boolean, now: Date, testClock: boolean): QueuedJob[]`: pure. `needs_attention` rounds grouped per `userId` into one buyer message, `roundIds` in `due` order; other rounds one message each, dropped when `engineOn` is false. `now` is set on messages only when `testClock`. Keys per Global constraints, dated from `now`.
- Changes: `EngineDeps` gains `sendJobs?: SendJobs` and `testClock?: boolean`. `runTick`: after the sweep, ordered retry and notes clear-out, if `sendJobs` is set and `round_fanout_enabled` = 1: create due rounds (engine on only), `tellOwnersOfRejections`, then `planJobs(await store.dueRounds(now), on, now, testClock)` and `sendJobs`; log `round_fanout`, and `round_fanout_send_failed` when `failed > 0`; return `TickSummary` with `advanced` 0 and `failed` = create failures + send failures. Otherwise today's code, untouched.

- [ ] **Step 1: Failing tests** in `fanout.test.ts`:
  - `planJobs`: two held rounds for user A and one for B, plus two ordinary rounds → 2 buyer messages (A's ids in deadline order) + 2 round messages; keys `buyer:A:2027-02-11`, `round:<id>:2027-02-11`;
  - `planJobs` with `engineOn` false → buyer messages only;
  - `planJobs` with `testClock` false → no `now` on any message;
  - `runTick` with the switch on and a recording `sendJobs`: the sweep, ordered retry, notes clear-out, round creation and rejection summary all happen before `sendJobs` is called (record call order), no `claimDue`/`claimDueMoney` call, no email sent by the tick, `round_fanout` logged with `{enabled: true, due: 4, sent: 4, failed: 0}`;
  - send reports `failed: 2` → `round_fanout_send_failed {count: 2, alert: true}`, the rounds still due in the store;
  - the tick run twice the same day → the same keys both times;
  - switch at 0, or `sendJobs` not set → identical behaviour to today (the existing `round-engine.test.ts` suite runs unchanged and passes).
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- fanout` → fails (module missing).
- [ ] **Step 3: Implement** `fanout.ts` and the `runTick` branch.
- [ ] **Step 4: Run** `pnpm --filter @gifts-af/web test -- fanout` and `CI=1 pnpm test:db -- round-engine` → all pass.
- [ ] **Step 5: Commit** `feat(rounds): the tick sends due rounds to the queue when fan-out is on (ALL-125)`.

### Task 4: The job (AC-3 to AC-8, AC-14, AC-15)

**Files:**
- Modify: `apps/web/modules/concierge/rounds/fanout.ts` (`runRoundJob`)
- Modify: `apps/web/modules/concierge/rounds/engine.ts` (export `advanceClaimed`, `placeDeadline`, `ideaPass`; `ideaPass` gains `maxRuns?: number`, which, when given, replaces reading `idea_rounds_per_tick`)
- Test: `fanout.test.ts` (fake store), create `apps/web/modules/concierge/__tests__/fanout-db.test.ts` (local-db; add to `LOCAL_DB_TESTS`)

**Interfaces:**
- Consumes: `JobMessage` (Task 3), `RoundStore.claim` (`claim_round`), `advanceClaimed`, `ideaPass`.
- Produces: `runRoundJob(message: JobMessage, deps: EngineDeps): Promise<JobResult>`, `type JobResult = "off" | "busy" | "advanced" | "failed"`. It never throws.
  1. `round_fanout_enabled` ≠ 1 → `"off"`.
  2. `round` kind: engine off → `"off"`. `claim(roundId, now)` null → `"busy"`. Otherwise `advanceClaimed(round, deps, s, false, await placeDeadline(deps))`; if it returns `{ generate }`, `ideaPass([generate], deps, s, jobStart + tick_deadline_ms, 1)`.
  3. `buyer` kind (runs whatever the engine switch says): one `placeBy` for the message; for each id in order, `claim`; a refused claim is skipped; a claimed round that isn't `needs_attention` is released; others go through `advanceClaimed`. `"busy"` only if none was claimed.
  4. Logs `round_job` once with `kind`, `result`, the id, and `rounds` (how many advanced).

- [ ] **Step 1: Failing fake-store tests** in `fanout.test.ts`:
  - switch at 0 → `"off"`, no claim made (Review focus 5);
  - engine off, `round` message → `"off"`; engine off, `buyer` message → its held round is placed;
  - round leased by an approval → `"busy"`, nothing sent (AC-4);
  - buyer message whose round was approved and is now `ordered`, or skipped, since the tick → claim refused, `"busy"`, no place call (Review focus 1);
  - round due a reminder → the reminder goes out once, round finished with its next date;
  - round needing ideas → `generateIdeas` called once with a signal that ends at job start + `tick_deadline_ms`, heads-up sent; with `idea_rounds_per_tick` = 0 in settings the run still happens (the job ignores it);
  - a person deleted after the tick read the round → the step runs as the tick would and the result isn't a throw (Review focus 2);
  - two buyers each with a held round whose fake `placeRound` takes 40 s of the fake clock → both placed (own `placeBy` each, AC-7).
- [ ] **Step 2: Failing local-db tests** in `fanout-db.test.ts` (real `createSupabaseRoundStore`, `placeRound` with `FakeZinc`, `pg` clients as in `placing-race.test.ts`):
  - AC-5: two `runRoundJob` calls for the same held round started together → one `"advanced"`, one `"busy"`; `FakeZinc` saw one order POST, with one idempotency key;
  - AC-6: one buyer, two held rounds, wallet balance covering one, buyer message with both → the earlier-deadline round's order is placed, the other is held `funds`;
  - AC-15: 20 due rounds (held rounds for 4 buyers, 6 rounds due a reminder, 10 needing ideas) with `idea_round_runs_per_day` = 5; the tick runs with a `sendJobs` that runs every message's `runRoundJob` at once (`Promise.all`), with a fake `generateIdeas` that calls the real `start_idea_run` through the idea store and then waits 2 s → every held round placed, every reminder sent, exactly 5 `idea_runs` rows today, the other 5 idea rounds released and still due, and none of them used a run.
- [ ] **Step 3: Run** `pnpm --filter @gifts-af/web test -- fanout` and `CI=1 pnpm test:db -- fanout-db` → fail.
- [ ] **Step 4: Implement** `runRoundJob` and the `ideaPass` parameter.
- [ ] **Step 5: Run** both commands, plus `CI=1 pnpm test:db -- round-engine placing-race` → all pass.
- [ ] **Step 6: Commit** `feat(rounds): a job runs one round, or one buyer's held gifts, per call (ALL-125)`.

### Task 5: Routes, the queue, and `vercel.json` (AC-1, AC-12, AC-13, AC-16)

**Files:**
- Modify: `apps/web/package.json` (`"@vercel/queue": "0.11.0"`), `pnpm-lock.yaml`
- Create: `apps/web/app/api/rounds/queue.ts` (the only file that imports `@vercel/queue`)
- Create: `apps/web/app/api/rounds/job/route.ts`, `apps/web/app/api/rounds/job/job.ts`
- Modify: `apps/web/app/api/rounds/tick/route.ts`, `apps/web/app/api/rounds/tick/tick.ts`, `apps/web/app/settings/zinc-deps.ts` (`buyingWiring` passes `sendJobs` and `testClock` through)
- Modify: `apps/web/vercel.json`
- Test: `apps/web/app/api/rounds/__tests__/queue.test.ts`, `apps/web/app/api/rounds/job/__tests__/job.test.ts`, `apps/web/app/api/rounds/tick/__tests__/tick.test.ts`, `vercel-config.test.ts` (from Task 2)

**Interfaces:**
- Consumes: `JobMessage`, `QueuedJob`, `SendJobs`, `runRoundJob` (Tasks 3, 4).
- Produces: `sendJobsWith(sendBatch: typeof import("@vercel/queue").sendBatch): SendJobs` in `queue.ts`: batches of 100 to topic `round-jobs`, each with its idempotency key; retryable per-message failures are sent once more; returns counts.
- Produces: `handleJob(raw: unknown, env: { vercelEnv?: string }, run: (message: JobMessage, now: Date) => Promise<JobResult>): Promise<JobResult | "invalid">` in `job.ts`: validates with zod (E4): `kind` one of the two, uuids, `roundIds` 1 to 50 uuids, `now` an ISO date; invalid → logs `round_job {result: "invalid"}` and returns `"invalid"`. `now` is used only when `vercelEnv !== "production"`.
- `route.ts`: `export const maxDuration = 300;` `export const POST = handleCallback(async (message) => { await handleJob(message, { vercelEnv: process.env.VERCEL_ENV }, async (m, now) => runRoundJob(m, (await buyingWiring(now)).engine)); })`. The handler never throws, so the queue acknowledges every message; `maxDeliveries` covers a call that dies before it runs.
- `vercel.json` adds `"functions": { "app/api/rounds/job/route.ts": { "experimentalTriggers": [{ "type": "queue/v2beta", "topic": "round-jobs", "maxDeliveries": 3, "maxConcurrency": 5 }] } }`. **[Verify]** in the PR's preview deployment that Vercel registers the trigger with `apps/web` as the project root (the deployment's Functions list shows the route with a queue trigger).
- The tick route wires `sendJobs: sendJobsWith(sendBatch)` and `testClock: vercelEnv !== "production"`.

- [ ] **Step 1: Failing tests:**
  - `queue.test.ts` (fake `sendBatch`, never the real one): 150 jobs → two calls of 100 and 50, keys passed through; one retryable failure re-sent once and counted sent when it succeeds; one non-retryable failure counted `failed`; a thrown batch counts its whole batch as failed;
  - `job.test.ts`: a valid round message calls `run` with the message; `kind: "other"`, a bad uuid, 51 `roundIds`, and `now: "soon"` each return `"invalid"` and log it (Review focus 3); on `vercelEnv: "production"` a message `now` is ignored (AC-13), elsewhere it's used;
  - `tick.test.ts`: the route passes `testClock` false on production and true elsewhere;
  - `vercel-config.test.ts` now passes.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- queue job tick vercel-config` → fail.
- [ ] **Step 3: Implement**, install the pinned package (`pnpm --filter @gifts-af/web add @vercel/queue@0.11.0 --save-exact`).
- [ ] **Step 4: Run** the same tests → pass. Then `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the root → all pass.
- [ ] **Step 5: Commit** `feat(rounds): queue route and tick wiring for fan-out (ALL-125)`.

### Task 6: Docs, decision and the round engine page (AC-17, AC-18)

**Files:**
- Modify: `design/decisions.md` (T76), `design/technical-design.md` §5.1, `design/operations.md` (new section "Round fan-out (ALL-125)"), the round engine page (claude.ai artifact), this plan's checkboxes.

- [ ] **Step 1: T76** in `design/decisions.md`: Vercel Queues for one call per round (one per buyer for held gifts), tied to E1's "compute that's truly independent"; the money-round grouping; the daily limit in `start_idea_run`; `maxConcurrency` mirrored by `round_jobs_concurrency` (bends T23); `tick_deadline_ms` now one call's deadline; revises T68 (idea runs per tick → per day) and the ALL-28 ruling; keeps T75 (the deadline bounds only idea runs). Source: Jim, 2026-11-18.
- [ ] **Step 2: §5.1:** the tick's new order, the job, the off switch, "Long steps" rewritten for one call per round, `round_stuck` now also counting failed job claims. Remove "Handing each round to its own function call … is ALL-125".
- [ ] **Step 3: `design/operations.md`:** the switch (`round_fanout_enabled`), turning it on per environment, the preview check, the runbook for `round_fanout_send_failed` (check Vercel Queues status and the logs; set the switch to 0 so tomorrow's tick runs inline; rounds are a day late at worst), the runbook for `ideas.daily_limit_reached` (raise `idea_round_runs_per_day`, see ALL-135), and stopping a bad deployment (switch to 0, then delete the deployment). Add both alerts to "Alerts (events with `alert: true`)".
- [ ] **Step 4: Event check (AC-17):** a fake-store test in `fanout.test.ts` that every event logged by `runTick` with fan-out on and by `runRoundJob` has only keys from an allow-list (`event`, `enabled`, `due`, `sent`, `failed`, `count`, `alert`, `kind`, `result`, `round_id`, `user_id`, `rounds`, `status`, `next_status`, `step`). Run → passes.
- [ ] **Step 5: Round engine page:** read https://claude.ai/artifact/Edr5DRi5s53iRPfAsuSnd8, add the fan-out (tick → queue → one call per round / per buyer) and the daily limit, republish to the same URL.
- [ ] **Step 6: Commit** `docs: fan-out in the design, T76 and the runbook (ALL-125)` (on the branch, since it ships with the code).

### After merge (not tasks for the implementer)

- [ ] The `migrate` job applies the migration to dev and prod. Check both have the three rows, with `round_fanout_enabled` = 0.
- [ ] **Preview check on dev (no paid calls):** set `round_fanout_enabled` = 1 on dev, keep `idea_engine_enabled` = 0. Call a preview's tick with the cron secret, the bypass header and `?now=` on a day with seeded due rounds. Expect `round_fanout` with `sent` = due, one `round_job` per message, the reminders in the outbox, and a `POST` to `/api/rounds/job` from outside not running a job (no `round_job` event).
- [ ] Production: set `round_fanout_enabled` = 1 before ALL-29 switches rounds on; next morning's log shows `round_fanout`. Post evidence on ALL-125.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test: AC-1 T3/T5, AC-2 T1/T2, AC-3 T4, AC-4 T4, AC-5 T4, AC-6 T4, AC-7 T4, AC-8 T4, AC-9 T1, AC-10 T3/T4, AC-11 T3, AC-12 T3/T5, AC-13 T3/T5, AC-14 T3/T4, AC-15 T4, AC-16 T2/T5, AC-17 T6, AC-18 T6.
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.
- [ ] Adversarial review of the plan done; blockers fixed, owner decisions answered.

## Done: evidence on the ticket (T44)

- [ ] Tests added (each failing first), suite counts, lint, typecheck, CI result.
- [ ] Nothing a person sees changes, so no screenshots; the round engine page link instead.
- [ ] The preview check on dev and the production `round_fanout` log, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket ticked, with a pointer to its evidence.
