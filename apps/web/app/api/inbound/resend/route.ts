import { after } from "next/server";
import { createExtractor } from "@/lib/ai/extract";
import { AI_MODELS } from "@/lib/ai/models";
import { errorFields, logEvent } from "@/lib/log";
import { verifySvix } from "@/lib/resend-inbound";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  captureStoreFor,
  createSupabaseInboundStore,
  createSupabaseNotifyStore,
  defaultChannels,
  handleInbound,
  type InboundDeps,
} from "@/modules/concierge";

// Reading the email, asking the model and replying run after the 200 goes back, in this budget.
// Next needs a literal here.
export const maxDuration = 60;

// Resend posts "email.received" here (ALL-31). Unsigned mail is never accepted: without the
// signing secret or the notes address the answer is 500, so Resend retries once it's fixed.
// The notes address isn't read here yet: it stays a required gate because the tip email (ALL-31
// Task 9) needs it, and a deploy without it should fail loudly rather than half work.
// Resend retries any non-2xx answer, so every 4xx/5xx below means "try again or give up", never "lost".
// The raw body is read first because the signature is over exactly those bytes.
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !process.env.INBOUND_NOTES_ADDRESS) {
    logEvent("inbound.misconfigured", {});
    return new Response(null, { status: 500 });
  }
  const raw = await request.text();
  if (!verifySvix(raw, request.headers, secret, new Date())) return new Response(null, { status: 401 });

  let emailId: unknown;
  try {
    const event = JSON.parse(raw) as { type?: unknown; data?: { email_id?: unknown } };
    if (event.type !== "email.received") return new Response(null, { status: 200 });
    emailId = event.data?.email_id;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof emailId !== "string" || !emailId) return new Response(null, { status: 400 });
  const id = emailId;

  try {
    // Everything that can throw is built BEFORE the claim: a failure here answers 500 with
    // nothing claimed, so Resend's retry is processed. Once claimed, only after() work is left.
    const db = createAdminClient();
    const deps: InboundDeps = {
      store: createSupabaseInboundStore(db),
      captureStore: (userId) => captureStoreFor(db, userId),
      extract: createExtractor(AI_MODELS.extraction),
      resend: { apiKey: process.env.RESEND_API_KEY, fetch },
      notify: { store: createSupabaseNotifyStore(db), channels: defaultChannels(process.env), baseUrl: siteUrl(), now: new Date() },
    };
    // One row per email: Resend retries and duplicates insert nothing, so nothing runs twice.
    const { data, error } = await db
      .schema("concierge")
      .from("inbound_seen")
      .upsert({ provider_email_id: id }, { onConflict: "provider_email_id", ignoreDuplicates: true })
      .select();
    if (error) throw error;
    if (!data || data.length === 0) return new Response(null, { status: 200 });

    after(async () => {
      try {
        await handleInbound(id, deps);
      } catch (e) {
        logEvent("inbound.failed", { email_id: id, ...errorFields(e) });
      }
    });
  } catch (e) {
    // A 500 makes Resend retry. Nothing stays claimed: either we threw before the claim or the claim itself failed.
    logEvent("inbound.failed", { email_id: id, ...errorFields(e) });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
