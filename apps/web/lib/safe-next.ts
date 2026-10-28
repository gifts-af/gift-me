// Where to go after signing in, e.g. back to a shared list to claim a gift.
// Only same-site paths: "//evil.com" or "https://..." would be an open
// redirect, and "/\evil.com" is read as "//evil.com" by some browsers.
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/";
}
