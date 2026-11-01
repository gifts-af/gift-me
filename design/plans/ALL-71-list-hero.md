# ALL-71 Home page: a list hero above the concierge, with its own tour: Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task.

**Goal:** a signed-out visitor to giftsaf.com sees, first, that GiftsAF already gives them a wish list they can text to anyone who asks, with a short tour of it; the concierge hero follows, unchanged except for its button.

**Links:** [ALL-71](https://linear.app/allens-forever/issue/ALL-71). Home page: ALL-46 (`design/plans/ALL-46-home-page.md`, T34), tour layout ALL-61, tour icons ALL-62. Owners never see claims: product decision 39, T30. Mock-up from the brainstorm (2026-11-01): two heroes stacked, list first.

## Spec: what it does

### Why

The home page sells only the concierge, which is still being built. The part that works today is the list: when someone asks "what do you want for your birthday?", you text them one link. Some people will want only that. Today it's one small card in the "Today" section. The owner wants it as visible as the concierge, and as frictionless as the list itself.

### Who it's for and what they can do

1. **See the list first:** as a signed-out visitor, the top of the home page tells me I can keep a wish list and text one link to whoever asks.
2. **Tour the list:** I can take a short tour of the list with made-up gifts, like the concierge tour.
3. **Ask to get in:** from the list hero (and its tour's last step) I can request access; from the concierge hero I can join the waitlist.

### The page, top to bottom

1. **List hero (new).** Same layout, sizes and spacing as today's hero (`components/home/hook.tsx`): text left, sample card right from `md`; on phones one column with the card hidden, like today's hero hides its card. Parts:
   - **Sticker:** "What do you want for your birthday?" with 🎁 (same sticker style).
   - **Headline (the page's `h1`):** "Your wish list, one text away."
   - **Line of text:** "Add gifts from any shop. Text one link when someone asks. Family claims a gift so nobody doubles up."
   - **Buttons:** **Take the tour** (primary, to the list tour) and **Request access** (secondary, the existing request-access dialog). Under them, the "Have an invite? Sign in" link, as today.
   - **Sample card:** what the person who asked sees: a text exchange ("what do u want for ur bday?" / "here you go 👇"), then "Aaron's list" with three gifts, each with a lucide icon in the muted box (as ALL-62), one marked **Claimed** and two with a **Claim** button. Sample content, not real data.
2. **Concierge hero (today's hero).** Unchanged except: its headline becomes an `h2` (same look), and **Request access** becomes **Join the waitlist**.
3. **Everything below stays as it is**, including the "Your gift list" card in "Today".

Light and dark follow the browser, using the existing tokens; no new colours.

### The list tour (new)

At `/tour/list`, built like `/tour` (same frame, two-column layout from `md`, step counter, Skip tour, Next, focus moves to each caption). Made-up content only; nothing is saved or sent.

| Step | Caption | Phone screen |
|---|---|---|
| 1 | "Add anything you'd like, from any shop." | Your list with three gifts (icon, name, shop, price, a size or note) |
| 2 | "Someone asks what you want? Text them one link." | A text thread ending in the list link, with a Copy link button |
| 3 | "They open it and claim a gift, so nobody doubles up." | The shared list as Mom sees it; tapping Claim on a gift marks it claimed |
| 4 | "You never see who got what. It's still a surprise." | Your own list again, no claim marks |
| 5 | "That's your list." | End screen: **Request access**, "Have an invite? Sign in", Back to home |

### Waitlist

**Join the waitlist** opens the same form as Request access, titled "Join the waitlist" with a line saying the concierge is still being built and we'll email when it's ready. The concierge tour's last step says **Join the waitlist** too, with its line reworded to "The concierge is still being built. Join the waitlist and we'll email you when it's ready." and a smaller "Just want the list? Request access" link under it **[Claude's call]**. `EndScreen` takes its line and buttons as props so both tours use it.

`/tour/list` must be added to `isPublicPath` in `lib/supabase/proxy.ts` (today only `/tour` is public), with a row in `test/public-paths.test.ts`.

**Inbox filters (owner, 2026-11-01).** Each form emails a Gmail plus-address of the team inbox, so Gmail filters and labels can sort them:

| Form | Sent to | Subject |
|---|---|---|
| Request access | `allensforever711+access@gmail.com` | "GiftsAF access request: {name}" (as today) |
| Join the waitlist | `allensforever711+waitlist@gmail.com` | "GiftsAF waitlist: {name}" |
| Feedback | `allensforever711+feedback@gmail.com` | as today |

**What each form promises, and what the owner does (owner, 2026-11-01).** The waitlist is for the concierge, so it means *later*:

| | Request access | Join the waitlist |
|---|---|---|
| Thank-you on screen | "We'll email you when you're in." (as today) | "You're on the list. We'll email you when the concierge is ready." plus a small "Want your wish list now? Request access" link |
| Email to the owner | As today: add them as a Google test user, then reply | "{name} wants the concierge. Email them when it launches." No test-user step |
| Email to the person (new) | "Thanks, we got your request. We'll email you when you're in." | "You're on the concierge waitlist. We'll email you when it's ready." |

Nothing is stored: the `+waitlist` Gmail label *is* the waitlist, and at launch the owner invites everyone under it.

**Branded emails (owner, 2026-11-01: "this is a branding touchpoint").** Every email these forms send, to the person and to the owner, uses the ALL-23 branded layout (`renderEmail` in `modules/concierge/notify/email-layout.ts`: logo, site colours, light and dark, phone-safe, with a plain-text part). The confirmation to the person is new: today they get nothing. The layout moves to `apps/web/lib/` (shared code) so these forms don't import the concierge module, and the concierge's templates import it from there **[Claude's call]**. The person's confirmation has no links to act on and no tracking, and is sent only after the bot check passes (ALL-68), so the form can't be used to email strangers. Feedback emails to the owner use the layout too; feedback senders get no confirmation (not asked for). The `e2e/emails.spec.ts` phone checks cover the new templates.

The tag is added to `FEEDBACK_EMAIL` in `lib/brand.ts` by one helper (`inboxFor("access")`), so the base address stays in one place. Feedback getting a tag too is Claude's call (same reason). The `mailto:` fallback in the bot-check notice keeps the plain address.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Signed out | I open `/` | The list hero is first: its headline is the page's only `h1`, then "Gifting, handled AF." as an `h2` |
| AC-2 | List hero | I look at its buttons | "Take the tour" goes to `/tour/list`; "Request access" opens the request dialog |
| AC-3 | Concierge hero | I click "Join the waitlist" | The waitlist dialog opens; sending it emails `allensforever711+waitlist@gmail.com` with "waitlist" in the subject |
| AC-3b | Any page | I send Request access, or feedback | The email goes to `+access`, or `+feedback`, respectively |
| AC-3c | Request access or waitlist sent | — | The person gets a branded confirmation email with the wording above; the owner's email is branded too; the waitlist thank-you and owner email match the table |
| AC-3d | Each new email | Rendered at 375 px, light and dark | Passes the `emails.spec.ts` phone-layout checks |
| AC-4 | 1280 px | `/` | In the list hero the sample card sits right of the text (as the concierge hero test does) |
| AC-5 | 375 px, light and dark | `/` and `/tour/list` | No sideways scroll; the theme follows the browser |
| AC-6 | `/tour/list` | I press Next through every step | Steps 1–5 show their captions; Claim on step 3 marks the gift claimed; step 5 has Request access |
| AC-7 | `/tour/list` at 375 and 1280 px | Step 2 | Same layout rules as the ALL-61 tour test |
| AC-8 | Concierge tour | Last step | It says "Join the waitlist" |

### Out of scope

- Open sign-up. GiftsAF stays invite-only (T34); the owner chose Request access over Sign up (2026-11-01).
- Gating the concierge for list-only users: not needed while sign-up is invite-only.
- Changes to the signed-in Home, the list app, or the sections below the two heroes.
- Real product photos (ALL-27).
- A branded "you're in" invite email and the concierge launch email: the owner replies by hand for now.
- Storing requests or the waitlist in the database.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Where does the list go? | A second hero above today's, same parts | Owner, 2026-11-01 |
| Buttons | List hero: Take the tour + Request access. Concierge hero: Take the tour + Join the waitlist | Owner |
| Theme | Same light/dark as the rest of the page | Owner |
| Rest of the page | Unchanged | Owner ("we are just adding one section above") |
| Copy, sample card, tour steps | As above | Claude's call; owner reviews in the PR preview |
| Sample card shows the asker's view, not the owner's | The owner never sees claims (decision 39), so a card showing "Claimed" on your own list would be wrong | Claude's call |
| Tour route `/tour/list`; concierge tour stays at `/tour` | Existing links keep working | Claude's call |
| Waitlist reuses the request form | One form; the owner tells them apart by address and subject | Claude's call |
| Each form emails a plus-address (`+access`, `+waitlist`) | So Gmail filters and labels can sort them | Owner |
| The waitlist means "later": no invite until the concierge launches | They clicked on the concierge, so "when you're in" would be the wrong promise | Owner |
| Branded emails, plus a new confirmation to the person | A branding touchpoint | Owner |
| The email layout moves to `lib/` | Shared by the concierge and the public forms without crossing modules (T19) | Claude's call |
| Only the first hero has the page's `h1` | One `h1` per page | Claude's call |

## Principles check

- **Simplest version?** Reuse the hero layout, the tour frame, the request form and the ALL-62 icons. No new data, no network calls in the tour.
- **Hard-coded values?** Copy and sample content only; no tunables.
- **Product boundaries?** Home and tour components only; no module imports beyond what they use today.
- **New personal data?** None stored. The waitlist form collects what Request access already does; the new confirmation email goes only to the address the person typed, for the request they just made (T42).
- **Docs and decisions:** add a line to T34 in `design/decisions.md` (the home page now leads with the list; waitlist wording for the concierge).

## Plan

Written after the owner approves this spec (superpowers:writing-plans).
