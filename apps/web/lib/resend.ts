import { EMAIL_FROM } from "@/lib/brand";

// The one place the app talks to Resend (T33). Callers pass the key and fetch
// in so tests need no network. It never throws: failures come back as ok: false.

const RESEND_URL = "https://api.resend.com/emails";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html?: string;
  text: string;
  replyTo?: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(
  email: OutgoingEmail,
  deps: { apiKey: string | undefined; fetch: typeof fetch },
): Promise<SendResult> {
  if (!deps.apiKey) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const res = await deps.fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend responded ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * The Message-ID header an email went out with, from Resend's record of it (ALL-31), or null when
 * Resend doesn't have it yet or can't be reached. Resend sends through Amazon SES, which replaces
 * any Message-ID we set, so this is the id a reply's In-Reply-To names (checked 2026-11-16).
 */
export async function fetchMessageId(
  id: string,
  deps: { apiKey: string | undefined; fetch: typeof fetch },
): Promise<string | null> {
  if (!deps.apiKey) return null;
  try {
    const res = await deps.fetch(`${RESEND_URL}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${deps.apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { message_id?: unknown };
    return typeof body.message_id === "string" && body.message_id ? body.message_id : null;
  } catch {
    return null;
  }
}
