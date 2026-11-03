# Gift Concierge: Technical Design (MVP)

| | |
|---|---|
| **Status** | **Approved** v1.0 (2026-10-17). Revised v1.1 (2026-10-18) after the owner's review: Supabase `pg_cron` runs gift rounds once a day (T8, T9), a lean repo layout (T10), a replaceable AI backend billed through Vercel (T11), push deferred (T12), email capture kept (T13), round statuses cut from 11 to 9 (T14), and a new §3.1 on how the app learns about a person. Revised v1.2 (2026-10-25) with the checkout spike's findings (W1-2, `spikes/checkout.md`): funding in stages (T16), one app-owned Zinc account for product lookups (T17), and approval means buy now (T18). Also 2026-10-25: the platform is one app, account and repo, built to split later (§2.2, T19). Revised 2026-10-28 for schema v1.1 (ALL-44, T31): optional budgets, your own address, where an order ships, and picks from a person's own list. Revised 2026-11-01 with the email spike's findings (W1-4, `spikes/email.md`): Resend on `giftsaf.com`, per-user capture addresses (T33). Tunable values (buffers, timings, retries) are sensible defaults to adjust once real usage shows what's needed. |
| **Date** | 2026-10-28 |
| **Implements** | `../planning/PRD.md` (approved v1.0). Requirement IDs (B-3, A-9, etc.) refer to it. |
| **Decisions** | `decisions.md` (T#), `../planning/decisions.md` (D#) |
| **Next stage** | Split into Linear tickets, labeled by wave (§13) |

Items marked **[Claude's call]** are proposals the owner hasn't confirmed yet. **[Verify]** marks a fact to confirm during the named ticket before building on it.

---

## 1. Principles

1. **Keep it simple.** Build only what the PRD marks **M**. Pick the boring option unless it costs real effort later (D21).
2. **The database is the source of truth.** Every gift round's status and its next due time live in Postgres. Background work reads and writes that status, so any step can be retried.
3. **Supabase is the data and timing layer, Vercel runs all the code.** Supabase holds the database, sign-in, files, and the schedule. Every line of app code, including what the schedule triggers, runs in the one Next.js app on Vercel (T8).
4. **Budget is enforced at three layers:** when ideas are generated, at approval, and at checkout through the order's `max_price`. A bug in one layer can't cause overspending (B-3, B-5).
5. **Nothing is bought without a recorded approval** (A-1).
6. **Spend under $100 a month** (T4). Stay on free tiers until something forces an upgrade.
7. **One language and one repo.** TypeScript in a single monorepo, so two people working with Claude can work anywhere in it.
8. **The AI model is replaceable.** The app depends on "an AI model", not a specific vendor. Each AI task names its model in one config file, and calls go through the AI SDK and AI Gateway, so moving a task to a cheaper model or another provider (for example OpenAI) is a config change. Claude is today's default, not a dependency (T11, §7).

## 2. Architecture

```mermaid
flowchart LR
  subgraph Client
    EXT[Chrome extension<br/>MV3]
    WEB[Web app / PWA<br/>phone + desktop]
    MAIL[User's email inbox]
  end
  subgraph Vercel["Vercel: all code"]
    CRON[Vercel Cron<br/>daily, 12:00 UTC]
    APP[Next.js app<br/>UI + API routes + webhooks]
    WF[Round engine<br/>tick API route]
    GW[AI Gateway]
  end
  subgraph Supabase["Supabase: data and timing"]
    AUTH[Auth<br/>Google sign-in]
    DB[(Postgres + RLS)]
    ST[Storage<br/>capture screenshots]
  end
  CLAUDE[AI model provider<br/>Anthropic today, swappable]
  ZINC[Checkout service<br/>Zinc]
  EMAIL[Email service<br/>send + inbound]
  GOOG[Google People API]

  EXT -->|capture| APP
  WEB --> APP
  APP --> AUTH
  APP --> DB
  APP --> ST
  CRON -->|GET with CRON_SECRET| WF
  WF --> DB
  WF --> GW --> CLAUDE
  WF -->|orders| ZINC
  ZINC -->|webhooks: placed, failed, tracking, delivered| APP
  WF -->|heads-up, reminders, reactions| EMAIL --> MAIL
  MAIL -->|replies + quick notes| EMAIL -->|inbound webhook| APP
  APP -->|contacts import| GOOG
```

### 2.1 Components

| Component | Choice | Notes |
|---|---|---|
| Web app and API | **Next.js (App Router) on Vercel**, Node.js runtime | One app for UI, API routes, webhooks, and the phone page. A PWA manifest (`app/manifest.ts`) and generated icons make it installable to the home screen; no service worker until push (T12). Browser tests: Playwright (`apps/web/e2e/`), in CI (T30). |
| Database | **Supabase Postgres** with Row Level Security | Every user-owned table has `user_id` plus RLS policies. Background jobs use the service role. |
| Auth | **Supabase Auth, Google provider** (plus email and password for existing list users) | Cookie sessions through `@supabase/ssr`; `proxy.ts` sends signed-out visitors to sign-in and back via `?next=`, except on `/lists`, `/share/*`, `/auth/*` and the install files (T30). Google Contacts read access is requested separately, at import time (§6.1). The extension authenticates with the user's Supabase session (§6.2). |
| File storage | **Supabase Storage** (private bucket) | Capture screenshots, in bucket `captures` at `{user_id}/{capture_id}.jpg`. Only the owner can read or write their folder. Deleting a person should delete their files too. That isn't built yet: the rows cascade but the files stay. It's noted on ALL-21, for the person-deletion work (ALL-21 or ALL-37). |
| Background jobs | **Vercel Cron** calls the app's **round engine** (a protected API route, `GET /api/rounds/tick`) **once a day at 12:00 UTC** (8 a.m. Eastern in summer) | One scheduler, shared with the keep-alive (T22); Vercel runs crons only on production. All the work runs in the Next.js app, so there's one runtime and one deploy, with no Supabase Edge Functions (T8) and no `pg_cron`/`pg_net` (T49, pending the owner's OK). Vercel Workflow isn't used. See §5.1. |
| AI | Any model through **Vercel AI Gateway** with the **AI SDK**. Default today: **Claude Sonnet 5.5** for every task (`anthropic/claude-sonnet-5.5`, T39; Opus 5.5 is the fallback; take IDs from the gateway's `/v1/models`) | The gateway gives one key, one bill and one spending cap across providers, plus fallbacks. Usage is **billed through the Vercel account**, so there's no separate AI provider account (T11). The model for each task is set in one config file (§7). Web search through the gateway is **confirmed in W1-3** (Anthropic's native tool; the gateway's Perplexity search is a provider-neutral alternative). Hobby plan works; Claude models need **paid** gateway credit (the free credit excludes them). |
| Checkout | **Zinc** (API v2), confirmed by the W1-2 spike | `max_price` caps the whole order (item, shipping and tax), gift orders, signed webhooks, per-package tracking. **MVP:** each user's own Zinc wallet. **Later:** the user's card through Zinc Connect (T16, §6.5a). Product lookups go through one app-owned Zinc account (T17). |
| Email | **Resend** on `giftsaf.com`, confirmed by the W1-4 spike (T33) | Sends from `hello@giftsaf.com` and receives on `in.giftsaf.com` (its own subdomain). The free plan covers 3,000 emails a month and 100 a day, sent and received combined. Inbound arrives as a signed webhook (Svix) carrying metadata only; the app fetches the body and attachments from the API. Open and click tracking stay off. See `spikes/email.md`. |
| Push notifications | **Decision deferred (T12).** If added: standard Web Push (VAPID) using the `web-push` package | Works on Android, and on iOS once the PWA is added to the home screen. Email covers every message without it. The notification service sends through a channel list, so push plugs in later without changing callers. Estimated 1–2 days of work, in its own ticket (W5-4). |
| Extension | Chrome Manifest V3, TypeScript, built with Vite | Popup plus a "Capture for…" action, in `apps/extension` (React and Tailwind with the T28 tokens). Permissions are only `activeTab`, `scripting` and `storage`. There's a dev build (localhost and `gift-me-dev`) and a prod build (giftsaf.com and `gift-me`). See `apps/extension/README.md`. **How people get it (owner, 2026-11-01):** for now, technical testers load it unpacked from the zip. The beta goes out as an **unlisted Chrome Web Store listing**, installed in one click from an "Add to Chrome" link on the site and updated automatically (ALL-65). That needs a privacy policy page, icons, and the web app accepting both the store's extension ID and the dev build's. |
| Contacts | Google People API, `contacts.readonly` scope | An unverified Google app allows up to 100 test users, which is plenty for the MVP. |

### 2.2 One app for the whole platform (T19)

Gift Concierge is one of three products: scan-to-gift, gift lists and the concierge (`../planning/strategy.md`). To users they are **always one app**, a ladder from quick one-off use to the deep concierge. So the platform is built as **one app, one account and one repo now, laid out so a product can be split out later.**

| Hard to undo, so decided now | Rule |
|---|---|
| Printed QR codes (shirts, sashes, plushies) | Every printed code points to **our own short link** (e.g. `<domain>/s/<code>`) that redirects. It never points straight at a page. Nothing is printed until the platform name and domain are settled (ALL-14). |
| Accounts | **One sign-in and one user record** shared by every product, from day one. |
| People across products | One shared `people` record per loved one, which can later link to that person's own user account (for example, Mom's gift list). Products don't keep their own copies. |

| Kept reversible, with guardrails | Rule |
|---|---|
| Data | One Postgres schema per product (`concierge`, `lists`, `scan`) plus a small shared schema (`public`) for accounts and people. Products never read or write another product's schema. They call that product's functions instead. Splitting a product out means moving its schema. |
| Code | One folder per product under `apps/web/modules/`, each exposing a small public `index.ts`. A lint rule (ESLint boundaries) blocks importing another product's internals. |
| Web addresses | Each product under its own path (`/concierge`, `/lists`, `/scan`, short links at `/s`). If a product later needs its own deploy, Vercel can serve separately deployed apps under the same domain without users noticing. |
| Navigation | Each product works on its own. After sign-in, Home (`/`) is the one front door: a "My list" card, then "People" (the concierge). Home needs an account; `/settings` holds time zone and over-budget %. A top bar, not tabs (T30). Links between products are low-key and only where they help (T29, `ui.md` > How the products connect). |
| Money and sensitive data | Zinc keys, funding, the addresses you enter for people, and social media content stay inside the concierge (D31). **Exception (D41):** your *own* address is account data in `public.account_addresses`, like your email. Only you read it; if you share it for gifts, a linked buyer sees city and state, and only server code reads the rest. |

**The MVP builds only the concierge.** The shared account and people records, the `concierge` module and schema, and the boundary rule are set up now; `lists` and `scan` are added when their work starts. **GiftsAF is the starting point (T20).** Jim's list app ([gifts-af/GiftsAF](https://github.com/gifts-af/GiftsAF)) uses the same stack (Next.js App Router, Supabase email-and-password sign-in, Vercel, shadcn/ui, Vitest). It's imported with its history as `apps/web` (ALL-15). Its list code becomes `modules/lists`, its tables (`lists`, `list_items`, `gift_claims`) and their functions move into the `lists` schema (done in ALL-19; display names now come from `public.profiles`), and its Vercel and Supabase projects become the platform's production ones. The concierge is built alongside it as `modules/concierge`.

### 2.3 Repository layout

**One repo for the whole platform** (T19). The repo is **`gifts-af/gift-me`** (renamed from `gift-concierge` on 2026-10-25, T21), with code added alongside `planning/` and `design/`. If ALL-14 picks a different platform name, it's renamed again; GitHub redirects old links. It has one shared package, kept as small as the two apps allow (T10):

```
gift-me/
├── apps/
│   ├── web/            Next.js app for the whole platform: UI, API routes, webhooks, round engine
│   │   ├── modules/
│   │   │   ├── concierge/   The MVP: rounds, ideas, orders, Zinc (public API in index.ts)
│   │   │   ├── lists/       From GiftsAF (T20): lists, items, sharing, claiming
│   │   │   └── scan/        Added when scan-to-gift starts
│   │   └── lib/ai/     Prompts, schemas, AI calls, eval fixtures
│   └── extension/      Chrome extension
├── packages/
│   └── core/           Pure domain logic (budget math, schedule/deadline math, round statuses) plus types
│                       shared by both apps, including generated database types (no I/O, heavily tested)
├── supabase/           Supabase CLI folder: SQL migrations, local config
├── spikes/             Throwaway wave-1 experiments (not production code)
├── planning/  design/
└── pnpm-workspace.yaml
```

- **Why a workspace at all:** the web app and the extension build separately but share `core`.
- **No Turborepo:** `pnpm -r build` and `pnpm -r test` are enough at this size. Add it later if builds get slow.
- **AI code lives in the web app** because nothing else calls the AI model. It moves into its own package only if a second app needs it.

Tooling: pnpm workspaces, Vitest for tests, ESLint and Prettier, and GitHub Actions running lint, typecheck, and tests on every pull request. Vercel preview deployments are created per pull request.
- **Browser tests (Playwright)** are added with the first real screens (W2-1, ALL-20): a smoke test that signs in, checks the app shell at phone width and signs out, run in CI. Later screen tickets add their own flows, and the end-to-end dry run (W6-1, ALL-36) uses it. Until then, the only UI tests are Vitest with jsdom, a simulated page that needs no real browser.

## 3. Data model

All tables have `id uuid`, `created_at`, and `updated_at`. Accounts (`profiles`) and `people` are shared by every product and live in `public`. The rest belong to the concierge and live in the `concierge` schema (§2.2, T19). User-owned tables have `user_id` with RLS: `user_id = auth.uid()`.

| Table | Key fields | Notes |
|---|---|---|
| `profiles` | user_id, display_name, email, phone, timezone, notification prefs, over_budget_pct (default 15), **funding_mode** (`zinc_wallet`; `connect` later), zinc_api_key (in Vault), zinc_webhook_secret (in Vault), zinc_connected_at, auto_topup_on (bool, last known) | One row per user. Push subscriptions are added with W5-4 if push goes ahead. Funding fields: §6.5a (T16). |
| `people` | user_id, name, relationship, birth_year (nullable; the birthday itself is an `occasions` row, ALL-21), photo_path (nullable, decision 46), address (structured, nullable: recipient first and last name, line 1, line 2, city, state, ZIP, country), phone (nullable and not collected, T42 and T51; the user's own phone, asked at checkout setup, is used when empty), address_checked_at (when the address last passed the format check, T51), notes, google_contact_id | P-1, P-5. Zinc requires a phone on every order, and the carrier is the only one who uses it. The address is checked when it's entered, not at purchase time (§6.1). |
| `budget_defaults` | user_id, relationship, base_amount_cents | B-2 (S) |
| `occasions` | user_id, person_id (nullable for shared holidays), kind (birthday, anniversary, christmas, mothers_day, …), date rule (fixed date or holiday rule), enabled | P-3. Holidays are computed from rules in `core`. |
| `budgets` | user_id, person_id, occasion_kind, amount_cents (nullable) | B-1. Overrides the default for that person and occasion. The budget is the buyer's own and optional (D36): `null` means no budget, even when the relationship has a default. |
| `account_addresses` (in `public`) | user_id, recipient name, line 1, line 2, city, state, ZIP, country, phone, address_checked_at, share_for_gifts | Your own address, for every product (D41): "My address" when you buy, and where gifts to you ship when you keep a list and turn sharing on. Owner-only. |
| `captures` | user_id, person_id, source_url, page_title, text_excerpt, screenshot_path, status (pending, extracted, failed) | C-1, C-2 |
| `profile_facts` | user_id, person_id, category (interest, dislike, size, brand, owns, wants, style, avoid, constraint, loved), value, source (capture, question, note, reaction, rejection), source_id, confirmed (bool), active | C-3, C-7. A person's profile is the set of their active facts. |
| `questions` | user_id, person_id, prompt, answer, status | C-4 |
| `gift_rounds` | user_id, person_id, occasion_id, occasion_date, ship_by_deadline, budget_cents (null = no budget, D36), status (§5), next_action_at, locked_until, attempts, approved_at | One per person per occasion per year. `next_action_at` is when the round engine should look at it next (§5.1). |
| `gift_ideas` | round_id, title, retailer, product_url (the exact size or color variant), retailer_product_id, offer_id, seller_name, first_party (bool), price_cents, est_shipping_cents, est_tax_cents, est_total_cents, handling_days_max, delivery_days_min, delivery_days_max, arrive_by (worst case), reason, over_budget (bool), rank, status (proposed, selected, rejected), source (generated, list), list_item_id | G-1, G-2. `source = list` for a pick from the person's own list (D37). Delivery is a range before purchase; `arrive_by` uses the slowest case. |
| `rejections` | round_id, reason_code, reason_text | G-3. Also written to `profile_facts`. |
| `orders` | round_id, idea_id, provider (zinc), provider_order_id, idempotency_key, funding_mode, max_price_cents, is_gift, gift_message (≤240 characters), price breakdown (subtotal, shipping, tax, total cents), fee_cents, status (placing, placed, failed, shipped, delivered, cancelled, refunded), failure_type, merchant_order_id, packages (jsonb: carrier, tracking number, status, estimated delivery date, proof-of-delivery photo), est_delivery_date (latest across packages), ship_to (recipient, buyer, other), ship_city, ship_state | A-3 as revised by D38, D-1. The full address it shipped to is snapshotted in `order_addresses`, which only the server reads. Zinc's own status stops at "placed"; shipping progress is per package, and one order can ship as several packages. |
| `reactions` | round_id, rating (loved, liked, meh, returned), note, source (email, web) | D-2 |
| `notifications` | user_id, round_id, kind, channel, sent_at, provider_message_id, error | Audit trail plus reminder escalation state. Records delivery; the link token lives in `action_links` (ALL-23). |
| `action_links` | user_id, round_id (nullable), notification_id, action, token_hash (unique), expires_at, used_at | One row per emailed button (ALL-23). Only the SHA-256 hash of the token is stored. Server-only: no policies and no grants for signed-in users. Generic on purpose, so scan-to-gift and ALL-49 can reuse it (T38). |
| `inbound_messages` | user_id, from, subject, body, attachments, matched_person_id, status | N-2, C-5 |
| `app_settings` | key, value (jsonb), updated_at | App-wide settings that change without a deploy (T23): `zinc_order_fee_cents` and the §4.1 schedule timings (`planning_delivery_days`, `safety_buffer_days`, `round_lead_days`, `reminder_1_after_heads_up_days`, `reminder_2_before_deadline_days`, `final_notice_before_deadline_days`, `fastest_days_to_arrive`). Not user-owned: only the server can read it, and the owner edits it. |

Gift history (D-3) is a view over `gift_rounds`, `gift_ideas`, `orders`, and `reactions`.

**Deletion (C-7, T27):** deleting a person or occasion is a **soft delete**: the row is marked `deleted_at` and hidden from the user, their open rounds are skipped, and gift and order history are kept. Removing data for real (for example a GDPR request) is an admin action, `admin.hard_delete_person` or `admin.hard_delete_account`, which cascades to every row, is logged in `admin.deletion_log`, and is followed by a storage cleanup of their screenshots.

**As built in schema v1** (ALL-19, T26; migrations in `supabase/migrations/`):
- The money fields shown on `profiles` above (over-budget %, notification prefs, funding mode, Zinc connection) live in **`concierge.accounts`**, one row per user. `public.profiles` keeps display name, email, phone and timezone, and is created at sign-up.
- Every table in `concierge` has `user_id` and the same privacy rule, including rows that belong to a round. Children reference their parent and owner together, so nothing can point at another user's data.
- `app_settings` is the one table with no `user_id`: only the server reads it (T23).
- **Users write their setup, the server writes the rest** (T26): people, occasions, budgets, facts, answers and captures are user-writable; rounds, ideas, orders, reactions, notifications, inbound mail and the Zinc connection are written only by server code, so `packages/core`'s budget and status checks can't be bypassed. One live order per idea.
- `packages/core/src/database.types.ts` is generated from the database (`pnpm db:types`). CI fails if it's out of date.

**As built in schema v1.1** (ALL-44, T31):
- **Optional budgets:** `gift_rounds.budget_cents` and `budgets.amount_cents` can be `null` (no budget). `budget_defaults` has no row when there's no default.
- **Your own address:** `public.account_addresses`, above. `public.shared_city_for_person(person_id)` gives the buyer city and state of a linked person who shares their address; `public.shared_address_for_person(person_id)` gives the full address to the server only.
- **Picks from a person's own list:** a buyer with the list's share link calls `lists.link_person(share_token, person_id)`. That records the list in `lists.person_links` and sets `people.linked_user_id`, with no consent step (D42). `lists.unlink_person(person_id)` reverses it, and so do deleting the list or the person. **A link lasts only while the list is shared (D43):** each link remembers the share token it was made with, and every read (`person_list` and both shared-address functions) goes through `lists.active_link`, which requires that token to still be the list's. Resetting the share link therefore cuts off everyone who linked through the old one, and a trigger also deletes those links so `linked_user_id` is cleared. A future "stop sharing" switch must be checked in `lists.active_link` too. `lists.person_list(person_id)` returns that list's gifts in order, each with `claimed` and `claimed_by_me` (never who claimed it). A signed-in buyer can ask only about their own people; the server (recognised by its `service_role` key) can ask about any, so server code such as the round engine must call it through the service-role client, not a direct database connection. The concierge reads lists only through this function (T19). The list's owner never sees claims on their own list (D39, ALL-20).
- **Adding a gift from a store link (ALL-10, T52):** pasting an Amazon link works in the browser alone (photo from the product ID, name from the link). A link from any other store is read on the server for a signed-in person: the server action fetches the page with guards against reaching anything but the public internet, and reads the name, price and photo from the page's standard product tags. A store that blocks it (Walmart's bot check did from a home connection) falls back to the name in the link, and the person types the price. Saved with `list_items.source` = `store-page` (read from the page) or `store-url` (link only). Switched off with `store_page_read_enabled` = 0.
- **Where an order ships:** `orders.ship_to`, `ship_city` and `ship_state` for the buyer; the full snapshot in `concierge.order_addresses`, server-only, so a shared address never reaches the buyer through their order. A one-off "other" address is saved to the person by writing the person's own address fields.

### 3.1 How the app learns about a person

Learning is stored in two layers: **raw inputs**, kept as received, and **learned facts** distilled from them.

```mermaid
flowchart LR
  subgraph Raw["Layer 1: raw inputs (kept as received)"]
    CAP[captures<br/>+ screenshots in Storage]
    IN[inbound_messages]
    Q[questions]
    REJ[rejections]
    REA[reactions]
  end
  PF[(profile_facts<br/>Layer 2: what the app knows)]
  CAP -->|AI extraction + user confirms| PF
  IN -->|AI extraction + user confirms| PF
  Q -->|answer becomes a fact| PF
  REJ -->|"e.g. avoid: X, already owns: X"| PF
  REA -->|"e.g. loved: X"| PF
  PF --> GEN[Idea generation<br/>synthesizes fresh each round]
  HIST[Gift history] --> GEN
  REJ --> GEN
```

**Layer 1: raw inputs**

| Input | Where it lives |
|---|---|
| Social media and web captures (extension) | `captures` (URL, title, visible text) plus the screenshot in Supabase Storage |
| Emailed or forwarded notes | `inbound_messages` |
| Answers to guided questions | `questions` |
| Rejected ideas and the reason | `rejections` |
| How the recipient liked a gift | `reactions` |
| A loved one's own gift list (D37) | read through `lists.person_list` once their account is linked (§3, schema v1.1). Its gifts are offered as picks (`gift_ideas.source = list`); turning list items into `profile_facts` is still to be designed |

**Layer 2: learned facts.** `profile_facts` is where the learning lives. Each fact is small and specific ("interest: fly fishing", "size: medium shirt", "avoid: clutter") and records its category, its source, a link back to the input it came from, whether the user confirmed it (facts from captures are saved unconfirmed and marked as AI suggestions, D47), and whether it's still active. **A person's profile is the set of their active facts**, and the user can see, edit or remove any of them (C-7).

**Synthesis happens at idea time.** Nothing stores a written summary of a person. Each round, the AI model reads the person's active facts, gift history and rejections and builds its picture from scratch, so the facts stay the single source of truth and nothing goes stale.

**Raw inputs are kept so the learning can be rebuilt.** When a better model or prompt comes along (T11), extraction can be re-run over past captures and notes to rebuild a person's facts.

**Later, if useful:** a stored summary per person ("outdoorsy, practical, prefers experiences"), refreshed when facts change. It's one extra field and isn't needed for the MVP.

**As built for notifications** (ALL-23, T38; plan: [design/plans/ALL-23-notifications.md](plans/ALL-23-notifications.md)):
- New table `concierge.action_links` (above). `notifications.action_token_hash` is gone; `provider_message_id` and `error` record what the email provider said.
- New setting `test_action_link_hours` (24) in `app_settings`: how long the Settings test email's button works (T23).
- Server code writes these server-only tables with the Supabase secret key (`lib/supabase/admin.ts`, server-only import). See README > Environments.

**As built in people v1.2** (ALL-21, T41):
- `people.birthday` is gone. A birthday is an `occasions` row; `people.birth_year` (optional) only adds an age. A partial unique index allows one live occasion per kind per person, and holidays can be added for anyone.
- `people.photo_path` points at a photo in the private `person-photos` bucket. Each owner can read and write only their own folder (`<user_id>/...`); the app shows a short-lived signed link. The size limit and the resize width are `app_settings` (`person_photo_max_upload_bytes`, `person_photo_px`).
- `concierge.add_person` creates a person with their starting occasions in one call, so the app and the Chrome extension save people the same way.

## 4. Key calculations (in `packages/core`, unit-tested)

### 4.1 Ship-by deadline and schedule
- `ship_by_deadline = occasion_date − worst_case_delivery_days − safety_buffer` **[Claude's call: buffer of 2 days]**.
  - `worst_case_delivery_days` comes from the delivery estimate for the chosen idea at checkout.
  - Before any idea exists, use a planning default of 7 days.
- Rounds start on the schedule from D23, measured back from the planning deadline:

| Event | When |
|---|---|
| Round created and ideas generated | 28 days before the deadline |
| Heads-up sent | Once ideas are ready, around 25 days before |
| Reminder 1 | 5 days after the heads-up |
| Reminder 2 (email, plus push if W5-4 ships) | 7 days before the deadline |
| Final notice | 48 hours before the deadline |
| Marked skipped (a short `skipped` email says no gift was chosen and nothing was bought) | At the deadline |

- If a round has to start late, for example a person added close to their birthday, it compresses the schedule, filters ideas to those that can still arrive in time, and says so in the heads-up.
  - **How it compresses** (agreed 2026-10-25, ALL-19): the round starts today, never in the past. Any reminder that would land on or before the heads-up is dropped, and so is reminder 1 if it would land on or after reminder 2. The skip at the deadline always stays. If the 7-day planning deadline has already arrived, the deadline moves to the last day next-day shipping could still make it (occasion − 3 days), ideas are kept only if they can arrive by then with the 2-day buffer, and the chosen idea's own deadline replaces it once ideas exist. A round always leaves at least one day to answer; if it can't, no round is created that year **[Claude's call]**.
- **Dates are calendar days** in US dates (Mother's Day is the 2nd Sunday of May, Father's Day the 3rd Sunday of June). A Feb 29 birthday or anniversary falls on Feb 28 in other years, since early beats late. Delivery and handling days count calendar days, with the slowest case plus the buffer covering weekends **[Claude's call]**. The code is in `packages/core` (`occasions.ts`, `schedule.ts`).

### 4.2 Budget
- **The budget is optional** (D36). With no budget (`null`), nothing is over budget and there's no over-budget label or confirm step. The approval ceiling is then the sum of the picks' estimated totals, and each order's `max_price` is capped at its own estimated total minus the fee, even after other orders in the round settle or fail. The same cap applies to a confirmed over-budget round, whose ceiling is also the sum of the picks. `maxPriceCents` requires the round's budget and the pick's approved total, so the cap can't be skipped. A price rise still stops the order and asks (A-4). B-3 ("automatic purchases never go over budget") applies when a budget is set. Every rule below assumes one is.
- `est_total = price + shipping + tax + fees` (D10). Tax is estimated from the recipient's state until checkout gives the real figure.
- An idea is **within budget** if `est_total ≤ budget`. It **counts as over-budget** if `budget < est_total ≤ budget × (1 + over_budget_pct)` (D11). Anything above that is dropped.
- If several ideas are selected, the sum of their `est_total` values must fit the round's budget, unless the over-budget idea was deliberately approved (PRD §6.2.3).
- At checkout: `max_price = approved ceiling − already committed spend in this round`.
  - The approved ceiling is the budget, or the over-budget idea's approved total if that was chosen.
  - If checkout comes in higher than `est_total` but still within `max_price`, the purchase goes ahead and the user is told (D28).
  - Zinc's `max_price` covers item, shipping and tax together, and is never exceeded (confirmed in W1-2). It doesn't include Zinc's $1 order fee, so `max_price = approved ceiling − committed spend − order fee`.
  - **Wallet mode (MVP):** Zinc sets aside `max_price + fee` when the order is placed and refunds what isn't used, so the balance must cover the full cap, not the expected total.
- Refunded orders release their committed spend (D29).
- **The order fee is a setting** (T23). It comes from `app_settings`, never from code, and is passed into every budget calculation.
- **How it's computed** (ALL-19, `packages/core/src/budget.ts`): money is whole cents, and anything that has to round rounds down, so a rounding error only ever spends less. The over-budget limit itself counts as over budget, not dropped. A pick of several ideas is judged by its sum, the same way as one idea, and when the sum is over budget and approved, the approved ceiling is that sum. An order holds its full cap plus fee as committed spend until its real total is known. **[Claude's call]** When several ideas are picked, each order's `max_price` also holds back the estimated totals of the picks not yet ordered, so the first order can't use up the whole budget. A `max_price` of $0 or less is treated as a bug, never as an order.

## 5. Gift round statuses

A round has **nine statuses**: a straight main path plus three side statuses.

```mermaid
flowchart LR
  S[scheduled] --> G[generating] --> A[awaiting_approval] --> O[ordered] --> D[delivered] --> C[complete]
  A -. rejected with reason .-> G
```

| Main path | Meaning | Moves on when |
|---|---|---|
| `scheduled` | The round exists; its start date hasn't arrived | Start date reached (→ `generating`, or `needs_address` if there's no address), or the deadline passes (→ `skipped`) |
| `generating` | The AI model is preparing ideas | Ideas are ready and the heads-up is sent, or the deadline passes (→ `skipped`) |
| `awaiting_approval` | Waiting for the user to pick or reject | Approved (→ `ordered`), or rejected with a reason (→ `generating`) |
| `ordered` | Approved and bought. Each order's own progress (placing, placed, shipped, …) lives in `orders` | The delivered webhook arrives |
| `delivered` | Arrived; the reaction prompt goes out the day after the occasion | A reaction is logged, or 7 days pass |
| `complete` | Done | — |

| Side status | Meaning | Way out |
|---|---|---|
| `needs_address` | No address yet, so no ideas can be checked (P-5) | Address added (→ `generating`), or the deadline passes (→ `skipped`) |
| `needs_attention` | Something went wrong: order failed, price over the approved amount, likely late, or the AI budget was hit | The user re-approves at the new price or picks the next-best idea (→ `ordered`, D29), or the deadline passes (→ `skipped`) |
| `skipped` | No reply by the deadline. Nothing is bought (D23) | — |

- Every transition writes `gift_rounds.status` and `next_action_at` together, so the UI and recovery logic only need to read the database.
- **Idempotency:** each Zinc order request uses `idempotency_key = order.id`, so a retry can never buy twice. Zinc webhooks have no event ID, so they're de-duplicated on event type plus order ID (Zinc's own guidance).

### 5.1 Round engine (T8, T49)
- **The tick:** Vercel Cron calls `GET /api/rounds/tick` **once a day at 12:00 UTC** (8 a.m. Eastern in summer, 7 a.m. in winter; on Hobby it may fire any time in that hour) with `Authorization: Bearer $CRON_SECRET`, the same secret as the keep-alive (T49, T22). Every step in a round is measured in days, so daily is enough, and reminders and heads-ups always arrive in the morning (T9). Vercel runs crons only on production, so `dev` and previews never tick on their own.
- **Off switch:** `round_engine_enabled` in `concierge.app_settings` (0 on every environment until ALL-27 turns it on in production). While it is 0 the tick logs `round_tick {enabled:false}` and does nothing.
- **Each tick:**
  1. Creates `gift_rounds` for occasions whose start date (§4.1) has arrived. A unique key on person, occasion and year means a repeated tick never creates duplicates. If one occasion fails, the tick logs `round_create_failed` and carries on.
  2. Claims due rounds: `next_action_at <= now()` and not locked. It sets `locked_until = now() + round_lock_minutes` (10) using `FOR UPDATE SKIP LOCKED`, so the tick and a user action or webhook never work on the same round at once.
  3. Advances the claimed rounds **one after another**, each in its own try/catch so one failing round can't stop the rest. A step generates ideas, sends a reminder or the skipped email, or skips at the deadline, then writes the new status, sets the next `next_action_at` and clears the lock. (The daily late-risk check joins in with ordering.)
- **Reminders are just due dates:** the next reminder's date is stored in `next_action_at`, and that morning's tick sends it. No process sleeps or waits. If ticks are missed, only the latest overdue reminder goes out, and an overdue deadline still skips.
- **Every email is recorded first:** each email a round sends is written once per round to `concierge.round_sends` (round, step) before it is sent. A crash between the record and the send means that email is never sent (at-most-once, on purpose: a missing reminder is better than a duplicate). If the email service cleanly refuses, the record is removed so the next tick retries.
- **The deadline skip never waits on its email** (ALL-28 ruling 12): if the `skipped` email is cleanly refused, the round still finishes as `skipped`, the send record is removed (nothing went out) and `round_skip_email_failed` is logged. It isn't retried.
- **A skip is emailed only if the buyer was asked** (ALL-28 ruling 13) **[Claude's call]**: the `skipped` email goes out only when the round already sent its `heads_up` or `address_request`. Otherwise (for example a round stuck in `generating` until its deadline) it is skipped silently and `round_skipped_silently` is logged. Switching an occasion off (or deleting it) also skips its open round with no email, in the database.
- **User actions and webhooks don't wait for a tick.** Approving, rejecting, adding an address (saving a person resumes their `needs_address` rounds), or a Zinc webhook updates the round and advances it right away, using the same step function. The tick is the safety net.
- **Stuck rounds stay put:** if a step fails, its lock expires and the next tick retries it; `attempts` counts the claims since the round's last successful finish. The claim step logs a `round_stuck` event for the owner (ids only, E6) on each retry once a round has had more than `round_max_attempts` (3) claims end without a successful finish. The round **does not** move to `needs_attention` (that status is for order and price problems, §5); it stays in its status and the deadline skip still happens. The 28-day runway leaves plenty of room to fix it.
- **Long steps:** idea generation is a stub today. When ALL-27 makes it take minutes, the tick should hand each round to its own function call so one slow round doesn't hold up the others, and each stays within Vercel's function time limit **[Verify in W1-6]**.
- **Testing:** outside production the route accepts `?now=<ISO time>` as a test clock (it reads `VERCEL_ENV` and passes `now` in; production ignores it). `EMAIL_OUTBOX=log` (also never in production) logs emails instead of sending them, so the Playwright round test (ALL-28) needs no Resend key.

## 6. Key flows

### 6.1 Setup and contacts import
1. Sign in with Google through Supabase Auth.
2. **Import contacts** (optional, ALL-24, T45). From Home, "Import from Google" opens `/people/import`. Google Identity Services' popup asks for `contacts.readonly` only, separate from sign-in; the browser reads the contacts from the People API and revokes the token at once, so it never reaches our server. The "Who do you buy gifts for?" checklist (search, A–Z) sends only the ticked contacts, each with a relationship the buyer picks ("Mom", "Dad", "Grandma" pre-fill it). Each becomes a `people` row with their name, birthday and birth year, address (saved unchecked) and Google contact id, plus their relationship's occasions; the server copies a real Google photo into private storage. A unique index on (user, Google contact id) stops duplicates. No phone numbers or emails are imported (T42).
3. Occasions are added automatically by relationship (P-4). Budgets come from relationship defaults (B-2).
4. **Missing address (P-5):** the add-person form doesn't ask for the address (decision 45, ask late, ask once). When a round starts and the address is still missing, the round goes to `needs_address`. The heads-up then asks for the address (one-tap link to a form) and that request follows the same reminder schedule. No ideas are generated until there's an address, because delivery estimates and tax need it. If the deadline passes, the round is skipped **[Claude's call]**. The address form is the **Shipping address** section of the person's page ([ALL-81](https://linear.app/allens-forever/issue/ALL-81)). The `needs_address` emails' button (`add_address`) opens it, and saving an address resumes the person's `needs_address` rounds at once. An address counts as present only when it passes the format check in step 5, so an incomplete imported address is asked for too.
5. **Address check on entry:** Zinc rejects incomplete addresses at order time (for example, a missing apartment number), which would surface on the day of purchase. The form requires the fields Zinc requires (except the phone) and checks the address's **format** when it's saved: names, street, city, a real US state code, and a 5-digit or ZIP+4 ZIP. No outside service is used (T51, T42). An address that looks right but doesn't exist is caught by Zinc at order time, and the round goes back to `needs_address` (ALL-30).
6. **Checkout setup:** connect Zinc and turn on auto top-up (§6.5a).

### 6.2 Capture (extension)
1. **Sign-in (T40, ALL-22):** the extension has **its own Supabase session**. Its **Sign in** button opens `/extension/connect` on the web app. That page needs you signed in, and its server makes a one-time magic-link token for you; no email is sent. The page passes only the token's hash to the extension through `externally_connectable`, and the extension trades it for a session with `verifyOtp`. The session lives in `chrome.storage.local` and refreshes itself, so a browser restart keeps you signed in. Signing out of either one leaves the other alone. Sharing the web app's refresh token would sign each one out whenever the other refreshed, because Supabase revokes a session when a used refresh token comes back. The extension's ID stays the same through a fixed manifest key (`NEXT_PUBLIC_EXTENSION_ID` in the web app). Captures post to `POST /api/captures` with the user's bearer token, so RLS applies. Details are in `design/plans/ALL-22-extension.md`.
2. The user picks a person and clicks **Capture**. The extension collects:
   - the page URL and title,
   - the visible text (`document.body.innerText`, trimmed to about 20k characters),
   - a screenshot of the visible area (`chrome.tabs.captureVisibleTab`).

   It never scrolls or crawls on its own (C-2). Permissions are `activeTab`, `scripting`, and `storage`, with no broad host permissions.
3. The app stores the capture (screenshot to Storage) and reads it **in the same request** while the popup waits (T48).
4. **Extraction:** the AI model gets the text and screenshot and returns structured candidate facts (category, value, confidence). The prompt tells it not to infer sensitive traits, and a post-filter blocks those categories (C-8). Facts under `capture_fact_min_confidence_pct` are dropped, duplicates of existing or removed facts are skipped, and something only seen in a photo is `owns`, never `wants` (D47).
5. The popup shows **"Here's what I learned"** (or that nothing confident was found) with a link to the person. The facts are already saved as active `profile_facts` (`source = capture`, `confirmed = false`), listed on the person's page under "✨ AI suggestions from your captures", where any can be removed (D47, ALL-25).

### 6.3 Gift idea generation (G-1 to G-5)
1. **Input:** the person's active facts, past gifts, past rejections, the occasion, the budget, the ship-by deadline, and the recipient's state.
2. **Brainstorm:** the AI model (with web search) proposes about 10 candidate gift concepts, each with an id, a `product_search` string (brand and model when known) and a retailer hint, **not a URL**: the AI's links and prices aren't reliable (ALL-17, ALL-42). Only retailers Zinc supports are allowed.
3. **Resolve:** each candidate's `product_search` goes to Zinc's search, then offers, for live price, availability, the seller, condition, shipping cost, and handling plus delivery days. Lookups use the **app-owned Zinc account** at $0.01 each, never the user's wallet (T17). Rules from the ALL-42 spike ([design/spikes/ai.md](spikes/ai.md#resolve-through-zinc-all-42)):
   - **The found item must match the idea.** Amazon's first result can be another brand. Pick the first result that matches the brand and model; if none does, the idea counts as "not found" (or the closest same-brand item, flagged as an alternative). **[Claude's call]** whether a cheap model checks the match, decided in W3-3.
   - **New only.** Refurbished and used offers are never picked, even when cheaper.
   - **Prefer the buy-box offer** (the seller Amazon shows by default), then the one sold by the retailer or brand itself, then the fastest delivery.
   - **Price comes only from the offer.** The AI's estimate was off by up to half in the spike, so budget checks use the live price plus shipping.
   - Offers don't include tax, so tax stays estimated (§4.2). Anything unavailable, too late in the slowest case, over the over-budget limit, or already given or rejected is dropped.
4. **Rank:** the AI model ranks the survivors and writes the one-line reasons, **referring to candidates by id** (it shortens titles, so matching on titles fails). The top 3–5 within budget are kept, plus at most one over-budget idea.
5. If fewer than 3 survive, the app repeats steps 2–4 up to 2 more times. After that it sends what it has and notes it.
6. Results are saved as `gift_ideas`, and the heads-up is sent.

### 6.4 Notifications and one-tap actions
- Emails carry **signed one-time action links**, for example `/a/{token}`. Each token is random, stored hashed, tied to one user, round, and action, and expires at the deadline. Opening one goes to a confirmation page on the phone web app, and that page performs the action with one tap. A link never approves anything on a plain GET, because email security scanners open links automatically **[Claude's call]**.
- **Sign-in required (ALL-23, T38):** a link only works for the person it was sent to. They must be signed in as the link's owner; signed out, the page offers sign-in (Google gets the owner's email as a hint) and returns to the same link. A forwarded link is useless to anyone else.
- **Where the token shows up:** Our code never stores or logs the raw token (only its hash is saved), but `/a/{token}` URLs do appear in the hosting provider's request logs and in the sign-in redirect; that's acceptable because a link needs its owner signed in and works once.
- **What `/a/{token}` shows, first match wins:** (1) unknown token: "This link doesn't work"; (2) signed out: sign-in page; (3) signed in as someone else: "This link is for a different account"; (4) already used; (5) expired; (6) the confirm page. The action and its round appear only at step 6. Confirming is a POST that marks the link used with one conditional update, so a double tap runs the action once. Full reasoning: [the plan](plans/ALL-23-notifications.md#what-was-decided-and-why).
- Emails come from `GiftsAF <hello@giftsaf.com>` through Resend, with click tracking off, so action links are never rewritten (T33).
- **Channels:** every message is sent through a list of channels. The MVP starts with email only. If push is added (W5-4, decision deferred, T12), the same messages also go out as Web Push notifications linking to the same pages.
- **Escalation** follows the §4.1 schedule. Each send is logged in `notifications`.

### 6.5 Approval and purchase
1. The user selects one or more ideas, or rejects them with a reason code and optional text.
2. **Approval** re-checks the budget (§4.2), records `approved_at`, moves the round to `ordered`, and places the orders right away (§5.1).
3. **Purchase:** one Zinc order per selected idea, placed on the user's own Zinc account (§6.5a), with `max_price`, `is_gift: true`, `fulfillment.gift: "best_effort"` (prices hidden on the packing slip, and the order still goes ahead if a store has no gift option), and an optional gift message the user can edit. It ships where the user chose (D38): the recipient (their address on the person, or the address they share through their list), the buyer's own address, or another address, which can be saved to the person. The order records `ship_to` and a snapshot of the address used.
   - **Approval means buy now (T18).** Once Zinc has placed an order with the store, it can't be cancelled; a return is the only way out. The approval screen says so.
4. If the order fails, the round moves to `needs_attention` and the user is offered the next-best idea to approve in one tap (D29). The message depends on Zinc's failure type: `max_price_exceeded` means the price went up (step 5), `out_of_stock` or `product_variant_unavailable` means pick another idea, `invalid_shipping_address` means fix the address, and `insufficient_funds` means top up (§6.5a).
5. **Price went over the approved amount (A-4):** the round moves to `needs_attention`. The user can either **re-approve the same gift at the new price**, which goes through the same budget and over-budget rules as §4.2 (one tap, with the new total shown), or pick the next-best idea **[Claude's call]**.

### 6.5a Funding gifts (T6, T16)

Funding comes in two stages. Ordering, tracking and the data model are the same in both; only where the money comes from changes, recorded as `profiles.funding_mode` and `orders.funding_mode`.

**Stage 1, MVP: each user's own Zinc wallet** (a little friction, no Stripe)
1. **Connect (one time, in Settings).** The app starts Zinc's sign-in (`POST /device/code`) and shows the user a link. The user signs in to Zinc (or creates an account) and clicks **Allow**, and the app collects that user's key once (`POST /device/token`). The key goes into Supabase Vault, and only the server can read it. The app then registers its webhook URL on that account (`Set Webhook Endpoint`) and stores the account's webhook secret in Vault. No keys to copy or paste. W1-2 tested this flow for real.
2. **Fund (one time, in Zinc).** The app links the user straight to Zinc's wallet page and walks them through adding funds and turning on **auto top-up** (a minimum balance plus a top-up amount, charged to a card saved in Zinc). With auto top-up on, Zinc charges the card when an order would otherwise be short, and the order goes ahead. Suggested settings: a minimum of their largest gift budget plus $1, topping up by about $100, since card top-ups cost 2.9% + $0.30 each and fewer, larger top-ups waste less.
3. **Keep it visible in our app.** The app reads the balance (`GET /wallet/me`, free) and shows it in Settings and on the approval screen. It looks ahead: the approved and upcoming gifts in the next 3 weeks are compared with the balance, and the heads-up email warns early ("$160 in gifts due, $40 in Zinc"). This matters because each order needs its **full cap plus $1** available at once (§4.2).
4. **If funds are short anyway** (auto top-up off, or Zinc reports `wallet.auto_topup.disabled` after failed charges): the order isn't placed. The round waits on the normal reminder schedule with a "Top up your Zinc balance" link, rather than failing.

**Stage 2, later: the user's card in our app (Zinc Connect)**
- The user adds a card in our app (Stripe's card form); it's saved on **our** Stripe account, connected to the app's Zinc account. Each order then sends a `payment` object with `mode: "connect"`. Zinc holds the card for the cap plus fees, buys, and charges the real total. There's no per-user Zinc account and no balance. The margin can be $0 or our markup (D34).
- Needs our own Stripe account, and makes us the seller the user sees: our name on their statement, and refunds or disputes go to our Stripe account. **[Verify with Zinc before stage 2]** how return refunds reach the card.
- Switching is per user (`funding_mode`), so both can run side by side during the move.

### 6.6 Tracking, late risk, reactions
- Zinc webhooks update `orders`: `order.placed` (real price breakdown), `order.failed` (failure type), `order.tracking_received`, `order.shipped`, `order.estimated_delivery_updated`, `order.delivered` and `order.cancelled` (the store cancelled; the wallet is refunded automatically). Each is checked against an HMAC-SHA256 signature (`X-Webhook-Signature`) using that user's Zinc account secret. The webhook URL carries a per-user token, so the app knows which secret to check against.
- **Delivery dates:** before purchase there's only a range (§6.3). The carrier's `estimated_delivery_date` appears per package once tracking arrives, and is updated when it changes.
- A late-risk check runs whenever an update arrives and once a day from the round engine: if `est_delivery_date > occasion_date`, the round goes to `needs_attention` and the user is alerted (D-1, D-4).
- One day after the occasion, the reaction prompt goes out (D-2). Notes are **text only in the MVP**. The phone keyboard's built-in dictation covers voice input, and recording and storing audio waits for later **[Claude's call]**. The answer is written to `reactions` and turned into `profile_facts` (for example, "loved: X").

### 6.7 Guided questions by email (C-4)
- Open questions for a person are included in heads-up and reminder emails as a signed link to a short form on the phone web page. That counts as "answerable by email" for the MVP. Replying in the body of the email is not parsed **[Claude's call]**.

### 6.8 Inbound email quick capture (N-2, C-5)
- **Each user gets a private capture address, `notes+{token}@in.giftsaf.com` (T33).** The token is random, identifies the user, and can be reset in Settings. It works from any account the user sends from. Heads-up and reminder emails use it as their Reply-To, so replying with news is the same as emailing a note. Mail to an unknown token is logged and dropped.
- **Webhook handling (W1-4 findings):** verify the Svix signature against the raw body, answer 200 straight away, and dedupe on `email_id`. Then fetch the body and attachments from Resend's API, and **copy attachments into Supabase Storage at once**, because their download links expire after an hour. Use the plain-text body plus attachments, and ignore the HTML: pasted images appear in it a second time as base64.
- The inbound webhook stores the message. The AI model then matches it to a person, using names in the text and the user's list of people, and extracts facts. If it isn't confident, it emails back asking "Who is this about?"

## 7. AI design

**Keeping the provider replaceable (T11):**
- All AI calls go through `apps/web/lib/ai`, using the AI SDK's provider-neutral functions (`generateObject`, `generateText`) and the AI Gateway. No other code calls a model directly.
- Each task's model and settings live in one config map, for example `{ extraction: "anthropic/claude-sonnet-5.5", ... }`. Changing a model is a one-line config change, re-checked against the eval fixtures.
- **Signing in to the gateway (T39):** on Vercel (Preview and Production) the AI SDK uses Vercel's automatic OIDC token, so there's no production key. Locally it uses the dev `AI_GATEWAY_API_KEY` from Vercel's Development variables (`vercel env pull`). **[Verify]** OIDC on a preview deploy with the first real AI call (W3-1 or W3-3); the fallback is a Sensitive production key.
- Prompts are plain instructions plus a schema, with no vendor-specific prompt tricks.
- **The one vendor-specific feature is web search** during brainstorming. It sits behind a small `searchWeb` step, so a different provider's search tool, or a search API, can replace it.

| Task | Default model and settings (T39) | Output | Cost (measured in W1-3 and ALL-42) |
|---|---|---|---|
| Capture extraction | Claude Sonnet 5.5, effort `low`, vision | Structured facts (schema-validated) | ~$0.005 per text capture, ~$0.01 per phone screenshot |
| Inbound note matching and extraction | Claude Sonnet 5.5, effort `low` | Person match plus facts | ~$0.005 each (estimate, same as text capture) |
| Idea brainstorm | Claude Sonnet 5.5, web search (up to 3 searches) | 8 candidates with ids and `product_search` terms, no URLs (schema) | ~$0.18 (mostly search results read) |
| Idea ranking and reasons | Claude Sonnet 5.5, effort `low` | Ranked list by candidate id (schema) | ~$0.01 |

**A full round costs about $0.20** with Sonnet 5.5 (ALL-42), against $0.30–0.45 with Opus 5.5 (W1-3). Sonnet's ideas were nearly as good as Opus's; Haiku 5.5 is far cheaper but missed the main need (it put a $15 pack of hooks above the vise Dad needs) and caught fewer facts. Opus stays the fallback if quality slips. Comparison in [`spikes/ai.md`](spikes/ai.md#model-comparison-all-42).

**Prompt rules learned in W1-3** (prompt v3): stated wants come first (use the over-budget slot if needed); a worn-out owned item is a replacement need; check every idea against owned items; stock items only, no personalization; prefer Amazon, Walmart, Target and Best Buy; ship-to isn't where hobbies happen. Captured facts must reach idea generation: without them, ideas are generic.

- All outputs use structured outputs or schemas. Inputs and outputs are logged, and inputs are kept so prompts can be improved later.
- **Cost control:** the AI Gateway budget is capped at **$60 a month**, with an alert email to the owner at 50% and 80% of the cap **[Claude's call]**. App-side limits cap the number of retries per round. If the cap is hit, rounds already waiting on ideas move to `needs_attention` and the owner is alerted. They never fail quietly, because a stalled round risks a late gift.
- **Evals (light):** W1-3 builds a small fixture set (about 10 captures and 5 profiles) that later prompt changes are re-checked against.

## 8. Security and privacy
- **No ORM (T46):** SQL migrations, the typed Supabase client running as the signed-in user, and SQL functions for multi-step work.
- RLS on every user table. The service role is only used inside the round engine and webhooks.
- The tick endpoint rejects any call without the shared secret.
- Webhooks verify signatures where the provider supports them. Otherwise they use a secret path token plus an IP allowlist if one is available.
- No retailer passwords are ever stored (A-5). The app **never touches card numbers**: in stage 1, cards live in each user's Zinc account; in stage 2, in Stripe (§6.5a). Users' Zinc keys and webhook secrets are kept in Supabase Vault.
- Secrets live in Vercel environment variables. Supabase keys are split into anon and service role.
- The sensitive-trait filter runs on AI output (C-8). Captures store only what the user captured.
- **Bot check on public forms (T43):** Cloudflare Turnstile on sign-up, sign-in, password reset, request access and feedback. Supabase Auth verifies the token for the auth forms; our server actions verify it for the two that email us, and fail closed.
- Deletion cascades (C-7). Users can export their data later.
- **Data minimization (T42):** a column or form field for personal data is added only with the feature that needs it, and is optional until that feature is used. Analytics, AI and other vendors get IDs and amounts, never names, emails or addresses, unless the vendor's job needs them (e.g. Zinc needs the shipping address to ship).

## 9. Environments and operations
- **Supabase:** two projects on the free tier, `dev` and `prod`, plus the local Supabase CLI for development. `pg_cron` and `pg_net` are enabled on `dev` only and aren't needed (T49).
  - **Migrations deploy from CI (T50):** every merge to `main` applies new migrations to `dev`, then to `prod` if `dev` succeeded, while Vercel deploys the code alongside. Migrations are expand-then-contract (E7) so either order is safe.
  - **Inactivity pause:** free projects pause after 7 days without activity, which would stop the round engine. W1-6 checks whether the tick counts as activity. If it doesn't, the owner either upgrades `prod` to Pro ($25 a month) or schedules a keep-alive call.
- **Vercel:** Hobby while developing and testing (T24). Production comes from `main`, and pull requests get preview deployments against Supabase `dev`.
  - Move to Pro before a commercial launch. **[Verify in W3]** that idea generation fits Hobby's function time limit.
  - Upgrade to Pro ($20 a month) if they aren't.
- **Monitoring:** Vercel logs and observability, AI Gateway dashboards, and a daily "health" email to the owner listing rounds in `needs_attention` **[Claude's call]**.
- **Test mode:** Zinc's sandbox (a `zn_test_` key: test product URLs for success, price exceeded, out of stock, bad address and more, delivering in seconds, with its own webhook settings and no cost), plus a `DRY_RUN` flag that does everything except place the real order.

## 10. Cost estimate (monthly, 3 users)

| Item | Estimate |
|---|---|
| Vercel Hobby, or Pro if needed | $0 / $20 |
| Supabase free, or Pro if needed | $0 / $25 |
| AI model usage through AI Gateway, billed by Vercel (prepaid credit) | ~$5–15 (about a dozen rounds a month at ~$0.40, plus captures at ~$0.01; capped at $60) |
| Email service (Resend) | $0 (free tier: 3,000 a month, 100 a day, sent plus received) |
| Zinc | $1 per successful order (paid from each user's wallet), plus $0.01 per product lookup on the app account (~$1–3). No minimum or monthly fee. |
| Domain (`giftsaf.com`, $12.03 a year) | ~$1 |
| **Total** | **~$15–85** worst case, under the $100 budget |

## 11. Spikes (wave 1)

| Spike | Questions it must answer | Done when |
|---|---|---|
| **W1-2 Checkout (Zinc)** | How does each user pay with their own card (A-9)? Options: a Zinc account per user, a user-funded wallet, or a payment method passed per order. What is Zinc's pricing and minimum? Does `max_price` include shipping and tax? How reliable are its delivery estimates? Which webhook events does it send? Does product and offer lookup work for idea resolution? **Can the wallet be funded automatically:** an API to add funds, auto-recharge from a saved card, or a balance check the app can poll? | A written recommendation in `design/spikes/checkout.md`, plus one real test order placed, tracked, and delivered (or returned). If Zinc doesn't work, Rye is evaluated as the fallback. |
| **W1-3 AI** | Can it pull useful facts from real captures (Instagram, Pinterest, a product page)? Can it produce 3–5 good, purchasable ideas from a profile? What is the real cost per call? | `design/spikes/ai.md` with sample inputs and outputs, prompt v1, and measured cost. The fixture set is committed. |
| **W1-4 Email** | Which provider (Resend or Postmark) supports inbound email on the free tier? Which domain? Which address scheme? | `design/spikes/email.md`, plus a working send and receive using the chosen provider. **Done 2026-11-01:** Resend on `giftsaf.com`, both directions tested (T33). |

## 12. Risks

| Risk | Mitigation |
|---|---|
| Zinc can't support "user pays with own card" | **Resolved in W1-2:** each user's own Zinc wallet for the MVP, and the user's card through Zinc Connect later (T16). Rye wasn't needed. |
| Zinc is young and changes weekly | Pin the API version in W4-2. The sandbox catches breaking changes early. |
| AI ideas are poor or can't be bought | The resolve step requires a live offer. The spike measures quality early. The rejection loop teaches the app. |
| Retailers block agent or API vendors | Avoid account automation. Support more than one retailer through Zinc. Add a gift card fallback later. |
| Vercel Hobby limits | Verify in W1-6, upgrade to Pro within budget if needed. |
| Supabase `prod` pauses and the round engine stops | Verify in W1-6. Upgrade to Pro or schedule a keep-alive. The owner health email (W5-3) also flags it if no tick has arrived in 26 hours. |
| Delivery estimates are wrong | 2-day buffer, the late-risk check, and a replacement offer. |

## 13. Work breakdown by wave (draft for Linear)

Each wave can start once the waves before it have the dependencies it lists. Within a wave, tickets run in parallel. The ticket IDs here are draft IDs, and Linear will assign real ones.

### Wave 1: Foundations and spikes (7 tickets in parallel)
| ID | Ticket | Depends on |
|---|---|---|
| W1-1 | Monorepo scaffold and CI (pnpm workspaces, Next.js shell, `packages/core`, `supabase/` folder, lint, typecheck, tests, GitHub Actions, branch protection), plus the platform guardrails (§2.2, T19): `apps/web/modules/concierge` with a public `index.ts`, the ESLint boundary rule, and `/concierge` as the product path | — |
| W1-6 | Platform provisioning and environments: Vercel project and previews, Supabase dev and prod with `pg_cron` and `pg_net` (superseded for the round tick by T49: Vercel Cron), the inactivity-pause check, AI Gateway with Vercel billing and cap, domain and DNS, env and secrets conventions, Hobby limits check, Jim's access to every service | — |
| W1-2 | Checkout spike (Zinc) | — |
| W1-3 | AI spike (extraction, ideas, cost) | — |
| W1-4 | Email spike (send and inbound) | — |
| W1-5 | Database schema v1: migrations in `supabase/`, a `concierge` schema for the product's tables plus shared accounts and `people` in `public` (§2.2, T19), RLS, generated types in `core`, plus `packages/core` holiday, deadline, and budget math with tests. Order, payment, and inbound fields are left as placeholders and finalized after W1-2 and W1-4. | W1-6 for applying to hosted `dev` (it can start immediately in a branch against local Supabase) |
| W1-7 | Look and feel: UI kit (Tailwind plus shadcn/ui, shared with the extension), a style guide as tokens, and clickable phone-first mock-ups of the approval, profile, home, extension popup and approval email screens, signed off by the owner and Jim. Written up in `design/ui.md` (T15). | — |

### Wave 2: Core app and capture plumbing
| ID | Ticket | Depends on |
|---|---|---|
| W2-1 | Auth (Google sign-in), app shell, mobile layout, PWA manifest | W1-1, W1-5, W1-6, W1-7 |
| W2-2 | People, occasions, and budgets: screens and API (P-1, P-3, P-4, B-1, B-2) | W1-5, W1-7, W2-1 |
| W2-3 | Google Contacts import with checklist (P-2) | W2-1, W2-2 |
| W2-4 | Chrome extension MVP: sign-in handoff, person picker, capture and upload, **including the capture-upload API route** (C-1, C-2) | W1-5, W1-7, W2-1 |
| W2-5 | Notification service: email sending, templates, signed action links, a channel list ready for push (N-1, N-3) | W1-4, W1-5, W1-7, W2-1 |
| W2-6 | Schema v1.1 (ALL-44): optional budgets, the buyer's own address, where an order ships, and a `lists` function so a round can offer picks from a person's own list (product decisions 36–39) | W1-5, W1-7 |

### Wave 3: Intelligence and the round engine
| ID | Ticket | Depends on |
|---|---|---|
| W3-1 | Capture extraction plus the "Here's what I learned" review (C-3, C-8) | W1-3, W2-4 |
| W3-2 | Profile view and editing, guided questions, readiness meter (C-4, C-6, C-7) | W1-7, W2-2 |
| W3-3 | Gift idea engine: brainstorm, resolve via checkout lookup, rank (G-1, G-2, G-4, G-5) | W1-2, W1-3, W2-2 |
| W3-4 | Round engine: Vercel Cron tick (T49), round creation, claiming and locking, round statuses, reminders as due times, skip (A-2) (§5.1) | W1-5, W1-6, W2-2, W2-5 |

### Wave 4: Approve and buy
| ID | Ticket | Depends on |
|---|---|---|
| W4-1 | Approval UI: idea cards, multi-select, over-budget handling, reject with reason, re-generate (A-1, B-4, G-3) | W1-7, W3-3, W3-4 |
| W4-2 | Purchase integration: Zinc orders, `max_price`, the A-8 price rule, idempotency, `DRY_RUN` (A-3, A-4, A-8, A-9, B-3, B-5) | W1-2, W3-4 |
| W4-3 | Inbound email quick capture: match person, file note (N-2, C-5) | W1-4, W3-1 |
| W4-4 | Zinc connection by sign-in and Allow (key and webhook secret in Vault, webhook registration), guided funding and auto top-up, balance shown in the app, look-ahead warning, held order when short (§6.5a stage 1) | W1-2, W2-1 |

### Wave 5: After the purchase
| ID | Ticket | Depends on |
|---|---|---|
| W5-1 | Order tracking webhooks, late-risk check, failure and replacement flow (D-1, D-4) | W4-1, W4-2 |
| W5-2 | Reaction prompts and gift history (D-2, D-3) | W4-2 |
| W5-3 | Owner health email and monitoring | W3-4 |
| W5-4 | **Optional, decide before starting:** Web Push notifications. Service worker, VAPID keys, subscribe from the PWA, push channel in the notification service (T12) | W2-1, W2-5 |

### Wave 6: Ready for real use
| ID | Ticket | Depends on |
|---|---|---|
| W6-1 | End-to-end dry run with real profiles in `DRY_RUN`, then 1–2 real orders | All above |
| W6-2 | Privacy pass: deletion cascade check, sensitive-trait filter test, secrets review | All above |
| W6-3 | Onboard Jim and 1–2 friends | W6-1, W6-2 |

**Within wave 2, W2-1 goes first.** W2-2 and W2-4 can start right after it, and W2-3 and W2-5 follow. So wave 2 is really two steps, though still more tickets than builders at each step. With two builders, nobody is blocked. Wave 1's spikes are the critical path: they decide W3-3 and W4-2. **Start Wave 1 with the spikes and look and feel (W1-7), not the scaffold.** Start the Zinc signup on day one, because account approval may take days. W1-1 is small and low-risk, so it can fill gaps or run in parallel. **W2-6** (added 2026-10-26) runs alongside W2-1 once the W1-7 mock-ups are signed off, and must land before W2-2; it also blocks W3-3, W4-1 and W4-2.

## 14. Accounts
All services (Google, Vercel including AI Gateway billing, Supabase, Zinc, Linear) are under the owner's **allensforever711@gmail.com** account, and the code is in the free **gifts-af** GitHub organization (github.com/gifts-af/gift-me), where allensforever711, aarontallen, JimtheBurger and brb3 are all owners. Jim is added to each service (T7). **Zinc:** the app-owned account (product lookups, sandbox, T17) exists under allensforever711@gmail.com, created in W1-2; each user also has their own Zinc account for buying (§6.5a). **Domain:** `giftsaf.com`, bought 2026-11-01 under that account in the Vercel GiftMe team (DNS on Vercel). **Email:** Resend, under the same account (T33).
