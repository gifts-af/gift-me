import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/log";
import { handleZincWebhook } from "@/modules/concierge";
import { placeHeld, zincWiring } from "@/app/settings/zinc-deps";

// Each user's own Zinc account posts here (ALL-32). The raw body is read first because the
// signature is over exactly those bytes. Replies carry no body.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawBody = await request.text();
  try {
    const wiring = await zincWiring(createAdminClient());
    if (!wiring) return new Response(null, { status: 404 });
    const { status } = await handleZincWebhook(id, rawBody, request.headers.get("x-webhook-signature"), {
      ...wiring.deps,
      placeHeld,
    });
    return new Response(null, { status });
  } catch (error) {
    // A 500 makes Zinc retry; the handlers are safe to run again.
    logEvent("zinc.webhook_failed", { webhook_id: id, name: error instanceof Error ? error.name : "unknown" });
    return new Response(null, { status: 500 });
  }
}
