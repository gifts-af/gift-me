// The site's own address, from the request headers: used for links in emails.
export function baseUrlFrom(requestHeaders: Headers): string | null {
  const host = requestHeaders.get("host");
  if (!host) return null;
  const forwarded = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const hostname = host.replace(/:\d+$/, "");
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const proto = forwarded || (local ? "http" : "https");
  return `${proto}://${host}`;
}
