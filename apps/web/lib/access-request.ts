import { APP_NAME, FEEDBACK_EMAIL } from "@/lib/brand";
import { sendEmail, type OutgoingEmail } from "@/lib/resend";

// Access requests (ALL-47): a short form emails the owner through Resend.
// Nothing is stored. A hidden "website" field catches bots: they get the same
// thank-you, but nothing is sent.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_NOTE = 2000;

export type AccessRequest = { name: string; email: string; note: string };

export type Validation =
  | { ok: true; value: AccessRequest; spam: boolean }
  | { ok: false; errors: Partial<Record<"name" | "email", string>> };

export type RequestAccessResult =
  | { status: "sent" }
  | { status: "invalid"; errors: Partial<Record<"name" | "email", string>> }
  | { status: "error"; message: string };

const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function validateAccessRequest(data: FormData): Validation {
  const name = field(data, "name").slice(0, MAX_NAME);
  const email = field(data, "email");
  const note = field(data, "note").slice(0, MAX_NOTE);
  const errors: Partial<Record<"name" | "email", string>> = {};
  if (!name) errors.name = "Tell us your name.";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like you@example.com.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, note }, spam: field(data, "website") !== "" };
}

export function buildAccessRequestEmail(req: AccessRequest): OutgoingEmail {
  return {
    to: FEEDBACK_EMAIL,
    replyTo: req.email,
    subject: `${APP_NAME} access request: ${req.name}`,
    text: [
      `${req.name} (${req.email}) would like to try ${APP_NAME}.`,
      req.note ? `\nThey said:\n${req.note}` : "",
      "\nTo let them in, add their email under Google Auth Platform > Audience > Test users, then reply to this email.",
    ].join("\n"),
  };
}

const SEND_FAILED = "We couldn't send that just now. Please try again in a minute.";

export async function requestAccess(
  data: FormData,
  deps: { apiKey: string | undefined; fetch: typeof fetch },
): Promise<RequestAccessResult> {
  const checked = validateAccessRequest(data);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  if (checked.spam) return { status: "sent" };
  const sent = await sendEmail(buildAccessRequestEmail(checked.value), deps);
  return sent.ok ? { status: "sent" } : { status: "error", message: SEND_FAILED };
}
