# ALL-169 Fan-out follow-up: Spec and Plan

**Status:** spec approved by Jim, 2026-11-24, after an adversarial review. The review changed the redelivery to a new delayed message; that part was reviewed with the plan. Plan reviewed and fixed, waiting for Jim's approval. No code yet.

**Goal:** with fan-out on, two rounds for one person both start their idea run the same day, the job log says what happened, and round messages build only the wiring they use.

**Links:** [ALL-169](https://linear.app/allens-forever/issue/ALL-169) · [ALL-125](https://linear.app/allens-forever/issue/ALL-125) (`design/plans/ALL-125-fan-out.md`) · `design/technical-design.md` §5.1 · T68, T76, T87 · PR #95 review

## The problem

1. **Same person, two rounds.** Their jobs run at once. `start_idea_run` allows one unfinished run per person, so the second is refused `busy`, released, and waits for the next day's tick.
2. **Misleading log.** `ideaPass` counts every round whose run didn't throw as advanced, so a refused run logs `round_job` `advanced`.
3. **Too much wiring.** Every job builds the Zinc buying side (`buyingWiring`) and reads the fee and margin settings. Round messages never place. Where Zinc isn't set up, each one logs `zinc.wiring_missing`.

**Correction to the ticket and to the PR #95 reply:** round messages do use Zinc. The heads-up's low-balance warning (`headsUpFunding`, `rounds/steps.ts`) reads the buyer's wallet and the funding lookahead. Dropping all Zinc wiring would silently lose that warning. Only the placing side goes.

## Spec: what it does

### Who it's for

1. **A buyer with two occasions close together for one person:** both sets of ideas start the same day.
2. **The owner reading the logs:** a job that did nothing doesn't say it advanced, and says why.

### How it works

- **Retry later.** When a round message's idea run is refused `busy`, its round is released as today (no lease, no run counted). If the release worked, the job sends a new signed message for that round, delayed by `idea_busy_retry_seconds`, and acknowledges its own. The new message gets its own 300 s call, claims the round and runs its step from the start.
- **A new message, not a redelivery.** A message waiting for redelivery keeps its lease, and Vercel counts leased messages toward `maxConcurrency` (5), so a few waiting rounds could hold up held gifts. A delayed message isn't visible to consumers until its delay passes (SDK 0.11.0). It also leaves the 3 deliveries for failures before the claim.
- **Bounded.** The message carries `retry`, the number of times it has been put off. At `idea_busy_retries_max` no more are sent. The idempotency key is `round:<id>:<day>:retry:<n>`, so two copies of a message send one follow-up.
- **Only `busy` retries.** A round whose lease someone else holds, `daily_limit`, off, `no_credit` and a failure after the claim are acknowledged, as today. A failure before the claim still throws, alerts and is redelivered.
- **The log.** `round_job` gains the result `waiting`: no step finished and the round stays due (released, or if the release fails, once its lease runs out; `round_release_failed` says so). A new field, `ideas`, is what the idea run came to. `rounds` is 1 for `advanced`, else 0, as today.

What each ending **of the idea pass** logs (`ideas` is left out where the table says none). Anything that ends before the pass, in the round's own step, logs what it logs today, with no `ideas`: a round that already has ideas sends its heads-up (`advanced`), and a date change seen there stays `advanced` (ALL-129).

| Ending | Round | `result` | `ideas` |
|---|---|---|---|
| refused `busy`, `daily_limit` | released | `waiting` | `refused:busy`, `refused:daily_limit` |
| idea engine off | released | `waiting` | `off` |
| `no_credit` (a run did start, T87) | released | `waiting` | `no_credit` |
| not enough time left | released | `waiting` | `no_time` |
| refused `done` | heads-up sent | `advanced` | `refused:done` |
| refused `limit`, `not_paid`, `not_found` | finished | `advanced` | `refused:<reason>` |
| `no_facts` | finished | `advanced` | `no_facts` |
| `saved` (any count), `none`, `failed` (vendors not set up included), `deadline`, `cost_cap` | moved on | `advanced` | the outcome |
| the step after the run throws, e.g. the heads-up is refused | lease kept | `failed` | the outcome |
| another run took the round in `moveToGenerating` | not ours | `busy` | none |
| a date change ended the round (ALL-129) | ended | `busy` | the outcome, or none if no run ended |
| refused `closed`, and no date change ended the round | lease lost | `failed` | `refused:closed` |
| the run itself throws | lease kept | `failed` | none |
| `tick_deadline_ms` or the idea settings unreadable | released | `failed` | none |

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Two due rounds for one person, daily cap not reached, fan-out on | Both jobs run at once, the fake AI holding the first run open until the second job is refused; then the follow-up message runs (real local database; fails on `main`) | Each round has one `idea_runs` row that day, and their times don't overlap |
| AC-2 | The same, with `idea_round_runs_per_day` = 1 | As AC-1 | One run starts; the follow-up is refused `daily_limit` and sends nothing more |
| AC-3 | Two copies of a round's message, the second starting while the first holds the claim (a barrier, real local database) | Both run | One runs the step; the other logs `busy` and sends nothing |
| AC-4 | A run refused `busy`, `retry` below `idea_busy_retries_max`, delay above 0, release worked | The job ends | One signed message for that round goes out with that delay and `retry` + 1 (and the test clock off production); the round has no lease; no alert, no `rounds_failed` |
| AC-5 | The same, at the limit or with the delay 0 | The job ends | Nothing is sent; the round stays due for the next tick |
| AC-6 | The delay or limit is missing or unreadable, or the send fails or throws | The job ends | Nothing more is sent, `round_retry_not_sent` is logged with a fixed `reason`, the result is still `waiting`, the message is acknowledged and `rounds_failed` is unchanged |
| AC-6b | The release fails, or a date change ended the round | The job ends | No follow-up is sent. `round_release_failed` and `waiting` for the first, `busy` for the second |
| AC-7 | An on-demand run under way for the person | Their round's job is refused `busy` | As AC-4 |
| AC-8 | Before the follow-up runs: fan-out or the engine is switched off; or the round is skipped, finished or leased | It runs | It does nothing (`off` or `busy`) and sends nothing |
| AC-9 | Before the follow-up runs: (a) the idea engine is off; (b) paid features are lost; (c) the round was deleted with its person; (d) the round got ideas | It runs | No AI or Zinc lookup is paid for and nothing more is sent. (a) `waiting` / `off`; (b) `advanced`, no `ideas` (it waits for its deadline); (c) `busy`; (d) the heads-up, `advanced`, no `ideas` |
| AC-10 | Each row of the table | The job ends | `round_job` has that `result` and `ideas` |
| AC-11 | Fan-out off | The tick's idea pass ends with a `waiting` row of the table | It isn't in `round_tick`'s `advanced` or `failed`; nothing else on that path changes |
| AC-12 | A round message | Its job runs | Its deps have no `placeRound` or `sweep` (by type, not stubs), the order margin isn't read, and `zinc.wiring_missing` isn't logged |
| AC-13 | A round message that sends the heads-up, with a balance below what's due | Its job runs | The low-balance warning is in the email, as today |
| AC-14 | A buyer message | Its job runs | It has the full buying wiring, and logs `zinc.wiring_missing` where Zinc is off, as today |
| AC-15 | Any new or changed event | Logged | Ids, counts and enums only (E6) |
| AC-16 | Dev, through a preview, with no spending (below) | One signed message for a seeded round runs | The first job logs `waiting` / `refused:busy`; the delayed message arrives and logs `waiting` / `refused:daily_limit` |

**AC-16's recipe.** No tick is called: a dev tick also creates rounds, sweeps and sends other dev accounts' emails. On dev: a paid test user, a fresh due round (a reused one is deduplicated that day), one fact, `round_engine_enabled`, `round_fanout_enabled` and `idea_engine_enabled` = 1, `idea_round_runs_per_day` = 0, and an unfinished `idea_runs` row for the person started now (younger than `idea_run_lease_ms`; `start_idea_run` uses the real clock). Then send one message with the SDK from a throwaway script, signed with dev's `CRON_SECRET`, with an explicit `deploymentId` (the preview's) and token. `busy` is checked before `daily_limit`, so the first job is refused `busy`. Finish the row, and the follow-up is refused `daily_limit`. Put the settings back and remove the rows. With the daily limit at 0 no run can start, so nothing is bought even with real vendor keys; if the preview has none, it needs dummy ones and a redeploy (allensforever711). **[Verify]** that a script can send to a preview's queue; if not, AC-16 is Still open until Jim agrees to a full dev tick.

