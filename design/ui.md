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

Light is the default for the mock-ups; the app follows the phone's light or dark setting (light when there's no preference), with a manual switch in the account menu (ALL-20). Pages without an account menu (home, tour, sign-in, request access, shared lists, the list when signed out) show a sun/moon button in the top bar instead (`ThemeToggle`, ALL-74): some phones report dark without the person choosing it, such as battery saver or a dark schedule. A choice from either place is the same setting, remembered on that device. Values are given as hex and as the HSL triples shadcn's CSS variables use.

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

## Money notice (decision 53, ALL-94)

Every action that spends real money says so, right next to the action and always visible, with no hover or menu needed. It's a short line on `--warning-soft` with `--warning` text and `role="note"`, giving a rough cost from settings in plain words ("Each gift costs its price plus Zinc's $1 order fee"). It no longer starts "Alpha:": the owner doesn't want money notices to shout the testing stage (ALL-114, done in ALL-116). The wording lives in `packages/core/src/paid-features.ts`. People without paid features don't see the notice or the action. Where that would leave them wondering, a plain muted line says why. Hold emails state the cost the same way, as a plain line under the button.

## Tone in emails (owner, 2026-11-08, ALL-116)

Bad news is told with care. The email says sorry plainly ("We're sorry", "Sorry for the hold-up"), says what it means for the buyer, says what was or wasn't charged, and ends with "What happens next". Any good news, like another gift on its way, gets its own line. When it isn't our doing (nobody chose a gift), there's no apology, but it still says what happens next. When several things go wrong in one round at once, they go in one summary email with a row and a link for each, not one email each.

## Phone and computer

One responsive website, designed phone-first and installable to the home screen (ALL-20). No separate app.

| | Phone (under 640 px) | Computer (640 px and up) |
|---|---|---|
| Layout | One column | Content in a centred column, at most 640 px wide |
| Main button | Fixed to the bottom, full width | Inline, under the content |
| Top bar | Logo, Get, Give, account menu (fits 320 px, T58) | The same. Back links live in the page, not the bar |
| Grids | One card per row | **Only home and the gift list** widen (up to 1024 px): 2 cards per row from 768 px, 3 from 1024 px |

**Back links keep your place (ALL-131).** A back link ("‹ Mom", "‹ Settings") and a detail screen's Save open the page you came from as usual, fresh, then put the row you tapped back where it was on the screen and focus it, as the browser's Back does. They wait for that row if the page is still loading, and stop if you start scrolling. They don't go back in history, which can show the page as it was before you saved, so the phone's Back from the person's page still steps back through the detail screen. Reached any other way, say from an email link, they open the page at its top.

- **Approving** happens mostly on a phone, from the approval email, so the approval screen is designed for the phone first.
- **Capturing** happens on a computer, in the Chrome extension's popup (about 360 px wide). It uses the same tokens.

## How the products connect

The gift list and the concierge each **work on their own**, and are linked lightly so together they're better than either alone (owner, 2026-10-26; T19).

