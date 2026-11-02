# Agent instructions

For any AI coding agent working in this repo (Codex, Cursor, Copilot, Gemini and others). Claude Code reads `CLAUDE.md` directly.

**Read [`CLAUDE.md`](CLAUDE.md) first and follow it.** It holds this repo's rules: principles, where docs go, code, git and accounts. Nothing here overrides it.

The two rules that are never skipped (T44):

1. **No work without a ticket.** Every change starts from a Linear ticket (team `ALL`) with acceptance criteria. If there isn't one, create it first.
2. **No ticket done without evidence.** Before a ticket is Done, post its test evidence on the ticket as a comment: tests and results, CI, screenshots (before and after for fixes), mock-ups, and live checks after deploy. Images go into the comment, not just the chat. See `CLAUDE.md` > Git > Evidence on the ticket. PR descriptions say `Part of ALL-<n>`, never `Closes ALL-<n>`, so merging doesn't mark the ticket Done before the checks; move it to Done by hand afterwards.