### Out of scope

- Five or more rounds for one person on one day: three retries cover four rounds, and the rest wait a day.
- Idea runs past `idea_round_runs_per_day` waiting a day: an accepted exception (Jim, 2026-11-24).
- The off path (`round_fanout_enabled` = 0): it runs one after another and has no `busy` clash between rounds.
- Moving the daily limits (ALL-135).

## Approaches

| Approach | Trade-off | |
|---|---|---|
| **A. Retry later through the queue** | Keeps the claim, person limit and daily cap unchanged; each run has its own 300 s; covers on-demand clashes | **Picked** (Jim, 2026-11-24) |
| B. One message per person | Both runs share 300 s, so a slow first run still defers the second; changes `due_rounds` and the message shape | No |
| C. Queue concurrency key | Experimental, and it merges the second message into the first instead of delivering it | No |

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Retry delay | `idea_busy_retry_seconds`, **300**, a new `app_settings` row; 0 turns retries off | **[Claude's call]** One call lasts at most 300 s, so by then the other run has ended or been killed. It is also the off switch (E7) |
| How many retries | `idea_busy_retries_max`, **3**, a new `app_settings` row | **[Claude's call]** Covers four rounds for one person, or one killed run (`idea_run_lease_ms`, 10 min) with one retry to spare. Not both at once: the rest wait a day |
| Redelivery or new message | A new delayed message | **[Claude's call]** after the review: a waiting redelivery holds a job slot |
| Zinc for round messages | The wallet, the funding lookahead and the wallet link; `zinc_timeout_ms` is still read before the claim, so an unreadable one still throws and is redelivered | The heads-up's low-balance warning needs them |
| A run that failed | Usually frees the person at once: `runIdeas` finishes the row when it catches the error. If that write fails too, or the call is killed, the person stays busy for `idea_run_lease_ms` | Answers the ticket's `[Verify]`, from the code (`ideas/run.ts`) |

### Open questions

- None open. **Accepted (Jim, 2026-11-24):** the queue can deliver a message twice. If the first copy's run ends with nothing saved and runs are left, the round is due again at once, so a late copy can start a second paid run that morning. This is true today; follow-up messages add a little more chance. It is bounded by `idea_round_runs_max` (2, or 3 if a fact changes), `idea_round_runs_per_day` (5) and the $1 run cap.

## Principles check

- **Simplest version?** No new queue, table or message kind: one optional field on the round message, and the SDK's delayed send.
- **Hard-coded values?** Two new settings rows.
- **Product boundaries?** All inside the concierge and its routes.
- **New personal data?** None.
- **E7:** set `idea_busy_retry_seconds` to 0: no new follow-ups. Ones already waiting still run; `round_fanout_enabled` = 0 stops those.
- **E9:** seen as one round's `round_job` `waiting` / `refused:busy`, then about 5 minutes later the same `round_id` with a started run's outcome in `ideas`.
- **Docs and decisions:** a new T# (next free when it lands) recording Jim's 2026-11-24 approval: a job may send its own delayed follow-up, its key and bound, and the E1 reason (same queue, no new deployable). T68 and T76 say "revised by" it. Technical design §5.1; `design/operations.md`; the round engine page.

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture:** The idea pass reports how each round ended. A round job turns a `busy` refusal into one delayed, signed message through the sender the tick already uses (`SendJobs`). Round and buyer messages become two functions, so a round message's deps have no placing side by type.

**Tech stack:** one settings migration; `rounds/{steps,engine,fanout,emails}.ts`, `app/api/rounds/{queue,job/job,job/route}.ts`, `lib/wiring.ts`; Vitest (units and the real local database), pgTAP; docs.

**Order:** start after PR #135 (ALL-129) merges, from a fresh `main`; it edits the same catch blocks. ALL-167's `afterIdeaRun` work is planned, not built: whoever merges second keeps both, and every new ending there returns a turn.

### Global constraints

- `idea_busy_retry_seconds` = 300, `idea_busy_retries_max` = 3, read from `app_settings`; no default in code (T23).
- `start_idea_run`, `claim_round`, `due_rounds`, `vercel.json` and the buyer message don't change.
- Events carry ids, counts and enums only (E6). Comments carry no ticket or AC ids (T86).
- No paid AI or Zinc call in any test or check.

### Task 1: Settings (AC-4, AC-5)

**Files:** create `supabase/migrations/20261128100000_idea_busy_retry.sql` (take the next free version at build time); modify `supabase/tests/round_fanout.test.sql` and the key list in `supabase/tests/app_settings.test.sql`.

- [ ] Failing pgTAP: `concierge.setting_int('idea_busy_retry_seconds')` is 300 and `concierge.setting_int('idea_busy_retries_max')` is 3 (`plan(16)` becomes 18). Run `pnpm db:test`; expect those 2 and the key list to fail.
- [ ] Migration: insert both rows with descriptions, `on conflict (key) do nothing`. They say: 0 turns the retries off; above 86400 (the queue's 24 h retention) a send fails; delay × retries should stay above `idea_run_lease_ms`.
- [ ] Apply it locally (`pnpm exec supabase migration up`); `pnpm db:test` passes; `pnpm db:map:check` is clean. Commit.

### Task 2: The idea pass and the job log say what happened (AC-10, AC-11, AC-15)

**Files:** `rounds/steps.ts`, `rounds/engine.ts`, `test/fanout-event-keys.ts`; tests in `fanout.test.ts`, `round-engine-ideas.test.ts`.

**Produces:**

- `type IdeaTurn = { result: "advanced" | "waiting" | "busy" | "failed"; ideas?: string; release?: Release }` (`steps.ts`)
- `ideaPass(...same arguments): Promise<IdeaTurn[]>`: one turn per round
- `type Release = "released" | "ended" | "failed"`; `releaseQuietly(...): Promise<Release>`; `ended` = a date change ended the round. A `waiting` ending whose release is `ended` becomes `busy`; `failed` stays `waiting`
- `JobResult` gains `"waiting"`

Rules the table leaves to the builder:

- `ideas` is set as soon as the outcome is known, so a throw afterwards keeps it.
- A round with no turn left, or stopped behind `no_credit`, is `waiting` / `no_turn` (inline tick only; a job has one round and always has a turn).
- A date change that ended the round (`endedByMove`) is `busy`, with `ideas` if a run ended. `no_time` and `no_turn` start no run.
- `round_tick`'s `advanced` and `failed` are the counts of those two results. Idea settings that can't be read still fail every turn, as today.

- [ ] Failing tests, one `it.each` row per table row, through the round message: expect the returned result, and `round_job` with exactly that `result` and `ideas` (no `ideas` key where the table says none). Add a thrown heads-up after `saved` (`failed` / `saved`), `closed` with and without a date change, and a throw from the run itself. Also pin the three endings before the pass that the spec names, as they are today, and AC-6b.
- [ ] Failing tests for AC-11: fan-out off, one round per `waiting` row; `advanced` and `failed` are both 0, and the round is released as today.
- [ ] Update the existing expectations that called a released round advanced (the `no_credit` job test at `round-engine-ideas.test.ts:438` becomes `"waiting"`); list each one in the PR. Add `ideas` to `FANOUT_EVENT_KEYS`, with the reason in the PR.
- [ ] Implement; `pnpm test` passes. Commit.

### Task 3: Two message functions and lighter round deps (AC-12, AC-13, AC-14)

**Files:** `rounds/engine.ts`, `rounds/steps.ts`, `rounds/emails.ts`, `concierge/index.ts`, `lib/wiring.ts`, `app/api/rounds/job/route.ts`; tests `wiring.test.ts`, `fanout.test.ts`, `fanout-db.test.ts`, `round-engine-ideas.test.ts`.

**Produces:**

- `type RoundMessage = Extract<JobMessage, { kind: "round" }>`, `type BuyerMessage` likewise (`fanout.ts`)
- In `engine.ts`, beside `EngineDeps` and imported type-only: `type StepDeps = { store; notify; now; generateIdeas; zinc: Pick<EngineZinc, "wallet" | "lookahead" | "walletUrl"> | null; clock? }`, so `EngineDeps` is assignable to it. `steps.ts`, `emails.ts` and `roundJob` take `StepDeps`
- `runRoundMessage(message: RoundMessage, deps: StepDeps & { sendJobs: SendJobs }): Promise<JobResult>` and `runBuyerMessage(message: BuyerMessage, deps: EngineDeps): Promise<JobResult>`, replacing `runRoundJob`. They share its switch check, logging and before-the-claim rule
- `roundWiring(now: Date, env: Env, zincShare: number): Promise<StepDeps>` (`lib/wiring.ts`)

How: `advanceClaimed`'s `round_stuck` check and catch move into one helper that takes the step to run. The buyer path passes `runHeld` or `runStep`; `roundJob` passes `runStep` only, since it has already released a `needs_attention` round. `buyingWiring` and `roundWiring` share the store, notify, `now` and ideas part. `roundWiring` builds Zinc from `zincWiring` (so an unreadable `zinc_timeout_ms` still throws before the claim), reads no fee or margin, and logs nothing when Zinc is off.

- [ ] Failing type test, checked by `pnpm typecheck` and never executed: `// @ts-expect-error` on `placeRound` and on `sweep` of `NonNullable<StepDeps["zinc"]>`.
- [ ] Failing wiring tests (real local database): with Zinc on, `roundWiring`'s `zinc` has exactly `lookahead`, `wallet`, `walletUrl`; with `order_price_margin_pct` unreadable (global `fetch` stubbed to fail only the `setting_int` request whose body names that key; everything else reaches the real database) it still resolves while `buyingWiring` rejects; with Zinc off `zinc` is null and no `zinc.wiring_missing` is logged, while `buyingWiring` still logs it; a `zincShare` of 0 rejects.
- [ ] Failing test through `runRoundMessage` with a wallet of 1000 and a lookahead of 5000: the heads-up email has the low-balance warning and the wallet link.
- [ ] A round that became `needs_attention` is still released as `busy` by `runRoundMessage`.
- [ ] Implement, and move the existing tests to the two functions (the database test keeps a small local dispatcher). `pnpm typecheck && pnpm test && pnpm test:db` pass. Commit.

### Task 4: The delayed follow-up and its proof on the real database (AC-1 to AC-9, AC-15)

**Files:** `rounds/fanout.ts`, `rounds/engine.ts`, `app/api/rounds/{queue.ts,job/job.ts,job/route.ts}`, `test/fanout-event-keys.ts`; tests `fanout.test.ts`, `queue.test.ts`, `job.test.ts`.

**Produces:**

- `RoundMessage` gains `retry?: number`; `QueuedJob` gains `delaySeconds?: number`
- `retryJob(message: RoundMessage, day: string, delaySeconds: number): QueuedJob` (pure): `retry` is the old one (or 0) plus 1; `now` is carried; the key is `round:<id>:<day>:retry:<n>`
- `round_retry_not_sent { round_id, user_id, reason: "settings" | "send_failed" }`, not an alert: the round stays due for the next tick

In `runRoundMessage`, only for `waiting` with `refused:busy`, and only when its release is `released`: read both settings (a throw → `settings`); delay ≤ 0 or `retry` ≥ max → nothing and no log; else `sendJobs([retryJob(...)])`. A throw or `failed > 0` → `send_failed`. None of it changes the result or throws. `round_job` is logged either way. `sendJobsWith` passes `delaySeconds` through only when set, on the second attempt too. `messageSchema`: `retry: z.number().int().min(1).optional()` on round messages. The route reads `CRON_SECRET` inside `run`, which is reached only after the signature check, throws if it's unset (as the tick route does), and spreads `sendJobs: queueSendJobs(secret)` onto `roundWiring`'s deps.

**Write the database proof first** (`fanout-db.test.ts`, using AC-15's method: a random far-off year, its own daily count, settings saved and restored, real `start_idea_run`). A person may now hold two rounds (two occasions). `finished_at` is the real clock while `started_at` is the test's, so row times can't show overlap: the fake run records its own marks (after a successful `start`, before `finish`) and counts runs active per person.

- [ ] AC-1: two rounds, one person. The first job's run waits on a barrier until the second job has ended `waiting` / `refused:busy`; then it ends and the captured follow-up runs with a `now` 5 minutes later. Assert one `idea_runs` row per round that day, at most 1 active at any time, and the first's finish mark before the second's start mark. Run it before implementing; it must fail because no follow-up was sent and only one row exists. Keep the output for the ticket.
- [ ] AC-2: the same with `idea_round_runs_per_day` = 1: one row, the follow-up ends `waiting` / `refused:daily_limit`, nothing more sent.
- [ ] AC-7: an unfinished on-demand run (`round_id` null) started 1 minute before the test's `now`: `waiting` and one follow-up.
- [ ] AC-3, a guard that passes today: two copies of one message, the claim holder at a barrier: `["advanced", "busy"]`, one run, no follow-up.
- [ ] AC-9 (c): delete the person, run the follow-up: `busy`, no run.
- [ ] Failing `retryJob` tests: no `retry` → 1, 2 → 3; key `round:r1:2027-02-11:retry:1`; `now` kept, and absent when absent.
- [ ] Failing job tests: AC-4 (exact job, round unlocked when the send happens, `onFailed` not called by `handleJob` for `waiting`); AC-5 (`retry` 3 of 3, delay 0, max 0); AC-6 (each setting missing, send returning failed, send throwing: the reason, result `waiting`, no throw); every other row of the table sends nothing; AC-8 and AC-9, one case per condition, with a `retry: 1` message.
- [ ] Failing queue test: `delaySeconds: 300` reaches `sendBatch`, and again on the retryable resend; a job without it has no such key.
- [ ] Failing `handleJob` tests: a signed `retry: 1` reaches `run`; `retry` of 0, -1, 1.5 or "1" is `invalid`; a changed `retry` is `bad_signature`; off production the follow-up's `now` is used, on production it isn't.
- [ ] Failing key test: `strayKeys` is empty over every event above. Implement; `pnpm test` passes, and `pnpm test:db` three times in a row. Commit.

### Task 5: Docs, PR, live (AC-16)

- [ ] The new T#, "revised by" on T68 and T76, technical design §5.1. `design/operations.md`: the settings and both off switches, `round_job`'s `waiting` and `ideas`, `round_retry_not_sent`, `round_fanout_send_threw` (a job can log it now), the bad-signature entry. "Signed by the tick" in `sign.ts` and `job.ts` comments. Round engine page, republished to its own URL after the merge.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm db:map:check && pnpm build`; PR titled `fix: two rounds for one person get ideas the same day, and the job log says what happened (ALL-169)`, body `Part of ALL-169`; an adversarial review; evidence on the ticket.
- [ ] AC-16 by its recipe. Settle its **[Verify]** first.
- [ ] After the merge: the next 12:00 UTC tick on production (E9), then ALL-125's first criterion. A natural `busy` may not happen that day; if so it's **Still open**.

## Before coding: consistency check

| AC | Task |
|---|---|
| AC-4, 5 settings | 1 |
| AC-6b, 10, 11, 15 | 2 |
| AC-12, 13, 14 | 3 |
| AC-1 to 9, 15 | 4 |
| AC-16 | 5 |

- [x] Every criterion maps to a task and a test; every task traces to a criterion.
- [x] No open questions left.
- [x] Adversarial review of the plan and the spec's delayed message (2026-11-24): 2 blockers, 7 should-fixes, 6 nits, all fixed; no money-path finding.

## Review focus

| Risk | Expected | Test |
|---|---|---|
| A tampered or malformed `retry` | Refused, never run | Task 4, `handleJob` |
| The person or round is deleted before the follow-up | No run, no send, acknowledged | Task 4, AC-8 and AC-9 |
| A follow-up sent before the release | It would find the lease and do nothing | Task 4, AC-4's order |
| A date change ends the round during the run | Quiet `busy`; no `round_failed` | Task 2, `closed` |
| A round message reaches placing | Can't: no `placeRound` in its type | Task 3, type test |
