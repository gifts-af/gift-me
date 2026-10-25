# Working in this repo

Two people (the owner and Jim) build this with Claude. Everything written here should be easy for a person to pick up cold: they should be able to find a doc in one place, read it top to bottom, and understand what was decided and why.

## Superpowers is required

All development in this repo uses the **Superpowers** plugin. `.claude/settings.json` turns it on for everyone, and Claude Code offers to install it the first time the repo is opened and trusted.

- **Before any work:** if Superpowers skills (`superpowers:*`) aren't available in the session, stop and ask the person to run `/plugin install superpowers@claude-plugins-official`, then restart Claude Code. Don't start building without it.
- **Which skill when:**

| Situation | Skill |
|---|---|
| New feature, screen or change in behavior | `brainstorming` first, then `writing-plans` |
| Writing code | `test-driven-development` |
| A bug or failing test | `systematic-debugging` |
| Before saying something is done | `verification-before-completion` |
| Before merging a PR | `requesting-code-review` |
| Wrapping up a ticket branch | `finishing-a-development-branch` |

- Superpowers' own folder defaults don't apply here. Plans and specs follow the layout below.

## Where docs go

Use this layout. It overrides any plugin or skill default (for example, Superpowers saves to `docs/superpowers/specs/` and `docs/superpowers/plans/`; don't use those folders here).

| What | Where |
|---|---|
| Product: PRD, research, product decisions | `planning/` (`PRD.md`, `research/`, `decisions.md`) |
| Platform roadmap and go-to-market | `planning/strategy.md` (the shareable roadmap and go-to-market pages are built from it) |
| Raw product ideas not yet planned | `planning/ideas.md` |
| Technical design | `design/technical-design.md` |
| Technical decisions | `design/decisions.md`, next number in sequence (T16, T17, …) |
| Spike write-ups | `design/spikes/<topic>.md` (e.g. `zinc.md`, `ai.md`, `email.md`) |
| Look and feel, UI kit, mock-up links | `design/ui.md` |
| Build plan for a ticket | `design/plans/ALL-<n>-<short-name>.md` when a plan is worth keeping; otherwise in the Linear ticket |

- Don't create a new top-level folder or a second copy of a doc. Update the existing one.
- **Nothing discussed gets lost.** When a conversation, chat or artifact produces a product or design direction, record it in the docs above (and the decisions log) before moving on. Shareable pages and Linear are views; the repo is the written source.
- When a decision changes the design, update both `design/technical-design.md` and `design/decisions.md`, plus any affected Linear tickets.
- Add new docs to the table in `README.md` so people can find them.

## Writing for the human in the loop

- Lead with the answer or the decision, then the reasons.
- Plain words over jargon. Explain a term the first time it's used.
- Short sections with clear headings; tables for comparisons; diagrams (Mermaid) when a flow is easier to see than read.
- Mark open items so they're easy to scan: **[Verify]** for facts to check, **[Claude's call]** for choices the owner hasn't confirmed.
- Link to the source (ticket, doc section, vendor page) instead of repeating it.

## Code

- **One app, products as modules (T19, T20):** `apps/web/modules/<product>/` with a public `index.ts`. Import another product only through its `index.ts`; lint fails otherwise. Shared code lives in `apps/web/components`, `apps/web/lib` and `packages/core`.
- **Next.js 16 has breaking changes:** read `apps/web/AGENTS.md`, and check `apps/web/node_modules/next/dist/docs/` before writing Next-specific code.
- **Before a PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo root. CI runs the same.

## Git

- **Code:** a branch named after the Linear ticket, then a PR. CI must pass.
- **Planning and design docs** (`planning/`, `design/`, `README.md`, this file): commit and push straight to `main`.
- The repo is `gifts-af/gift-concierge`. Linear project: Gift Concierge MVP (team key `ALL`).

## Accounts: contribution vs admin

- **Contribution** (commits, branches, PRs, Linear tickets): each person uses their own account. The owner is `aarontallen` / aaron.aallen@gmail.com; Jim is `JimtheBurger`. Branches are named `<github-login>/all-<n>-<short-name>`.
- **Admin** goes through the shared **allensforever711** account (allensforever711@gmail.com). This covers repo transfers, org and repo settings, branch protection, secrets, members, connecting Vercel, Supabase and other services, billing, and vendor accounts such as Zinc. Others may also have admin rights, but admin work is done as allensforever711 (T7).
- If Claude's GitHub login isn't allensforever711, it gives the person the admin steps instead of doing them as someone else.
