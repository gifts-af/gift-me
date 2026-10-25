# Working in this repo

Two people (the owner and Jim) build this with Claude. Everything written here should be easy for a person to pick up cold: they should be able to find a doc in one place, read it top to bottom, and understand what was decided and why.

## Where docs go

Use this layout. It overrides any plugin or skill default (for example, Superpowers saves to `docs/superpowers/specs/` and `docs/superpowers/plans/`; don't use those folders here).

| What | Where |
|---|---|
| Product: PRD, research, product decisions | `planning/` (`PRD.md`, `research/`, `decisions.md`) |
| Technical design | `design/technical-design.md` |
| Technical decisions | `design/decisions.md`, next number in sequence (T16, T17, …) |
| Spike write-ups | `design/spikes/<topic>.md` (e.g. `zinc.md`, `ai.md`, `email.md`) |
| Look and feel, UI kit, mock-up links | `design/ui.md` |
| Build plan for a ticket | `design/plans/ALL-<n>-<short-name>.md` when a plan is worth keeping; otherwise in the Linear ticket |

- Don't create a new top-level folder or a second copy of a doc. Update the existing one.
- When a decision changes the design, update both `design/technical-design.md` and `design/decisions.md`, plus any affected Linear tickets.
- Add new docs to the table in `README.md` so people can find them.

## Writing for the human in the loop

- Lead with the answer or the decision, then the reasons.
- Plain words over jargon. Explain a term the first time it's used.
- Short sections with clear headings; tables for comparisons; diagrams (Mermaid) when a flow is easier to see than read.
- Mark open items so they're easy to scan: **[Verify]** for facts to check, **[Claude's call]** for choices the owner hasn't confirmed.
- Link to the source (ticket, doc section, vendor page) instead of repeating it.

## Git

- **Code:** a branch named after the Linear ticket, then a PR. CI must pass.
- **Planning and design docs** (`planning/`, `design/`, `README.md`, this file): commit and push straight to `main`.
- The repo is `gifts-af/gift-concierge`. Linear project: Gift Concierge MVP (team key `ALL`).
