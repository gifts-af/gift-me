# GiftsAF Chrome extension

Saves gifts and gift ideas from any page to GiftsAF: add a product to your list, or save a page for a person. It is a Manifest V3 extension built with Vite, React and Tailwind. It asks Chrome for three permissions only: `activeTab`, `scripting` and `storage`. It shares `packages/core` with the web app, including the one relationship list that quick add uses.

## Build

```
pnpm --filter @gifts-af/extension build:dev   # localhost:3000 app + hosted gift-me-dev Supabase
pnpm --filter @gifts-af/extension build       # giftsaf.com + production Supabase
```

Both write to `apps/extension/dist`. The build prints the extension ID.

## Load it in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick `apps/extension/dist`.

## Dev vs prod

Settings live in `.env.development` and `.env.production` (all public values, so they are committed). A missing variable fails the build. Dev talks to `http://localhost:3000` and the hosted gift-me-dev Supabase project (`bcemtqvdbrrgiipzggyw`); prod talks to `https://giftsaf.com`. The local web app must also point at gift-me-dev (which `vercel env pull` gives you), not a local `supabase start`, or the sign-in token won't verify. The manifest only lets that one origin message the extension.

## Extension ID

`VITE_EXTENSION_KEY` is the Chrome Web Store item's public key (dashboard > Package > View public key), so unpacked builds get the same ID as the store copy (ALL-65). One Chrome profile can't hold both; use a second profile to try a dev build next to the store one.

```
bfagebaknjjgpopoieojpkogbifnijch
```

The web app needs `NEXT_PUBLIC_EXTENSION_ID` set to this value, in `.env.local` for dev and in Vercel for all environments.

## Icons

`public/icons/icon-{16,32,48,128}.png`, drawn from the GiftsAF tag logo (`apps/web/lib/logo-art.ts`). Rerun `pnpm --filter @gifts-af/extension icons` only when the logo changes.

## Install for users

People install it from the unlisted Chrome Web Store listing: <https://chromewebstore.google.com/detail/bfagebaknjjgpopoieojpkogbifnijch>. It doesn't show in search; anyone with the link can install it. The site links there ("Add to Chrome") on desktop Chrome when `NEXT_PUBLIC_EXTENSION_STORE_URL` is set. Store installs update themselves.

## Release a new version

Done as allensforever711 (admin, T7) in the [developer dashboard](https://chrome.google.com/webstore/devconsole).

1. Raise `version` in `src/manifest.ts`. The store refuses a version it has already seen.
2. `pnpm extension:package` from the repo root. This builds prod and writes `apps/extension/giftsaf-extension-<version>.zip`, with the manifest `key` removed because the store rejects it.
3. Dashboard > GiftsAF > Package > Upload new package, then Submit for review. Review usually takes a few days.

If a new version asks for a new permission, Chrome turns the extension off for everyone until they accept, and the privacy page and the listing's data-use answers must be updated first.

## Store listing

Keep these in step with the privacy page (`apps/web/app/privacy/page.tsx`, giftsaf.com/privacy).

- **Visibility:** Unlisted.
- **Category:** Shopping.
- **Summary:** Save gifts and gift ideas from any page to GiftsAF: add to your list, or save for someone.
- **Description:**

  > GiftsAF remembers the people you buy for and helps you pick gifts they'll love.
  >
  > Found a product you'd like, or one a friend would? Click the GiftsAF icon. On a product page, one click adds it to your list, with its name, price and a photo. Or save the page for a person, and GiftsAF adds what it learned to their profile as suggestions you can keep or remove.
  >
  > When you click the icon, the extension reads the tab you're on, on your computer. Nothing leaves your computer until you press Add or Save. It never reads your browsing history or runs in the background.
  >
  > GiftsAF is invite only while in early alpha. Sign in with your GiftsAF account.

- **Privacy policy:** https://giftsaf.com/privacy
- **Single purpose:** Save gifts and gift ideas from any page to GiftsAF.
- **Permission reasons:**
  - `activeTab`: read the tab the user opened the extension on, only when they click its icon.
  - `scripting`: read that tab's product details (and its text, when the user saves it for a person) when the user clicks the icon, and check the tab can be captured.
  - `storage`: keep the user signed in to GiftsAF.
- **Remote code:** No.
- **Data collected:** Website content (the product's name, price, a cropped photo and its text or screenshot, sent only when the user presses Add or Save); Web history (the address of a page the user adds or saves); Authentication information (the GiftsAF sign-in session); Personally identifiable information (names of the people the user saves to, the gifts on the user's list, and the user's email in the session). Nothing else.
- **Certifications:** not sold to third parties; not used for anything unrelated to the single purpose; not used for creditworthiness or lending.
