# Agent instructions

For any AI coding agent working in this repo (Codex, Cursor, Copilot, Gemini and others). Claude Code reads `CLAUDE.md` directly.

**Read [`CLAUDE.md`](CLAUDE.md) first and follow it.** It holds this repo's rules: principles, where docs go, code, git and accounts. Nothing here overrides it.

The four rules that are never skipped (T44, T55, T57):

1. **No work without a ticket.** Every change starts from a Linear ticket (team `ALL`) with acceptance criteria. If there isn't one, create it first.
2. **No ticket done without evidence.** Before a ticket is Done, post its test evidence on the ticket as a comment: tests and results, CI, screenshots (before and after for fixes), mock-ups, and live checks after deploy. Images go into the comment, not just the chat. Tick each acceptance-criteria box in the ticket description as its evidence is posted; every box is ticked before Done. See `CLAUDE.md` > Git > Evidence on the ticket. A PR says `Closes ALL-<n>` only if merging finishes the ticket; if anything is known to be left, it says `Part of ALL-<n>`, and you move the ticket to Done in Linear once the evidence is posted (`CLAUDE.md` > Git).
3. **Every spec, plan and PR gets an adversarial review.** A reviewer with fresh context (not the author, not the chat that produced the work) tries to break it against `CLAUDE.md`'s principles (1–10, E1–E10) and the decisions logs, and owns the quality of the approach. Blockers are fixed and owner decisions answered before the next step. Brief: `design/plans/TEMPLATE.md` > Adversarial review; rules: `CLAUDE.md` > Adversarial review.
4. **Re-read the ticket before significant work.** Before a spec, a plan, the first code, a PR, or picking work back up, re-fetch the Linear ticket: description, status, every comment, and its blocking and related tickets. Reconcile anything that changed before going on. Never work from an earlier copy (`CLAUDE.md` > Git).
