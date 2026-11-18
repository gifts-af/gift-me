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
| Idea runs under the daily limit: strictly nearest deadline first? | **No.** Runs go to whichever jobs arrive first; the first time the limit is hit each day, `ideas.daily_limit_reached` is logged with `alert: true` so the owner raises it | Jim, 2026-11-18, as recommended (review S1). Strict order needs the tick to work out which rounds need ideas; it only matters while the limit is too low. |
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

_Written after the spec's adversarial review is done._
