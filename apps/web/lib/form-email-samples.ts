import { buildAccessRequestEmail, buildRequestConfirmation, type AccessRequest } from "@/lib/access-request";
import { renderEmail } from "@/lib/email-layout";

// One rendered sample of each email the public forms send (ALL-71), for the
// phone-layout test (e2e/emails.spec.ts, through `pnpm email:html`).
export function sampleFormEmails(): { name: string; html: string }[] {
  const access: AccessRequest = {
    name: "Jordan Rivera",
    email: "jordan.rivera@example.com",
    note: "Friend of Jim. I'd love to try the list for my birthday next month.",
    kind: "access",
  };
  const waitlist: AccessRequest = { ...access, kind: "waitlist" };
  const feedback = renderEmail({
    heading: "GiftsAF feedback",
    paragraphs: ["The share link opened a blank page on my phone the first time, then worked after a refresh."],
    footer: "From jordan.rivera@example.com. Reply to answer.",
  });
  return [
    { name: "access-owner", html: buildAccessRequestEmail(access).html ?? "" },
    { name: "access-confirmation", html: buildRequestConfirmation(access).html ?? "" },
    { name: "waitlist-owner", html: buildAccessRequestEmail(waitlist).html ?? "" },
    { name: "waitlist-confirmation", html: buildRequestConfirmation(waitlist).html ?? "" },
    { name: "feedback-owner", html: feedback.html },
  ];
}
