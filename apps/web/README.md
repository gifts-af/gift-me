# Web app (`apps/web`)

The one web app for the whole platform (T19, T20): gift lists today (`modules/lists`, formerly the
GiftsAF repo), Gift Concierge next (`modules/concierge`). Build a list of gifts you'd actually like
to receive, adding each one either by hand or by pasting an Amazon product link.

Built with [Next.js](https://nextjs.org) (App Router) + React 19, TypeScript and Tailwind,
from Supabase's [`with-supabase`](https://github.com/vercel/next.js/tree/canary/examples/with-supabase)
template, which provides cookie-based auth via [`@supabase/ssr`](https://supabase.com/docs/guides/auth/server-side/nextjs).

## Getting started

Run these from `apps/web` unless noted. Install dependencies once from the repo root with `pnpm install`.

1. **Link the Vercel project** (once; `.vercel/` is gitignored). Sign in to the Vercel CLI as **allensforever711** (`npx vercel login`), since the GiftMe team is on Hobby and has no other members (T25). Pick team **GiftMe** and project **gift-me**:

   ```bash
   npx vercel link
   ```

2. **Pull environment variables** into `.env.development.local` (gitignored), which
   `next dev` loads automatically:

   ```bash
   npx vercel env pull .env.development.local
   ```

   This pulls Vercel's **Development** environment. Make sure the Supabase integration's
   variables are enabled for Development in Vercel → Settings → Environment Variables,
   or the file will contain only `VERCEL_OIDC_TOKEN`. The app needs:

   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...   # or NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

   This project's integration uses a `GIFT` prefix, so Vercel provides
   `NEXT_PUBLIC_GIFT_SUPABASE_URL` and `NEXT_PUBLIC_GIFT_SUPABASE_PUBLISHABLE_KEY`;
   `lib/supabase/env.ts` accepts either spelling.

   See `.env.example`. Both keys are public, limited by Row Level Security. Never give the
   service-role key a `NEXT_PUBLIC_` prefix.

3. **Apply the database migrations** in the repo root's `supabase/migrations/`. Locally,
   `pnpm supabase start` applies them (see the root README, Local development). For a hosted
   project, use `pnpm supabase db push`.

4. **Run it:**

   ```bash
   pnpm dev        # from the repo root, or `pnpm dev` here
   ```

   The dev server runs at http://localhost:3000.

## Auth

| Route | Purpose |
| --- | --- |
| `/` | Home: "My list", then "People". Needs an account |
| `/settings` | Time zone and over-budget allowance. Needs an account |
| `/lists` | The gift list. Works signed in or out (a guest's list isn't saved) |
| `/share/{token}` | Shared list, open to anyone with the link; friends can claim gifts. The list's owner sees no claims (product decision 39) |
| `/auth/login`, `/auth/sign-up` | Continue with Google, or email and password |
| `/auth/callback` | Where Google returns; turns the code into a session, then goes to `?next=` |
| `/auth/confirm` | Handles the link in confirmation and reset emails |
| `/auth/forgot-password`, `/auth/update-password` | Password reset |
| `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/pwa-icon/{192,512}` | Install to the home screen |

`proxy.ts` refreshes the session cookie on every request and sends signed-out visitors to
`/auth/login?next=<the page they asked for>`, except on `/lists`, `/share/*`, `/auth/*`,
`/api/keepalive` and the install files (`isPublicPath` in `lib/supabase/proxy.ts`). After sign-in
the app goes to `next` if it's a same-site path (`lib/safe-next.ts`), otherwise Home.

In Supabase → Authentication → URL Configuration, set the Site URL to the Vercel production
URL and add `http://localhost:3000/**` to Redirect URLs so email links and Google return to the app.

Server code reads the user with `createClient()` from `lib/supabase/server.ts`; client
components use `lib/supabase/client.ts`.

## What the gift list does

- **Add a gift manually** — name, price, and an optional image URL.
- **Add a gift from an Amazon link** — paste a product URL and press Enter (or tap *Add*). A
  full match shows as a card to confirm; a partial one opens the details at the missing field.
- **Remove gifts**, with a running item count and an exact list total.
- **Share a saved list** — *Share* copies a `/share/{token}` link (or shows it to copy by hand
  when the clipboard is blocked). Anyone with it sees the list read-only.
- **Claim a gift** — visitors to a shared list claim what they'll buy, so nobody buys it
  twice. Everyone with the link sees "Claimed by <name>". Signed-in visitors claim under
  their email and can unclaim; guests type a name and can't undo it. Opening an unclaimed
  gift's link first asks "Going to buy it?". The owner sees no claims and can't claim (product
  decision 39); a claim that loses a race says so in the dialog.

A signed-in user's list is saved with *Save*, which appears when there are unsaved changes;
leaving with unsaved changes asks first. A guest's list is kept in the browser for 24 hours
across a trip to sign in, then brought over and offered for saving.

## About the Amazon autofill

Amazon blocks automated page fetches: any server-side request for a product page returns a
captcha interstitial, and it returns it with HTTP 200, so a status check does not detect the
block. **The price therefore cannot be read from a URL alone** without a paid scraping API.

What this POC does instead, with no server at all:

| Field | Source |
| --- | --- |
| Image | The ASIN image CDN, `images-na.ssl-images-amazon.com/images/P/{ASIN}.01…` |
| Name | De-slugified from the URL path, e.g. `/Echo-Dot-4th-Gen/dp/…` |
| Price | You type it — except for the demo ASINs below |

`lib/fixtures.js` holds a handful of real ASINs with verified names and prices, so the
complete auto-fill path can be demonstrated end to end. Paste any of these:

```
https://www.amazon.com/dp/B0863TXGM3   Sony WH-1000XM4
https://www.amazon.com/dp/B01LTHP2ZK   Nintendo Switch
https://www.amazon.com/dp/B09B8V1LZ3   Echo Dot (5th Gen)
https://www.amazon.com/dp/B07FZ8S74R   Echo Dot (3rd Gen)
https://www.amazon.com/dp/B08N5WRWNW   MacBook Pro 13" M1
https://www.amazon.com/dp/B0BSHF7WHW   MacBook Pro 16" M2 Pro
```

Any other Amazon URL takes the best-effort path and asks you for the price.

### Wiring in a real lookup

All of it sits behind one function, `lookupAmazonProduct(url)` in `lib/amazon.js`,
marked with a `SWAP POINT` comment. Replace its body with a call to a scraping API and map
the response onto the same `LookupResult` shape; no UI code needs to change.

Known limitation: an invalid ASIN still returns HTTP 200 with a generic image rather than an
error, so a bad link shows a placeholder picture instead of failing. Confirm-before-add means
you see it and can clear the field first.

## Project structure

```
app/layout.tsx                   Root layout, theme provider, iOS home-screen tags
app/page.tsx                     Home (signed in)
app/settings/                    Settings page, form and server action
app/lists/page.tsx               The gift list
app/share/[token]/page.tsx       Public share link (unchanged URL)
app/auth/*                       Sign in, sign up, Google callback, confirm, password reset
app/manifest.ts, icon.tsx, apple-icon.tsx, pwa-icon/  Install to the home screen
proxy.ts                         Session refresh + auth redirects
components/app-shell/*           Top bar, account menu, page frame (shared by every product)
components/auth-frame.tsx        The sign-in look; google-button.tsx starts Google sign-in
components/ui/*                  shadcn/ui primitives, sized to design/ui.md (shared)
lib/supabase/*                   Browser, server and proxy Supabase clients + env names (shared)
lib/safe-next.ts                 Same-site check for ?next=
modules/lists/index.ts           The lists product's public API: import only this from outside
modules/lists/components/*.jsx   Gift app, add panel, list, card, summary, share, claim; ui.jsx holds shared bits
modules/lists/actions/*          Server actions: save list, claim and unclaim
modules/lists/lib/amazon.js      URL parsing and product lookup (the swap point)
modules/lists/lib/fixtures.js    Demo ASIN catalog
modules/lists/lib/format.js      Price parsing and currency formatting
modules/lists/lib/lists.ts       List queries and types
modules/concierge/index.ts       Gift Concierge: settings today, people next (ALL-21)
e2e/*                            Playwright browser tests (pnpm e2e), against local Supabase
test/*                           Vitest tests for shared code, tokens and contrast
```

**Product boundaries:** code outside `modules/<product>/` imports that product only through its
`index.ts`. ESLint (`boundaries/entry-point`) fails on anything else, and `test/boundaries.test.ts`
checks the rule itself.

Prices are held as integer cents throughout, so the list total is exact. The gift list
components are still plain JSX from the Vite prototype; TypeScript allows them via `allowJs`.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Build for production |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Lint with ESLint, including the product boundary rule |
| `pnpm typecheck` | Generate Next's route types, then run `tsc` |
| `pnpm test` | Run the Vitest tests once (`pnpm test:watch` to watch) |
| `pnpm e2e` | Run the Playwright browser tests (needs `pnpm supabase start`) |
