# ALL-35 Owner health email, AI spend alerts, monitoring: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the owner gets an email on any day something needs them (the tick didn't run or failed, the database is down, a round is stuck, an order can't be confirmed, AI credit is out or low, ideas can't run), a weekly summary with an "all clear" line, and running out of AI credit no longer burns buyers' idea runs.

**Links:** [ALL-35](https://linear.app/allens-forever/issue/ALL-35), design Â§5.1, Â§7 (cost control), Â§9 (monitoring), `design/operations.md` > Alerts, T22 (keepalive), T24 (Gateway cap), T75 (AI spend approved by the owner), ALL-28 AC-12 (`round_stuck`), ALL-32 (unconfirmed and held orders).

## Spec: what it does

### Who it's for and what they can do

1. **Daily problems email:** as the owner, on a day something needs *me*, I get one email listing each problem with what to do; on other days I get nothing.
2. **Missed or failed tick:** as the owner, I'm told when the daily round engine hasn't finished successfully in 26 hours, or reported failures today, even though the round engine itself can't tell me.
3. **Out of AI credit:** as a buyer, when the app runs out of AI credit my round just waits; it doesn't use up my idea runs or tell me "no ideas". As the owner, I'm told at once.
4. **Weekly summary:** as the owner, every Monday I get a short summary: counts of rounds waiting on buyers, failed captures this week, and "all clear" if nothing needs me, so silence never hides a dead checker.

AI spend alerts come from Vercel, not the app: a monthly **$100 team budget** on AI Gateway with emails at 50%, 75% and 100% to the team owner (allensforever711), and requests refused at 100% (owner, 2026-11-23). Auto top-up is on, so a low prepaid balance doesn't stop ideas while the budget still caps the month (owner, 2026-11-23).

### What gets checked

Each check reads the database or a vendor directly. None of them reads Vercel logs: on Hobby those are kept for about an hour.

**Daily (only things the owner can act on).** "Open" means `gift_rounds.closed_at is null`.

| Check | Source | Flagged when | Runbook |
|---|---|---|---|
| Database unreachable | the job's first query, retried once | both tries fail | Supabase paused or down |
| Tick missed | tick heartbeat row | no successful finish in `health_tick_max_hours` (26) | Cron, deploy, `CRON_SECRET` |
| Tick failed | tick heartbeat row | today's tick finished with `result = 'failed'`, or `failed` counts (rounds or fan-out sends) above 0 | Round engine on/off; Round fan-out |
| Tick not finished yet | tick heartbeat row | today's tick started but hasn't finished; the email says so and skips the round and order checks rather than read half-done rounds | none: next day |
| Stuck rounds | `gift_rounds.attempts` | open and `attempts >= round_max_attempts` (the same rule as the `round_stuck` event) | Round engine |
| Unconfirmed orders | `orders.status = 'unconfirmed'` | any | Unconfirmed orders |
| Orders stuck placing | `orders.status = 'placing'` | created before today's tick started and older than `placing_stale_minutes`: the sweep already looked and couldn't settle it | Unconfirmed orders |
| Orders held for a Zinc problem | `orders.status = 'held'` | `hold_reason` in (`retry`, `not_allowed`) | Zinc wallet ordering |
| Ideas can't run here | `idea_engine_enabled` or `capture_extraction_enabled` = 1 and the AI Gateway (or, for ideas, Zinc) env vars missing | always | Gift idea engine |
| Out of AI credit | idea runs refused with `no_credit` since yesterday's check (a new `ideas_no_credit` count on the heartbeat), or AI Gateway `/v1/credits` balance at 0 | any | AI credit |
| AI credit low | AI Gateway `/v1/credits` balance | below `ai_credit_low_cents` (200) | AI credit |
| App's Zinc balance low | Zinc `/wallet/me` with the app key (T17) | below `zinc_app_balance_low_cents` (500) | Zinc wallet ordering |
| Buyer-waiting round near its deadline | open rounds in `needs_address`, or `needs_attention` with `attention_reason` in (`funds`, `setup`, `address`) | within `hold_final_days` of `ship_by_deadline` | none: the buyer has been told; the owner may step in |

`needs_attention` rounds whose reason is `unconfirmed` appear once, under Unconfirmed orders. Held orders with `hold_reason = 'paused'` are the owner's own switch (`zinc_ordering_enabled` = 0) and aren't listed. Funds, setup and address holds are the buyer's to fix and appear only near the deadline or in the weekly counts.

**Weekly (on `health_all_clear_weekday`, Monday), always sent:** counts of open rounds waiting on the buyer (address, funds, setup, approval), rounds that ended this week with `no_ideas`, failed captures in the last 7 days, and either "All clear" or the daily problems above.

Every line carries ids only (round, order, user) and a link to its runbook section in `design/operations.md`. No names, emails, addresses or gift titles (E6, T42).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A round stuck at `attempts` = `round_max_attempts`, an `unconfirmed` order, a `placing` order from before today's tick, a `held` order with `hold_reason = 'retry'` | The health job runs on a Tuesday | One email lists each under its own heading with its id and runbook link; the unconfirmed order's round isn't listed a second time |
| AC-2 | Nothing the owner can act on; a `needs_address` round 20 days from its deadline; a `held` funds order | The health job runs on a Tuesday | No email; `health.checked {problems: 0, sent: false}` is logged |
| AC-3 | The same, on a Monday | The health job runs | The weekly email: "All clear", plus counts (1 waiting on an address, 1 waiting on funds) |
| AC-4 | A `needs_address` round within `hold_final_days` of its ship-by deadline | The health job runs on a Tuesday | It's listed under "Waiting on the buyer, deadline close" |
| AC-5 | The heartbeat's last successful finish is 27 hours old | The health job runs | The email leads with "The daily round engine hasn't run successfully since â€¦" |
| AC-6 | Today's tick finished with `failed` counts above 0 | The health job runs | The email says the tick reported failures, with the counts |
| AC-7 | Today's tick has started and not finished | The health job runs | The email says the tick is still running and skips the round and order checks |
| AC-8 | The database can't be reached (a client whose queries throw) | The health job runs | It retries once, then sends "The database can't be reached", reading no settings; the email holds no error message, only `errorFields` |
| AC-9 | `idea_engine_enabled` = 1 and `AI_GATEWAY_API_KEY` unset | The health job runs | The email says ideas can't run on this environment |
| AC-10 | The AI Gateway answers an idea run's call with 402 (`insufficient_funds` or `quota_for_entity_exceeded`) | A round's idea run happens on the tick | The run isn't counted against the round's runs, no email goes to the buyer, the round keeps its status and waits for a later tick, and `ideas.no_credit {alert: true}` is logged; the tick's heartbeat counts it |
| AC-11 | Yesterday's tick refused a run with `no_credit`, or the credits balance is 0 | The health job runs | The email leads with "Out of AI credit: ideas are paused" |
| AC-12 | AI credit balance below `ai_credit_low_cents` | The health job runs | The email says AI credit is low |
| AC-13 | The health route is called without the cron secret | â€” | 401, nothing read or sent, no heartbeat touched |
| AC-14 | `health_email_enabled` = 0 | The health job runs | It still does the keepalive query, sends nothing, logs `health.checked {result: "off"}` |
| AC-15 | A fixture user with a name, email, street address and gift titles owns every flagged item | The email renders | None of those strings appear in its HTML or text; it goes only to the owner inbox through `renderEmail` |
| AC-16 | The tick route is called without the cron secret | â€” | The heartbeat isn't written |

### Out of scope

- Persisting log-only alerts (bad queue signatures, unmatched Zinc webhooks, email-send failures) to the database. Those still need Vercel logs; operations.md says so. A log drain needs Vercel Pro (ALL-135).
- A dashboard page. Vercel's AI Gateway dashboard covers spend.
- Buyers' own Zinc balances. The buyer is already emailed about a funds hold (ALL-32).
- Capture extraction on a 402: it already fails visibly to the buyer, who can retry; the credit checks above cover the cause.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| AI spend cap and alerts | Vercel AI Gateway team budget: $100 a month, alerts at 50/75/100%, refuses at 100% | Already set; revises Â§7's $60 and 50/80% (owner, 2026-11-23) |
| Auto top-up | On, small amounts | A low prepaid balance shouldn't stop ideas; the budget caps the month (owner, 2026-11-23) |
| Out of credit during an idea run | A new `AiError` kind `no_credit` for 402; the run is uncounted, like `ideas.not_configured`; no buyer email | Our outage must not burn buyers' runs or send a false "no ideas" (Â§5.1, customers always informed) **[Claude's call]** |
| Where problems come from | Database state and vendor balances, not logs | Hobby keeps runtime logs about an hour; drains need Pro **[Claude's call]** |
| Scheduled job | No new cron: the keepalive cron becomes the health job (`/api/health`), moved to 14:00 UTC; its first query is the keepalive (T22) | E1: no new scheduled job; 14:00 clears the tick's anywhere-in-the-hour start and 300 s run on Hobby (T87) **[Claude's call]** |
| Tick heartbeat | A one-row-per-tick table `concierge.tick_heartbeats` (service role only): `day`, `started_at`, `finished_at`, `result`, `rounds_failed`, `fanout_failed`, `ideas_no_credit`; written only after the secret check | "Started" alone misses a tick that fails every day (T87) **[Claude's call]** |
| Daily vs weekly | Daily: only owner-actionable items, plus buyer-waiting rounds near their deadline; weekly on Monday: counts and "All clear" | E8: a daily email about buyer-owned waits becomes noise **[Claude's call]** |
| Who receives it | The owner inbox (`inboxFor("health")`) | One place the owner already reads |

## Principles check

- **Simplest version?** One route (the keepalive's replacement), one module of read-only checks, one email template, one small table. Cut: app-side spend tracking (Vercel does it), an alerts table, a dashboard, per-buyer balances.
- **Hard-coded values?** New settings: `health_email_enabled` (1), `health_tick_max_hours` (26), `health_all_clear_weekday` (1, Monday), `ai_credit_low_cents` (200), `zinc_app_balance_low_cents` (500). Reused: `round_max_attempts`, `placing_stale_minutes`, `hold_final_days`. The cron time is in `vercel.json`. The $100 budget lives in Vercel only.
- **Product boundaries?** Concierge module only.
- **New personal data?** None. The heartbeat holds counts and times; the email holds ids and counts.
- **Docs and decisions:** T87 in `design/decisions.md`; design Â§5.1 (heartbeat, `no_credit`), Â§7 (cap is the Vercel budget, $100, 50/75/100%), Â§9 (monitoring), Â§10 (cap figure); operations.md (Health email section with a runbook per line, AI credit runbook, `ideas.no_credit` in Alerts, log retention note, keepalive replaced); the round engine page; the database map (`pnpm db:map`, publish after merge); the screens and emails page (new email).

## Plan

(written next)
