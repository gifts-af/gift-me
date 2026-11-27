import { createAdminClient } from "@/lib/supabase/admin";
import { errorFields, logEvent } from "@/lib/log";
import { handleAppZincWebhook, readCappedBody } from "@/modules/concierge";
import { connectWiring, settingInt, webhookTellers, zincWiring } from "@/lib/wiring";

// The app's own Zinc account posts card orders' events here (Zinc Connect). The raw body is read
// first because the signature is over exactly those bytes, checked with ZINC_CONNECT_WEBHOOK_SECRET.
// Replies carry no body. With Zinc or card payments not set up in this environment the answer is
// 404 before any signature check, as on the buyers' webhook. Nothing here places an order.
export async function POST(request: Request) {
  try {
    const db = createAdminClient();
    // A body over zinc_webhook_max_bytes is 413, as on the buyers' webhook.
    const read = await readCappedBody(request, () => settingInt(db, "zinc_webhook_max_bytes"));
    if (!read.ok) return new Response(null, { status: read.status });
    const wiring = await zincWiring(db);
    const connect = connectWiring();
    if (!wiring || !connect) return new Response(null, { status: 404 });
    const { status } = await handleAppZincWebhook(read.body, request.headers.get("x-webhook-signature"), {
      ...wiring.deps,
      secret: connect.webhookSecret,
      connectKey: connect.key,
      setting: (key) => settingInt(db, key),
      ...webhookTellers(),
    });
    return new Response(null, { status });
  } catch (error) {
    // A 500 makes Zinc retry; the handlers are safe to run again.
    logEvent("zinc.webhook_failed", { webhook: "app", ...errorFields(error) });
    return new Response(null, { status: 500 });
  }
}
