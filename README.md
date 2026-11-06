# Gifts AF platform (working name)

One app for three products (T19): **gift lists** (live, formerly the GiftsAF repo), **Gift Concierge** (being built) and **scan-to-gift** (later). Gift Concierge is an app that keeps track of friends and family, what they like, and the dates that matter. It picks gifts for those dates and buys them, with as much or as little automation as the user wants and safeguards so nothing gets purchased without time to approve.

## Workspace layout

| Folder | Purpose | Status |
|---|---|---|
| `planning/` | Product discovery: [PRD](planning/PRD.md) (approved 2026-10-17), [decisions log](planning/decisions.md), [research](planning/research/), [platform strategy](planning/strategy.md) (roadmap and go-to-market), [longer-term ideas](planning/ideas.md) | Complete |
| `design/` | [Technical design](design/technical-design.md) (approved 2026-10-17), [decisions log](design/decisions.md). Spike write-ups go in `design/spikes/`, look and feel in `design/ui.md` (mock-ups in `design/mockups/`), and ticket specs and build plans in `design/plans/` (start from [the template](design/plans/TEMPLATE.md)), such as [Zinc wallet connection and buying, ALL-32](design/plans/ALL-32-zinc-connection.md). | Complete |
| `.claude/` | Shared Claude Code settings (turns on the Superpowers plugin; runs the local setup check at session start) | Done |
| `apps/web/` | The one web app (Next.js). Products live in `modules/lists` and `modules/concierge`; see its [README](apps/web/README.md) | Lists live; concierge from Wave 2 |
| `apps/extension/` | Chrome capture extension: save what's on screen to a person. How to build and load it is in its [README](apps/extension/README.md) | MVP built (ALL-22), loaded unpacked |
| `packages/core/` | Pure shared logic (dates, deadlines, budgets) and database types | W1-5 |
| `supabase/` | Database migrations and local Supabase settings (`config.toml`) | Lists tables today |
| `scripts/` | Repo tooling, such as `dev-check.mjs` (the local setup check) | Done |
| `spikes/` | Throwaway Wave 1 experiments (Zinc, AI, email) | Reference only |

## Getting started

1. Install [Claude Code](https://claude.com/claude-code), clone this repo, and open Claude Code in it.
2. Trust the folder when asked, and accept the prompt to install the **Superpowers** plugin. It's required for all development here (`.claude/settings.json` turns it on). If no prompt appears, run `/plugin install superpowers@claude-plugins-official` and restart Claude Code.

3. Set up your machine for local development (next section). Claude Code checks this every time a session starts and walks you through anything missing.

## Local development

**Check your machine any time with `pnpm dev:check`.** It lists what's missing and how to fix it on Windows, Mac or Linux. Claude Code runs the same check when a session starts (a `SessionStart` hook in `.claude/settings.json`) and offers to walk you through any gaps, so after pulling a change that adds a new requirement, your next session will tell you.

| You need | Why | How to get it |
|---|---|---|
| Node 22+ | Runs everything | Windows: `winget install -e --id OpenJS.NodeJS.LTS` · Mac: `brew install node@22` |
| pnpm | Package manager for this repo | `npm install -g pnpm` |
| Dependencies | Includes the **Supabase CLI**, pinned in `package.json`, so there's nothing to install globally | `pnpm install` from the repo root |
| Docker | The Supabase CLI runs a full local Supabase (database, auth, storage) in Docker containers | **Windows:** `wsl --install --no-distribution` as admin, restart Windows, then `winget install -e --id Docker.DockerDesktop`, open Docker Desktop and accept its terms. **Mac:** in Terminal, `brew install --cask docker-desktop` (it asks for your Mac password), then open Docker Desktop and accept its terms. |
| Playwright's Chromium and WebKit | Run the browser tests (`apps/web/e2e/`) as an Android phone (Chromium) and an iPhone (WebKit, Safari's engine) | `pnpm --filter @gifts-af/web exec playwright install chromium webkit` |

**Local database.** With Docker Desktop running:

