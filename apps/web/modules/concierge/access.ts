import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { APP_NAME, inboxFor } from "@/lib/brand";
import { renderEmail } from "@/lib/email-layout";
import type { logEvent } from "@/lib/log";
import type { SendResult } from "@/lib/resend";
import type { RenderedEmail } from "./notify/templates";

/**
 * Whether this person has been let into the concierge, which is by request. A
 * failed check throws, so nobody is let in, or turned away, on a guess.
 */
export async function hasConciergeAccess(db: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await db.schema("concierge").rpc("has_concierge_access", { p_user_id: userId });
  if (error) throw new Error(`Checking concierge access failed: ${error.message}`);
  return data === true;
}

/** Whether this person has access, and if not, whether they've asked. No account row means neither. */
export async function getAccessState(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<{ access: boolean; requested: boolean }> {
  const { data, error } = await db
    .schema("concierge")
    .from("accounts")
    .select("concierge_access, access_requested_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Reading concierge access failed: ${error.message}`);
  return { access: data?.concierge_access ?? false, requested: data != null && data.access_requested_at !== null };
}

type Claim = "claimed" | "already" | "busy";

/** Records the request, unless they already asked or today's are used up. Service role only. */
export async function claimAccessRequest(db: SupabaseClient<Database>, userId: string): Promise<Claim> {
  const { data, error } = await db.schema("concierge").rpc("claim_access_request", { p_user_id: userId });
  if (error) throw new Error(`Claiming an access request failed: ${error.message}`);
  if (data !== "claimed" && data !== "already" && data !== "busy") throw new Error("Claiming an access request gave an unknown answer");
  return data;
}

/** Gives a request back, so they can ask again. Service role only. */
export async function releaseAccessRequest(db: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await db.schema("concierge").rpc("release_access_request", { p_user_id: userId });
  if (error) throw new Error(`Releasing an access request failed: ${error.message}`);
}

export type AccessRequester = { id: string; email: string; name: string | null };

/** Asks for the concierge: the claim comes first, so a second tap sends nothing. */
export async function requestConciergeAccess(
  user: AccessRequester,
  deps: {
    claim(id: string): Promise<Claim>;
    release(id: string): Promise<void>;
    sendOwner(user: AccessRequester): Promise<SendResult>;
    sendPerson(user: AccessRequester): Promise<SendResult>;
    log: typeof logEvent;
  },
): Promise<{ status: "sent" | "busy" | "error" }> {
  const claim = await deps.claim(user.id);
  if (claim === "already") return { status: "sent" };
  if (claim === "busy") {
    deps.log("concierge_access.busy", { user_id: user.id });
    return { status: "busy" };
  }
  const sent = await deps.sendOwner(user);
  if (!sent.ok) {
    // Only the fact: the error can echo an address.
    deps.log("concierge_access.request_email_failed", { user_id: user.id });
    await deps.release(user.id);
    return { status: "error" };
  }
  deps.log("concierge_access.requested", { user_id: user.id });
  // The owner has the request, so it's sent even if the person's copy isn't.
  const confirmed = await deps.sendPerson(user);
  if (!confirmed.ok) deps.log("concierge_access.confirmation_failed", { user_id: user.id });
  return { status: "sent" };
}

// People type their own name, and it goes in the subject.
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The owner's copy of a request. Replying answers the person. */
export function buildAccessRequest(user: AccessRequester): RenderedEmail & { to: string; replyTo: string } {
  const name = oneLine(user.name ?? "");
  const who = name || user.email;
  const { html, text } = renderEmail({
    heading: `${who} wants the concierge`,
    paragraphs: ["Follow Concierge access > Letting someone in, in design/operations.md, and reply here."],
    rows: [name ? { title: name, detail: user.email } : { title: user.email }],
  });
  return { to: inboxFor("access"), replyTo: user.email, subject: `${APP_NAME} concierge request: ${who}`, html, text };
}

/** The person's own copy. It carries nothing they typed. */
export function buildAccessConfirmation(user: AccessRequester): RenderedEmail & { to: string; replyTo?: string } {
  const { html, text } = renderEmail({
    heading: "Got it.",
    paragraphs: ["Thanks, we got your request. We'll email you when you're in."],
  });
  return { to: user.email, subject: `We got your ${APP_NAME} request`, html, text };
}
