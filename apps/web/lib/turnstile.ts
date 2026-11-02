// Cloudflare Turnstile, the bot check on public forms (ALL-68). The browser
// widget puts a token in the form; this asks Cloudflare whether it's good.
// Callers pass the secret and fetch in so tests need no network. It never
// throws, and anything short of a clear yes is a no, so a missing secret or
// an outage sends nothing rather than letting bots through.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// What a visitor sees when the check fails.
export const NOT_HUMAN = "We couldn't confirm you're a person. Please try again.";

// The hidden field Cloudflare's widget adds to the form it sits in.
export const TURNSTILE_FIELD = "cf-turnstile-response";

export async function verifyTurnstile(
  token: string,
  deps: { secret: string | undefined; fetch: typeof fetch },
): Promise<boolean> {
  if (!token || !deps.secret) return false;
  try {
    const res = await deps.fetch(SITEVERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret: deps.secret, response: token }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
