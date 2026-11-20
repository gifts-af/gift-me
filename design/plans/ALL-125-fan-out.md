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
| AC-14 | `round_fanout_enabled` = 0 (now, after a rollback, or the row missing) | the tick runs, or a job arrives | the tick behaves as today, `idea_rounds_per_tick` still read; the one intended change is that the daily limit (AC-9) applies here too. A job acknowledges and does nothing |
| AC-15 | 20 due rounds: held rounds for several buyers placing slowly, rounds due a reminder, and rounds needing an idea run with a slow fake AI; `idea_round_runs_per_day` = 5 | one tick fans out with a fake send that runs every job at once, against the real local database | every held round places and every reminder goes out; exactly 5 idea runs start and the other idea rounds are released, uncounted |
| AC-16 | Zinc lookups during idea runs in jobs | up to `maxConcurrency` jobs at once | together they stay within `zinc_requests_per_second`: each job's run gets that rate divided by the `maxConcurrency` the job route reads from `vercel.json`, with calls spaced evenly (a rate below 1 a second still holds) |
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
| How many jobs at once | **5** (`maxConcurrency` in `vercel.json`). The job route imports `vercel.json` and passes that number in, so idea runs share `zinc_requests_per_second` by it. No setting mirrors it | **[Claude's call]**. Vercel reads `maxConcurrency` at deploy time, so it can't live in settings (bends T23, recorded in T76). Reading the one file the deploy uses means the two can't drift (plan review owner item 3). 5 at once still clears hundreds of reminders and placings a morning. |
| Message retries | Up to **3** deliveries at the default spacing. They cover a call that dies **before** it claims its rounds. A step that fails after claiming is acknowledged and retried by the next day's tick, as today. Send idempotency key `round:<id>:<date of the message's now>` (`buyer:<id>:<date>` for money messages) | **[Claude's call]** after review S3: the queue redelivers before the 10-minute lease ends, so a same-day retry after a claim isn't possible without more machinery. |
| Held gifts: per buyer or in the tick? | **One message per buyer** for that buyer's due money rounds, run one after another, earliest deadline first, with the buyer's own `zinc_place_budget_ms` (AC-6, AC-7) | Jim, 2026-11-18, as recommended after the spec review (S2). One wallet per buyer means a buyer's held gifts aren't independent; different buyers' are. |
| Idea runs under the daily limit: strictly nearest deadline first? | **No.** Runs go to whichever jobs arrive first; each refused round logs `ideas.daily_limit_reached` with `alert: true`, so the owner sees the limit is too low. **[Claude's call]**: one alert per refused round, not one a day with a count, because while the limit covers only our own rounds refusals are rare, and a daily summary needs state we don't have; ALL-135 revisits it | Jim, 2026-11-18, as recommended (review S1). Strict order needs the tick to work out which rounds need ideas; it only matters while the limit is too low. |
| When do the limits go up? | **In a separate ticket, [ALL-135](https://linear.app/allens-forever/issue/ALL-135):** switch paid features on formally beyond test and admin users, with `idea_round_runs_per_day`, the job `maxConcurrency` and the other money limits set from measured tests | Jim, 2026-11-18. |
| The daily limit everywhere | It lives in `start_idea_run`, so it also applies with fan-out off, on dev and after a rollback | **[Claude's call]** (plan review owner item 1): it's a money brake, and Jim asked to keep spend low. The Playwright round journey raises and restores it like `idea_rounds_per_tick`. |
| Finding due rounds | New read-only `concierge.due_rounds(p_now)`, service role only; the job claims with `claim_round` | Review B2: claiming in the tick would make every job see the tick's lease, and releasing it resets `attempts`, which silences `round_stuck`. |
| What the job runs | Claim, `advanceClaimed`, then the idea run under the same claim, as the tick's idea pass does; `tick_deadline_ms` becomes one call's deadline. `advanceRound` (for user actions) is unchanged | Review S6: `advanceRound` defers idea runs on purpose, so a job built on it would never make ideas. |
| Stopping a bad deployment | Each job checks `round_fanout_enabled` and the engine switch first. Runbook: set the row to 0, then delete the bad deployment (messages stay pinned to the deployment that sent them) | Review S4, E7. |
| Planning timings | ~55 s per idea run (spike), 150 s worst case (settings), 45 s placing | AC-28 isn't measured yet (it needs paid calls); these are the figures from the ALL-27 spike and settings. |

## Principles check

- **Simplest version?** One topic, one consumer, one new setting for the switch and one for the daily limit (which replaces `idea_rounds_per_tick`). The job reuses the tick's step code. Housekeeping stays put. The old path stays only as the off switch.
- **Hard-coded values?** New rows `round_fanout_enabled` (0) and `idea_round_runs_per_day` (5). `maxConcurrency`, retries and the topic name live in `vercel.json` because Vercel reads them at deploy time.
- **Product boundaries?** All inside `modules/concierge` and its routes.
- **New personal data?** None. Messages carry a round id and, outside production, a test time.
- **E1:** a queue is new infrastructure. T76 ties it to "compute that's truly independent": each round's step reads and writes only its own round, its orders and its sends, and takes up to 200 s. Money rounds aren't independent within one buyer (one wallet), so they're grouped per buyer, and the daily idea limit is counted in the database, not in each job.
- **E7:** `round_fanout_enabled` switches it off; Vercel rollback also works, but messages already sent stay pinned to the old deployment until they're handled or expire (24 h), which is harmless because each job re-checks its round in the database.
- **E9:** seen working through `round_fanout` and `round_job` events on production; turned off with the setting.
- **Docs and decisions:** T76 in `design/decisions.md`; T68 and T75 noted as revised; design §5.1; the round engine page; `design/operations.md` (runbook, switch, workspace table if a doc is added).


## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture:** The tick keeps its housekeeping and round creation, then (with `round_fanout_enabled` = 1) reads due rounds without claiming them and sends one queue message per buyer with money rounds and one per other round. A private queue-triggered route runs `runRoundJob`, which claims each round with the existing lease and runs the existing step code, then the idea run under the same claim. The daily idea limit lives in `start_idea_run`. With the switch at 0 (or unreadable) the tick runs today's code.

**Tech stack:** Supabase migration + pgTAP; `apps/web/modules/concierge/rounds` (engine, store, new `fanout.ts`); `apps/web/modules/concierge/ideas` (store, run); routes under `apps/web/app/api/rounds/`; `apps/web/lib/supabase/proxy.ts`; `@vercel/queue` **0.11.0** (exact pin, published 2026-11-02); `apps/web/vercel.json`.

**Branch:** `JimtheBurger/all-125-fan-out`. PR title `feat: fan out round steps to one function call per round (ALL-125)`, body `Part of ALL-125` (the dev check and the production switch come after merge).

**Revised after the plan's adversarial review (2026-11-18):** bounded day count and a namespaced lock (B1, nit); the Playwright journey raises the new limit (B2); no cap on a buyer message's rounds (B3); route-level failure events (S1); the job route on the proxy's public list, checked on the PR preview before merge (S2); a missing switch means off, and on-demand runs never read the daily setting (S3); `maxConcurrency` read from `vercel.json`, no mirror setting (S4, owner item 3); evenly spaced Zinc calls (S5); `deferred` counts as sent, the eval script, a rule for mixed buyer results (S6); round and buyer jobs hand rounds to the right path (S7); no circular import.

### Global constraints

- New settings rows (T23), one migration: `round_fanout_enabled` = 0, `idea_round_runs_per_day` = 5. `idea_rounds_per_tick` and `tick_deadline_ms` stay (the off path reads both).
- An unreadable `round_fanout_enabled` means off, logged once per tick as `round_fanout_setting_unreadable`. A missing `idea_round_runs_per_day` makes a **round** run raise (refuse, never allow); on-demand runs never read it.
- Queue topic `round-jobs`; trigger `maxDeliveries` 3, `maxConcurrency` 5; job route `maxDuration` 300. These live only in `vercel.json` (Vercel reads them at deploy time); code reads `maxConcurrency` from that file.
- Idempotency keys: `round:<round id>:<YYYY-MM-DD of the message's now>`, `buyer:<user id>:<YYYY-MM-DD>`.
- `sendBatch` takes at most 100 messages a call (Vercel's limit, quoted in a comment, not a setting).
- Events carry ids, counts, statuses and reasons only (E6). New events: `round_fanout {enabled, due, sent, failed}`, `round_fanout_send_failed {count, alert: true}`, `round_fanout_send_threw {count, name, kind?, code?, status?}`, `round_fanout_setting_unreadable {}`, `round_job {kind, result, round_id | user_id, rounds, delivery_count?, reason?, alert?}`, `ideas.daily_limit_reached {round_id, user_id, alert: true}`.
- No paid calls in any test: AI Gateway, Zinc and the queue are faked (memory: no money while testing).
- Migration timestamp after `main`'s newest when the PR merges.
- Module code never imports `@vercel/queue` or reads `process.env` (E3); `fanout.ts` imports nothing from `engine.ts` (no import cycle).

### Review focus

1. **A buyer message whose rounds changed since the tick read them** (approved, cancelled, skipped, or leased by an approval): each `claim_round` refuses, nothing is placed, `round_job {result: "busy"}`. Test in Task 4.
2. **A message for a round whose person was deleted** between the tick and the job: the step runs as the tick would today (the deadline closes it); nothing throws. Test in Task 4.
3. **A malformed message** (wrong `kind`, bad uuid, empty `roundIds`, `now` not a date): logged `round_job {result: "invalid"}` and acknowledged. Test in Task 5.
4. **The tick run twice in one day**: the same idempotency keys; and a delivered duplicate finds its rounds already advanced. Test in Task 3.
5. **Fan-out switched off while messages are in flight**: jobs acknowledge and do nothing; the next day's tick runs inline. Test in Task 4.

---

### Task 1: Database: settings, `due_rounds`, the daily idea limit (AC-2, AC-9, AC-14)

**Files:**
- Create: `supabase/migrations/<ts>_round_fanout.sql`, `supabase/tests/round_fanout.test.sql`
- Modify: `packages/core/src/database.types.ts` (via `pnpm db:types`)
- Modify: `apps/web/modules/concierge/ideas/store.ts:14` (`IdeaRefusal` adds `"daily_limit"`)
- Modify: `apps/web/modules/concierge/rounds/engine.ts` (`afterIdeaRun`)
- Modify: `apps/web/e2e/round-engine.spec.ts:141-160` (save, raise to 100 and restore `idea_round_runs_per_day`, beside `idea_rounds_per_tick`)
- Create: `apps/web/modules/concierge/__tests__/idea-daily-limit.test.ts` (local-db; add to `LOCAL_DB_TESTS` in `apps/web/vitest.config.ts`)

**Interfaces:**
- Produces: `concierge.due_rounds(p_now timestamptz) returns table (id uuid, user_id uuid, status concierge.round_status, attention_reason text, ship_by_deadline date)`: the same `where` and `order by` as `claim_due_rounds`, no `for update`, no writes; `security definer`, `set search_path = ''`, execute for `service_role` only.
- Produces: `start_idea_run` refusal `'daily_limit'`, only when `p_round_id is not null`, checked after `'limit'` and before the insert. Under `pg_advisory_xact_lock(hashtext('concierge.idea_round_runs_per_day'), 0)` (the two-argument form, a separate keyspace from the per-person one-argument locks), taken after the person lock; no other function takes this lock, so there's no lock-order cycle. Counts `idea_runs` with `round_id is not null and started_at >= d and started_at < d + interval '1 day'`, where `d = (date_trunc('day', p_now at time zone 'UTC')) at time zone 'UTC'`. The setting is read inside that branch; null raises `'Idea run settings are missing'`.
- Produces: `afterIdeaRun` treats `refused: daily_limit` like `busy` (release, round stays due) and logs `ideas.daily_limit_reached {round_id, user_id, alert: true}`. Note: `release_round` resets `attempts`, which is correct here: no claim failed.

- [ ] **Step 1: Write the failing pgTAP tests** in `round_fanout.test.sql` (all on 2031-06-15, a date no other test uses):
  - the two settings rows exist with values 0 and 5;
  - `due_rounds` returns a due unleased round and skips a leased one, a future one and a finished one; afterwards that round's `locked_until` is still null and `attempts` unchanged;
  - `due_rounds` isn't executable by `anon` or `authenticated`;
  - limit 2, two round runs that day → a third is refused `daily_limit` with no row added; a run the day before and a run the day after don't count; an on-demand run is allowed and not counted;
  - setting deleted → a round run raises; an on-demand run still starts.
- [ ] **Step 2: Run** `supabase test db` → the new file fails.
- [ ] **Step 3: Write the migration** (rows with descriptions in the style of `20261117100000_idea_engine.sql`; `due_rounds`; `create or replace` of `start_idea_run` with only the change above). `supabase db reset`, then `pnpm db:types`.
- [ ] **Step 4: Run** `supabase test db` → all pass, including `idea_engine.test.sql`.
- [ ] **Step 5: Write the race test** `idea-daily-limit.test.ts` (`describe.skipIf(!dbUp)`, the pattern of `placing-race.test.ts`, `p_now` 2031-06-16T12:00Z, its own users deleted and the setting restored in `afterAll`): limit 5, four round runs already that day; 10 `pg` clients call `start_idea_run` for 10 different paid people's rounds at once → exactly 1 `run_id`, 9 `daily_limit`; 5 round runs that day.
- [ ] **Step 6: Prove it fails first:** comment out the advisory-lock line in the migration, `supabase db reset`, `CI=1 pnpm test:db -- idea-daily-limit` → more than 1 starts (FAIL). Restore the line, reset → PASS.
- [ ] **Step 7: Engine case** in `round-engine.test.ts` (fake-store part): `generateIdeas` returns `{ status: "refused", reason: "daily_limit" }` → the round is released, still due, status unchanged; `ideas.daily_limit_reached` logged with `alert: true` and ids only. Run → fails; implement; run → passes.
- [ ] **Step 8: Playwright journey:** update `round-engine.spec.ts` as listed; run `pnpm e2e -- round-engine` twice in a row → passes both times (the second run is the case B2 found).
- [ ] **Step 9: Commit** `feat(db): due_rounds and a daily limit on round idea runs (ALL-125)`.

### Task 2: Due rounds in the store; idea runs share Zinc's rate (AC-2, AC-16)

**Files:**
- Modify: `apps/web/modules/concierge/rounds/store.ts` (`RoundStore.dueRounds`), `apps/web/modules/concierge/__tests__/fake-round-store.ts`
- Modify: `apps/web/modules/concierge/ideas/run.ts` (`limiter`, and `runIdeas` takes a share), `apps/web/app/settings/zinc-deps.ts` (`ideaWiring` passes the share)
- Test: `apps/web/modules/concierge/__tests__/idea-store.test.ts` (local-db, store against Supabase), `idea-run.test.ts`

**Interfaces:**
- Produces: `RoundStore.dueRounds(now: Date): Promise<DueRound[]>`, `type DueRound = { id: string; userId: string; status: RoundStatus; attentionReason: AttentionReason | null; shipByDeadline: CalendarDate }`, in `due_rounds` order. Exported from `rounds/store.ts`.
- Produces: `IdeaDeps.zincShare?: number` (default 1). The run's Zinc rate is `zincRequestsPerSecond / zincShare`. `limiter(perSecond, clock, sleep)` now spaces calls at least `1000 / perSecond` ms apart, so fractional rates hold. `ideaWiring(db, env, now, zincShare = 1)`.
- `IdeaSettings` is unchanged, so `apps/web/scripts/ai-eval-ideas.ts` needs no change (check it still typechecks).

- [ ] **Step 1: Failing tests:**
  - `idea-store.test.ts`: `dueRounds` maps a due round to `DueRound` and leaves its lease and `attempts` alone;
  - `idea-run.test.ts`: rate 10, share 5 → 5 lookups start at fake-clock 0, 500, 1000, 1500, 2000 ms; rate 3, share 5 (0.6 a second) → 3 lookups at 0, ≥1667, ≥3333 ms; share left out → today's spacing at rate 10.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- idea-run` and `CI=1 pnpm test:db -- idea-store` → the new tests fail.
- [ ] **Step 3: Implement** `dueRounds` (RPC `due_rounds`, errors like `claimDue`), the fake's `dueRounds` (due at `now`, unleased, not finished, held first then by deadline), the spaced limiter and the share.
- [ ] **Step 4: Run** the same commands plus `pnpm typecheck` → pass.
- [ ] **Step 5: Commit** `feat(rounds): read due rounds without claiming; idea runs can share Zinc's rate (ALL-125)`.

### Task 3: The tick fans out (AC-1, AC-10, AC-11, AC-12, AC-13, AC-14)

**Files:**
- Create: `apps/web/modules/concierge/rounds/fanout.ts` (types and `planJobs` only; imports from `@gifts-af/core` and `./store` types, never from `./engine`)
- Modify: `apps/web/modules/concierge/rounds/engine.ts` (`runTick`), `apps/web/modules/concierge/index.ts` (exports)
- Test: create `apps/web/modules/concierge/__tests__/fanout.test.ts` (fake store)

**Interfaces:**
- Produces, in `fanout.ts`:
  - `type JobMessage = { kind: "round"; roundId: string; now?: string } | { kind: "buyer"; userId: string; roundIds: string[]; now?: string }`
  - `type QueuedJob = { message: JobMessage; idempotencyKey: string }`
  - `type SendJobs = (jobs: QueuedJob[]) => Promise<{ sent: number; failed: number }>`
  - `planJobs(due: DueRound[], engineOn: boolean, now: Date, testClock: boolean): QueuedJob[]`: pure. `needs_attention` rounds grouped per `userId` into one buyer message with every one of that buyer's ids, in `due` order (no cap); other rounds one message each, dropped when `engineOn` is false; `now` on messages only when `testClock`; keys per Global constraints, dated from `now`.
- Changes: `EngineDeps` gains `sendJobs?: SendJobs` and `testClock?: boolean`. In `runTick`, after the sweep, ordered retry and notes clear-out: read `round_fanout_enabled` (unreadable → off, logged). If on and `sendJobs` is set: create due rounds (engine on only), `tellOwnersOfRejections`, then `sendJobs(planJobs(await store.dueRounds(now), on, now, testClock))`; log `round_fanout`, and `round_fanout_send_failed` when `failed > 0`; return `{ enabled: on, created, advanced: 0, failed: createFailed + sendFailed }`. Otherwise today's code, unchanged.

- [ ] **Step 1: Failing tests** in `fanout.test.ts`:
  - `planJobs`: two held rounds for user A and one for B, plus two ordinary rounds → 2 buyer messages (A's ids in deadline order) + 2 round messages; keys `buyer:A:2027-02-11` and `round:<id>:2027-02-11`; 60 held rounds for one buyer → one message with all 60;
  - `planJobs` with `engineOn` false → buyer messages only; with `testClock` false → no `now` on any message;
  - `runTick`, switch on, recording `sendJobs`: sweep, ordered retry, notes clear-out, round creation and rejection summary are all called before `sendJobs` (call-order log); no `claimDue`/`claimDueMoney`; no email sent by the tick; `round_fanout {enabled: true, due: 4, sent: 4, failed: 0}`;
  - `sendJobs` returns `failed: 2` → `round_fanout_send_failed {count: 2, alert: true}`, rounds still due;
  - two ticks the same day → identical keys (Review focus 4);
  - `round_fanout_enabled` missing from the fake's settings → the tick runs today's path and logs `round_fanout_setting_unreadable`;
  - switch at 0, or no `sendJobs` → today's path; the existing `round-engine.test.ts` passes unchanged.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- fanout` → fails (module missing).
- [ ] **Step 3: Implement** `fanout.ts` and the `runTick` branch.
- [ ] **Step 4: Run** `pnpm --filter @gifts-af/web test -- fanout` and `CI=1 pnpm test:db -- round-engine` → pass.
- [ ] **Step 5: Commit** `feat(rounds): the tick sends due rounds to the queue when fan-out is on (ALL-125)`.

### Task 4: The job (AC-3 to AC-8, AC-14, AC-15)

**Files:**
- Modify: `apps/web/modules/concierge/rounds/engine.ts` (new `runRoundJob`; `ideaPass` gains `maxRuns?: number`, which, when given, replaces reading `idea_rounds_per_tick`)
- Test: `fanout.test.ts` (fake store); create `apps/web/modules/concierge/__tests__/fanout-db.test.ts` (local-db; add to `LOCAL_DB_TESTS`)

**Interfaces:**
- Consumes: `JobMessage` (Task 3), `RoundStore.claim` (`claim_round`), `advanceClaimed`, `placeDeadline`, `ideaPass`, `releaseQuietly` (all in `engine.ts`).
- Produces: `runRoundJob(message: JobMessage, deps: EngineDeps): Promise<JobResult>`, `type JobResult = "off" | "busy" | "advanced" | "failed"`, exported from `engine.ts` and `index.ts`. It never throws. Its idea run gets `zincShare` through `deps.generateIdeas`, bound by the route (Task 5).
  1. `round_fanout_enabled` ≠ 1 or unreadable → `"off"`.
  2. `round` kind: engine off → `"off"`. `claim(roundId, now)` null → `"busy"`. A claimed round in `needs_attention` (it became a money round after the tick read it) is released → `"busy"`; the next tick's buyer message takes it. Otherwise `advanceClaimed(round, deps, s, false, 0)`; if that returns `{ generate }`, `ideaPass([generate], deps, s, jobStartMs + tick_deadline_ms, 1)`.
  3. `buyer` kind (whatever the engine switch says): one `placeBy = await placeDeadline(deps)` for the message; for each id in order, `claim`; a refused claim is skipped. A claimed `needs_attention` round goes through `advanceClaimed` with that `placeBy`. A claimed round that isn't `needs_attention` (it left the money path) runs its step through `advanceClaimed` too when the engine is on, and is released when off; if that step is an idea run, it's released (the next tick's round message runs it).
  4. Result for a buyer message: `"failed"` if any round failed, else `"advanced"` if any advanced, else `"busy"`.
  5. Logs `round_job` once with `kind`, `result`, the id and `rounds` (how many advanced).

- [ ] **Step 1: Failing fake-store tests** in `fanout.test.ts`:
  - switch at 0 → `"off"`, no claim (Review focus 5);
  - engine off: a `round` message → `"off"`; a `buyer` message → its held round is placed;
  - round leased by an approval → `"busy"`, nothing sent (AC-4);
  - a buyer message whose round was approved (now `ordered`) or skipped since the tick → claim refused, `"busy"`, no place call (Review focus 1);
  - a `round` message for a round now in `needs_attention` → released, `"busy"`, no place call;
  - a buyer message for a round now in `awaiting_approval` with a reminder due → the reminder goes out;
  - round due a reminder → sent once, round finished with its next date;
  - round needing ideas → `generateIdeas` called once with a signal ending at job start + `tick_deadline_ms`, heads-up sent; with `idea_rounds_per_tick` = 0 the run still happens;
  - a person deleted after the tick read the round → the step runs as the tick would, no throw (Review focus 2);
  - two buyers, each with a held round whose fake `placeRound` uses 40 s of the fake clock → both placed (AC-7);
  - a buyer message with one round failing and one advancing → `"failed"`, `rounds: 1`.
- [ ] **Step 2: Failing local-db tests** in `fanout-db.test.ts` (real `createSupabaseRoundStore`, `placeRound` with `FakeZinc`, two `pg`/Supabase clients as in `placing-race.test.ts`; its own users; `round_fanout_enabled` and `idea_round_runs_per_day` saved and restored; idea runs dated 2031-07-01):
  - AC-5: two `runRoundJob` calls for the same held round, through two separate clients, started together → one `"advanced"`, one `"busy"`; `FakeZinc` saw one order POST with one idempotency key;
  - AC-6: one buyer, two held rounds, wallet covering one → the earlier-deadline round's order placed, the other held `funds`;
  - AC-15: 20 due rounds (held rounds for 4 buyers, 6 due a reminder, 10 needing ideas), `idea_round_runs_per_day` = 5; the tick runs with a `sendJobs` that starts every message's `runRoundJob` at once (`Promise.all`; the races are in the database, which sees separate concurrent RPCs), with a fake `generateIdeas` that calls the real `start_idea_run` through the idea store and then waits 2 s → every held round placed, every reminder sent, exactly 5 round `idea_runs` that day, the other 5 idea rounds released, still due, with no run used.
- [ ] **Step 3: Prove the race test fails first:** temporarily make `runRoundJob` skip the claim (use the round as read) → AC-5 sees two POSTs (FAIL). Revert.
- [ ] **Step 4: Implement** `runRoundJob` and the `ideaPass` parameter.
- [ ] **Step 5: Run** `pnpm --filter @gifts-af/web test -- fanout` and `CI=1 pnpm test:db -- fanout-db round-engine placing-race` → pass.
- [ ] **Step 6: Commit** `feat(rounds): a job runs one round, or one buyer's held gifts, per call (ALL-125)`.

### Task 5: Routes, the queue, the proxy and `vercel.json` (AC-1, AC-12, AC-13, AC-16)

**Files:**
- Modify: `apps/web/package.json` (`"@vercel/queue": "0.11.0"`), `pnpm-lock.yaml`
- Create: `apps/web/app/api/rounds/queue.ts` (the only file importing `@vercel/queue`)
- Create: `apps/web/app/api/rounds/job/route.ts`, `apps/web/app/api/rounds/job/job.ts`
- Modify: `apps/web/app/api/rounds/tick/route.ts`, `apps/web/app/settings/zinc-deps.ts` (`buyingWiring(now, opts?: { sendJobs?: SendJobs; testClock?: boolean; zincShare?: number })`)
- Modify: `apps/web/lib/supabase/proxy.ts` (`isPublicPath` adds `/api/rounds/job`, with a comment: only Vercel's queue can call it)
- Modify: `apps/web/vercel.json`
- Test: `apps/web/app/api/rounds/__tests__/queue.test.ts`, `apps/web/app/api/rounds/job/__tests__/job.test.ts`, `apps/web/app/api/rounds/tick/__tests__/tick.test.ts`, the existing proxy test for `isPublicPath`

**Interfaces:**
- Consumes: `JobMessage`, `QueuedJob`, `SendJobs`, `runRoundJob`, `JobResult` (Tasks 3, 4).
- Produces: `sendJobsWith(sendBatch: typeof import("@vercel/queue").sendBatch): SendJobs`: batches of up to 100 to topic `round-jobs`, each with its key; `"sent"` and `"deferred"` count as sent; a retryable `"failed"` is sent once more; a non-retryable one, or a thrown batch, counts as failed.
- Produces: `handleJob(raw: unknown, meta: { deliveryCount: number }, env: { vercelEnv?: string }, run: (message: JobMessage, now: Date) => Promise<JobResult>): Promise<JobResult | "invalid">`: zod schema (E4): `kind` one of the two, uuids, `roundIds` a non-empty array of uuids, `now` an ISO date-time. Invalid → logs `round_job {result: "invalid"}`, returns `"invalid"` (acknowledged). `now` used only when `vercelEnv !== "production"`. If `run` throws (the wiring failed before `runRoundJob`), logs `round_job {result: "failed", delivery_count, alert: true}` and rethrows, so the queue retries up to `maxDeliveries`.
- `job/route.ts`: `export const maxDuration = 300;` and `export const POST = handleCallback(async (message, metadata) => { await handleJob(message, metadata, { vercelEnv: process.env.VERCEL_ENV }, async (m, now) => runRoundJob(m, (await buyingWiring(now, { zincShare: maxConcurrency })).engine)); })`, where `maxConcurrency` is read from `vercel.json` (imported as JSON) for the `round-jobs` trigger.
- `vercel.json` adds `"functions": { "app/api/rounds/job/route.ts": { "experimentalTriggers": [{ "type": "queue/v2beta", "topic": "round-jobs", "maxDeliveries": 3, "maxConcurrency": 5 }] } }`.
- The tick route wires `sendJobs: sendJobsWith(sendBatch)` and `testClock: process.env.VERCEL_ENV !== "production"`.

- [ ] **Step 1: Failing tests:**
  - `queue.test.ts` (a fake `sendBatch`, never the real one): 150 jobs → calls of 100 and 50 with keys passed through; one `"deferred"` counted sent; one retryable failure re-sent once and counted sent; one non-retryable failure counted failed; a thrown batch counts all of its messages failed;
  - `job.test.ts`: a valid message calls `run`; `kind: "other"`, a bad uuid, `roundIds: []` and `now: "soon"` each return `"invalid"` and log it (Review focus 3); on production a message `now` is ignored, elsewhere used (AC-13); `run` throwing → `round_job {result: "failed", delivery_count: 2, alert: true}` logged and the error rethrown;
  - `tick.test.ts`: `testClock` is false on production, true elsewhere;
  - proxy test: `isPublicPath("/api/rounds/job")` is true;
  - a unit test that the job route's `maxConcurrency` read gives 5 from `vercel.json`, and that `vercel.json` has the `round-jobs` trigger on `app/api/rounds/job/route.ts`.
- [ ] **Step 2: Run** `pnpm --filter @gifts-af/web test -- queue job tick proxy` → fail.
- [ ] **Step 3: Implement**; install with `pnpm --filter @gifts-af/web add @vercel/queue@0.11.0 --save-exact`. Check `apps/web/node_modules/next/dist/docs/` for route segment config before writing `route.ts`.
- [ ] **Step 4: Run** the same tests → pass; then from the root `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → all pass.
- [ ] **Step 5: Commit** `feat(rounds): queue route and tick wiring for fan-out (ALL-125)`.

### Task 6: Docs, decision and the round engine page (AC-17, AC-18)

**Files:**
- Modify: `design/decisions.md` (T76), `design/technical-design.md` §5.1, `design/operations.md` (new section "Round fan-out (ALL-125)" and the alerts list), the round engine page (claude.ai artifact), this plan's checkboxes.

- [x] **Step 1: T76** in `design/decisions.md`: Vercel Queues for one call per round (one per buyer for held gifts), tied to E1's "compute that's truly independent"; held gifts grouped per buyer (one wallet); the daily limit in `start_idea_run`, applying everywhere; `maxConcurrency` read from `vercel.json` (bends T23); `tick_deadline_ms` now one call's deadline; housekeeping stays in the tick. Revises T68 (idea runs per tick → per day) and the ALL-28 ruling; keeps T75. Source: Jim, 2026-11-18.
- [x] **Step 2: §5.1:** the tick's order, the job, the off switch, "Long steps" rewritten for one call per round; replace "Handing each round to its own function call … is ALL-125". A job that dies before it claims leaves no `attempts`, so it shows as `round_job {result: "failed"}`, not `round_stuck`.
- [x] **Step 3: `design/operations.md`:** the switch and turning it on per environment; the dev check; runbooks for `round_fanout_send_failed` (check Vercel Queues status and logs; set the switch to 0 so the next tick runs inline; rounds are a day late at worst), `round_job` failed (read the error; if it repeats, switch off), `ideas.daily_limit_reached` (raise `idea_round_runs_per_day`, see ALL-135); stopping a bad deployment (switch to 0, then delete the deployment, because queued messages stay with the deployment that sent them). Add the three alerts to "Alerts (events with `alert: true`)".
- [x] **Step 4: Event check (AC-17):** a fake-store test in `fanout.test.ts` that the events new in this ticket (`round_fanout`, `round_fanout_send_failed`, `round_fanout_setting_unreadable`, `round_job`, `ideas.daily_limit_reached`) carry only these keys: `event`, `enabled`, `due`, `sent`, `failed`, `count`, `alert`, `kind`, `result`, `round_id`, `user_id`, `rounds`, `delivery_count`. Existing events are out of scope. Run → passes.
- [ ] **Step 5: Round engine page:** read https://claude.ai/artifact/Edr5DRi5s53iRPfAsuSnd8, add the fan-out (tick → queue → one call per round or per buyer) and the daily limit, republish to the same URL.
- [x] **Step 6: Commit** `docs: fan-out in the design, T76 and the runbook (ALL-125)` (on the branch; it ships with the code).

### Before merge, on the PR's preview (no paid calls)

- [ ] The preview deployment lists `/api/rounds/job` with a queue trigger (confirms the `experimentalTriggers` path with `apps/web` as the project root).
- [ ] A `POST` to the preview's `/api/rounds/job` from outside (with the bypass header) doesn't run a job: no `round_job` event in the logs.
- [ ] With `round_fanout_enabled` = 1 on dev (switch back to 0 afterwards; `idea_engine_enabled` stays 0, Zinc is the sandbox): call the preview's tick with the cron secret, the bypass header and `?now=` on a day with seeded due rounds → `round_fanout` with `sent` = due, one `round_job` per message, reminders in the outbox. This is where a proxy redirect (review S2) would show up.

### After merge

- [ ] The `migrate` job applies the migration to dev and prod; both have the two rows, `round_fanout_enabled` = 0.
- [ ] Production: set `round_fanout_enabled` = 1 before ALL-29 switches rounds on; the next morning's log shows `round_fanout`. Post evidence on ALL-125.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test: AC-1 T3/T5, AC-2 T1/T2, AC-3 T4, AC-4 T4, AC-5 T4, AC-6 T4, AC-7 T4, AC-8 T4, AC-9 T1, AC-10 T3/T4, AC-11 T3, AC-12 T3/T5, AC-13 T3/T5, AC-14 T1/T3/T4, AC-15 T4, AC-16 T2/T5, AC-17 T6, AC-18 T6.
- [x] Every task traces back to a story or criterion.
- [x] No open questions are left.
- [x] Adversarial review of the plan done (2026-11-18); blockers and should-fixes fixed above; its three owner items settled as **[Claude's call]** in "What was decided".

## Done: evidence on the ticket (T44)

- [ ] Tests added (each failing first), suite counts, lint, typecheck, CI result.
- [ ] Nothing a person sees changes, so no screenshots; the round engine page link instead.
- [ ] The preview checks and the production `round_fanout` log, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket ticked, with a pointer to its evidence.
