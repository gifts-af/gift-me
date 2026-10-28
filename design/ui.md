# Look and feel (W1-7, ALL-41)

**Status:** signed off 2026-10-28, with no further comments (ALL-41 done). Built into the app in ALL-20 (tokens, sign-in, Home, the list app and the shared list). Revised on 2026-10-26 after the owner's review (product decisions 36–40).

**The answer:** one calm, clean look ("A") for the whole platform. It uses a white background, near-black text, thin grey borders and **one deep-teal accent** for the action that matters on each screen. Every screen shows only what that moment needs. The look lives in one set of tokens (CSS variables read by Tailwind and shadcn/ui), so the list app, sign-in and the concierge all match, and changing a colour is a one-line edit.

This doc is the source every screen ticket builds from (ALL-20 onward). The PRD says *what* goes on each screen; this doc says how it looks and where it sits.

## Why

- **First impressions drive adoption.** A new user should understand each screen at a glance and never face a wall of options. Advanced and premium features come later and stay out of sight until then.
- **The prototype proved the approach.** The GiftsAF list page already shows nothing it doesn't need to. Its *behaviour* carries over in full; its colours and styling were dressing and are replaced.
- **Two looks today.** The list app uses its own stylesheet (`modules/lists/components/gifts.css`, indigo accent), while the top bar and sign-in pages use stock shadcn/ui in black and white. This doc replaces both with one.

## Goals, non-goals and anti-goals

