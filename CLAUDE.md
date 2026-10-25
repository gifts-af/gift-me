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
- **Local setup:** if the session-start check reports missing tools, walk the person through `README.md` > Local development before other work. When a new tool becomes required, add a check to `scripts/dev-check.mjs` and a row to that README table.
- **No hard-coded values (T23).** Fees, prices, rates, limits, timings and thresholds live outside the code: app-wide settings in `concierge.app_settings`, per-user ones in `profiles`, and secrets or per-environment values in env vars. Code takes them as inputs and never falls back to a silent default constant. Only true constants (7 days in a week) stay in code.
- **Before a PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo root. CI runs the same.

## Git

- **Code:** a branch named after the Linear ticket, then a PR. CI must pass. Merge with **squash**, so each PR lands on `main` as one commit whose message is the PR title. Squash is the only merge button GitHub offers, and merged branches are deleted automatically. For a rare import that must keep its history (like ALL-15), an admin turns merge commits back on for that one PR.
- **Planning and design docs** (`planning/`, `design/`, `README.md`, this file): commit and push straight to `main`.
- **Commit messages and PR titles** follow [Conventional Commits](https://www.conventionalcommits.org): `<type>: <what changed, in plain words>`, and PR titles end with the ticket, e.g. `feat: budget math for multi-select picks (ALL-19)`. CI fails a PR whose title doesn't match (`check` job). Types:

| Type | Use for |
|---|---|
| `feat` | Something new a user or developer can use |
| `fix` | A bug fix |
| `docs` | Docs only (including direct pushes to `main`) |
| `refactor` | Code change with no behavior change |
| `test` | Tests only |
| `chore` | Tooling, dependencies, config, setup |
| `ci` | GitHub Actions and other CI |
| `perf` | Faster or cheaper, same behavior |

  An optional scope names the area: `feat(lists): …`, `fix(db): …`. Add `!` for a breaking change (`feat!: …`).
- **Every PR is attached to its Linear ticket.** Linear's GitHub app links a PR when the branch name or title has the ticket ID. In the PR description (the template has the line), write `Closes ALL-<n>` when the PR finishes the ticket, or `Part of ALL-<n>` when it's one piece of it, so the ticket isn't moved to Done early. Linear also moves the ticket to In Progress when the PR opens (tested on PR #6).
- **How `main` is protected** (GitHub rulesets): nobody can force-push or delete it. Changes need a PR with the CI `check` job passing. Repo admins (all of us today) can bypass that rule, which is what makes direct docs pushes work, so the code-via-PR rule above is a habit, not something GitHub enforces for us.
- **Linear priority means "how soon"**, so the board (Ordering: Priority) reads top to bottom as what to start next. Urgent: ready to start now, nothing open blocking it. High: next up, unblocked once the current Urgent work lands. Medium: after that. Low: last or optional. When a ticket's blockers close, or a new ticket is added, set its priority by this rule and keep its "blocked by" links current.
- The repo is `gifts-af/gift-me`. Linear project: Gift Concierge MVP (team key `ALL`).

## Accounts: contribution vs admin

- **Contribution** (commits, branches, PRs, Linear tickets): each person uses their own account. The owner is `aarontallen` / aaron.aallen@gmail.com; Jim is `JimtheBurger`. Branches are named `<github-login>/all-<n>-<short-name>`.
- **Admin** goes through the shared **allensforever711** account (allensforever711@gmail.com). This covers repo transfers, org and repo settings, branch protection, secrets, members, connecting Vercel, Supabase and other services, billing, and vendor accounts such as Zinc. Others may also have admin rights, but admin work is done as allensforever711 (T7).
- **Vercel and Supabase while on Hobby (T25):** the GiftMe Vercel team can't have other members, and Supabase access goes through it. So everyone signs in to the Vercel and Supabase CLIs and dashboards as allensforever711, for daily work too (`vercel env pull`, `supabase db push`). GitHub, Linear and Google Cloud use personal accounts.
- If Claude's GitHub login isn't allensforever711, it gives the person the admin steps instead of doing them as someone else.
