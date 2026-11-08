# Working in this repo

Two people (the owner and Jim) build this with Claude. Everything written here should be easy for a person to pick up cold: they should be able to find a doc in one place, read it top to bottom, and understand what was decided and why.

## Principles

Every plan is checked against these (`design/plans/TEMPLATE.md` > Principles check), and a reviewer can point at a diff and name the principle it breaks. **How we work** covers process; **How we build** covers engineering (T47). The detail is in the sections below and the decisions logs.

### How we work

1. **Simplest thing that works.** Challenge anything harder than it needs to be, including Claude's own proposals. Add tools only for a real need (T10).
2. **Progress over perfection.** Tunable values get a sensible, written-down default. Only bring the owner decisions that are hard to undo: architecture, vendors, data shape, money and safety.
3. **Spec before plan, plan before code.** Write what a ticket does and how we'll know it works (acceptance criteria), settle the open questions, then plan, then build test-first (T32).
4. **No hard-coded values** (T23). Business and vendor numbers live in settings, the database or env vars.
5. **Products stay separable** (T19). Each product has its own module and schema, and they talk only through public interfaces.
6. **Privacy by default.** Every user-owned row is protected by its owner; money and sensitive data stay inside the concierge (D31, T26).
7. **The repo is the written source.** Every direction we settle gets recorded in the docs and decisions log; Linear and shared pages are views of it.
8. **Written for a person.** Answer first, plain words, one place for each doc.
9. **No work without a ticket, except quick touch-ups; no ticket done without evidence** (T44, T64). Every change starts from a Linear ticket unless it's a quick touch-up (see Git > When a change needs no ticket), and a ticket isn't Done until its test evidence is posted on it (see Git > Evidence on the ticket).
10. **Collect the minimum, as late as possible** (T42). Ask for a piece of personal data only when a feature the person is using right now can't work without it, keep it only while it's needed, and send outside services IDs, not names or emails.

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

**E5. Test the transformation, not the plumbing; use the real thing where the test is about it.** Most tests sit low in the pyramid: Vitest for logic (budget and schedule math), component tests for what a screen shows and does, and one Playwright journey per feature against local Supabase (T67). **Always real:** anything that moves money (purchases, Zinc ordering, rounds), privacy rules, and the database's own behaviour, tested with pgTAP, local-db Vitest tests or a browser journey, because fakes of these drift from the real thing. **A fake is allowed** when one of our own pieces is incidental to what the test checks, for example a server action under a component test, but only if a real-thing test covers that same contract somewhere. Always mock what we don't own (Zinc, AI Gateway, email). A bug fix includes a test that failed before the fix.
*Breaks it:* a `fix:` PR with no new failing-then-passing test; a money, privacy or database test that fakes Supabase; or a fake of our own code with no real-thing test behind it.

**E6. Emit structured events, derive everything else.** New server code logs through one small helper that writes one JSON event per line, which Vercel captures. Logs, metrics and traces all come from those events. Each event carries the ids needed to find it again: the request id and user id, plus the round, order or person id when there is one. **Ids only:** never names, emails, addresses, gift messages or keys (D31, T27).
*Breaks it:* a new free-text `console.log`, or an event that contains personal data.

**E7. Recovery over prevention, except where money moves.** Any deploy can be undone in under five minutes without a code change. Code goes back with Vercel's instant rollback, and a risky path is switched off with an `app_settings` row. Those rows double as feature flags, so we don't need a flag service (T23). Migrations are expand-then-contract: add the new thing, ship the code that uses it, and remove the old thing in a later migration. **Purchases can't be undone (T18)**, so ordering also prevents mistakes up front: price caps (PRD B-5), one live order per idea (T26), and a setting that stops all ordering. We rehearse a rollback once before the public launch and record how in `design/operations.md`.
*Breaks it:* a migration that drops or renames something live code still uses, or a risky new path with no off switch.

**E8. Attention is finite.** An alert exists only if it matches something a user would notice and links to a runbook (a section of `design/operations.md`) that says what to do. Dashboards are saved queries we actually use, not decoration. Delete any alert that hasn't led to useful action in 90 days.
*Breaks it:* an alert with no user-visible symptom or no runbook.

