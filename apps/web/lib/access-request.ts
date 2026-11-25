import { APP_NAME, inboxFor } from "@/lib/brand";
import { renderEmail } from "@/lib/email-layout";
import { NOT_HUMAN, TURNSTILE_FIELD } from "@/lib/turnstile";
import { sendEmail, type OutgoingEmail } from "@/lib/resend";
import { logEvent } from "@/lib/log";

// Public requests for the concierge: a short form emails the owner through
// Resend, then sends the person a branded confirmation. Nothing is stored: the
// Gmail label on +waitlist is the list (requests from signed-in accounts go to
// +access). A hidden "website" field catches bots: they get the same thank-you,
// but nothing is sent. The Turnstile check catches the rest.

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

// A name goes into the subject, so line breaks are dropped there.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

export function buildAccessRequestEmail(req: AccessRequest): OutgoingEmail {
  const { html, text } = renderEmail({
    heading: `${req.name} wants the concierge`,
    paragraphs: [
      "They may not have an account yet, and need one to be let in. To let them in, run the statement in design/operations.md, then reply to this email.",
    ],
    rows: [
      { title: req.name, detail: req.email },
      ...(req.note ? [{ title: "They said", detail: req.note }] : []),
    ],
  });
  return {
    to: inboxFor("waitlist"),
    replyTo: req.email,
    subject: `${APP_NAME} waitlist: ${oneLine(req.name)}`,
    html,
    text,
  };
}

// The person's own copy, sent only after the bot check. It carries
// nothing they typed (not even their name) and no links, so the form can't be
// used to send strangers a GiftsAF email with someone else's words in it.
export function buildRequestConfirmation(req: AccessRequest): OutgoingEmail {
  const { html, text } = renderEmail({
    heading: "Got it.",
    paragraphs: ["Thanks, we got your request. We'll email you when you're in."],
  });
  return {
    to: req.email,
    subject: `We got your ${APP_NAME} request`,
    html,
    text,
  };
}

const SEND_FAILED = "We couldn't send that just now. Please try again in a minute.";

export async function requestAccess(
  data: FormData,
  deps: { apiKey: string | undefined; fetch: typeof fetch; isHuman: (token: string) => Promise<boolean> },
): Promise<RequestAccessResult> {
  const checked = validateAccessRequest(data);
  if (!checked.ok) return { status: "invalid", errors: checked.errors };
  if (checked.spam) return { status: "sent" };
  if (!(await deps.isHuman(field(data, TURNSTILE_FIELD)))) return { status: "error", message: NOT_HUMAN };
  const sent = await sendEmail(buildAccessRequestEmail(checked.value), deps);
  if (!sent.ok) return { status: "error", message: SEND_FAILED };
  // The owner has the request, so the visitor is thanked even if their own
  // copy doesn't go out.
  const confirmed = await sendEmail(buildRequestConfirmation(checked.value), deps);
  // Only the fact: the error can echo the visitor's address.
  if (!confirmed.ok) logEvent("access_request.confirmation_failed", {});
  return { status: "sent" };
}
