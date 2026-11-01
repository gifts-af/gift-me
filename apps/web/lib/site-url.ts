// The site's absolute address, for link previews and other absolute URLs
// (ALL-55). Production uses the project's production domain (giftsaf.com), not
// the per-deploy URL; previews use their own deploy URL. Both come from
// Vercel's system env vars.
type Env = Record<string, string | undefined>;

export function siteUrl(env: Env = process.env) {
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000";
}
