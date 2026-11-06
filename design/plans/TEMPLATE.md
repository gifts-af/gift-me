# ALL-<n> <Ticket title>: Spec and Plan

> Copy this file to `design/plans/ALL-<n>-<short-name>.md`. Small tickets can skip the file and put the **Spec** section (what it does + acceptance criteria) in the Linear ticket instead.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one sentence: what's true when this ticket is done.

**Links:** the Linear ticket, the PRD or design sections, decisions (D#, T#), and mock-ups.

## Spec: what it does

Written first, before any plan. Describe *what* and *why*, not *how*.

### Who it's for and what they can do

One short story per thing a user can do, most important first. Each one should be something we could ship and test by itself.

1. **<Story name>:** as a <buyer / list owner / admin>, I can <do something> so that <reason>.

### Acceptance criteria

Each criterion is checked by at least one test. Number them so tasks and tests can point back.

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | <starting state> | <the user or system does this> | <what must be true> |

### Out of scope

What this ticket deliberately doesn't do, and which ticket does it instead.

### Open questions

Resolve these with the owner **before** the plan below is written (a "clarify" pass). Mark each one **[Verify]** (a fact to check) or **[Claude's call]** (a choice the owner hasn't confirmed). Once answered, move them into "What was decided".

## What was decided, and why

| Question | Answer | Why |
|---|---|---|

## Principles check

Go through CLAUDE.md > Principles. Note anything this plan bends, and why. Write "none" if nothing does.

- **Simplest version?** What we cut:
- **Hard-coded values?** New settings rows or env vars (T23):
- **Product boundaries?** Cross-module imports or tables (T19):
- **New personal data?** Each new field, column or event property that holds personal data, and the feature that needs it now (T42):
- **Docs and decisions** that need updating:

## Plan

**Architecture:** two or three sentences.

**Tech stack:** what's touched.

### Task 1: <name> (AC-1, AC-2)

Mark tasks that can run alongside others with **[P]**.

- [ ] Write the failing test
- [ ] Make it pass
- [ ] Commit

## Before coding: consistency check

- [ ] Every acceptance criterion maps to a task and a test.
- [ ] Every task traces back to a story or criterion (nothing extra).
- [ ] No open questions are left.
- [ ] Adversarial review of the spec done, and again of the plan (below); blockers fixed, owner decisions answered.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of what people see (before and after for fixes; phone and desktop, light and dark where it matters) and any mock-ups, uploaded into the ticket comment.
- [ ] Live check after deploy, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

The riskiest things to check in review, each with the test that covers it.

## Adversarial review (T55)

Run three times: on the spec, on the plan, and on the PR (`requesting-code-review`). Give a **fresh** agent this brief, filling in the paths. Don't paste the conversation or your conclusions.

```
You are the adversarial reviewer for <the spec / the plan / PR #n> in the
gift-concierge repo: <path or PR>. You are accountable for the quality of the
approach. If it ships and breaks the project's own rules, loses money, leaks a
secret or personal data, or is more complex than needed, that's on you. Find
what's wrong; don't approve. Assume the author was optimistic. Read-only.

Read first, in full: CLAUDE.md (How we work 1-10, How we build E1-E10 and
their "Breaks it:" lines), design/decisions.md, planning/decisions.md, and the
technical-design sections and code the work touches.

Attack: money paths (double buys, over-cap buys, buying after the user changed
their mind or a round closed, races between callers); secrets and personal
data (T42, E6); simplicity (1, E1, E2): what could be cut; contradictions with
recorded decisions, the schema or the engine, including changes the work
doesn't say it's making; acceptance criteria that can't be tested.

Return a ranked list (blocker / should-fix / nit). For each: the principle or
decision it breaks (cite the number), the concrete failure scenario, and the
fix you'd require. List owner decisions (product or money calls) separately.
Skip anything that's fine.
```