**E9. Value is realized at the user, not at merge.** Merged isn't done. A ticket is done when the change is on production, its events show it working, and it can be rolled back or switched off (E7). Every PR answers two questions: *how will we see this working on production?* and *how do we turn it off?* After merging, the author checks it on production and notes the result on the ticket, reopening the ticket if the check fails. Until real users arrive, "in users' hands" means it works for us on production.
*Breaks it:* a PR that can't answer those two questions.

**E10. Commands are discoverable, and local matches CI.** Every repeatable action is a root `pnpm` script listed in one place, `design/operations.md`. CI runs those same scripts and nothing else: no CI-only shell logic, no hidden arguments. A new contributor should be able to list every command in 30 seconds.
*Breaks it:* a CI step with inline shell, or a command that needs undocumented flags or env vars.

## Superpowers is required

All development in this repo uses the **Superpowers** plugin. `.claude/settings.json` turns it on for everyone, and Claude Code offers to install it the first time the repo is opened and trusted.

- **Before any work:** if Superpowers skills (`superpowers:*`) aren't available in the session, stop and ask the person to run `/plugin install superpowers@claude-plugins-official`, then restart Claude Code. Don't start building without it.
- **Which skill when:**

| Situation | Skill |
|---|---|
| New feature, screen or change in behavior | `brainstorming` to write the **Spec** (stories, acceptance criteria, open questions) from `design/plans/TEMPLATE.md`; settle the open questions; an **adversarial review** of the spec (below); then `writing-plans` for the **Plan**, ending with its consistency check and another adversarial review |
| Writing code | `test-driven-development` |
| A bug or failing test | `systematic-debugging` |
| Before saying something is done | `verification-before-completion` |
| Before merging a PR | `requesting-code-review`, briefed as an adversarial review (below) |
| Wrapping up a ticket branch | `finishing-a-development-branch` |

- Superpowers' own folder defaults don't apply here. Plans and specs follow the layout below.

### Adversarial review (T55)

Every spec, plan and PR gets a reviewer whose job is to find what's wrong, not to approve. Their findings are fixed, or brought to the owner, before the next step. This applies to every agent and person working here.

