# ALL-31 Inbound email quick capture: Spec and Plan

**Goal:** you email or forward something to `notes@in.giftsaf.com`, and what it says about someone ends up as AI suggestions on that person's page.

**Links:** [ALL-31](https://linear.app/allens-forever/issue/ALL-31), PRD N-2 and C-5, design §6.8, the email spike (`design/spikes/email.md`), T33 (revised here), T48 (capture extraction), ALL-23 (action links), ALL-94 (paid features), ALL-126 (general "Did you know?" tips).

## Spec: what it does

### Who it's for and what they can do

1. **Forward it:** as a buyer, I forward a store's email or a message about someone to `notes@in.giftsaf.com` from my account email, and it's filed to the right person as AI suggestions, so I don't have to open the app.
2. **Write a quick note:** as a buyer, I email "Dad wants a new fly rod" to the same address, and it lands on Dad's page.
3. **Reply to one of our notes emails:** as a buyer, I reply to the "Did you know?" email about Dad with news ("he's into fly tying now"), and it's filed to Dad without any guessing.
4. **Say who it's about:** when GiftsAF can't tell who a note is about, it emails me back "Who is this about?" with one button per likely person. One tap files it.
5. **Find out it exists:** as a new buyer, the first time I add a person I get a "Did you know?" email inviting me to reply with anything I learn about them, so my first note is just hitting Reply, and from then on `notes@in.giftsaf.com` autocompletes in my mail app (owner, 2026-11-16).

### How it works

- **One easy address for everyone:** `notes@in.giftsaf.com`. The sender identifies the user: mail is accepted only when the From address is a GiftsAF account's email **and** the sender's domain proves it sent it: Resend reports DMARC pass, or a DKIM pass whose signing domain matches the From address's domain. A plain DKIM pass isn't enough, because anyone can sign with their own domain and fake the From. This replaces T33's per-user token address.
- **Reply-To only where a reply is a note:** the "Did you know?" email and the "Who is this about?" email set `notes@in.giftsaf.com` as their Reply-To. **Emails about buying (heads-up, hold, order) don't**, so a reply like "don't buy it" never becomes a note (T18). If a note looks like it's about stopping a gift ("cancel", "don't buy", "skip"), the reply says replies can't cancel a gift and points to the email's button.
- **Receiving:** Resend's `email.received` webhook. The route checks the Svix signature on the raw body, records the `email_id` under a unique index (so a retry that arrives while the first is still running finds nothing to do), answers 200, and does the rest after responding (`after()`). It fetches the plain-text body and attachments from Resend and copies the first image into the private `captures` bucket at once, because Resend's attachment links expire after an hour. The HTML body and other attachments are ignored. Quoted text from earlier in the thread is stripped.
- **Who it's about, without AI:** a reply to one of our notes emails is matched to its person through its `In-Reply-To` header and the notification we sent. Otherwise code looks for the user's people's names in the subject and body. Exactly one match files it; zero or several ask (below). No AI call, and no names go to the AI.
- **Filing:** the message becomes a normal capture for that person: the text as the capture's text, the first image (if any) as its screenshot, and the existing capture reading (T48) runs. AI suggestions show on the person's page as for extension captures, and "Try again" works the same.
- **Unsure:** one "Who is this about?" email with a one-time button for each matching person, or for each of the user's people when nothing matched, up to `inbound_match_max_choices` (5), plus "Someone else" (opens the people page). Tapping a person files the message to them and reads it. The first tap wins: the message moves from asking to filed in one update, and any later tap says it's already filed. A person deleted since then can't be picked. Unfiled messages are cleared when their links expire.
- **Did you know:** one tip email per account, sent the first time they add a person: "Did you know? Reply to this with anything you learn about Dad, like 'wants a new fly rod', and we'll remember it."
- **Paid features:** reading costs money, so only accounts with paid features (ALL-94) get notes read. For anyone else nothing is kept, and they get one reply, once ever, saying notes are read only for test accounts during the alpha.
- **Limits:** at most `inbound_max_per_user_per_day` (20) notes are filed per user per day; more are dropped and logged, so a mail loop can't run up AI spend. `inbound_email_enabled` (1) is the off switch (E7).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A paid-features user with a person "Dad" | They email "Dad wants a new fly rod" from their account email | A capture for Dad is saved and read, and a fly-rod fact shows in Dad's AI suggestions |
| AC-2 | The same user | They forward a store's product email that names Dad, with a product photo attached (JPEG or PNG) | It's filed to Dad, and the photo is the capture's screenshot |
| AC-3 | A note that names two of the user's people, or none | It arrives | No capture is saved, and the user gets one "Who is this about?" email with the right buttons |
| AC-4 | That email | The user taps a person and confirms | The message becomes a capture for that person and is read; tapping that or any other button afterwards says it's already filed and changes nothing |
| AC-5 | A reply to the "Did you know?" email about Dad, quoting it | It arrives | It's filed to Dad with no name search, and the quoted text isn't in the capture |
| AC-6 | Mail from an address that isn't any account's email | It arrives | Nothing is saved, nothing is sent back, and an `inbound.ignored` event with the reason (no address) is logged |
| AC-7 | Mail from an account's email that fails DMARC and has no DKIM signature aligned with the From domain (including one signed by another domain) | It arrives | Ignored and logged, like AC-6 |
| AC-8 | A webhook with a bad or missing signature, or a timestamp over 5 minutes off | It arrives | 401, nothing saved |
| AC-9 | Resend delivers the same `email_id` twice, the second while the first is still being handled | Both arrive | One message, at most one capture, at most one email back |
| AC-10 | A user without paid features | They email two notes | Nothing is stored or read, and they get exactly one reply saying why |
| AC-11 | A user who has had 20 notes filed today | A 21st arrives | It's dropped and logged |
| AC-12 | `inbound_email_enabled` is 0 | Mail arrives | The webhook answers 200 and only logs it |
| AC-13 | Heads-up, hold and order emails | They're sent | None has Reply-To `notes@in.giftsaf.com` |
| AC-14 | A note saying "don't buy it" | It arrives | The reply says replies can't cancel a gift and to use the email's button |
| AC-15 | An account that has never had the tip | They add their first person | One "Did you know?" email is sent, naming that person, with Reply-To `notes@in.giftsaf.com`; adding more people sends no more |

### Out of scope

- **Extra sender addresses:** mail sent from an address other than your account email is dropped. Adding one needs a confirmation email, so a stranger can't claim your address. Follow-up ticket.
- More than one image per message, and non-image attachments such as PDFs.
- Telling a user about mail dropped while the off switch is on.
- A separate dev inbound setup: Resend's free plan has one webhook endpoint, which production gets. Dev testing uses a tunnel for the session, as the spike did.

### What changes in the code and schema

- `concierge.inbound_messages`: add `provider_email_id` (unique), `notification_id` (the email it replied to, if any) and `capture_id`; statuses `received`, `filed`, `asking`, `ignored`; drop `from_address` (the account says who sent it). Subject and body are cleared when filed, and unfiled ones when their links expire.
- `action_links`: add `inbound_message_id` and `person_id`, and a `file_note` action whose `run` gets them.
- Capture saving: a server-side path that sets `user_id` itself (the webhook has no signed-in user), allows no URL and no screenshot, and records the image's real type. Capture reading passes the image's real media type instead of always `image/jpeg`.
- `notifications`: a reply's `In-Reply-To` is looked up against the provider message id we already store.

### Open questions

- **[Verify]** What Resend's `authentication` field reports: whether it includes the DKIM signing domain, so alignment can be checked, or only pass/fail.
- **[Verify]** That `in.giftsaf.com` accepts mail to any local part (`notes@`), not only `+token` addresses.
- **Checked 2026-11-16:** the dev `RESEND_API_KEY` can read received mail (`GET /emails/receiving` returns 200). **[Verify]** the production key the same way.
- **Owner (2026-11-16):** stay on Resend's free plan for now; volume will be low. Revisit the upgrade (about $20 a month) before notes@ is announced widely, since received mail and spam count toward the 100 emails a day.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Token address or one easy address? | **One easy address, matched by sender** (owner, 2026-11-16) | Nobody will copy a token address out of Settings; at that point they'd just use the app. Revises T33. |
| First-use nudge | **A "Did you know?" email to reply to** (owner, 2026-11-16) | The first note is just a reply, then the address autocompletes. General tips: ALL-126 |
| `notes@giftsaf.com` or `notes@in.giftsaf.com`? | `in.giftsaf.com` **[Claude's call]** | Receiving is set up on that subdomain; the main domain stays free for a real mailbox |
| Stopping a forged From | DMARC pass, or DKIM aligned with the From domain **[Claude's call]** | Plain DKIM can be signed by anyone's domain |
| Unknown sender | Drop and log, no reply **[Claude's call]** | Replying to forged addresses sends spam (backscatter) and confirms the address exists |
| Matching a person | Reply threading, then names in code; no AI **[Claude's call]** | Cheaper, testable, and no names to the AI (T48, T42) |
| Reply-To on purchase emails | No **[Claude's call]** | A "don't buy" reply must never become a note (T18) |
| Store as a capture or separately? | A capture, once the person is known **[Claude's call]** | One reading path, one place on the person page (E2) |
| Full-access Resend key in production | Accepted **[Claude's call]** | Reading received mail needs it; recorded in the new T# |

## Principles check

- **Simplest version?** Cut: token addresses, AI matching, extra sender addresses, multi-image and PDF reading, a dev webhook.
- **Hard-coded values?** New settings: `inbound_email_enabled` (1), `inbound_match_max_choices` (5), `inbound_max_per_user_per_day` (20). New env var: `RESEND_WEBHOOK_SECRET`. The text limit reuses `capture_text_max_chars`.
- **Product boundaries?** All in `modules/concierge`.
- **New personal data?** `inbound_messages` holds a note's subject, body and first image only until it's filed or its links expire; the capture holds them after that, as for extension captures. Nothing is kept for unpaid users or ignored mail. Events carry ids and a reason only, never addresses.
- **Docs and decisions:** new T# revising T33; design §6.8; `design/operations.md` (webhook setup, settings, off switch).

## Plan

Written after the spec is approved.