```bash
pnpm supabase start    # first run downloads images (a few minutes); applies supabase/migrations/
pnpm supabase status   # local URLs and keys; Studio (the database UI) is at http://127.0.0.1:54323
pnpm supabase db reset # rebuild the local database from the migrations, e.g. after pulling new ones
pnpm supabase stop     # stop the containers; your local data is kept
pnpm db:test           # run the database tests in supabase/tests/ (privacy rules, keys, cascades)
pnpm test:db           # run the Vitest files that use the real local database and its API (order races, buying, Zinc connect and events; `pnpm test` leaves them out). Needs `pnpm supabase start`; skips when it isn't running, but fails in CI, whose db job starts it
pnpm check:bundle      # after pnpm build: fail if a Zinc key prefix or a Vault function name is in the browser code (CI runs it)
pnpm db:types          # regenerate packages/core/src/database.types.ts after changing the schema
pnpm db:push:dev       # apply new migrations to dev (CI does this on every merge to main; by hand only to recover)
pnpm db:push:prod      # apply new migrations to prod (same; add --dry-run to see what would run)
pnpm live-check        # signed-in checks on giftsaf.com with the shared test account (needs `pnpm supabase login`; see Production test account)
pnpm ai:eval           # check capture extraction against the fixtures with the real model (~10¢, needs AI_GATEWAY_API_KEY; not in CI)
```

Write new migrations with `pnpm supabase migration new <name>` and test them locally before they go to `dev` or `prod`. Local settings live in `supabase/config.toml`. Every new user-owned table needs `user_id`, its privacy rule and a test in `supabase/tests/` (see `design/decisions.md` T26). CI runs `pnpm db:test` and fails if the generated types are stale.

**Before the first migration push to a hosted project (`dev` or `prod`):** `config.toml` only exposes the `concierge` and `lists` schemas locally. On each hosted project, add both under Project Settings > Data API > Exposed schemas (admin, as allensforever711), or the app's queries fail with `PGRST106`. Do it **right after** pushing the migration that creates the schema, never before. Exposing a schema that doesn't exist yet takes the whole Data API down (every request gets a 503; tested locally on 2026-10-25). That project also needs Postgres 15 or later; the migrations use `on delete set null (column)`.

**Browser tests (Playwright):** with the local database running, `pnpm --filter @gifts-af/web e2e`. They sign in as a throwaway local account (created for you, email and password, since local Supabase has no Google) at phone width (375 px). They build the app first (about 30 seconds, and type errors stop the run) and test that production build, as CI's `e2e` job does. They need port 3100 free; if the port is busy the run fails, rather than testing old code. Set `E2E_PORT` to use another port, so several worktrees can run them at once. To test a server that's already running, set `E2E_BASE_URL`. CI keeps the downloaded browsers in a cache until `pnpm-lock.yaml` changes, so most runs install only the system packages the browsers need; both install steps time out after 15 minutes (the system packages come from Ubuntu's mirror, which can take 7 minutes or more), so a stuck download fails well short of the hour-long hangs we used to see and can be re-run (ALL-100).

**Writing a browser test** (T62, ALL-103):

- **Which browsers run it.** A test runs on the iPhone (WebKit) only, unless it's tagged `@layout`: `test("…", { tag: "@layout" }, async ({ page }) => …)`. Tagged tests run on the Android phone, the iPhone and desktop Chrome. Tag a test when it checks how something looks or fits: no sideways scrolling, positions, tap sizes, dark mode. Behavior (what happens when you press things, what's saved) is the same in every browser, so it runs once. Check layout with the helpers in `e2e/phone-layout.ts` (`phoneLayoutProblems`, `scrollsSideways`): they fail an untagged test with "tag this test @layout" (ALL-107). Don't write "@layout" in a test's title, because Playwright reads any `@word` in a title as a tag.
- **Signing in.** Call `signIn(page)` from `e2e/sign-in.ts` (or `signIn(page, user)` for `SECOND_USER` or an account from `createFreshUser()`), then open the page you're testing. It signs in through Supabase's API, without the login form, so it's fast. Only tests of the login form itself fill in the form: `pnpm lint` fails any other test that finds the password field (by label, placeholder or role), and those tests disable the rule on that line with a comment saying why (ALL-107).

