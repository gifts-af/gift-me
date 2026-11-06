# Gifts AF platform (working name)

One app for three products (T19): **gift lists** (live, formerly the GiftsAF repo), **Gift Concierge** (being built) and **scan-to-gift** (later). Gift Concierge is an app that keeps track of friends and family, what they like, and the dates that matter. It picks gifts for those dates and buys them, with as much or as little automation as the user wants and safeguards so nothing gets purchased without time to approve.

## Workspace layout

| Folder | Purpose | Status |
|---|---|---|
| `planning/` | Product discovery: [PRD](planning/PRD.md) (approved 2026-10-17), [decisions log](planning/decisions.md), [research](planning/research/), [platform strategy](planning/strategy.md) (roadmap and go-to-market), [longer-term ideas](planning/ideas.md) | Complete |
| `design/` | [Technical design](design/technical-design.md) (approved 2026-10-17), [decisions log](design/decisions.md). Spike write-ups go in `design/spikes/`, look and feel in `design/ui.md` (mock-ups in `design/mockups/`), and ticket specs and build plans in `design/plans/` (start from [the template](design/plans/TEMPLATE.md)). | Complete |
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
pnpm db:types          # regenerate packages/core/src/database.types.ts after changing the schema
pnpm db:push:dev       # apply new migrations to dev (CI does this on every merge to main; by hand only to recover)
pnpm db:push:prod      # apply new migrations to prod (same; add --dry-run to see what would run)
pnpm ai:eval           # check capture extraction against the fixtures with the real model (~10¢, needs AI_GATEWAY_API_KEY; not in CI)
```

Write new migrations with `pnpm supabase migration new <name>` and test them locally before they go to `dev` or `prod`. Local settings live in `supabase/config.toml`. Every new user-owned table needs `user_id`, its privacy rule and a test in `supabase/tests/` (see `design/decisions.md` T26). CI runs `pnpm db:test` and fails if the generated types are stale.

**Before the first migration push to a hosted project (`dev` or `prod`):** `config.toml` only exposes the `concierge` and `lists` schemas locally. On each hosted project, add both under Project Settings > Data API > Exposed schemas (admin, as allensforever711), or the app's queries fail with `PGRST106`. Do it **right after** pushing the migration that creates the schema, never before. Exposing a schema that doesn't exist yet takes the whole Data API down (every request gets a 503; tested locally on 2026-10-25). That project also needs Postgres 15 or later; the migrations use `on delete set null (column)`.

**Browser tests (Playwright):** with the local database running, `pnpm --filter @gifts-af/web e2e`. They sign in as a throwaway local account (created for you, email and password, since local Supabase has no Google) at phone width (375 px). If `pnpm dev` is already running on port 3100 it's reused; otherwise one is started. CI runs them against a production build (`e2e` job).

**Running the web app:** follow [apps/web/README.md](apps/web/README.md) to link Vercel and pull the environment variables, then `pnpm dev`. Before a PR, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (CI runs the same).

**Deploys:** Vercel project `gift-me` (team GiftsAF, slug `gift-me3`) builds `apps/web` from this repo. Every push to `main` deploys to production; every other branch gets a preview URL.

## Environments

| Environment | Database | Used by |
|---|---|---|
| Local | Supabase in Docker (`pnpm supabase start`) | Your machine, when you point `apps/web` at it |
| `dev` | Supabase project `gift-me-dev` (ref `bcemtqvdbrrgiipzggyw`) | `pnpm dev` with pulled Vercel variables, and every PR preview |
| `prod` | Supabase project `gift-me` (ref `pegtrucfuaaufqvsavpb`), GiftsAF's original project with real users | Production (`main`) only, at **https://giftsaf.com** (`www` redirects there; the old https://gift-me-beige.vercel.app still works) |

- **How Vercel picks the database:** the Supabase integration provides `NEXT_PUBLIC_GIFT_SUPABASE_*` (prod) to every environment. Development and Preview also have `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set to `dev`, and `apps/web/lib/supabase/env.ts` reads those first. The integration store (Vercel → Storage → gift-me) is connected to Production only, so prod's server-side keys stay off developer machines.
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

Where new docs go, how to write them, and when to push straight to `main` versus open a PR are in [CLAUDE.md](CLAUDE.md). Claude reads it automatically, and it's written for people too. Other AI tools read [AGENTS.md](AGENTS.md), which points them to it. The standing rule for everyone: no work without a Linear ticket, and no ticket done without its test evidence posted on it (T44).

## Production test account

To check a change on giftsaf.com while signed in, use **`allensforever711+qa@gmail.com`** (T60). Don't create another account for this, and don't use a real person's.

**To run a check**, from the repo root:

```
pnpm live-check                                 # the standing read-only check
pnpm live-check e2e-live/my-ticket.spec.ts      # one spec
pnpm live-check --headed                        # watch it in a browser
```

It signs in, runs the Playwright specs in `apps/web/e2e-live/` against giftsaf.com, and deletes the session afterwards. For a ticket's own check, add a spec to that folder, with a line saying what it checks. CI doesn't run these.

You need the Supabase CLI signed in as allensforever711 (`pnpm supabase login`, T25). That's the only setup. The account has no known password, and the sign-in form won't work for a script, because the Turnstile bot check keeps its button disabled. The command gets a one-time login through the admin API instead, so don't try to get around Turnstile.

**Rules:**

- **Leave it as you found it.** Remove any gifts you added, and check the "You" card reads "Start your wish list". Tests can't assume it's empty if a check failed halfway.
- **No people, and nothing that buys or emails.** Adding a person can schedule real gift rounds on production, so test those paths locally. If a ticket truly needs them on production, ask the owner first.
- **Post the result on the ticket**, as a live check (T44).

## Shared material

- [Roadmap](https://claude.ai/artifact/6D9ycNqhN2yGwvHwsWAaiW): all three products (Gift Concierge, gift lists, scan-to-gift) by now, next and later. Live status is in [Linear projects](https://linear.app/allens-forever/projects).
- [Go-to-market plan](https://claude.ai/artifact/XXghrwZVuTndZNBvnyhkxg): how scan-to-gift brings people in, gift lists keep them, and Gift Concierge earns. Use cases, handoffs between products, and launch phases.
- [Linear project: Gift Concierge MVP](https://linear.app/allens-forever/project/gift-concierge-mvp-d065ee52b117) (tickets labeled Wave 1–6)
- [Pitch deck](https://claude.ai/artifact/9aUauzPty1VKRSKgrZhmHT) (Claude artifact; ask the owner for access)
