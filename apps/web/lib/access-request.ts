import { APP_NAME, inboxFor } from "@/lib/brand";
import { renderEmail } from "@/lib/email-layout";
import { NOT_HUMAN, TURNSTILE_FIELD } from "@/lib/turnstile";
import { sendEmail, type OutgoingEmail } from "@/lib/resend";

// Access requests (ALL-47) and the concierge waitlist (ALL-71): a short form
// emails the owner through Resend, then sends the person a branded
// confirmation. Nothing is stored: the Gmail label on +access or +waitlist is
// the list. A hidden "website" field catches bots: they get the same
// thank-you, but nothing is sent. The Turnstile check (ALL-68) catches the rest.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_NOTE = 2000;

// "access" lets someone in now; "waitlist" means "tell me when the concierge
// is ready", so the owner doesn't invite them yet.
export type RequestKind = "access" | "waitlist";
export type AccessRequest = { name: string; email: string; note: string; kind: RequestKind };

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
  const kind: RequestKind = field(data, "kind") === "waitlist" ? "waitlist" : "access";
  return { ok: true, value: { name, email, note, kind }, spam: field(data, "website") !== "" };
}

// A name goes into the subject, so line breaks are dropped there.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

export function buildAccessRequestEmail(req: AccessRequest): OutgoingEmail {
  const waitlist = req.kind === "waitlist";
  const { html, text } = renderEmail({
    heading: waitlist ? `${req.name} wants the concierge` : `${req.name} would like to try ${APP_NAME}`,
    paragraphs: waitlist
      ? [`${req.name} joined the concierge waitlist. Email them when it launches.`]
      : ["To let them in, add their email under Google Auth Platform > Audience > Test users, then reply to this email."],
    rows: [
      { title: req.name, detail: req.email },
      ...(req.note ? [{ title: "They said", detail: req.note }] : []),
    ],
  });
  return {
    to: inboxFor(req.kind),
    replyTo: req.email,
    subject: waitlist ? `${APP_NAME} waitlist: ${oneLine(req.name)}` : `${APP_NAME} access request: ${oneLine(req.name)}`,
    html,
    text,
  };
}

// The person's own copy (ALL-71), sent only after the bot check. It carries
// nothing they typed (not even their name) and no links, so the form can't be
// used to send strangers a GiftsAF email with someone else's words in it.
export function buildRequestConfirmation(req: AccessRequest): OutgoingEmail {
  const waitlist = req.kind === "waitlist";
  const { html, text } = renderEmail(
    waitlist
      ? { heading: "Thanks!", paragraphs: ["You're on the concierge waitlist. We'll email you when it's ready."] }
      : { heading: "Got it.", paragraphs: ["Thanks, we got your request. We'll email you when you're in."] },
  );
  return {
    to: req.email,
    subject: waitlist ? `You're on the ${APP_NAME} waitlist` : `We got your ${APP_NAME} request`,
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
  if (!confirmed.ok) console.error("access request confirmation not sent", confirmed.error);
  return { status: "sent" };
}
