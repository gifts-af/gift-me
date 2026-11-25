import { buildAccessRequestEmail, buildRequestConfirmation, type AccessRequest } from "@/lib/access-request";
import { renderEmail } from "@/lib/email-layout";
import { buildAccessConfirmation, buildAccessRequest } from "@/modules/concierge";

// One rendered sample of each email the public forms and a concierge request
// send, for the gallery and the phone-layout test (e2e/emails.spec.ts, through `pnpm email:html`).
export function sampleFormEmails(): { name: string; html: string }[] {
  const request: AccessRequest = {
    name: "Jordan Rivera",
    email: "jordan.rivera@example.com",
    note: "Friend of Jim. I always leave gifts to the last minute.",
  };
  const feedback = renderEmail({
    heading: "GiftsAF feedback",
    paragraphs: ["The share link opened a blank page on my phone the first time, then worked after a refresh."],
    footer: "From jordan.rivera@example.com. Reply to answer.",
  });
  const requester = { id: "sample", email: "jordan.rivera@example.com", name: "Jordan Rivera" };
  return [
    { name: "waitlist-owner", html: buildAccessRequestEmail(request).html ?? "" },
    { name: "waitlist-confirmation", html: buildRequestConfirmation(request).html ?? "" },
    { name: "feedback-owner", html: feedback.html },
    { name: "concierge-request-owner", html: buildAccessRequest(requester).html },
    { name: "concierge-request-confirmation", html: buildAccessConfirmation(requester).html },
  ];
}
