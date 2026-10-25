# Gifts AF platform (working name)

One app for three products (T19): **gift lists** (live, formerly the GiftsAF repo), **Gift Concierge** (being built) and **scan-to-gift** (later). Gift Concierge is an app that keeps track of friends and family, what they like, and the dates that matter. It picks gifts for those dates and buys them, with as much or as little automation as the user wants and safeguards so nothing gets purchased without time to approve.

## Workspace layout

| Folder | Purpose | Status |
|---|---|---|
| `planning/` | Product discovery: [PRD](planning/PRD.md) (approved 2026-10-17), [decisions log](planning/decisions.md), [research](planning/research/), [platform strategy](planning/strategy.md) (roadmap and go-to-market), [longer-term ideas](planning/ideas.md) | Complete |
| `design/` | [Technical design](design/technical-design.md) (approved 2026-10-17), [decisions log](design/decisions.md). Spike write-ups go in `design/spikes/`, look and feel in `design/ui.md`, and ticket build plans in `design/plans/`. | Complete |
| `.claude/` | Shared Claude Code settings (turns on the Superpowers plugin; runs the local setup check at session start) | Done |
| `apps/web/` | The one web app (Next.js). Products live in `modules/lists` and `modules/concierge`; see its [README](apps/web/README.md) | Lists live; concierge from Wave 2 |
| `apps/extension/` | Chrome capture extension | W2-4 |
| `packages/core/` | Pure shared logic (dates, deadlines, budgets) and database types | W1-5 |
| `supabase/` | Database migrations and local Supabase settings (`config.toml`) | Lists tables today |
| `scripts/` | Repo tooling, such as `dev-check.mjs` (the local setup check) | Done |
| `spikes/` | Throwaway Wave 1 experiments (Zinc, AI) | Reference only |

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
| Docker | The Supabase CLI runs a full local Supabase (database, auth, storage) in Docker containers | **Windows:** `wsl --install --no-distribution` as admin, restart Windows, then `winget install -e --id Docker.DockerDesktop`, open Docker Desktop and accept its terms. **Mac:** `brew install --cask docker`, then open Docker Desktop. |

**Local database.** With Docker Desktop running:

```bash
pnpm supabase start    # first run downloads images (a few minutes); applies supabase/migrations/
pnpm supabase status   # local URLs and keys; Studio (the database UI) is at http://127.0.0.1:54323
pnpm supabase db reset # rebuild the local database from the migrations, e.g. after pulling new ones
pnpm supabase stop     # stop the containers; your local data is kept
```

Write new migrations with `pnpm supabase migration new <name>` and test them locally before they go to `dev` or `prod`. Local settings live in `supabase/config.toml`.

**Running the web app:** follow [apps/web/README.md](apps/web/README.md) to link Vercel and pull the environment variables, then `pnpm dev`. Before a PR, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (CI runs the same).

**Deploys:** Vercel project `gift-me` (team GiftMe) builds `apps/web` from this repo. Every push to `main` deploys to production; every other branch gets a preview URL.

Where new docs go, how to write them, and when to push straight to `main` versus open a PR are in [CLAUDE.md](CLAUDE.md). Claude reads it automatically, and it's written for people too.

## Shared material

- [Roadmap](https://claude.ai/artifact/6D9ycNqhN2yGwvHwsWAaiW): all three products (Gift Concierge, gift lists, scan-to-gift) by now, next and later. Live status is in [Linear projects](https://linear.app/allens-forever/projects).
- [Go-to-market plan](https://claude.ai/artifact/XXghrwZVuTndZNBvnyhkxg): how scan-to-gift brings people in, gift lists keep them, and Gift Concierge earns. Use cases, handoffs between products, and launch phases.
- [Linear project: Gift Concierge MVP](https://linear.app/allens-forever/project/gift-concierge-mvp-d065ee52b117) (tickets labeled Wave 1–6)
- [Pitch deck](https://claude.ai/artifact/9aUauzPty1VKRSKgrZhmHT) (Claude artifact; ask the owner for access)
