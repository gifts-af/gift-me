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
| AC-3 | Waiting for Allow | The user clicks Allow at Zinc | A poll (server action, paid features re-checked) calls `POST /device/token`. The one poll that gets the key claims the pending row with a single conditional delete, so two tabs can't both collect or wipe it. The key and the webhook secret go to Supabase Vault; our webhook URL with a fresh opaque per-account id is registered on the account (stored on `concierge.accounts`; it only routes the request, the HMAC is the real check); `zinc_connected_at` is set. The page moves to state 4 |
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
| AC-21 | A held round | The daily tick, `wallet.auto_topup.succeeded`, or finishing setup re-checks it | It takes the round's lease and places only if the round is still `needs_attention` with a hold reason, the person isn't deleted, the occasion is still on, the deadline hasn't passed and paid features are still on. Each cap is `min(saved, recomputed)`. When `ship_to` is the recipient, it ships to the person's current address if it passes `isShippableAddress` (snapshot re-taken at placement); if the new one fails the check, the old snapshot is used. For the buyer's own or another address, the saved snapshot is used (D38). The round moves to `ordered`. Only users with held orders are checked; none means no wallet calls. On the tick, held rounds are retried before any expiry, earliest deadline first |
| AC-22 | A held round, still short | A re-check sees the balance went up since the last hold email | A fresh "you're still $X short" email goes out with the new amount, at most once a day (partial top-ups never leave it stuck), keyed `hold:<n>:short:<date>` in `round_sends`, with the balance last emailed kept in `gift_rounds.hold_balance_cents` (owner) |
| AC-23 | A held round | Days pass | Hold emails go on the hold date, then at deadline − 7 and deadline − 2 if still ahead. Keys in `round_sends` include the hold number (`hold:<n>:notice`, `hold:<n>:reminder`, `hold:<n>:final`, with `gift_rounds.hold_count`), so a second hold in the same round is still emailed. Core `nextAction` gains a branch for hold reasons: `next_action_at` is the next tick (tomorrow), so `claim_due_rounds` picks held rounds up daily, earliest deadline first. At the deadline, held orders become `cancelled` (`failure_type = 'held_expired'`), the round is skipped with the skipped email, and nothing is bought. If the hold reason is `paused` (our switch, not the user), the email instead says we couldn't send it in time, that it's on us, and nothing was charged (owner) |
| AC-24 | A held gift | The buyer taps "Cancel this gift" (a signed one-time link on `action_links`, action `cancel_held_gift`, with the usual confirm POST) | Under the round row lock, the held orders are cancelled. If no order in the round got past `held`, the round is skipped; if one did, the round goes to `ordered` (never `skipped` while a gift is on its way, T27) |
| AC-25 | A person or occasion is deleted or switched off while orders are held | `skip_open_rounds` or the deadline skip runs | Same rule as AC-24, in the same SQL and under the same lock, so a later top-up can't buy them |
| AC-26 | Order webhooks | `order.placed` / `order.failed` arrive | The price breakdown, `provider_order_id` and status are saved. `order.failed` maps `error_type` to a reason stored in `gift_rounds.attention_reason` (`price_up`, `out_of_stock`, `fix_address`, …; holds use `funds`, `setup`, `paused`). `invalid_shipping_address` keeps the approval: reason `fix_address`, and saving a valid address re-places the same pick (not `needs_address`, which would discard the approval and regenerate). Shipping and delivery events are ALL-33 |
| AC-27 | Real money | Sandbox on dev, then one real order on the owner's account | A shortfall with auto top-up on is covered and the order goes ahead (ALL-32 criterion 4, ALL-30 criterion 4; the owner does the live one) |

### Out of scope

- **The approval screen** and showing the balance on it: ALL-29 (Jim). It calls `approveAndBuy` and `getZincWallet()` from the concierge's `index.ts`. Jim is told.
- **Tracking, delivery, late risk:** ALL-33 (`order.shipped`, `.tracking_received`, `.delivered`, …). This ticket only saves `placed` and `failed`.
- **Stage 2 funding** (the user's card in our app, Zinc Connect): later ticket.
- **The next-best idea in one tap** after a failure (D29): ALL-29's screen; this ticket sets the reason.
- **Email branding beyond today's shell**, including a seasonal logo URL (cut after review: outside both tickets).

### Open questions

None for the owner. Facts to check while building are marked **[Verify]**.

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

Written next with `superpowers:writing-plans`, after this spec is approved, then reviewed adversarially (T55).

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