| | |
|---|---|
| **Goals** | One look across the platform. Phone-first. Calm enough to trust with money. Easy to restyle later. |
| **Non-goals** | A logo or brand identity (waits for the name, ALL-14). Advanced or premium screens. A native phone app. Restyling the real app (that's ALL-20). |
| **Anti-goals** | A cluttered first screen. More than one competing button. Decoration that slows the page or pulls the eye away from the main action. Losing any working list-app feature in the move. |

## Principles for every screen

1. **One job, one main button.** Each screen has a single primary action, in teal. Everything else is a quieter secondary button or a text link.
2. **Show only what this moment needs.** Details, settings and rarely used actions go behind a "More" menu, a detail screen or a bottom sheet. Nothing is shown "just in case".
3. **Teal means "act here" or "selected".** It isn't used for decoration, headings or illustrations.
4. **Plain words.** Short labels that say what happens ("Send 1 gift · $42", not "Submit"). Numbers the user cares about (price, date, budget) are always visible on the screen where they decide.
5. **Thumb-friendly.** Tap targets are at least 44 × 44 px. On a phone, the main button sits at the bottom of the screen, within thumb reach.
6. **Accessible by default.** Text meets WCAG AA contrast (4.5:1) in light and dark. Every control works with a keyboard and shows a teal focus outline. Screen-reader labels and live announcements carry over from the list app.

## Style guide

### Colours

Light is the default for the mock-ups; the app follows the phone's light or dark setting, with a manual switch in the account menu (ALL-20). Values are given as hex and as the HSL triples shadcn's CSS variables use.

| Token | Use | Light | Dark |
|---|---|---|---|
| `--background` | Page | `#ffffff` · `0 0% 100%` | `#09090b` · `240 10% 4%` |
| `--foreground` | Main text | `#18181b` · `240 6% 10%` | `#fafafa` · `0 0% 98%` |
| `--card` | Cards, sheets | `#ffffff` · `0 0% 100%` | `#18181b` · `240 6% 10%` |
| `--muted` | Image placeholders, quiet fills | `#f4f4f5` · `240 5% 96%` | `#27272a` · `240 4% 16%` |
| `--muted-foreground` | Secondary text | `#71717a` · `240 4% 46%` | `#a1a1aa` · `240 5% 65%` |
| `--border`, `--input` | Borders, input outlines | `#e4e4e7` · `240 6% 90%` | `#27272a` · `240 4% 16%` |
| `--primary` | Main button, selection, focus ring (`--ring`) | `#0f766e` · `175 77% 26%` | `#2dd4bf` · `172 66% 50%` |
| `--primary-foreground` | Text on the main button | `#ffffff` · `0 0% 100%` | `#042f2e` · `179 84% 10%` |
| `--accent` | Soft teal fill (status labels, selected rows) | `#f0fdfa` · `166 76% 97%` | `#042f2e` · `179 84% 10%` |
| `--accent-foreground` | Text on the soft teal fill | `#0f766e` · `175 77% 26%` | `#5eead4` · `171 77% 64%` |
| `--secondary` | Secondary button fill | `#f4f4f5` · `240 5% 96%` | `#27272a` · `240 4% 16%` |
| `--destructive` | Errors, delete | `#b91c1c` · `0 74% 42%` | `#f87171` · `0 91% 71%` |
| `--success` (new) | Saved, delivered | `#15803d` · `142 72% 29%` | `#4ade80` · `142 69% 58%` |
| `--warning` (new) | Needs attention, over budget | `#b45309` · `26 90% 37%` | `#fbbf24` · `43 96% 56%` |

- Status colours are used for small text and icons only, never as large fills, so they don't compete with teal.
- `--success` and `--warning` aren't in stock shadcn. ALL-20 adds them to `globals.css` and `tailwind.config.ts` with the others.
- The `--chart-*` variables are left as they are until a screen needs a chart.
- **Contrast, measured in code** (`apps/web/test/tokens.test.ts` checks every pair below, in both themes, on each test run):

| Text on fill | Light | Dark |
|---|---|---|
| `--foreground` on `--background` | 17.7 | 19.0 |
| `--muted-foreground` on `--background` | 4.9 | 7.8 |
| `--foreground` on `--muted` | 16.2 | 14.2 |
| `--muted-foreground` on `--muted` | 4.4 | 5.8 |
| `--primary-foreground` on `--primary` | 5.5 | 7.7 |
| `--primary` on `--background` | 5.5 | 10.6 |
| `--accent-foreground` on `--accent` | 5.3 | 9.8 |
| `--destructive` on `--background` | 6.4 | 7.2 |
| `--success` on `--background` | 5.1 | 11.4 |
| `--warning` on `--background` | 5.0 | 11.8 |
| `--success` on `--success-soft` | 4.9 | 8.5 |
| `--warning` on `--warning-soft` | 4.9 | 9.8 |

- **Grey text never sits on the grey fill.** `--muted-foreground` on `--muted` is 4.4:1 in light, just under AA, so text on `--muted` (banners, image placeholders) uses `--foreground`. Icons there may stay grey (3:1 is enough for icons).

### Type

- **Font:** the device's system font (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). It looks native, loads instantly and matches the prototype. Geist (used by the sign-in pages today) is dropped.
- **Sizes** (phone; the same on a computer):

| Role | Size / weight | Example |
|---|---|---|
| Screen title | 22 px / 700 | "Mom's birthday" |
| Section heading | 17 px / 600 | "Ideas" |
| Body, inputs | 16 px / 400 | 16 px keeps iPhone from zooming into inputs |
| Card title, price | 15 px / 600 | "Le Creuset mug set", "$42" |
| Secondary and meta | 13 px / 400, muted | "She mentioned her mug chipped" |
| Labels and pills | 12 px / 600 | "Pick by Mar 5" |

- Prices and dates use tabular figures (`font-variant-numeric: tabular-nums`) so columns line up.

### Shape and spacing

- **Corner rounding:** `--radius: 0.75rem` (12 px) for cards, buttons, inputs and sheets; 8 px for images and small controls; fully round for pills.
- **Borders over shadows:** a 1 px `--border` line. Cards get no shadow; only floating layers (menus, sheets, dialogs) get a soft one.
- **Selected state:** a teal border with a 1 px teal ring, plus a filled teal check.
- **Spacing:** Tailwind's 4 px scale. 16 px page margins on a phone, 12 px between cards, 24 px between sections.
- **Icons:** lucide (already installed), 20 px, in the text colour. Icons go next to a label, never alone, except standard ones (back, close, more).

## Phone and computer

One responsive website, designed phone-first and installable to the home screen (ALL-20). No separate app.

| | Phone (under 640 px) | Computer (640 px and up) |
|---|---|---|
| Layout | One column | Content in a centred column, at most 640 px wide |
| Main button | Fixed to the bottom, full width | Inline, under the content |
| Top bar | Back arrow or name, plus an account menu | The same, with room for a few links that sit in the menu on a phone |
| Grids | One card per row | **Only home and the gift list** widen (up to 1024 px): 2 cards per row from 768 px, 3 from 1024 px |

- **Approving** happens mostly on a phone, from the approval email, so the approval screen is designed for the phone first.
- **Capturing** happens on a computer, in the Chrome extension's popup (about 360 px wide). It uses the same tokens.

## How the products connect

The gift list and the concierge each **work on their own**, and are linked lightly so together they're better than either alone (owner, 2026-10-26; T19).

- **Home** (`/`) is the one front door after sign-in. It shows a **"My list"** card at the top, then **"People"** (the concierge) below it.
- **Each product stands alone.** Someone who only uses lists never has to set up the concierge: "People" shows a quiet one-line "Add someone you buy for" empty state, not a setup wizard. Someone who only uses the concierge sees "My list" as one small "Start your wish list" card.
- **Links between them are low-key** and appear only where they help, never as prompts or pop-ups. For example, a person's profile can later show their own shared list when they've linked their account (T19's `people.linked_user_id`). These come with the screens that need them, not in the MVP mock-ups.
- **Products keep their own paths** (`/lists`, `/concierge`, design §2.2). Share links (`/share/…`) work signed out and don't show Home.
- A list-only user who signs in later lands on Home and sees their list there.

## UI kit

- **Tailwind CSS plus shadcn/ui** (T15), in shadcn's "new-york" style, with the tokens above in `apps/web/app/globals.css`. Already installed: button, card, input, label, checkbox, badge, dropdown-menu.
- **Expected additions** **[Claude's call]**: `sheet` (bottom sheets for "reject with a reason" and "More"), `dialog` (claim a gift), `textarea`, `skeleton` (loading states) and `sonner` (short "Saved" messages). Each is added by the ticket that first needs it, not up front.
- **The extension** (ALL-22) uses the same Tailwind setup and copies the token block, so it matches the app.
- **Email** (ALL-23) can't use the app's CSS. Approval emails are plain: at most 600 px wide, system font, white background, one teal button per email, and inline styles.

## Mock-ups

A clickable, phone-first prototype, published as a private shareable artifact page that the owner and Jim can each open on their phones and comment on. **Link:** [GiftMe mock-ups](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW) (private; shared with Jim from the page's Share menu). **Source:** [`design/mockups/ALL-41.html`](mockups/ALL-41.html); republish it to the same link after changes.

**Reviewing:** the owner and Jim share one claude.ai login, so the built-in comments can't tell them apart. The page therefore has its own feedback: on each screen, a comment box with a name picker (Aaron or Jim), and a per-person **"I approve this screen"** button. Comments and approvals are stored in the artifact's shared database, so both people see each other's, and Claude can read them to make changes. Sign-off is complete when both have approved every screen.

| Screen | Shows | PRD |
|---|---|---|
| Home | The people you buy for, each with their next occasion and status. Someone who keeps their own list (Mom) is marked "Her own list" and is the ideal case; someone without one (Dad) is marked "we suggest ideas". An empty state for a new user | P-1, P-3, decision 37 |
| Person profile | What the app knows about them (facts, sizes, likes), with edit and delete, one readiness line, whether they keep a list, and your optional budget per occasion as its own section | C-6, C-7, decision 36 |
| "Here's what I learned" | The facts pulled from a capture, each to keep or drop | C-3 |
| Pick from their list (Mom) | Gifts from the person's own list, with when each was added and arrive-by date; one already claimed by someone else; pick one or several. **Your budget** is a separate, optional field: only when it's filled in do over-budget labels and the confirm step appear | A-1, B-4, decisions 36, 37 |
| Suggested ideas (Dad) | Generated ideas with the reason each fits, the same optional budget, and "None of these" with a reason | A-1, B-4, G-3, decision 36 |
| Where it goes | Ship to the recipient, to you (your saved address), or to another address. For someone with a list, their shared address is one tap (city shown); for someone without one, you add theirs once and can save it | P-5, A-3, decision 38 |
| Price went up **[Claude's call]** | Re-approve at the new total, or pick the next-best idea (D29) | A-4 |
| Gift list | The list app in the new look: add by link or by hand, save, share | Existing (GiftsAF) |
| Shared list and claim | A friend opening a share link and claiming a gift; a claim that lost the race. The list's owner never sees claims | Existing (GiftsAF), decision 39 |
| Sign-in | Google sign-in (email and password stays for existing list users) | ALL-20 |
| Extension popup | "Capture for…" with a person picker | C-1 |
| Heads-up email | Two kinds. **Reminder:** the options as small read-only rows and "Choose a gift"; nothing is bought until you choose. **Auto-buy on** (opt-in, A-7): says which gift will be bought and on what date, marks it, and offers "Review or change" and how to skip. Buttons are signed one-time links (design §6.4) to the phone page | N-1, A-7, decision 40 |
| Computer width | Home and the gift list only | — |

Not mocked up now: the reaction prompt (ALL-34) and other later screens. They reuse these patterns and get mock-ups in their own tickets if needed **[Claude's call]**.

**Sign-off** (ticket "done when"):

| Who | Signed off |
|---|---|
| Owner and Jim | ☑ 2026-10-28, in a Claude Code session ("no comments at this time"). The page's per-screen approve buttons weren't used. |

Each screen ticket links to the screens it builds. To open one screen directly, add `#<screen>` to the link:

| Ticket | Screens |
|---|---|
| ALL-20 app shell, sign-in, list restyle | `signin`, `home`, `home-wide`, `list`, `list-wide`, `shared` |
| ALL-21 people, occasions, budgets | `home`, `person` |
| ALL-22 Chrome extension | `extension` |
| ALL-23 notifications | `email` |
| ALL-25 capture extraction | `learned` |
| ALL-26 profile, readiness | `person` |
| ALL-29 approval | `approval`, `ideas` |
| ALL-30 purchase and shipping | `ship-to`, `needs-attention` |
| ALL-33 failure and replacement | `needs-attention` |

## Moving the list app to the new look (in ALL-20)

The prototype's colours and stylesheet go; **none of its behaviour does.** When ALL-20 restyles it, all of the following must keep working, and the existing tests (`modules/lists/components/__tests__/`) must still pass:

- Adding a gift by Amazon link (with lookup status and image) or by hand, with price checking
- Removing a gift, and focus moving somewhere sensible after
- Saving, the "unsaved changes" warning on leaving, and the save error messages
- A guest's list carried over through sign-in or sign-up (kept for 24 hours)
- Copying a share link, with a copy-by-hand fallback when the clipboard is blocked
- The shared list page: a signed-out friend can view and claim; the owner sees "this is your list" and can't claim; a second claim on the same gift is refused
- Dark mode, keyboard focus, and screen-reader announcements

`gifts.css` was retired in ALL-20: every list screen moved to Tailwind classes at once, since the restyle touched them all. Each feature above has a test (`modules/lists/components/__tests__/`, and the owner-claims rule in `supabase/tests/lists.test.sql`).

## Open items

- **Name and logo:** the mock-ups use "GiftMe" as plain text until ALL-14 settles the name.
