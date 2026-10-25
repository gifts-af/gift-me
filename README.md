# Gift Concierge (working name)

An app that keeps track of friends and family, what they like, and the dates that matter. It picks gifts for those dates and buys them, with as much or as little automation as the user wants and safeguards so nothing gets purchased without time to approve.

## Workspace layout

| Folder | Purpose | Status |
|---|---|---|
| `planning/` | Product discovery: [PRD](planning/PRD.md) (approved 2026-10-17), [decisions log](planning/decisions.md), [research](planning/research/), [longer-term ideas](planning/ideas.md) | Complete |
| `design/` | [Technical design](design/technical-design.md) (approved 2026-10-17), [decisions log](design/decisions.md). Spike write-ups go in `design/spikes/`, look and feel in `design/ui.md`, and ticket build plans in `design/plans/`. | Complete |
| `.claude/` | Shared Claude Code settings (turns on the Superpowers plugin) | Done |
| `apps/`, `packages/`, `supabase/` | Implementation, tracked in Linear by wave ([layout](design/technical-design.md#22-repository-layout)) | Next |

## Getting started

1. Install [Claude Code](https://claude.com/claude-code), clone this repo, and open Claude Code in it.
2. Trust the folder when asked, and accept the prompt to install the **Superpowers** plugin. It's required for all development here (`.claude/settings.json` turns it on). If no prompt appears, run `/plugin install superpowers@claude-plugins-official` and restart Claude Code.

Where new docs go, how to write them, and when to push straight to `main` versus open a PR are in [CLAUDE.md](CLAUDE.md). Claude reads it automatically, and it's written for people too.

## Shared material

- [Roadmap](https://claude.ai/artifact/6D9ycNqhN2yGwvHwsWAaiW): all three products (Gift Concierge, gift lists, scan-to-gift) by now, next and later. Live status is in [Linear projects](https://linear.app/allens-forever/projects).
- [Go-to-market plan](https://claude.ai/artifact/XXghrwZVuTndZNBvnyhkxg): how scan-to-gift brings people in, gift lists keep them, and Gift Concierge earns. Use cases, handoffs between products, and launch phases.
- [Linear project: Gift Concierge MVP](https://linear.app/allens-forever/project/gift-concierge-mvp-d065ee52b117) (tickets labeled Wave 1–6)
- [Pitch deck](https://claude.ai/artifact/9aUauzPty1VKRSKgrZhmHT) (Claude artifact; ask the owner for access)
