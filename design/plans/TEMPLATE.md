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

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of what people see (before and after for fixes; phone and desktop, light and dark where it matters) and any mock-ups, uploaded into the ticket comment.
- [ ] Live check after deploy, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

The riskiest things to check in review, each with the test that covers it.
