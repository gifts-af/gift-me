# GiftsAF Chrome extension

Saves what's on screen to a person in GiftsAF. It is a Manifest V3 extension built with Vite, React and Tailwind. It asks Chrome for three permissions only: `activeTab`, `scripting` and `storage`. It shares `packages/core` with the web app.

## Build

```
pnpm --filter @gifts-af/extension build:dev   # local app + local Supabase
pnpm --filter @gifts-af/extension build       # giftsaf.com + production Supabase
```

Both write to `apps/extension/dist`. The build prints the extension ID.

## Load it in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick `apps/extension/dist`.

## Dev vs prod

Settings live in `.env.development` and `.env.production` (all public values, so they are committed). A missing variable fails the build. Dev talks to `http://localhost:3000`; prod talks to `https://giftsaf.com`. The manifest only lets that one origin message the extension.

## Extension ID

The public key in `VITE_EXTENSION_KEY` pins the ID, so it is the same on every machine and in dev and prod:

```
nnakijeilmglcmjpdpagacbjannapafb
```

The web app needs `NEXT_PUBLIC_EXTENSION_ID` set to this value, in `.env.local` for dev and in Vercel for all environments.

## Icons

No icons yet. The web app draws its icons in code, so there is no PNG to reuse. Chrome shows a default letter tile until we add some.
