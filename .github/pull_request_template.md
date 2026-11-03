<!--
Title: <type>: <what changed> (ALL-<n>), e.g. "feat: budget math for multi-select picks (ALL-19)".
Types: feat, fix, docs, refactor, test, chore, ci, perf. See CLAUDE.md > Git.
-->

Closes ALL-<n>  <!-- "Closes" only if merging finishes the ticket; if anything is known to be left (another PR, a prod migration, an owner check), write "Part of ALL-<n>" (CLAUDE.md > Git) -->

## What changes

## How it was verified

<!-- Tests added (and that they failed first), suite results, screenshots. Post the same evidence on the Linear ticket before it's Done (CLAUDE.md > Git > Evidence on the ticket, T44). -->

- [ ] Test evidence and screenshots posted on the Linear ticket
- [ ] Any new migration is expand-then-contract (E7): it adds without dropping or renaming anything live code uses, because CI applies it to `dev` and `prod` while Vercel deploys the code (T50)

## On production (CLAUDE.md > E9)

- **How we'll see it working:** <!-- the page to check, or the event/log to look for -->
- **How to turn it off:** <!-- Vercel rollback, an app_settings switch, or "n/a, docs only" -->
