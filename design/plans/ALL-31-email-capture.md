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

- **One easy address for everyone:** `notes@in.giftsaf.com`. The sender identifies the user: mail is accepted only when the From address is a GiftsAF account's email **and** Resend reports **DMARC pass**, which means the From address's own domain vouched for the message. A plain DKIM pass isn't enough, because anyone can sign with their own domain and fake the From. Resend reports only pass or fail for SPF, DKIM and DMARC (checked 2026-11-16), so DMARC is the check. A domain with no DMARC record is dropped; Gmail, Outlook and iCloud all publish one. This replaces T33's per-user token address.
- **Reply-To only where a reply is a note:** only the "Did you know?" email sets `notes@in.giftsaf.com` as its Reply-To. The "Who is this about?" email doesn't: its buttons are the answer, and a reply to it would start a mail loop. **[Claude's call]** **Emails about buying (heads-up, hold, order) don't**, so a reply like "don't buy it" never becomes a note (T18). If a note looks like it's about stopping a gift ("cancel", "don't buy", "skip"), it's still filed (a note like "don't buy him socks anymore" is worth keeping), and the confirmation says replies can't cancel a gift and points to the email's button. **[Claude's call]**
- **Receiving:** Resend's `email.received` webhook. The route checks the Svix signature on the raw body, records the `email_id` under a unique index (so a retry that arrives while the first is still running finds nothing to do), answers 200, and does the rest after responding (`after()`). It fetches the plain-text body and attachments from Resend and copies the first image into the private `captures` bucket at once, because Resend's attachment links expire after an hour. The HTML body and other attachments are ignored. Quoted text from earlier in the thread is stripped.
- **Who it's about, without AI:** a reply to one of our notes emails is matched to its person through its `In-Reply-To` header and the notification we sent. Otherwise code looks for the user's people's names, as capitalised whole words, in the subject and body (so "will" or "grace" in a sentence don't count). Exactly one match files it; zero or several ask (below). No AI call, and no names go to the AI.
- **Filing:** the message becomes a normal capture for that person: the text as the capture's text, the first image (if any) as its screenshot, and the existing capture reading (T48) runs. AI suggestions show on the person's page as for extension captures, and "Try again" works the same.
- **Unsure:** one "Who is this about?" email with a one-time button for each matching person, or for each of the user's people when nothing matched, up to `inbound_match_max_choices` (5), plus "Someone else" (opens the people page). Tapping a person files the message to them and reads it. The first tap wins: the message moves from asking to filed in one update, and any later tap says it's already filed. A person deleted since then can't be picked. Unfiled messages are cleared when their links expire.
- **Did you know:** one tip email per account, sent the first time they add a person: "Did you know? Reply to this with anything you learn about Dad, like 'wants a new fly rod', and we'll remember it."
- **Paid features:** reading costs money, so only accounts with paid features (ALL-94) get notes read. For anyone else nothing is kept, and they get one reply, once ever, saying notes are read only for test accounts during the alpha.
- **Limits:** at most `inbound_max_per_user_per_day` (20) messages are accepted per user per day, counting every message and every email we send back; more are dropped and logged, so a mail loop can't run up AI spend or use up the daily email quota. Auto-replies (headers `Auto-Submitted` other than `no`, or `Precedence: bulk`/`auto_reply`) are dropped. `inbound_email_enabled` (1) is the off switch (E7).

### Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A paid-features user with a person "Dad" | They email "Dad wants a new fly rod" from their account email | A capture for Dad is saved and read, and a fly-rod fact shows in Dad's AI suggestions |
| AC-2 | The same user | They forward a store's product email that names Dad, with a product photo attached (JPEG or PNG) | It's filed to Dad, and the photo is the capture's screenshot |
| AC-3 | A note that names two of the user's people, or none | It arrives | No capture is saved, and the user gets one "Who is this about?" email with the right buttons |
| AC-4 | That email | The user taps a person and confirms | The message becomes a capture for that person and is read; tapping that or any other button afterwards says it's already filed and changes nothing |
| AC-5 | A reply to the "Did you know?" email about Dad, quoting it | It arrives | It's filed to Dad with no name search, and the quoted text isn't in the capture |
| AC-6 | Mail from an address that isn't any account's email | It arrives | Nothing is saved, nothing is sent back, and an `inbound.ignored` event with the reason (no address) is logged |
| AC-7 | Mail from an account's email whose DMARC result isn't pass (even with DKIM and SPF passing) | It arrives | Ignored and logged, like AC-6 |
| AC-8 | A webhook with a bad or missing signature, or a timestamp over 5 minutes off | It arrives | 401, nothing saved |
| AC-9 | Resend delivers the same `email_id` twice, the second while the first is still being handled | Both arrive | One message, at most one capture, at most one email back |
| AC-10 | A user without paid features | They email two notes | Nothing is stored or read, and they get exactly one reply saying why |
| AC-11 | A user who has had 20 messages accepted today, or an out-of-office auto-reply | The next one arrives | It's dropped and logged, and nothing is sent back |
| AC-12 | `inbound_email_enabled` is 0 | Mail arrives | The webhook answers 200 and only logs it |
| AC-13 | Heads-up, hold and order emails | They're sent | None has Reply-To `notes@in.giftsaf.com` |
| AC-14 | A note saying "don't buy him socks anymore" | It arrives | It's filed, and the user gets one email saying replies can't cancel a gift and to use the email's button |
| AC-15 | An account that has never had the tip | They add their first person | One "Did you know?" email is sent, naming that person, with Reply-To `notes@in.giftsaf.com`; adding more people sends no more |

### Out of scope

- **Extra sender addresses:** mail sent from an address other than your account email is dropped. Adding one needs a confirmation email, so a stranger can't claim your address. Follow-up ticket.
- More than one image per message, and non-image attachments such as PDFs.
- Telling a user about mail dropped while the off switch is on.
- A separate dev inbound setup: Resend's free plan has one webhook endpoint, which production gets. Dev testing uses a tunnel for the session, as the spike did.

### What changes in the code and schema

- `concierge.inbound_messages` stores only messages waiting on "Who is this about?" (`asking`, then `filed`); add `notification_id`, `capture_id`, `image_path`, `image_type`; drop `from_address`. Dedupe is a separate `inbound_seen` table with no personal data. Subject and body are cleared when filed, and unfiled ones when their links expire.
- `action_links`: add `inbound_message_id` and `person_id`, and a `file_note` action whose `run` gets them.
- Capture saving: a server-side path that sets `user_id` itself (the webhook has no signed-in user), allows no URL and no screenshot, and records the image's real type. Capture reading passes the image's real media type instead of always `image/jpeg`.
- `notifications`: a reply's `In-Reply-To` is looked up against the provider message id we already store.

### Open questions

- **Checked 2026-11-16:** Resend's received email has `authentication: { spf, dkim, dmarc }` as pass/fail strings, plus `message_id` and the raw `headers`.
- **[Verify]** That `in.giftsaf.com` accepts mail to any local part (`notes@`), not only `+token` addresses.
- **Checked 2026-11-16:** the dev `RESEND_API_KEY` can read received mail (`GET /emails/receiving` returns 200). **[Verify]** the production key the same way.
- **Owner (2026-11-16):** stay on Resend's free plan for now; volume will be low. Revisit the upgrade (about $20 a month) before notes@ is announced widely, since received mail and spam count toward the 100 emails a day.

## What was decided, and why

