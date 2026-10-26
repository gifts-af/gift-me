# ALL-41: Look and feel mock-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a clickable, phone-first mock-up of the screens in `design/ui.md` > Mock-ups, published as one shareable artifact page where the owner and Jim each leave comments and approve each screen.

**Architecture:** one self-contained HTML file, `design/mockups/ALL-41.html`, versioned in the repo and published with the Artifact tool. Plain HTML, CSS and a little vanilla JS: no build step and no libraries. Screens are `<section data-screen="…">` blocks; a screen picker and in-screen links switch between them. A feedback panel under each screen stores comments and approvals in the artifact's `db`, so both reviewers see them and Claude can read them.

**Tech stack:** HTML, CSS custom properties, vanilla JS, the artifact runtime's `db` capability (contract 0.2.91).

**Spec:** `design/ui.md` (approved 2026-10-26), decisions T28 and T29. Screen content comes from `planning/PRD.md` (IDs in the ui.md table) and `design/technical-design.md` §4.2 (budgets) and §5 (round statuses).

**Testing:** this is a design mock-up, not product code, so there are no unit tests **[Claude's call]**. Each task ends with a visual check: publish (or re-publish) and look at the page at phone width (375 px) and computer width (1280 px), in light and dark. Task 5 adds one functional check of the database.

## Global constraints

- Tokens are exactly the `design/ui.md` > Colours table, written as `:root` CSS variables with the same names (`--background`, `--primary`, …, `--success`, `--warning`), hex values, and a dark set under `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`.
- Font `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Sizes 22/17/16/15/13/12 px per the Type table. Prices and dates use `tabular-nums`.
- `--radius: 0.75rem` for cards, buttons, inputs and sheets; 8 px for images; pills fully round. 1 px `--border` lines; no shadow on cards.
- One teal primary button per screen. Teal is used only for the main action, selection, focus and soft status pills.
- Tap targets are at least 44 × 44 px; a visible teal focus outline on every control.
- Product name shows as plain text "GiftMe", with no logo.
- Example data is made up (Mom, Dad, Sam; mugs, a garden kneeler). No real people, products with real prices, or real users' data.
- Images are flat `--muted` boxes with a lucide-style inline SVG icon; no external images.
- No external scripts or fonts. Phone width has a 16 px side margin and never scrolls sideways.

## Review focus

1. **No database** (opened outside claude.ai, or `claude.use("db")` resolves `null`): every screen still renders and clicks through; the feedback panel shows "Comments are available when opened in Claude" instead of breaking. Task 5 checks this.
2. **Dark mode:** every screen is readable in dark, including pills, status text and the selected-card ring. Checked in each task's visual step.
3. **Narrow phone (320 px) and long names** ("Grandma Margaret-Ann's 80th birthday"): text wraps; nothing overflows or scrolls sideways. Check at 320 px in Task 2.
4. **Both reviewers at once:** two comments posted at the same moment both appear; an approval by one doesn't overwrite the other's. Task 5 stores one document per comment and one per (screen, person).
5. **Over-budget pick** shows the second confirmation with the over-budget amount, and **several picks** show the summed total on the main button ("Send 2 gifts · $77"). Task 2 includes both states.

---

### Task 1: Page shell, tokens and screen switching

**Files:**
- Create: `design/mockups/ALL-41.html`

**Interfaces:**
- Produces: the shell later tasks add to.
  - `<section class="screen" data-screen="<id>" data-title="<label>" data-width="phone|wide">` for each screen.
  - The `.phone` frame (375 px wide, rounded, bordered) for phone screens; `.wide` (1024 px max, scaling down) for computer-width ones.
  - `show(id)`: shows one screen, updates the URL hash (`#approval`), and fires `screenchange` on `document`.
  - Any element with `data-go="<id>"` calls `show(id)` on click.
  - Shared CSS classes: `.btn-primary`, `.btn-secondary`, `.btn-link`, `.card`, `.card.selected`, `.pill`, `.pill-warn`, `.muted`, `.sheet` (bottom sheet, toggled by `[data-open]`), `.topbar`, `.img` (image placeholder).

- [ ] **Step 1:** Load the `artifact-design` skill and follow its page contract (title "GiftMe mock-ups", theme tokens, dark mode, phone gutter).
- [ ] **Step 2:** Write the shell:
  - a header with the title and a one-line explanation ("Tap through the screens. Leave comments and approve each one below it.");
  - a screen picker grouped as Concierge / Gift lists / Elsewhere;
  - a light/dark/system switch for reviewers (kept in `localStorage` inside try/catch);
  - the tokens and shared classes;
  - one placeholder screen.
- [ ] **Step 3:** Publish with `Artifact` (`icon: "gift"`, description "Clickable phone-first mock-ups for ALL-41, with comments and sign-off"). Check that the hash deep-link (`…#approval`) opens that screen.
- [ ] **Step 4:** Commit: `git add design/mockups/ALL-41.html && git commit -m "docs: mock-up shell and tokens (ALL-41)"`

### Task 2: Concierge screens

**Files:** Modify `design/mockups/ALL-41.html`

**Interfaces:** Consumes Task 1's shell, `show`, `data-go` and classes. Produces screens `home`, `person`, `learned`, `approval`, `needs-address`, `needs-attention`.

- [ ] **Step 1: `home`.**
  - Top bar: "GiftMe" and an account-menu icon.
  - A "My list" card (3 gifts · shared), which goes to `list`.
  - "People": Mom (birthday Mar 14, pill "Pick a gift", teal), Dad (Father's Day, pill "Ideas coming Jun 1", muted), Sam (pill "Ordered · arrives Dec 20", success).
  - Mom goes to `approval`; Dad goes to `person`.
  - A collapsed "Add someone you buy for" row at the end.
- [ ] **Step 2: `person`.**
  - Name, relationship and next occasion.
  - One readiness line ("Good to go · answer 1 question to sharpen ideas").
  - What we know, as grouped rows (Likes, Sizes, Avoid), each with an edit affordance.
  - "Add a note" as the single primary button.
  - "Delete Dad" as a muted link at the very bottom.
- [ ] **Step 3: `learned`.**
  - Title "Here's what I learned", with the source line ("From a page you saved: Instagram post").
  - 3–4 facts, each with keep (default) and drop toggles.
  - Primary button "Save 3 facts". The count updates as facts are dropped.
- [ ] **Step 4: `approval`.**
  - Header: "Mom's birthday · Sat, Mar 14 · Budget $60", with pill "Pick by Mar 5".
  - Ideas: mug set $42, garden kneeler $35, audiobook credits $45, each showing "Arrives by Mar 10".
  - One over-budget idea at $68, labelled with pill-warn "$8 over budget".
  - Tapping a card toggles `.selected`. The primary button shows the count and summed total ("Send 2 gifts · $77"), and is disabled with "Pick a gift" when nothing is selected.
  - Picking the over-budget idea opens a confirmation sheet ("This is $8 over your $60 budget. Send anyway?") before it's selected.
  - A "None of these" link opens a reject sheet with quick reasons ("She has one", "Not her style", "Too pricey") plus a text box, and "Find new ideas".
- [ ] **Step 5: `needs-address` and `needs-attention`.**
  - **needs-address:** the same header, the line "We need Mom's address to find ideas that arrive in time", an address form, and primary "Save address".
  - **needs-attention:** "The mug set is now $49 (you approved $42)", with primary "Send at $49" and secondary "Pick the next idea: garden kneeler · $35".
- [ ] **Step 6:** Re-publish. Check each screen at 375 and 320 px in light and dark, then at 1280 px. At 320 px, check that a long person name wraps (Review focus 3). Check the summed total and the over-budget sheet (Review focus 5).
- [ ] **Step 7:** Commit `docs: concierge mock-up screens (ALL-41)`.

### Task 3: Gift list screens and sign-in

**Files:** Modify `design/mockups/ALL-41.html`

**Interfaces:** Consumes Task 1. Produces screens `list`, `shared`, `signin`. Must show every list-app feature named in `design/ui.md` > Moving the list app, in the new look.

- [ ] **Step 1: `list`.**
  - Title "My list", with a "Share" secondary button in the top bar.
  - An add row: "Paste an Amazon link" input plus "Add". The lookup shows a found item (image box, name, price) with "Add to list". A "Add by hand" link reveals name and price fields, including an invalid-price error example.
  - The gift cards grid, with remove (×) on each.
  - An unsaved-changes bar fixed to the bottom ("Unsaved changes · Save", primary).
  - A guest banner variant ("Sign in to save your list"), toggled by a small "View as guest" switch on the review page.
- [ ] **Step 2: `shared`.**
  - A friend's view of "Sam's list": cards with "Claim".
  - One card shows "Claimed by Alex".
  - Claim opens a dialog with a name field and "Claim gift".
  - A variant banner for the owner opening their own link: "This is your list. Friends see a Claim button."
- [ ] **Step 3: `signin`.**
  - "GiftMe", a one-line purpose, and primary "Continue with Google".
  - Below a divider, email and password fields with "Sign in", plus "Forgot password?" and "Create an account" links.
- [ ] **Step 4:** Re-publish. Check each screen at 375 and 1280 px, in light and dark.
- [ ] **Step 5:** Commit `docs: gift list and sign-in mock-ups (ALL-41)`.

### Task 4: Extension popup, heads-up email and computer width

**Files:** Modify `design/mockups/ALL-41.html`

**Interfaces:** Consumes Task 1. Produces screens `extension`, `email`, `home-wide`, `list-wide`.

- [ ] **Step 1: `extension`.**
  - A 360 px popup frame headed "Capture for…".
  - A person picker (Mom selected; search field), an optional note field, and primary "Save to Mom".
  - A success state: "Saved. We'll show you what we learned."
- [ ] **Step 2: `email`.**
  - A frame that is 600 px max and plain white.
  - From "GiftMe", subject "3 gift ideas for Mom's birthday".
  - The 3 ideas as small read-only rows (image box, name, full cost, arrives-by date, reason).
  - One teal "Choose a gift" button, which goes to `approval` in the mock-up.
  - A footer line: "Do nothing and we'll remind you on Mar 1."
  - Styled the way inline email styles allow: no sheets, no hover.
- [ ] **Step 3: `home-wide` and `list-wide`.**
  - Home and the list at computer width: the content column, and the People and list cards in a grid with 2 columns from 768 px and 3 from 1024 px.
  - The top bar has room for "My list" and "People" links.
- [ ] **Step 4:** Re-publish and check at 1280 px and 375 px. At 375 px the wide frames scale down rather than scrolling sideways.
- [ ] **Step 5:** Commit `docs: extension, email and computer-width mock-ups (ALL-41)`.

### Task 5: Comments and sign-off

**Files:** Modify `design/mockups/ALL-41.html`

**Interfaces:**
- Consumes `screenchange` and the `data-screen` ids from Tasks 1–4.
- Produces these `db` collections (Claude reads them with `ArtifactData`):
  - `feedback`: one document per comment, `{screen: string, who: "aaron" | "jim", text: string, at: number}` (ms since epoch), created with `collection("feedback").add(...)`.
  - `approvals`: one document per screen and person, id `<screen>__<who>`, `{screen, who, approved: boolean, at}`, written with `doc(...).set(...)`.

- [ ] **Step 1: The feedback panel under the active screen.**
  - A "Commenting as" Aaron/Jim picker, remembered per browser in `localStorage`.
  - A text box and "Post".
  - This screen's comments, newest first, each with who and when.
  - "Owner ☐/☑ · Jim ☐/☑" with an "I approve this screen" toggle for the selected person.
  - Subscribe once to each collection with `onSnapshot` and filter by screen in render.
- [ ] **Step 2: A sign-off summary at the top of the page.**
  - "Approved by both: n of 13 screens", and a list of screens still waiting.
- [ ] **Step 3: Works without the database.**
  - If `await claude.use("db")` resolves `null`, the panel shows "Comments and sign-off work when this page is opened in Claude", and the screens still work (Review focus 1).
  - Write errors show inline under the box. A `quota_exceeded` error says to tell Claude.
- [ ] **Step 4: Publish with `capabilities: {db: {}, user: {}}`.**
  - Post one test comment and one approval through the page or `ArtifactData`.
  - Run one `ArtifactData` `list` of `feedback` and of `approvals` to confirm the shapes match above.
  - Delete the test documents.
- [ ] **Step 5:** Commit `docs: mock-up comments and sign-off (ALL-41)`.

### Task 6: Hand-off

**Files:**
- Modify `design/ui.md`: set the mock-up link and the source path `design/mockups/ALL-41.html`.
- Modify `README.md`: add the mockups folder to the `design/` row.

- [ ] **Step 1:** Fill in the link in `design/ui.md` > Mock-ups.
- [ ] **Step 2:** Push the docs to `main` (`docs: link the ALL-41 mock-ups`).
- [ ] **Step 3:** Comment on ALL-41 with the link and how to review: pick your name, comment, approve each screen.
- [ ] **Step 4:** Give the user the link.
- [ ] **Step 5:** After sign-off, which is a separate step:
  - Read `feedback` and make the changes.
  - Re-publish.
  - Tick the sign-off table in `ui.md`.
  - Link each screen from ALL-20, 21, 22, 23, 26 and 29.
  - Close ALL-41.
