# ALL-46 Home page for giftsaf.com, with a guided tour: Spec and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a signed-out visitor to https://giftsaf.com sees a bold, honest-about-alpha home page that explains GiftsAF and offers a guided tour with made-up people, or sign-in. Signed-in visitors still land on their app home.

**Links:** [ALL-46](https://linear.app/allens-forever/issue/ALL-46) · audiences and funnel in [`planning/strategy.md`](../../planning/strategy.md) §3 · name and domain: planning decision 44 (ALL-14) · app shell and "home needs an account": T29, T30 ([ALL-20 plan](ALL-20-app-shell.md)) · look and feel: [`design/ui.md`](../ui.md) · mock-ups from the brainstorm: [`mockups/ALL-46-home.html`](../mockups/ALL-46-home.html) (phone, chosen version) and [`mockups/ALL-46-home-desktop.html`](../mockups/ALL-46-home-desktop.html) (phone and computer layout). Both are bare HTML fragments from the brainstorm; open them in a browser to see them.

## Spec: what it does

### Why, and who it's for

The idea for GiftsAF came from the owner's son: 24, always forgets holidays, and is terrible at telling people what to buy him. **He is the person this page talks to.** The concierge fixes the forgetting; the gift list fixes "what do you want?". The same young adult is also the scan-to-gift crowd later, so one voice, bold and a bit cheeky, leaning into the "AF" name, covers the whole platform. Parents and grandparents mostly arrive by tapping his shared list, which already works without this page.

**How people arrive decides how much hand-holding they get** (owner, 2026-11-01):
- **Discovery** (someone told them, they searched, they're curious): lots of hand-holding. The home page explains, and the tour lets them try it with made-up people.
- **On a task** (a shared list link, an email link, later a scanned QR code): little friction. They go straight to the task, and only a small link offers to explain GiftsAF. "If they're delighted with the experience they will explore further."

**Honest about alpha:** it's all early development. The page says plainly that a lot is broken, invites people to poke around, and shows where it's heading. Each feature carries a status.

### Who it's for and what they can do

1. **Understand it in seconds:** as a curious visitor on a phone or a computer, I can tell what GiftsAF does, that it's early alpha, and what works today, without signing in.
2. **Take the tour:** as a curious visitor, I can walk through the app with made-up people (pick a gift for Mom from her own list, see ideas for Dad, see my own list and share it), so I understand it before I make an account. Nothing I do is saved or bought.
3. **Ask to get in:** as a visitor who likes what I saw, I can request access from the home page and the end of the tour. As someone already invited, I can sign in.
4. **Signed in, nothing changes:** as a signed-in user, `giftsaf.com` still opens my app home.
5. **From a shared list, find out more:** as a guest who tapped a shared list link, I can find a small "What is GiftsAF?" link that leads to the home page, without it getting in the way of claiming a gift.
6. **Tell the builders something's broken:** as a visitor, I can send feedback from the home page.

### The page

Chosen in the brainstorm: **direction B, bold and cheeky**: dark background, big type, a yellow "sticker", teal buttons (the dark-mode tokens in `ui.md`: background `#0b0b0d`/zinc, primary `#2dd4bf`, sticker `#facc15`). The home page is **always dark**, whatever the visitor's theme. Phone first, and it must look good on a computer (owner).

Top to bottom (copy from the chosen mock-up; small wording polish is the builder's call):

| Section | Phone | Computer |
|---|---|---|
| **Alpha strip** (every home and tour page) | Yellow strip: "🚧 Early alpha. Lots is broken. Poke around anyway." | Same, full width |
| **Top bar** | "GiftsAF" + an "ALPHA" tag; "Sign in" on the right | Adds a "How it works" anchor link |
| **Hook** | Sticker "Mom's birthday is Saturday 👀"; headline "Gifting, handled AF."; "Where we're heading: we remember the dates, find the gift, and ship it. You just tap yes."; buttons **Take the tour** (primary) and **Request access** | Two columns: the text on the left, a light "pick a gift" card on the right (Mom's birthday, two gifts from her list, "Send it · $42"), as in the desktop mock-up |
| **What works today** | Three cards, each with a status chip: **Works now**: "Your gift list" · **Being built**: "Never forget a birthday" (in testing with a few friends) · **Later**: "Buy-me-a-drink shirts" | Three cards side by side |
| **How it'll work** | Three stacked steps, each a numbered circle, a bold title and one line: Add your people / We get ideas ready / You tap yes. Then "Nothing is ever bought without your OK." **Each step on its own lines; nothing wraps mid-sentence** (owner) | Three steps side by side, one column each |
| **Feedback** | "Found something broken? Tell us." / "It's two of us building this. Every bit of feedback helps." / **Send feedback** button | Same, narrower column |
| **Footer** | "GiftsAF alpha · made by Aaron and Jim" | Same |

### The tour (`/tour`)

A guided walkthrough of the real app screens, filled with made-up people, for discovery visitors. Steps, each with a short caption saying what's happening and a **Next** button:

1. **Your people:** the app home with Mom (has her own list), Dad (no list, ideas ready) and Sam. Caption: we remember everyone's dates.
2. **Pick from Mom's list:** Mom's birthday, gifts she chose herself. The visitor taps one; the button shows the total.
3. **Where it goes:** ship to Mom (her address comes with her list), to me, or elsewhere.
4. **Done:** "Ordered. (Not really, this is the tour.) It arrives Thursday, and Mom never sees what you spent."
5. **Ideas for Dad:** no list, so ideas from what you've saved about him, each with its reason.
6. **Your own list:** your list with a few gifts and a Share button. Caption: stop answering "what do you want?".
7. **End:** "That's where we're heading. A lot is still broken, but your gift list works today. Want in?" Buttons: **Request access** (primary), **Already invited? Sign in**, **Back to home**.

Rules: no network calls, no database, nothing saved or bought; the visitor can leave at any step (a "Skip tour" link). Example people and gifts match the ALL-41 mock-ups.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A signed-out visitor | Opens `/` | The home page shows, with no redirect to sign-in |
| AC-2 | A signed-in user | Opens `/` | Their app home shows, as today |
| AC-3 | The home page | Rendered at 375 px and at 1280 px wide | Every section from "The page" is there; at 1280 px the hook is two columns and the steps are side by side; no horizontal scroll at 375 px |
| AC-4 | The home page and tour | Viewed at any width | The alpha strip is visible, and each feature card shows its status chip |
| AC-5 | A signed-out visitor | Taps **Take the tour** | `/tour` opens without sign-in, at step 1 |
| AC-6 | The tour | The visitor steps through to the end | All 7 steps show in order; picking a gift updates the button total; no request leaves the browser (no fetch to Supabase or `/api`) |
| AC-7 | Any tour step | The visitor taps **Skip tour**, or at the end **Already invited? Sign in** | They reach the home page or sign-in respectively |
| AC-8 | The home page or tour end | The visitor taps **Sign in** | Sign-in opens, and after signing in they land on their app home |
| AC-9 | A guest on a shared list (`/share/<token>`) | Looks for more | A small "What is GiftsAF?" link to `/` is present and doesn't push the claim buttons down noticeably |
| AC-10 | The home page | The visitor taps **Send feedback** | Their email app opens to the feedback address with the subject "GiftsAF alpha feedback" |
| AC-13 | The home page or tour end | The visitor taps **Request access** | Their email app opens to the same address with the subject "GiftsAF access request" and a one-line prefilled body asking for their name |
| AC-11 | The home page | Its HTML is fetched | The title and description are set for sharing (title "GiftsAF", a one-line description) |
| AC-12 | `main` is merged | Production deploys | https://giftsaf.com shows the home page to a signed-out visitor (checked on the live site) |

### Out of scope

- A real demo account or a "try it with your own data" sandbox (the tour uses fixed made-up data).
- Open sign-up: publishing the Google sign-in screen and sending Supabase's sign-up emails through Resend. Revisit when the alpha opens up.
- A request-access form or list (requests come by email for now).
- Analytics or tracking (none yet).
- Social sharing images (Open Graph image); title and description are enough for now.
- The "What is GiftsAF?" link in **emails**: that's ALL-23 when it builds the email templates. Scan-to-gift pages don't exist yet.
- A privacy page, terms, or a contact form.
- A logo; the name stays plain text (`apps/web/lib/brand.ts`).

### Open questions

None left for the owner. The calls below are marked in "What was decided".

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Who the page talks to | A young adult who forgets birthdays and can't say what they want (the owner's son, 24) | Owner: that's where the idea came from, and the same person spans all three products |
| Look | Direction B: bold, cheeky, dark | Owner picked it from three directions |
| Phone or computer | Phone first, and it must look good on a computer | Owner |
| Honest about alpha | Alpha strip, an ALPHA tag, a status per feature; pitch "where we're heading" | Owner: "a lot is still broken but you can poke around and see where we are heading" |
| Discovery vs task | Discovery gets the home page and the tour; task arrivals go straight to the task, with a small "What is GiftsAF?" link | Owner |
| Where the page lives | In the same app (`apps/web`): `/` shows the home page when signed out and the app home when signed in; the tour is `/tour` **[Claude's call]** | One app, one deploy (T19); no new project or domain setup |
| Home page theme | Always dark, whatever the visitor's system theme **[Claude's call]** | Direction B is dark by design; the app itself keeps following the system theme |
| Tour data | Fixed made-up people and gifts in code, matching the ALL-41 mock-ups; rendered with the app's real components where they exist **[Claude's call]** | Shows the real look without touching real data; no seeding or demo accounts |
| Feedback | A `mailto:` link to allensforever711@gmail.com with subject "GiftsAF alpha feedback" **[Claude's call]** | Simplest thing; there's no inbox at `giftsaf.com` yet (Resend only receives on `in.giftsaf.com` into a webhook). The address is already public in the repo |
| Footer credit | "made by Aaron and Jim" **[Claude's call]** | Fits "it's two of us building this" |
| Who can get in | **Invite only: "Request access"**, not open sign-up. The tour shows where it's heading without an account; invited people sign in to poke around the real app | Owner chose this over open sign-up (2026-11-01). Google sign-in stays in testing mode, so inviting someone means adding their email as a Google test user (up to 100) |
| How access is requested | A `mailto:` to the same address as feedback, subject "GiftsAF access request" **[Claude's call]** | Simplest; no form, no table, no inbox to build. A request list can come later if requests pile up |
| Concierge screens in the tour | Tour-only copies built from the ALL-41 mock-ups, in a tour folder; the list step reuses real list components where practical **[Claude's call]** | The real concierge screens don't exist yet (ALL-21 and later); the tour can switch to them when they do |
| Tour theme | Dark, like the home page **[Claude's call]** | One continuous look from home to tour |
| Signed-in visitors | `/tour` is public for everyone; a signed-in user tapping "What is GiftsAF?" lands on their app home **[Claude's call]** | They already have an account; no second explainer address needed |
| Analytics | None for now **[Claude's call]** | Not needed to learn anything yet; adds a vendor and a privacy question |

## Principles check

- **Simplest version?** No sandbox account, no analytics, no OG image, no CMS: copy lives in the components. The tour is client-only with fixed data.
- **Hard-coded values?** The brand name and tagline come from `lib/brand.ts`. The feedback address and the made-up tour data are content, not business values; the address goes in `lib/brand.ts` beside the name. No prices or limits involved.
- **Product boundaries?** The home page and tour are shared (`apps/web/app` and `apps/web/components`), not a product module. The tour may render list and concierge components with fixed props, but must not call their data functions.
- **Docs and decisions:** add T# (home page and tour in the same app, signed-out `/` is public; this changes T30's "home needs an account") to `design/decisions.md`; update `design/ui.md` (home page look) and `README.md` (the docs table, for the new plan and mock-ups).

## Plan

To be written with superpowers:writing-plans once the owner approves this spec.