- **Get and Give** are the two sections, in the top bar on every signed-in page (T58). **Get** (`/lists`) is your list. **Give** (`/`) is where you land after sign-in: a **"You"** card first, then your **people** (the concierge).
- **Each product stands alone.** Someone who only uses lists never has to set up the concierge: "People" shows a quiet one-line "Add someone you buy for" empty state, not a setup wizard. Someone who only uses the concierge sees one small "You" card inviting them to start a wish list.
- **Links between them are low-key** and appear only where they help, never as prompts or pop-ups. For example, a person's profile can later show their own shared list when they've linked their account (T19's `people.linked_user_id`). These come with the screens that need them, not in the MVP mock-ups.
- **People cards** show an avatar (their photo, or their initials on a tinted circle), their name, the next occasion, and where ideas come from: "Their own list" when you've linked their shared list, otherwise "We suggest ideas". Without a birthday the card offers "Add birthday" (ALL-21, T41).
- **Products keep their own paths** (`/lists`, `/concierge`, design §2.2). Share links (`/share/…`) work signed out; signed-in viewers get Get and Give, signed-out visitors don't (T78).
- A list-only user who signs in later lands on Give, one press from their list on the "You" card or the Get tab.

## UI kit

- **Tailwind CSS plus shadcn/ui** (T15), in shadcn's "new-york" style, with the tokens above in `apps/web/app/globals.css`. Already installed: button, card, input, label, checkbox, badge, dropdown-menu.
- **Expected additions** **[Claude's call]**: `sheet` (bottom sheets for "reject with a reason" and "More"), `dialog` (claim a gift), `textarea`, `skeleton` (loading states) and `sonner` (short "Saved" messages). Each is added by the ticket that first needs it, not up front.
- **Buttons and links that look like buttons use `Button`** (`components/ui/button.tsx`): a link is `Button asChild`, and a dialog's opener is `DialogTrigger asChild` around a `Button`. Main size 48 px tall with 16 px text, small 44 px with 15 px, weight 600. The exceptions are the pictures of buttons in the home page and tour previews (`components/home/pick-preview.tsx`, `list-preview.tsx`, `concierge.tsx`), which can't be pressed.
- **Dropdowns use `NativeSelect`** (`components/ui/native-select.tsx`, ALL-109): the phone's own picker, styled to match `Input` with a chevron. iPhone Safari otherwise draws a plain `<select>` grey next to white text boxes.
- **Forms are cards:** each group of fields sits in the same bordered card, and a group that's all optional says "Optional" once in its heading (the person form, ALL-109).
- **The extension** (ALL-22) uses the same Tailwind setup and copies the token block, so it matches the app.
- **Email** (ALL-23) can't use the app's CSS. Approval emails are plain: at most 600 px wide, system font, white background, one teal button per email, and inline styles.

## Text that changes or is centred (ALL-32)

No short leftover wraps: a line that would spill one or two words onto the next line is rewritten or split into whole lines on purpose, especially when centred. Text that changes in place (a countdown, a balance) uses tabular figures and a fixed line break so it doesn't jump. Example: the Zinc connect status is two fixed lines, "Waiting for you to click Allow…" and "Code expires in 14 min" (`mockups/ALL-32-settings.html`).

Headings in the app and in emails use balanced wrapping (`text-wrap: balance`, Tailwind `text-balance`), and paragraphs avoid a lone last word (`text-wrap: pretty`, Tailwind `text-pretty`). The email shell (`apps/web/lib/email-layout.ts`) sets both as inline styles, so every email gets them; keep headings short too (owner, ALL-32 email review).

## Buttons before the page has loaded (ALL-110)

A button in the server's HTML shows before its click handler is attached, and a tap in that gap does nothing. So every button looks faded until the page's JavaScript has loaded:

- **`Button`, `DialogTrigger` and `Switch` do it for you.** A submit button is `disabled`, so an early tap can't send its form the browser's own way (ALL-60). Any other button gets `aria-disabled`, so a keyboard can still reach it. `Button asChild` (a link) is left alone, because links work before the page loads.
- **A plain `<button>` or another Radix trigger** that's in the server's HTML needs the same: `aria-disabled` from `useHydrated()` (`apps/web/lib/use-hydrated.ts`), plus an `aria-disabled:opacity-45` style.
- **`Input` and `NativeSelect` whose value lives in state** (`value=`) are off until then too. Text typed before it shows but never reaches state, and the next keystroke wipes it (ALL-106, ALL-161). One that keeps its own value (sign-in, `defaultValue`) loses nothing, so it stays on and password managers can fill it.
- **A plain `<input>`, `<textarea>` or `<select>`** with its value or tick in state needs `disabled={!hydrated}` itself, if it's in the server's HTML.

## Editing and saving (owner, 2026-11-16, ALL-115, T71)

**Save as you go.** Changing something that already exists saves it straight away, with no Save button: a choice (a select, a switch) saves when it's made, and a text field saves when you leave it. A small "Saved" tick confirms it. If the save fails, the error shows under the field and what was typed stays.

**One Save only where the pieces mean nothing apart:**
- **Creating something new** (add a person, add a gift, request access): one form, one teal button that names the action ("Add Sam").
- **Fields that are only valid together**, like a shipping address: one Save for the group.
- **Money or anything that can't be undone:** an explicit button, plus a confirm where it's needed.

**Screens where you mostly look and change one thing at a time** (Settings, and a person's page since ALL-127) are a list of rows. Each row shows its current value and opens its own detail screen, the way phone settings work. A single choice (like the time zone) can instead open the browser's own picker right on its row and save when picked. The list itself has no main button.

**Where a new setting goes:** in the Settings section it belongs to (You, Reminders, Gift ideas, Paying for gifts) as a row with its value. A new section only when none fits.

### My list (ALL-127, T74)

My list saves as you go too, with no Save button and no "Unsaved changes" bar. What a signed-in list owner sees:

- **Adding a gift** saves straight away.
- **Removing a gift** hides it and shows "Removed {gift} · Undo" in a bar at the bottom for 6 seconds (`UNDO_MS`). Focus moves to Undo and a screen reader hears "Removed {gift}. Undo available." The 6 seconds wait while Undo has focus or the pointer is over the bar. Undo puts the gift back in its place and focus on the heading. The remove is only sent when the 6 seconds are up, so Undo never reaches the server and a friend's claim on that gift is never lost. It's sent sooner when a second gift is removed (Undo moves to the second), when the page is left in the app, when the tab is hidden or closed (the bar goes then), and when Sign out is picked (Sign out waits for it, up to 3 seconds).
- **An add during the 6 seconds** saves the gifts on screen plus the held one, in its old place.
- **One save at a time**; a change made during a save goes in the next one.
- **Under the title**, next to the count and total: "Saved", "Saving…", or "Couldn't save" with "Try again". A failed save keeps every gift on screen.
- **Changed somewhere else:** if another tab or device saved first, this tab's save is refused. It loads the latest list, puts its own new gifts and any held remove back on top, saves once more, and says "Your list changed somewhere else. We've loaded the latest." If that's refused too, it shows "Couldn't save".
- **Leaving:** the browser warns before closing the tab only while a save is on its way or has failed, including one started as the page was left in the app. In-app links and Sign out ask only after a failed save.
- **Back to a page the browser kept** (back/forward cache): the page shows the list as it was. Its next save is refused as stale and merged like any other, with the notice. Accepted rather than reloading it **[Claude's call]**.
- **Gifts carried over from before signing in** save themselves when the list opens.
- **Guests** are unchanged: there's nowhere to save to, a remove is immediate, and they're warned before leaving with gifts on the list.

## Gifts in progress

**Every gift round that can still change, or has a gift on its way, is one row that opens its round page** (`/rounds/<id>`). Nothing shows when there are none, or when they can't be read.

- **Home:** a "Gifts in progress" list above People, with a row per round for everyone: "Jenn · Christmas" and its status line. What needs the buyer comes first, then the nearest ship-by day (or occasion, once it's bought).
- **A person's page:** the same rows under the header (and under the list prompt), named "Christmas gift".
- Rows are links at least 44 px tall with a chevron. The words say the status; the colour only repeats it.

| Status line | When | Colour |
|---|---|---|
| Looking for ideas | No ideas yet, and we're looking | Muted |
| No ideas found yet | The no-ideas email went, and none since | `--warning` |
| Needs an address | No address to find gifts for, or a gift held for one (missing, or the store couldn't use it) | `--warning` |
| Check the address | A gift held for an address, and the person has one now: saving it places the gift | `--warning` |
| No ideas yet | None yet, and why couldn't be read just now | Muted |
| 3 ideas ready · Choose by Tue, Dec 15 | Ideas the buyer can still pick. "Ideas ready", or only "Choose by", when their list couldn't be read | `--primary` |
| No ideas left | Waiting for a choice, but every idea is taken or no longer shared | `--warning` |
| Waiting on your Zinc balance / payment setup | A gift held for money, or for Zinc or a phone number to be set up | `--warning` |
| Needs a fix · Choose by Tue, Dec 15 | An order failed or the store cancelled it, with time left | `--warning` |
| Needs a look | The round needs the buyer and none of the above fits | `--warning` |
| Waiting to order | Held for a reason on our side (ordering off, or not paid, outranks every other reason), or for an address that is shared now and placed at the next daily look | Muted |
| Confirming your order | Sent to Zinc, not confirmed by the store | Muted |
| Ordered | Bought; not all shipped | Muted |
| May arrive late · due Sun, Dec 27 | Expected after the occasion, and that day hasn't passed | `--warning` |
| Shipped · due Mon, Dec 14 | Everything on its way has shipped ("was due" once that day has passed) | Muted |
| Delivered | Everything has arrived, until the round is complete | Muted |

A line is never false. With several gifts, the one that most needs the buyer wins (one exception: a held gift next to one being confirmed says "Confirming your order", since which hold it is can't be read then), and Shipped or Delivered is never said while another is unfinished. "Choose by" is the day before ship-by, and a round nobody can buy from any more, or that a date change ended (T92), leaves the list; a gift already set keeps its row and its own date. A bought gift leaves `gift_progress_days` (14) after it was delivered or, when nothing says it was, after the later of the occasion and its due day. The rules are the round screen's own (`modules/concierge/rounds/outcome.ts`). One person whose list or address can't be read never hides the rest.

## A person's page (ALL-127)

**A person's page is what we know about them, then a short list of rows.** Each row shows its value and opens its own screen, like Settings (T71). There's no Edit form on the page any more. On a computer it's the same centred column. Plan: [`plans/ALL-127-save-as-you-go.md`](plans/ALL-127-save-as-you-go.md).

| On Mom's page (`/people/[id]`), top to bottom | Shows | Opens |
|---|---|---|
| Header | Photo, name, "Mother · next occasion", where ideas come from, the readiness banner. A failed photo from the Add form says so here | — |
| Gifts in progress | Only when there are some: one row per open round (see Gifts in progress) | The round |
| What we know | The facts, as before | Facts are changed in place |
| About Mom | "Mother · Birthday Mar 14" (no birthday: just "Mother") | About Mom |
| Occasions | Each occasion with its switch, date and order-by date, as rows | Switches save when flipped |
| Gifts: Budget | The base and occasion amounts (ALL-120) | Budget |
| Gifts: Saved gifts | How many, or "None" | Saved gifts |
| Gifts: Past gifts | Only when there are some; no value | Past gifts |
| Gifts: Their list | "Linked" or "Not linked" | Their list |
| Gifts: Shipping address | The street, "Something's missing", a shared list's city, or "Not added" | Shipping address |
| Gifts: Gift ideas | How many ideas the last on-demand run saved, or "None" (ALL-27) | Gift ideas |
| Delete Mom | Behind a confirm, as before | — |

**About Mom** (`/people/[id]/about`) is one screen where each field saves on its own, with a small "Saved" by it and no Save button (the shared `useAutosave` hook):
- **Photo:** the photo picker, which saves on pick.
- **Name:** saves on leaving the field, on Enter, or on leaving the page in the app. An empty name shows "Enter a name." and keeps the saved one.
- **Who are they to you?** The phone's own picker; saves when picked.
- **Birthday:** month and day save together **when you leave the date fields**, so a date passed through on the way to another is never saved (a passing date could let the daily tick start a round). On an iPhone, closing the month wheel moves focus nowhere, so the date then waits 1.5 s (`DATE_SETTLE_MS`) for the day to be picked before it saves. Only a real date saves; "February 31" shows "That date doesn't exist." Changing it moves the same occasion, so an open round stays. Clearing the fields saves nothing; **Remove birthday** (with a confirm) removes it and the birth year. The year stays off until a date is saved, and saves on leaving it.
- **Anniversary:** the same, without a year, with **Remove anniversary**. Offered for anyone, so changing a relationship never drops one.
- Every field is off until the page has loaded (ALL-110). None of these saves touches a round. Saving an address doesn't restart a waiting round straight away either: the next daily tick picks it up (ALL-27 AC-26).

**Gift ideas** (`/people/[id]/ideas`, ALL-27) is where a buyer asks for ideas without waiting for a round:
- **Top:** a "Suggest ideas for Mom" button with the money notice always visible beside it ("Suggesting ideas uses AI and live product lookups, which cost real money: usually about 40¢, at most $1", from settings; the style of [Money notice](#money-notice-decision-53-all-94), no "Alpha:"). While it runs, the button is off and a line says it takes about a minute. With no button, a line says why: "Suggestions are switched off right now." while the engine is off (`idea_engine_enabled` = 0), or "Gift ideas aren't available on your account yet." for a buyer without paid features.
- **A run that finds nothing:** a plain line, never a blank. "Tell us a bit about them first" (with an "Answer a few questions" link) when there are no facts, "We couldn't find anything suitable this time", or "Couldn't get ideas. Try again."
- **Each idea** is a row: the title (a link to the product), the price including shipping, estimated tax and the order fee, and the store ("$74.00 · Amazon"), "Arrives by Dec 10 if ordered today", and a one-line reason it fits. At most one idea per run is over budget, and it carries an **Over budget** label (also shown in the round emails). With no budget, nothing is labelled.
- A new run replaces the last on-demand set. Ideas made inside a round aren't shown here.

**Saved gifts, Their list and Shipping address** moved to screens of their own (`/people/[id]/saved-gifts`, `/list`, `/address`), unchanged inside, each with a back link to the person. The address keeps its one Save (fields only valid together) and its 300 s time limit, since saving it can place held gifts. The "Add an address" email's old link (`/people/[id]?address=open`) lands on the address screen with the form open, and Home's "Add birthday" opens About.

**Pages kept in the background:** Next keeps visited screens in the page, hidden. Leaving About saves a change still waiting (a bad one is dropped), and leaving the address screen closes its form, so coming back shows what's saved.

## Approval screens (ALL-29, T80 to T85)

Mock-ups: [ALL-29 approval](https://claude.ai/artifact/UB35r46GYrCddcLj2Frxhh), owner-approved 2026-11-22, on top of ALL-41's signed-off screens. The pages are plain app URLs that only read when loaded (T80); built for the phone first, with 44px tap targets.

| Screen | URL | What it shows |
|---|---|---|
| Round screen | `/rounds/<id>` | The round's ideas: photo (or the gift icon), title, store, full cost, arrive-by date, the reason it fits. Tick one or more; a bar shows "n picked" and the total against the budget, and "Buy n gifts" continues. An optional **Your budget** field appears only when the round has none. **None of these** opens a sheet with reason chips ("Already has one", "Not their style", "Too pricey", "Too generic") and an optional text; "Already has one" asks "Which one?". With no search left the sheet first says "No more new ideas this time" and the ideas stay buyable |
| List gifts | same | **From their list** comes first. A gift someone else claimed is greyed out; one whose list stopped being shared says "No longer shared"; one from a store Zinc can't buy from, or with no saved price at a check-only store, says **Buy it yourself** and links to its product page (`rel="noopener noreferrer"`). A check-only store's gift is labelled "Price from their list" |
| Over-budget sheet | same | "Yes, pick it" or "Keep within budget". Picks past the over-budget allowance can't continue; the bar says so |
| Confirm page | `/rounds/<id>/buy?ideas=…` | Each idea's photo, title, store, arrive-by date; estimate with shipping and tax, Zinc's order fee, "never more than $cap"; **Ships to** (the recipient, you, or another address; city and state only for a shared address); an optional gift note; the Zinc balance; the money notice; one **Buy now · about $total** button (**Buy anyway** and how far over, for an over-budget idea). Opening it buys nothing |
| Fix page | `/rounds/<id>/fix/<orderId>` | What happened in plain words. Price up: **Check today's price** (with the money notice), then old and new totals and **Buy at about $new** (once per gift; then "See all ideas"). Out of stock, failed, too late: the next-best idea with **Buy this instead**. Address problems: the same gift to you, another address, or the person's own address. Always **See all ideas**. The money notice sits by every button that buys |
| Gone states | any | A round that's ordered, skipped or past its deadline says what happened ("Already ordered: …", "We're still confirming your order." while one may still go through, "No gift is on its way", "It's too late to send a gift in time", "This gift round was stopped", or "This occasion has passed" once the day is over) and offers nothing to buy. An open round with no ideas yet says it's looking, that none were found (after the no-ideas email), or asks for the address. "Choose by" is the day before ship-by, as in the emails. A replaced idea says so |

**Heads-up, reminder and final-notice emails** list each idea as a row (title, total, arrive-by date, reason) with its own **Buy this** link to the confirm page; the one button opens the round screen ("Pick several or none of these"). The text version carries the same links. The needs-attention email's button reads **Review the gift** and opens that gift's fix page; the several-failures summary links each gift to its own fix page, and its button, **See Mom's gift**, opens the round. The ordered email's button does too, as does the skipped email's when other gifts are on their way; the other skipped emails open the person's page, since the round page would only repeat them.

**Signed out or wrong account:** sign in and come back to the same page; another account sees "This gift belongs to another account" and nothing of the round.

## Mock-ups

**What's built, as it looks today:** the [screens and emails page](https://claude.ai/artifact/9mrDvFAgoqxvxmzirJFCz6) has every main screen on a phone (light and dark) and on desktop, and every email, taken from the real app by `pnpm gallery`. The mock-ups below are the designs; that page is the result.

A clickable, phone-first prototype, published as a private shareable artifact page that the owner and Jim can each open on their phones and comment on. **Link:** [GiftsAF mock-ups](https://claude.ai/artifact/BvdSVB6RPatUPRbBDyPRzW) (private; shared with Jim from the page's Share menu). **Source:** [`design/mockups/ALL-41.html`](mockups/ALL-41.html); republish it to the same link after changes.

**Zinc connection (ALL-32):** [`mockups/ALL-32-settings.html`](mockups/ALL-32-settings.html) (Settings, four states), [`mockups/ALL-32-emails.html`](mockups/ALL-32-emails.html) and [`mockups/ALL-32-emails-2.html`](mockups/ALL-32-emails-2.html) (hold, ordered and skipped emails).

**Reviewing:** the owner and Jim share one claude.ai login, so the built-in comments can't tell them apart. The page therefore has its own feedback: on each screen, a comment box with a name picker (Aaron or Jim), and a per-person **"I approve this screen"** button. Comments and approvals are stored in the artifact's shared database, so both people see each other's, and Claude can read them to make changes. Sign-off is complete when both have approved every screen.

| Screen | Shows | PRD |
|---|---|---|
| Give (mock-up "home") | The people you buy for, each with their next occasion and status. Someone who keeps their own list (Mom) is marked "Her own list" and is the ideal case; someone without one (Dad) is marked "we suggest ideas". An empty state for a new user | P-1, P-3, decision 37 |
| Person profile | What the app knows about them (facts, sizes, likes), with edit and delete, one readiness line, whether they keep a list, and rows for About, occasions and gifts (ALL-127, see A person's page above), including a **Budget** row (T71) showing the base and any occasion amounts, which opens the Budget screen: "Any occasion", an optional amount per switched-on occasion ("Uses $75" when empty) and one Save (ALL-120) | C-6, C-7, decision 36, T73 |
| "Here's what I learned" | The facts pulled from a capture, each to keep or drop | C-3 |
| Pick from their list (Mom) | Gifts from the person's own list, with when each was added and arrive-by date; one already claimed by someone else; pick one or several. **Your budget** is a separate, optional field: only when it's filled in do over-budget labels and the confirm step appear | A-1, B-4, decisions 36, 37 |
| Suggested ideas (Dad) | Generated ideas with the reason each fits, the same optional budget, and "None of these" with a reason | A-1, B-4, G-3, decision 36 |
| Where it goes | Ship to the recipient, to you (your saved address), or to another address. For someone with a list, their shared address is one tap (city shown); for someone without one, you add theirs once and can save it | P-5, A-3, decision 38 |
| Price went up **[Claude's call]** | Re-approve at the new total, or pick the next-best idea (D29); built as the fix page (see Approval screens, ALL-29) | A-4 |
| Gift list | The list app in the new look: add by link or by hand, saved as you go with Undo on remove (ALL-127), share | Existing (GiftsAF) |
| Shared list and claim | A friend opening a share link and claiming a gift; a claim that lost the race. The list's owner never sees claims | Existing (GiftsAF), decision 39 |
| Sign-in | Google sign-in (email and password stays for existing list users) | ALL-20 |
| Extension popup | "Capture for…" with a person picker | C-1 |
| Extension popup: Add to my list | Product card on top (name, price, photo with ‹ ›, recent people as buttons), "or save it for someone" below; the added, already-there, likely-duplicate and full states; one success banner after any save. [Approved mock-ups](https://claude.ai/artifact/YU7tRxcSdDyP8GRCs1SjkP) (owner, 2026-11-20, ALL-78) | C-1, T77 |
| Heads-up email | Two kinds. **Reminder:** the options as small read-only rows and "Choose a gift"; nothing is bought until you choose. **Auto-buy on** (opt-in, A-7): says which gift will be bought and on what date, marks it, and offers "Review or change" and how to skip. The "Buy this" and button links are plain app URLs for the signed-in owner (T80, see Approval screens); other buttons are signed one-time links (design §6.4) | N-1, A-7, decision 40 |
| Computer width | Give and the gift list only | — |

**As built on the person page (ALL-26, D51, ALL-127):** "What we know" is one list of facts by category, each with its source and ✨ on unconfirmed AI suggestions. Tapping a fact opens it in place, and it saves as you go (T71), with no Save button:
- **Fact** (the words) saves when you leave the field or press Enter, or when the fact is closed with **Done**; **Kind** saves when picked. Each save carries both, so a words save never puts back the old kind. Empty words show "Type something first." and save nothing; a failed save keeps what was typed and shows why under the fields.
- **Use for gift ideas** is a switch that saves when flipped. Off moves the fact to "Turned off", where it keeps its text so the AI won't suggest it again; it stays open where it was until Done, so it can be flipped back.
- **Looks right** shows only on an unconfirmed ✨ suggestion: it confirms the fact as it is, and the ✨ goes. Changing a fact's words or kind also confirms it, as before; saving with no change sends nothing.
- **Delete** still asks first.
- An open fact stays where it was opened until Done, even when a new kind belongs in another group, so "Saved" doesn't jump away. The fields stay off until the page's JavaScript has loaded (ALL-110).

"Add a note" isn't built yet.

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

## Order tracking (ALL-33)

**Mock-ups:** [tracking screens and emails](https://claude.ai/artifact/64XUHT7xfzaibNtWtWpSXx). What's built is on the [screens and emails page](https://claude.ai/artifact/9mrDvFAgoqxvxmzirJFCz6).

**Round screen, "Your gifts":** each bought gift has one status line.
- **Held:** the same words as in Gifts in progress, with the way to act: **Add address**, **Change address** (the store refused it) or **Open the address**, **Finish setup** (Paying for gifts) or **Top up your Zinc balance**. "Waiting to order" needs nothing. One refused for an address that isn't the person's can only be cancelled, from its email, and says so on its own row; the round's other held gifts say "Waiting to order".
- **Ordered:** "Ordered · usually arrives by <date>" (the store's own range), or just "Ordered".
- **Shipped:** "Shipped · due <date>" ("was due" once it has passed, and no late chip) with a "Track it" link to the carrier's page (none for Amazon), and an **It arrived** button.
- **May be late:** a chip above the line, "May arrive <date> · n days late".
- **Delivered:** "Delivered". Switching `order_tracking_enabled` off hides the button.
- **Store cancelled:** an amber chip, "The store cancelled it · $<Zinc's refund amount> back in Zinc", or "the money is back in Zinc" when Zinc didn't say how much.

The Ideas list below drops the gifts shown under "Your gifts", so nothing is listed twice; the other ideas stay as history (owner, 2026-11-23).

**Five emails** (tone as in Tone in emails: apologise first, then explain every real option):

| Email | When | Says |
|---|---|---|
| Gift may be late | Daily run, one late gift | Sorry, the date, it can't be cancelled, your options (keep it, buy locally and return this one), and **It already arrived** |
| Back on time | Daily run, a gift told late is on time again | Good news, nothing to do |
| Store cancelled, too late | Daily run, a store cancel on or after the ship-by date | Sorry, the wallet is refunded, too late to ship another in time, what you can do |
| Updates on n of your gifts | Daily run, more than one item for a buyer | The same news as one list, bad news first |
| Your gifts arrived | The last gift of an occasion arrives | One short email naming every gift |

A store cancel before the ship-by date uses the existing failed-gift email and fix page.

## How a gift went (ALL-34)

| Screen | Where | What it shows |
|---|---|---|
| How did they like it? | `/rounds/<id>/reaction`, from the email's answers, the round screen's "How did it go?" and Past gifts | One card per delivered gift: photo, title, four answers (two to a row on a phone, four on a computer), an optional note and its own Save. An email's answer opens chosen but says "Not saved yet." After saving: "Saved. Thanks for telling us.", and it can be changed. Once every gift has an answer, a link back to the person |
| Past gifts | `/people/<id>/gifts`, from the person's Past gifts row | Past rounds, newest first: occasion and full date, then each gift's cost ("Cost not known yet"), what happened to it, the answer and note, and "How did it go?" or "Change". A skipped round says "No gift was bought." |

**Save is teal only on a card with an answer and something unsaved.** On every other card it's an outline button, so teal marks what's still to save.

## Moving the list app to the new look (in ALL-20)

The prototype's colours and stylesheet go; **none of its behaviour does.** When ALL-20 restyles it, all of the following must keep working, and the existing tests (`modules/lists/components/__tests__/`) must still pass:

- Adding a gift by Amazon link (with lookup status and image) or by hand, with price checking
- Removing a gift, and focus moving somewhere sensible after
- Saving, the warning on leaving, and the save error messages (since ALL-127: saving as you go, see Editing and saving > My list)
- A guest's list carried over through sign-in or sign-up (kept for 24 hours)
- Copying a share link, with a copy-by-hand fallback when the clipboard is blocked
- The shared list page: a signed-out friend can view and claim; the owner sees "this is your list" and can't claim; a second claim on the same gift is refused
- Dark mode, keyboard focus, and screen-reader announcements

`gifts.css` was retired in ALL-20: every list screen moved to Tailwind classes at once, since the restyle touched them all. Each feature above has a test (`modules/lists/components/__tests__/`, and the owner-claims rule in `supabase/tests/lists.test.sql`).

## Home page (ALL-46)

The public front door at `giftsaf.com` for signed-out visitors, plus the guided tour at `/tour`. Direction **B, bold and cheeky** (chosen 2026-11-01): big type, a tilted yellow "sticker", plain talk aimed at a forgetful 24-year-old. It follows the browser's light or dark setting like the app; the mock-up shows dark. Spec, copy and layout: [`plans/ALL-46-home-page.md`](plans/ALL-46-home-page.md); mock-ups: [`mockups/ALL-46-home.html`](mockups/ALL-46-home.html).

- **Honest, not shouty, about alpha:** an ALPHA tag by the name and a status chip on each feature (Works now, Being built, Later), plus the page copy. The yellow "Early alpha. Lots is broken." strip that used to top every home, tour and request-access page was removed on 2026-11-01 (ALL-50, T36): the owner doesn't want the top of the page to give an early-alpha impression. The mock-up still shows it.
- **One new token pair:** `--sticker` / `--sticker-foreground` (`#facc15` on `#18181b`, the same in both themes) for the sticker and the logo's tag (ALL-48). Contrast is checked in `test/tokens.test.ts`.
- **Phone first, good on a computer:** one column on phones; from 768 px the hook gets a "pick a gift" card beside it, and features and steps sit three across.
- **The concierge story, right after the hook** (ALL-56): the owner wants the page to show GiftsAF is AI-native, with the AI doing the remembering and recommending for its users, not just helping build the app. "It gets to know your people, so you don't have to": it learns from your feedback and how they liked each gift, keeps a profile that sharpens every year, picks ideas that fit (no searching), tells you when it's time to buy, and one tap buys and ships. A sample "What it knows about Dad" card shows learned facts tagged with their source (You told us / His list / His reaction). Labelled "Being built". "How it'll work" became the same loop in four steps: tell us who you buy for, it learns them, it tells you when, you tap yes.
- **Request access and feedback open over the page** (ALL-53, T37), not as a separate page or an email link: the owner felt a separate page read like an early-2000s "email me" form. On phones it's a sheet that slides up from the bottom; from 640 px it's a box in the middle, with the page dimmed and blurred behind. Esc, ✕ or a tap outside closes it. Feedback is a "Tell us the sad story" box (a message, plus an optional email for a reply) that emails the owner; both show a thank-you and close themselves after 4 s. The overlay is `components/ui/dialog.tsx`, for any future layer like this. `/request-access` still works as a page for direct links. Sketch: [`mockups/ALL-53-overlays.html`](mockups/ALL-53-overlays.html).

## Logo (ALL-48)

**The logo is "Gifts" in heavy type, then "AF" on a tilted yellow gift tag whose hole is a heart.** The owner picked it (direction C1) on 2026-11-01 from browser mock-ups: [`mockups/ALL-48-logo.html`](mockups/ALL-48-logo.html). The "AF" is a double meaning: "as f\*\*\*", and the family's "Allens Forever", which is what the small heart is for. The tag reads like the home page's sticker, aimed at people in their mid-twenties.

- **Colours:** the `--sticker` yellow and near-black, the same in light and dark. No new tokens.
- **Where it shows:** the app top bar, the home page and tour bar, the sign-in frame, and the browser-tab, Apple and install icons. The icons are the tag on a near-black square. At tab size the heart is dropped so "AF" stays readable.
- **One source:** the shapes live in `apps/web/lib/logo-art.ts`, which the wordmark (`components/logo.tsx`) and the generated icons (`lib/app-icon.tsx`) both use. "AF" is drawn as shapes, not text, so the icons don't depend on fonts.
- **Christmas hat:** a Santa hat on the tag's corner, plus holly on the larger icons, while today (US Eastern) is inside `HOLIDAY_LOGO_DATES` (`11-01..12-26` to start). It's an add-on layer: outside the window, or with the variable unset, the plain logo shows. It switches on and off within the hour, with no deploy. Changing the dates means editing the variable in Vercel. See T35.
- **Link previews (ALL-55):** `app/opengraph-image.tsx` draws a 1200×630 share image (logo, "Gifting, handled AF.", the pitch, the domain) in Geist, a free font kept in `apps/web/assets/fonts/` because a generated image can't use the device font. It wears the hat in season too. The root layout sets the Open Graph and Twitter tags, with absolute URLs on giftsaf.com (`lib/site-url.ts`). The image path is public, so signed-out crawlers like LinkedIn's can load it. After changing it, refresh LinkedIn with its Post Inspector.
- **Always in the same spot (ALL-54):** every top bar uses one row (`components/top-bar-row.tsx`), and the page always reserves the scrollbar's width, so the logo never moves between pages.
- **Not done:** seasonal versions beyond Christmas.
