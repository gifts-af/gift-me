# ALL-35 Owner health email, AI spend alerts, monitoring: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the owner gets an email on any day something needs them (the tick didn't run or failed, the database is down, a round is stuck, an order can't be confirmed, AI credit is out or low, ideas can't run), a weekly summary with an "all clear" line, and running out of AI credit no longer burns buyers' idea runs.

**Links:** [ALL-35](https://linear.app/allens-forever/issue/ALL-35), design §5.1, §7 (cost control), §9 (monitoring), `design/operations.md` > Alerts, T22 (keepalive), T24 (Gateway cap), T75 (AI spend approved by the owner), ALL-28 AC-12 (`round_stuck`), ALL-32 (unconfirmed and held orders).

## Spec: what it does

### Who it's for and what they can do

1. **Daily problems email:** as the owner, on a day something needs *me*, I get one email listing each problem with what to do; on other days I get nothing.
2. **Missed or failed tick:** as the owner, I'm told when the daily round engine hasn't finished successfully today, or reported failures, even though the round engine itself can't tell me.
3. **Out of AI credit:** as a buyer, when the app runs out of AI credit my round just waits; it doesn't use up my idea runs or tell me "no ideas". As the owner, I'm told at once.
4. **Weekly summary:** as the owner, every Monday I get a short summary: counts of rounds waiting on buyers, failed captures this week, and "all clear" if nothing needs me, so silence never hides a dead checker.

AI spend alerts come from Vercel, not the app: a monthly **$100 team budget** on AI Gateway with emails at 50%, 75% and 100% to the team owner (allensforever711), and requests refused at 100% (owner, 2026-11-23). Auto top-up is off for now (owner, 2026-11-23): when the prepaid balance runs out, idea runs pause uncounted (AC-10) and the health email says so; the owner tops up by hand.

### What gets checked

Each check reads the database or a vendor directly. None of them reads Vercel logs: on Hobby those are kept for about an hour.

**Daily (only things the owner can act on).** "Open" means `gift_rounds.closed_at is null` and `status not in ('skipped', 'complete', 'delivered')` (`finish_round` leaves `closed_at` null).

| Check | Source | Flagged when | Runbook |
|---|---|---|---|
| Database unreachable | the job's first query, retried once | both tries fail | Supabase paused or down |
| Tick missed | tick heartbeat row | no row for today (UTC), or today's row never finished (the tick was killed: it can run 300 s at most, and the check runs about two hours later) | Cron, deploy, `CRON_SECRET` |
| Tick failed | tick heartbeat row | today's tick finished with `result = 'failed'`, or fan-out sends failed above 0. A failed round step alone isn't listed: it retries and repeats surface as stuck rounds (T76); its count goes in the weekly email (owner, plan review) | Round engine on/off; Round fan-out |
| Stuck rounds | `gift_rounds.attempts` | open and `attempts >= round_max_attempts` (the same rule as the `round_stuck` event) | Round engine |
| Unconfirmed orders | `orders.status = 'unconfirmed'` | any | Unconfirmed orders |
| Orders stuck placing | `orders.status = 'placing'` | last updated before today's tick started and longer ago than `placing_stale_minutes`: the sweep already looked and couldn't settle it | Unconfirmed orders |
| Orders held for a Zinc problem | `orders.status = 'held'` | `hold_reason` in (`retry`, `not_allowed`) | Zinc wallet ordering |
| Ideas can't run here | `idea_engine_enabled` or `capture_extraction_enabled` = 1 and the AI Gateway (or, for ideas, Zinc) env vars missing | always | Gift idea engine |
| Out of AI credit | `idea_runs` with `outcome = 'no_credit'` started in the last day, or AI Gateway `/v1/credits` balance at or below 0 while ideas or capture extraction are on (plan review, final review). While it's flagged, open rounds still waiting on ideas within `hold_final_days` of `ship_by_deadline` are listed under it (owner, plan review) | any | AI credit |
| Gift ideas failed (2026-11-24) | `idea_runs` with `outcome = 'failed'` finished in the last 25 hours | any | Gift ideas failed |
| A vendor check failed (2026-11-24) | AI Gateway `/v1/credits` or Zinc `/wallet/me`, while something uses it | two tries fail | A vendor check failed |
| AI credit low | AI Gateway `/v1/credits` balance, while ideas or capture extraction are on | below `ai_credit_low_cents` (500) | AI credit |
| App's Zinc balance low | Zinc `/wallet/me` with the app key (T17), while ideas or Amazon paste lookups are on | below `zinc_app_balance_low_cents` (500) | Zinc wallet ordering |
| The check couldn't run | a setting, the snapshot, a vendor call or the route's wiring threw | always; the line names the stage (`settings`, `snapshot`, `vendors`, `wiring`), never the error (final review) | The health check couldn't run |
| Buyer-waiting round near its deadline | open rounds in `needs_address`, or `needs_attention` with `attention_reason` in (`funds`, `setup`, `address`) | within `hold_final_days` of `ship_by_deadline` | none: the buyer has been told; the owner may step in |

`needs_attention` rounds whose reason is `unconfirmed` appear once, under Unconfirmed orders. Held orders with `hold_reason = 'paused'` are the owner's own switch (`zinc_ordering_enabled` = 0) and aren't listed. Funds, setup and address holds are the buyer's to fix and appear only near the deadline or in the weekly counts.

**Weekly (on `health_all_clear_weekday`, Monday), always sent:** counts of open rounds waiting on the buyer (address, funds, setup, approval), rounds that ended this week with `no_ideas`, round steps that failed this week (the heartbeat's counts, plan review), failed captures in the last 7 days, and either "All clear" or the daily problems above.

Every line carries ids only (round, order, user) and a link to its runbook section in `design/operations.md`. No names, emails, addresses or gift titles (E6, T42).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A round stuck at `attempts` = `round_max_attempts`, an `unconfirmed` order, a `placing` order from before today's tick, a `held` order with `hold_reason = 'retry'` | The health job runs on a Tuesday | One email lists each under its own heading with its id and runbook link; the unconfirmed order's round isn't listed a second time |
| AC-2 | Nothing the owner can act on; a `needs_address` round 20 days from its deadline; a `held` funds order | The health job runs on a Tuesday | No email; `health.checked {problems: 0, sent: false}` is logged |
| AC-3 | The same, on a Monday | The health job runs | The weekly email: "All clear", plus counts (1 waiting on an address, 1 waiting on funds) |
| AC-4 | A `needs_address` round within `hold_final_days` of its ship-by deadline | The health job runs on a Tuesday | It's listed under "Waiting on the buyer, deadline close" |
| AC-5 | No heartbeat row for today, or one that started and never finished | The health job runs | The email leads with "Today's round engine run didn't finish", with the last successful finish |
| AC-6 | Today's tick finished with `result = 'failed'`, or with fan-out sends failed above 0 (plan review) | The health job runs | The email says the tick reported failures, with the counts |
| AC-7 | With `round_fanout_enabled` = 1, two queue jobs fail and one idea run gets a 402 | The health job runs on a Monday | The heartbeat's `rounds_failed` includes the two jobs (the job route adds them) and the weekly email shows the count; the 402 leads the email as "Out of AI credit", read from its `idea_runs` row (plan review) |
| AC-8 | The database can't be reached (a client whose queries throw) | The health job runs | It retries once, then sends "The database can't be reached", reading no settings; the email holds no error message, only `errorFields` |
| AC-9 | `idea_engine_enabled` = 1 and `AI_GATEWAY_API_KEY` unset | The health job runs | The email says ideas can't run on this environment |
| AC-10 | The AI Gateway answers an idea run's call with 402 (`insufficient_funds` or `quota_for_entity_exceeded`) | A round's idea run happens on the tick | The run isn't counted against the round's runs (only when the 402 came before any AI reply was paid for; a 402 after that ends the run as `failed`, which counts, T68, plan review), no email goes to the buyer, the round stays `generating` (released, not stuck) and a later tick tries again; with fan-out off no other idea run starts that tick, while with fan-out on each due round's job tries its own run, and `idea_round_runs_per_day` bounds both (final review); and `ideas.no_credit {alert: true}` is logged; the run's `idea_runs` row has `outcome = 'no_credit'` (plan review) |
| AC-11 | An idea run refused with `no_credit` in the last day, or the credits balance is at or below 0 while ideas or capture extraction are on (plan review, final review) | The health job runs | The email leads with "Out of AI credit: ideas are paused", listing open rounds waiting on ideas within `hold_final_days` of their ship-by deadline (owner, plan review) |
| AC-12 | AI credit balance below `ai_credit_low_cents` | The health job runs | The email says AI credit is low |
| AC-13 | The health route is called without the cron secret | — | 401, nothing read or sent, no heartbeat touched |
| AC-14 | `health_email_enabled` = 0 | The health job runs | It still does the keepalive query, sends nothing, logs `health.checked {result: "off"}` |
| AC-15 | A fixture user with a name, email, street address and gift titles owns every flagged item | The email renders | None of those strings appear in its HTML or text; it goes only to the owner inbox through `renderEmail` |
| AC-16 | The tick route is called without the cron secret | — | The heartbeat isn't written |
| AC-17 | Something uses the AI Gateway (or Zinc), and its balance can't be read in two tries | The health job runs | The email names the vendor; the log has the HTTP status. One failed try alone is not a problem (2026-11-24, owner) |
| AC-18 | An idea run ended `failed` in the last day | The health job runs | The email says gift ideas failed, with the count (2026-11-24, owner) |

### Out of scope

- Vendor trouble that ends a run some other way (2026-11-24): an AI failure when a list gift still qualified (`saved`), a list pass where every Zinc lookup failed (`none`), a run cut off at its deadline (`deadline`), or a killed function (no outcome). A wrong key still shows as a vendor check that failed.
- Persisting log-only alerts (bad queue signatures, unmatched Zinc webhooks, email-send failures) to the database. Those still need Vercel logs; operations.md says so. A log drain needs Vercel Pro (ALL-135).
- A dashboard page. Vercel's AI Gateway dashboard covers spend.
- Buyers' own Zinc balances. The buyer is already emailed about a funds hold (ALL-32).
- Capture extraction on a 402: it already fails visibly to the buyer, who can retry; the credit checks above cover the cause.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| AI spend cap and alerts | Vercel AI Gateway team budget: $100 a month, alerts at 50/75/100%, refuses at 100% | Already set; revises §7's $60 and 50/80% (owner, 2026-11-23) |
| Auto top-up | Off for now; revisit with many users | Manual top-ups at ~$5–15 a month; the low-credit warning gives time (owner, 2026-11-23) |
| Out of credit during an idea run | A new `AiError` kind `no_credit` for 402; the run is uncounted, like `ideas.not_configured`, only when no AI reply in it was paid for (otherwise `failed`, counted: T68, plan review); the tick starts no further run with fan-out off, each job tries once with fan-out on, and the daily guard bounds both; no buyer email, but a round whose latest run was `no_credit` gets the "skipped" email at its deadline (owner, final review) | Our outage must not burn buyers' runs or send a false "no ideas" (§5.1, customers always informed) **[Claude's call]** |
| Where problems come from | Database state and vendor balances, not logs | Hobby keeps runtime logs about an hour; drains need Pro **[Claude's call]** |
| Scheduled job | No new cron: the keepalive cron becomes the health job (`/api/health`), moved to 14:00 UTC; its first query is the keepalive (T22) | E1: no new scheduled job; 14:00 clears the tick's anywhere-in-the-hour start and 300 s run on Hobby (T87) **[Claude's call]** |
| Tick heartbeat | A one-row-per-tick table `concierge.tick_heartbeats` (service role only): `day`, `started_at`, `finished_at`, `result`, `rounds_failed`, `fanout_failed`; written only after the secret check. `no_credit` runs are read from `idea_runs`, not copied here (plan review) | "Started" alone misses a tick that fails every day (T87) **[Claude's call]** |
| Daily vs weekly | Daily: only owner-actionable items, plus buyer-waiting rounds near their deadline; weekly on Monday: counts and "All clear" | E8: a daily email about buyer-owned waits becomes noise **[Claude's call]** |
| Who receives it | The owner inbox (`inboxFor("health")`) | One place the owner already reads |

## Principles check

- **Simplest version?** One route (the keepalive's replacement), one module of read-only checks, one email template, one small table. Cut: app-side spend tracking (Vercel does it), an alerts table, a dashboard, per-buyer balances.
- **Hard-coded values?** New settings: `health_email_enabled` (1), `health_all_clear_weekday` (1, Monday), `ai_credit_low_cents` (500), `zinc_app_balance_low_cents` (500), `health_vendor_timeout_ms` (10000). Reused: `round_max_attempts`, `placing_stale_minutes`, `hold_final_days`, `idea_engine_enabled`, `capture_extraction_enabled`, `amazon_paste_lookup_enabled`. The cron time is in `vercel.json`. The $100 budget lives in Vercel only.
- **Product boundaries?** Concierge module only.
- **New personal data?** None. The heartbeat holds counts and times; the email holds ids and counts.
- **Docs and decisions:** T87 in `design/decisions.md`, revising T22, T24 and T68, with a "revised by T87" note on each (plan review); design §5.1 (heartbeat, `no_credit`), §7 (cap is the Vercel budget, $100, 50/75/100%), §9 (monitoring), §10 (cap figure); operations.md (Health email section with a runbook per line, AI credit runbook, `ideas.no_credit` in Alerts, log retention note, keepalive replaced); the round engine page; the database map (`pnpm db:map`, publish after merge); the screens and emails page (new email).

## Plan

**Revised 2026-11-23** after the plan's adversarial review (`B1`, `S1`–`S9`, `N1`–`N5`) and the owner's two rulings: while AI credit is out, rounds waiting on ideas near their deadline are listed; a single self-healing round failure stays out of the daily email (T76 stands).

**Architecture:**
- **The database answers "what's wrong".** One migration adds `concierge.tick_heartbeats` and three service-role functions that write it, plus five settings. It also adds a `no_credit` run outcome that no run-counting rule counts (`round_idea_state`, `runs_after_rejection`, and the store's last-run read). `concierge.health_snapshot(p_now)` returns every flagged id and weekly count as one JSON value. pgTAP pins its rules.
- **One module, `modules/concierge/health/`,** turns that snapshot plus two vendor balances into a report (pure), renders it through `renderEmail` (pure) and runs the job (`runHealthCheck`, with every client passed in, E3). `/api/health` replaces `/api/keepalive`: the same secret check and the same daily cron slot, moved to 14:00 UTC.
- **The tick writes its heartbeat at the route** (`handleTick`), after the secret check. Queue jobs add their failures through `handleJob`'s new `onFailed` callback, because with fan-out on they run outside the tick's function call. `no_credit` runs are never copied: the snapshot reads them from `idea_runs`.

**ALL-149:** the engine split has merged (#108), and these paths are on `main` (`rounds/engine.ts`, `steps.ts`, `money-path.ts`, `emails.ts`). This plan changes one line in `engine.ts` (`fanoutFailed` on the fan-out summary) and doesn't touch `app/people/actions.ts`, which ALL-149 is still splitting.

**Tech stack:** Supabase (Postgres, pgTAP), Next.js 16 route handlers, Vitest (`unit` and `local-db` projects), Resend through `lib/resend.ts`, the AI Gateway over plain HTTP (`lib/ai/messages.ts`), Zinc's `/wallet/me` (`zinc/account.ts`), `pnpm gallery`.

**Branch:** `aarontallen/all-35-health-email`, cut from `main` at the start of Task 1. One PR, `Part of ALL-35`: the live check (Task 7) follows the merge.

**Order:** 1 → 2; 1 → 3 → 4; 5 needs only Task 2's snapshot shape and runs alongside 3 and 4 **[P]**; 6 needs 2–5; then 7, then 8.

### Global constraints

- **Settings, not constants (T23).** New rows, each with a description: `health_email_enabled` = 1, `health_all_clear_weekday` = 1 (Monday, in `Date.getUTCDay()` numbering), `ai_credit_low_cents` = 500 (a $5 warning before ideas pause), `zinc_app_balance_low_cents` = 500, `health_vendor_timeout_ms` = 10000 (each vendor balance call's limit, inside the route's 60 s). Reused: `round_max_attempts`, `placing_stale_minutes`, `hold_final_days`, `idea_engine_enabled`, `capture_extraction_enabled`, `amazon_paste_lookup_enabled`. The cron time lives in `vercel.json`. True constants: "the last day" (one day between daily checks) and "this week" (7 days). If a setting can't be read, the check fails loudly (`health.checked {result: "failed"}`). There's no fallback value.
- **"Open" round.** `closed_at is null` **and** `status not in ('skipped', 'complete', 'delivered')`. `closed_at` is only set on the money path (cancel_held, a removed person or occasion), so a round that `finish_round` moved to `skipped` keeps it null. Written once, in `health_snapshot`.
- **"Today"** is the UTC day of the job's `now`, as on the tick (`dayOf`). The heartbeat's `day` and its times come from the tick's own clock, so `?now=` off production moves them, as it moves the tick. That includes rows a job creates (N3).
- **Ids only (E6, T42).** The snapshot, the events and the email hold round, order and user ids, counts, cents, reasons and dates. No names, emails, addresses, gift titles, notes or vendor error text. Errors are logged through `errorFields`.
- **Mocks and the real thing (E5).** pgTAP and local-db Vitest for every rule the database applies and for the privacy check. The AI Gateway, Zinc and Resend are always faked, through the `fetch` each takes.
- **Migration:** `supabase/migrations/20261123120000_health.sql`, re-dated past `main`'s newest just before merge. Expand-only (E7): the new outcome, table, functions and settings are additions. `round_idea_state` and `runs_after_rejection` are re-created with the same signatures. Then `pnpm db:types` and `pnpm db:map`.
- **Before the PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm db:test && pnpm db:types:check && pnpm db:map:check && pnpm build`.

### File map

| File | Change |
|---|---|
| `supabase/migrations/20261123120000_health.sql` | New: table, settings, `start_tick`, `finish_tick`, `add_tick_counts`, `no_credit` outcome, re-created `round_idea_state` and `runs_after_rejection`, `health_snapshot` |
| `supabase/tests/health.test.sql` | New pgTAP |
| `packages/core/src/database.types.ts`, `design/database-map.html`, `apps/web/scripts/db-map/layout.json` | Regenerated; the new table's lane and note |
| `apps/web/lib/ai/messages.ts` (+ new `lib/ai/__tests__/messages.test.ts`) | `AiError` kind `no_credit` on 402; `gatewayCredits` |
| `apps/web/modules/concierge/ideas/{run,store}.ts` | `no_credit` outcome when no AI reply was paid for; `RUN_ENDS` |
| `apps/web/modules/concierge/rounds/store.ts` | `readIdeaState`'s last-run read skips `no_credit` |
| `apps/web/modules/concierge/rounds/steps.ts` | `ideaPass` stops after a `no_credit`; `afterIdeaRun` releases and alerts |
| `apps/web/modules/concierge/rounds/engine.ts` | One line: `fanoutFailed` on the fan-out summary |
| `apps/web/modules/concierge/health/{heartbeat,store,report,email,run}.ts`, `index.ts` export | New module |
| `apps/web/modules/concierge/notify/samples.ts` | The two health samples, in `sampleEmails` (N5) |
| `apps/web/app/api/rounds/tick/{tick,route}.ts`, `app/api/rounds/job/{job,route}.ts` | Heartbeat writes; `onFailed` |
| `apps/web/app/api/health/{route,health}.ts`, `lib/wiring.ts` (`healthWiring`) | New; replace `app/api/keepalive/route.ts`, `lib/keepalive.ts`, `test/keepalive.test.ts` (deleted) |
| `apps/web/vercel.json`, `lib/supabase/proxy.ts`, `test/public-paths.test.ts`, `lib/brand.ts`, `README.md` | `/api/health` at `0 14 * * *`; public path; `inboxFor("health")` |
| `design/operations.md` | Health email and AI credit runbooks, in the PR (Task 6) |
| `design/…` | The rest in Task 8 |

---

### Task 1: Heartbeat table, settings, and runs that don't count (AC-10, AC-16 storage)

**Files:** create the migration and `supabase/tests/health.test.sql`.

**Produces:**
- `concierge.tick_heartbeats`:
  - Columns: `day date primary key`, `started_at timestamptz not null`, `finished_at timestamptz`, `result text check (result in ('ok', 'failed'))`, `rounds_failed integer not null default 0 check (rounds_failed >= 0)`, `fanout_failed`, the same.
  - RLS on, with no policies. `revoke all … from public, anon, authenticated`; `grant select, insert, update … to service_role` (N2).
  - Comment: counts and times only, no personal data.
- `concierge.start_tick(p_day date, p_at timestamptz) returns void`:
  - Inserts the day's row.
  - On a re-run the same day it sets `started_at = p_at` and clears `finished_at`, `result`, `rounds_failed` and `fanout_failed`. The counts belong to the latest run and its jobs (N4).
- `concierge.finish_tick(p_day date, p_at timestamptz, p_result text, p_rounds_failed integer, p_fanout_failed integer) returns void`:
  - Sets `finished_at`, `result` and `fanout_failed`.
  - **Adds** `p_rounds_failed`, because jobs may have added theirs first.
  - A missing row is inserted with `started_at = p_at`.
- `concierge.add_tick_counts(p_day date, p_at timestamptz, p_rounds_failed integer) returns void`:
  - Upserts the day's row, with `started_at = p_at` if it's new (N3).
  - Adds the count in one statement, so concurrent jobs don't lose one.
- All three: `security definer`, `search_path = ''`, execute for service_role only.
- The five settings (Global constraints).
- `idea_runs.outcome`'s check gains `'no_credit'` (drop and re-add `idea_runs_outcome_check`).
- `round_idea_state` (from `20261117100000_idea_engine.sql`) and `runs_after_rejection` (from `20261122160000_approval.sql`) are re-created. Their lateral run subquery filters `u.outcome is distinct from 'no_credit'`, so both `runs` and `last_started` skip it (B1).
  - `start_idea_run` needs no change: it asks `round_idea_state`.
  - Its `idea_round_runs_per_day` count still counts a `no_credit` run. That's an app-wide spend guard, and Task 4 stops the pass after the first one.

- [ ] **Step 1: Write the failing pgTAP tests** in `health.test.sql`:
  - `tick_heartbeats has RLS on, anon and authenticated can't select it, service_role can`
  - `anon and authenticated can't execute start_tick, finish_tick or add_tick_counts`; `service_role can`
  - `start_tick then finish_tick records one ok row` (`result = 'ok'`, `finished_at` set)
  - `a second start_tick the same day clears finished_at and the counts`
  - `finish_tick adds rounds_failed to what add_tick_counts already added` (2 + 1 = 3)
  - `add_tick_counts creates the day's row with started_at = p_at`
  - `the four health settings exist with their defaults` (`setting_int` = 1, 1, 500, 500)
  - `idea_runs accepts outcome no_credit`
  - `a no_credit run doesn't use up the round's runs`: `idea_round_runs_max` runs, one of them `no_credit`, and `runs_left` is true.
  - `a no_credit run after a new fact leaves the extra run available` (B1): the maximum runs, then a newer active fact, then a later `no_credit` run, and `runs_left` is still true.
  - `runs_after_rejection's extra-run branch ignores a newer no_credit run` (B1).
  - Regression guard (passes before and after): `a failed run still counts`.
- [ ] **Step 2: Watch them fail.** `pnpm db:test`. Expected: the new tests fail; the guard passes.
- [ ] **Step 3: Write this part of the migration.**
- [ ] **Step 4: Watch them pass.** `pnpm supabase db reset && pnpm db:test`. Expected: every file passes, and `idea_engine.test.sql`, `approval.test.sql` and `round_fanout.test.sql` are unchanged.
- [ ] **Step 5: Commit** `feat(db): tick heartbeat, health settings, and no_credit runs that don't count (ALL-35)`.

### Task 2: `health_snapshot` (AC-1 to AC-7 data, AC-11 data, AC-15 ids only)

**Files:** the migration and `health.test.sql`. Then run `pnpm db:types` and `pnpm db:map`, and add `concierge.tick_heartbeats` to the `round` lane in `apps/web/scripts/db-map/layout.json` with the note `one row per daily tick: did it finish`.

**Produces:** `concierge.health_snapshot(p_now timestamptz) returns jsonb`: stable, security definer, service_role only. It reads `round_max_attempts`, `placing_stale_minutes` and `hold_final_days` itself, and raises if one is missing. Shape (snake_case keys; Task 5 parses it with zod):
```
{ tick: { last_ok_finished_at, today: { started_at, finished_at, result, rounds_failed, fanout_failed } | null },
  no_credit_runs: integer,
  stuck_rounds:   [{ round_id, user_id, attempts }],
  unconfirmed:    [{ order_id, round_id, user_id }],
  placing_stale:  [{ order_id, round_id, user_id }],
  held_zinc:      [{ order_id, round_id, user_id, hold_reason }],
  deadline_close: [{ round_id, user_id, reason, ship_by_deadline }],
  ideas_waiting:  [{ round_id, user_id, ship_by_deadline }],
  weekly: { waiting_address, waiting_funds, waiting_setup, waiting_approval, no_ideas, rounds_failed, failed_captures } }
```
Each rule is written once, here:
- **`today`:** the row whose `day` is `p_now`'s UTC day. **`last_ok_finished_at`:** the latest `finished_at` with `result = 'ok'`.
- **`no_credit_runs`:** `idea_runs` with `outcome = 'no_credit'` and `started_at >= p_now - interval '1 day'` (S2).
- **`stuck_rounds`:** open, `attempts >= round_max_attempts`, and not a `needs_attention` round with `attention_reason = 'unconfirmed'` (that one shows under `unconfirmed`). A SQL comment says why this is `>=` while the engine's `round_stuck` uses `>`: the engine counts the claim it's making, and this reads the stored value between ticks, so both mean the same number of failed claims (N1).
- **`unconfirmed`:** `orders.status = 'unconfirmed'`.
- **`placing_stale`:** `status = 'placing'`, `updated_at` before today's `started_at` (with no row today, any), and `updated_at < p_now - placing_stale_minutes`. Aged by `updated_at`, the last time the order moved, not `created_at` (Task 2 review).
- **`held_zinc`:** `status = 'held'` and `hold_reason in ('retry', 'not_allowed')`.
- **`deadline_close`:** open, and either `status = 'needs_address'` (reason `address`) or `needs_attention` with `attention_reason in ('funds', 'setup', 'address')`, and `ship_by_deadline <= p_now's UTC day + hold_final_days`.
- **`ideas_waiting`** (owner ruling a): open, `status in ('scheduled', 'generating')`, no idea with `status <> 'rejected'`, and within `hold_final_days` of `ship_by_deadline`.
- **`weekly`:**
  - Open rounds counted by status: `needs_address`, `needs_attention` with `funds` or `setup` (`address` counts with `waiting_address`), and `awaiting_approval`.
  - `no_ideas`: rounds `skipped` with `updated_at` in the last 7 days and a `round_sends` step matching `^no_ideas`.
  - `rounds_failed`: the sum over heartbeat rows from the last 7 days.
  - `failed_captures`: `captures.status = 'failed'` with `updated_at` in the last 7 days.

- [ ] **Step 1: Write the failing pgTAP tests.** Fixture users come from `tests.create_user`, and `p_now` is fixed so the day is a known Tuesday.
  - `anon and authenticated can't execute health_snapshot`
  - `AC-1: a round at round_max_attempts, an unconfirmed order, a placing order from before the tick, a held retry order: each listed once by id`
  - `the unconfirmed order's round isn't also a stuck round`
  - `a placing order created after today's tick started isn't listed`
  - `a placing order younger than placing_stale_minutes isn't listed`
  - `a held paused or funds order isn't in held_zinc`
  - `AC-2: a needs_address round 20 days out isn't deadline_close`; `AC-4: one within hold_final_days is`
  - `a skipped round with closed_at null is not open` (it's not in `stuck_rounds` or the weekly counts)
  - `AC-3 counts: one waiting on an address, one on funds`
  - `ideas_waiting lists a generating round with no ideas within hold_final_days, not one with proposed ideas or one further out`
  - `no_credit_runs counts the last day only`
  - `weekly rounds_failed sums the last 7 days of heartbeat rows`
  - `no_ideas counts a round skipped this week after a no_ideas send, not one from 8 days ago`
  - `failed_captures counts the last 7 days only`
  - `today is null when the tick hasn't started; last_ok_finished_at skips a failed row`
  - `the snapshot's text holds no name, email, street or gift title from the fixture` (`not (snapshot::text ~ 'Jordan|jordan@|Elm Street|Lego')`)
- [ ] **Step 2: Watch them fail.** `pnpm db:test`.
- [ ] **Step 3: Write it.**
- [ ] **Step 4: Watch them pass.** `pnpm supabase db reset && pnpm db:test && pnpm db:types && pnpm db:map`. Expected: all pass, and `db:map` reports no table in the strip without a lane.
- [ ] **Step 5: Commit** `feat(db): health_snapshot lists what needs the owner, ids only (ALL-35)`.

### Task 3: Out of AI credit ends the run uncounted, and the credits balance (AC-10, AC-12 vendor side)

Needs Task 1: its local-db tests use the new outcome.

**Files:**
- `apps/web/lib/ai/messages.ts` and a new `lib/ai/__tests__/messages.test.ts`.
- `apps/web/modules/concierge/ideas/{run,store}.ts` and `__tests__/idea-run.test.ts`.
- `apps/web/modules/concierge/rounds/store.ts`.
- Tests: `__tests__/idea-store.test.ts` and `__tests__/code-columns-db.test.ts` (local-db); a new local-db `__tests__/no-credit-db.test.ts` (added to `LOCAL_DB_TESTS`); `app/people/__tests__/suggest-ideas-action.test.ts`.

**Produces:**
- `AiError.kind: "unavailable" | "malformed" | "no_credit"`, with the message `"AI credit is used up"`. `call()` throws `no_credit` on HTTP 402 whatever the body, since `insufficient_funds` and `quota_for_entity_exceeded` both come as 402.
- `gatewayCredits(h: GatewayHttp, signal: AbortSignal): Promise<{ balanceCents: number }>`:
  - Calls `GET ${h.base}/v1/credits` with `Authorization: Bearer ${h.apiKey}`.
  - The reply is `{ balance: string, total_used: string }` in dollars (`gatewayCreditsResponseSchema` in `@ai-sdk/gateway` 4.0.132), validated with zod.
  - `balanceCents = Math.round(Number(balance) * 100)`. A balance that isn't a number throws `malformed`.
- Run outcomes in `ideas/store.ts`:
  - `export const RUN_ENDS = ["saved", "none", "failed", "cost_cap", "deadline", "no_credit"] as const` and `RunEnd = (typeof RUN_ENDS)[number]` (S9).
  - `IdeaOutcome` gains `{ status: "no_credit" }`.
- How `runIdeas` ends on a 402 (S1, T68):
  - `Tally.aiPaid: boolean` is set wherever an AI reply's cost is added to `t.spent`.
  - In the catch, an `AiError` of kind `no_credit` with `!t.aiPaid` finishes the run as `no_credit` and returns `{ status: "no_credit" }`.
  - A 402 after a paid AI reply ends the run as `failed`, which counts.
  - A run that already kept list gifts still saves them, as today.
- `readIdeaState` (`rounds/store.ts`): the last-run query adds `.or("outcome.is.null,outcome.neq.no_credit")`, so `ranSinceNoIdeas` ignores a `no_credit` run (B1).
- On-demand runs: no change to `app/people/actions.ts`. `suggestResult`'s `default` branch already gives `IDEA_MESSAGES.failed` (S5).

- [ ] **Step 1: Write the failing tests:**
  - `messages.test.ts`:
    - `a 402 throws AiError no_credit` (bodies `{"error":{"type":"insufficient_funds"}}` and `quota_for_entity_exceeded`)
    - `a 500 is still unavailable`
    - `gatewayCredits sends the bearer and reads "12.34" as 1234 cents`
    - `gatewayCredits throws malformed on {"balance":"n/a"}`
    - `the AiError message never holds the reply body`
  - `idea-run.test.ts`:
    - `a 402 on the brainstorm ends the run as no_credit` (FakeGateway answers the brainstorm with 402)
    - `a 402 on the ranking call after a paid brainstorm ends as failed and counts` (S1)
    - `with list gifts kept, a 402 still saves them`
    - `ideas.run logs outcome no_credit, ids only`
  - `idea-store.test.ts`: `finish saves outcome no_credit and round_idea_state still has runs left`.
  - `code-columns-db.test.ts`: `idea_runs.outcome allows exactly the run ends` (`RUN_ENDS`, with the `expectTypeOf` pin against `RunEnd`).
  - `no-credit-db.test.ts`, against the real store (B1):
    - Setup: a round at its maximum runs with a newer fact, then a `no_credit` run.
    - `roundContext` has `ideaRunsLeft` true and `ranSinceNoIdeas` false.
    - `nextAction` doesn't send `no_ideas`.
    - The same with `no_ideas` already sent: no `no_ideas_again`.
  - `suggest-ideas-action.test.ts`: `an on-demand no_credit run shows the failed message`.
- [ ] **Step 2: Watch them fail.** `pnpm test && pnpm test:db`.
- [ ] **Step 3: Make them pass.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm test:db`. Expected: all pass, and the other `idea-run.test.ts` cases are unchanged.
- [ ] **Step 5: Commit** `feat(ideas): out of AI credit ends a run as no_credit, uncounted (ALL-35)`.

### Task 4: The tick's heartbeat, job failures, and the round waits on no credit (AC-7, AC-10, AC-16)

Needs Tasks 1 and 3.

**Files:**
- New `apps/web/modules/concierge/health/heartbeat.ts`, exported from `modules/concierge/index.ts`.
- `app/api/rounds/tick/{tick,route}.ts` and `__tests__/tick.test.ts`.
- `app/api/rounds/job/{job,route}.ts` and `__tests__/job.test.ts`.
- `modules/concierge/rounds/steps.ts`, and one line in `rounds/engine.ts`.
- Tests: `modules/concierge/__tests__/round-engine-ideas.test.ts`, `round-engine-tick.test.ts`, and a new local-db `__tests__/heartbeat-db.test.ts` (added to `LOCAL_DB_TESTS`).

**Produces:**
- `type TickHeartbeat = { started(day: CalendarDate, at: Date): Promise<void>; finished(day: CalendarDate, at: Date, result: "ok" | "failed", counts: { roundsFailed: number; fanoutFailed: number }): Promise<void> }`.
- `tickHeartbeat(db: SupabaseClient<Database>): TickHeartbeat` and `addTickCounts(db, day: CalendarDate, at: Date, counts: { roundsFailed: number }): Promise<void>` call Task 1's functions. Each throws on an RPC error.
- `handleTick(request, env, run, cleanup?, heartbeat?: TickHeartbeat)`:
  - After the secret check and the clock: `heartbeat.started(dayOf(now), now)`.
  - After the run: `finished(day, now + elapsed ms, "ok", { roundsFailed: summary.failed - (summary.fanoutFailed ?? 0), fanoutFailed: summary.fanoutFailed ?? 0 })`.
  - If the run throws: `"failed"`, with zero counts.
  - A heartbeat call that throws logs `tick.heartbeat_failed {alert: true}` (`errorFields` only) and never changes the tick's response.
- `TickSummary.fanoutFailed?: number`, set to `result.failed` in `runTick`'s fan-out branch. This is the one `engine.ts` line.
- `handleJob(raw, meta, env, run, onFailed?: (message: JobMessage, now: Date) => Promise<void>)` (S3):
  - When `run` returns `"failed"`, `onFailed` is called once.
  - If it throws, that's logged as `tick.heartbeat_failed {alert: true}` and the job's result doesn't change.
  - A thrown, redelivered job isn't counted, because it's retried.
  - The route wires it to `addTickCounts(admin, dayOf(now), now, { roundsFailed: 1 })`.
- `ideaPass` (`steps.ts`): after an outcome of `no_credit`, the rest of `turns` are released without starting a run (S1).
- `afterIdeaRun` (`steps.ts`), `case "no_credit"`: `logEvent("ideas.no_credit", { round_id, user_id, alert: true })`, then `release()`. The round stays `generating`, released and due.

- [ ] **Step 1: Write the failing tests:**
  - `tick.test.ts`:
    - `AC-16: 401 with no header, a wrong or an unset secret, and the heartbeat isn't called` (extend the existing `it.each`)
    - `a run records started then finished ok with the tick's day under ?now=`
    - `fan-out send failures go to fanoutFailed, the rest to roundsFailed`
    - `a run that throws records failed`
    - `a heartbeat that throws is logged with alert and the tick still answers 200`
  - `job.test.ts`:
    - `AC-7: a failed result calls onFailed once`
    - `advanced, busy and invalid don't`
    - `an onFailed that throws is logged and the result is unchanged`
    - `a run that throws doesn't call onFailed`
  - `round-engine-tick.test.ts`: `the fan-out summary carries fanoutFailed`.
  - `round-engine-ideas.test.ts`:
    - `AC-10: a no_credit run releases the round, sends the buyer nothing and logs ideas.no_credit with alert`
    - `after a no_credit run the tick starts no other run and releases the rest`
    - `the next tick runs it again`
  - `heartbeat-db.test.ts` (real local DB):
    - `two concurrent addTickCounts both land`
    - `addTickCounts before start_tick keeps the test clock's started_at`
- [ ] **Step 2: Watch them fail.** `pnpm test && pnpm test:db`.
- [ ] **Step 3: Make them pass.**
- [ ] **Step 4: Watch them pass.** `pnpm test && pnpm test:db`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(rounds): the tick writes a heartbeat, jobs add failures, and no AI credit leaves the round waiting (ALL-35)`.

### Task 5 [P]: The report and the email (AC-1 to AC-9, AC-11, AC-12)

Needs only Task 2's snapshot shape (above). It runs alongside Tasks 3 and 4.

**Files:**
- New `apps/web/modules/concierge/health/{store,report,email}.ts`.
- `modules/concierge/notify/samples.ts` (N5).
- `lib/brand.ts`: `inboxFor` takes `"health"`.
- Tests: `modules/concierge/__tests__/health-report.test.ts`, `health-email.test.ts`, and `samples.test.ts` (its one-per-template count allows the two health samples).

**Produces:**
- `store.ts`: `type HealthSnapshot` (camelCase, with Task 2's fields) and `readSnapshot(db, now: Date): Promise<HealthSnapshot>`, validated with zod (E4).
- `report.ts`:
  - `type HealthSettings = { allClearWeekday: number; aiCreditLowCents: number; zincAppBalanceLowCents: number; ideaEngineEnabled: boolean; captureExtractionEnabled: boolean; amazonPasteLookupEnabled: boolean }`.
  - `type Vendors = { aiCreditCents: number | null; zincAppBalanceCents: number | null; aiConfigured: boolean; zincConfigured: boolean }`. Null means not checked, or the call failed.
  - `type ProblemKind = "db_down" | "tick_missed" | "no_credit" | "tick_failed" | "stuck_round" | "unconfirmed" | "placing" | "held_zinc" | "ideas_not_configured" | "credit_low" | "zinc_low" | "deadline_close"` and `type Problem = { kind: ProblemKind; ids?: {…}; detail?: Record<string, number | string>; waiting?: HealthSnapshot["ideasWaiting"] }`.
  - `healthReport(snap: HealthSnapshot | null, vendors: Vendors | null, s: HealthSettings | null, now: Date): { problems: Problem[]; weekly: HealthSnapshot["weekly"] | null; isWeekly: boolean }`. The rules:
    - **Database down:** a null `snap` means the database can't be reached. The report is one `db_down` problem and nothing else is read.
    - **Order:** `db_down`, `tick_missed`, `no_credit`, `tick_failed`, then the order of the spec's table.
    - **`tick_missed`:** `today` is null, or `today.finishedAt` is null. A row that started and never finished is a killed tick. Its detail carries `lastOkFinishedAt`. The round and order checks always run.
    - **`tick_failed`:** `today.result === "failed"`, or `today.fanoutFailed > 0`. `roundsFailed` alone isn't a problem (owner ruling b, T76); it goes in `weekly`.
    - **`no_credit`:** `noCreditRuns > 0`, or `aiCreditCents <= 0` while ideas or capture extraction are on. It carries `ideasWaiting` (owner ruling a).
    - **`credit_low`:** `0 < aiCreditCents < aiCreditLowCents`, while ideas or capture extraction are on.
    - **`zinc_low`:** `zincAppBalanceCents < zincAppBalanceLowCents`, while ideas or Amazon paste lookups are on (final review).
    - **`ideas_not_configured`:** `ideaEngineEnabled` and (`!aiConfigured` or `!zincConfigured`), or `captureExtractionEnabled` and `!aiConfigured`.
    - **`isWeekly`:** `now.getUTCDay() === allClearWeekday`.
- `email.ts`:
  - `RUNBOOK_ANCHORS: Record<ProblemKind, string>`: each kind's heading anchor under `operations.md` > Health email.
  - `buildHealthEmail(r: ReturnType<typeof healthReport>, runbookBase: string): OutgoingEmail`, sent `to: inboxFor("health")` and rendered through `renderEmail`. Each problem is one `rows` entry: its title, the ids in `detail`, and the runbook `link`.
  - Fixed copy:
    - "The database can't be reached"
    - "Today's round engine run didn't finish", with the last successful finish (UTC date and time, or "none on record")
    - "Out of AI credit: ideas are paused", with the waiting round ids
    - "The tick reported failures", with the counts
    - "Waiting on the buyer, deadline close"
    - "All clear"
  - `runbookBase` is `https://github.com/gifts-af/gift-me/blob/main/design/operations.md`.
- `samples.ts`: `health-problems` (every kind once) and `health-weekly-all-clear`, added to `sampleEmails`.

- [ ] **Step 1: Write the failing tests:**
  - `health-report.test.ts`:
    - `AC-1: four problems, each under its kind, the unconfirmed round once`
    - `AC-2: nothing actionable on a Tuesday gives no problems and isWeekly false`
    - `AC-3: the same on a Monday is weekly with counts 1 address, 1 funds`
    - `AC-4: a deadline_close round is listed`
    - `AC-5: no row for today leads with tick_missed and the last ok finish`
    - `AC-5: a row that started and never finished is tick_missed, and the round and order problems are still listed`
    - `today's row finished ok gives no tick_missed`
    - `AC-6: result failed, or fanout_failed 1, gives tick_failed with the counts`
    - `rounds_failed 2 alone gives no tick_failed and shows in weekly` (ruling b)
    - `AC-7: on a Monday, rounds_failed 2 is in weekly and no_credit_runs 1 leads with no_credit`
    - `AC-8: a null snapshot gives only db_down`
    - `AC-9: idea engine on and AI not configured gives ideas_not_configured`
    - `capture extraction on and AI not configured does too`
    - `AC-11: no_credit_runs 1, or a 0 balance, leads with no_credit (after tick_missed when both)`
    - `AC-11: while no_credit, ideas_waiting rounds are listed under it; without it they aren't` (ruling a)
    - `AC-12: 499 cents is credit_low, 500 isn't`
    - `the Zinc app balance below 500 is zinc_low`
    - `a failed vendor call (null) adds no problem`
  - `health-email.test.ts`:
    - `AC-5 and AC-11 lead lines are the first row`
    - `every row's link is runbookBase#RUNBOOK_ANCHORS[kind]`
    - `AC-3: the weekly email says All clear and lists the counts`
    - `it goes only to inboxFor("health")`
- [ ] **Step 2: Watch them fail.** `pnpm test`.
- [ ] **Step 3: Make them pass.**
- [ ] **Step 4: Watch them pass.** `pnpm test`. The samples reach `email:html` and `/dev/emails` through `sampleEmails`, and `e2e/emails.spec.ts`' phone-layout check covers them in CI.
- [ ] **Step 5: Commit** `feat(health): the owner's health report and email (ALL-35)`.

### Task 6: `/api/health` replaces the keepalive, with its runbooks (AC-1, AC-2, AC-3, AC-7, AC-8, AC-11, AC-13, AC-14, AC-15)

Needs Tasks 2–5.

**Files:**
- New: `apps/web/modules/concierge/health/run.ts` (exported), `apps/web/app/api/health/{route,health}.ts` and `__tests__/health.test.ts`, and the tests `modules/concierge/__tests__/health-run.test.ts`, `health-runbooks.test.ts` and a local-db `health-db.test.ts` (added to `LOCAL_DB_TESTS`).
- Changed: `lib/wiring.ts` (`healthWiring`), `vercel.json`, `lib/supabase/proxy.ts`, `test/public-paths.test.ts`, `README.md` line 70, and `design/operations.md`: the **Health email** and **AI credit** sections (S8).
- Deleted: `app/api/keepalive/route.ts`, `lib/keepalive.ts`, `test/keepalive.test.ts`.

**Produces:**
- `type HealthDeps = { db: SupabaseClient<Database>; now: Date; send: (e: OutgoingEmail) => Promise<SendResult>; aiCredits: ((timeoutMs: number) => Promise<number>) | null; zincBalance: ((timeoutMs: number) => Promise<number>) | null; runbookBase: string }`. A null vendor function means that vendor isn't set up here; each call gets `health_vendor_timeout_ms`.
- `runHealthCheck(deps: HealthDeps): Promise<{ result: "sent" | "quiet" | "off" | "db_down" | "send_failed" | "failed"; problems: number }>`, in order:
  1. Ping the database (`select day from concierge.tick_heartbeats limit 1`), once more if that fails. If both fail, send the `db_down` email without reading any setting.
  2. Read `health_email_enabled`. If it's 0, the result is `off` and nothing else happens.
  3. Read the settings, the snapshot and both vendor balances. A vendor call that fails logs `health.vendor_check_failed {vendor, ...errorFields}` and passes null.
  4. Send when there are problems, or when it's the weekly day.
  - It always logs `health.checked {result, problems, sent, weekly}`. A refused send logs `health.send_failed {alert: true}`.
  - A step that throws ends `failed`: it sends the fixed "The health check couldn't run" email with the stage (`settings`, `snapshot`, `vendors`) and logs it as `stage` (final review). `sendCheckFailed(deps, stage)` does the sending; `handleHealth` calls it with `wiring` when building the deps throws.
- `healthWiring(now: Date, env: Env): HealthDeps`:
  - The admin client.
  - `send` from `sendEmail`, with `RESEND_API_KEY`.
  - `aiCredits` from `gatewayCredits`, when `AI_GATEWAY_BASE` and `AI_GATEWAY_API_KEY` are both set.
  - `zincBalance` from `getWallet`, with `ZINC_API_BASE`, `ZINC_API_KEY` and `zinc_timeout_ms`, when both env vars are set.
- `handleHealth(request: Request, env: { cronSecret?: string; vercelEnv?: string }, run: (now: Date) => Promise<unknown>, tellOwner: () => Promise<boolean>): Promise<Response>`:
  - 401 without the bearer, and `run` isn't called.
  - `?now=` is honored off production only, through `isTestClock`.
  - Answers 200 or 500.
  - `route.ts`: `GET`, with `maxDuration` a literal 60.
- `vercel.json`: `{ "path": "/api/health", "schedule": "0 14 * * *" }` replaces the keepalive cron. In `isPublicPath`, `/api/health` replaces `/api/keepalive`.
- `operations.md`: a heading per `RUNBOOK_ANCHORS` entry under **Health email**, and the **AI credit** runbook (Task 8 Step 3 lists their content). They ship in the PR so the links work from the first run.

- [ ] **Step 1: Write the failing tests:**
  - `health.test.ts` (route):
    - `AC-13: 401 with no header, a wrong or an unset secret, and run isn't called`
    - `?now= is used off production and ignored on production`
  - `health-run.test.ts` (unit; a client whose queries throw):
    - `AC-8: retries once, sends the db_down email, reads no setting, and the event holds errorFields only`
    - `a failed send logs health.send_failed with alert`
    - `a vendor call that throws is logged and the rest still runs`
  - `health-runbooks.test.ts` (S8): it reads `design/operations.md`, builds GitHub-style slugs for its headings, and checks `every RUNBOOK_ANCHORS anchor is a heading in operations.md`.
  - `health-db.test.ts` (real local DB; fake `send`, fake vendors):
    - `AC-1 on a Tuesday: one email, every flagged id, the unconfirmed round once`
    - `AC-2: no email and health.checked {problems: 0, sent: false}`
    - `AC-3 on a Monday: the weekly email with All clear and the counts`
    - `AC-7: on a Monday, two addTickCounts failures show in the weekly counts and a no_credit idea_runs row leads with Out of AI credit`
    - `AC-11: a generating round with no ideas within hold_final_days is listed under Out of AI credit`
    - `AC-14: health_email_enabled 0: the ping runs, send isn't called, result off`
    - `AC-15` (S6):
      - Seed a real fixture: user "Jordan Rivera" (jordan.rivera@example.com), a person at 12 Elm Street, the list gift and idea "Lego Castle".
      - That user owns every flagged item.
      - Run `runHealthCheck`.
      - None of those strings is in the sent `subject`, `html` or `text`, or in any logged `health.*` event.
  - `public-paths.test.ts`: `/api/health` is public and `/api/keepalive` isn't.
- [ ] **Step 2: Watch them fail.** `pnpm test && pnpm test:db`.
- [ ] **Step 3: Make them pass.** Write the two `operations.md` sections and delete the keepalive files.
- [ ] **Step 4: Watch them pass.** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build`. Expected: all pass, with no reference to `/api/keepalive` left in the app (`git grep -n "api/keepalive" -- apps`).
- [ ] **Step 5: Commit** `feat(health): daily health job at /api/health replaces the keepalive (ALL-35)`.

### Task 7: Gallery, PR and live check (E9)

**Files:** none in the repo beyond what `pnpm gallery` writes, which isn't committed.

- [ ] **Step 1:** Run `pnpm gallery` with the local Supabase running. Check `email-health-problems` and `email-health-weekly-all-clear` by eye, then republish the screens and emails page (CLAUDE.md > Updating the screens and emails page).
- [ ] **Step 2:** Run the full pre-PR list (Global constraints). Open the PR `feat: owner health email and no-credit idea runs (ALL-35)` with `Part of ALL-35`, answering E9: it's seen working through `health.checked` and the Monday email, and it's turned off with `health_email_enabled = 0` (the keepalive query still runs).
- [ ] **Step 3: After merge:**
  - Confirm CI's `migrate` job applied the migration on dev and prod.
  - Publish the database map (CLAUDE.md > The database map page).
  - In Vercel, check the cron list shows `/api/health` at 14:00 and no keepalive.
  - The next day: `health.checked` in the logs and a `tick_heartbeats` row for the day.
  - On the first Monday: the weekly email in the owner inbox.
  - Post the evidence on ALL-35.

### Task 8: Docs and decisions

**Files:** `design/decisions.md`, `design/technical-design.md`, `design/operations.md`, and the round engine page.

- [ ] **Step 1: `design/decisions.md` T87.** It revises T22, T24 and T68, and each of those rows gets a "revised by T87" note (S7). T76 stands (owner ruling b), and T49's 12:00 tick is unchanged. It records:
  - The keepalive cron becomes `/api/health` at 14:00 UTC, so there's no new scheduled job (E1; T22).
  - The `tick_heartbeats` table, and why "started" alone misses a tick that fails every day.
  - The tick-missed rule: no row for today, or one that never finished.
  - Jobs add their failures to the heartbeat. A thrown, redelivered job isn't counted, because it's retried.
  - Round failures go in the weekly counts only (T76).
  - Out of credit is `no_credit`: uncounted only when no AI reply in the run was paid for; otherwise the run fails and counts (T68). The tick then starts no further run, and the buyer gets no email.
  - While credit is out, rounds waiting on ideas near their deadline are listed for the owner.
  - Problems come from the database and vendor balances, not logs (Hobby keeps logs about an hour).
  - The AI spend cap is Vercel's $100 team budget with alerts at 50/75/100% (T24, §7). Auto top-up is off for now, so the owner tops up by hand when the health email warns (below `ai_credit_low_cents`, $5) or says ideas are paused.
  - Who decided: the owner (2026-11-23) for the budget, top-up, warning level and the two plan-review rulings; Claude's call for the rest.
- [ ] **Step 2: `design/technical-design.md`:**
  - §5.1: the heartbeat, `no_credit` and the round waiting.
  - §7: the cap is the Vercel budget, $100, alerts at 50/75/100%.
  - §9 Monitoring: the health email replaces "listing rounds in `needs_attention`".
  - §10: the cap figure.
  - The risk row about Supabase pausing points at `/api/health`.
- [ ] **Step 3: `design/operations.md`:**
  - Check that the Health email and AI credit sections written in Task 6 have one runbook per line: database unreachable, tick missed, tick failed, stuck rounds, unconfirmed orders, orders stuck placing, held for a Zinc problem, ideas can't run here, AI credit, Zinc app balance, waiting on the buyer.
  - The AI credit runbook: top up by hand in the AI Gateway dashboard (auto top-up is off), or raise the Vercel budget at 100%. Meanwhile a `no_credit` round waits, and rounds near their deadline are listed.
  - Add `ideas.no_credit`, `tick.heartbeat_failed` and `health.send_failed` to Alerts.
  - Add the note that log-only alerts still need Vercel logs, kept about an hour on Hobby (ALL-135).
  - The keepalive mentions (the close-route paragraph, the T22 pointer) now say `/api/health`.
- [ ] **Step 4:** Update the round engine page (CLAUDE.md > Updating the round engine page): the heartbeat, the `no_credit` wait, and the pass stopping. The database map and the screens and emails page were done in Tasks 2 and 7.
- [ ] **Step 5: Commit** straight to `main` after the PR merges: `docs: health email, AI credit and heartbeat (ALL-35)`.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test:

| Criterion | Tasks |
|---|---|
| AC-1 | 2, 5, 6 |
| AC-2, AC-3, AC-4 | 2, 5, 6 |
| AC-5, AC-6 | 2, 5 |
| AC-7 | 2, 4, 5, 6 |
| AC-8 | 5, 6 |
| AC-9 | 5 |
| AC-10 | 1, 3, 4 |
| AC-11 | 2, 5, 6 |
| AC-12 | 3, 5 |
| AC-13 | 6 |
| AC-14 | 6 |
| AC-15 | 2, 6 |
| AC-16 | 4 |

- [x] Every task traces back to a story or criterion (nothing extra).
- [x] Where each plan-review finding is fixed:
  - **B1:** Tasks 1 and 3: the lateral filter, `readIdeaState`, and the extra-run tests.
  - **S1:** Tasks 3 and 4: `aiPaid`, and the pass stopping.
  - **S2:** Tasks 1, 2 and 4: no heartbeat column; `no_credit_runs` is read from `idea_runs`.
  - **S3:** Task 4: `handleJob`'s `onFailed`, tested in `job.test.ts`.
  - **S4:** the order above. Only Task 5 is **[P]**.
  - **S5:** the ALL-149 note; Task 3 doesn't touch `actions.ts`.
  - **S6:** Task 6: AC-15 in `health-db.test.ts`.
  - **S7:** Task 8: T87 revises T22, T24 and T68.
  - **S8:** Task 6: the runbooks ship in the PR, and an anchor test checks them.
  - **S9:** Task 3: `RUN_ENDS` and the code-columns test.
  - **N1:** Task 2's SQL comment. **N2:** Task 1's grant. **N3:** `add_tick_counts`' `p_at`. **N4:** `start_tick` resets the counts. **N5:** `sampleEmails`.
- [x] No open questions are left: owner rulings (a) and (b), 2026-11-23.
- [x] Adversarial review of the spec, the plan, each task, and the whole branch (final review and its fix wave re-reviewed), 2026-11-23.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of both health emails from `pnpm gallery`, uploaded into the ticket comment.
- [ ] Live check after deploy: the cron list in Vercel, a `health.checked` event and a `tick_heartbeats` row on prod, the first weekly email. Otherwise listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

The riskiest things to check in review, each with the test that covers it:

1. **A `no_credit` run still sends a false "no ideas".** Three places read the last run. Task 1: `a no_credit run after a new fact leaves the extra run available` and `runs_after_rejection's extra-run branch ignores a newer no_credit run`. Task 3: the `no-credit-db.test.ts` checks for `no_ideas` and `no_ideas_again`.
2. **Out of credit keeps spending.** A paid run that ends on a 402 must count, and the pass must stop. Task 3: `a 402 on the ranking call after a paid brainstorm ends as failed and counts`. Task 4: `after a no_credit run the tick starts no other run and releases the rest`.
3. **Finished rounds read as stuck or waiting.** `closed_at` stays null on a `skipped` round. Task 2: `a skipped round with closed_at null is not open`.
4. **Personal data in the owner's inbox or logs.** Task 6's real-fixture `AC-15` and its `AC-8` event check; Task 2's snapshot-text check.
5. **The heartbeat breaks the tick or a job.** A failed write must never change the result. Task 4: `a heartbeat that throws is logged with alert and the tick still answers 200`, and `an onFailed that throws is logged and the result is unchanged`.
