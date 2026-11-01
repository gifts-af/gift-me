# Working in this repo

Two people (the owner and Jim) build this with Claude. Everything written here should be easy for a person to pick up cold: they should be able to find a doc in one place, read it top to bottom, and understand what was decided and why.

## Principles

Every plan is checked against these (`design/plans/TEMPLATE.md` > Principles check), and a reviewer can point at a diff and name the principle it breaks. **How we work** covers process; **How we build** covers engineering (T33). The detail is in the sections below and the decisions logs.

### How we work

1. **Simplest thing that works.** Challenge anything harder than it needs to be, including Claude's own proposals. Add tools only for a real need (T10).
2. **Progress over perfection.** Tunable values get a sensible, written-down default. Only bring the owner decisions that are hard to undo: architecture, vendors, data shape, money and safety.
3. **Spec before plan, plan before code.** Write what a ticket does and how we'll know it works (acceptance criteria), settle the open questions, then plan, then build test-first (T32).
4. **No hard-coded values** (T23). Business and vendor numbers live in settings, the database or env vars.
5. **Products stay separable** (T19). Each product has its own module and schema, and they talk only through public interfaces.
6. **Privacy by default.** Every user-owned row is protected by its owner; money and sensitive data stay inside the concierge (D31, T26).
7. **The repo is the written source.** Every direction we settle gets recorded in the docs and decisions log; Linear and shared pages are views of it.
8. **Written for a person.** Answer first, plain words, one place for each doc.

### How we build

Numbered E1–E10 (E for engineering), so they never get mixed up with the PRD's requirement ids like B-5. Each principle ends with **Breaks it:**, the thing to look for in a diff. Existing code that breaks one is fixed when we next touch it, not all at once.

**E1. Don't distribute by default.** We run one Next.js app on Vercel and one Supabase database (T10, T19). A new service, process, queue, worker or scheduled job needs a T# in `design/decisions.md` that ties it to one of four reasons: the data no longer fits, compute that's truly independent, users far enough away to need lower latency, or a separate team owning it. Coordination costs network round trips, not milliseconds.
*Breaks it:* a diff adds a deployable, queue or scheduled job with no decision behind it.

**E2. Optimize for deletion, not extension.** Keep each module small enough for one person to delete and rewrite in a day. Don't build for a need we don't have yet. Inline the code until that hurts, and extract on the third copy, because duplication is cheaper than the wrong abstraction.
*Breaks it:* a new interface, base class, factory or generic helper with one caller.

**E3. Make dependencies explicit.** Everything a function uses arrives through its arguments or the imports at the top of its file. No hidden global state, and no work done at import time. Business logic (`packages/core` and module logic) never reads `process.env` and never creates its own clients. Route handlers and server actions build the clients and settings and pass them in, which is how `packages/core` already works (T23).
*Breaks it:* logic that reads env vars, a module-level client or mutable module state that isn't in its signature.

**E4. Contract at the boundary, not in the middle.** Wherever data crosses into or out of the app (routes, webhooks, inbound email, files, vendor APIs, the database), it has a written schema and is validated right there. For the database, that's migrations plus generated types (`pnpm db:types`, checked in CI). Shapes get a **version only when something outside this deploy depends on them**: the browser extension, webhooks we publish, share links, emails. Routes used only by our own pages ship together with those pages. The side that understands both shapes does the translation; for example, the Zinc adapter turns Zinc's order into ours. A product never writes another product's tables (T19).
*Breaks it:* using a request or webhook body without validating it, or a vendor's raw shape leaking past its adapter.

**E5. Test the transformation, not the plumbing.** Vitest covers pure logic, such as budget and schedule math. Integration tests cover the boundaries: pgTAP for the database, and Playwright for the app against local Supabase. Don't mock what we own (our code, our database), so run the real thing locally. Do mock what we don't own (Zinc, AI Gateway, email). A bug fix includes a test that failed before the fix.
*Breaks it:* a `fix:` PR with no new failing-then-passing test, or a test that mocks Supabase or one of our own modules.

**E6. Emit structured events, derive everything else.** New server code logs through one small helper that writes one JSON event per line, which Vercel captures. Logs, metrics and traces all come from those events. Each event carries the ids needed to find it again: the request id and user id, plus the round, order or person id when there is one. **Ids only:** never names, emails, addresses, gift messages or keys (D31, T27).
*Breaks it:* a new free-text `console.log`, or an event that contains personal data.

**E7. Recovery over prevention, except where money moves.** Any deploy can be undone in under five minutes without a code change. Code goes back with Vercel's instant rollback, and a risky path is switched off with an `app_settings` row. Those rows double as feature flags, so we don't need a flag service (T23). Migrations are expand-then-contract: add the new thing, ship the code that uses it, and remove the old thing in a later migration. **Purchases can't be undone (T18)**, so ordering also prevents mistakes up front: price caps (PRD B-5), one live order per idea (T26), and a setting that stops all ordering. We rehearse a rollback once before the public launch and record how in the README.
*Breaks it:* a migration that drops or renames something live code still uses, or a risky new path with no off switch.

**E8. Attention is finite.** An alert exists only if it matches something a user would notice and links to a runbook (a README section) that says what to do. Dashboards are saved queries we actually use, not decoration. Delete any alert that hasn't led to useful action in 90 days.
*Breaks it:* an alert with no user-visible symptom or no runbook.

**E9. Value is realized at the user, not at merge.** Merged isn't done. A ticket is done when the change is on production, its events show it working, and it can be rolled back or switched off (E7). Every PR answers two questions: *how will we see this working on production?* and *how do we turn it off?* After merging, the author checks it on production and notes the result on the ticket, reopening the ticket if the check fails. Until real users arrive, "in users' hands" means it works for us on production.
*Breaks it:* a PR that can't answer those two questions.

**E10. Commands are discoverable, and local matches CI.** Every repeatable action is a root `pnpm` script listed in one README table. CI runs those same scripts and nothing else: no CI-only shell logic, no hidden arguments. A new contributor should be able to list every command in 30 seconds.
*Breaks it:* a CI step with inline shell, or a command that needs undocumented flags or env vars.

## Superpowers is required

All development in this repo uses the **Superpowers** plugin. `.claude/settings.json` turns it on for everyone, and Claude Code offers to install it the first time the repo is opened and trusted.

- **Before any work:** if Superpowers skills (`superpowers:*`) aren't available in the session, stop and ask the person to run `/plugin install superpowers@claude-plugins-official`, then restart Claude Code. Don't start building without it.
- **Which skill when:**

| Situation | Skill |
|---|---|
| New feature, screen or change in behavior | `brainstorming` to write the **Spec** (stories, acceptance criteria, open questions) from `design/plans/TEMPLATE.md`; settle the open questions; then `writing-plans` for the **Plan**, ending with its consistency check |
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
| Spec and build plan for a ticket | `design/plans/ALL-<n>-<short-name>.md`, copied from `design/plans/TEMPLATE.md`, when a plan is worth keeping; otherwise the spec (acceptance criteria) goes in the Linear ticket |

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
- **No hard-coded values (T23).** Fees, prices, rates, limits, timings and thresholds live outside the code: app-wide settings in `concierge.app_settings`, per-user ones in `concierge.accounts` (T26), and secrets or per-environment values in env vars. Code takes them as inputs and never falls back to a silent default constant. Only true constants (7 days in a week) stay in code.
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
