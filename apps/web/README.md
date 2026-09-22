# GiftMe.com

A proof-of-concept gift wishlist. Build a list of gifts you'd like to receive, adding each
one either by hand or by pasting an Amazon product link.

Built with [Vite](https://vite.dev) + React 19, with optional email/password sign-in via
[Supabase Auth](https://supabase.com/docs/guides/auth).

## Getting started

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5173.

## Sign-in (Supabase)

There is no custom login API: the browser talks to Supabase Auth directly through
`src/lib/supabase.js`, using the project URL and the public anon key. Sign-in is optional;
without the env vars the app still runs and the header says sign-in is off.

1. **Env vars.** The Vercel Supabase integration already sets `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for deployments; `vite.config.js` exposes the
   `NEXT_PUBLIC_` prefix to the client. For local dev, pull them into `.env.local`
   (gitignored):

   ```bash
   npx vercel link
   npx vercel env pull .env.local
   ```

   Or create `.env.local` by hand from Supabase → Project Settings → API.
2. **Supabase → Authentication → URL Configuration:** set the Site URL to the Vercel
   production URL and add `http://localhost:5173` to Redirect URLs, so confirmation emails
   link back to the app.
3. **Confirm email** (Authentication → Providers → Email) is on by default: new accounts must
   click the emailed link before signing in. Turn it off while testing if you prefer.

Never put the service-role key in a `NEXT_PUBLIC_` or `VITE_` variable — anything with those
prefixes ships to the browser.

## What it does

- **Add a gift manually** — name, price, and an optional image URL.
- **Add a gift from an Amazon link** — paste a product URL and press Enter (or click
  *Autofill*) to prefill the form, then confirm.
- **Remove gifts**, with a running item count and an exact list total.

The list lives in React state for the current session only (signing in doesn't save it yet). Nothing is persisted, so a
reload clears it — that is deliberate for this POC.

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

`src/lib/fixtures.js` holds a handful of real ASINs with verified names and prices, so the
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

All of it sits behind one function, `lookupAmazonProduct(url)` in `src/lib/amazon.js`,
marked with a `SWAP POINT` comment. Replace its body with a call to a scraping API and map
the response onto the same `LookupResult` shape; no UI code needs to change.

Known limitation: an invalid ASIN still returns HTTP 200 with a generic image rather than an
error, so a bad link shows a placeholder picture instead of failing. Confirm-before-add means
you see it and can clear the field first.

## Project structure

```
index.html                       Entry HTML document
src/main.jsx                     React entry point
src/App.jsx                      Root component; owns the gift list
src/components/AuthPanel.jsx     Sign in / create account / sign out
src/components/AddGiftPanel.jsx  URL autofill + manual fields + validation
src/components/LookupStatus.jsx  Lookup outcome messaging
src/components/GiftList.jsx      Card grid and empty state
src/components/GiftCard.jsx      A single gift card
src/components/GiftSummary.jsx   Item count and list total
src/lib/amazon.js                URL parsing and product lookup (the swap point)
src/lib/fixtures.js              Demo ASIN catalog
src/lib/format.js                Price parsing and currency formatting
src/lib/supabase.js              Supabase client (null when not configured)
src/lib/useSession.js            Current auth session hook
src/index.css                    Design tokens, reset, light/dark themes
src/App.css                      Layout and component styles
```

Prices are held as integer cents throughout, so the list total is exact.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with hot module replacement |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Preview the production build locally |