| Question | Answer | Why |
|---|---|---|
| Token address or one easy address? | **One easy address, matched by sender** (owner, 2026-11-16) | Nobody will copy a token address out of Settings; at that point they'd just use the app. Revises T33. |
| First-use nudge | **A "Did you know?" email to reply to** (owner, 2026-11-16) | The first note is just a reply, then the address autocompletes. General tips: ALL-126 |
| `notes@giftsaf.com` or `notes@in.giftsaf.com`? | `in.giftsaf.com` **[Claude's call]** | Receiving is set up on that subdomain; the main domain stays free for a real mailbox |
| Stopping a forged From | DMARC pass **[Claude's call]** | Plain DKIM can be signed by anyone's domain, and Resend gives no signing domain to check alignment |
| Unknown sender | Drop and log, no reply **[Claude's call]** | Replying to forged addresses sends spam (backscatter) and confirms the address exists |
| Matching a person | Reply threading, then names in code; no AI **[Claude's call]** | Cheaper, testable, and no names to the AI (T48, T42) |
| Reply-To on purchase emails | No **[Claude's call]** | A "don't buy" reply must never be taken as a note instead of a cancel (T18) |
| Reply-To on "Who is this about?" | No **[Claude's call]** | The buttons answer it; a reply-able ask can loop with auto-replies |
| "Don't buy" notes | Filed, plus a hint email **[Claude's call]** | Often a real preference worth keeping |
| Store as a capture or separately? | A capture, once the person is known **[Claude's call]** | One reading path, one place on the person page (E2) |
| Full-access Resend key in production | Accepted **[Claude's call]** | Reading received mail needs it; recorded in the new T# |

## Principles check

- **Simplest version?** Cut: token addresses, AI matching, extra sender addresses, multi-image and PDF reading, a dev webhook.
- **Hard-coded values?** New settings: `inbound_email_enabled` (1), `inbound_match_max_choices` (5), `inbound_max_per_user_per_day` (20), `inbound_link_hours` (72, how long "Who is this about?" buttons work). New env var: `RESEND_WEBHOOK_SECRET`. The text limit reuses `capture_text_max_chars`.
- **Product boundaries?** All in `modules/concierge`.
- **New personal data?** `inbound_messages` holds a note's subject, body and first image only until it's filed or its links expire; the capture holds them after that, as for extension captures. Nothing is kept for unpaid users or ignored mail. Events carry ids and a reason only, never addresses.
- **Docs and decisions:** new T# revising T33; design §6.8; `design/operations.md` (webhook setup, settings, off switch).

## Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture:** a new `modules/concierge/inbound/` holds pure parsing and matching (`parse.ts`), the orchestration (`handle.ts`, behind an `InboundStore` interface like `CaptureStore`) and its Supabase store. A public route `app/api/inbound/resend/route.ts` verifies the Svix signature, claims the `email_id`, answers 200 and runs `handleInbound` in `after()`. Filing reuses the capture path (a service-role `CaptureStore` for the message's user, then `processCapture`). Emails go through `notify()` with new templates; a `file_note` action link files an asking message.

**Tech stack:** Next.js route + `after()`, Supabase migration and pgTAP, Resend REST (no SDK, like `lib/resend.ts`), Vitest.

**Global constraints:** settings `inbound_email_enabled` (1), `inbound_match_max_choices` (5), `inbound_max_per_user_per_day` (20), `inbound_link_hours` (72) read with `setting_int`, never defaulted in code (T23). Address `notes@in.giftsaf.com` comes from env `INBOUND_NOTES_ADDRESS`. Events through `logEvent`, ids and reasons only (E6). Svix tolerance 5 minutes.

### File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261116100000_inbound_notes.sql` | Schema and settings changes below |
| `supabase/tests/inbound_notes.test.sql` | Unique `provider_email_id`, one-time flags, settings rows, RLS |
| `apps/web/modules/concierge/inbound/parse.ts` | `senderVerified`, `stripQuoted`, `matchPeople`, `looksLikeCancel`, `firstImage` |
| `apps/web/lib/resend-inbound.ts` | `verifySvix`, `fetchReceivedEmail`, `fetchAttachment` |
| `apps/web/modules/concierge/inbound/store.ts`, `supabase-store.ts` | `InboundStore` interface and its service-role version |
| `apps/web/modules/concierge/inbound/handle.ts` | `handleInbound` and `fileNote` |
| `apps/web/app/api/inbound/resend/route.ts` | The webhook |
| `apps/web/modules/concierge/capture/capture.ts`, `extract.ts`, `supabase-store.ts` | `saveNoteCapture`, real image type, `serviceCaptureStore(userId)` |
| `apps/web/modules/concierge/notify/templates.ts`, `actions.ts`, `notify.ts`, `channels.ts` | Four templates, `file_note`, `messageId` header |
| `apps/web/modules/concierge/people/…` (createPerson caller) | Send the tip once |
| `apps/web/modules/concierge/rounds/engine.ts` tick | Clear expired asking messages |

### Task 1: Schema and settings (AC-4, AC-5, AC-9, AC-10, AC-11, AC-12, AC-15)

- [ ] Write `supabase/tests/inbound_notes.test.sql`: a second `inbound_seen` insert of the same id does nothing; the four settings rows exist with the values above; `accounts` flags default null; `claim_inbound_flag` returns true once then false, and creates the `accounts` row when missing; `file_inbound_message` files once (second call false), refuses a deleted person, and inserts the capture with the stored image path; `authenticated` can't execute either function; another user can't select a message (RLS).
- [ ] Run it inside one rolled-back transaction in the `supabase_db_gift-me` container; expect failures.
- [ ] Write the migration:
  - `concierge.inbound_seen (provider_email_id text primary key, created_at timestamptz default now())`, no personal data, service role only. The tick prunes rows older than 7 days (Task 10).
  - `inbound_messages`: add `notification_id`, `capture_id` (`on delete set null`), `image_path`, `image_type`; drop `from_address` and `attachments`; status check `in ('asking','filed')` (only asking messages are stored).
  - `notifications`: add `person_id uuid` with FK `(person_id, user_id)` to `public.people` `on delete set null (person_id)`, and `message_id text unique` (the `Message-ID` header we set). `provider_message_id` keeps meaning Resend's id.
  - `action_links`: add `inbound_message_id uuid references concierge.inbound_messages on delete cascade` and `person_id uuid` with FK `(person_id, user_id)` to `public.people` `on delete cascade`.
  - `captures`: add `screenshot_type text` (null means `image/jpeg`, as today).
  - `accounts`: add `notes_tip_sent_at`, `notes_unpaid_reply_sent_at` (timestamptz).
  - `concierge.claim_inbound_flag(p_user_id uuid, p_flag text) returns boolean`: insert the accounts row on conflict, set the flag only when null, true when it changed. Service role only.
  - `concierge.inbound_count_today(p_user_id uuid) returns int`: messages accepted plus emails sent back today (from `inbound_events`, below). Simplest store: a `concierge.inbound_events (user_id, created_at)` row per accepted message and per reply sent.
  - `concierge.file_inbound_message(p_user_id uuid, p_message_id uuid, p_person_id uuid) returns uuid`: in one statement-set, marks the message filed only when it's `asking`, belongs to the user and the person is live, inserts the capture (text, subject as title, image path and type), sets `capture_id`, clears subject and body. Returns the capture id, or null when already filed or refused. Service role only.
  - `app_settings` rows with descriptions.
- [ ] `pnpm supabase db reset` locally, run the test (pass), `pnpm db:types`.
- [ ] Commit `feat(db): inbound notes schema and settings (ALL-31)`.

### Task 2: Parsing and matching (AC-3, AC-5, AC-7, AC-14) [P]

**Produces:** in `inbound/parse.ts`:
`senderVerified(auth: { spf: string; dkim: string; dmarc: string }): boolean` (true only for `dmarc === "pass"`); `isAutoReply(headers: Record<string, string>): boolean`; `stripQuoted(text: string): string`; `matchPeople(subject: string, body: string, people: {id: string; name: string}[]): string[]`; `looksLikeCancel(text: string): boolean`; `firstImage(atts: {id: string; content_type: string; size: number}[]): {id: string; content_type: string} | null` (types `image/jpeg`, `image/png`, `image/webp`, `image/gif` only).

- [ ] Tests in `modules/concierge/__tests__/inbound-parse.test.ts`:
  - `senderVerified`: `dmarc: "pass"` → true; `dkim: "pass", spf: "pass", dmarc: "fail"` → false; `dmarc: "none"` → false; missing field → false.
  - `stripQuoted`: drops lines starting `>` and everything from a line matching `On … wrote:`; keeps a forwarded message's content (Gmail's `---------- Forwarded message ----------` and what follows stay).
  - `isAutoReply`: `Auto-Submitted: auto-replied` → true; `Auto-Submitted: no` → false; `Precedence: bulk` → true; none → false.
  - `matchPeople`: whole-word and capitalised, on first name and full name; "Dad wants a fly rod" with people `[{name:"Dad"}]` → that id; "Jenn" doesn't match "Jennifer"; "we will see" doesn't match "Will"; two names → both ids; none → `[]`.
  - `looksLikeCancel`: "don't buy it", "please cancel", "skip this one" → true; "a fly rod" → false.
  - `firstImage`: skips PDFs and images over the capture limit (passed in).
- [ ] Run, fail; implement; run, pass; commit `feat: parse and match inbound notes (ALL-31)`.

### Task 3: Resend inbound client (AC-8) [P]

**Produces:** in `lib/resend-inbound.ts`: `verifySvix(raw: string, headers: Headers, secret: string, now: Date): boolean`; `fetchReceivedEmail(id, deps): Promise<{ from: string; subject: string; text: string; inReplyTo: string | null; headers: Record<string, string>; authentication: { spf: string; dkim: string; dmarc: string }; attachments: { id: string; content_type: string; size: number }[] }>`; `fetchAttachment(emailId, attId, deps): Promise<{ bytes: Uint8Array; contentType: string }>`. Deps `{ apiKey, fetch }`.

- [ ] Tests: a signature built from a known `whsec_` secret verifies; a changed body, a wrong secret, a missing header, and a timestamp 301 s off each fail. Fetch functions hit the right URLs with the bearer key (fake fetch) and map fields; `from` is lower-cased and stripped to the bare address.
- [ ] Run, fail; implement (Node `crypto` HMAC-SHA256 over `id.timestamp.raw` with the base64-decoded part of `whsec_…` as the key, constant-time compare, any of the space-separated `v1,` signatures); pass; commit.

### Task 4: Capture saving for notes (AC-1, AC-2)

**Consumes:** `CaptureStore`, `captureStoreFor`. **Produces:** every query in `captureStoreFor` also filters `.eq("user_id", userId)` (so the same store is safe with the service-role client); `saveNoteCapture(store, { personId, title, text, image: { bytes: Uint8Array; type: string } | null }): Promise<SaveResult>`; `processCapture` passes the capture's stored image type to the extractor.

- [ ] Tests: `saveNoteCapture` with no image saves a capture with null URL and no screenshot; with a PNG it uploads to `{userId}/{id}.png` and records `screenshot_type`; text is cut to `capture_text_max_chars`. `processCapture` sends `image/png` for a PNG capture. Local-db test (`pnpm test:db`): `captureStoreFor(serviceClient, userA)` can't load user B's capture or find user B's person.
- [ ] Implement; make `url` nullable in `NewCaptureRow`; pass; commit.

### Task 5: The handler (AC-1 to AC-3, AC-5 to AC-7, AC-9 to AC-12, AC-14)

**Consumes:** Tasks 2–4. **Produces:** `handleInbound(emailId: string, deps: InboundDeps): Promise<InboundOutcome>` where `InboundOutcome` is `"filed" | "asking" | "ignored" | "unpaid" | "capped" | "cancel_reply" | "disabled"`. `InboundStore` methods: `enabled()`, `userByEmail(email)`, `hasPaidFeatures(userId)`, `countToday(userId)`, `recordEvent(userId)`, `people(userId)`, `personForMessageId(userId, messageId)`, `saveAsking(row): Promise<string>`, `uploadImage(path, bytes, type)`, `claimFlag(userId, "notes_unpaid_reply_sent_at")`, `settings(): { maxChoices; maxPerDay; linkHours }`.

Order (first match decides): disabled → log, return. Fetch email. `isAutoReply` → ignored (`auto_reply`). Sender not an account, or `senderVerified` false → `inbound.ignored` with `reason` (`unknown_sender` / `unverified`), return. Capped (`countToday >= maxPerDay`) → ignored (`capped`). Unpaid → if `claimFlag` send `notes_not_read`; nothing stored. `recordEvent`. Person from `In-Reply-To` → file. Else `matchPeople` one → file; else `saveAsking` with the image copied to storage, send `who_is_this` with up to `maxChoices` `file_note` links (lifetime `linkHours`). After filing, `looksLikeCancel` → also send `notes_cant_cancel`. Every email sent back calls `recordEvent`.

- [ ] Tests with a fake store and fake fetch, one per outcome above, plus: an `In-Reply-To` match skips name search; quoted text never reaches the capture; the unpaid reply is sent once across two notes; a loop of 25 auto-reply-free messages sends at most 20 things back.
- [ ] Local-db tests for the Supabase `InboundStore` (E5): `userByEmail` matches `Dad@Gmail.com` to the account `dad@gmail.com` and nothing else; `countToday` and `recordEvent`; `personForMessageId` only within the user; `claimFlag` once.
- [ ] Implement; pass; commit.

### Task 6: The webhook route (AC-8, AC-9, AC-12)

- [ ] Tests in `app/api/inbound/resend/__tests__/route.test.ts`: bad signature → 401 and no claim; good → 200 and `handleInbound` scheduled via `after()` with the `email_id`; a non-`email.received` event → 200, nothing; the same `email_id` twice → the second `inbound_seen` insert (`on conflict do nothing`) returns no row and nothing is scheduled; an error inside the `after()` work is logged as `inbound.failed` with `errorFields`. Add `/api/inbound/resend` to `isPublicPath` with a test.
- [ ] Implement; `maxDuration = 60`; env `RESEND_WEBHOOK_SECRET`, `RESEND_API_KEY`, `INBOUND_NOTES_ADDRESS`; pass; commit.

### Task 7: Emails (AC-3, AC-10, AC-13, AC-14, AC-15)

**Produces:** templates `notes_tip { personName }`, `who_is_this { subject, choices: { name: string }[] }` with links `{ [i]: file_note }` plus a static "Someone else" link to `/people`, `notes_not_read`, `notes_cant_cancel`. `NotifyInput` gains `personId?` (saved on the notification row) and `threadable?: true`, which makes `notify` set header `Message-ID: <n-{notificationId}@in.giftsaf.com>` and save it in `notifications.message_id`. `Channel.send` accepts `headers`.

- [ ] Tests: each template renders through `renderEmail` with the real shell and the copy from the spec; only `notes_tip` carries `replyTo`; a test over every purchase kind (`heads_up`, `hold_*`, `ordered`, `failed_*`, `price_up`, `out_of_stock`, `too_late`, `missed_on_us`) asserts the engine never passes `replyTo` (AC-13).
- [ ] **[Verify]** Resend accepts a custom `Message-ID` header (send one to the owner's Gmail from dev and read the header back); if not, read the header Resend set from its API and save that.
- [ ] Implement; add the four to the `/dev/emails` gallery list; pass; commit.

### Task 8: "Who is this about?" buttons (AC-4)

**Produces:** `LinkSpec`, `NewLink` and `LinkRow` gain `personId?` and `inboundMessageId?`; `findLink`/`claimLink` return them; `Action.run` ctx and `next` get them. Action `file_note`: confirm text "File this note to {name}?" — the confirm page gets the person's name from the link's person (add `confirmFor?(link, store)` to `Action`, used by `readActionLink` when present). `run` calls `file_inbound_message`; null → done page "Already filed"; a capture id → `processCapture` (its failure leaves the capture pending for "Try again"); `next` = `/people/{personId}`.

- [ ] Tests: the confirm page names the person; first confirm files and reads; confirming another button afterwards shows "Already filed" and creates nothing; a person deleted after the email can't be picked; a failed read still leaves the capture filed.
- [ ] Implement; pass; commit.

### Task 9: The tip on the first person (AC-15)

- [ ] Test: creating the first person, by hand or through the contacts import, sends one `notes_tip` naming them (a new user with no `accounts` row included); a second person sends nothing; a failed send doesn't fail adding the person (logged).
- [ ] Implement `sendNotesTipOnce(userId, person)`: `claim_inbound_flag(userId, 'notes_tip_sent_at')` with the service-role client; when true, `notify` the tip with `personId` and `threadable`. Call it in `after()` from the add-person action and from `importPeople`. Pass; commit.

### Task 10: Clearing unfiled notes

- [ ] Test: the daily tick clears subject, body and image of `asking` messages whose `file_note` links have all expired, and deletes the stored image; it leaves younger ones.
- [ ] Implement as a step in the existing tick (no new scheduled job, E1), which also prunes `inbound_seen` and `inbound_events` rows older than 7 days; its failure is logged and doesn't stop the tick. Pass; commit.

### Task 11: Docs and setup

- [ ] `design/decisions.md`: new T# (fetch `origin/main` first for the number) revising T33: one address, sender plus DMARC/aligned DKIM, no AI matching, Reply-To only on notes emails, full-access Resend key accepted.
- [ ] `design/technical-design.md` §6.8 and §7's table (drop "Inbound note matching" as an AI task).
- [ ] `design/operations.md`: the webhook (Resend → Webhooks → `https://giftsaf.com/api/inbound/resend`, event `email.received`, secret into Vercel `RESEND_WEBHOOK_SECRET`), the env vars, the three settings, the off switch, dev testing through a tunnel.
- [ ] `pnpm gallery` and republish the screens and emails page.
- [ ] Commit `docs: …` with the code PR (it's one change).

## Before coding: consistency check

- [x] Every acceptance criterion maps to a task: AC-1/2 (4, 5), AC-3 (2, 5, 7), AC-4 (8), AC-5 (2, 5, 9), AC-6/7 (2, 5), AC-8 (3, 6), AC-9 (1, 6), AC-10 (5, 7), AC-11/12 (1, 5), AC-13/14 (7, 5), AC-15 (7, 9).
- [x] Every task traces back to a story or criterion; Task 10 to the spec's "cleared when links expire".
- [ ] No open questions left: one [Verify] (custom Message-ID) is a step of Task 7.
- [ ] Adversarial review of the plan.

## Review focus

- **A note from an account email the user also sends from a phone carrier or work relay** that rewrites DKIM: dropped silently. Task 2's alignment tests pin the rule; the live check sends from Gmail and from the owner's phone.
- **A forward whose original sender is someone else** ("From: amazon"): the outer From is the user, which is what's checked. Task 5 test with a forward fixture.
- **A note naming a person by nickname** ("Mom" for a person saved as "Linda", relationship mother): no match → asks. Acceptable; the asking email lists all people when nothing matched (Task 5 test).
- **A huge or many-image email:** only the first image under the size cap is copied; text cut to the capture limit (Tasks 2, 4).
- **An out-of-office reply or a mail loop:** dropped as an auto-reply, and capped at 20 a day either way (Task 5 test).
- **The webhook firing before the deploy has the secret:** missing `RESEND_WEBHOOK_SECRET` → 500 and a `inbound.misconfigured` event, never accepting unsigned mail (Task 6 test).