- **Fresh context.** A new agent (or a person who wasn't in the conversation). It reads the work and the repo, never the chat that produced it, so it doesn't inherit the author's assumptions.
- **It owns the quality of the approach.** If the design ships and breaks a rule, loses money, leaks data, or is more complex than needed, that's on the reviewer. It assumes the author was optimistic.
- **Judged against our constitution.** The yardstick is this file's principles (How we work 1–10, How we build E1–E10, each with its "Breaks it:" line) and the decisions logs (`design/decisions.md`, `planning/decisions.md`). Findings cite the principle or decision they break, and flag any change to a recorded decision the work doesn't say it's revising.
- **What it attacks:** money paths (double buys, over-cap buys, buying after the user changed their mind, races), secrets and personal data (T42, E6), simplicity (1, E1, E2), contradictions with the schema or engine, and acceptance criteria that can't be tested.
- **What comes back:** a ranked list (blocker, should-fix, nit), each with the failure scenario, the rule it breaks and the fix, plus a separate list of owner decisions. The author fixes the technical ones and brings the owner decisions in one message.
- A "builder check" (what would you need answered to plan this?) is useful too, but it finds gaps, not flaws, so it never replaces this review.

The brief to give the reviewer is in `design/plans/TEMPLATE.md` > Adversarial review.

## Where docs go

Use this layout. It overrides any plugin or skill default (for example, Superpowers saves to `docs/superpowers/specs/` and `docs/superpowers/plans/`; don't use those folders here).

| What | Where |
|---|---|
| What the product is, for anyone visiting the repo | `README.md`: a product pitch, with no setup or operations detail (T66) |
| Product: PRD, research, product decisions | `planning/` (`PRD.md`, `research/`, `decisions.md`) |
| Platform roadmap and go-to-market | `planning/strategy.md` (the shareable roadmap and go-to-market pages are built from it) |
| Raw product ideas not yet planned | `planning/ideas.md` |
| Technical design | `design/technical-design.md` |
| Installing, running and operating: setup, commands, environments, runbooks | `design/operations.md` |
| Technical decisions | `design/decisions.md`, next number in sequence (T16, T17, …) |
| Spike write-ups | `design/spikes/<topic>.md` (e.g. `zinc.md`, `ai.md`, `email.md`) |
| Look and feel, UI kit, mock-up links | `design/ui.md` |
| Spec and build plan for a ticket | `design/plans/ALL-<n>-<short-name>.md`, copied from `design/plans/TEMPLATE.md`, when a plan is worth keeping; otherwise the spec (acceptance criteria) goes in the Linear ticket |

- Don't create a new top-level folder or a second copy of a doc. Update the existing one.
- **Nothing discussed gets lost.** When a conversation, chat or artifact produces a product or design direction, record it in the docs above (and the decisions log) before moving on. Shareable pages and Linear are views; the repo is the written source.
- When a decision changes the design, update both `design/technical-design.md` and `design/decisions.md`, plus any affected Linear tickets.
- Add new docs to the table in `design/operations.md` > Workspace layout so people can find them.

## Updating the roadmap page

The shareable roadmap is one claude.ai page: https://claude.ai/artifact/6D9ycNqhN2yGwvHwsWAaiW. Always update that page; never publish a new one, so the link people have keeps working. When someone asks to "update progress" or "update the roadmap" after finishing work:

1. Read the live page with the Artifact tool (`action: "read"`, that URL). Build on what comes back. The page has no source file in the repo.
2. Bring it up to date from Linear (ticket status in the projects it links) and `planning/strategy.md`. Change the "updated" date at the top, mark finished work done, and drop open questions that are now answered in the decisions logs.
3. Republish to the same URL (`url` set to the link above).
4. If the roadmap itself changed, not only progress, update `planning/strategy.md` too, because the repo is the written source.

The owner's claude.ai account owns the page. To update it, a person needs **edit** access, which the owner grants from the page's Share menu. Without it, the publish is refused. In that case, tell the person to ask the owner for edit access. Don't publish a copy.

## Updating the round engine page

The round engine page, https://claude.ai/artifact/Edr5DRi5s53iRPfAsuSnd8, draws `design/technical-design.md` §4.1, §5 and §5.1. When a change touches round statuses, the tick or the reminder schedule, update the page in the same piece of work: read it with the Artifact tool (`action: "read"`), change it, and republish to the same URL. Never publish a copy. The doc stays the source; if the two disagree, the doc wins. Edit access works the same as for the roadmap page.

## Writing for the human in the loop

- Lead with the answer or the decision, then the reasons.
- Plain words over jargon. Explain a term the first time it's used.
- Short sections with clear headings; tables for comparisons; diagrams (Mermaid) when a flow is easier to see than read.
- Mark open items so they're easy to scan: **[Verify]** for facts to check, **[Claude's call]** for choices the owner hasn't confirmed.
- Link to the source (ticket, doc section, vendor page) instead of repeating it.

## Code

- **One app, products as modules (T19, T20):** `apps/web/modules/<product>/` with a public `index.ts`. Import another product only through its `index.ts`; lint fails otherwise. Shared code lives in `apps/web/components`, `apps/web/lib` and `packages/core`.
- **Next.js 16 has breaking changes:** read `apps/web/AGENTS.md`, and check `apps/web/node_modules/next/dist/docs/` before writing Next-specific code.
- **Catching errors in server components:** with `cacheComponents` on, a `catch` around request data (`cookies()`, `headers()` or anything that calls them) starts with `unstable_rethrow(error)`. Otherwise Next's end-of-prerender signal gets logged as a failure (ALL-87).
- **Local setup:** if the session-start check reports missing tools, walk the person through `design/operations.md` > Local development before other work. When someone asks to install the repo on a new machine, follow `design/operations.md` > Install instead. When a new tool becomes required, add a check to `scripts/dev-check.mjs` and a row to the table in `design/operations.md` > Local development.
- **No hard-coded values (T23).** Fees, prices, rates, limits, timings and thresholds live outside the code: app-wide settings in `concierge.app_settings`, per-user ones in `concierge.accounts` (T26), and secrets or per-environment values in env vars. Code takes them as inputs and never falls back to a silent default constant. Only true constants (7 days in a week) stay in code.
- **Browser tests (T62):** a test runs on the iPhone only unless it's tagged `@layout`, which runs it on all three browsers. Tag anything that checks how a page looks or fits, and check layout with `e2e/phone-layout.ts`, whose helpers fail an untagged test. Sign in with `signIn(page)` from `e2e/sign-in.ts`; `pnpm lint` fails a test that finds the login form's password field. Don't silence either check to get a test passing: tag the test, or switch to `signIn`. See `design/operations.md` > Writing a browser test.
- **Before a PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` from the repo root. CI runs the same.

## Git

- **Code:** a branch named after the Linear ticket, then a PR. CI must pass. Merge with **squash**, so each PR lands on `main` as one commit whose message is the PR title. Squash is the only merge button GitHub offers, and merged branches are deleted automatically. For a rare import that must keep its history (like ALL-15), an admin turns merge commits back on for that one PR.
- **Planning and design docs** (`planning/`, `design/`, `README.md`, this file): commit and push straight to `main`.
- **Commit messages and PR titles** follow [Conventional Commits](https://www.conventionalcommits.org): `<type>: <what changed, in plain words>`, and PR titles end with the ticket, e.g. `feat: budget math for multi-select picks (ALL-19)`. CI fails a PR whose title doesn't match (the `pr-title` check, ALL-117). Types:

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
- **Start of the day: check Linear first (T65).** In the first session of a person's working day, before any new work, review Linear and tell that person what needs them, as one short list, most important first:
  - Their tickets that are In Progress, or merged but not Done: tick any acceptance-criteria box whose evidence is already posted, and list the open **Still open** items.
  - Comments addressed to them since their last session.
  - Decisions waiting on them (for the owner, any T# still marked pending in `design/decisions.md`).
  - Urgent tickets that nobody owns.

  Raise anything nobody owns; don't quietly pick it up. Once per person per day, not in every session.
- **Re-read the ticket before significant work (T57).** Before writing a spec, before writing a plan, before the first line of code, before opening a PR, and whenever you pick work back up after a break, re-fetch the Linear ticket: its description, status, assignee, **every comment**, and its blocking and related tickets (their latest comments too). Others, and other agent sessions, change tickets while you work. If anything changed (new decisions, scope, a blocker, someone else already on it), reconcile it before going on and say what changed. Never work from a copy of the ticket read earlier in the session.
- **Evidence on the ticket (T44), standard operating procedure.** Work that needs a ticket (see When a change needs no ticket, below) starts from one: if there isn't one, create it first, with acceptance criteria. No ticket is Done until its test evidence is posted on the ticket as a comment, before the PR merges or right after. Evidence means:
  - **Tests:** what was added, that it failed first, and the suite results (counts), plus lint, typecheck and the CI result for the PR.
  - **Screenshots** of anything a person sees, at phone and desktop width and in light and dark mode where it matters. Show before and after for a fix.
  - **Mock-ups** made for the ticket.
  - **Live checks** after the deploy (what was checked on giftsaf.com or in the service, and the result). For anything that needs signing in, use `pnpm live-check` with the shared account (`design/operations.md` > Production test account, T60).
  - **Ticked acceptance criteria:** as each criterion's evidence is posted, tick its box in the ticket description (`- [x]`) and add a short pointer to the evidence. All boxes are ticked before the ticket moves to Done; one that can't be ticked goes under **Still open**.

  Upload images into the comment (Linear MCP `prepare_file_upload`, then PUT, then embed the returned markdown), so they stay with the ticket rather than in chat or a scratch folder. Anything that couldn't be checked is listed as **Still open**, and the ticket stays open until it is. Docs-only pushes to `main` don't need a ticket. `AGENTS.md` repeats this rule for other AI tools and points them here.
- **When a change needs no ticket (T63, T64).** The test: if it's being finished now and nobody needs to track it, it doesn't need a ticket.

| Situation | What to do |
|---|---|
| Small fix made while working on a ticket | Include it in that PR and mention it in the PR body |
| Standalone touch-up with no real behavior change (copy, styling, typo, small config) | PR title ends with `(ALL-000)` |
| Docs-only change | Push straight to `main` |
| Changes behavior, or touches money, auth, data or schema | Ticket |
| Too big to finish in one sitting, or needs a decision | Ticket |
| Found now but not being fixed now | Ticket, so it doesn't get lost |

  Agents can use `ALL-000` for touch-ups without asking, and the owner can agree to it for any other change. It passes the title check and leaves a trail: `git log --grep ALL-000` lists every use. No ticket means no evidence comment, so the PR body says why it needs no ticket, plus E9's two answers. If a change fits both a no-ticket row and a ticket row, ask the owner.
- **Every PR is attached to its Linear ticket.** Linear's GitHub app links a PR when the branch name or title has the ticket ID. Linear also moves the ticket to In Progress when the PR opens (tested on PR #6).
- **Read PR feedback before merging (T59).** Everyone does this, people and agents. As soon as a PR is opened or pushed to, read its review comments while CI runs (`gh pr view <n> --json reviews,comments`, and `gh api repos/gifts-af/gift-me/pulls/<n>/comments` for inline ones), so review comments and CI failures get fixed together in one push. Automated reviews count, and they can arrive a minute or two after a push. Read again right before merging. A comment gets a fix, or a reply saying why not; it never just gets ignored.
- **`Closes` or `Part of`: say `Closes` only if merging finishes the ticket.** `Closes ALL-<n>` makes Linear mark the ticket Done the moment the PR merges. Use it when the PR covers every acceptance criterion and nothing is left but the routine check on production. Write `Part of ALL-<n>` when you already know something will be open after the merge: another PR, a migration still to apply to prod, a check only the owner can do (ALL-71 said `Closes` while the owner still had to test the forms in Gmail, so it closed itself early). `Part of` links the PR without moving the ticket, even with the ID in the branch name (ALL-39's PRs #5, #6, #8). The agent finishing the work moves a `Part of` ticket to Done through Linear once the evidence is posted and nothing is Still open. If a ticket closes and something turns out to be open, the agent moves it back to In Progress and comments why.
- **How `main` is protected** (GitHub rulesets): nobody can force-push or delete it. Changes need a PR with the CI `check` and `pr-title` jobs passing. Repo admins (all of us today) can bypass that rule, which is what makes direct docs pushes work, so the code-via-PR rule above is a habit, not something GitHub enforces for us.
- **Linear priority means "how soon"**, so the board (Ordering: Priority) reads top to bottom as what to start next. Urgent: ready to start now, nothing open blocking it. High: next up, unblocked once the current Urgent work lands. Medium: after that. Low: last or optional. When a ticket's blockers close, or a new ticket is added, set its priority by this rule and keep its "blocked by" links current.
- The repo is `gifts-af/gift-me`. Linear project: Gift Concierge MVP (team key `ALL`).

## Accounts: contribution vs admin

- **Contribution** (commits, branches, PRs, Linear tickets): each person uses their own account. The owner is `aarontallen` / aaron.aallen@gmail.com; Jim is `JimtheBurger`. Branches are named `<github-login>/all-<n>-<short-name>`.
- **Admin** goes through the shared **allensforever711** account (allensforever711@gmail.com). This covers repo transfers, org and repo settings, branch protection, secrets, members, connecting Vercel, Supabase and other services, billing, and vendor accounts such as Zinc. Others may also have admin rights, but admin work is done as allensforever711 (T7).
- **Vercel and Supabase while on Hobby (T25):** the GiftsAF Vercel team (slug `gift-me3`, formerly GiftMe) can't have other members, and Supabase access goes through it. So everyone signs in to the Vercel and Supabase CLIs and dashboards as allensforever711, for daily work too (`vercel env pull`, `supabase db push`). GitHub, Linear and Google Cloud use personal accounts.
- If Claude's GitHub login isn't allensforever711, it gives the person the admin steps instead of doing them as someone else.
