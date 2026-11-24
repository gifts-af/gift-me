# Engineering and operations

How the team installs, runs and operates GiftsAF. The rules for working in this repo are in [CLAUDE.md](../CLAUDE.md). The product pitch is the [README](../README.md).

## Install

**On the team?** Open [Claude Code](https://claude.com/claude-code) and paste this. You don't need to read the rest of this section.

```
Install https://github.com/gifts-af/gift-me on this computer by following design/operations.md > Install in that repo.
```

**Claude:** follow these steps in order. Do everything you can yourself and keep the person's part small. Ask for one thing at a time, in plain words, and only for what they alone can do: a password or admin prompt, a restart, a sign-in, accepting terms. Don't explain the tools unless they ask. After any restart, they say "continue the install" and you pick up where you left off.

If a tool isn't found right after installing it, Claude Code's PATH is out of date, on any operating system. Use the tool's full path, or ask them to restart Claude Code.

1. **Check they're on the team.** Ask for their GitHub login and whether they can see themselves at https://github.com/orgs/gifts-af/people. If they can't, stop here, before installing anything, and ask them to get an invitation from the owner. This install is for team members only.
2. **Open the repo.** Git is needed first. On Mac, also install Homebrew if it's missing: its installer needs their password, so have them run it with the `!` prefix. If this session isn't inside a clone, clone the repo. Then ask them to reopen Claude Code in that folder and trust it, because the repo's hook and plugin settings load when a session starts.
3. **Turn on Superpowers.** If `superpowers:*` skills aren't available, have them run `/plugin install superpowers@claude-plugins-official` and restart Claude Code.
4. **Install the tools.** Run `pnpm dev:check`, or install Node and pnpm first if it can't run. Fix each `MISS` using the table under [Local development](#local-development), then run the check again until nothing is missing.
5. **Prove the local database works.** Run `pnpm supabase start`, then `pnpm db:test`.
6. **Connect their own accounts.** Contribution work uses their personal accounts (see `CLAUDE.md` > Accounts).
   - **Git:** ask which email their GitHub account uses for commits, and set `git config user.name` and `user.email` in this clone to match.
   - **GitHub CLI:** install it (`winget install -e --id GitHub.cli`, or `brew install gh`), then have them run `! gh auth login`.
   - **Linear:** if Linear's tools aren't available, run `claude mcp add --transport http linear https://mcp.linear.app/mcp`, then have them sign in through `/mcp` with their own account.
7. **Get the app's settings.** The Vercel sign-in uses the shared **allensforever711** account (T25), and they sign in themselves: suggest `! npx vercel login`. If they don't have that account's login, ask them to get it from the owner. Never ask them to paste a password or key into the chat. Then, from `apps/web`:

   ```bash
   npx vercel link --yes --project gift-me --scope gift-me3
   npx vercel env pull .env.development.local
   ```

   `vercel link` also adds a line to `apps/web/.gitignore`, so discard that with `git checkout -- apps/web/.gitignore`. Add `EMAIL_OUTBOX=log` to `apps/web/.env.local`, so testing logs emails instead of sending them. **Never change which Vercel environments the Supabase integration is connected to:** it's Production-only on purpose, to keep prod's keys off laptops (see [Environments](#environments)).
8. **Confirm it works.** Run `pnpm dev` and check that http://localhost:3000/auth/login loads. Tell them in two lines what's running and how to start it again. With the pulled settings, the app uses the shared hosted `dev` database, not the local one. The local database is for tests and for trying new migrations.

Don't change hosted systems during install: no `pnpm db:push:*`, no Supabase CLI sign-in, and no changes to Vercel settings.

## Workspace layout

| Folder | Purpose | Status |
|---|---|---|
| `planning/` | Product discovery: [PRD](../planning/PRD.md) (approved 2026-10-17), [decisions log](../planning/decisions.md), [research](../planning/research/), [platform strategy](../planning/strategy.md) (roadmap and go-to-market), [longer-term ideas](../planning/ideas.md) | Complete |
| `design/` | This file, [technical design](technical-design.md) (approved 2026-10-17), [decisions log](decisions.md). Spike write-ups go in `design/spikes/`, look and feel in `design/ui.md` (mock-ups in `design/mockups/`), and ticket specs and build plans in `design/plans/` (start from [the template](plans/TEMPLATE.md)), such as [Zinc wallet connection and buying, ALL-32](plans/ALL-32-zinc-connection.md). | Complete |
| `.claude/` | Shared Claude Code settings (turns on the Superpowers plugin; runs the local setup check at session start) | Done |
| `apps/web/` | The one web app (Next.js). Products live in `modules/lists` and `modules/concierge`; see its [README](../apps/web/README.md) | Lists live; concierge from Wave 2 |
| `apps/extension/` | Chrome capture extension: add gifts to your list or save what's on screen to a person. How to build and load it is in its [README](../apps/extension/README.md) | On the Chrome Web Store, unlisted (ALL-65) |
| `packages/core/` | Pure shared logic (dates, deadlines, budgets) and database types | W1-5 |
| `supabase/` | Database migrations and local Supabase settings (`config.toml`). The [database map](https://claude.ai/artifact/9uCRGGJL5Tu4X53VCYV3Rk) draws every table and how they connect | 33 tables in four schemas |
| `scripts/` | Repo tooling, such as `dev-check.mjs` (the local setup check) | Done |
| `spikes/` | Throwaway Wave 1 experiments (Zinc, AI, email) | Reference only |

Where new docs go, how to write them, and when to push straight to `main` versus open a PR are in [CLAUDE.md](../CLAUDE.md). Claude reads it automatically, and it's written for people too. Other AI tools read [AGENTS.md](../AGENTS.md), which points them to it. The standing rule for everyone: no work without a Linear ticket, except quick touch-ups, and no ticket done without its test evidence posted on it (T44, T64).

## Local development

**Check your machine any time with `pnpm dev:check`.** It lists what's missing and how to fix it on Windows, Mac or Linux. Claude Code runs the same check when a session starts (a `SessionStart` hook in `.claude/settings.json`) and offers to walk you through any gaps, so after pulling a change that adds a new requirement, your next session will tell you.

| You need | Why | How to get it |
|---|---|---|
| Node 22+ | Runs everything | Windows: `winget install -e --id OpenJS.NodeJS.LTS` · Mac: `brew install node@22 && brew link --overwrite node@22` |
| pnpm | Package manager for this repo | `npm install -g pnpm` |
| Dependencies | Includes the **Supabase CLI**, pinned in `package.json`, so there's nothing to install globally | `pnpm install` from the repo root |
| Docker | The Supabase CLI runs a full local Supabase (database, auth, storage) in Docker containers | **Windows:** `wsl --install --no-distribution` as admin, restart Windows, then `winget install -e --id Docker.DockerDesktop`, open Docker Desktop and accept its terms. **Mac:** in Terminal, `brew install --cask docker-desktop` (it asks for your Mac password), then open Docker Desktop and accept its terms. |
| Playwright's Chromium and WebKit | Run the browser tests (`apps/web/e2e/`) as an Android phone (Chromium) and an iPhone (WebKit, Safari's engine) | `pnpm e2e:browsers` (on Linux this also installs the system packages the browsers need) |

**Local database.** With Docker Desktop running:

```bash
pnpm supabase start    # first run downloads images (a few minutes); applies supabase/migrations/
pnpm supabase status   # local URLs and keys; Studio (the database UI) is at http://127.0.0.1:54323
pnpm supabase db reset # rebuild the local database from the migrations, e.g. after pulling new ones (not needed for leftover test data: see db:clean)
pnpm supabase stop     # stop the containers; your local data is kept
pnpm db:start:tests    # start only the services the tests need (no Studio or Mailpit); what CI runs
pnpm db:clean          # delete the test accounts and put app_settings back as seeded; waits for any test run in progress (see Sharing the local database)
pnpm db:test           # run the database tests in supabase/tests/ (privacy rules, keys, cascades); one run at a time, after db:clean
pnpm test:changed      # quick local loop: only the unit tests your changes since origin/main affect (a change to a Vitest config reruns everything). CI always runs the full `pnpm test`
pnpm test:db           # run the Vitest files that use the real local database and its API (order races, buying, Zinc connect and events; `pnpm test` leaves them out). Needs `pnpm supabase start`; skips when it isn't running, but fails in CI, whose db job starts it. One run at a time, after db:clean
pnpm check:bundle      # after pnpm build: fail if a Zinc key prefix or a Vault function name is in the browser code (CI runs it)
pnpm db:types          # regenerate packages/core/src/database.types.ts after changing the schema
pnpm db:types:check    # fail if that file doesn't match the local database (CI runs it)
pnpm db:map            # redraw the database map into design/database-map.html after a schema change, and commit it (CLAUDE.md > The database map page)
pnpm db:map:check      # fail if the committed map doesn't match the local database (CI runs it)
pnpm e2e               # the browser tests: build the app against the local database, then test it (see Browser tests below). One run at a time, after db:clean
pnpm e2e:browsers      # install Playwright's Chromium and WebKit; e2e:browsers:deps installs only their Linux system packages (CI, when the browsers are cached)
pnpm db:push:dev       # apply new migrations to dev (CI does this on every merge to main; by hand only to recover)
pnpm db:push:prod      # apply new migrations to prod (same; add --dry-run to see what would run)
pnpm live-check        # signed-in checks on giftsaf.com with the shared test account (needs `pnpm supabase login`; see Production test account)
pnpm gallery          # screenshot the main screens (phone, phone dark, desktop) and every email into apps/web/gallery/index.html, for reviewing by eye. Needs `pnpm supabase start`; builds like the browser tests (E2E_PORT works too). One run at a time, after db:clean
pnpm extension:package # build the prod extension and zip it for the Chrome Web Store (apps/extension/README.md > Release a new version)
pnpm ai:eval           # check capture extraction against the fixtures with the real model (~10¢, needs AI_GATEWAY_API_KEY; not in CI)
pnpm ai:eval --ideas   # idea engine on the 5 fixture people, real AI and Zinc; checks AC-2/5/6, prints AI and Zinc cents per run; --ai-cents-max N (default 25). **SPENDS MONEY (about 20-25¢ AI per person plus Zinc lookups): run only with Jim's go-ahead, never in CI.** Needs AI_GATEWAY_BASE, AI_GATEWAY_API_KEY, ZINC_API_BASE, ZINC_API_KEY; refuses before any call without them
```

Write new migrations with `pnpm supabase migration new <name>` and test them locally before they go to `dev` or `prod`. Local settings live in `supabase/config.toml`. Every new user-owned table needs `user_id`, its privacy rule and a test in `supabase/tests/` (see `design/decisions.md` T26). CI runs `pnpm db:test`, and `pnpm db:types:check` fails it if the generated types are stale.

**Sharing the local database.** Every checkout and every Claude session on a machine uses the same local Supabase, so the commands that test against it take turns and start from a clean slate. `pnpm db:test`, `pnpm test:db`, `pnpm e2e`, `pnpm gallery` and `pnpm db:clean` all go through `scripts/db-clean.mjs`, which:

1. **Takes a lock for the whole run** (a Postgres advisory lock on its own connection). If another run holds it, it prints `waiting for another test run on the local database to finish...` and waits. The lock dies with the process, so a crashed or Ctrl-C'd run never blocks the next one.
2. **Cleans**, under that lock: deletes every account at `@example.com`, `@example.test` or `@example.com.<id>.test` (what the tests create; their people, rounds and orders go with them) and the tests' far-future tick heartbeats, and puts every `app_settings` value back to what a fresh `db reset` gives. It reads those values from `supabase/migrations/` and `supabase/seed.sql`, so there's no list to keep in step. It takes about a second. A setting from another checkout's newer migration is left alone.
3. **Runs the command**, still holding the lock.

So leftovers from a killed run, a switch a test left flipped, or another session's browser tests no longer break your run, and nobody needs `db reset` for test data (only for new migrations). Don't sign up locally with an `example.com` or `example.test` address you want to keep: the next test run deletes it. CI runs the same scripts; with one run per job, the lock is never contended.

**Before the first migration push to a hosted project (`dev` or `prod`):** `config.toml` only exposes the `concierge` and `lists` schemas locally. On each hosted project, add both under Project Settings > Data API > Exposed schemas (admin, as allensforever711), or the app's queries fail with `PGRST106`. Do it **right after** pushing the migration that creates the schema, never before. Exposing a schema that doesn't exist yet takes the whole Data API down (every request gets a 503; tested locally on 2026-10-25). That project also needs Postgres 15 or later; the migrations use `on delete set null (column)`.

**Browser tests (Playwright):** with the local database running, `pnpm e2e`. They sign in as a throwaway local account (created for you, email and password, since local Supabase has no Google) at phone width (375 px). They build the app first (about 30 seconds, and type errors stop the run) and test that production build. CI's `e2e` job runs the same command, so its build is the same as yours. They need port 3100 free: the run waits for its own server to start, so if anything else holds the port, even one taken during the build, the run fails rather than testing someone else's code (ALL-108). Set `E2E_PORT` to use another port, so a worktree's run doesn't clash with another's dev server (runs themselves take turns; see Sharing the local database). To test a server that's already running, set `E2E_BASE_URL`. CI keeps the downloaded browsers in a cache until `pnpm-lock.yaml` changes, so most runs install only the system packages the browsers need; both install steps time out after 15 minutes (the system packages come from Ubuntu's mirror, which can take 7 minutes or more), so a stuck download fails well short of the hour-long hangs we used to see and can be re-run (ALL-100).

**Reviewing screens and emails by eye:**

- `pnpm gallery` signs in as a fresh local account with one person and a one-gift list, screenshots each screen on a phone (light and dark) and on desktop, screenshots every email on the phone, and writes `apps/web/gallery/index.html` (not committed). It's published as the [screens and emails page](https://claude.ai/artifact/9mrDvFAgoqxvxmzirJFCz6); CLAUDE.md > Updating the screens and emails page says how to republish it. To add a screen, add a line to `SIGNED_OUT` or `SIGNED_IN` in `apps/web/e2e/gallery.shots.ts`. It checks nothing and CI doesn't run it.
- `/dev/emails` shows every email at phone and desktop widths in the running app: under `pnpm dev` and on any PR preview. Everywhere else, production included, returns 404. You need to be signed in.

**Writing a browser test** (T62, ALL-103):

- **Which browsers run it.** A test runs on the iPhone (WebKit) only, unless it's tagged `@layout`: `test("…", { tag: "@layout" }, async ({ page }) => …)`. Tagged tests run on the Android phone, the iPhone and desktop Chrome. Tag a test when it checks how something looks or fits: no sideways scrolling, positions, tap sizes, dark mode. Behavior (what happens when you press things, what's saved) is the same in every browser, so it runs once. Check layout with the helpers in `e2e/phone-layout.ts` (`phoneLayoutProblems`, `scrollsSideways`): they fail an untagged test with "tag this test @layout" (ALL-107). Don't write "@layout" in a test's title, because Playwright reads any `@word` in a title as a tag.
- **What belongs in a browser test** (T67, ALL-118, after [the test pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)). Browser tests are the slowest and flakiest tests we have, so each feature gets **one journey through its main path**. Every other acceptance criterion goes to the lowest level that can catch it: a component test (Testing Library) for what a screen shows and does (it may stub one of our server actions, but only when a browser or local-db test covers that action for real, T67), a local-db Vitest test or pgTAP for what's saved and who can see it, and a plain unit test for rules. Before writing a browser test, check that a lower-level test doesn't already cover it. If a browser test finds a bug that no lower-level test caught, add the lower-level test too.
- **Keep journeys and layout apart.** Don't tag a long journey `@layout`, because that runs the whole journey on three browsers. Write a short `@layout` test instead: set up the state, open the page and check its layout. Set up state as the user, through the same functions the app calls, wherever the app can create it (`e2e/seed.ts`, `createFreshUser()`). Use the service role only for rows the app can't create itself, such as AI facts. A computer-width check skips the phones (`test.skip(isMobile, …)`, so it runs on desktop only), and every check uses its project's own screen size. A test that checks the test helpers themselves runs on one browser.
- **Signing in.** Call `signIn(page)` from `e2e/sign-in.ts` (or `signIn(page, user)` for `SECOND_USER` or an account from `createFreshUser()`), then open the page you're testing. It signs in through Supabase's API, without the login form, so it's fast. Only tests of the login form itself fill in the form: `pnpm lint` fails any other test that finds the password field (by label, placeholder or role), and those tests disable the rule on that line with a comment saying why (ALL-107).

**What CI skips (ALL-117):** a push to `main` that only changes `planning/`, `design/` or Markdown files runs no CI, including `migrate`. The PR title check is its own workflow (`.github/workflows/pr-title.yml`), so fixing a title re-runs only that. Changing a PR's base branch no longer re-runs `check`; push again to re-test against the new base.

**Unit tests in the web app** run in plain Node, except component tests (`.tsx`, `.jsx`), which get a fake browser (jsdom) and `test/setup.ts`. A `.ts` test that needs `window` or `localStorage` starts with `// @vitest-environment jsdom` (ALL-147).

**Running the web app:** follow [apps/web/README.md](../apps/web/README.md) to link Vercel and pull the environment variables, then `pnpm dev`. Before a PR, `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:bundle` (CI runs the same).

**Deploys:** Vercel project `gift-me` (team GiftsAF, slug `gift-me3`) builds `apps/web` from this repo. Every push to `main` deploys to production; every other branch gets a preview URL.

## Environments

| Environment | Database | Used by |
|---|---|---|
| Local | Supabase in Docker (`pnpm supabase start`) | Your machine, when you point `apps/web` at it |
| `dev` | Supabase project `gift-me-dev` (ref `bcemtqvdbrrgiipzggyw`) | `pnpm dev` with pulled Vercel variables, and every PR preview |
| `prod` | Supabase project `gift-me` (ref `pegtrucfuaaufqvsavpb`), GiftsAF's original project with real users | Production (`main`) only, at **https://giftsaf.com** (`www` redirects there; the old https://gift-me-beige.vercel.app still works) |

- **Docs-only pushes don't deploy (2026-11-20).** Each Vercel build stores a full copy of the app, and the free plan's 10 GB of Function Storage filled up, so Vercel began deleting old deployments. `apps/web/vercel.json`'s `ignoreCommand` runs `scripts/vercel-ignore-build.mjs`, which skips the build when every file changed since the last deployed commit never reaches the app: it's in `design/`, `planning/`, `.claude/`, `.superpowers/` or `.github/`, or is Markdown outside `apps/` and `packages/`. Anything else builds, including a file moved out of the app and a previous commit it can't find. It's deploy-time only, so it has no `pnpm` script (E10); its tests are in `apps/web/test/vercel-ignore-build.test.ts`. To turn it off, remove `ignoreCommand`. The skipped deploy shows as "Canceled" in Vercel, and production stays on the last build. To force a deploy, use Redeploy in the Vercel dashboard.
- **How Vercel picks the database:** the Supabase integration provides `NEXT_PUBLIC_GIFT_SUPABASE_*` (prod) to every environment. Development and Preview also have `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set to `dev`, and `apps/web/lib/supabase/env.ts` reads those first. The integration store (Vercel → Storage → gift-me) is connected to Production only, so `vercel env pull` keeps prod's server-side keys off developer machines. `pnpm live-check` reads prod's admin key through the Supabase CLI, in memory only, for the length of a run (T60).
- **Migrations go local → `dev` → `prod`, automatically on merge (T50).** After every push to `main`, CI's `migrate` job runs `pnpm db:push:dev`, then `pnpm db:push:prod` only if `dev` succeeded. It uses the GitHub secret `SUPABASE_ACCESS_TOKEN` (a Supabase access token of allensforever711), and no database password. Both scripts run `scripts/db-push.mjs`, which links a scratch copy of `supabase/` and pushes through Supabase's IPv4 pooler, because GitHub's runners can't reach a project's direct (IPv6) address (2026-11-16). Your own checkout's link is never touched. **A paused project fails the push:** Supabase's free plan pauses an idle project, and an admin unpauses it in the Supabase dashboard. Because Vercel deploys the same merge at the same time, **every migration must be expand-then-contract** (E7): add the new thing first, and remove the old thing in a later migration once no live code uses it.
  - **New schemas** still need adding under Exposed schemas in each project's dashboard *after* the migration lands, never before. The job doesn't do this.
  - **Don't push a branch's migrations to `dev` before it merges.** `dev` would then have migrations `main` doesn't, so every merge in between fails the `migrate` job with "Remote migration versions not found in local migrations directory" (ALL-32, 2026-11-06: two unrelated merges went red). To test a migration on hosted Supabase before merging, do it inside a transaction you roll back (Supabase MCP `execute_sql` or the SQL editor), or merge first. If it happens anyway, it clears itself once the branch merges; nothing needs repairing.
  - **Turning it off:** set the repo variable `MIGRATE_ON_MERGE` to `off` (GitHub → Settings → Secrets and variables → Actions → Variables). Delete the variable to turn it back on.
  - **By hand (recovery, or while it's off):** sign in once with `pnpm supabase login` (in a real terminal; it opens a browser, sign in as allensforever711). Then `pnpm db:push:dev --dry-run` shows what would run and `pnpm db:push:dev` applies it; the same for `prod`. Check with `pnpm supabase migration list --project-ref <ref>`. No link and no database password are needed. Both `dev` and `prod` record the four lists migrations as applied (`prod`'s were pasted in by hand and marked applied with `migration repair` on 2026-10-25).
- **Google sign-in** is on in `dev` and `prod` (2026-10-25). Since ALL-14 (2026-11-01) the consent screen shows **GiftsAF** with `giftsaf.com` as an authorized domain, and `prod`'s Auth Site URL is `https://giftsaf.com` (redirect URLs: `https://giftsaf.com/**` plus the old `gift-me-beige.vercel.app`). One OAuth client, "Supabase (dev + prod)", in the Google Cloud project **gift-me** (allensforever711), redirects to both projects' `/auth/v1/callback`. The consent screen is in **testing** mode, so only listed test users can sign in. Add people under Google Auth Platform → Audience → Test users. The secret lives only in Google Cloud and the Supabase dashboards. Local Docker Supabase stays email-only, so nobody needs the secret; test Google sign-in on `dev` or a PR preview. `dev`'s redirect URLs allow `http://localhost:3000/**` and every preview (`https://*-gift-me3.vercel.app/**`).
- **Calling previews from the database:** previews sit behind Vercel's login. A Vercel "protection bypass for automation" secret is stored in `dev`'s Vault as `vercel_preview_bypass`. Send it as the `x-vercel-protection-bypass` header, e.g. from `pg_net`, which was tested on 2026-10-25. It never opens production.
- **Keys and secrets live in Vercel's environment variables, nowhere else.** Every app key (Resend, Zinc, cron secrets…) is a variable on the `gift-me` project, set per environment (Development, Preview, Production). Anyone signed in as allensforever711 (T25) gets them with `vercel env pull` (see [apps/web/README.md](../apps/web/README.md)), and each one is listed, without its value, in `apps/web/.env.example`. **Development values (dev or test keys) stay normal** so `vercel env pull` works for everyone; normal variables are still encrypted. **Production secrets are marked "Sensitive"**: nobody can read them back, only the running app uses them, and if one is needed it's reissued from the vendor. Today the pull gives you the dev Supabase URL and key, the AI Gateway token, `RESEND_API_KEY`, `HOLIDAY_LOGO_DATES` (when the logo wears its Christmas hat, T35), the Turnstile bot-check keys `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (Cloudflare's always-pass test keys outside production, T43), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (the Google client for the Contacts import, T45), and `ZINC_API_KEY` (Zinc's test-mode key in development, live key in production). `EMAIL_OUTBOX` is not on Vercel: set it to `log` in your local `.env.local` to log emails instead of sending them (Playwright sets it itself; ignored in production, ALL-28). `SUPABASE_SECRET_KEY` is the server-only Supabase key that lets server code write tables users can't (action links, notifications, later the round engine): the `dev` project's key in Development and Preview, while production uses the integration's `GIFT_SUPABASE_SECRET_KEY`. It is never sent to the browser (ALL-23, T38). GitHub secrets are only for CI, since nobody can read them back. **Set keys up once, properly:** when a ticket needs a new vendor, create its dev and prod keys and add them here first, then build against the pulled dev key. Spikes use the same keys; there are no throwaway spike keys (owner, 2026-11-01: we work in a full-trust team, so a key seen in a session isn't rotated). Never commit a key to git.
- **Round engine on/off:** `round_engine_enabled` in `concierge.app_settings` (0 = off, 1 = on). It ships off everywhere; ALL-29 turns it on in production (decision 53). Vercel Cron calls `GET /api/rounds/tick` daily at 12:00 UTC (T49); with the switch off the tick creates no rounds and sends no ideas or approval reminders, but the money path still runs, so a customer is always told what is happening with a purchase (owner): it settles orders left placing, retries "ordered" emails, and moves on rounds that need attention (holds, failures, the deadline), logging `round_tick {enabled:false}` with what it did. To stop a misbehaving engine, set the row to 0, no deploy needed. **Moved dates (T92):** `moved_dates_close_rounds` = 0 stops a changed birthday or anniversary from ending its open round. After a code rollback the database rule stays on, so set it to 0; until then old code logs `round_failed` for a round a move ended mid-step, can send the email in flight, and says "This gift round was stopped". `round_ended_by_move` is a normal log line: the engine stopped work on a round whose date changed. To stop buying, use `zinc_ordering_enabled` (**Stop all ordering** below). A round that keeps failing logs `round_stuck` at claim time on each retry, visible in the Vercel logs.
- **Round fan-out on/off (ALL-125, T76):** `round_fanout_enabled` (0 = the tick does the rounds itself, 1 = it sends each due round to a queue and one function call runs each). It ships 0 everywhere. See **Round fan-out** below for turning it on and what to do when it misbehaves.
- **Paid features on/off for a user (ALL-94, decision 53):** anything that spends money runs only for users with `concierge.accounts.paid_features` on. Until premium is scoped, that means test and admin users. Users can't set it themselves. An admin sets it in the Supabase SQL editor (signed in as allensforever711), using the person's email from `auth.users`:

  ```sql
  insert into concierge.accounts (user_id, paid_features)
  select id, true from auth.users where email = 'PERSON_EMAIL'
  on conflict (user_id) do update set paid_features = excluded.paid_features;
  ```

  To turn it off, run the same statement with `false`. Check it with `select email, paid_features from concierge.accounts a join auth.users u on u.id = a.user_id where paid_features;`. Without the flag, captures still save but aren't read, and the person page and extension say why. To stop reading for everyone instead, set `capture_extraction_enabled` to 0.
- `pg_cron` and `pg_net` are on in `dev` only and aren't used: Vercel Cron runs the round tick (T49).

## Zinc wallet ordering (ALL-32, ALL-30)

Users connect their own Zinc account in Settings, and approved gifts are bought from their Zinc wallet. Spec and plan: [design/plans/ALL-32-zinc-connection.md](plans/ALL-32-zinc-connection.md). **Production ships with ordering off** (`zinc_ordering_enabled` = 0) until the owner's live test.

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
| `zinc_place_budget_ms` | 45000 | Time one run (a daily tick, a webhook, a settings or address save) may spend starting Zinc orders, shared by every round it places; later ones wait for the next run. Keep it well under the 300 s `maxDuration` of the routes and pages that place (a request in flight can add `zinc_timeout_ms` × `zinc_retry_attempts`). |
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

- Approved gifts are held as `paused`, and nobody is emailed. A gift already waiting on the buyer's Zinc balance stops getting "top up" reminders (topping up wouldn't buy it while ordering is off).
- A held gift that reaches its deadline while ordering is off gets the "that's on us" email (`missed_on_us`), never "skipped".
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

3. The customer is emailed automatically on the next tick ("ordered", or "we couldn't buy it" when the round has already closed).

### Alerts (events with `alert: true`)

| Event | What it means | What to do |
|---|---|---|
| `order.shared_address_notice_failed` | The email asking a list owner to check their saved address, after a store couldn't use it, was refused, or finding the owner failed. The buyer has already been told. | Nothing, if it clears: the daily tick tries again. If it repeats, check Resend (status, key, a bounced address). |
| `order.shared_address_notice_abandoned` | That email kept being refused for `check_address_retry_days`, so we stopped and deleted the rejected address. The owner was never told. | Tell the owner yourself if you can. Check Resend for why their address is refused. |
| `order.sweep_skipped` | The sweep that looks up stuck "placing" orders couldn't run: `no_key` (the user's key is missing) or `env_mismatch` (`ZINC_ENV` differs from the environment the key was made in). | Fix `ZINC_ENV` for the environment, or ask the user to reconnect Zinc in Settings. The orders stay "placing" until then. |
| `order.sweep_failed` | Looking up a stuck "placing" order at Zinc failed (Zinc down, an answer we couldn't read, or our database). `kind` and `code` say which. | Nothing if it clears on the next tick (the sweep runs every tick and never resends). If it repeats for the same `order_id`, check Zinc's status and the buyer's key; if Zinc can't find the order, follow **Unconfirmed orders**. |
| `order.unconfirmed` | The sweep looked up an order stuck "placing" and Zinc has no record of it, so we don't know if it was bought. The buyer has been told "we're confirming your gift". | Open the buyer's Zinc dashboard, find the order by our `order_id` in its metadata (the `order_id` in the event), and settle it with `concierge.settle_order` as placed or failed (**Unconfirmed orders** above). The buyer is emailed on the next tick. |
| `zinc.webhook_unmatched` | Zinc sent an order event we can't tie to any order of ours, and Zinc says it has no such order for that buyer's key (or the order carries no reference). `zinc_event` isn't logged, so find the event in the buyer's Zinc dashboard by `provider_order_id`. What it means depends on the event: **placed or failed**, the buyer's order may be stuck "placing" or "unconfirmed"; **cancelled**, the store cancelled a gift and Zinc refunded the buyer, who hasn't been told; **a tracking event** (tracking, shipped, estimate, delivered), only where a gift is was missed. | **Placed or failed:** settle ours with `concierge.settle_order` as placed or failed (**Unconfirmed orders** above). **Cancelled:** find our order (the buyer's rounds, by gift and date), then run `select * from concierge.store_cancel_order('<user_id>', '<order_id>', current_date, <refund in cents, or null>);`. Before the ship-by date the next look emails the buyer with the fix link; on or after it the next daily news run tells them. **A tracking event:** usually nothing. If it was a delivered event and the round's other gifts have arrived, run `select * from concierge.mark_delivered('<user_id>', '<order_id>', 'zinc');` and the tick sends the delivered email. |
| `tracking.news_failed` | The daily tracking summary (late, back-on-time or store-cancelled news) for one buyer couldn't be sent: the email was refused, or claiming or sending it threw. The keys are given back, so nothing is lost. (A failed gift lookup is `tracking.news_run_failed` instead.) | **Order tracking** below, "News isn't going out". |
| `tracking.news_release_failed` | The summary failed and then giving the claimed keys back failed too, so those gifts won't be told on the next run. | **Order tracking** below, "News isn't going out", step 4. |
| `tracking.news_run_failed` | The whole daily news step threw before it could look at buyers (a setting or the database). No news went out that day. | **Order tracking** below, "News isn't going out". |
| `tracking.delivered_email_failed` | The "your gifts arrived" email was refused or couldn't be built, from a Zinc `delivered` event, the buyer's "It arrived" tap, or the daily retry. | **Order tracking** below, "Delivered email isn't going out". |
| `tracking.delivered_retry_failed` | The tick's retry of unsent delivered emails threw before it could try any. | **Order tracking** below, "Delivered email isn't going out". |
| `round_skip_email_failed` | A held gift's round closed at its deadline and the "skipped" email that followed was refused. It is sent once, best effort: the round is already closed, so nothing retries it. Since ALL-116 it goes only when no gift failed: a failure found at closing gets the "we couldn't buy it" email instead. | Check Resend. Then tell the buyer by hand that the gift wasn't bought and nothing was charged for it (`round_id` and `user_id` are in the event). |
| `round_deadline_email_held_open` | The same, and the deadline has already passed, so the round stays open to keep retrying. | Fix the email problem (Resend status, key). It closes itself once the email goes. |
| `round_store_cancelled_email_failed` | At a round's deadline, the email saying the store cancelled a gift (and the money is back) was refused or threw. The keys are given back and the round stays open, so the next look tries again; a refusal while the round was already closing leaves it to the daily news run instead. | Check Resend (status, key, a bounced address). Nothing else if it clears on the next look. If the deadline has passed and it repeats, it also raises `round_deadline_email_held_open`: follow that row. |
| `round_failure_email_failed` | The email telling the buyer that a gift (or several) couldn't be bought was refused (ALL-116). Nothing is lost: the failures go back to untold, the round's other work (placing a held gift) still runs, and the next look sends it. If the round closes first, the "we couldn't buy it" email tells them instead. | Nothing if it clears on the next look. If it repeats for the same `round_id`, check Resend (status, key, a bounced address). |
| `order.ordered_email_failed` | The "your gift is ordered" email failed. | Check Resend. It is retried on the next tick. |
| `order.failed_late_email_failed` | The "we couldn't buy it" email failed. It tells every failure the buyer hasn't heard about once a round has closed, in one email: a gift still placing at the deadline that failed, an unconfirmed one settled as failed, or a failure untold when the round closed (the deadline, the cancel link, the person removed or the occasion turned off). | Check Resend. It is retried on the next tick until it goes. |
| `ideas.not_configured` | A round's idea run couldn't start because the AI Gateway or Zinc isn't set up on this environment. No run is counted and nothing is spent, so without this the round would wait silently until it skips at its deadline. The event carries `round_id`, `user_id` and `person_id`. | Ideas can't run on this environment: set `AI_GATEWAY_BASE`, `AI_GATEWAY_API_KEY`, `ZINC_API_KEY` and `ZINC_API_BASE` on it (Vercel environment variables, then redeploy), or turn `idea_engine_enabled` off (**Gift idea engine** below). |
| `ideas.zinc_unauthorized` | Zinc refused the app's own key on every product lookup in an idea run, so the run failed. Buyers stop getting ideas until it's fixed. | Check `ZINC_API_KEY` on that environment (it must be the app's key, T17, not a user's) and the app account's balance in Zinc's dashboard. The round tries again on a later tick. |
| `round_fanout_send_failed` | The tick couldn't hand some due rounds to the queue (`count` of them), even after one retry. They stay due, so the next tick tries again. | **Round fan-out** below, "Sends are failing". |
| `round_job` with `alert: true` and `result: "failed"` | **This is the alert.** A job failed before it claimed any round: the wiring (Zinc or email setup, an environment variable) or a setting it reads first (`round_fanout_enabled`, `round_engine_enabled`, the schedule settings, `zinc_place_budget_ms`). It is redelivered, up to `maxDeliveries` (3); `delivery_count` says which try, and the error's `name`/`code` say what threw. A `round_job` with `result: "failed"` and no `alert` is a step failing after the claim: a log, not an alert (see the runbook). | **Round fan-out** below, "A job failed before it claimed". |
| `round_job` with `reason: "bad_signature"` | The job route got a message whose signature doesn't check. It ran nothing and acknowledged the message. | **Round fan-out** below, "Bad signature". |
| `ideas.daily_limit_reached` | A round's idea run was refused because today's `idea_round_runs_per_day` is used up. Nothing failed; the round waits for tomorrow's tick. | **Round fan-out** below, "Daily limit reached". |
| `ideas.no_credit` | An idea run found the AI Gateway credit gone (a 402) before any AI reply was paid for. The run isn't counted and the buyer isn't emailed: the round waits. With fan-out off the tick starts no further idea run; with fan-out on each due round's job starts its own run, so expect one of these (or `ideas.daily_limit_reached`) per due round, up to `idea_round_runs_per_day` runs a day. The event carries `round_id` and `user_id`. The next 14:00 UTC health email says the same. | **AI credit** under **Health email** below: top up by hand, since auto top-up is off. |
| `reactions.run_failed` | The daily step that closes answered rounds and asks how gifts went over threw: a setting or the database, or the close itself (the asking still ran first). Nothing was lost; the next tick tries again. | **Gift reactions** below, "Reactions aren't going out". |
| `reactions.ask_failed` | One round's "how did it go?" email failed at `phase` `claim`, `read`, `send` or `forget`. The key is given back, so the next tick asks again until the round's close date. | **Gift reactions** below, "Reactions aren't going out". |
| `tick.heartbeat_failed` | Writing the tick's heartbeat row (or a job adding its failure to it) failed. The tick or job itself is unaffected. | Nothing if it's one-off. If it repeats, check the database; the health email's "tick didn't finish" line can then be wrong for that day. |
| `health.send_failed` | Resend refused the owner's health email. The route answers 500. | Check Resend (status, key, a bounced inbox). The next day's check sends again; read `concierge.health_snapshot` by hand meanwhile. |
| `cost.record_failed` | A cost wasn't recorded (the client, the timeout setting or the write failed). The user's action went through. | **Cost tracking** below. |
| `health.costs_failed` | The Monday costs read failed; the email says so. | **Cost tracking** below. |

Log-only alerts (rows above with no health-email line) need the Vercel logs, and Hobby keeps them about an hour (ALL-135), so look soon after one fires. The health email doesn't depend on logs: it reads the database and the vendor balances.

### Rolling back ALL-116 (failure emails)

Code and migration ship together. If the code is rolled back with Vercel's instant rollback, the older engine runs on the new schema and keeps working. Nothing needs undoing.

**What the buyer may see:** the older engine doesn't read the new `fail:<order id>` keys, so while it runs, a round whose failure was already told can get the older single failure email again. Rolling forward sends no repeats: `untold_failures` counts an older `fail:<n>:notice` key as telling every failure that happened before it. Rounds are off on production until ALL-29 (decision 53), so only test and admin buyers can see a repeat. **[Claude's call]**

### Rolling back ALL-120 (base budget)

Vercel's instant rollback brings back the old budget section, which can't show or clear a base budget, while `round_candidates` keeps using it. After the rollback, run `delete from concierge.budgets where occasion_kind = 'any';` on the database. This deletes base budgets people typed, for good, which is fine before launch. Occasion budgets are untouched (T73).

## Gifts in progress (ALL-167)

**What it does:** Home and a person's page list every gift round that can still change or has a gift on its way ([ui.md](ui.md) > Gifts in progress). Read-only.

| Setting (`concierge.app_settings`) | Default | Meaning |
|---|---|---|
| `gift_progress_days` | 14 | Days a bought gift stays listed: after it was delivered, or after the later of the occasion and its due day when it was never marked delivered. With no row, the list isn't shown (`gifts_in_progress_failed`); the rest of both pages works, so deleting the row turns the list off |

| Event (ids only, E6) | Means |
|---|---|
| `gifts_in_progress_failed` | The list couldn't be read (or the setting is missing), so it wasn't shown |
| `gift_progress_read_failed` | One person's list or shared address (`what`), the paid check or what placing checks (`hold_gate`) couldn't be read; their lines say less, the rest are unchanged |
| `gift_progress_round_failed` | One round's line couldn't be worked out, so that row was left out |
| `round_hold_failed` | The round page couldn't read a held gift's address or what placing checks, so it says "Waiting to order" |

## Order tracking (ALL-33)

**What it does:** Zinc's tracking webhooks fill in where each bought gift is. The daily tick sends one summary email per buyer for late, back-on-time and store-cancelled-after-ship-by news. The buyer can tap "It arrived" on a shipped gift. Design: [technical design §6.6](technical-design.md), decision T89.

**Settings** (`concierge.app_settings`)

| Setting | Default | Meaning |
|---|---|---|
| `order_tracking_enabled` | 1 | Off switch for tracking, shipped, estimate and delivered events and the "It arrived" button. Events are logged and ignored. Store cancels are always handled |
| `zinc_tracking_fetch_enabled` | 1 | Off stops the one `GET /orders/{id}` per tracking event (it fetches the carrier estimate). Packages are still saved; the late check then uses the store's own range |
| `late_check_enabled` | 1 | Off switch for the late check and its emails. Store cancels are still told |
| `tracking_prune_days` | 30 | Days after an order is delivered (or failed, or its occasion passed without a delivery) before the daily tick clears its tracking numbers; 0 turns the clear-out off. A missing row fails the step loudly (`housekeeping.tracking_prune_failed`) |

**Turn it off:** set the row to 0 with SQL on that environment's database, no deploy needed.

**Events** (ids only, E6)

| Event | Means |
|---|---|
| `tracking.event_ignored` | A tracking event was dropped: switched off, an old event, or an order that can't take it |
| `tracking.news_run` | The daily news step finished (`sent` = emails sent) |
| `housekeeping.tracking_pruned` | The daily clear-out finished (`cleared` = orders whose tracking numbers were cleared) |

### News isn't going out

For `tracking.news_failed`, `tracking.news_release_failed` or `tracking.news_run_failed`:

1. Look at the event's error fields (`name`, `code`) in the Vercel logs. Check Resend (status, key, a bounced address) for a refused email.
2. Nothing is lost for `news_failed`: the keys are given back and the next daily run tries again. Late news stops mattering after the occasion date, so look the same day.
3. For `news_run_failed`, check the database and that `late_check_enabled` and `order_tracking_enabled` exist in `app_settings`. To stop the noise while you fix it, set `late_check_enabled` to 0 (store cancels are still told).
4. For `news_release_failed`, the keys couldn't be given back, so those gifts stay marked as told although the email never went out. Don't delete every `late:`, `ontime:` or `cancel_late:` row for the buyer: that would also resend news they already got. Delete only the rows made in the failed run, using the event's `user_id` and the time it was logged (`created_at` is when the keys were claimed, a moment before the event):

   ```sql
   select round_id, step, created_at from concierge.round_sends
   where user_id = '<user_id from the event>'
     and (step like 'late:%' or step like 'ontime:%' or step like 'cancel_late:%')
     and created_at between '<event time minus 5 minutes>' and '<event time>';
   ```

   Check the list looks right, then delete exactly those `(round_id, step)` rows. The next daily run sends them; the newest key an order still has decides what it was last told, so a missing older one does no harm. If the occasion date has passed there is nothing to resend.

### Delivered email isn't going out

For `tracking.delivered_email_failed` or `tracking.delivered_retry_failed`: the round is already `delivered`, and the tick retries the email every day until it goes. Check Resend, then the event's error fields. If it keeps failing for one `round_id`, tell the buyer yourself; nothing else depends on it.

## Round fan-out (ALL-125)

Since T76 a busy morning is handled by many function calls instead of one. With `round_fanout_enabled` = 1, the daily tick does its housekeeping, then sends each due round (and each buyer's held gifts) to a Vercel Queues topic, `round-jobs`, and Vercel calls `/api/rounds/job` once per message. Design: `design/technical-design.md` §5.1.

**The switch.** `round_fanout_enabled` in `concierge.app_settings`: 0 = off, 1 = on. It ships 0 on every environment (the migration adds the row). To change it, set the row with SQL on that environment's database, no deploy needed. With it at 0 the tick works through rounds itself, as before, and any job that still arrives does nothing. If the tick can't read it, the tick runs as off; if a job can't read it, the job fails before its claim and is redelivered (the alert below).

**Turning it on, per environment.**
- **dev:** it is switched on briefly for the PR's preview check (the preview talks to dev; set it back to 0 afterwards), and again on dev per the after-merge steps. Either way, set it to 1 and call a preview's tick with the cron secret, the bypass header and `?now=` on a day with seeded due rounds. You should see `round_fanout` with `sent` equal to `due`, then one `round_job` per message, and the reminders in the outbox. `idea_engine_enabled` stays 0 and Zinc is the sandbox, so nothing is spent. Set it back to 0 afterwards.
- **production:** set it to 1 before ALL-29 switches rounds on. The next morning's logs should show `round_fanout`, then `round_job` lines.
- Queues is in Beta. Checking a deployment: its function list should show `/api/rounds/job` with a queue trigger and no public route.

**Settings it uses.** `idea_round_runs_per_day` (5: how many round idea runs may start a day, all rounds together), `tick_deadline_ms` (now one job's deadline for an idea run), `zinc_place_budget_ms` (per buyer's job) and `zinc_requests_per_second` (shared by the jobs). `maxConcurrency` (5) and `maxDeliveries` (3) are in `apps/web/vercel.json`, because Vercel reads them when it deploys; changing them is a code change.

**Sends are failing (`round_fanout_send_failed`).** Rounds are a day late at worst.
1. Check Vercel's status page and the project's Queues logs for the `round-jobs` topic. `round_fanout_send_threw` in the logs means a whole batch's send call threw; it carries the error's `name`, `code` and `status` (a log, not an alert). A thrown batch is sent once more with the same idempotency keys (`round:<round id>:<YYYY-MM-DD>`, `buyer:<user id>:<YYYY-MM-DD>:<first 12 hex of sha256 of the sorted round ids>`), so a batch the queue had already taken isn't delivered twice; if it throws again, its jobs are counted in the alert's `count`.
2. To get today's rounds moving, set `round_fanout_enabled` to 0 and call the tick again (or wait for tomorrow's): it runs the rounds itself.
3. Turn it back on once Queues is healthy.

**A job failed before it claimed (the alert: `round_job` with `alert: true`, `result: "failed"`, `delivery_count`).** The job failed while setting up, before it claimed any round, so nothing ran and no lease is held. That covers the wiring and the settings it reads first (`round_fanout_enabled`, `round_engine_enabled`, the schedule settings, `zinc_place_budget_ms`): an unreadable setting usually means the database was briefly unreachable. The queue delivers it again, up to 3 times, so a held gift due today isn't put off a day. The event's `name`/`code` say what threw. Check the environment variables the job needs (Zinc, email, Supabase keys) on that deployment and the database's health, and read that deployment's function logs around the time for the thrown error. If every delivery fails, set `round_fanout_enabled` to 0 so the tick runs the rounds itself, then fix the wiring.

**A step failed after the claim (a log, not an alert: `round_job` with `result: "failed"` and `kind`, `round_id` or `user_id`, and the error's `name`, `code`).** The job is acknowledged and not redelivered; the round's lease runs out and the next tick sends it again, as on the inline tick. A repeat for the same round surfaces as `round_failed` logs and, once `attempts` pass `round_max_attempts`, the `round_stuck` alert: follow its runbook (**Round engine on/off** above). If many jobs fail for unclear reasons, set `round_fanout_enabled` to 0.

**Bad signature (`round_job` with `reason: "bad_signature"`).** The tick signs every message with `CRON_SECRET` and the job refuses any without a valid signature. Either someone is calling the route directly (it should be private, so check the deployment's function list shows no public URL), or `CRON_SECRET` changed between the deployment whose tick sent the message and the one that ran it (messages stay with the deployment that sent them). Check the secret in Vercel's environment variables. If it was just changed, the next day's tick sends correctly signed messages and nothing else is needed.

**Daily limit reached (`ideas.daily_limit_reached`).** Round idea runs cost real money, so `idea_round_runs_per_day` is a brake. The refused rounds wait for the next tick, uncounted. If real buyers are being held back, raise the setting (the limits are revisited in ALL-135); if it fires with no real buyers waiting, look for something starting runs it shouldn't.

**Stopping a bad deployment.** Queued messages stay with the deployment that sent them, so switching off isn't enough. First set `round_fanout_enabled` to 0 (each job checks it before doing anything), then delete the bad deployment so its queued messages go with it. Vercel's instant rollback also works, but messages already sent stay pinned to the old deployment until they're handled or expire (24 hours, the SDK's default `retentionSeconds`), which is harmless because each job checks its round in the database.

**Invalid messages.** A message that doesn't parse logs `round_job {result: "invalid"}` and is acknowledged, since a retry can't fix it. It isn't an alert.

## Approving and fixing gifts (ALL-29)

Spec and plan: [design/plans/ALL-29-approval.md](plans/ALL-29-approval.md). Decisions T80 to T85. Pages: `/rounds/<id>`, `/rounds/<id>/buy`, `/rounds/<id>/fix/<orderId>`; changes are server actions in `app/rounds/actions.ts`. No new commands, settings beyond the two in the idea engine table, or environment variables.

**How we see it working** (Vercel logs, ids only, E6):

| Event | Means |
|---|---|
| `order.approved` | A buyer approved and orders were placed (`orders` count) |
| `order.replaced` | A failed gift was replaced through `replace_failed_order` (new order id, idea id, cap in cents) |
| `order.requote` | A price re-check on the fix page or at buy time: outcome and lookups made (`link_mismatch` and `other_marketplace` as below, with no lookup) |
| `round.ideas_rejected` | "None of these" with a new search to come: reason code, ideas rejected |
| `round.rejection_noted` | "None of these" with no search left: only the reason was saved, the ideas stay buyable |
| `round.budget_set` | A budget typed on an open round with none (cents) |
| `ideas.list_gift` | One list gift looked up in an idea run: store route and outcome (qualified, unsupported, over budget, stopped, `link_mismatch` for an Amazon link whose ASIN is unreadable or isn't the saved one, `other_marketplace` for an Amazon link outside amazon.com, ...) |

None of these is an alert. Rejected-then-regenerated rounds show up as `ideas.run_started` on the next tick.

**Turning it off:** `zinc_ordering_enabled` = 0 stops all buying (the pages still open and say so); `round_engine_enabled` = 0 stops new rounds and emails; `idea_engine_enabled` = 0 stops idea runs, list lookups included; or roll back in Vercel. The fix page's **Check today's price** (a paid lookup on the app's key) is off wherever buying is off: `zinc_ordering_enabled` = 0 stops it, and so does Zinc not being set up in that environment (`ZINC_ENV`, `ZINC_API_BASE` or `ZINC_WALLET_URL` missing). Either way it looks nothing up and says "Buying is switched off right now, so we didn't check the price." (`zinc_off`). It also refuses, with no lookup, once the round no longer needs attention, is closed, or reaches its ship-by day (`not_open`). The migration only adds things and tightens guards, so the old code runs on it (E7).

**Unused until a later contract migration:** the database function `reapprove_order` (replaced by `replace_failed_order`, T81) and the `excluded_products` helper (replaced by `concierge.order_is_given` and `excluded_offers`). Both stay so a Vercel rollback still works.

**Known gap (ALL-151):** adding gifts to a person's list doesn't wake a round waiting after `no_ideas`; only a new fact does (T82).

## Gift idea engine (ALL-27)

The engine finds gift ideas for a round and on demand (a person's Gift ideas screen). Spec and plan: [design/plans/ALL-27-idea-engine.md](plans/ALL-27-idea-engine.md). **It ships off on every environment** (`idea_engine_enabled` = 0) until Jim allows spending, because every run costs real money.

**Turning it off:** set `idea_engine_enabled` to `0` in `concierge.app_settings` (Supabase SQL editor as allensforever711, no deploy), or roll back in Vercel. Off means no AI or Zinc call, no run counted, and no email; a round waits and tries again on the next tick, and the Gift ideas screen shows no button, just "Suggestions are switched off right now." (a buyer without paid features sees "Gift ideas aren't available on your account yet." instead). Rounds themselves are off in production anyway (`round_engine_enabled` = 0).

**Environment variables** (listed in `apps/web/.env.example`):

| Variable | What it does |
|---|---|
| `AI_GATEWAY_BASE`, `AI_GATEWAY_API_KEY` | The AI Gateway address and key for the brainstorm and ranking. **Still open:** not yet set on Vercel preview or production, so set them (and turn the engine on) only with Jim's go-ahead **[Verify]** |
| `ZINC_API_BASE`, `ZINC_API_KEY` | Product lookups use the **app-owned Zinc key** (T17), never a user's wallet. `ZINC_API_KEY` is the app's key on each environment; a user's own key (Settings) is only for buying |

**Settings** (rows in `concierge.app_settings`; change them in the SQL editor, no deploy):

| Key | Default | What it does |
|---|---|---|
| `idea_engine_enabled` | 0 | 1 lets runs happen. Tests set it to 1 with fake vendors |
| `idea_candidates` | 8 | Candidates per brainstorm |
| `idea_max_searches` | 3 | Web searches per brainstorm |
| `idea_keep_min` / `idea_keep_max` | 3 / 5 | Fewer survivors than the first is logged as a shortfall; the second is the most ideas kept within budget (plus one over budget) |
| `idea_ai_timeout_ms` | 60000 | Per AI call |
| `idea_zinc_timeout_ms` | 15000 | Per Zinc call |
| `idea_ai_max_tokens` | 6000 | Output limit per AI call, which bounds the cost of the call in flight |
| `idea_tax_estimate_pct` | 8 | Flat tax estimate (needs no address) |
| `idea_run_estimate_cents` | 40 | The usual cost shown in the money notice |
| `idea_list_lookups_max` | 10 | The most Zinc lookups of a person's list gifts in one run (ALL-29, T82). The list pass also stops once `idea_keep_max` qualify |
| `idea_list_min` | 3 | With this many list gifts qualifying the AI brainstorm doesn't run; fewer and it adds ideas up to `idea_keep_max` (ALL-29, T82) |
| `idea_run_max_cents` | 100 | The most one run may spend (AI plus Zinc), shown in the notice. A run stops resolving at this figure and skips ranking if its worst case wouldn't fit (`stopped: cost_cap`) |
| `idea_round_runs_max` | 2 | Runs a round may use before it stops and emails the buyer. A new fact allows one more |
| `idea_rounds_per_tick` | 1 | Most rounds that make ideas in one tick. Raise it only with timings from `ideas.run` events (AC-28) |
| `idea_run_lease_ms` | 600000 | How long an unfinished on-demand run blocks another for the same person |
| `tick_deadline_ms` | 270000 | The idea pass starts no run after this, and runs are cut off at it, leaving 30 s of Vercel's 300 s. It never holds up placing orders or any other step |
| `zinc_lookup_cents` | 1 | Cost of one Zinc lookup, for the cost figure and cap |
| `zinc_requests_per_second` | 10 | Zinc's limit per key; a run never calls faster |

**Keep the brainstorm's worst case under `idea_run_max_cents`.** There is no check before the brainstorm call. Its output and searches are capped by settings (`idea_ai_max_tokens`, `idea_max_searches`), but the search results come back to the AI as input tokens, and no setting caps those, so we don't yet know its real worst case. The AC-28 runs on dev will give the real figure **[Verify]**. Raise any of these settings only after checking that figure against the cap.

**The tick and ideas.** Each tick does the money pass first (placing orders, the stale-order sweep, rejection notices). Then the idea pass runs, bounded by `tick_deadline_ms` and `idea_rounds_per_tick`. The deadline bounds only the idea pass: held (`needs_attention`) rounds and every other step run first with no deadline, as before. Rounds that don't get an idea turn before the deadline are released for the next tick. If `tick_deadline_ms` can't be read, the idea pass is skipped.

**Emails.** When a round gets no ideas, the buyer gets one "We don't have gift ideas for {name} yet" email (`no_ideas`), then a second after a new fact brings one more run, and the second promises no retry. Nothing is sent while the engine is off or the buyer isn't paid; the round skips silently at its deadline.

**Zinc offers are judged on the worst case:** orders don't choose a shipping method, so each offer is judged on its slowest delivery and its highest shipping price.

**How we see it working:** the events `ideas.run_started` and `ideas.run` in the Vercel logs, with ids, counts, stage, outcome and cents (AI plus Zinc), never names or gift text. `costUnknown: true` on `ideas.run` means an AI call was cut off by its timeout or the tick's deadline, its connection dropped, or its reply couldn't be read or priced, so its cost never came back and `cost_cents` is too low; check the Gateway's own spend for that time. Each run is also a row in `concierge.idea_runs`.

**Tests and money.** Browser tests use the fake Gateway (`apps/web/e2e/fake-gateway.ts`) and the fake Zinc (`e2e/fake-zinc.ts`), so they spend nothing. `pnpm ai:eval --ideas` is the only command that calls the real AI and Zinc for ideas; it spends money, so run it only with Jim's go-ahead, never in CI.

## Health email (ALL-35)

Once a day Vercel Cron calls `GET /api/health` at 14:00 UTC, two hours after the tick (T87). On Hobby a cron can start anywhere in its hour, so the tick runs 12:00–13:05 at the latest (it stops after 300 s) and the check 14:00–14:59: always at least about an hour apart. The route checks `CRON_SECRET` as the tick does. Its first query pings the database, which also keeps the free Supabase project from pausing (it replaced `/api/keepalive`, T22). Then it reads `concierge.health_snapshot`, the AI Gateway credit and the app's Zinc balance, and emails the owner inbox when something needs the owner. On `health_all_clear_weekday` (Monday) it always emails: the week's counts, plus "All clear" or the problems. Each line in the email carries ids only (round, order, user) and a **What to do** link to its heading below.

- **Turning it off:** set `health_email_enabled` to `0` in `concierge.app_settings`, no deploy needed. The ping still runs, so the database stays awake, and it logs `health.checked {result: "off"}`. Two emails still go with it at 0, because the setting can't be read first: "The database can't be reached" (the ping runs before any setting) and "The health check couldn't run" when the setting itself can't be read or the route's wiring fails.
- **How we see it working:** one `health.checked` event a day, with `result` (`sent`, `quiet`, `off`, `db_down`, `send_failed` or `failed`), `problems`, `sent` and `weekly`; a `failed` one also has `stage`. The route answers 500 for `db_down`, `send_failed` and `failed`, so Vercel's cron list shows the failure too. `health.send_failed` (an alert) means Resend refused the email. `health.vendor_check_failed {vendor}` means a balance couldn't be read in two tries; while something uses that vendor, the email says so too.
- **A check that can't run says so.** If a setting, the snapshot or the route's own wiring fails, the owner still gets a short fixed email, "The health check couldn't run", naming the stage it stopped at (see its heading below), so a broken checker never looks like a quiet day.
- **Rolling back:** an instant rollback also restores the older deployment's cron list ([Vercel: rollbacks and cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#rollbacks-and-promotions-with-cron-jobs)). Rolled back past this change, Vercel calls the old `/api/keepalive` again, which that deployment still has, so the database stays awake; only the health email stops. A run due in the minutes of the switch can be missed or reach the other deployment.
- **Off production,** `?now=` sets the check's clock, as on the tick.
- **The links** point at this file on the public GitHub repo (`main`), set in `healthWiring` (`apps/web/lib/wiring.ts`). If the engineering docs are hidden before launch, move the runbooks and change that link, or the email's links break.

**Settings** (rows in `concierge.app_settings`):

| Key | Default | What it does |
|---|---|---|
| `health_email_enabled` | 1 | 0 stops the email; the ping still runs |
| `health_all_clear_weekday` | 1 | The day the email always goes, in `Date.getUTCDay()` numbers (0 is Sunday) |
| `ai_credit_low_cents` | 500 | Warn when the AI Gateway credit drops below this |
| `zinc_app_balance_low_cents` | 500 | Warn when the app's Zinc balance drops below this |
| `health_vendor_timeout_ms` | 10000 | How long each vendor balance check may take, its two tries together. Both vendors run together, so keep it well under the route's 60 s |

It also reads `round_max_attempts`, `placing_stale_minutes`, `hold_final_days`, `idea_engine_enabled`, `capture_extraction_enabled` and `amazon_paste_lookup_enabled`. The AI credit is only checked while ideas or capture extraction are on, and the app's Zinc balance only while ideas or Amazon paste lookups are on, so switching those off doesn't bring a daily warning. A setting it can't read fails the check (`health.checked {result: "failed", stage: "settings", alert: true}`) and sends "The health check couldn't run"; there's no fallback value.

### The database can't be reached

The ping failed twice. Nothing else was read, so this is the only line.

1. Open the Supabase dashboard for the environment (as allensforever711). A paused project shows a **Restore** button: restore it. If Supabase shows an incident, wait for it to clear.
2. If the project is up, check the deployment's Supabase env vars in Vercel (`SUPABASE_SECRET_KEY`, or `GIFT_SUPABASE_SECRET_KEY` on production).
3. Call the route again with the cron secret, or wait for tomorrow's check, to confirm.

### The tick didn't finish

There's no heartbeat row for today in `concierge.tick_heartbeats`, or today's row started and never finished (Vercel stopped the tick at its 300 s limit). The line gives the last successful finish.

1. In Vercel, check the project's Cron Jobs list and the latest production deployment: crons only run on production.
2. Check `CRON_SECRET` on production. A tick refused for the secret writes no row.
3. Read the tick's function logs for `round_tick_failed` and `tick.heartbeat_failed`. A row that never finished means the run hit its time limit; see **Round fan-out** and `tick_deadline_ms` under **Gift idea engine**.
4. Once it's fixed, call the tick by hand with the secret: the rounds catch up. Running the tick again the same UTC day starts that day's heartbeat row afresh, so failures the morning's jobs already added drop out of that day's count (and the weekly email's).

### The tick reported failures

Today's tick finished with `result = 'failed'`, or some rounds couldn't be handed to the queue (fan-out sends). The line gives both counts.

- **Fan-out sends failed:** **Round fan-out**, "Sends are failing".
- **The tick failed:** read its function logs around 12:00 UTC for `round_tick_failed`, and see **Round engine on/off** under **Environments**. A round step that fails alone retries and isn't listed here: it's counted in the weekly email, and repeats show up as **Stuck rounds**.

### Stuck rounds

An open round has used `round_max_attempts` claims without finishing a step. The engine logs `round_stuck` on each retry.

1. Search the Vercel logs for the `round_id` (kept about an hour on Hobby, so look soon) and read the failing step's error `name` and `code`.
2. Fix the cause (a setting, Zinc, Resend), then reset the round's attempts: `update concierge.gift_rounds set attempts = 0 where id = 'ROUND_ID';`. The next tick tries again.
3. To stop the engine while you look: **Round engine on/off**.

### Order unconfirmed

We sent an order to Zinc and Zinc has no record of it. Follow **Unconfirmed orders** under **Zinc wallet ordering**, with the `order_id` and `user_id` in the line.

### Order stuck placing

An order has been `placing` since before today's tick, and for longer than `placing_stale_minutes`, so the tick's sweep already looked and couldn't settle it.

1. Search the logs for `order.sweep_skipped` or `order.sweep_failed` with that `order_id` (see **Alerts**).
2. Find the order in the buyer's Zinc dashboard by our `order_id`, then settle it as placed or failed, as in **Unconfirmed orders**.

### Held for a Zinc problem

An order is `held` with `hold_reason` `retry` (Zinc failed in a way worth trying again) or `not_allowed` (Zinc refused the buyer's account). Funds, setup, address and paused holds are the buyer's to fix, or the owner's own switch, and aren't listed.

- **`retry`:** check Zinc's status. The next tick tries again; if it keeps failing, read the logs for the `order_id`.
- **`not_allowed`:** check the buyer's Zinc account (verification, limits). The buyer has been told; reach out if they're stuck.

### Ideas can't run here

`idea_engine_enabled` or `capture_extraction_enabled` is 1, but the AI Gateway (`AI_GATEWAY_BASE`, `AI_GATEWAY_API_KEY`), or for ideas Zinc (`ZINC_API_BASE`, `ZINC_API_KEY`), isn't set on this environment. The line says which. Set the missing env vars in Vercel and redeploy, or set the switch to 0. See **Gift idea engine**.

### Gift ideas failed

At least one idea run ended `failed` in the last day; the line has the count. The tick itself still reports ok. A failed run counts toward `idea_round_runs_max`, so fix it before the next tick or the round may end with no ideas.

1. If **A vendor check failed** is in the same email, start there.
2. Find the runs: `select id, round_id, started_at, stage from concierge.idea_runs where outcome = 'failed' and finished_at > now() - interval '25 hours' order by finished_at desc;`.
3. Read `ideas.run` in the function logs (Hobby keeps them about an hour) for `error`, `error_kind` and `error_status`. A 401 or 403 is the key; a 404 is a wrong address or model; a 5xx is the vendor's trouble. A status of 0 or none means no reply, or a reply we couldn't use: `error_kind` says which (`malformed` was an unreadable reply; `unavailable` with no status can also be a model with no price).

### A vendor check failed

The AI Gateway credit or the app's Zinc balance couldn't be read in two tries. Shown only while something uses that vendor. Ideas probably can't run either.

1. Read `health.vendor_check_failed` for the `status`. A 401 or 403 is the key; a 5xx is the vendor's trouble; 0 or none means no reply, or one we couldn't read.
2. **AI Gateway:** if the key is refused, or you can't tell, create a new one, check it against `/v1/credits`, store it as the production `AI_GATEWAY_API_KEY` (Secret) and redeploy.
3. **Zinc:** check `ZINC_API_KEY` and `ZINC_API_BASE` on production, and Zinc's status.
4. Confirm with `vercel crons run /api/health`. `vercel env run` on a laptop may use a different key, so it proves nothing about production's.

### AI credit

Two lines lead here:

- **Out of AI credit: ideas are paused.** An idea run ended `no_credit` in the last day, or the AI Gateway credit is at or below 0 (an overrun shows negative). A run that hits it isn't counted against the round and the buyer gets no email: the round waits and tries again on a later tick. With fan-out off, the tick starts no other idea run after the first `no_credit`; with fan-out on, each due round's job tries its own run, and `idea_round_runs_per_day` bounds both. The line lists open rounds still waiting on ideas within `hold_final_days` of their ship-by deadline; those are the ones to watch. A round still waiting on credit at its ship-by deadline is skipped and the buyer gets the "skipped" email, never a silent skip.
- **AI credit is low.** The credit is below `ai_credit_low_cents` ($5).

Both balance lines only appear while `idea_engine_enabled` or `capture_extraction_enabled` is 1, since nothing else spends the credit. A run's `no_credit` line appears regardless. The Gateway answers both an empty balance (`insufficient_funds`) and a used-up budget (`quota_for_entity_exceeded`, [Vercel: budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)) with HTTP 402, and the app treats any 402 as out of credit.

Auto top-up is off for now, so the owner tops up by hand:

1. Vercel dashboard (as allensforever711) > AI Gateway > Credits: add credit.
2. If the Gateway refuses because the $100 monthly team budget is used up, raise the budget there or wait for the new month.
3. The next tick runs the waiting rounds. To stop spending instead, set `idea_engine_enabled` to 0.

### Zinc app balance low

The app's own Zinc account (the `ZINC_API_KEY` used for product lookups, T17) is below `zinc_app_balance_low_cents` ($5). Checked only while `idea_engine_enabled` or `amazon_paste_lookup_enabled` is 1, the two things that use that key. When it runs out, idea runs and Amazon paste lookups can't look products up. Add funds in that account's Zinc dashboard. Buyers' own wallets aren't checked here; they're told about their own funds holds.

### Waiting on the buyer

An open round is waiting on the buyer (an address, funds or setup) within `hold_final_days` of its ship-by deadline. The buyer has already been emailed, and the round skips at its deadline with the "skipped" email if nothing changes. The owner may contact the buyer to help them finish in time (find them by `user_id` in Supabase). These rounds are also counted in the weekly email.

### The health check couldn't run

The check itself failed, so today's other lines are unknown. The line names the stage it stopped at, never the error:

- **`settings`:** a setting it reads (listed above under **Settings**) is missing or can't be read. Check `concierge.app_settings` for the row, and whether a migration renamed or removed it.
- **`snapshot`:** `concierge.health_snapshot` failed, or its answer didn't match the shape the code expects. Usually a migration changed a table it reads, or the function and the code are out of step after a deploy or rollback. Run `select concierge.health_snapshot(now());` in the SQL editor to see the error.
- **`wiring`:** the route couldn't build its clients, usually an environment variable missing on that deployment (`SUPABASE_SECRET_KEY`, or `GIFT_SUPABASE_SECRET_KEY` on production). Check them in Vercel and redeploy.

Read `health.checked {result: "failed"}` in the function logs soon (Hobby keeps them about an hour) for the error's `name` and `code`. Once fixed, call `/api/health` with the cron secret to confirm.

## My list saving (ALL-127)

My list saves each change as it's made, through `lists.save_list_checked`, which refuses a save made from an out-of-date version and returns the gifts it wrote with the new version (T74; behaviour in `design/ui.md` > Editing and saving > My list).

**Ship order:** the migration (`20261116150000_save_list_checked.sql`, with its pgTAP tests, the regenerated types and the e2e seed) ships as its own PR first, and its CI `migrate` job must finish green on dev and prod before the code PR merges. On its own it changes nothing: no deployed code calls the new function.

**The close route, `POST /api/lists/save-on-close`.** When a tab is hidden or closes with a remove not yet saved, the page posts `{ listId, version, removeIds }` here with `fetch(…, { keepalive: true })`. The proxy lets the path through signed out (`lib/supabase/proxy.ts`), so the route checks everything itself: a signed-in user (401), a same-origin `Origin` header (403), a JSON content type (415), a body under 64 KiB by its `Content-Length` and its text (413), and exactly those three fields, with uuid ids, at most 500 (400). It reads the list, drops those gifts and saves the rest through the checked path. It answers 200 with `{ version, behind }` when saved, so a tab that was only hidden carries on from that version; 404 when the list isn't the caller's; 409 when two saves in a row were refused; 500 otherwise. It isn't `/api/keepalive`, which is the daily Supabase ping.

**Seeing it work on production (E9):** events, ids only.

| Event | Means |
|---|---|
| `list_save_stale` | A save was refused because the list changed in another tab or device; the tab got the latest and saved again. A few are normal. |
| `list_close_sent` | A hidden or closing tab sent its removes. `outcome` is `saved`, `stale`, `not_found` or `error`; `behind` says the tab's version was already out of date. Anything but `saved`, repeating, means removes made just before leaving a tab are coming back. |
| `list_save_failed`, `list_read_failed` | A save or a read of a list failed in the database (`code` is the Postgres or PostgREST code). The person sees "Couldn't save" or a load error. Repeating means My list is down. |

**Rolling back:** Vercel's instant rollback goes back as far as save-as-you-go (ALL-127). The old `lists.save_list` that the Save button before it used was dropped in ALL-130, so a rollback past ALL-127 would leave My list unable to save. Code from before ALL-142 also stores `http://` photo links as they come, which the database now refuses, so on that code a save with a newly added http photo fails as a whole.

**Rules the database enforces (ALL-142):** however a gift is written (My list, the extension, or straight through Supabase's API), a list holds at most `list_max_items` (500) gifts, and a gift's photo address starts with `https://` (or `http://` on localhost, for local Supabase storage). A save past the limit fails with `23514`; My list and the extension check the same setting first and say so plainly. An https photo on someone else's server can still see who opens a shared list; ALL-143 serves them through our server.

## Adding a list's owner from their link (ALL-123)

A signed-in buyer who opens someone's share link sees whose list it is and a card to add the owner to their people or link someone they already have; a person with no list gets a prompt at the top of their page to paste one (T78). Spec: [design/plans/ALL-123-add-from-list-link.md](plans/ALL-123-add-from-list-link.md).

| Setting (`concierge.app_settings`) | Default | What it does |
|---|---|---|
| `list_link_card_enabled` | 1 | Off switch. On only when the value is exactly 1; any other value is off. |

**What off looks like:** no add/link card on a shared list, no "Does … have a GiftsAF list?" prompt on a person's page, and no owner name anywhere: the shared list's heading reads "Their list" (even for a buyer whose own person is linked to it; the owner still sees their own title), and link previews show the generic card. A person's **Their list** row opens the old screen instead of the share page, for linked and unlinked people alike: paste a link when there isn't one, **Unlink** when there is.

**Turn it off:** `update concierge.app_settings set value = '0' where key = 'list_link_card_enabled';` (Supabase SQL editor as allensforever711, no deploy). Links already made stay.

**Turn it back on:** `update concierge.app_settings set value = '1' where key = 'list_link_card_enabled';` Pages pick it up on the next load.

**Seeing it work on production (E9):** events, ids only: `lists.linked_from_share` (a person linked from the card or the prompt), `lists.unlinked_from_share` (Remove on the card) and `people.added_from_share` (a person added and linked in one save). Failures log `person_link_failed`, `person_unlink_failed`, `person_share_token_failed`, `person.add_failed` and `share_preview_failed` with the Postgres code.

**Rolling back:** Vercel's instant rollback. The migration replaces `add_person` with one that takes an optional 18th argument, so the old code's 17-argument calls still work, and otherwise only adds; nothing in the database needs undoing.

## Extension: Add to my list (ALL-78, T77)

The extension adds the product on the open tab to My list through `POST /api/lists/items`, which calls `lists.add_item`. Spec and plan: [design/plans/ALL-78-add-to-my-list.md](plans/ALL-78-add-to-my-list.md).

**Release order (E9):** before the migration runs, check that prod's longest gift link is under about 2,000 characters: `select max(char_length(product_url)) from lists.list_items`. The migration adds `match_key` as an indexed generated column, and a key too long for the index fails the migration. Ask the owner before running anything on prod. Then merge the web code and the migration (`20261121100000_extension_add.sql`) and wait for the `migrate` job to finish green on dev and prod. Check the route answers on production. Only then submit the extension package to the store. The new build calls a route that must already exist.

**Off switch (E7):** set `extension_add_enabled` to `0` in `concierge.app_settings`. The route answers 503 and the popup says "Adding from the extension is paused". No deploy needed. Set it back to `1` to turn it on.

**Photos:** they live in the public `list-photos` bucket as `<gift id>.jpg`, written only by the route. When a gift, its list or its account is removed, the photo goes into `lists.photo_deletions`, and the daily tick (`/api/rounds/tick`) deletes it once it has waited `list_photo_cleanup_min_age_minutes` (60), up to `list_photo_cleanup_batch` (500) a day; the rest wait for the next day. If photos linger, check the tick ran and look for `list.photo_cleanup_skipped` (a cleanup setting couldn't be read, so that day was skipped) or `list.photos_left` (the Storage API refused the delete; tomorrow retries). Other tunables are the `app_settings` rows `list_photo_width_px`, `list_photo_jpeg_quality` and `list_photo_max_bytes`. Keep `list_photo_max_bytes` below the bucket's 1 MB limit, or uploads fail.

**Seeing it work on production:** event `list.extension_add`, with `outcome` (`added`, `duplicate`, `likely`, `full` or `failed`) and ids only.

## Amazon paste lookups (ALL-141)

When a signed-in person pastes an Amazon link on My list, the server asks Zinc for that product's real name, price and photo (`GET /products/{asin}`), because Amazon answers our own page reads with a bot check. It runs on the **app's Zinc key** (`ZINC_API_BASE`, `ZINC_API_KEY`, as for the idea engine), so every lookup costs `zinc_lookup_cents`. It's open to everyone signed in, not just paid accounts (owner decision 2026-11-21), but only for pasting a link: nothing else calls it. Guests, and every other store, are unchanged (other stores still read the page, ALL-10).

**Turning it off (E7):** set `amazon_paste_lookup_enabled` to `0` in `concierge.app_settings` (Supabase SQL editor as allensforever711, no deploy). Pasted Amazon links then give only what the link itself has: the name from its path and a guessed photo, and the person types the price. Set it back to `1` to turn it on.

**Settings** (rows in `concierge.app_settings`; change them in the SQL editor, no deploy):

| Key | Default | What it does |
|---|---|---|
| `amazon_paste_lookup_enabled` | 1 | 1 on, 0 off (above) |
| `amazon_paste_lookups_per_user_per_day` | 30 | Most lookups one person can make in any 24 hours. `lists.take_amazon_lookup()` counts them in `lists.amazon_lookups` and reads the limit itself. Past it, the paste works as when switched off |
| `amazon_paste_lookups_per_day_total` | 2000 | Most lookups across everyone in any 24 hours, a ceiling on the day's spend (2000 × `zinc_lookup_cents`). Past it, every paste works as when switched off and logs `over_limit` (owner decision 2026-11-21) |
| `amazon_paste_lookup_timeout_ms` | 10000 | How long a lookup waits for Zinc before the paste goes on without it |

**Seeing it work on production (E9):** event `list.amazon_lookup`, one per paste, ids only (no ASIN, no product name):

| Field | Means |
|---|---|
| `outcome` | `ok`; `off` (switched off); `not_configured` (no Zinc key on this environment); `over_limit` (the person's daily limit, or the ceiling across everyone); `not_found` (Zinc had no finished product); `unavailable` (Zinc or the quota failed, with `name`, `kind`, `code`, `status` when known); `bad_asin` |
| `cents` | What the lookup cost: `zinc_lookup_cents` when Zinc was called, else 0. Add these up for the spend |
| `user_id`, `ms` | Who, and how long it took |

Many `over_limit` from one `user_id` means someone is pasting a lot; `over_limit` from many people at once means the ceiling across everyone was reached; lots of `unavailable` means Zinc is down or the key is wrong.

**Shares the idea engine's Zinc key and rate limit.** Paste lookups use the same app key but aren't paced by `zinc_requests_per_second` (that pacing lives inside an idea run). A burst of pastes can push the key over Zinc's limit, so Zinc answers 429: those pastes log `unavailable` with `status: 429`, and an idea run at the same moment can hit 429s too. If that shows up, lower `amazon_paste_lookups_per_user_per_day` or switch paste lookups off.

## Inbound notes (ALL-31)

Users email a note to `notes@in.giftsaf.com` and it is filed on the right person (T70). Spec: [design/plans/ALL-31-email-capture.md](plans/ALL-31-email-capture.md).

**Ship order:** the migration PR merges first and its CI `migrate` job must finish green on dev and prod before the code PR merges.

**Setup**
1. Resend dashboard > Webhooks > add endpoint `https://giftsaf.com/api/inbound/resend`, event `email.received`. The free plan has one webhook endpoint.
2. Copy the endpoint's signing secret into Vercel as `RESEND_WEBHOOK_SECRET` (Production).
3. Set `INBOUND_NOTES_ADDRESS=notes@in.giftsaf.com` in all environments.
4. `RESEND_API_KEY` must be full access (reading received mail needs it).

**Settings** (`concierge.app_settings`)

| Setting | Default | Meaning |
|---|---|---|
| `inbound_email_enabled` | 1 | Off switch |
| `inbound_match_max_choices` | 5 | People offered as buttons in "Who is this about?" |
| `inbound_max_per_user_per_day` | 20 | Messages in plus emails out, per user |
| `inbound_link_hours` | 72 | How long the buttons work |
| `inbound_thread_lookup_max` | 10 | Sent emails checked when matching a reply |
| `inbound_thread_lookup_days` | 60 | How far back those are checked |
| `inbound_prune_days` | 7 | Days before `inbound_seen` and `inbound_events` rows are pruned |
| `action_link_prune_days` | 30 | Days after an emailed button expires before the daily tick deletes its `action_links` row; 0 or unset turns the prune off |

**Turn it off:** set `inbound_email_enabled` to 0. Mail is then ignored; no deploy needed.

**Events** (ids and a reason only, E6)

| Event | Means |
|---|---|
| `inbound.filed` | A note was filed to a person (`matched_by`: reply, name or choice) |
| `inbound.asking` | A note was saved and "Who is this about?" sent |
| `inbound.ask_capped` | "Who is this about?" was over the daily cap, so the waiting note and its image were deleted (with error fields if that delete failed; the daily clear-out then catches it) |
| `inbound.ignored` | A message was dropped, with a `reason` (disabled, auto_reply, unverified, unknown_sender, capped, unpaid) |
| `inbound.reply_capped` | An email back wasn't sent because of the daily cap |
| `inbound.reply_failed` | An email back failed to send |
| `inbound.read_failed` | A note was filed but reading it failed; "Try again" on the person's page reads it |
| `inbound.image_failed` | A note's image couldn't be downloaded or stored; the note was kept without it |
| `inbound.tip_failed` | The "Did you know?" tip failed to send |
| `inbound.failed` | Accepting or filing a message failed |
| `inbound.misconfigured` | `RESEND_WEBHOOK_SECRET` or `INBOUND_NOTES_ADDRESS` is missing |
| `inbound.notes_cleared` | The daily tick cleared unfiled notes (counts) |
| `inbound.notes_clear_failed` | The daily clear-out failed; it retries on the next tick |
| `inbound.note_images_left` | Deleting cleared notes' images failed (count); the next tick retries |
| `inbound.note_images_left_paths` | The storage paths still waiting, a few per line |
| `housekeeping.action_links_pruned` | The daily tick deleted expired emailed buttons (`deleted` count, 0 included) |
| `housekeeping.action_links_prune_failed` | That prune failed; it retries on the next tick |

**A note can be lost:** the webhook claims the email (an `inbound_seen` row) before fetching it from Resend. If that fetch fails after the claim, Resend has already had its 200 and any repeat delivery is skipped as seen, so the note is gone; it's logged as `inbound.failed` with the `email_id`, and the user can send it again.

**Testing in dev:** run a tunnel to the local app and point the Resend endpoint at `https://<tunnel>/api/inbound/resend`, with the secret in `.env.local`. With one endpoint on the free plan, switch it back to production afterwards.

## Cost tracking (ALL-144)

The Monday health email shows what a completed gift costs: AI, product lookups, and running the service. The numbers come from `concierge.cost_events` (one row per costed call, recorded by the app) and `concierge.monthly_bills` (what you enter by hand). Both tables are server only, so use the SQL editor.

**Settings** (rows in `concierge.app_settings`):

| Key | Default | What it does |
|---|---|---|
| `cost_tracking_enabled` | 1 | 0 records nothing and drops the email section |
| `cost_window_days` | 90 | How many days back the averages look |
| `cost_record_timeout_ms` | 3000 | How long one cost write may run before it is given up on. Recording never fails the user's action, but can add up to this long plus one settings read |
| `cost_tracking_since` | the day it shipped | Nothing before this is counted: orders, costs or bill months |

**Turning it off and on.** Set `cost_tracking_enabled` to `0`. While it is 0, no costs are recorded, so the gifts placed then have none. Before turning it back on, reset the start so those gifts aren't counted:

```sql
update concierge.app_settings
   set value = to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 where key = 'cost_tracking_since';
update concierge.app_settings set value = '1' where key = 'cost_tracking_enabled';
```

**Marking the QA account.** Its costs are recorded but kept out of the averages (shown as "QA account"), and its orders aren't counted as gifts. Find its id in the Supabase dashboard (Authentication > Users, `allensforever711+qa@gmail.com`), then:

```sql
insert into concierge.accounts (user_id, costs_excluded) values ('<user id>', true)
on conflict (user_id) do update set costs_excluded = true;
```

Only `user_id` is required; the account row may not exist yet. The mark applies to costs recorded after it, so **mark the account before any live check** (`pnpm live-check` or by hand).

If a check ran first, repair the idea-run and order costs it left (run as postgres in the SQL editor):

```sql
update concierge.cost_events set excluded = true
 where idea_run_id in (select id from concierge.idea_runs where user_id = '<qa user id>');
```

Costs linked to an order can be repaired the same way with `order_id in (select id from concierge.orders where user_id = '<qa user id>')`. Capture-read costs (`ai_capture`) have no link to a user, so they can't be repaired; they stay in the averages.

**Entering bills.** One row per month and vendor, in cents, with `month` the first of the month. Entering the same month and vendor again replaces the first:

```sql
insert into concierge.monthly_bills (month, vendor, cents) values
  ('2026-12-01', 'Vercel', 2000),
  ('2026-12-01', 'Supabase', 2500)
on conflict (month, vendor) do update set cents = excluded.cents;
```

- **The first countable month is the first full month after `cost_tracking_since`.** A month that starts before the start date is never counted, even if you enter it.
- **Yearly bills go in as one-twelfth each month** (a $12 domain is 100 cents a month).
- **Never enter AI Gateway credit or Zinc wallet top-ups.** The ledger already counts that spend per call, so a bill would count it twice. Zinc's order fee is added by the app from `zinc_order_fee_cents`.
- **A bill counts only once its whole month has ended**, and only for months that start on or after `cost_tracking_since`. So the first bills show up in the first Monday email after a full month has passed. Until then the email says "No full month of bills yet" and gives the fixed part without running costs.

**Don't set the fee from the first weeks.** The numbers read low until every counted gift's round started after `cost_tracking_since`, because older rounds' spend wasn't recorded. Wait until the oldest gift in the window is newer than the start date.

**How we see it working.** After an idea run or a capture read there is a new `cost_events` row (`select kind, cents, estimated, excluded, created_at from concierge.cost_events order by id desc limit 10;`). The Monday email has the "Cost per completed gift" section.

**When it fails (events):**

| Event | What it means | What to do |
|---|---|---|
| `cost.record_failed` | One cost wasn't recorded: the write failed or took longer than `cost_record_timeout_ms`. The user's action was not affected. The event has `kind`, ids and a `reason`: `client` (the database client couldn't be made, so a key is missing), `setting` (`cost_record_timeout_ms` couldn't be read), or `write` (the write failed or timed out). It may also carry the error's `code` or `status`, never its message. | Nothing if it's one-off. A failed log doesn't guarantee a missing row, because a timeout can land after the write went through, so check `cost_events` for that idea run or order before adding anything. If it repeats, check the database. |
| `health.costs_failed` | The Monday costs read failed or ran past `health_vendor_timeout_ms`. The email went out with "Costs couldn't be read"; its problems are unaffected. | Run `select concierge.cost_per_gift(now());` in the SQL editor to see the error. A missing or bad setting is the usual cause. |

`health_vendor_timeout_ms` also bounds the costs read. It runs after the vendor balance calls, so with both near the limit the route needs about twice that time; keep it well under half of the route's 60 s.

## Gift reactions (ALL-34)

**What it does:** The day after a delivered round's occasion (or after its last gift arrived, if later), the daily tick emails the buyer one message per day listing each gift that has no answer, with four links each: Loved it, Liked it, Meh, Returned it. A link opens `/rounds/{id}/reaction` with that answer chosen; Save keeps it. When every gift has an answer, or `reaction_close_days` after the asked-on date, the round becomes `complete`. Answers become profile facts. Design: [technical design §6.6](technical-design.md), decision T91.

**Settings** (`concierge.app_settings`)

| Setting | Default | Meaning |
|---|---|---|
| `reactions_enabled` | 1 | Off switch. At 0 nothing is asked or closed, saving is refused ("Not available right now"), and the links to answer are hidden. Past gifts still shows. Any of these four settings missing raises an error, even when this is 0: the daily step alerts (`reactions.run_failed`) if one of the first three is gone, and saving fails without this one or the note limit |
| `reaction_prompt_after_days` | 1 | Days after the latest of the occasion date, the last gift arriving and the round becoming delivered |
| `reaction_close_days` | 7 | Days after that when a delivered round closes, answered or not |
| `reaction_note_max_chars` | 500 | Longest note, in characters |

**Turn it off:** set `reactions_enabled` to 0 with SQL on that environment's database, no deploy needed.

**Turning it back on:** set it to 1. The next tick closes every delivered round already past its close date, without asking, and closes any whose gifts were all answered. Rounds still inside their window are asked as normal, so a short switch-off loses nothing, and a long one leaves the old rounds closed unasked.

**Events** (ids only, E6)

| Event | Means |
|---|---|
| `reactions.run` | The daily step finished (`closed` rounds closed, `asked` rounds asked about) |
| `reaction.saved` | An answer was saved (`complete`: the round closed with it) |
| `reaction.refused` | An answer was turned away, with a `reason` (`off`, `too_early`, `not_delivered`, `sensitive`, `note_too_long`, `not_found`) |
| `reaction.save_failed` | Saving threw. The buyer saw "try again" |
| `reaction.switch_unread` | A page couldn't read `reactions_enabled`, so it hid the links to answer. It refuses nothing: a save reads the switch itself |
| `reaction.history_check_failed` | The "Past gifts" row couldn't check for history, so it was left out |

### Reactions aren't going out

For `reactions.run_failed` or `reactions.ask_failed`:

1. Look at the event's error fields (`name`, `code`) in the Vercel logs. For `ask_failed`, `phase` says where it failed and `round_id` which round. Check Resend (status, key, a bounced address) for a refused email.
2. Nothing is lost: each key is given back, and the next tick asks again until the round's close date. After that the round closes unasked, so look within `reaction_close_days`.
3. For `run_failed`, check the database and that the four settings above exist in `app_settings`. To stop the noise while you fix it, set `reactions_enabled` to 0 and read **Turning it back on**.
4. If `ask_failed` has `phase` `forget`, the key couldn't be given back, so that round won't be asked again. To ask it, delete its row (`delete from concierge.round_sends where round_id = '<round_id>' and step = 'reaction_prompt';`), then wait for the next tick.

### A round never closes

A round that stays `ordered` or `needs_attention` is not asked and not closed: the gift's delivered event was lost and the buyer never tapped "It arrived" (known gap, ALL-33). Check the order in Zinc's dashboard. If it never confirmed, follow **Unconfirmed orders**; if it shipped, the buyer can tap "It arrived" on the round screen, and the round is then asked about as normal.

Two things look like bugs and aren't: an answer is refused before the occasion date, and an unanswered round closes silently on its close date.

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
