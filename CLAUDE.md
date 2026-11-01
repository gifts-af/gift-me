# Working in this repo

Two people (the owner and Jim) build this with Claude. Everything written here should be easy for a person to pick up cold: they should be able to find a doc in one place, read it top to bottom, and understand what was decided and why.

## Principles

The short list every plan is checked against (`design/plans/TEMPLATE.md` > Principles check). The detail is in the sections below and the decisions logs.

1. **Simplest thing that works.** Challenge anything harder than it needs to be, including Claude's own proposals. Add tools only for a real need (T10).
2. **Progress over perfection.** Tunable values get a sensible, written-down default. Only bring the owner decisions that are hard to undo: architecture, vendors, data shape, money and safety.
3. **Spec before plan, plan before code.** Write what a ticket does and how we'll know it works (acceptance criteria), settle the open questions, then plan, then build test-first (T32).
4. **No hard-coded values** (T23). Business and vendor numbers live in settings, the database or env vars.
5. **Products stay separable** (T19). Each product has its own module and schema, and they talk only through public interfaces.
6. **Privacy by default.** Every user-owned row is protected by its owner; money and sensitive data stay inside the concierge (D31, T26).
7. **The repo is the written source.** Every direction we settle gets recorded in the docs and decisions log; Linear and shared pages are views of it.
8. **Written for a person.** Answer first, plain words, one place for each doc.
9. **No work without a ticket; no ticket done without evidence** (T44). Every change starts from a Linear ticket, and a ticket isn't Done until its test evidence is posted on it (see Git > Evidence on the ticket).
10. **Collect the minimum, as late as possible** (T42). Ask for a piece of personal data only when a feature the person is using right now can't work without it, keep it only while it's needed, and send outside services IDs, not names or emails.

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

## Updating the roadmap page

The shareable roadmap is one claude.ai page: https://claude.ai/artifact/6D9ycNqhN2yGwvHwsWAaiW. Always update that page; never publish a new one, so the link people have keeps working. When someone asks to "update progress" or "update the roadmap" after finishing work:

1. Read the live page with the Artifact tool (`action: "read"`, that URL). Build on what comes back. The page has no source file in the repo.
2. Bring it up to date from Linear (ticket status in the projects it links) and `planning/strategy.md`. Change the "updated" date at the top, mark finished work done, and drop open questions that are now answered in the decisions logs.
3. Republish to the same URL (`url` set to the link above).
4. If the roadmap itself changed, not only progress, update `planning/strategy.md` too, because the repo is the written source.

The owner's claude.ai account owns the page. To update it, a person needs **edit** access, which the owner grants from the page's Share menu. Without it, the publish is refused. In that case, tell the person to ask the owner for edit access. Don't publish a copy.

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
- **Evidence on the ticket (T44), standard operating procedure.** No work starts without a Linear ticket: if there isn't one, create it first, with acceptance criteria. No ticket is Done until its test evidence is posted on the ticket as a comment, before the PR merges or right after. Evidence means:
  - **Tests:** what was added, that it failed first, and the suite results (counts), plus lint, typecheck and the CI result for the PR.
  - **Screenshots** of anything a person sees, at phone and desktop width and in light and dark mode where it matters. Show before and after for a fix.
  - **Mock-ups** made for the ticket.
  - **Live checks** after the deploy (what was checked on giftsaf.com or in the service, and the result).

  Upload images into the comment (Linear MCP `prepare_file_upload`, then PUT, then embed the returned markdown), so they stay with the ticket rather than in chat or a scratch folder. Anything that couldn't be checked is listed as **Still open**, and the ticket stays open until it is. Docs-only pushes to `main` don't need a ticket. `AGENTS.md` repeats this rule for other AI tools and points them here.
- **Every PR is attached to its Linear ticket.** Linear's GitHub app links a PR when the branch name or title has the ticket ID. In the PR description (the template has the line), write `Closes ALL-<n>` when the PR finishes the ticket, or `Part of ALL-<n>` when it's one piece of it, so the ticket isn't moved to Done early. Linear also moves the ticket to In Progress when the PR opens (tested on PR #6).
- **How `main` is protected** (GitHub rulesets): nobody can force-push or delete it. Changes need a PR with the CI `check` job passing. Repo admins (all of us today) can bypass that rule, which is what makes direct docs pushes work, so the code-via-PR rule above is a habit, not something GitHub enforces for us.
- **Linear priority means "how soon"**, so the board (Ordering: Priority) reads top to bottom as what to start next. Urgent: ready to start now, nothing open blocking it. High: next up, unblocked once the current Urgent work lands. Medium: after that. Low: last or optional. When a ticket's blockers close, or a new ticket is added, set its priority by this rule and keep its "blocked by" links current.
- The repo is `gifts-af/gift-me`. Linear project: Gift Concierge MVP (team key `ALL`).

## Accounts: contribution vs admin

- **Contribution** (commits, branches, PRs, Linear tickets): each person uses their own account. The owner is `aarontallen` / aaron.aallen@gmail.com; Jim is `JimtheBurger`. Branches are named `<github-login>/all-<n>-<short-name>`.
- **Admin** goes through the shared **allensforever711** account (allensforever711@gmail.com). This covers repo transfers, org and repo settings, branch protection, secrets, members, connecting Vercel, Supabase and other services, billing, and vendor accounts such as Zinc. Others may also have admin rights, but admin work is done as allensforever711 (T7).
- **Vercel and Supabase while on Hobby (T25):** the GiftsAF Vercel team (slug `gift-me3`, formerly GiftMe) can't have other members, and Supabase access goes through it. So everyone signs in to the Vercel and Supabase CLIs and dashboards as allensforever711, for daily work too (`vercel env pull`, `supabase db push`). GitHub, Linear and Google Cloud use personal accounts.
- If Claude's GitHub login isn't allensforever711, it gives the person the admin steps instead of doing them as someone else.
