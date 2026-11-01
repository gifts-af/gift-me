import { APP_NAME, FEEDBACK_EMAIL } from "@/lib/brand";
import { sendEmail } from "@/lib/resend";

// Feedback (ALL-53): the "sad story" box emails the owner through the shared
// Resend sender (lib/resend.ts), like access requests. Nothing is stored. A
// hidden "website" field catches bots: they get the same thank-you, but
// nothing is sent.

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
  const sent = await sendEmail(
    {
      to: FEEDBACK_EMAIL,
      subject: `${APP_NAME} feedback`,
      text: [message, `\n— ${email ? `from ${email} (reply to answer)` : "no email left"}`].join("\n"),
      replyTo: email || undefined,
    },
    deps,
  );
  return sent.ok ? { status: "sent" } : { status: "error", message: SEND_FAILED };
}
