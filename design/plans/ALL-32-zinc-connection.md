# ALL-32 Zinc connection, funding and auto top-up, with ALL-30 purchase: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a paid-features user connects their own Zinc account from Settings and funds it once. From then on an approved gift is bought from their Zinc balance, never over its cap, never twice. When the money isn't there, the gift waits, the user is told exactly what's missing, and it's bought by itself once the balance covers it.

**Links:** [ALL-32](https://linear.app/allens-forever/issue/ALL-32) (W4-4) · [ALL-30](https://linear.app/allens-forever/issue/ALL-30) (W4-2, built in the same branch) · design §4.2 (budget), §5 (statuses), §6.5 (purchase), §6.5a (funding), §6.6 (webhooks) · [checkout spike](../spikes/checkout.md) · decisions T16, T17, T18, T23, T26, T42, T47, T49, T51, T54, T55, **T56**, planning 53 · mock-ups: [Settings](../mockups/ALL-32-settings.html), [emails](../mockups/ALL-32-emails.html)

## Spec: what it does

### Why

Rounds can find ideas and ask for a yes, but nothing can buy yet. Each user pays from their own Zinc wallet (T16 stage 1), so before anything is bought they connect Zinc and put money in it. Running out of money is the most likely failure, so the app warns ahead, and when a gift is short it waits and finishes by itself instead of failing.

ALL-30 (placing the order) is built here too (owner, 2026-11-06): without it, the "held, then goes through after funding" path can't be built or tested.

### Who it's for and what they can do

1. **Connect Zinc:** as a paid-features user, I tap Connect Zinc in Settings, click Allow at Zinc, add my phone, and I'm set up, with no key to copy.
2. **See my balance:** as a connected user, Settings shows my Zinc balance, whether auto top-up is on, and how much is due in the next 3 weeks.
3. **Set up auto top-up:** as a connected user, Settings walks me through adding a card and turning on auto top-up in Zinc, with suggested amounts.
4. **Disconnect:** as a connected user, I can disconnect Zinc, and the app forgets my key.
5. **Approved gifts get bought (ALL-30):** as a buyer who approved a gift, it's ordered from my Zinc balance with a price cap of its estimated total plus a small margin, never over budget, and a retry never buys twice.
6. **Warned early:** as a buyer whose balance won't cover what's coming, the heads-up email tells me before anything is held.
7. **Held, then bought by itself:** as a buyer whose balance or setup can't cover an approved gift, I'm emailed exactly what's missing, again whenever it changes, and the gift is bought without my coming back once it's covered.
8. **Change my mind while held:** as a buyer with a held gift, one tap in the email cancels it.
9. **Not for everyone yet (decision 53):** as a user without paid features, I see why buying isn't available, and nothing is ever ordered for me.
10. **Owner safety (E7):** as the owner, one setting stops all ordering on any environment, and the key never appears in logs or the browser.

### Mock-ups (approved by the owner, 2026-11-06)

- **Settings, "Paying for gifts"** ([`mockups/ALL-32-settings.html`](../mockups/ALL-32-settings.html)): four states, one shown at a time. (1) No paid features: a muted line. (2) Not connected: two lines of explanation, the alpha money notice, **Connect Zinc**. (3) Waiting for Allow: three steps, the code, **Open Zinc**, a two-line status ("Waiting for you to click Allow…" / "Code expires in 14 min", tabular figures so it doesn't jump), Cancel. (4) Connected: balance, auto top-up pill, 3-week look-ahead line, the auto top-up guide with **Open Zinc wallet**, the phone field, Disconnect.
- **Emails** ([`mockups/ALL-32-emails.html`](../mockups/ALL-32-emails.html)): (1) the heads-up gains a warning box plus a plain "Top up your Zinc balance" link; (2) "gift on hold: not enough funds"; (3) "gift on hold: finish setting up payment". All use today's email shell (logo, text, one teal button); the owner chose it over a stronger brand band. Hold emails also carry the alpha money notice and a plain "Cancel this gift" link (added after review; the mock-up shows "open it", the build uses the cancel link).
- **UI rule (owner):** no short leftover wraps. Centred or changing text is split into whole lines on purpose, and changing numbers use tabular figures. Goes into `design/ui.md`.

### Acceptance criteria

**Connect and disconnect (ALL-32)**

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A user without paid features | They open Settings, or call any Zinc action directly | State 1 is shown; every Zinc server action refuses; no call reaches Zinc |
| AC-2 | A paid-features user, not connected | They tap Connect Zinc | The server calls `POST /device/code` and stores the `device_code` with its expiry in a server-only row tied to the user (no grants to `authenticated`). The page shows the user code and an **Open Zinc** link to `verification_uri_complete` |
| AC-3 | Waiting for Allow | The user clicks Allow at Zinc | A poll (server action, paid features re-checked) calls `POST /device/token`. Polls first claim the attempt (`zinc_claim_poll`), so only one tab calls Zinc at a time and none sees an error. The key and the webhook secret go to Supabase Vault; our webhook URL with a fresh opaque per-account id is registered on the account (stored on `concierge.accounts`; it only routes the request, the HMAC is the real check); `zinc_connected_at` is set. The page moves to state 4 |
| AC-4 | Waiting for Allow | The code expires, Zinc denies, or the user taps Cancel | The page returns to state 2 with a short reason; the pending row is deleted; nothing else is stored |
| AC-5 | A connected user with no order in `placing` (checked under the round row locks, B2) | They tap Disconnect and confirm (the confirm says how many gifts are on the way and that their tracking stops) | Our webhook endpoint is cleared at Zinc **[Verify]** the call, the Vault secrets are deleted, the Zinc columns and webhook id are cleared, and the page says to revoke the key in Zinc too. Held orders stay held, now with reason `setup`. While any order is `placing` (it settles within hours), Disconnect is refused with a line saying why |
| AC-6 | Any path above | Logs, errors, client bundles and server-action results are inspected | The Zinc key, webhook secret and `device_code` never appear (the webhook id is in the URL, so it's treated as a routing id, not a secret) (a test scans log output and action results). Vault is read only through a `security definer` function granted to `service_role` |
| AC-7 | A user account is deleted | The cascade runs | Their Vault secrets are deleted too (not orphaned) |
| AC-8 | A connected user | They save their phone in Settings | It's written by a server action to `concierge.accounts.buyer_phone` (users can't update that column directly). Setup is finished when connected **and** a phone is saved |

**Balance and look-ahead (ALL-32)**

| # | Given | When | Then |
|---|---|---|---|
| AC-9 | A connected user | They open Settings | The balance comes from `GET /wallet/me` (`spendable_balance`) and shows with the auto top-up state (from `/wallet/me` if it reports it **[Verify]**; otherwise from the last auto top-up webhook, and "Not known yet" until one arrives) and the next-3-weeks total. Reading the page never places an order. If Zinc is unreachable, the section still renders and says the balance couldn't be loaded |
| AC-10 | Rounds approved, held or due in the next `funding_lookahead_days` (21) | The look-ahead total is computed | Approved or held rounds count at their orders' caps + fees; every other round counts at its budget + fee; rounds with no budget aren't counted and the line says "at least". A pure function in `packages/core`, tested with fixed numbers |
| AC-11 | A heads-up email is sent | The look-ahead total is more than the balance and auto top-up isn't known to be on | The email carries the warning box and the "Top up your Zinc balance" link. Otherwise it's unchanged. A Zinc error leaves the warning out rather than blocking the email |
| AC-12 | The auto top-up guide | It's shown | The suggested minimum is the user's largest per-order cap + fee (from their largest budget), and the top-up amount is `funding_topup_suggest_cents` (10000); both computed, not written in copy |

**Webhooks (ALL-32)**

| # | Given | When | Then |
|---|---|---|---|
| AC-13 | A POST to `/api/zinc/webhook/<token>` | It arrives | The body is validated against a schema (E4), the account is found by its webhook id, and the signature is checked with HMAC-SHA256 of the raw body against **that account's** secret. A wrong signature, unknown id or another user's secret gets 401 and changes nothing. Order lookups are filtered to that account's user, so a user can't forge events for someone else's order |
| AC-14 | Any event delivered twice or out of order | Both are handled | No dedupe table (revises §5's "dedupe on event + order"): order status only moves forward, and `placed`/`failed` are accepted only for an order in `placing`; wallet handlers are safe to run again. **Webhooks write only the order row.** If the round's status needs to change, the handler takes the round lease; if it's busy, it sets `next_action_at = now` so the tick finishes it, and the placer never overwrites a newer order state. Orders are matched by our own id sent to Zinc **[Verify]** the field (client reference or metadata), falling back to `idempotency_key`, never only by `provider_order_id`, which may not be saved yet after a crash |

**Purchase (ALL-30)**

| # | Given | When | Then |
|---|---|---|---|
| AC-15 | Any order | Its cap is computed | `max_price_cents = min(maxPriceCents(...) from packages/core, floor(est_total × (1 + order_price_margin_pct / 100)) − fee)`, with `order_price_margin_pct` = 10 in settings. The wallet must hold cap + fee. `held` orders count as committed spend in `committedSpendCents`. Tested in `packages/core` with fixed numbers. A price above the cap but within budget stops and asks (AC-19; owner) |
| AC-16 | A round in `awaiting_approval` | `approveAndBuy({ roundId, ideaIds, giftMessage?, overBudgetConfirmed? })` is called (what ALL-29's screen will call) | It takes the round's lease (a claim that ignores `next_action_at`), re-checks paid features, and writes one `orders` row per idea with everything needed to buy later: `funding_mode = 'zinc_wallet'`, the cap (AC-15), `fee_cents` from settings, ship-to and the address snapshot (D38), gift message. Then it tries to place them (AC-18 to AC-20) |
| AC-17 | `zinc_ordering_enabled` = 0 (E7's "setting that stops all ordering"; 0 on production until the owner's live test) | Any path reaches the moment of placing | It stops just before the POST: orders stay `held`, the round goes to `needs_attention` with reason `paused`, no user email is sent, and an `order.paused` event is logged. Switching it to 1 lets the next tick place them. Replaces ALL-30's "DRY_RUN" |
| AC-18 | Placing | The orders are sent | The placer locks the round row (`FOR UPDATE`), re-checks it (AC-21's conditions), flips each order `held → placing` and the round to `ordered`, and commits **before** the POST. Skip, cancel and expiry take the same row lock and cancel only `held` orders, so nothing can be cancelled after it's been sent (pgTAP test for the interleaving). Each POST carries the order's `idempotency_key`; after a synchronous 4xx (nothing created at Zinc) the order gets a fresh key before any retry, so a cached 402 can't block it forever. An order left in `placing` by a crash is looked up at Zinc by our reference before any resend. **[Verify]** how long Zinc keeps a key and that a replay returns the same order, before relying on it. The `orders_one_live_per_idea` index (with `held` counting as live) stops a second row. A double tap, tick retry or crash mid-step never places twice |
| AC-19 | The price at checkout is above the cap | Zinc fails the order with `max_price_exceeded` | Nothing is bought; the round goes to `needs_attention` with reason `price_up` (A-4) |
| AC-20 | Before placing | Setup isn't finished; or auto top-up is **known to be off** and the balance is below the sum of the round's orders' caps + fees; or Zinc answers 402 `insufficient_funds` | Nothing more is placed. When auto top-up is on or unknown, there's no pre-check: the order is sent so Zinc can charge the card, and a 402 is handled here. The orders are `held`; the round goes to `needs_attention` with reason `funds` or `setup`; the hold email is sent, showing the amount still missing (caps + fees − balance). With several picks, all are held until all are covered (owner). If one order of several was already placed and the next gets a 402 (auto top-up on, card declined), the rest are held and the email says one is on its way and the other is waiting (owner) |
| AC-21 | A held round | The daily tick, `wallet.auto_topup.succeeded`, or finishing setup re-checks it | It takes the round's lease and places only if the round is still `needs_attention` with a hold reason, the person isn't deleted, the occasion is still on, the deadline hasn't passed and paid features are still on. Each cap is `min(saved, recomputed)`. When `ship_to` is the recipient, it ships to the person's current address (or `public.shared_address_for_person` for a linked person) if it passes `isShippableAddress`, re-taking the snapshot at placement; if it's missing or fails the check (the buyer removed it), nothing is placed and the round waits with reason `fix_address` (ALL-30 note from ALL-81). For the buyer's own or another address, the saved snapshot is used (D38). The round moves to `ordered`. Only users with held orders are checked; none means no wallet calls. On the tick, held rounds are retried before any expiry, earliest deadline first |
| AC-22 | A held round, still short | A re-check sees the balance went up since the last hold email | A fresh "you're still $X short" email goes out with the new amount, at most once a day (partial top-ups never leave it stuck), keyed `hold:<n>:short:<date>` in `round_sends`, with the balance last emailed kept in `gift_rounds.hold_balance_cents` (owner) |
| AC-23 | A held round | Days pass | Hold emails go on the hold date, then at deadline − 7 and deadline − 2 if still ahead. Keys in `round_sends` include the hold number (`hold:<n>:notice`, `hold:<n>:reminder`, `hold:<n>:final`, with `gift_rounds.hold_count`), so a second hold in the same round is still emailed. Core `nextAction` gains a branch for hold reasons: `next_action_at` is the next tick (tomorrow), so `claim_due_rounds` picks held rounds up daily, earliest deadline first. At the deadline, held orders become `cancelled` (`failure_type = 'held_expired'`), the round is skipped with the skipped email, and nothing is bought. If the hold reason is `paused` (our switch, not the user), the email instead says we couldn't send it in time, that it's on us, and nothing was charged (owner) |
| AC-24 | A held gift | The buyer taps "Cancel this gift" (a signed one-time link on `action_links`, action `cancel_held_gift`, with the usual confirm POST) | Under the round row lock, the held orders are cancelled. If no order in the round got past `held`, the round is skipped; if one did, the round goes to `ordered` (never `skipped` while a gift is on its way, T27) |
| AC-25 | A person or occasion is deleted or switched off while orders are held | `skip_open_rounds` or the deadline skip runs | Same rule as AC-24, in the same SQL and under the same lock, so a later top-up can't buy them |
| AC-26 | Order webhooks | `order.placed` / `order.failed` arrive | The price breakdown, `provider_order_id` and status are saved. `order.failed` maps `error_type` to a reason stored in `gift_rounds.attention_reason` (`price_up`, `out_of_stock`, `fix_address`, …; holds use `funds`, `setup`, `paused`). `invalid_shipping_address` keeps the approval: reason `fix_address`, and saving a valid address re-places the same pick (not `needs_address`, which would discard the approval and regenerate). Shipping and delivery events are ALL-33 |
| AC-28 | An order for a list pick (`gift_ideas.source = 'list'`) | It's approved | The item is claimed on the list at approval, and released if the gift is cancelled or expires, through new functions exported from the lists module's `index.ts` (T19: the concierge never writes list tables), so friends don't double up (ALL-30 note from ALL-44; owner) |
| AC-27 | Real money | Sandbox on dev, then one real order on the owner's account | A shortfall with auto top-up on is covered and the order goes ahead (ALL-32 criterion 4, ALL-30 criterion 4; the owner does the live one) |

### Out of scope

- **The approval screen** and showing the balance on it: ALL-29 (Jim). It calls `approveAndBuy` and `getZincWallet()` from the concierge's `index.ts`. Jim is told.
- **Tracking, delivery, late risk:** ALL-33 (`order.shipped`, `.tracking_received`, `.delivered`, …). This ticket only saves `placed` and `failed`.
- **Stage 2 funding** (the user's card in our app, Zinc Connect): later ticket.
- **The next-best idea in one tap** after a failure (D29): ALL-29's screen; this ticket sets the reason.
- **Email branding beyond today's shell**, including a seasonal logo URL (cut after review: outside both tickets).

### Open questions

None for the owner. Facts to check while building are marked **[Verify]**, including whether Zinc's reported total already includes its fee, so `committedSpendCents` doesn't count it twice (ALL-30 note from the ALL-19 review).

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Is connecting Zinc behind the paid-features flag? | **Yes.** Connect, the balance, and every order check `concierge.has_paid_features` | Owner, 2026-11-06; decision 53 |
| Build feature-flag tooling now? | **No.** One entitlement check (`has_paid_features`) and `app_settings` switches (E7: those rows are the feature flags) | Owner asked about one-way doors; the single check is the only one that matters |
| Split the look-ahead and the hold into a follow-up? | **No.** All of ALL-32, plus ALL-30 in the same branch, using subagents | Owner, 2026-11-06 |
| When funds arrive, does the user have to come back? | **No.** The app buys it; adding funds means they want to go ahead. A cancel link covers a change of mind | Owner, 2026-11-06. Keeps T18's "approval means buy now": the approval stands, only the money was missing |
| Several picks, balance covers some | **Hold all** until all are covered | Owner: buying one would be us choosing which gift they wanted |
| Partial top-up | A fresh email with the new shortfall on the next re-check, at most daily, plus the scheduled reminders; skipped at the deadline | Owner: it must never get stuck |
| Order cap | **Estimated total plus a margin** (`order_price_margin_pct`, 10), never above the budget rule. **Revises §4.2**, where the cap was the whole approved ceiling | Owner, 2026-11-06. Zinc holds cap + fee in the wallet, so a budget-sized cap made "short" far more likely ($101 held for a $42 gift) |
| How often is a held round re-checked? | **[Claude's call]** The daily tick, `wallet.auto_topup.succeeded`, and finishing setup. Not on page views | Vercel Hobby cron is daily (T49, E1: no new scheduler). The final reminder is 2 days out, so a day's wait is safe. If Zinc has a "funds added" webhook **[Verify]**, it re-checks too |
| Hold model | **[Claude's call]** Orders are written at approval; a held one has new order status `held` (live for the one-per-idea index). The round is `needs_attention` with `gift_rounds.attention_reason` | Everything to buy later lives on the order; no new round status |
| Stopping all orders | **[Claude's call]** One switch, `zinc_ordering_enabled`, checked at the moment of placing; replaces ALL-30's DRY_RUN | E7. A dry run that marked rounds `ordered` with nothing bought would tell the user a gift was on its way |
| Test mode | **[Claude's call]** `ZINC_ENV` (`test` on local, dev and preview; `live` on production) picks sandbox or live keys, so dev places real sandbox orders | **[Verify]** whether the Allow flow can return a test key; otherwise test mode connects with `POST /sandbox/keys` |
| Webhook URL | **[Claude's call]** An opaque per-account id in the URL, stored plainly; no hash table | It lands in request logs anyway, and the HMAC is the real check (principle 1) |
| Disconnect while gifts are on the way | **[Claude's call]** Refused only while an order is `placing`; otherwise allowed with a warning that tracking stops | A `placing` order's webhooks are needed to settle it; `placed` ones only lose tracking |
| Bad address at order time | **[Claude's call]** `needs_attention` with `fix_address`, keeping the approval. **Revises T51**'s "back to `needs_address`" (tell Jim) | `needs_address` plus an address means "generate", which would discard the approval |
| Address changed while held | **[Claude's call]** Ship to the current address if it passes the format check | The buyer changed it on purpose; asking again adds a step the owner wants avoided |
| Buyer's phone (T51) | **[Claude's call]** New `concierge.accounts.buyer_phone`, written by a server action, asked in Settings once connected. Not `profiles.phone`, which T42 keeps unasked until texts | T42: asked only when buying starts. **[Verify]** whether Zinc fills it from the account, in which case the field goes |
| Alpha money notice in hold emails | **[Claude's call]** Yes, one line | Planning 53: adding funds now triggers a purchase |
| Email look | Today's shell | Owner chose A |
| List pick claimed when? | At approval; released if cancelled or it expires | Owner, 2026-11-06: stops a friend claiming it while yours waits for funds |
| Order we can't confirm with Zinc | Never resent automatically. The owner is alerted (`order.unconfirmed` event, for the health email and a future support dashboard), **and the customer is emailed** that we're confirming the gift with the store, then again at the deadline if it's still unsettled. Never a "nothing bought" email while it's unknown | Owner, 2026-11-06: customers always get the information about their purchase |
| Re-approve after "price went up" | ALL-30 provides `reapprove_order`; ALL-29 builds the button | Owner, 2026-11-06 |
| Gifts held because paid features were off | Bought automatically if the flag comes back on, **only if they can still arrive in time** | Owner, 2026-11-06 |
| Every held gift, before placing | Re-checked with `canArriveInTime` (its delivery range from today against the occasion and the safety buffer). If it can't arrive in time, it isn't bought: the round gets `too_late` and the customer is emailed | Owner, 2026-11-06 ("as long as the recipient gets it on time") |
| Zinc down when buying | Quick retries with backoff (3 tries, about 1 s, 2 s, then 4 s, looking up the order before each resend with the same key), then daily retries; the user is told only if it's still failing at the final reminder | Owner, 2026-11-06 (backoff asked for by the owner) |
| How it's built | A fresh agent per task, then a fresh adversarial reviewer per task | Owner, 2026-11-06 |
| Card declined on the 2nd of two gifts (auto top-up on) | Keep the first, hold the second | Owner, 2026-11-06. Zinc tops up per order, so "hold all" can't be enforced there |
| Price above estimate + 10% but within budget | Stop and ask (one-tap re-approve) | Owner, 2026-11-06. Revises planning 28 |
| Partial top-up | Email right away with the new shortfall | Owner, 2026-11-06 |
| Held gift expires while ordering is paused on our side | Email the user: couldn't send in time, on us, nothing charged | Owner, 2026-11-06. After launch the switch is for emergencies; silence would leave a user thinking the gift was coming |

**Revisions to record** (principle 7): planning decision 28 (a price above estimate + margin but within budget now asks instead of buying), design §4.2 (the cap; `held` counts as committed spend), §5 (dedupe replaced by forward-only moves), §5 (`held`, `attention_reason`, `hold_count`), §6.5 steps 2 and 4 and §6.5a step 4 (the hold, its emails and the cancel link), T51 (bad address), ALL-30's DRY_RUN criterion → `zinc_ordering_enabled`. Recorded as **T56** in `design/decisions.md`, with notes in design §4.2, §5, §6.5a, planning 28 and `design/ui.md`.

## Principles check

**How we work**
- **1 Simplest:** no flag tooling, no new round status, no new scheduler, no webhook dedupe table, no token hash table, one look-ahead rule, no re-check on page views; the approval UI stays in ALL-29.
- **4 No hard-coded values:** new `app_settings`: `order_price_margin_pct` (10), `funding_lookahead_days` (21), `funding_topup_suggest_cents` (10000), `zinc_ordering_enabled` (0 on production until the live test, 1 elsewhere), `zinc_device_poll_seconds` (5). Existing: `zinc_order_fee_cents`. Env: `ZINC_ENV`, `ZINC_API_BASE`.
- **5 Products separable:** all in `modules/concierge` and the `concierge` schema; the webhook route under `app/api/zinc/`; ALL-29 uses only `index.ts`.
- **6, 10 Privacy, minimum data:** Vault for the key and secret; `device_code` in a server-only table; `buyer_phone` is the one new personal field, asked only once buying starts.
- **7 Repo is the source:** the revisions above.

**How we build**
- **E1:** nothing new to deploy or schedule; the daily tick and webhooks do the re-checks.
- **E2:** one Zinc adapter, one `approveAndBuy`, one placing step shared by every caller.
- **E3:** the Zinc client, settings and clock arrive as arguments; tests pass fakes for Zinc.
- **E4:** Zinc responses and webhooks are schema-checked in the adapter and translated to our shape.
- **E5:** Vitest for caps, look-ahead and shortfall math; pgTAP for the schema, grants, skip-cancels-held and the one-live-order index; Playwright for the Settings states; Zinc mocked, Supabase real.
- **E6:** events (`zinc.connect`, `order.place`, `order.held`, `order.paused`, `zinc.webhook`) carry ids and amounts only.
- **E7:** `zinc_ordering_enabled` stops all ordering; caps, one live order per idea and the round lease prevent mistakes; migrations are expand-only.
- **E8:** no new alerts; `order.held` and `order.paused` feed the owner's health email later (W5-3).
- **E9:** on production we'll see `zinc.connect` and `order.place` events and the owner's one real order; it's turned off with `zinc_ordering_enabled` = 0.
- **E10:** no new commands beyond existing `pnpm` scripts.

## Plan

**Goal:** build the approved spec above (ALL-32 + ALL-30) in branch `aarontallen/all-32-zinc-connection`.

**Architecture:**
- **Pure rules** for money and schedules go in `packages/core`.
- **One rule for round state.** Every money-path function only records what happened to an **order**, then calls one SQL function, `reconcile_round`. It works out the round's status, reason, `hold_count` and `next_action_at` from the round's orders, under the round row lock. Nothing else sets a round's status on these paths, so no two writers can race (the cause of every blocker in the plan reviews).
- **A small Zinc adapter** is the only code that talks to Zinc.
- **One placer, `placeRound`,** is shared by every caller: approval, the tick, the auto top-up webhook and finishing setup.
- **Settings** gets one section, and the emails reuse today's shell.

**Tech stack:** Next.js 16 server actions and route handlers, Supabase Postgres + Vault + pgTAP, Vitest, Playwright against local Supabase with a fake Zinc HTTP server, zod 4 at the Zinc boundary, `pg` (new dev dependency) for two-connection race tests.

**Spec:** this file, above. Executors read both.

### Global constraints

- **Settings (T23):** every number comes from `app_settings` or `concierge.accounts`, passed in as arguments (E3). New rows:
  - `order_price_margin_pct` 10
  - `funding_lookahead_days` 21
  - `funding_topup_suggest_cents` 10000
  - `zinc_ordering_enabled`: 0 in the migration, so `db push` never turns ordering on; 1 in `supabase/seed.sql` for local, and on dev by hand; production stays 0 until the owner's live test (README step)
  - `zinc_timeout_ms` 15000
  - `zinc_poll_claim_seconds` 30
  - `hold_reminder_days` 7 and `hold_final_days` 2
  - `placing_stale_minutes` 30
  - `zinc_place_budget_ms` 45000
  - `zinc_retry_attempts` 3 and `zinc_retry_base_ms` 1000 (quick retries with exponential backoff and jitter, about 1 s, 2 s, then 4 s)
  - The device poll interval is the `interval` Zinc returns, not a setting.
- **Env:** `ZINC_ENV` (`test` | `live`; anything else refuses all Zinc calls) and `ZINC_API_BASE` (required, no fallback; read only in route and action wiring). **[Verify]** whether `POST /sandbox/keys` needs a platform secret; if so, add `ZINC_SANDBOX_SECRET`.
- **Never logged or returned to the client:** the Zinc key, the webhook secret, `device_code`. Events carry ids and cents only (E6).
- **Gates, in this order, before any Zinc call on the buying path:** the kill switch, then paid features, then setup. They're checked in Node, so Zinc is never called for a user who can't buy (AC-1). `begin_placing` checks them again under the lock as the final word.
- **One owner for round state:** money-path SQL functions update **orders** only, then `perform reconcile_round(id)`. They never touch `locked_until`. Whoever claimed the lease releases it with `release_round(id, lock)`. The engine never calls `finishStep` after `place`.
- **Lock order:** every function first looks up the `round_id` and locks the round row, then orders, then the account. Rounds are locked by id when there are several. `settle_order` too. No function locks person or occasion rows; it only reads them.
- **Products:** all code is in `modules/concierge`, except one new function exported from `modules/lists/index.ts` (T19).
- **Migrations are expand-only (E7).** `finish_round` and `claim_round` are left exactly as they are.
- **Copy:** from the approved mock-ups. No short leftover wraps (`design/ui.md`). New email kinds not yet mocked up (`hold_address`, `hold_trouble`, `hold_unconfirmed`, `too_late`) are shown to the owner as mock-ups before Task 7 merges.

### How `reconcile_round` decides

Order holds are kept per order in `orders.hold_reason`:
- `funds`, `setup` and `address` are emailed, and so is the round reason `unconfirmed`.
- `paused`, `not_allowed` and `retry` are retried without an email. `retry` also covers "just approved".

`unconfirmed` is an **order status**, not a hold. It's live. It's never cancelled by `cancel_held`, `settle_order` accepts it, it blocks `zinc_forget`, and it flags the round for the owner.

1. **Final statuses don't move.** `skipped`, `delivered` and `complete` are never changed; it returns as is.
2. **First match wins**, among live orders (not cancelled, and not failed-and-resolved). Anything the customer must hear about comes before a gift on its way, so customers are always told at once: one order `placing` and another `held/funds` is `needs_attention/funds` right away, and the hold email goes out. `begin_placing` moves only `held` orders, so placing the held one while the other is still `placing` is fine (controller ruling, 2026-11-06).

| Live orders in the round | Round status | `attention_reason` |
|---|---|---|
| Any `unconfirmed` | `needs_attention` | `unconfirmed` (emailed: "we're confirming it with the store"; owner alerted) |
| Any `failed`, not resolved | `needs_attention` | that failure (`price_up`, `out_of_stock`, `too_late`, `failed`) |
| Any `held` | `needs_attention` | the highest-priority hold: `address` > `setup` > `funds` > `not_allowed` > `paused` > `retry` |
| Any `placing` | `ordered` | null |
| Any `placed` or later | `ordered` | null |
| None | unchanged, or `skipped` when called with the `cancel` or `deadline` context | null |

3. **The `cancel` and `deadline` contexts** first cancel `held` orders and mark unresolved `failed` orders `resolved`. They leave `placing`, `unconfirmed` and placed orders alone. The table then decides:
   - anything placed → `ordered`;
   - `placing` or `unconfirmed` → `ordered` or `needs_attention/unconfirmed`. The owner settles it, and the customer gets the `hold_unconfirmed` email ("still confirming"), never "nothing bought";
   - otherwise → `skipped`.

   They also call `lists.release_for_order` for released list picks, and set `next_action_at = null` for `skipped`.
4. **`hold_count`** goes up only when the emailed reason differs from `last_emailed_reason`, which is stored on the round and set after a hold email. A trip like `funds → retry → funds` sends no new notice.
5. **`next_action_at`:**
   - `now` while an emailed hold's notice is unsent;
   - tomorrow for any other `needs_attention`, including `retry` (no second retry cycle in the same request);
   - the deadline for `ordered`.
6. It's the **only** writer of `gift_rounds.status` on money-path rounds. `finish_round` is never called for them.

### Review focus

These failure modes need their own tests:
1. **Two browser tabs polling the Allow code:** only one reaches `/device/token`, and neither shows an error (Task 4).
2. **A 402 after another order in the round was placed:** that one stays placed, and the round is `needs_attention/funds` (Task 6).
3. **A webhook arrives before `provider_order_id` is saved:** it's matched by our reference and settles the order (Task 5).
4. **The person or occasion is deleted between the checks and the POST:** both take the same row lock, so it's impossible (Task 2, two-connection test).
5. **A POST times out but Zinc created the order:** it keeps its key, stays `placing`, and is settled by lookup, never resent (Task 6).
6. **A crash right after approving:** the round is `needs_attention/retry`, and the next tick places it (Task 6).
7. **The balance is exactly cap + fee:** that's enough (Task 1).

---

### Task 1: Money and schedule rules in core (AC-10, AC-15, AC-20, AC-22, AC-23)

**Files:** Modify `packages/core/src/budget.ts`, `round-plan.ts`, `rounds.ts`, `schedule.ts`, `index.ts`. Create `packages/core/src/funding.ts`. Tests sit beside each file.

**Interfaces (produces):**
- `maxPriceCents(p)`: `p` gains `marginPct: number`. It returns `min(existing result, floor(pickTotalCents × (100 + marginPct) / 100) − feeCents)`.
- `CommittedOrder.status` accepts `"held"`, which counts like `placing`. `committedSpendCents` takes an optional `excludeRoundOrderIds: string[]` (used by the re-check, so a round's own orders don't count against themselves).
- `funding.ts`:
  - `shortfallCents(orders: { maxPriceCents: number; feeCents: number }[], balanceCents: number): number`
  - `lookaheadCents(rounds: LookaheadRound[], feeCents: number): { cents: number; atLeast: boolean }`, with `LookaheadRound = { orders: { maxPriceCents: number; feeCents: number }[] | null; budgetCents: number | null }`
  - `suggestedMinimumCents(largestBudgetCents: number | null, marginPct: number, feeCents: number): number | null`
- `round-plan.ts`:
  - `RoundView` gains `attentionReason: AttentionReason | null`, `holdCount: number`, `seenBalanceCents: number | null` and `emailedBalanceCents: number | null`.
  - `AttentionReason = HoldReason | "price_up" | "out_of_stock" | "too_late" | "failed" | "unconfirmed"`.
  - `HoldReason = "funds" | "setup" | "address" | "paused" | "not_allowed" | "retry"`, plus `"unconfirmed"` as a round reason only.
  - `EMAILED_HOLDS = ["funds", "setup", "address", "unconfirmed"]` and `PLACEABLE_HOLDS = ["funds", "setup", "address", "paused", "not_allowed", "retry"]` (`not_allowed` recovers by itself if paid features come back on; owner).
  - `StepKey` adds `` `hold:${number}:${"notice" | "reminder" | "final"}` `` and `` `hold:${number}:short:${string}` ``.
  - `NextAction` adds `{ do: "place" }` and `{ do: "send_hold"; send: StepKey; shortfall?: true }`.
  - `nextAction` for `needs_attention`:
    - The deadline skip comes first.
    - An emailed hold whose notice is unsent → `send_hold` notice.
    - For `funds`, if `seenBalanceCents > emailedBalanceCents` → `send_hold` with the key `hold:n:short:<today>`, `shortfall: true`.
    - At deadline − `holdReminderDays` → reminder; at − `holdFinalDays` → final.
    - Else a placeable hold → `place`.
    - Else (`unconfirmed`, `not_allowed`, failures) → `wait` until the deadline.
- `schedule.ts`: `ScheduleSettings` gains `holdReminderDays` and `holdFinalDays`.
- `rounds.ts`: `awaiting_approval` gains → `needs_attention`.

- [ ] **Step 1: Write the failing tests:**
  - margin: budget 10000, pick 4200, fee 100, margin 10 → `4520`; margin 0 → `4100`
  - no budget (ceiling is the pick sum 4200), margin 10 → `4100`, since the smaller limit wins
  - held counts as committed (`4620`); with `excludeRoundOrderIds` → `0`
  - `shortfallCents([{4520,100}],1200)` → `3420`; balance `4620` → `0` (Review focus 7)
  - `lookaheadCents` with mixed rows; `atLeast` with a null budget
  - `suggestedMinimumCents(10000,10,100)` → `10100`
  - `nextAction`:
    - funds, notice unsent → notice
    - after the notice → `place`
    - balance rose → `short` with today's key, and not twice the same day
    - −7 → reminder; −2 → final
    - `hold_count` 2 uses `hold:2:`
    - `paused` → `place`, never `send_hold`
    - `unconfirmed` → `wait`
    - the deadline day → skip
- [ ] **Step 2:** `pnpm --filter @gifts-af/core test` → FAIL.
- [ ] **Step 3:** implement, and export from `index.ts`.
- [ ] **Step 4:** PASS. `pnpm typecheck` passes.
- [ ] **Step 5:** commit `feat(core): order cap with margin, funding math, hold steps (ALL-32)`.

### Task 2: Schema, `reconcile_round`, locks and Vault (AC-2, AC-3, AC-5 to AC-8, AC-14, AC-17, AC-18, AC-21, AC-24, AC-25, AC-26) [P with Task 3]

**Files:** Create `supabase/migrations/20261109100000_zinc_wallet.sql`. Test: `supabase/tests/zinc_wallet.test.sql`, and `apps/web/modules/concierge/__tests__/placing-race.test.ts` (two `pg` connections). Modify `supabase/seed.sql`, `packages/core/src/database.types.ts` (`pnpm db:types`) and `apps/web/package.json` (dev dependency `pg`).

**Interfaces (produces).** All functions are `security definer`, `search_path=''`, executable by `service_role` only.

- **Columns:**
  - `orders.status` gains `held` and `unconfirmed`.
  - `orders`: `hold_reason text` (check: the `HoldReason` values), `resolved boolean not null default false`.
  - `gift_rounds`: `attention_reason text`, `hold_count int not null default 0`, `last_emailed_reason text`, `seen_balance_cents int`, `emailed_balance_cents int`. These two replace the spec's `hold_balance_cents`: one is the balance we last saw, the other the one we last emailed.
  - `accounts`: `zinc_webhook_id uuid unique`, `buyer_phone text` (check: 10 digits), `zinc_env text`. `zinc_env` records whether the stored key is a sandbox or live key, so a live deploy never uses a test key: placing refuses on a mismatch with `ZINC_ENV`.
  - None of these are granted to `authenticated`.
- **Table `concierge.zinc_connect_attempts`:** `user_id` pk (cascade from `auth.users`), `device_code`, `user_code`, `verification_url`, `interval_sec`, `expires_at`, `polling_until`, `created_at`. RLS on, and nothing granted to `authenticated`.
- **Settings rows:** from Global constraints.
- **`reconcile_round(p_round_id, p_context text default null) returns concierge.round_status`:**
  - locks the round row (`for update`, waiting);
  - applies the table in "How `reconcile_round` decides" (`p_context` = `'cancel'` or `'deadline'` lets "none live" become `skipped`);
  - writes status, `attention_reason`, `hold_count` and `next_action_at`, and returns the status;
  - never touches `locked_until`.
- **`release_round(p_round_id, p_lock)`:** sets `locked_until = null` and `attempts = 0` where it matches.
- **`claim_round_now(p_round_id, p_now)`:** like `claim_round`, but ignores `next_action_at`, and allows `awaiting_approval` and `needs_attention`.
- **`approve_round(p_round_id, p_user_id, p_lock, p_orders jsonb) returns setof concierge.orders`:**
  - refuses if the lease doesn't match, the round isn't `awaiting_approval`, any idea isn't this round's and user's, or the round already has a live order;
  - inserts the orders (`held`, `hold_reason = 'retry'`) and their `order_addresses`, claims list picks (`lists.claim_for_order`) and sets the ideas `selected`;
  - calls `reconcile_round`, so the round becomes `needs_attention/retry`. All in one transaction.
- **`begin_placing(p_round_id, p_lock, p_today, p_orders jsonb) returns setof concierge.orders`.** `p_orders` is `[{id, max_price_cents, address}]`, the re-checked cap and the refreshed snapshot.
  - It locks the round, then the account.
  - **It requires:** the lease; status `needs_attention` with a placeable hold; the person not deleted; the occasion enabled; `p_today < ship_by_deadline`.
  - **On a failed gate, it records the reason on the held orders:** kill switch off → `paused`; no paid features → `not_allowed`; not connected or no phone → `setup`. Then it reconciles and returns nothing.
  - **Otherwise:** it saves each order's cap and snapshot, sets the held orders to `placing`, reconciles (→ `ordered`) and returns them.
  - It refuses (returns nothing) if there are zero `held` orders.
- **`record_outcomes(p_round_id, p_results jsonb) returns concierge.round_status`.** No lease needed. It touches only orders still `placing`:
  - `sent` saves `provider_order_id`;
  - `insufficient` → `held/funds` with a new key, saving `available_cents` into `seen_balance_cents`;
  - `unsent` (not POSTed because an earlier one timed out) → `held/retry` with the **same** key, since it was never sent;
  - `rejected` → `failed` with `failure_type`, through the same address-replacement logic as `settle_order` (shared helper `fail_order`);
  - `unknown` (timeout) stays `placing`.

  Then it reconciles.
- **`settle_order(p_user_id, p_order_id, p_status, p_failure_type, p_price jsonb)`.** Webhooks and the sweep call it. It locks the round first, and updates only where `status in ('placing','unconfirmed')` and the order belongs to `p_user_id`.
  - On `invalid_shipping_address`, it marks the order `failed`, `resolved = true`, and inserts one replacement `held/address` order with a new key, unless the idea already has a live order.
  - Then it reconciles. This works whatever the round's status.
- **`hold_orders(p_round_id, p_reason)`:** moves held orders to the given reason, then reconciles. Used for `setup`, known-short `funds` and `address`.
- **`mark_unconfirmed(p_order_id)`:** `placing → unconfirmed`, then reconcile. The sweep uses it.
- **`cancel_held(p_round_id, p_context text)`:** just `reconcile_round(id, p_context)` (rule 3 above). It returns the status.
- **`reapprove_order(p_round_id, p_user_id, p_lock, p_order_id, p_max_price_cents)`:** for ALL-29's one-tap re-approve after `price_up` (AC-19). It resolves the failed order, inserts a replacement `held/retry` with the new cap (checked against the budget rule by the caller), and reconciles.
- **`skip_open_rounds`:** becomes plpgsql, looping `cancel_held(id, 'deadline')` per matching round. Its signature is unchanged.
- **The deadline skip:** the engine calls `cancel_held` for every `needs_attention` round.
- **`zinc_forget(p_user_id) returns text`:**
  - locks the user's open rounds (by id), then the account;
  - returns `'placing'` and changes nothing if any order is `placing`;
  - otherwise deletes the Vault secrets, clears the Zinc columns and `buyer_phone`, moves held orders to `setup`, reconciles those rounds, and returns `'ok'`. `unconfirmed` orders also block it.
- **Vault:**
  - `zinc_store_secrets(...)` deletes old secrets first;
  - `zinc_secrets(p_user_id)` and `zinc_secret_by_webhook(p_webhook_id)` read them;
  - an account delete trigger removes them.
  - **[Verify] first:** a one-function spike test proves `vault.create_secret` and the delete work from a `postgres`-owned definer on local and hosted.
- **Connect:** `zinc_claim_poll(p_user_id, p_now)` sets `polling_until = now + zinc_poll_claim_seconds` only where it's null or past. `zinc_drop_attempt(p_user_id)` removes the attempt.
- **Lookups:**
  - `claim_due_rounds`: same signature; held rounds first, then by earliest deadline.
  - `held_rounds_for_user(p_user_id)`
  - `order_by_reference(p_user_id, p_order_id)`
  - `stale_placing_orders(p_now)`
  - `lookahead_rounds(p_user_id, p_until)`
  - `set_seen_balance(p_round_id, p_cents)` and `set_emailed_balance(p_round_id, p_cents)`
- **`lists.claim_for_order(p_item_id, p_user_id)` and `lists.release_for_order(p_item_id, p_user_id)`:** service role only. A list pick is claimed at approval and released on cancel or expiry (owner, 2026-11-06).

- [ ] **Step 1: Write the failing pgTAP tests:**
  - grants: `authenticated` can't read the new table or columns, can't update `buyer_phone`, and can't call the new functions
  - `zinc_claim_poll` twice within 30 s → the second gets null
  - reconcile:
    - `failed` then deadline → `skipped`; placed plus failed then deadline → `ordered`
    - `unconfirmed` then deadline or cancel → `needs_attention/unconfirmed`, not cancelled
    - a `delivered` round is never moved
    - `funds → retry → funds` doesn't bump `hold_count`
    - a list claim is released on the deadline
  - `approve_round`:
    - with a live order → refused
    - with another user's idea → refused
    - on success → the round is `needs_attention/retry` with `next_action_at` = tomorrow (the caller places it right away; the tick is only the crash fallback)
  - `begin_placing`:
    - the kill switch at 0 → `paused`, nothing `placing`
    - no paid features → `not_allowed`
    - the deadline day → nothing
    - zero held → nothing
  - `record_outcomes`:
    - `unknown` keeps the key
    - `unsent` → `retry`, same key
    - `insufficient` → `funds`, new key
    - one `sent` plus one `insufficient` → `needs_attention/funds`, with the sent one untouched
  - `settle_order` on a `needs_attention/funds` round with a `failed price_up` → the reason is `price_up`
  - `settle_order(invalid_shipping_address)` twice → only one replacement
  - `cancel_held` and `skip_open_rounds` with one placed and one held order → `ordered`
  - a reason change `setup` → `funds` bumps `hold_count`
  - `zinc_forget` with a `placing` order → `'placing'`, nothing cleared
  - the account delete removes the Vault rows
- [ ] **Step 2: Write the failing race test** `placing-race.test.ts`:
  - Connection A runs `begin_placing` in an open transaction, while connection B's `cancel_held` waits. After A commits, B returns `ordered` and the `placing` order is untouched.
  - Then the reverse order.
  - The same with `zinc_forget` against `begin_placing`, and with `settle_order` against `record_outcomes`: no deadlock either way (a 5 s statement timeout fails the test).
  - Review focus 4 through the real path: `delete_person`, then the trigger, then `skip_open_rounds`, against `begin_placing`.
  - Cancel during the `send_hold` step leaves the round `skipped`.
- [ ] **Step 3:** `pnpm db:test` → FAIL.
- [ ] **Step 4:** write the migration, run `supabase db reset`, then `pnpm db:types`.
- [ ] **Step 5:** both suites PASS, and `pnpm typecheck` passes. Commit `feat(db): Zinc wallet schema, reconcile_round, locks and Vault (ALL-32)`.

### Task 3: Zinc adapter (E4) [P with Task 2]

**Files:** Create `apps/web/modules/concierge/zinc/client.ts`, `account.ts`, `orders.ts`, `signature.ts`, `retry.ts` and `types.ts`. Test: `apps/web/modules/concierge/__tests__/zinc-adapter.test.ts`. ALL-27 will add `products.ts` here; note this on ALL-27.

**Interfaces (produces):**
- `client.ts`:
  - `type ZincHttp = { base: string; timeoutMs: number; fetch: typeof fetch }`
  - `class ZincError extends Error { kind: "unavailable" | "unauthorized" | "rejected"; status: number; code?: string }`
- `account.ts`:
  - `startDevice(h, name): Promise<{ deviceCode; userCode; verificationUrl; expiresAt: Date; intervalSec }>`
  - `pollDevice(h, deviceCode): Promise<{ status: "pending" | "slow_down" } | { status: "approved"; apiKey } | { status: "denied" | "expired" }>`
  - `mintSandboxKey(h)`
  - `getWallet(h, key): Promise<{ balanceCents; autoTopUp: boolean | null }>`
  - `setWebhook(h, key, url): Promise<{ secret }>`
  - `clearWebhook(h, key)`
- `orders.ts`:
  - `createOrder(h, key, o: ZincOrderInput): Promise<{ providerOrderId } | { insufficient: { requiredCents; availableCents } }>`, where `ZincOrderInput = { reference; idempotencyKey; productUrl; maxPriceCents; shipTo: ZincAddress; phone; giftMessage: string | null }`. It sends `is_gift: true` and `fulfillment.gift: "best_effort"`.
  - `findOrderByReference(h, key, reference)`
- `signature.ts`: `verifySignature(rawBody, header, secret): boolean` (timing-safe) and `parseEvent(json): ZincEvent` (zod).
- `retry.ts`: `placeWithRetry(h, key, o: ZincOrderInput, r: { attempts: number; baseMs: number; sleep: (ms: number) => Promise<void>; random: () => number })`. It applies only to `unavailable` (network errors, timeouts and 5xx). Before each retry it calls `findOrderByReference`. If the order exists, it returns that order. Otherwise it resends with the **same** idempotency key. The wait before retry k is `baseMs × 2^(k−1) × (0.5 + random())`. `insufficient` and 4xx are never retried. Owner, 2026-11-06.
- `types.ts`:
  - `ZincDeps = { db: SupabaseClient<Database>; http: ZincHttp; env: "test" | "live"; webhookBaseUrl: string; now: Date }`
  - `PlaceHeld = (userId: string) => Promise<void>`

- [ ] **Step 0 (before Task 2 starts): a Zinc facts check.** Run a short script against the sandbox (`spikes/checkout/zinc-facts.mjs`, which mints a free test key) and record the answers in `design/spikes/checkout.md`:
  - Is there an order lookup by our reference, and what does it return while the order is processing?
  - Does a replay with the same idempotency key return the same order, and for how long?
  - Does `/wallet/me` report auto top-up?
  - How is the webhook cleared?
  - Does the total include the fee?

  If the lookup or idempotent replay doesn't exist, stop and bring it to the owner before Task 2.
- [ ] **Step 1: Write the failing tests** (a fake `fetch` returning the spike's recorded shapes):
  - each device reply is mapped
  - a 402 → `insufficient`
  - a 500 or timeout → `unavailable`
  - a malformed body → `rejected`, with no body text in the message
  - the signature vector passes, and a one-byte change fails
  - an error built from a request with a key never contains the key
  - `placeWithRetry`:
    - two timeouts, then success → 3 POSTs, all with the same key, and waits of about 1000 and 2000 ms (with `random` fixed)
    - a timeout where the lookup finds the order → no second POST
    - a 402 → no retry
    - still unavailable after 3 attempts → `unavailable`
- [ ] **Step 2:** FAIL. **Step 3:** implement. **[Verify]** these against live sandbox calls, and note the answers in the file header:
  - the `/wallet/me` auto top-up field
  - the order reference field
  - the webhook-clear call
  - whether the total includes the fee
  - how long the idempotency key lasts
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(concierge): Zinc adapter (ALL-32)`.

### Task 4: Connect, phone, disconnect and Settings (AC-1 to AC-9, AC-12, stories 1 to 4)

**Files:**
- Create `apps/web/modules/concierge/zinc/connect.ts` and `apps/web/app/settings/paying-for-gifts.tsx`.
- Modify `apps/web/app/settings/actions.ts` and `page.tsx`, and `apps/web/modules/concierge/index.ts`.
- Tests: `__tests__/zinc-connect.test.ts`, `apps/web/e2e/paying-for-gifts.spec.ts`, and `apps/web/e2e/fake-zinc.ts`. The fake listens on a fixed port, with `ZINC_API_BASE=http://127.0.0.1:4599` set in Playwright's `webServer.env`. The spec is skipped when `E2E_BASE_URL` is set.

**Interfaces (produces):**
- `getPaymentStatus(userId, deps)` returns a `PaymentStatus`:
  - `{ kind: "not_allowed" }`
  - `{ kind: "not_connected" }`
  - `{ kind: "waiting"; userCode; verificationUrl; expiresAt; intervalSec }`
  - `{ kind: "connected"; balanceCents: number | null; autoTopUp: boolean | null; lookahead: { cents; atLeast }; suggestedMinimumCents: number | null; topUpSuggestCents; phone: string | null; placingCount; onTheWayCount }`
- `startConnect`, `pollConnect`, `cancelConnect`, `disconnect(userId, deps)` and `savePhone(userId, raw, deps)`. Each returns `PaymentStatus | { error }`. The ones that can finish setup take `placeHeld: PlaceHeld`.
- `getZincWallet(userId, deps)` is re-exported for ALL-29.
- **`pollConnect`:** `zinc_claim_poll` first. If another tab holds it, return the current status with no error.
- **`disconnect`, in this order:** read the key, then `zinc_forget`. If it returns `'placing'`, return an error. If `'ok'`, call `clearWebhook`; a failure there is logged and the page says to revoke the key in Zinc.

- [ ] **Step 1: Write the failing Vitest tests:**
  - no paid features → every call returns `not_allowed`, with no fetch
  - Zinc unreachable → `balanceCents: null`
  - two concurrent polls → one `/device/token` call
  - approve → secrets stored, and the webhook URL is `/api/zinc/webhook/<uuid>`
  - an expired or denied code → `not_connected`
  - disconnect: refused while an order is `placing`; otherwise `zinc_forget` runs before `clearWebhook`
  - `savePhone` normalises to 10 digits and rejects short input
  - the log scan and every action's serialised result contain no key, secret or `device_code`
- [ ] **Step 2:** FAIL. **Step 3:** implement the four mock-up states (status in two fixed lines, `tabular-nums`, alpha notice, mock-up copy). The client polls at the `intervalSec` Zinc returns.
- [ ] **Step 4: e2e:** states 1 to 4 against the fake Zinc, plus disconnect, at phone and desktop widths in light and dark, with screenshots saved for evidence.
- [ ] **Step 5:** `pnpm test` and the e2e PASS. Commit `feat(concierge): connect Zinc from Settings (ALL-32)`.

### Task 5: Webhook route (AC-13, AC-14, AC-26)

**Files:** Create `apps/web/app/api/zinc/webhook/[id]/route.ts` and `apps/web/modules/concierge/zinc/events.ts`. Test: `__tests__/zinc-events.test.ts`.

**Interfaces:** `handleZincWebhook(webhookId, rawBody, signature, deps: ZincDeps & { placeHeld: PlaceHeld }): Promise<{ status: 200 | 401 }>`. The route reads `await request.text()` first.
- Unknown id or bad signature → 401.
- Order events → `order_by_reference`, then `settle_order`; anything not `placing` is ignored with 200.
- `auto_topup.succeeded` sets `auto_topup_on = true` and calls `placeHeld`. `disabled` sets it false.

- [ ] **Step 1: Write the failing tests:**
  - wrong signature, another user's secret or unknown id → 401, with no writes
  - `order.placed` saves the price parts, even before `provider_order_id` is saved (Review focus 3)
  - `order.failed max_price_exceeded` on a `funds` round → `price_up`
  - a duplicate event → one write
  - `auto_topup.succeeded` → `placeHeld` called once
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(concierge): Zinc webhooks (ALL-32)`.

### Task 6: Approve, place, sweep (AC-15 to AC-21, AC-26, AC-28, stories 5, 7 and 10)

**Files:**
- Create `apps/web/modules/concierge/purchase/approve.ts`, `place.ts` and `store.ts`.
- Modify `apps/web/modules/lists/index.ts`, adding `claimForOrder` and `releaseForOrder`.
- Modify `apps/web/modules/concierge/people/people.ts`: `saveAddress` also re-places `address` holds, through `placeHeld`.
- Modify `rounds/store.ts`: `waitingRoundsForPerson` includes `needs_attention/address`.
- Modify `index.ts`.
- Test: `__tests__/purchase.test.ts` (local Supabase, fake Zinc).

**Interfaces (produces):**
- `approveAndBuy({ userId, roundId, ideaIds, giftMessage?, overBudgetConfirmed? }, deps: PurchaseDeps): Promise<{ ok: true; status: "ordered" | "held" } | { ok: false; error }>`
- `PurchaseDeps = ZincDeps & { settings: { feeCents; marginPct }; advanceRound: (roundId) => Promise<unknown> }`
- `placeRound(roundId, lock, deps): Promise<"ordered" | "held" | "not_ready">`
- `placeHeldForUser(userId, deps)`, which matches `PlaceHeld`.
- `sweepStalePlacing(deps): Promise<number>`

**approveAndBuy:**
1. Claim the lease (`claim_round_now`). If busy → `busy`.
2. Check paid features and the over-budget confirmation.
3. Compute the caps (`marginPct`), then `approve_round`.
5. `placeRound`, then `release_round`.
6. If the result is an **emailed** hold, call `advanceRound(roundId)`. The notice is unsent, so `next_action_at = now`, the claim succeeds and the engine sends the notice. A `retry` hold waits for the tick.

**placeRound** (lease held; it never writes round status):
1. **Gates in Node, before any Zinc call:**
   - kill switch off → `hold_orders(paused)`
   - no paid features → `not_allowed`
   - not connected or no phone → `setup`
2. **Still on time:** for each held order, `canArriveInTime({ occasionDate, orderDate: today, handlingDaysMax, deliveryDaysMax })` with the idea's saved delivery range. If it can't arrive in time → `fail_order(too_late)`. `fail_order(too_late)` leaves the order unresolved, so the round gets reason `too_late` and the customer is emailed `too_late` (owner); the deadline resolves it, and the round is skipped.
3. **Address:** for a recipient address, re-read it with `isShippableAddress`. If it fails → `hold_orders(address)`.
4. **Re-checked cap:** `min(saved, recomputed with this round's orders excluded)`.
5. **Known short:** if auto top-up is known off, read `/wallet/me` and `set_seen_balance`. If short → `hold_orders(funds)`.
6. **Begin:** `begin_placing` with the caps and snapshots. If it returns nothing → stop.
7. **POST each order** with `placeWithRetry`:
   - the first `unavailable` after the quick retries → that one is `unknown`, and later ones are `unsent`, with the loop stopped;
   - a 402 → `insufficient` for it and every later one;
   - a 4xx → `rejected`.
8. **Record:** `record_outcomes`.

**`sweepStalePlacing`:** for each `stale_placing_orders`, `findOrderByReference`:
- found → `settle_order`;
- found but still processing → left alone. Not found → `mark_unconfirmed` and an `order.unconfirmed` event for the owner. **It never resends** (owner, 2026-11-06).

**Time budget:** `placeRound` stops starting new POSTs once `zinc_place_budget_ms` (45000, a setting) has passed. Unstarted orders are recorded `unsent` (→ `retry`). **[Verify]** the Vercel Hobby function limit, and keep the budget under it.

**Zinc down:** quick retries with backoff first (Task 3). If it's still down, `retry` holds are tried again on each daily tick and aren't emailed. At deadline − `holdFinalDays`, a round still in `retry` gets one `hold_trouble` email.

**`placeHeldForUser`:** `held_rounds_for_user`, then claim, place and release for each. No held rounds means no wallet call.

- [ ] **Step 1: Write the failing tests:**
  - the switch off → `paused`, no Zinc call, no email; switch on → the next tick places it
  - the cap is 4520
  - auto top-up unknown and a 402 → `funds` with the right shortfall
  - auto top-up known off and short → no POST
  - a 402 on the 2nd pick → the 1st stays placed (Review focus 2)
  - **timeout and 402 together:** A times out, B is `unsent`, then the sweep finds A → settled, with B placed on retry using its original key (Review focus 5)
  - the sweep finds nothing → `unconfirmed`, no resend
  - a crash after `approve_round` (`placeRound` never called) → the next tick places it (Review focus 6)
  - a double approve → `busy`, one set of orders
  - person gone, occasion off, deadline day or paid features off → no POST
  - no held rounds → no wallet call
  - the cap re-check after a budget raise → ≤ the saved cap, with no throw
  - address removed → `address`; saving a valid one places it
  - `fix_address` from a webhook, then the address saved → the replacement is placed
  - a list pick claimed
  - a `not_allowed` hold whose gift can no longer arrive in time, once paid features are back on → `too_late`, no POST, customer emailed
  - a synchronous 4xx → `rejected`
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(concierge): approve and place orders from the Zinc wallet (ALL-30, ALL-32)`.

### Task 7: Engine wiring and emails (AC-11, AC-19, AC-22 to AC-24, stories 6 to 8)

**Files:**
- Modify `apps/web/modules/concierge/rounds/engine.ts` and `store.ts`; `notify/templates.ts`, `samples.ts` and `actions.ts`; `apps/web/app/api/rounds/tick/route.ts`; and `lib/email-layout.ts` (a warning-box part).
- Tests: `__tests__/round-engine.test.ts` (extend it; the new hold cases use `createSupabaseRoundStore` against local Supabase, E5), `templates.test.ts` and `apps/web/e2e/emails.spec.ts`.

**Interfaces:**
- `EngineDeps` gains:
  - `placeRound(roundId, lock)`
  - `placeHeld: PlaceHeld`
  - `sweep()`
  - `wallet(userId): Promise<{ balanceCents; autoTopUp } | null>`, called only for paid-features, connected users.
- **On the tick:** run `sweep()` first, then the rounds (held ones first).
- **For `place`:** call `placeRound`, then `release_round`. No `finishStep`.
- **`unconfirmed` rounds:** the customer gets `hold_unconfirmed` (notice, then at the deadline if still unsettled): "We're confirming Mom's gift with the store. You won't be charged twice. We'll email you as soon as we know." The `order.unconfirmed` event feeds the owner's health email (W5-3) and a future support dashboard. The README runbook says how to settle one by hand. Settling it sends the normal outcome.
- **For `send_hold`:** send the email, then `set_emailed_balance` and set `last_emailed_reason`, then `reconcile_round` and `release_round`. Never `finishStep` or `finish_round`.
- **The deadline skip for `needs_attention`:** `cancel_held(id, 'deadline')`, then use the status it returns:
  - `skipped` → the `skipped` email, or `missed_on_us` when the last reason was `paused`;
  - `ordered` → no email, no skip.
- **The heads-up:** with `funding` from `lookaheadCents(lookahead_rounds(...))` compared against `wallet()`.
- **Templates** (`NotificationKind`):
  - `hold_funds { personName, occasion, dateText, giftTitles, neededText, haveText, shortText, placedTitle?, still? }`
  - `hold_setup`
  - `hold_address`
  - `hold_trouble`
  - `hold_unconfirmed`
  - `too_late`
  - `missed_on_us`
  - `heads_up` gains `funding?: { dueText, haveText, atLeast }`

  Hold emails carry the alpha line and a `cancel_held_gift` link.
- **The `cancel_held_gift` action:** `cancel_held(id, 'cancel')`. If claimed, it also calls `releaseForOrder`.

- [ ] **Step 1: Write the failing tests:**
  - with a fake clock:
    - the notice on the hold day, `place` daily, reminder at −7, final at −2
    - the deadline goes through `cancel_held`
    - one placed and one held at the deadline → `ordered`, with no skipped email
  - `paused` at the deadline → `missed_on_us`
  - `unconfirmed` → the `hold_unconfirmed` notice, and again at the deadline; never `skipped`
  - a partial top-up → one `short` email per day
  - a reason change `setup` → `funds` → a new notice
  - templates: the logo, one button and the alpha line on each; the heads-up warning only with `funding`
  - AC-11: no `wallet()` call without paid features
  - cancel link → cancelled, the round skipped, and the list claim released
- [ ] **Step 2:** FAIL. **Step 3:** implement, and show the owner mock-ups of `hold_address` and `hold_trouble` (sample renders). **Step 4:** PASS. Run the e2e `emails` to refresh the phone-check screenshots.
- [ ] **Step 5:** commit `feat(concierge): hold emails, retries and cancel link in the round engine (ALL-32)`.

### Task 8: Docs, runbook, review, PR (E9, E10, T44, T55)

**Files:** Modify `README.md` (settings, `ZINC_ENV`, `ZINC_API_BASE`, a "Stop all ordering" runbook, and "Unconfirmed orders: what to do"), `apps/web/.env.example`, `design/technical-design.md` §6.5a ("as built") and `design/ui.md` (mock-up links). Add `apps/web/scripts/check-bundle-secrets.mjs` (greps `.next/static` for `zn_` and the Vault function names), run after `pnpm build` as a root script, `pnpm check:bundle`, listed in the README table.

- [ ] **Step 1:** write the docs and the script.
- [ ] **Step 2:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle` and `pnpm db:test` → all green.
- [ ] **Step 3:** commit `docs: Zinc wallet runbook and settings (ALL-32)`.
- [ ] **Step 4:** run the adversarial PR review (T55). Fix the blockers.
- [ ] **Step 5:** open the PR, titled `feat: connect Zinc, fund it, and buy approved gifts (ALL-32, ALL-30)`, with `Part of` on both tickets. Re-read both tickets first (T57). Post the evidence. The owner's real order comes after deploy (AC-27).

### Order and parallelism

- **Task 1 and Task 3's Step 0 (the Zinc facts check) first.**
- **Then Tasks 2 and 3 in parallel.**
- **Then Tasks 4 and 5 in parallel.** They take `placeHeld` as an argument.
- **Then Tasks 6, 7 and 8.** Task 7 wires the real `placeHeldForUser` and `sweepStalePlacing` into the tick, the webhook route and the Settings actions.
- Each task gets a fresh implementer and a fresh adversarial reviewer (T55) before the next.

## Done: evidence on the ticket (T44)

- [ ] Test evidence on ALL-32 and ALL-30: tests added (failed first), suite and CI results.
- [ ] Screenshots of the four Settings states and the three emails, phone and desktop, light and dark.
- [ ] Sandbox order, a held-then-funded order, a partial top-up, a cancelled hold, then one real order (owner, live).
- [ ] Every acceptance box ticked on both tickets.

## Review focus

- Key handling: Vault only, server-only rows, never logged or sent to the client (AC-6).
- Per-account webhook verification and forward-only status moves (AC-13, AC-14).
- No double buy, no over-cap buy, no buy after skip or cancel (AC-15, AC-18, AC-21, AC-24, AC-25).
- The hold-and-retry path never buys for a user without paid features or with ordering switched off (AC-1, AC-17, AC-21).
