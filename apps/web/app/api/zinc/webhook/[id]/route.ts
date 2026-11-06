import { createAdminClient } from "@/lib/supabase/admin";
import { errorFields, logEvent } from "@/lib/log";
import { handleZincWebhook, readWebhookBody } from "@/modules/concierge";
import { placeHeld, webhookTellers, zincWiring } from "@/app/settings/zinc-deps";

// An auto top-up places the user's held gifts here, which can run for a while: one zinc_place_budget_ms (45 s by default) for the
// run, plus a request already in flight with its retries. 300 s is the most Vercel's Fluid
// compute allows on our plan; keep zinc_place_budget_ms well under it. Next needs a literal here.
export const maxDuration = 300;

// Each user's own Zinc account posts here (ALL-32). The raw body is read first because the
// signature is over exactly those bytes. Replies carry no body. With Zinc off in this
// environment the answer is 404 before any signature check, deliberately.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = createAdminClient();
    // A malformed id is 404 with no database call; a body over zinc_webhook_max_bytes is 413.
    const read = await readWebhookBody(id, request, async () => {
      const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: "zinc_webhook_max_bytes" });
      if (error || typeof data !== "number") throw new Error("Reading setting zinc_webhook_max_bytes failed.");
      return data;
    });
    if (!read.ok) return new Response(null, { status: read.status });
    const rawBody = read.body;
    const wiring = await zincWiring(db);
    if (!wiring) return new Response(null, { status: 404 });
    const { status } = await handleZincWebhook(id, rawBody, request.headers.get("x-webhook-signature"), {
      ...wiring.deps,
      placeHeld,
      ...webhookTellers(),
    });
    return new Response(null, { status });
  } catch (error) {
    // A 500 makes Zinc retry; the handlers are safe to run again.
    // Failures after the user is known are logged with their user id inside handleZincWebhook.
    logEvent("zinc.webhook_failed", { ...errorFields(error) });
    return new Response(null, { status: 500 });
  }
}
