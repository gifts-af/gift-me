# ALL-25 Capture extraction and "Here's what I learned": Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when someone captures a page for a person, the app reads it, saves what it learned to that person as clearly marked AI suggestions, and shows a short "Here's what I learned" in the extension. The buyer can remove anything that's wrong.

**Links:** [ALL-25](https://linear.app/allens-forever/issue/ALL-25) · design §3.1, §6.2, §7 · spike `design/spikes/ai.md` (ALL-17, ALL-42) · PRD C-3, C-7, C-8 · T19, T23, T39, T40, T42 · follow-up [ALL-77](https://linear.app/allens-forever/issue/ALL-77) (joining these notes to the person's own list, shelved)

## Spec: what it does

### Who it's for and what they can do

1. **See what was learned right away:** as a buyer, after I click **Capture** in the extension, I see a loading state and then a short "Here's what I learned" about that person, with a link to their page, so I know the capture was worth it.
2. **Be told honestly when nothing was learned:** as a buyer, when the page has nothing the app is confident about, I'm told so ("Nothing new to learn from this page", which also covers a page that only repeats what we know) instead of seeing weak guesses.
3. **Tell AI suggestions apart from what I entered:** as a buyer, on the person's page, the AI's facts sit in their own group, "✨ AI suggestions from your captures", each showing the page it came from. They never look like something I entered.
4. **Remove a wrong suggestion:** as a buyer, I can remove any AI suggestion. It disappears from the page, gift ideas never use it, and a later capture doesn't bring it back.
5. **Retry a failed read:** as a buyer, when the app couldn't read a capture, I'm told and can try again from the popup or the person's page.

### Rules for what counts as a fact

- **Owning isn't wanting.** Something the person is seen using or wearing (an Owala bottle, sunglasses) is recorded as **owns**, never as an interest or a want, unless the page says they want another. Owned items keep gift ideas from suggesting duplicates. The popup shows them as "Already has: …".
- **No forced learning.** Facts below a confidence threshold (setting `capture_fact_min_confidence_pct`, default **60**, i.e. 0.6, the spike's cut) are dropped and never saved.
- **No sensitive traits (C-8).** The prompt forbids them, and a code-side filter drops any fact touching health, medication, pregnancy, religion, sexuality, politics, ethnicity, finances or grief, even if the model slips. A practical constraint stated neutrally ("prefers easy-open, large-grip items") is allowed.
- **No duplicates.** A fact matching one the person already has (same category and value, ignoring case and spacing), active or removed, isn't added again.
- **Only about this person.** Facts about other people mentioned on the page are ignored (from the spike prompt).

### What the person sees

**Extension popup, after Capture:**

1. "Reading the page…" (spinner). Extraction runs while the popup waits; it took 3–7 s in the spike.
2. One of:
   - **Learned something:** "Here's what I learned about Dad", one line per fact ("Wants: a new rotary fly-tying vise", "Already has: Owala water bottle", "Size: large shirt"), then **See everything about Dad →** (opens `/people/<id>` in a new tab).
   - **Nothing confident:** "Nothing new to learn from this page. The capture is saved." plus the same link.
   - **Failed:** "Couldn't read this page. The capture is saved." plus **Try again**.
   - **Extraction switched off** (kill switch): "Saved. We'll learn from it later." The capture stays `pending`.

**Person page (`/people/[id]`), a new "What we know" section:**

```
What we know
  What you've told us                     ← facts with any source except capture; hidden while empty
  ✨ AI suggestions from your captures
    • Wants: a new rotary fly-tying vise   from "Instagram" ↗        Remove
    • Already has: Owala water bottle      from "Instagram" ↗        Remove
  1 capture hasn't been read.  Read it now          ← counts failed and pending captures
```

Nothing creates hand-entered facts yet (ALL-26 adds that), so today only the AI group shows. The empty state reads: "Nothing yet. Capture a page about Dad with the extension and we'll learn from it."

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The W1-3 text fixtures (`dad-1` … `priya-2`) and screenshot fixtures | The fixture check runs against the real model (`pnpm ai:eval`) | Every expected fact listed for that fixture is found (for example `dad-1` gives a want for a rotary vise and owns an old, worn-out vise), and the result is posted on the ticket |
| AC-2 | Any model output, including the recorded spike outputs and hand-written traps | It passes the post-filter | No fact touching a sensitive trait is returned; neutral constraints are kept |
| AC-3 | A capture whose extraction yields a sensitive fact | The capture is processed | That fact never reaches `profile_facts` (database check) |
| AC-4 | A model output with facts at 0.4 and 0.8 and `capture_fact_min_confidence_pct` = 60 | Facts are saved | Only the 0.8 fact is saved |
| AC-5 | A signed-in extension user | They capture a page with learnable facts | The response carries `status: extracted` and the saved facts; the popup shows them, owned items as "Already has: …", plus the link to the person |
| AC-6 | A page with nothing confident | It's captured | The capture is `extracted` with zero facts, and the popup says "Nothing new to learn from this page" |
| AC-7 | The model call fails or returns output that doesn't fit the schema | A capture is processed | The capture is marked `failed`, no facts are saved, and the popup and person page offer Try again |
| AC-8 | A `failed` or `pending` capture | The user taps Try again | Extraction runs again; on success the capture becomes `extracted` with its facts |
| AC-9 | A person with AI facts | The buyer opens their page | AI facts appear only under "✨ AI suggestions from your captures", each with its source page |
| AC-10 | An AI fact | The buyer taps Remove | It's gone from the page, is `active = false`, isn't used for ideas, and a new capture with the same fact doesn't bring it back |
| AC-11 | Another user's capture or fact | Someone tries to read, retry or remove it | They can't (RLS, pgTAP) |
| AC-12 | `capture_extraction_enabled` = 0 | A capture is posted | It's saved as `pending`, the model isn't called, and the popup says "Saved. We'll learn from it later" |
| AC-13 | A capture is processed | The model is called | The prompt carries no names or emails: the person is described only by relationship (T42) |

### Out of scope

- A **Keep** button that moves an AI fact into "What you've told us" (Jim, 2026-11-02: not now; maybe later).
- Adding or editing facts by hand, guided questions, readiness meter: **ALL-26**.
- Showing AI facts on the person's own GiftsAF list, or buyer-only suggestions there: **ALL-77**.
- Adding the product you're viewing to your own list from the extension: **ALL-78**. To someone else's list as a buyer-only suggestion: **ALL-77**.
- Using facts to make gift ideas: **ALL-27**.
- Inbound email notes: **ALL-31** (it reuses this extraction).
- Re-running extraction over old captures when the prompt or model changes (design §3.1, later).
- Processing `pending` captures left behind while the kill switch was off happens only through Try again; there's no background sweep (E1).

### Open questions

None left. Calls made along the way are in the table below.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Does the user confirm each fact before it counts? (PRD C-3 says "for the user to confirm") | **No confirm step.** Facts are saved straight away, active, marked as AI, and removable. **Revises PRD C-3** (new product decision D47) | Jim, 2026-11-02: clicking Capture is already the buyer saying they're interested in what's on the page, so it counts as confirmation. The AI label keeps the line clear, and Remove fixes mistakes |
| Keep button? | **Not now.** AI facts stay labeled AI forever; only Remove | Jim, 2026-11-02. Keeps the two groups honestly separate |
| Where do learned facts live? | The buyer's private notes on the person (`concierge.profile_facts`, `source = capture`), not the person's own list | Jim, 2026-11-02. One list per person comes later in ALL-77 |
| Background job or wait in the request? | **Wait in the request.** `POST /api/captures` saves, then extracts, then responds | E1: no queue or worker needed for 3–7 s. Route `maxDuration` 60 s **[Claude's call]** |
| How does the extension retry? | `POST /api/captures/[id]/extract` (bearer token, same CORS as `/api/captures`); the web page uses a server action calling the same module function | One code path for both |
| Response shape change | `POST /api/captures` keeps `{ id }` and **adds** `extraction: { status, facts: [{ id, category, value }] }`. Additive, so an older extension build still works (E4) | **[Claude's call]** |
| Fact categories | Add **`wants`** and **`constraint`** to the `profile_facts.category` check (additive migration). The prompt's categories become exactly the database's | The spike's prompt used both; `wants` is the heart of "owning isn't wanting", and `constraint` holds neutral needs like "large-grip". **[Claude's call]** |
| Confidence cut | `capture_fact_min_confidence_pct` = 60 (whole numbers, like every setting) in `concierge.app_settings`. Confidence isn't stored | T23; the spike used 0.6. Not storing it is the minimum (T42) |
| Kill switch | `capture_extraction_enabled` = 1 (0 turns it off) in `app_settings` | E7 |
| Sensitive term list | Kept **in code** (`apps/web/lib/ai`), with tests, not in settings | It's a safety rule, not a tunable value; changing it should need review and a test. **[Claude's call]** |
| What the model is told about the person | Relationship only ("their father"), never their name | T42: send outside services the minimum. Page text may still contain names; that's the capture itself |
| Model | Per T39 and §7: Sonnet 5.5 through AI Gateway, effort `low`, in the `lib/ai` config map. The exact gateway ID comes from `GET /v1/models` | Already decided |
| Removed facts | `active = false` (kept), so dedupe can stop a later capture bringing it back | AC-10. Deleting the person still deletes everything (C-7) |
| Expected facts for AC-1 | Claude drafts `expected.json` (2–4 must-find facts per fixture, taken from what Opus and Sonnet both found in the spike), and Jim reviews it in the PR. A fact matches on **category plus key words** ("wants" + "rotary vise"), not exact wording. A missed must-find fact fails AC-1 and means fixing the prompt within this ticket. Screenshots: only `dad-post-mock.png` is committed; the two real-page shots are recreated locally with `spikes/ai/screens.mjs` before `pnpm ai:eval` (repo is public) | **[Claude's call]** |
| The buyer's note on a capture (`captures.note`) | Sent to the model with the page, labeled as the buyer's note. Facts from it are still AI suggestions (the AI wrote them) | It's often the best evidence ("he said this broke"). Like the page text, it's the buyer's own capture (T42 covers what *we* add). **[Claude's call]** |
| `profile_facts.confirmed` for AI facts | Saved as `confirmed = false`; `active = true`. ALL-27 reads **every active fact** and tells the model which are AI suggestions. The column stays for ALL-26 (hand-entered facts are `confirmed = true`) | Matches what it means: nobody vouched for it. **[Claude's call]** |
| `pending` captures | Try again accepts `pending` and `failed`. The person page line counts both: "2 captures haven't been read. Read them now" | Otherwise captures saved with the kill switch off are never read |
| A capture that's mostly about something sensitive | The filter drops only the sensitive **facts**. The capture's text and screenshot are kept like any other capture. The term list targets sensitive topics precisely (for example "debt", "salary"), so neutral facts like "Wants: a new wallet" pass; tests cover both | Jim, 2026-11-02, on Claude's recommendation: the buyer chose to capture it, only they can see it, and deleting the person deletes it |
| Fixture check (AC-1) | Offline: Vitest runs the parser and post-filter on the **recorded** Sonnet outputs in `spikes/ai/out/` (moved to `apps/web/lib/ai/fixtures/`). Live: `pnpm ai:eval` calls the real model on every fixture and checks the expected facts. Not in CI (costs ~10¢ and needs the key); run once and posted on the ticket | E5: mock what we don't own in CI, check the real thing deliberately |

## Principles check

- **Simplest version?** Cut: confirm queue, Keep button, background job, stored confidence and evidence, a sweep for pending captures.
- **Hard-coded values?** New `app_settings` rows: `capture_fact_min_confidence_pct` (60), `capture_extraction_enabled` (1). Model ID lives in the `lib/ai` config map per §7. Route `maxDuration` is a Next.js static export (has to be a literal).
- **Product boundaries?** Concierge only. No list tables touched (T19).
- **New personal data?** No new columns. Facts were already designed (§3.1). Page text and screenshot go to AI Gateway, which is the feature itself; the prompt sends relationship, not name (T42). Events carry ids and counts only.
- **Docs and decisions** to update: `planning/decisions.md` D47 (revises C-3); `planning/PRD.md` C-3 wording; `design/technical-design.md` §6.2 step 4–5 and §3.1 (no confirm, categories); `design/decisions.md` T48 (wait in request, additive response, categories, term list in code); `README.md` (`pnpm ai:eval` row, this plan); `planning/ideas.md` gets nothing (ALL-77 holds the list idea).

## Plan

**Architecture:** `POST /api/captures` saves the capture as today, then calls `processCapture` in the concierge module. That loads the capture and its screenshot, asks the model for candidate facts through `apps/web/lib/ai` (AI SDK `generateObject` through AI Gateway), keeps only confident, non-sensitive, new facts, saves them as `profile_facts` (`source = capture`), and sets the capture's status. The same function serves Try again (extension route and web server action). The person page reads facts grouped by source, and the popup renders what the route returns.

**Tech stack:** Next.js 16 route handlers and server actions, Supabase (SQL migration, pgTAP, RLS as the user), AI SDK `ai` + `zod` (new dependencies in `apps/web`, §7), Vitest, Playwright, the Chrome extension (React popup).

### Global constraints

- Settings (T23), read with `concierge.setting_int`: `capture_fact_min_confidence_pct` = 60, `capture_extraction_enabled` = 1, `capture_extract_timeout_ms` = 40000 (added in the final review). No fallback constants in code.
- Model: `AI_MODELS.extraction` in `apps/web/lib/ai/models.ts`, Sonnet 5.5's gateway ID from `GET https://ai-gateway.vercel.sh/v1/models` (spike: dots, not dashes), effort `low`.
- The prompt names the person only by relationship (`relationshipLabel` from `@gifts-af/core`), never by name or email (AC-13, T42).
- Business logic (`modules/concierge`, `lib/ai` functions) never reads `process.env` and never creates clients. Routes and actions build the model and the stores (E3).
- New server logging goes through `logEvent` (`apps/web/lib/log.ts`): one JSON line, ids and counts only (E6).
- Fact categories, exactly: `interest, dislike, size, brand, owns, wants, style, avoid, constraint` (the model's enum). The database also keeps `loved`.
- Popup and page copy is the spec's, word for word: "Reading the page…", "Here's what I learned about {name}", "Nothing new to learn from this page. The capture is saved.", "Couldn't read this page. The capture is saved.", "Saved. We'll learn from it later.", "See everything about {name} →", "✨ AI suggestions from your captures", "What you've told us", "{n} capture(s) hasn't/haven't been read. Read it/them now".
- Route `maxDuration = 60` on both capture routes.

### Review focus

1. **The model returns something odd** (empty array, a category outside the enum, an empty or 500-character value, confidence above 1): schema validation rejects it and the capture becomes `failed`. It never half-saves. *Test:* Task 3 `extractFacts rejects out-of-schema output`, Task 4 `processCapture marks failed and saves nothing when extract throws`.
2. **The same capture is processed twice** (double-tapped Try again, or a retry racing the first call): no duplicate facts. *Test:* Task 4 `processCapture is a no-op for an extracted capture` (only `pending` and `failed` are processed) plus dedupe.
3. **A neutral fact containing a word near a sensitive topic:** "Wants: a new wallet" passes. "Into: church architecture tours" is blocked, because religion terms match whole words; erring safe is accepted. *Test:* Task 3 sensitive-filter table.
4. **A capture with no screenshot or no text** (the screenshot upload rolled back, or a blank page): extraction runs on whatever exists and doesn't throw on a missing image. *Test:* Task 4 `processCapture works with text only`.
5. **The model call is slow or the gateway is down**: the route still answers within `maxDuration` with the capture saved and `failed`. *Test:* Task 5 route test where `extract` rejects → 201 with `extraction.status = "failed"`.

---

### Task 1: Migration: two fact categories and two settings (AC-4, AC-12)

**Files:**
- Create: `supabase/migrations/20261104100000_capture_extraction.sql` (plus `…100100_profile_fact_unique.sql` and `…100200_capture_extract_timeout.sql` from the final review)
- Create: `supabase/tests/capture_extraction.test.sql`
- Modify: `packages/core/src/database.types.ts` (generated)

**Interfaces:**
- Produces: `profile_facts.category` accepts `wants`, `constraint`; settings `capture_fact_min_confidence_pct` (60), `capture_extraction_enabled` (1).

- [ ] **Step 1: Write the failing pgTAP test** `capture_extraction.test.sql`, `plan(6)`: both settings read 60 and 1; as user A, inserting a `profile_facts` row with category `wants` and one with `constraint` lives; a made-up category `mood` throws `23514`; user B can't see or update A's fact (RLS, AC-11).
- [ ] **Step 2: Run `pnpm supabase start && pnpm db:test`.** Expected: the new file fails on the categories and settings.
- [ ] **Step 3: Write the migration.** Drop and re-add the category check with the old eight values plus `wants` and `constraint` (expand only, nothing removed), and insert both settings with descriptions, `on conflict (key) do nothing`.
- [ ] **Step 4: `pnpm supabase db reset && pnpm db:test && pnpm db:types`.** Expected: all pass, types regenerated.
- [ ] **Step 5: Commit** `feat(db): wants and constraint facts, capture extraction settings (ALL-25)`.

### Task 2: Fact labels in `packages/core` [P]

**Files:**
- Create: `packages/core/src/facts.ts`, `packages/core/src/facts.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `type FactCategory = "interest" | "dislike" | "size" | "brand" | "owns" | "wants" | "style" | "avoid" | "constraint" | "loved"`; `FACT_CATEGORIES_EXTRACTED: readonly FactCategory[]` (the nine without `loved`); `factLine(category: FactCategory, value: string): string`.

- [ ] **Step 1: Failing test.** `factLine("owns", "Owala water bottle") === "Already has: Owala water bottle"`, `wants` → "Wants: …", `interest` → "Into: …", `dislike` → "Dislikes: …", `size` → "Size: …", `brand` → "Likes the brand: …", `style` → "Style: …", `avoid` → "Avoid: …", `constraint` → "Needs: …", `loved` → "Loved: …".
- [ ] **Step 2: Run `pnpm --filter @gifts-af/core test`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement and export** from `index.ts`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): one-line labels for profile facts (ALL-25)`.

### Task 3: `lib/ai`: model config, extraction prompt and schema, sensitive filter (AC-2, AC-13)

**Files:**
- Create: `apps/web/lib/ai/models.ts`, `apps/web/lib/ai/extract.ts`, `apps/web/lib/ai/sensitive.ts`
- Create: `apps/web/lib/ai/fixtures/` (move `spikes/ai/fixtures/captures.json`, `screens/dad-post-mock.png`, `screens/manifest.json`, and `spikes/ai/out/extract-claude-sonnet-5.5.json`, `screens-claude-sonnet-5.5.json` as `recorded/`). Leave a one-line README in `spikes/ai/fixtures/` pointing to the new home, and update `spikes/ai/run.mjs` paths.
- Test: `apps/web/lib/ai/__tests__/extract.test.ts`, `apps/web/lib/ai/__tests__/sensitive.test.ts`
- Modify: `apps/web/package.json` (add `ai`, `zod`, latest stable, exact versions)

**Interfaces:**
- Produces:
  - `AI_MODELS: { extraction: string }`, `EXTRACTION_PROVIDER_OPTIONS` (effort low).
  - `type CandidateFact = { category: FactCategory; value: string; confidence: number }`
  - `type ExtractInput = { relationship: string; url: string; title: string; text: string; note: string | null; screenshot: Uint8Array | null }`
  - `type Extract = (input: ExtractInput) => Promise<CandidateFact[]>`
  - `createExtractor(model: LanguageModel): Extract`. It throws on a model error or out-of-schema output.
  - `isSensitive(value: string): boolean`

- [ ] **Step 1: Failing tests, `sensitive.test.ts`.**
  - Every fact in `fixtures/recorded/*.json` whose fixture is a trap (`june-2`, `priya-1`, `priya-2`, `sam-1`), after `isSensitive` filtering, contains no value matching `/arthritis|blood pressure|medication|pregnan|diwali|temple|baby/i`.
  - A table of blocked values ("pregnant, due in May", "goes to temple weekly", "takes blood pressure meds", "votes Democrat", "gay", "grieving her husband", "in debt", "on chemo") → `true`.
  - A table of allowed values ("prefers easy-open, large-grip items", "wants a new wallet", "Onyx coffee beans", "rotary fly-tying vise", "running gear") → `false`.
- [ ] **Step 2: Failing tests, `extract.test.ts`.** Use `MockLanguageModelV2` (or the current mock export) from `ai/test`.
  - `createExtractor` returns the facts the model returns.
  - `extractFacts sends relationship, not name`: the prompt the mock receives contains "their father" and contains no `name` field; the input type has no name.
  - `extractFacts includes the screenshot as an image part when present, and no image part when null`.
  - `extractFacts includes the buyer's note labeled as the buyer's note`.
  - `extractFacts rejects out-of-schema output`: category `mood`, confidence 1.5 and value "" each make it throw.
- [ ] **Step 3: Run `pnpm --filter @gifts-af/web test lib/ai`.** Expected: FAIL.
- [ ] **Step 4: Implement.** The system prompt is the spike's `EXTRACT_SYSTEM` plus the screenshot rule (`SCREENS_EXTRA`), with the categories set to `FACT_CATEGORIES_EXTRACTED` and two added rules:
  - "Something the person is only seen with, using or wearing is `owns`, never `interest` or `wants`, unless the page says they want another."
  - "If nothing is clear, return an empty list. Never pad it."

  Schema: `{ facts: [{ category: enum, value: string 1–200, confidence: number 0–1, evidence: string }] }`. `evidence` helps the model, but it's dropped before returning. The `isSensitive` term list is whole-word, case-insensitive regexes grouped by topic (health and medication, pregnancy, religion, sexuality, politics, ethnicity, finances, grief), with a comment pointing to C-8.
- [ ] **Step 5: Run again.** Expected: PASS. Also `pnpm --filter @gifts-af/web typecheck`.
- [ ] **Step 6: Commit** `feat(ai): capture extraction prompt, schema and sensitive filter (ALL-25)`.

### Task 4: `processCapture` in the concierge module (AC-3, AC-4, AC-6, AC-7, AC-8, AC-10, AC-12)

**Files:**
- Create: `apps/web/modules/concierge/capture/extract.ts`, `apps/web/lib/log.ts`
- Modify: `apps/web/modules/concierge/capture/store.ts`, `supabase-store.ts`, `apps/web/modules/concierge/index.ts`
- Test: `apps/web/modules/concierge/__tests__/capture-extract.test.ts`, `apps/web/lib/__tests__/log.test.ts`

**Interfaces:**
- Consumes: `Extract`, `CandidateFact`, `isSensitive` (Task 3); `relationshipLabel` (core).
- Produces:
  - `logEvent(name: string, fields: Record<string, string | number | boolean | null>): void` writes `JSON.stringify({ event: name, at: ISO, ...fields })` to stdout.
  - `type SavedFact = { id: string; category: FactCategory; value: string }`
  - `type Extraction = { status: "extracted" | "failed" | "pending"; facts: SavedFact[] }`
  - `factKey(category: string, value: string): string` (lowercase, whitespace collapsed, trimmed).
  - `selectFacts(candidates: CandidateFact[], existingKeys: Set<string>, minConfidencePct: number): { keep: CandidateFact[]; blocked: number }`
  - `processCapture(store: CaptureStore, extract: Extract, captureId: string): Promise<Extraction>`
  - New `CaptureStore` methods:
    - `extractionSettings(): Promise<{ enabled: boolean; minConfidencePct: number }>`
    - `loadCapture(id): Promise<{ id; personId; status; relationship; url; title; text; note; screenshotPath: string | null } | null>`
    - `downloadScreenshot(path): Promise<Uint8Array>`
    - `factKeys(personId): Promise<Set<string>>` (active **and** removed facts)
    - `insertFacts(personId, captureId, facts: CandidateFact[]): Promise<SavedFact[]>` (`source = 'capture'`, `source_id = captureId`, `confirmed = false`)
    - `setCaptureStatus(id, status)`
  - Refactor: `captureStoreFor(supabase: SupabaseClient<Database>, userId: string): CaptureStore`. `createSupabaseCaptureStore(token)` uses it, and a new `createCookieCaptureStore()` (cookie session, for server actions) does too.

- [ ] **Step 1: Failing tests, `selectFacts`.**
  - Confidence 0.4 dropped and 0.8 kept at 60 (AC-4); exactly 0.6 kept.
  - A sensitive value is dropped and counted in `blocked`.
  - A candidate whose `factKey` is in `existingKeys` is dropped (covers removed facts, AC-10).
  - Two candidates with the same key in one output: keep one.
- [ ] **Step 2: Failing tests, `processCapture`,** against an in-memory `CaptureStore` (the pattern `saveCapture`'s tests use):
  - Learnable output: `insertFacts` is called with the kept facts, status becomes `extracted`, and it returns those facts.
  - Empty output: status `extracted`, `facts: []` (AC-6).
  - `extract` throws: status `failed`, `insertFacts` not called (AC-7).
  - `enabled: false`: `extract` not called, status stays `pending`, returns `pending` (AC-12).
  - A `failed` capture is processed again; an `extracted` one returns its status without calling `extract` (AC-8, Review focus 2).
  - Unknown id → `null` from `loadCapture` → throws `CaptureNotFound` (the route maps it to 404).
  - Text only, no screenshot: `downloadScreenshot` isn't called and `extract` gets `screenshot: null` (Review focus 4).
  - `extract` receives `relationshipLabel(relationship)`, not a name.
  - `logEvent` is called with `capture.extracted` and `{ capture_id, person_id, facts, blocked, ms }`, or `capture.extract_failed` with `{ capture_id, person_id }`. Spy on stdout and assert no `value` or `text` field appears.
- [ ] **Step 3: Run `pnpm --filter @gifts-af/web test capture-extract log`.** Expected: FAIL.
- [ ] **Step 4: Implement** `extract.ts`, `log.ts`, the store methods and the refactor, and export `processCapture`, `createCookieCaptureStore`, `Extraction`, `SavedFact` from `index.ts`. `relationship` comes from `public.people`, through RLS, in `loadCapture`.
- [ ] **Step 5: Run again,** plus the existing `saveCapture` tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(concierge): read captures into AI-suggested profile facts (ALL-25)`.

### Task 5: Capture routes return the extraction; retry route (AC-5, AC-7, AC-8, AC-11)

**Files:**
- Modify: `apps/web/app/api/captures/route.ts`, `apps/web/app/api/captures/__tests__/route.test.ts`
- Create: `apps/web/app/api/captures/[id]/extract/route.ts`, `.../[id]/extract/__tests__/route.test.ts`
- Modify: `apps/web/proxy.ts` (if it lists `/api/captures` explicitly, let `/api/captures/*/extract` through signed out; the bearer token is checked)

**Interfaces:**
- Consumes: `processCapture`, `createSupabaseCaptureStore` (Task 4); `createExtractor`, `AI_MODELS` (Task 3).
- Produces (the extension's contract, additive):
  - `POST /api/captures` → `201 { id, extraction: { status, facts: [{ id, category, value }] } }`
  - `POST /api/captures/:id/extract` → `200 { extraction }`; `401`; `404` for an unknown or someone else's capture.
  - Both use the same CORS rule as today (extract the existing `respond` and `json` helpers into `apps/web/app/api/captures/http.ts`, now used by both routes).

- [ ] **Step 1: Failing route tests.**
  - The existing happy path now also returns `extraction` from a stubbed `processCapture`.
  - `processCapture` rejects → still `201` with `extraction.status = "failed"` (Review focus 5).
  - Retry: no bearer → 401; `CaptureNotFound` → 404; success → 200 with `extraction`; OPTIONS → 204 with the CORS headers.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The route builds `createExtractor(gateway(AI_MODELS.extraction))` (the AI SDK default gateway provider) and exports `maxDuration = 60`.
- [ ] **Step 4: Run** the route tests and `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): captures return what was learned, plus a retry route (ALL-25)`.

### Task 6: "What we know" on the person page (AC-9, AC-10, AC-8 web)

**Files:**
- Create: `apps/web/modules/concierge/capture/facts.ts`, `apps/web/app/people/[id]/what-we-know.tsx`
- Modify: `apps/web/modules/concierge/index.ts`, `apps/web/app/people/actions.ts`, `apps/web/app/people/[id]/person-view.tsx` (between the list line and Edit, where the comment leaves room)
- Test: `apps/web/e2e/what-we-know.spec.ts`, `apps/web/app/people/__tests__/what-we-know.test.tsx`

**Interfaces:**
- Produces:
  - `getWhatWeKnow(personId): Promise<{ told: SavedFact[]; ai: (SavedFact & { sourceTitle: string | null; sourceUrl: string | null })[]; unread: number }>`. `told` is active facts with any source except `capture`. `ai` is active `capture` facts joined to their capture. `unread` counts the person's `pending` and `failed` captures.
  - `removeFact(factId): Promise<{ ok: true } | { ok: false; error: string }>` sets `active = false` through RLS.
  - Actions: `removeFactAction(factId)`, `readCapturesAction(personId)`. The second runs `processCapture` for each unread capture in turn, with `createCookieCaptureStore()` and the same extractor, then calls `revalidatePath`.

- [ ] **Step 1: Failing component test:**
  - AI facts render under "✨ AI suggestions from your captures" with their `factLine` and a source link.
  - "What you've told us" is hidden when `told` is empty.
  - The empty state copy uses the person's name.
  - "1 capture hasn't been read. Read it now" when `unread` is 1, and the plural wording for 2.
- [ ] **Step 2: Failing Playwright test** against local Supabase. Seed as the test user: a person, a capture, two `capture` facts, one `failed` capture. Then:
  - The page shows both facts in the AI group.
  - Remove one, reload: it's gone, and the database row has `active = false` (AC-10).
  - "1 capture hasn't been read" shows.
  - Run at phone and desktop width (existing `phone-layout` helper).
- [ ] **Step 3: Run** `pnpm --filter @gifts-af/web test what-we-know` and `pnpm --filter @gifts-af/web e2e what-we-know`. Expected: FAIL.
- [ ] **Step 4: Implement** the query, the actions and the component, using the existing UI kit (`Button`, the muted text styles used in `person-view.tsx`).
- [ ] **Step 5: Run again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(people): what we know, with AI suggestions you can remove (ALL-25)`.

### Task 7: Extension popup: "Here's what I learned" (AC-5, AC-6, AC-7, AC-8, AC-12) [P after Task 5's contract]

**Files:**
- Modify: `apps/extension/src/lib/upload.ts`, `apps/extension/src/lib/__tests__/upload.test.ts`, `apps/extension/src/popup/App.tsx`, `apps/extension/src/popup/__tests__/App.test.tsx`
- Create: `apps/extension/src/popup/Learned.tsx`

**Interfaces:**
- Consumes: the Task 5 contract; `factLine` (core).
- Produces:
  - `UploadResult` success becomes `{ ok: true; id: string; extraction: Extraction | null }`. It's `null` when an older server leaves it out.
  - `retryExtraction(token, captureId): Promise<{ ok: true; extraction: Extraction } | { ok: false; status: number; error: string }>`

- [ ] **Step 1: Failing tests.**
  - `upload.test.ts`: `extraction` is parsed, and a missing or garbled `extraction` gives `null`.
  - `retryExtraction` posts to `/api/captures/{id}/extract` with the bearer token.
  - `App.test.tsx`:
    - While uploading, "Reading the page…" shows.
    - With facts, "Here's what I learned about Dad" and the `factLine` items show, including "Already has: …".
    - With no facts, the nothing-confident copy shows.
    - `failed` shows "Couldn't read this page. The capture is saved." with Try again; Try again calls `retryExtraction` (not `uploadCapture`) and then shows the facts.
    - `pending` shows "Saved. We'll learn from it later."
    - `null` falls back to today's "Saved to Dad" message.
    - The link points to `{appOrigin}/people/{personId}` with `target="_blank"`.
- [ ] **Step 2: Run `pnpm --filter @gifts-af/extension test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `Learned.tsx` renders the result states, and `App.tsx` keeps `{ captureId, personId, name, extraction }` in place of `savedTo`.
- [ ] **Step 4: Run again** and `pnpm --filter @gifts-af/extension build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(extension): show what was learned after a capture (ALL-25)`.

### Task 8: Fixture check `pnpm ai:eval` (AC-1)

**Files:**
- Create: `apps/web/lib/ai/fixtures/expected.json`, `apps/web/scripts/ai-eval.ts`
- Modify: `apps/web/package.json` (`"ai:eval": "tsx scripts/ai-eval.ts"`), root `package.json` (`"ai:eval": "pnpm --filter @gifts-af/web ai:eval"`), `README.md` (commands table row)
- Test: `apps/web/lib/ai/__tests__/expected.test.ts`

**Interfaces:**
- Produces: `expected.json`, `{ [fixtureId]: { mustFind: [{ category, keywords: string[] }], mustNotFind: string[] } }`, with 2–4 `mustFind` per fixture (the facts Opus and Sonnet both found in the spike) and `mustNotFind` holding the trap words for the four sensitive fixtures. `matchesExpected(facts, expected): { missing; forbidden }` lives in `apps/web/lib/ai/eval.ts`.

- [ ] **Step 1: Failing test:** `matchesExpected` on the **recorded** Sonnet outputs, after `isSensitive`, gives no `forbidden` and no `missing`. That makes the recorded run the offline baseline that CI checks.
- [ ] **Step 2: Run.** Expected: FAIL (no module and no `expected.json`).
- [ ] **Step 3: Write `expected.json` and `eval.ts`.** Write `ai-eval.ts`:
  1. It reads `AI_GATEWAY_API_KEY` (a script, so allowed), with `dotenv` from `apps/web/.env.development.local`, and fails clearly when it's missing.
  2. It runs `createExtractor` on every text fixture, plus every screenshot in `manifest.json` that exists on disk (the two real-page shots come from `spikes/ai/screens.mjs` locally).
  3. It applies `isSensitive` and the 60% cut, prints a table (fixture, found, missing, forbidden, cost and time if reported), and exits 1 on any missing or forbidden.
- [ ] **Step 4: Run the test** (passes) and **then `pnpm ai:eval` once** (real model, ~10¢). On a miss, adjust the prompt in Task 3's file, re-run both, and keep the output for the ticket.
- [ ] **Step 5: Commit** `test(ai): fixture check for capture extraction (ALL-25)`.

### Task 9: Docs, verification, PR

- [ ] Docs, pushed straight to `main` before the code PR, per CLAUDE.md:
  - `planning/decisions.md` D47 (no confirm step; revises C-3; Jim's reason).
  - `planning/PRD.md` C-3: "…shows 'Here's what I learned'; facts are saved as AI suggestions the user can remove".
  - `design/technical-design.md` §6.2 steps 3–5 (wait in the request, categories, no confirm) and §3.1 (`confirmed = false` for AI facts).
  - `design/decisions.md` T48 (extraction runs in the request; additive response; `wants` and `constraint`; sensitive term list in code; relationship, not name).
  - `README.md` docs table row for this plan.
  - This plan's Principles check stays as written.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:test` and the e2e suite. All pass.
- [ ] Load the unpacked extension against `pnpm dev`, capture the `dad-post-mock.png` page (or a real Instagram post), and screenshot the popup states and the person page at phone and desktop widths, in light and dark.
- [ ] Use superpowers:requesting-code-review, then open the PR. Title: `feat: capture extraction and "Here's what I learned" (ALL-25)`. Body: `Part of ALL-25`, because the production check of OIDC to the gateway (design §7 **[Verify]**) happens after the merge. Include how we'll see it working on production (`capture.extracted` events in Vercel logs) and how to turn it off (`capture_extraction_enabled` = 0).
- [ ] Post the evidence on ALL-25 (T44): tests added and failing first, suite counts, the `pnpm ai:eval` table, screenshots, and the CI result. After the deploy, capture once on giftsaf.com and confirm the facts and the `capture.extracted` event. Then move the ticket to Done.

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task and a test:
  - AC-1 → Task 8
  - AC-2 → Task 3
  - AC-3 → Task 4 (`selectFacts` and `processCapture`), Task 8 (forbidden)
  - AC-4 → Task 4
  - AC-5 → Tasks 5 and 7
  - AC-6 → Tasks 4 and 7
  - AC-7 → Tasks 4, 5 and 7
  - AC-8 → Tasks 4, 5, 6 and 7
  - AC-9 → Task 6
  - AC-10 → Tasks 4 and 6
  - AC-11 → Task 1 (RLS) and Task 5 (404)
  - AC-12 → Tasks 4 and 7
  - AC-13 → Tasks 3 and 4
- [x] Every task traces back to a story or criterion. Task 2 serves stories 1 and 3 (shared labels), and the `log.ts` helper is required by E6.
- [x] No open questions are left. One fact to check while building: the gateway model ID and the AI SDK's effort option (`GET /v1/models`, AI SDK docs).

## Done: evidence on the ticket (T44)

- [ ] Test evidence posted on ALL-25: tests added (and that they failed first), suite counts, `pnpm ai:eval` table, CI result.
- [ ] Screenshots of the popup states and the person page, at phone and desktop widths, light and dark.
- [ ] Live check after deploy: one capture on giftsaf.com, facts shown, `capture.extracted` event seen, or listed as **Still open**.
