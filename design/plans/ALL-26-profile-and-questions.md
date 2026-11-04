# ALL-26 Profile view, guided questions, readiness meter: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a buyer can see and fix everything the app knows about a person, answer a few questions that fill the gaps (also from an email link on a phone), and see how ready that person's ideas are, with one suggested next step.

**Links:** [ALL-26](https://linear.app/allens-forever/issue/ALL-26) · design §3, §3.1, §6.4, §6.7 · PRD C-4, C-6, C-7, C-8 · decisions 45, 47, 51 · T23, T26, T27, T38, T42, T48, T53 · [Person mock-up](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW#person)

## Spec: what it does

### Who it's for and what they can do

1. **See what we know:** as a buyer, I can see a person's facts grouped by category, each showing where it came from, so I can trust or correct it.
2. **Fix what's wrong:** as a buyer, I can edit a fact, turn it off, or delete it for good, so wrong or unwanted facts stop shaping gift ideas.
3. **Answer questions:** as a buyer, I get up to 5 short questions about what's missing, on a phone-friendly form, and each answer becomes facts, so a new person isn't a blank page.
4. **Answer from email:** as a buyer, I can open that form from a link in a heads-up or reminder email on my phone.
5. **Know how ready they are:** as a buyer, I see one readiness meter on the person's page with one suggested next step.

### Acceptance criteria

The first three rows are the ticket's own criteria.

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A new person with no captures | The buyer opens their page | The meter reads 0 and "Just starting"; the next step offers 5 questions; the form shows those 5 |
| AC-2 | The same person | The buyer answers some and saves | Each answer is saved as facts with `source = question`, `confirmed = true`; comma or line-separated answers become separate facts; the meter goes up; those questions are gone |
| AC-3 | A signed link for a round, on a phone (Android and iPhone widths) | The buyer signs in if needed, then confirms | They land on that person's form, can answer, and the answers save. A plain GET uses nothing up |
| AC-4 | A fact | The buyer deletes it and confirms | The row is gone; it's not in the profile or in `activeFacts` (what ALL-27 reads); the meter recalculates. A later capture may suggest it again, and the confirm says so |
| AC-5 | A fact | The buyer turns it off | It moves to "Turned off", leaves `activeFacts` and the meter, and the AI still won't re-suggest it (D47). Turning it on restores it |
| AC-6 | A fact | The buyer edits value and/or category | It's saved and `confirmed = true`. A value that duplicates another fact of that category gets a plain message, not an error page |
| AC-7 | A person with facts from several sources | The buyer opens the page | Facts are grouped by category; each shows its source; unconfirmed AI facts are marked ✨ AI suggestion, with a link to the captured page |
| AC-8 | A guided answer or fact edit that touches a sensitive trait (C-8) | The buyer saves | Nothing in that submit is saved; the form says why and keeps what they typed |
| AC-9 | A question | The buyer skips it | It's not asked again; the meter doesn't change; the next missing question can take its place |
| AC-10 | A round whose person has open questions | The heads-up or a reminder is sent | The email has a plain link to the form with the count, under its one button. With no open questions, or in any other email, there's no link |
| AC-11 | `guided_questions_max` = 0, or `readiness_meter_enabled` = 0 | Pages and emails render | Questions (form, next step, email link) or the meter are off, with no deploy |
| AC-12 | Another signed-in user, or a deleted person | Answering or reading through the database | Refused. `questions.answer` stays empty after answering |
| AC-13 | Any of the actions above | It runs | One structured event with ids and counts only (E6) |

### Out of scope

- **"Add a note" (the mock-up's bottom button)** and typing a fact by hand: no ticket asks for it here. Facts come from captures and questions for now. Worth a small follow-up ticket; flagged in the PR.
- **Past gifts on the person page:** needs orders (D-3).
- **Deleting a capture's raw text and screenshot:** goes with the privacy pass (ALL-37). Deleting a fact doesn't touch the capture it came from.
- **Parsing email replies** (§6.7) and the idea engine itself (ALL-27).
- **The meter on Home cards:** the signed-off mock-up shows it on the person page only.

### Open questions

None left. Three were brought to Jim on 2026-11-04; the rest are written down below.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| What does Delete do? | **Two actions.** Turn off keeps the text, stays out of ideas, can be undone, and the AI won't suggest it again. Delete erases the row, so a later capture could suggest it again, and the confirm says so. | Jim, decision 51. C-7 and T42 need a real erase; D47's "never comes back" now belongs to Turn off. |
| Keep the raw text in `questions.answer`? | **No.** Facts only; `questions` records which question and its status. | Jim, decision 51. Otherwise a deleted fact's text lives on. No AI reads answers, so there's nothing to rebuild. |
| Does the sensitive filter check typed text? | **Yes**, for guided answers and fact edits. Refused, explained, text kept. | Jim, decision 51. C-8 says "store". Loosening later is easy; removing stored sensitive data is hard. |
| Are AI facts still in their own section? | **No.** One list by category, with ✨ on each unconfirmed AI fact. **[Claude's call]** | The ticket asks for grouping by category, and two lists would repeat every heading. D47's point, that AI facts are never mistaken for yours, holds per fact. Reversible. Revises D47's "visibly separate". |
| Which questions? | Six, one per gap, in this order: interests, wants, avoid, sizes, brands, owns. Prompts have no name in them. **[Claude's call]** | Interests shape ideas most; owns is the least urgent. No name means no personal data in the stored prompt, and a rename can't make it stale. |
| Stored or computed? | Computed from facts each time. A `questions` row appears only once answered or skipped. **[Claude's call]** | Nothing to keep in sync. A question is open when none of its categories has an active fact and it wasn't skipped, so deleting the last fact can bring it back. |
| Does a skipped question come back? | No. **[Claude's call]** | Decision 45: no nagging. |
| How is the meter scored? | Points per filled gap, plus points for keeping their own list, capped at 100. Turned-off facts don't count; unconfirmed AI facts do. **[Claude's call]** | Simple and tunable. Values below. D37: their own list is the ideal case. |
| Is an address or birthday part of the meter? | No. **[Claude's call]** | Decision 45 asks for those late. The meter is about gift knowledge. |
| Next step | Open questions first ("Answer 3 questions"). None open and below ready: capture a page. Otherwise nothing. **[Claude's call]** | One step only (C-6). |
| How does an email reach the form? | New action `answer_questions` on the existing `action_links`, finding the person through the round, as `add_address` does. After confirm it goes straight to the form instead of a done page. **[Claude's call]** | No schema change. T38 stands: signed in, confirm by POST, once. One less tap on a phone. Re-opening a used link says "already used", with a way home. |
| Which emails carry the link? | Heads-up and reminders only, as a plain link, not a button. **[Claude's call]** | §6.7, and ui.md's one button per email. A final notice has one job. |
| Answer limits | Split on commas and new lines, trim, drop repeats. More than `guided_answer_max_facts` facts in one answer is refused. | A pasted essay shouldn't become 200 facts. |
| Answer that matches a turned-off fact | Turns it back on, marked confirmed. **[Claude's call]** | The buyer just told us it's true. Skipping it silently would lose the answer. |

## Principles check

- **Simplest version?** Cut: stored question generation, a `questions` table per round, a question editor, Add a note, Home-card meters, a done page after the email link. One new column, one SQL function, no new service or dependency.
- **Hard-coded values?** New `app_settings` rows (T23): `guided_questions_max` 5, `guided_answer_max_facts` 20, `readiness_points_interests` 30, `readiness_points_wants` 20, `readiness_points_sizes` 15, `readiness_points_avoid` 15, `readiness_points_brands` 10, `readiness_points_owns` 10, `readiness_points_own_list` 40, `readiness_ready_pct` 60, `readiness_meter_enabled` 1. Question wording is product copy, in `packages/core` like `factLine`.
- **Product boundaries?** Everything is inside `modules/concierge`; `keepsList` already comes from `getPerson`. No list tables touched (T19).
- **New personal data?** None. `questions.question_key` and the prompt hold no personal data; answers go in the existing `profile_facts.value`. Events hold ids and counts. Less stored than the design planned (no raw answers, T42).
- **E3:** new service functions take the Supabase client as their first argument; server actions and pages build it. `activeFacts` works with the user's client and the admin client, so ALL-27 can reuse it.
- **E5:** no mocked Supabase. Pure rules in Vitest, the database in pgTAP, the rest in Playwright.
- **E7/E9:** on production we'll see `profile.*` and `questions.*` events; off switches are in AC-11. The migration is expand-only.
- **Bends:** `questions.answer` stays as an unused column (dropping it can wait; expand-then-contract). `capture/facts.ts`'s old read path is replaced, not kept.
- **Docs and decisions:** decision 51, T53, design §3, §3.1, §6.7, PRD C-3/C-8 notes, ui.md. A note on ALL-27 to read `activeFacts`.

## Plan

**Architecture:** pure rules (which questions, what score, which next step, how an answer splits) live in `packages/core/src/profile.ts`. `modules/concierge/profile/` holds a thin service over the Supabase client plus form parsing. `app/people/[id]/` gets the rewritten "What we know" section, the readiness banner, and a `questions` route. Emails get a link through the existing `notify` and `action_links` path.

**Tech stack:** Next.js 16, Supabase (SQL function called with `.rpc()`, T46), Vitest, pgTAP, Playwright. No new dependency.

### Global constraints

- Tap targets ≥ 44 px, inputs 16 px, one teal main action per screen, main button fixed to the bottom on phones (`design/ui.md`).
- Settings have no fallback in code: a missing row throws (T23).
- Events are ids and counts only (E6). Never log a fact's text.
- Commit style: `feat:`/`test:` etc., ending with the attribution line.

### Task 1: Pure rules (AC-1, AC-2, AC-7, AC-9)

**Files:** create `packages/core/src/profile.ts`, `packages/core/src/profile.test.ts`; modify `packages/core/src/index.ts`.

**Produces:**

```ts
type QuestionKey = "interests" | "wants" | "avoid" | "sizes" | "brands" | "owns";
type GuidedQuestion = { key: QuestionKey; prompt: string; hint: string; category: FactCategory; categories: readonly FactCategory[] };
const GUIDED_QUESTIONS: readonly GuidedQuestion[]   // in the Spec's order
const CATEGORY_GROUPS: readonly { category: FactCategory; label: string }[]  // all ten, display order
factSourceLabel(source: string, confirmed: boolean): string
openQuestions(active: Iterable<FactCategory>, skipped: Iterable<string>, max: number): GuidedQuestion[]
splitAnswer(text: string): string[]
type ReadinessSettings = { points: Record<QuestionKey, number>; ownList: number; readyPct: number };
readinessScore(active: Iterable<FactCategory>, keepsList: boolean, s: Pick<ReadinessSettings, "points" | "ownList">): number
readinessLabel(score: number, readyPct: number): "Just starting" | "Getting there" | "Good to go"
nextStep(openCount: number, score: number, readyPct: number): { kind: "answer"; count: number } | { kind: "capture" } | { kind: "none" }
```

Question categories: interests = interest, loved; wants = wants; avoid = avoid, dislike, constraint; sizes = size; brands = brand, style; owns = owns. Answers save to the first category listed. Source labels: capture unconfirmed "✨ AI suggestion"; capture confirmed "From a capture"; question "You answered"; note "You told us"; reaction "From their reaction"; rejection "From an idea you passed on"; inbound "From your email". `readinessLabel` is "Just starting" only at 0.

- [ ] Write failing tests: a new person gets the first 5 in order; max 0 gives none; a fact in any of a question's categories closes it; skipped keys are excluded and the next fills in; `splitAnswer("fly fishing, crime podcasts\n Fly  Fishing")` gives two values; score is 0 for nothing, adds points, caps at 100 with a list; `nextStep` for each case; every `FactCategory` is in `CATEGORY_GROUPS`.
- [ ] Run `pnpm --filter @gifts-af/core test`: fails (no module).
- [ ] Implement; run: passes. Commit.

### Task 2: Database (AC-2, AC-11, AC-12)

**Files:** create `supabase/migrations/20261107100000_guided_questions.sql`, `supabase/tests/guided_questions.test.sql`; regenerate `packages/core/src/database.types.ts`.

**Produces:** `concierge.questions.question_key text` with `unique (person_id, question_key)`; the settings rows above; `concierge.answer_questions(p_person_id uuid, p_answers jsonb) returns integer`, where `p_answers` is `[{ key, prompt, category, values: [text] }]` and the result is the number of facts saved.

The function is `security invoker` with `search_path = ''`; execute revoked from public and granted to `authenticated` only (T26). It raises when the person isn't visible (RLS hides other users' and deleted people). In one transaction, per answer: upsert the `questions` row on `(person_id, question_key)` with `status = 'answered'` and `answer` null; upsert each fact with `source = 'question'`, `source_id` = that question, `confirmed = true`, on conflict `(person_id, category, value_key)` setting `active = true, confirmed = true`.

- [ ] Write failing pgTAP: settings values; answer creates facts with source and confirmed; `answer` stays null; a duplicate of a turned-off fact is reactivated, not doubled; user B's call raises and writes nothing; a soft-deleted person raises; `anon` has no execute; an unknown category raises 23514; a user can hard-delete their own fact and B can't; re-answering a question updates one row.
- [ ] Run `pnpm db:test`: fails. Write the migration, reset local, `pnpm db:types`, run: passes.
- [ ] `supabase db push --linked` to hosted dev (standing instruction). Commit.

### Task 3: Service and parsing (AC-2, AC-4, AC-5, AC-6, AC-8, AC-9, AC-11, AC-13)

**Files:** create `modules/concierge/profile/rules.ts`, `modules/concierge/profile/profile.ts`, `modules/concierge/__tests__/profile-rules.test.ts`; modify `modules/concierge/index.ts`, `modules/concierge/capture/facts.ts` (remove `getWhatWeKnow`, `removeFact`).

**Produces:**

```ts
// rules.ts (pure)
parseAnswers(fields: Record<QuestionKey, string>, maxFacts: number):
  { ok: true; answers: { key; prompt; category; values: string[] }[] } | { ok: false; error: string; key?: QuestionKey }
parseFactEdit(input: { category: string; value: string }): { ok: true; category: FactCategory; value: string } | { ok: false; error: string }
// profile.ts: `Db` is the typed Supabase client
activeFacts(db, personId): Promise<{ id; category; value; source; sourceId; confirmed }[]>
getProfile(db, personId, keepsList): Promise<Profile>
openQuestionCount(db, personId): Promise<number>
getOpenQuestions(db, personId): Promise<GuidedQuestion[]>
answerQuestions(db, personId, answers): Promise<SaveResult>
skipQuestion(db, personId, key): Promise<SaveResult>
updateFact(db, factId, { category, value }): Promise<SaveResult>
setFactActive(db, factId, active): Promise<SaveResult>
deleteFact(db, factId): Promise<SaveResult>
```

`Profile` = `{ groups: { category, label, facts: ProfileFact[] }[]; off: ProfileFact[]; unread: number; readiness: { score, label, step } | null; openCount: number }`; `ProfileFact` adds `sourceLabel`, `sourceTitle`, `sourceUrl`. `readiness` is null when the meter is off.

Sensitive text uses `isSensitive` from `lib/ai/sensitive.ts`. The refusal says: "We don't keep notes about health, religion, politics or similar. Try wording it another way." A 23505 from `updateFact` returns "That's already on their profile (it may be turned off)." A 23514 returns "That's too long." Events: `questions.answered {user_id, person_id, questions, facts}`, `questions.skipped`, `profile.fact_edited`, `profile.fact_turned_off`, `profile.fact_turned_on`, `profile.fact_deleted`, each with ids.

- [ ] Write failing Vitest for the parsers: blank answers are left out; all blank is an error; more than `maxFacts` refused, naming the question; a sensitive value refused, naming the question and saving nothing; `parseFactEdit` refuses an unknown category, a blank value, a sensitive value.
- [ ] Run: fails. Implement rules: passes. Implement the service (its database behaviour is covered by Tasks 2 and 5). Typecheck. Commit.

### Task 4: Person page (AC-1, AC-4 to AC-8, AC-11)

**Files:** rewrite `app/people/[id]/what-we-know.tsx` and its test; create `app/people/[id]/readiness.tsx` and test; modify `app/people/[id]/person-view.tsx`, `app/people/actions.ts`, `e2e/what-we-know.spec.ts`.

**Consumes:** Task 3. **Produces:** server actions `editFactAction`, `setFactActiveAction`, `deleteFactAction` (replacing `removeFactAction`), shaped `(previous, FormData) => SaveResult`.

Readiness banner under the header, as in the mock-up: the label, a thin bar with `role="meter"`, `aria-valuenow`, `aria-label="How ready ideas for {name} are"`, and the step ("Answer 3 questions" links to `/people/{id}/questions`; capture step is plain text). Read the `dataviz` skill before drawing the bar.

Each fact row: value, source line (with the captured page link when there is one), and a "More" menu labelled `More for {line}` with Edit, Turn off, Delete. Edit opens an inline form with value and category. Delete opens the existing Dialog pattern with the words "A later capture could suggest it again." Turned-off facts sit in a closed `<details>` "Turned off (n)" with Turn on and Delete. Empty state points to questions when they're on.

- [ ] Update component tests first: groups and labels, source lines, ✨ only on unconfirmed AI, turned-off list, meter value and step, null readiness renders nothing. Run: fail.
- [ ] Implement; run: pass. Update `e2e/what-we-know.spec.ts` for the new row actions (turn off, reload, still gone, `active=false`; delete, row gone). Commit.

### Task 5: Question form (AC-1, AC-2, AC-8, AC-9, AC-11)

**Files:** create `app/people/[id]/questions/page.tsx`, `questions-view.tsx`, `question-form.tsx`, its test, `e2e/guided-questions.spec.ts`; modify `app/people/actions.ts`.

**Produces:** `answerQuestionsAction` (redirects to `/people/{id}` on success), `skipQuestionAction`.

Field state is controlled in the client, because React resets uncontrolled inputs after a form action and AC-8 must keep the text. An unknown or deleted person is a 404. No open questions: "No questions right now" with a link back.

- [ ] Write failing `e2e/guided-questions.spec.ts`: new person shows meter 0 and 5 questions (AC-1); answering two raises the meter and makes facts (AC-2, checked over REST); a sensitive answer is refused and the text stays, nothing saved (AC-8); Skip removes it for good and another takes its place (AC-9); `phoneLayoutProblems` is empty; signed-in as someone else gets a 404.
- [ ] Run: fails. Implement; run on android, iphone, desktop: passes. Commit.

### Task 6: Email link (AC-3, AC-10, AC-11)

**Files:** modify `notify/actions.ts`, `notify/links.ts`, `app/a/[token]/actions.ts`, `notify/templates.ts`, `lib/email-layout.ts`, `rounds/engine.ts`, `rounds/store.ts`; tests in `__tests__/links.test.ts`, `templates.test.ts`, `round-engine.test.ts`, `fake-round-store.ts`, `e2e/emails.spec.ts`, `e2e/guided-questions.spec.ts`.

**Produces:** `ActionName` gains `"answer_questions"`; `Action.straight?: true` goes to `next` without a done page; `ConfirmResult`'s done state carries `straight`; `RoundContext.openQuestions: number`; `heads_up` and `reminder` data gain `questions?: number`, links gain `questions?: string`; `EmailParts.link?: { label: string; url: string }`, a plain tappable link (≥ 44 px) under the button.

Link words: "Answer 3 quick questions about {name}" ("1 quick question" for one).

- [ ] Write failing tests: `answer_questions` confirm returns `next` = `/people/{person}/questions` and `straight`; templates show the link only when given, with one button and in the text version; engine adds the link on heads-up and reminders when open > 0, never at 0, never on final notice; Playwright: phone, seeded link, signed out → sign in → confirm → form → answer saved, link now used (AC-3); the question email passes `phoneLayoutProblems`.
- [ ] Run: fail. Implement; run: pass. Commit.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test. AC-1: T1, T5. AC-2: T1, T2, T5. AC-3: T6. AC-4: T2, T4. AC-5: T4 (and `knownFacts` already reads inactive rows, ALL-25). AC-6: T3, T4. AC-7: T1, T4. AC-8: T3, T5. AC-9: T1, T5. AC-10: T6. AC-11: T1, T4, T6. AC-12: T2. AC-13: T3, covered by review (events are one line each and hold only ids).
- [x] Every task traces back to a story or criterion (nothing extra).
- [x] No open questions are left.

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on the Linear ticket: tests added (and that they failed first), suite and CI results.
- [ ] Screenshots of what people see at phone and desktop width, light and dark, uploaded into the ticket comment.
- [ ] Live check after deploy, or listed as **Still open**.
- [ ] Every acceptance-criteria box in the ticket description ticked, each with a pointer to its evidence.

## Review focus

The riskiest things to check in review, each with the test that covers it.

1. **A deleted fact really is gone and isn't re-created by the form:** a stale form re-submitting the same answer is a new answer, by design. pgTAP and `guided-questions.spec.ts`.
2. **Another user's person through the SQL function:** `security invoker` plus the visibility check. pgTAP, user B.
3. **Sensitive text in one of several answers saves nothing at all:** `parseAnswers` refuses before any write. `profile-rules.test.ts`, Playwright AC-8.
4. **A question whose fact was turned off comes back; a skipped one doesn't:** `profile.test.ts`.
5. **The email link for a person deleted after sending:** the round is skipped (T27) and the form is a 404, not an error. `guided-questions.spec.ts`.
