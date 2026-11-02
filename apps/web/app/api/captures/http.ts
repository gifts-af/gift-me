// CORS and JSON helpers for the routes the Chrome extension calls (ALL-22,
// ALL-25). Only the extension's own origin gets an Allow-Origin header.

/** Read at request time so a missing value fails the request, not the build. */
export function allowedOrigin(): string | null {
  const id = process.env.NEXT_PUBLIC_EXTENSION_ID;
  if (!id) {
    console.error("NEXT_PUBLIC_EXTENSION_ID is not set; the capture routes are disabled.");
    return null;
  }
  return `chrome-extension://${id}`;
}

export function respond(request: Request, allowed: string | null, body: BodyInit | null, init: ResponseInit) {
  const headers = new Headers(init.headers);
  headers.set("Vary", "Origin");
  if (allowed && request.headers.get("origin") === allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
  }
  return new Response(body, { ...init, headers });
}

export function json(request: Request, allowed: string | null, data: unknown, status: number) {
  return respond(request, allowed, JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function preflight(request: Request) {
  const allowed = process.env.NEXT_PUBLIC_EXTENSION_ID ? allowedOrigin() : null;
  return respond(request, allowed, null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** The token from `Authorization: Bearer …`, or null. */
export function bearer(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : null;
}
