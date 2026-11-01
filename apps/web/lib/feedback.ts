import { APP_NAME, FEEDBACK_EMAIL } from "@/lib/brand";

// Feedback (ALL-53): the "sad story" box emails the owner through Resend.
// Nothing is stored. A hidden "website" field catches bots: they get the same
// thank-you, but nothing is sent. Sent the same way as access requests
// (lib/access-request.ts); ALL-23 moves both onto a shared Resend helper.

const FROM = `${APP_NAME} <hello@giftsaf.com>`;
const RESEND_URL = "https://api.resend.com/emails";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 5000;
const SEND_FAILED = "We couldn't send that just now. Please try again in a minute.";

export type FeedbackResult =
  | { status: "sent" }
  | { status: "invalid"; errors: Partial<Record<"message" | "email", string>> }
  | { status: "error"; message: string };

const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export async function sendFeedback(
  data: FormData,
  deps: { apiKey: string | undefined; fetch: typeof fetch },
): Promise<FeedbackResult> {
  const message = field(data, "message").slice(0, MAX_MESSAGE);
  const email = field(data, "email");
  const errors: Partial<Record<"message" | "email", string>> = {};
  if (!message) errors.message = "Tell us what happened.";
  if (email && !EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like you@example.com, or leave it blank.";
  if (Object.keys(errors).length) return { status: "invalid", errors };
  if (field(data, "website") !== "") return { status: "sent" };
  if (!deps.apiKey) return { status: "error", message: SEND_FAILED };

  try {
    const res = await deps.fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [FEEDBACK_EMAIL],
        subject: `${APP_NAME} feedback`,
        text: [message, `\n— ${email ? `from ${email} (reply to answer)` : "no email left"}`].join("\n"),
        ...(email ? { reply_to: email } : {}),
      }),
    });
    return res.ok ? { status: "sent" } : { status: "error", message: SEND_FAILED };
  } catch {
    return { status: "error", message: SEND_FAILED };
  }
}
