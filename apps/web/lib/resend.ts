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
