import { APP_NAME, inboxFor } from "@/lib/brand";
import { renderEmail } from "@/lib/email-layout";
import { NOT_HUMAN, TURNSTILE_FIELD } from "@/lib/turnstile";
import { sendEmail } from "@/lib/resend";

// Feedback (ALL-53): the "sad story" box emails the owner through the shared
// Resend sender (lib/resend.ts), like access requests. Nothing is stored. A
// hidden "website" field catches bots: they get the same thank-you, but
// nothing is sent. The Turnstile check (ALL-68) catches the rest.

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
  deps: { apiKey: string | undefined; fetch: typeof fetch; isHuman: (token: string) => Promise<boolean> },
): Promise<FeedbackResult> {
  const message = field(data, "message").slice(0, MAX_MESSAGE);
  const email = field(data, "email");
  const errors: Partial<Record<"message" | "email", string>> = {};
  if (!message) errors.message = "Tell us what happened.";
  if (email && !EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like you@example.com, or leave it blank.";
  if (Object.keys(errors).length) return { status: "invalid", errors };
  if (field(data, "website") !== "") return { status: "sent" };
  if (!(await deps.isHuman(field(data, TURNSTILE_FIELD)))) return { status: "error", message: NOT_HUMAN };
  // Branded like every email we send, to the +feedback inbox (ALL-71).
  const { html, text } = renderEmail({
    heading: `${APP_NAME} feedback`,
    paragraphs: message.split(/\n{2,}/),
    footer: email ? `From ${email}. Reply to answer.` : "No email left.",
  });
  const sent = await sendEmail(
    { to: inboxFor("feedback"), subject: `${APP_NAME} feedback`, html, text, replyTo: email || undefined },
    deps,
  );
  return sent.ok ? { status: "sent" } : { status: "error", message: SEND_FAILED };
}
