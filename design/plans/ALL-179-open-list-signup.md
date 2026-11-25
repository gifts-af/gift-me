# ALL-179 Open list sign-up, and the concierge by request: Spec

**Status:** draft, not approved. No plan and no code until the owner approves this spec.

**Goal:** anyone can sign up at giftsaf.com, build a wish list and share it, free; the concierge (Give) is something they request and we approve.

**Links:** [ALL-179](https://linear.app/allens-forever/issue/ALL-179). Revises T34 (invite only), T58 (everyone lands on Give) and the ALL-71 waitlist. Keeps planning decision 53 (what costs money is off unless `paid_features` is on) and D59 (friends use the concierge once card payments ship).

**Scope freeze:** built as the owner's exception (2026-11-25).

## Spec: what it does

### Why

The owner's family is asking for Christmas ideas now. Building and sharing a list charges them nothing, so there is no reason to keep it invite only. Success: a relative with no help from us signs up, makes a list and texts the link, well before Christmas.

**Would make it a failure even if it works:** a stranger can spend our money; someone who already uses the concierge loses it; a relative signs up and never gets the confirmation email.

### Who it's for and what they can do

1. **Start a list:** as a relative, I can sign up with Google or email and land on My list, so I can share it for Christmas.
2. **Ask for the concierge:** as a signed-in list user, I can open Give, see what the concierge does, and ask for access in one tap.
3. **Let someone in:** as the owner, I get an email for each request and can give that account access.
4. **Nothing changes for those already in:** as someone with access, Give is as it is today.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed out | they open the home page | the list half's main button is "Start your list, free", which goes to sign-up; the bar says "Sign in", not "Invite only"; the concierge half offers "Request concierge access" |
| AC-2 | signed out | they open sign-in, sign-up, the list tour's end, or a shared list | nothing says invite only for lists, and the way in is sign-up |
| AC-3 | a new account, no access | they sign in with no other page asked for, or open `/` | they land on My list |
| AC-4 | signed in, no access | they tap Give | `/give` shows the pitch, "Request access" and the tour link |
| AC-5 | signed in, no access | they open `/people` pages or the concierge settings pages by address | they see the pitch, and none of those pages' content |
| AC-6 | signed in, no access | they tap Request access | the date is saved once, the owner gets one email with their name and account email, and the page says "Request sent". A second tap or a reload sends nothing more. If the email to the owner fails, nothing is marked as sent, and they can try again |
| AC-7 | signed in, no access | they open Settings | Name, time zone and My address show; Reminders, Gift ideas and Paying for gifts don't |
| AC-8 | signed in, no access | they open someone's shared list | claiming works as today; "Add them to your people" isn't shown |
| AC-9 | an account with access | they use the app | `/`, people, rounds, settings and shared lists are as today; `/give` goes to `/` |
| AC-10 | any account that exists when this ships | it ships | it has access |
| AC-11 | an account | it calls the database as itself | it can read its own access flag and request date, and can't change either, or see anyone else's |
| AC-12 | access is turned on for an account | it uses anything that costs money | still refused unless `paid_features` is on |
| AC-13 | the access check itself fails | the page loads | an error with a way to retry, never the concierge and never a false "request access" |
| AC-14 | an account with a round in progress | access is turned off | its `/rounds` and emailed `/a/` links still work, so nobody loses sight of a gift being bought |
| AC-15 | Google import isn't approved by Google for the public | someone with access opens Import | it's not offered, and the page says to add people by hand |

### Getting it live, in order

Nothing on the public pages opens until steps 1–3 are done.

1. **Gate and request flow** (first PR): AC-3 to AC-15, with the migration.
2. **Sign-up emails reach strangers.** Supabase's built-in sender only delivers to the project's team, at 2 an hour; with our own sender (Resend) connected, the default is 30 an hour and can be raised ([rate limits](https://supabase.com/docs/guides/auth/rate-limits), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). Check production, connect Resend if needed, and set the limit. Proof: a confirmation email arrives at an address outside the team.
3. **Google sign-in for everyone.** Publish the Google app. Basic sign-in scopes aren't sensitive; `contacts.readonly` is, and an unapproved sensitive scope has a lifetime cap of 100 people ([unverified apps](https://support.google.com/cloud/answer/7454865), [audience](https://support.google.com/cloud/answer/15549945)). Proof: a Google account that isn't a test user signs in.
4. **Home page, sign-in and tour wording** (second PR): AC-1 and AC-2.

Steps 2 and 3 are admin work, done as allensforever711.

### How we see it working, and turn it off (E9, E7)

- **Working:** a logged event for each access request (user id only), and a live check with the QA account with access off, then on.
- **Off:** Supabase's "allow new sign-ups" setting stops new accounts with no deploy. Vercel rollback restores the old pages; the new columns are add-only, so old code ignores them.

### Out of scope

- **The Chrome extension.** Saving to My list keeps working. Someone without access could still add a person and save for them through it, and couldn't see that person on the site. Fixing it needs a store submission, so it's parked.
- An in-app approval screen, or an automatic "you're in" email.
- Enforcing access in the database rules (approach 2).
- Multiple lists, finding people on GiftsAF, and anything else in the freeze's parked list.

## Approaches considered

| Approach | Trade-off | |
|---|---|---|
| **1. Check access on the pages** | Smallest. Someone technical could save people to their own account through the API, but can't spend | **Owner picked, 2026-11-25** |
| 2. Also in the database rules | Airtight, but changes the privacy rules a month before Christmas | Rejected |
| 3. Reuse `paid_features` | Approving someone would let them spend our money, against decision 53 | Rejected |

For what Give shows: the owner picked **A, the pitch with Request access**, over free People (B) and no Give tab (C).

## What was decided, and why

| Question | Answer | Who |
|---|---|---|
| What does Give show without access? | The tab stays; a pitch and one Request access button | Owner |
| Where is access checked? | On the pages | Owner |
| Where do people land? | No access: My list, with Give at `/give`. Access: `/`, as today | Claude's call, shown to the owner |
| Existing accounts? | Keep access | Claude's call, shown to the owner |
| Is access separate from spending? | Yes, `paid_features` stays its own switch | Claude's call, shown to the owner |
| What's stored? | Two fields on `concierge.accounts`: has access, and when they asked. Server-only writes | Claude's call, shown to the owner |
| Are `/rounds` pages gated? | **No. Changed from what the owner was shown**: only someone who had access can have a round, and hiding one could hide a purchase (AC-14) | **[Claude's call]** |
| Extension asks for access? | **No. Changed from what the owner was shown**: parked, it needs a store submission | **[Claude's call]** |
| How is someone let in? | The owner runs one SQL statement (`operations.md`, beside paid features) and replies to the request email, which goes to the person | **[Claude's call]** |
| Signed-out concierge requests? | The waitlist form stays, reworded "Request concierge access"; it emails the owner as today, and stores nothing | **[Claude's call]** |
| What happens to `/request-access`? | It becomes the concierge request page, so old links still work; the "access" kind goes away | **[Claude's call]** |

### Open questions

- **[Verify]** Is production's Supabase email already sent through Resend? (Step 2.)
- **[Verify]** Does publishing the Google app with `contacts.readonly` in the same project show sign-in users a warning or use up the 100 cap? If so, remove that scope and hide import (AC-15).

## Principles check

- **Simplest version?** Cut: approval screen, automatic email, database enforcement, extension change.
- **Hard-coded values?** None. The sign-up email limit is a Supabase setting.
- **Product boundaries?** The check lives in the concierge module and is read through its `index.ts`. My list doesn't depend on it.
- **New personal data?** The request date, needed to show "Request sent" and send one email only. The owner's email carries the person's name and address (as today's form does); logged events carry the user id only.
- **Docs and decisions:** new T# revising T34 and T58 (number taken at merge); a planning decision for open lists; `technical-design.md` (accounts, navigation), `operations.md` (letting someone in, sign-up emails, Google), `strategy.md`, `README.md`, the privacy page, and the freeze exception in `CLAUDE.md`. The roadmap and screens pages, and the database map.
