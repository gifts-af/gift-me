# Web app (`apps/web`)

The one web app for the whole platform (T19, T20): gift lists today (`modules/lists`, formerly the
GiftsAF repo), Gift Concierge next (`modules/concierge`). Build a list of gifts you'd actually like
to receive, adding each one either by hand or by pasting an Amazon product link.

Built with [Next.js](https://nextjs.org) (App Router) + React 19, TypeScript and Tailwind,
from Supabase's [`with-supabase`](https://github.com/vercel/next.js/tree/canary/examples/with-supabase)
template, which provides cookie-based auth via [`@supabase/ssr`](https://supabase.com/docs/guides/auth/server-side/nextjs).

## Getting started

Run these from `apps/web` unless noted. Install dependencies once from the repo root with `pnpm install`.

1. **Link the Vercel project** (once; `.vercel/` is gitignored):

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

3. **Apply the database migrations** in the repo root's `supabase/migrations/`, oldest first, with
   `supabase db push` or by pasting each file into the Supabase SQL editor.

4. **Run it:**

   ```bash
   pnpm dev        # from the repo root, or `pnpm dev` here
   ```

   The dev server runs at http://localhost:3000.

## Auth

| Route | Purpose |
| --- | --- |
| `/auth/sign-up`, `/auth/login` | Email + password forms |
| `/auth/confirm` | Handles the link in confirmation / reset emails |
| `/auth/forgot-password`, `/auth/update-password` | Password reset |
| `/lists` | The gift list (`/` redirects here) |
| `/share/{token}` | Shared list, open to anyone with the link; visitors can claim gifts |

`proxy.ts` refreshes the session cookie on every request and redirects signed-out visitors
to `/auth/login` for any route other than `/`, `/lists`, `/auth/*` and `/share/*`. The gift list on `/lists`
works signed in or out.

In Supabase → Authentication → URL Configuration, set the Site URL to the Vercel production
URL and add `http://localhost:3000/**` to Redirect URLs so email links return to the app.

Server code reads the user with `createClient()` from `lib/supabase/server.ts`; client
components use `lib/supabase/client.ts`.

## What the gift list does

- **Add a gift manually** — name, price, and an optional image URL.
- **Add a gift from an Amazon link** — paste a product URL and press Enter (or click
  *Autofill*) to prefill the form, then confirm.
- **Remove gifts**, with a running item count and an exact list total.
- **Share a saved list** — *Share* copies a `/share/{token}` link. Anyone with it sees the
  list read-only; the owner is asked to confirm first, so they don't spoil their own gifts.
- **Claim a gift** — visitors to a shared list claim what they'll buy, so nobody buys it
  twice. Everyone with the link sees "Claimed by <name>". Signed-in visitors claim under
  their email and can unclaim; guests type a name and can't undo it. Opening an unclaimed
  gift's link first asks "Are you going to buy?". The owner can see claims but not claim.

The list lives in React state for the current session only. Nothing is persisted yet, so a
reload clears it.

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
app/layout.tsx                   Root layout, fonts, theme provider
app/page.tsx                     Redirects to /lists (no platform home page yet)
app/lists/page.tsx               The gift list
app/share/[token]/page.tsx       Public share link (unchanged URL)
app/auth/*                       Sign up, login, confirm, password reset
proxy.ts                         Session refresh + auth redirects
components/site-shell.tsx        Nav (auth state) and footer (theme switcher)
components/ui/*                  shadcn/ui primitives (shared)
lib/supabase/*                   Browser, server and proxy Supabase clients + env names (shared)
modules/lists/index.ts           The lists product's public API: import only this from outside
modules/lists/components/*.jsx   Gift app, add panel, list, card, summary, share, claim
modules/lists/components/gifts.css  Gift list styles, scoped under .giftme
modules/lists/actions/*          Server actions: save list, claim and unclaim
modules/lists/lib/amazon.js      URL parsing and product lookup (the swap point)
modules/lists/lib/fixtures.js    Demo ASIN catalog
modules/lists/lib/format.js      Price parsing and currency formatting
modules/lists/lib/lists.ts       List queries and types
modules/concierge/index.ts       Gift Concierge (empty until Wave 2)
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