**Running the web app:** follow [apps/web/README.md](apps/web/README.md) to link Vercel and pull the environment variables, then `pnpm dev`. Before a PR, `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle` (CI runs the same).

**Deploys:** Vercel project `gift-me` (team GiftsAF, slug `gift-me3`) builds `apps/web` from this repo. Every push to `main` deploys to production; every other branch gets a preview URL.

## Environments

| Environment | Database | Used by |
|---|---|---|
| Local | Supabase in Docker (`pnpm supabase start`) | Your machine, when you point `apps/web` at it |
| `dev` | Supabase project `gift-me-dev` (ref `bcemtqvdbrrgiipzggyw`) | `pnpm dev` with pulled Vercel variables, and every PR preview |
| `prod` | Supabase project `gift-me` (ref `pegtrucfuaaufqvsavpb`), GiftsAF's original project with real users | Production (`main`) only, at **https://giftsaf.com** (`www` redirects there; the old https://gift-me-beige.vercel.app still works) |

- **How Vercel picks the database:** the Supabase integration provides `NEXT_PUBLIC_GIFT_SUPABASE_*` (prod) to every environment. Development and Preview also have `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set to `dev`, and `apps/web/lib/supabase/env.ts` reads those first. The integration store (Vercel → Storage → gift-me) is connected to Production only, so `vercel env pull` keeps prod's server-side keys off developer machines. `pnpm live-check` reads prod's admin key through the Supabase CLI, in memory only, for the length of a run (T60).
- **Migrations go local → `dev` → `prod`, automatically on merge (T50).** After every push to `main`, CI's `migrate` job runs `pnpm db:push:dev`, then `pnpm db:push:prod` only if `dev` succeeded. It uses the GitHub secret `SUPABASE_ACCESS_TOKEN` (a Supabase access token of allensforever711), and no database password. Because Vercel deploys the same merge at the same time, **every migration must be expand-then-contract** (E7): add the new thing first, and remove the old thing in a later migration once no live code uses it.
  - **New schemas** still need adding under Exposed schemas in each project's dashboard *after* the migration lands, never before. The job doesn't do this.
  - **Turning it off:** set the repo variable `MIGRATE_ON_MERGE` to `off` (GitHub → Settings → Secrets and variables → Actions → Variables). Delete the variable to turn it back on.
  - **By hand (recovery, or while it's off):** sign in once with `pnpm supabase login` (in a real terminal; it opens a browser, sign in as allensforever711). Then `pnpm db:push:dev --dry-run` shows what would run and `pnpm db:push:dev` applies it; the same for `prod`. Check with `pnpm supabase migration list --project-ref <ref>`. No link and no database password are needed. Both `dev` and `prod` record the four lists migrations as applied (`prod`'s were pasted in by hand and marked applied with `migration repair` on 2026-10-25).
- **Google sign-in** is on in `dev` and `prod` (2026-10-25). Since ALL-14 (2026-11-01) the consent screen shows **GiftsAF** with `giftsaf.com` as an authorized domain, and `prod`'s Auth Site URL is `https://giftsaf.com` (redirect URLs: `https://giftsaf.com/**` plus the old `gift-me-beige.vercel.app`). One OAuth client, "Supabase (dev + prod)", in the Google Cloud project **gift-me** (allensforever711), redirects to both projects' `/auth/v1/callback`. The consent screen is in **testing** mode, so only listed test users can sign in. Add people under Google Auth Platform → Audience → Test users. The secret lives only in Google Cloud and the Supabase dashboards. Local Docker Supabase stays email-only, so nobody needs the secret; test Google sign-in on `dev` or a PR preview. `dev`'s redirect URLs allow `http://localhost:3000/**` and every preview (`https://*-gift-me3.vercel.app/**`).
- **Calling previews from the database:** previews sit behind Vercel's login. A Vercel "protection bypass for automation" secret is stored in `dev`'s Vault as `vercel_preview_bypass`. Send it as the `x-vercel-protection-bypass` header, e.g. from `pg_net`, which was tested on 2026-10-25. It never opens production.
- **Keys and secrets live in Vercel's environment variables, nowhere else.** Every app key (Resend, Zinc, cron secrets…) is a variable on the `gift-me` project, set per environment (Development, Preview, Production). Anyone signed in as allensforever711 (T25) gets them with `vercel env pull` (see [apps/web/README.md](apps/web/README.md)), and each one is listed, without its value, in `apps/web/.env.example`. **Development values (dev or test keys) stay normal** so `vercel env pull` works for everyone; normal variables are still encrypted. **Production secrets are marked "Sensitive"**: nobody can read them back, only the running app uses them, and if one is needed it's reissued from the vendor. Today the pull gives you the dev Supabase URL and key, the AI Gateway token, `RESEND_API_KEY`, `HOLIDAY_LOGO_DATES` (when the logo wears its Christmas hat, T35), the Turnstile bot-check keys `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (Cloudflare's always-pass test keys outside production, T43), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (the Google client for the Contacts import, T45), and `ZINC_API_KEY` (Zinc's test-mode key in development, live key in production). `EMAIL_OUTBOX` is not on Vercel: set it to `log` in your local `.env.local` to log emails instead of sending them (Playwright sets it itself; ignored in production, ALL-28). `SUPABASE_SECRET_KEY` is the server-only Supabase key that lets server code write tables users can't (action links, notifications, later the round engine): the `dev` project's key in Development and Preview, while production uses the integration's `GIFT_SUPABASE_SECRET_KEY`. It is never sent to the browser (ALL-23, T38). GitHub secrets are only for CI, since nobody can read them back. **Set keys up once, properly:** when a ticket needs a new vendor, create its dev and prod keys and add them here first, then build against the pulled dev key. Spikes use the same keys; there are no throwaway spike keys (owner, 2026-11-01: we work in a full-trust team, so a key seen in a session isn't rotated). Never commit a key to git.
- **Round engine on/off:** `round_engine_enabled` in `concierge.app_settings` (0 = off, 1 = on). It ships off everywhere; ALL-29 turns it on in production (decision 53). Vercel Cron calls `GET /api/rounds/tick` daily at 12:00 UTC (T49); with the switch off the tick only logs `round_tick {enabled:false}`. To stop a misbehaving engine, set the row to 0, no deploy needed. A round that keeps failing logs `round_stuck` at claim time on each retry, visible in the Vercel logs.
- **Paid features on/off for a user (ALL-94, decision 53):** anything that spends money runs only for users with `concierge.accounts.paid_features` on. Until premium is scoped, that means test and admin users. Users can't set it themselves. An admin sets it in the Supabase SQL editor (signed in as allensforever711), using the person's email from `auth.users`:

  ```sql
  insert into concierge.accounts (user_id, paid_features)
  select id, true from auth.users where email = 'PERSON_EMAIL'
  on conflict (user_id) do update set paid_features = excluded.paid_features;
  ```

  To turn it off, run the same statement with `false`. Check it with `select email, paid_features from concierge.accounts a join auth.users u on u.id = a.user_id where paid_features;`. Without the flag, captures still save but aren't read, and the person page and extension say why. To stop reading for everyone instead, set `capture_extraction_enabled` to 0.
- `pg_cron` and `pg_net` are on in `dev` only and aren't used: Vercel Cron runs the round tick (T49).

## Zinc wallet ordering (ALL-32, ALL-30)

Users connect their own Zinc account in Settings, and approved gifts are bought from their Zinc wallet. Spec and plan: [design/plans/ALL-32-zinc-connection.md](design/plans/ALL-32-zinc-connection.md). **Production ships with ordering off** (`zinc_ordering_enabled` = 0) until the owner's live test.

**Environment variables** (listed in `apps/web/.env.example`; set per environment in Vercel):

| Variable | What it does |
|---|---|
| `ZINC_ENV` | `test` (Zinc's sandbox: the key is issued without the Allow step) or `live` (the real sign-in and Allow). Anything else, or unset, turns connecting and buying off in that environment. |
| `ZINC_API_BASE` | Zinc's API address. No fallback. |
| `ZINC_WALLET_URL` | Where the Settings guide sends a user to add a card and turn on auto top-up. **[Verify]** the address with a real Zinc login. |

**Settings** (rows in `concierge.app_settings`; change them in the Supabase SQL editor as allensforever711, no deploy needed):

| Key | Default | What it does |
|---|---|---|
| `zinc_ordering_enabled` | 0 | Kill switch for buying. 1 lets orders go to Zinc, 0 holds them as paused. See "Stop all ordering". |
| `order_price_margin_pct` | 10 | Percent above an idea's estimated total that an order's max price may reach. |
| `funding_lookahead_days` | 21 | Days ahead that the Settings look-ahead and the heads-up warning count upcoming gifts. |
| `funding_topup_suggest_cents` | 10000 | Auto top-up amount the Settings guide suggests, in cents. |
| `zinc_topup_fee_bps` | 290 | Zinc's card top-up fee, in basis points (290 = 2.9%), shown in the guide. |
| `zinc_topup_fee_fixed_cents` | 30 | Fixed part of Zinc's top-up fee, in cents, shown in the guide. |
| `hold_reminder_days` | 7 | Days before the ship-by deadline that a held gift gets its reminder email. |
| `hold_final_days` | 2 | Days before the deadline that a held gift gets its final email. |
| `zinc_timeout_ms` | 15000 | How long one Zinc call may take before it counts as timed out. |
| `zinc_retry_attempts` | 3 | Quick retries of a Zinc call that failed with a network error or 5xx. |
| `zinc_retry_base_ms` | 1000 | First retry delay; it doubles each time, with jitter. |
| `zinc_place_budget_ms` | 45000 | Time one run may spend starting Zinc orders; later ones wait for the next run. |
| `zinc_poll_claim_seconds` | 30 | How long one browser tab holds the connect poll before another may poll. |
| `placing_stale_minutes` | 30 | Minutes an order may stay "placing" before the sweep looks it up at Zinc. |

### Connecting Zinc on each environment

- **Local, `dev` and previews:** set `ZINC_ENV=test` with a Zinc sandbox key. Connecting skips the Allow step, and sandbox orders cost nothing. Local `supabase/seed.sql` turns ordering on; on `dev` switch it on by hand.
- **Production:** set `ZINC_ENV=live`. Connecting sends the user to Zinc to sign in and click Allow; their key and webhook secret go to Vault, never to the browser. Leave `zinc_ordering_enabled` at 0 until the owner's live order has worked.
- **How we see it working:** the events `zinc.connected`, `order.place_result` and `zinc.order_settled` in the Vercel logs, and the order in the user's Zinc dashboard.

### Stop all ordering

**You see:** something is buying wrongly, or Zinc is having a bad day. **Do this** in the Supabase SQL editor (as allensforever711):

```sql
update concierge.app_settings set value = '0' where key = 'zinc_ordering_enabled';
```

- Approved gifts are held as `paused`, and nobody is emailed.
- A run already in progress finishes the orders it has started; the switch is checked at the next order it begins.
- Set the value back to `'1'` and the held gifts are placed on the next daily tick, with no user step.

### Unconfirmed orders

**You see:** the event `order.unconfirmed`. We sent an order to Zinc and Zinc has no record of it, so we don't know if it was bought. The gift stays live (it can't be bought twice).

1. Open Zinc's dashboard for the buyer's account and find the order by our `order_id` in its metadata (the id in the event).
2. If it exists, settle it as placed. If it doesn't, settle it as failed:

   ```sql
   select concierge.settle_order('USER_ID', 'ORDER_ID', 'placed', null, '{"provider_order_id": "ZINC_ORDER_ID"}');
   select concierge.settle_order('USER_ID', 'ORDER_ID', 'failed', 'failed', null);
   ```

3. The customer is emailed automatically on the next tick.

### Alerts (events with `alert: true`)

| Event | What it means | What to do |
|---|---|---|
| `order.sweep_skipped` | The sweep that looks up stuck "placing" orders couldn't run: `no_key` (the user's key is missing) or `env_mismatch` (`ZINC_ENV` differs from the environment the key was made in). | Fix `ZINC_ENV` for the environment, or ask the user to reconnect Zinc in Settings. The orders stay "placing" until then. |
| `order.sweep_failed` | Looking up a stuck "placing" order at Zinc failed (Zinc down, an answer we couldn't read, or our database). `kind` and `code` say which. | Nothing if it clears on the next tick (the sweep runs every tick and never resends). If it repeats for the same `order_id`, check Zinc's status and the buyer's key; if Zinc can't find the order, follow **Unconfirmed orders**. |
| `round_skip_email_failed` | A gift was skipped at its deadline but the "skipped" email failed to send. | Check Resend. The next tick retries. |
| `round_deadline_email_held_open` | The same, and the deadline has already passed, so the round stays open to keep retrying. | Fix the email problem (Resend status, key). It closes itself once the email goes. |
| `order.ordered_email_failed` | The "your gift is ordered" email failed. | Check Resend. It is retried on the next tick. |

Where new docs go, how to write them, and when to push straight to `main` versus open a PR are in [CLAUDE.md](CLAUDE.md). Claude reads it automatically, and it's written for people too. Other AI tools read [AGENTS.md](AGENTS.md), which points them to it. The standing rule for everyone: no work without a Linear ticket, and no ticket done without its test evidence posted on it (T44).

## Production test account

To check a change on giftsaf.com while signed in, use **`allensforever711+qa@gmail.com`** (T60). Don't create another account for this, and don't use a real person's.

**To run a check**, from the repo root:

```
pnpm live-check                                 # the standing read-only check
pnpm live-check e2e-live/my-ticket.spec.ts      # one spec
pnpm live-check --headed                        # watch it in a browser
```

It signs in, runs the Playwright specs in `apps/web/e2e-live/` against giftsaf.com, then ends the session and deletes its file. Run one at a time, because everyone shares the account. For a ticket's own check, add a spec to that folder, with a line saying what it checks. CI doesn't run these.

You need the Supabase CLI signed in as allensforever711 (`pnpm supabase login`, T25) and Playwright's Chromium (`pnpm --filter @gifts-af/web exec playwright install chromium`). The account has no known password, and the sign-in form won't work for a script, because the Turnstile bot check keeps its button disabled. The command gets a one-time login through the admin API instead, so don't try to get around Turnstile.

**Rules:**

- **Leave it as you found it.** A spec that adds anything removes it in `test.afterEach`, so a failed check still cleans up. Specs that only read are best. A PR adding a spec here gets checked for this in review.
- **No people, and nothing that buys or emails.** Adding a person can schedule real gift rounds on production, so test those paths locally. If a ticket truly needs them on production, ask the owner first.
- **Post the result on the ticket**, as a live check (T44).

## Shared material

- [Roadmap](https://claude.ai/artifact/6D9ycNqhN2yGwvHwsWAaiW): all three products (Gift Concierge, gift lists, scan-to-gift) by now, next and later. Live status is in [Linear projects](https://linear.app/allens-forever/projects).
- [Go-to-market plan](https://claude.ai/artifact/XXghrwZVuTndZNBvnyhkxg): how scan-to-gift brings people in, gift lists keep them, and Gift Concierge earns. Use cases, handoffs between products, and launch phases.
- [Linear project: Gift Concierge MVP](https://linear.app/allens-forever/project/gift-concierge-mvp-d065ee52b117) (tickets labeled Wave 1–6)
- [Pitch deck](https://claude.ai/artifact/9aUauzPty1VKRSKgrZhmHT) (Claude artifact; ask the owner for access)
