# ALL-179 Open list sign-up, and the concierge by request: Spec

**Status:** draft, not approved. No plan and no code until the owner approves this spec.

**Goal:** anyone can sign up at giftsaf.com, build a wish list and share it, free; the concierge (Give) is something they request and we approve.

**Links:** [ALL-179](https://linear.app/allens-forever/issue/ALL-179). Revises T34 (invite only), T30 and T58 (everyone lands on Give at `/`), T37 and the ALL-71 waitlist, T43 (a signed-in request has no Turnstile), T45 (import off for now), T69's reason, T78 (the shared-list card) and planning 57's caps. Keeps planning decision 53 (what costs money is off unless `paid_features` is on) and D59 (friends use the concierge once card payments ship).

**Scope freeze:** built as the owner's exception (2026-11-25).

## Spec: what it does

### Why

The owner's family is asking for Christmas ideas now. Building and sharing a list charges them nothing (our own cost is Amazon lookups, at most $2 a day), so there is no reason to keep it invite only. Success: a relative with no help from us signs up, makes a list and texts the link, well before Christmas.

**Would make it a failure even if it works:** a stranger can spend more of our money than the Amazon lookup cap; someone who already uses the concierge loses it; a relative signs up and never gets the confirmation email.

### Who it's for and what they can do

1. **Start a list:** as a relative, I can sign up with Google or email and land on My list, so I can share it for Christmas.
2. **Ask for the concierge:** as a signed-in list user, I can open Give, see what the concierge does, and ask for access in one tap.
3. **Let someone in:** as the owner, I get an email for each request and can give that account access.
4. **Nothing changes for those already in:** as someone with access, Give is as it is today.

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | signed out | they open the home page | the list half's main button is "Start your list, free", which goes to sign-up; the bar says "Sign in", not "Invite only"; the concierge half offers "Request concierge access" |
| AC-2 | signed out | they open sign-in, sign-up, the list tour's end, or a shared list | nothing says invite only for lists, and the way in is sign-up. From a shared list, sign-in and sign-up both bring them back to that list |
| AC-3 | a new account, no access | they sign in with no other page asked for, or open `/` | they land on My list. With email, tapping the confirmation link on a phone leaves them signed in on My list; a password reset also ends signed in |
| AC-4 | signed in | they tap Give | the tab always opens `/give`, whoever they are, so My list never reads the concierge. Without access it shows the pitch, "Request access" and the tour link |
| AC-5 | signed in, no access | they open `/people` pages or the concierge settings pages by address | they see the pitch, and none of those pages' content |
| AC-6 | signed in, no access | they tap Request access | the date is claimed, the owner is emailed their name and account email (line breaks stripped), and they're emailed "we got it"; the page says "Request sent". A second tap or reload sends nothing. If the owner's email fails, the claim is cleared and they can try again. If the process dies between claim and send, it shows as sent and the owner sees the date in the database (accepted) |
| AC-7 | signed in, no access | they open Settings | Name, time zone and My address show; Reminders, Gift ideas and Paying for gifts don't |
| AC-8 | signed in, no access | they open someone's shared list | claiming works as today; the card about their people (add, pick, linked) isn't shown |
| AC-9 | an account with access | they use the app | `/give` shows People; `/` shows it too; person pages, rounds, settings and the shared-list card work as today (existing browser journeys pass) |
| AC-10 | any account that exists when this ships, including one with no `concierge.accounts` row | the migration runs | it has access. A row is inserted where there was none. New accounts don't have it |
| AC-11 | an account | it calls the database as itself | it can read its own access flag and request date, and can't change either, or see anyone else's |
| AC-12 | access is on, `paid_features` off | they use anything that costs money | still refused, except Amazon lookups (planning 57), which any signed-in account may make: 10 a person and 200 in all a day |
| AC-13 | the access check itself fails | the page loads | an error with a way to retry, never the concierge and never a false "request access" |
| AC-14 | an account with paid features, an open round or a saved Zinc key | the owner runs the statement that turns access off | it refuses, so nobody loses the pages they need to finish a purchase. Turning access off clears the request date, so they can ask again |
| AC-15 | `google_import_enabled` is 0, as shipped | anyone opens Import or Give | import isn't offered, and Import says to add people by hand. At 1 it works as today |
| AC-16 | signed in, no access | they call the test-email action directly | it refuses and sends nothing |
| AC-17 | any link that says Give or "your people" (settings, extension connect, rounds, reactions, emails) | someone follows it | it goes to `/give`. The logo and the home-screen app open `/` |

### Getting it live, in order

Nothing on the public pages opens until steps 1 to 4 are done.

1. **Database change** (first PR): the two fields, the backfill, the settings and lookup caps. Alone, because Vercel deploys alongside the migration, and code arriving first would break Give.
2. **Gate and request flow** (second PR): AC-3 to AC-17.
3. **Sign-up emails reach strangers.** Supabase's built-in sender only delivers to the project's team ([SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [rate limits](https://supabase.com/docs/guides/auth/rate-limits)). Connect Resend if production doesn't use it, require email confirmation, and set the limit to **3 an hour**. We stay on Resend's free plan (owner), which allows 100 emails a day, sent and received together (`spikes/email.md`): 3 an hour is at most 72 a day, leaving 28 for everything else. Google sign-up sends no email, and stays the first button. Proof: AC-3 on a phone, at an address outside the team.
4. **Google sign-in for everyone.** Publish the Google app. Proof: a Google account that isn't a test user signs in with no warning, with import off.
5. **Home page, sign-in and tour wording** (third PR): AC-1 and AC-2.

Steps 3 and 4 are admin work, done as allensforever711.

**Accepted risk (no paid Resend plan yet, owner, 2026-11-25):** a busy day can still use up the 100, and purchase emails would fail along with sign-ups. A burst of family email sign-ups can hit the 3 an hour and be told to try later. Watch Resend's daily count after opening.

### Google Contacts import: approval, alongside

Import ships off, and the approval starts now so it can come back (owner). Nothing above waits on it. Google asks for ([requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)):

| Needed | State |
|---|---|
| App published | Step 4; Google's "Prepare for verification" comes after it |
| Verified domain, home page | `giftsaf.com` is an authorized domain. **[Verify]** it's verified in Search Console as allensforever711 |
| Privacy page covering contacts | Missing: it says nothing about Google Contacts. Add: read in the browser, only ticked contacts saved, access revoked straight away (T45) |
| Why `contacts.readonly`, and nothing narrower | To draft |
| Unlisted YouTube video of the whole import, showing Google's consent screen and our client ID | The owner records it before import is turned off |

Google says review usually takes 3 to 5 business days. **[Verify]** that a pending review shows no warning to people only signing in.

### How we see it working, and turn it off (E9, E7)

- **Working:** a logged event for each access request (user id only), and a live check with the QA account with access off, then on.
- **Off:** Supabase's "allow new sign-ups" stops new accounts; `amazon_paste_lookup_enabled` = 0 stops lookups; `google_import_enabled` stops import. None needs a deploy.
- **After a Vercel rollback:** every account sees Give again, as today. They still can't spend beyond the lookup cap. Turn off new sign-ups first.

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
| Where do people land? | No access: My list. Access: People. The Give tab is `/give` for everyone | Claude's call, shown to the owner |
| Existing accounts? | Keep access | Claude's call, shown to the owner |
| Is access separate from spending? | Yes, `paid_features` stays its own switch | Claude's call, shown to the owner |
| What's stored? | Two fields on `concierge.accounts`: has access, and when they asked. Server-only writes | Claude's call, shown to the owner |
| Are `/rounds` pages gated? | **No. Changed from what the owner was first shown**: only someone with access can have a round, and hiding one could hide a purchase | **[Claude's call]** |
| Amazon lookups | 10 a person, 200 in all a day | Owner |
| Paid Resend plan | No, stay on free; sign-up mail capped at 3 an hour (the number is Claude's call) | Owner |
| Google import | Off for everyone for now, and start Google's approval | Owner |
| "We got it" email | Yes | Owner |
| Extension asks for access? | **No. Changed from what the owner was shown**: parked, it needs a store submission | **[Claude's call]** |
| How is someone let in? | The owner runs one SQL statement (`operations.md`, beside paid features) and replies to the request email, which goes to the person | **[Claude's call]** |
| Signed-out concierge requests? | The waitlist form stays, reworded "Request concierge access"; it emails the owner as today, and stores nothing | **[Claude's call]** |
| What happens to `/request-access`? | It becomes the concierge request page, so old links still work; the "access" kind goes away | **[Claude's call]** |

### Open questions

Facts to check during the admin steps. The first doesn't change the code.

- **[Verify]** Production's Supabase email sender and confirmation setting (step 3).
- **[Verify]** Plain sign-in shows no warning while `contacts.readonly` is unapproved (step 4). If it does, take the scope off the consent screen until approval.

## Principles check

- **Simplest version?** Cut: approval screen, automatic email, database enforcement, extension change.
- **Hard-coded values?** New setting `google_import_enabled`; changed `amazon_paste_lookups_per_user_per_day` and `amazon_paste_lookups_per_day_total`. The sign-up email limit is a Supabase setting.
- **Product boundaries?** The check lives in the concierge module and is read through its `index.ts`. My list doesn't depend on it.
- **New personal data?** The request date, needed to show "Request sent" and send one email only. The owner's email carries the person's name and address (as today's form does); logged events carry the user id only.
- **Docs and decisions:** new T# revising T34 and T58 (number taken at merge); a planning decision for open lists; `technical-design.md` (accounts, navigation), `operations.md` (letting someone in, sign-up emails, Google), `strategy.md`, `README.md`, the privacy page, and the freeze exception in `CLAUDE.md`. The roadmap and screens pages, and the database map.
