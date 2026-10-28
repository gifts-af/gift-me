// Where to go after signing in, e.g. back to a shared list to claim a gift.
// Only same-site paths, or a full URL on this site (`origin`), which email
// templates send. The value is resolved the way a browser reads it, because
// browsers drop tabs and newlines and read "\" as "/": "/\t/evil.com" and
// "/\evil.com" both load as "//evil.com", an open redirect.
const BASE = "http://same-site.invalid";

export function safeNext(value: string | null | undefined, origin?: string): string {
  if (!value) return "/";
  const base = origin ?? BASE;
  if (!value.startsWith("/") && !(origin && value.startsWith(`${origin}/`))) return "/";
  try {
    const url = new URL(value, base);
    return url.origin === new URL(base).origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
