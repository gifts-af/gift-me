// Where Stripe's card page sends the buyer back, finished or cancelled. Thin on purpose:
// finishCardSession does every check, and where the buyer goes comes from the visit we
// stored, never from this request. Signed-in only (the proxy sends others to sign in first).
import { NextResponse, type NextRequest } from "next/server";
import { errorFields, logEvent } from "@/lib/log";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { signInRedirect } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";
import { stripeWiring } from "@/lib/wiring";
import { finishCardSession } from "@/modules/concierge";

const SETTINGS = "/settings/paying";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const go = (path: string) => NextResponse.redirect(new URL(path, url));
  const settings = (status: string) => go(`${SETTINGS}?card=${status}`);

  const supabase = await createClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) return NextResponse.redirect(signInRedirect(url));

  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return settings("not_yours");

  const db = createAdminClient();
  try {
    const stripe = await stripeWiring(db);
    if (!stripe) {
      logEvent("card.stripe_missing", { user_id: userId });
      return settings("unavailable");
    }
    const out = await finishCardSession({ db, now: new Date(), stripe, siteUrl: siteUrl() }, { userId, sessionId });
    if (typeof out === "string") return settings(out);
    if (out.status === "saved") return go(out.backTo);
    return go(`${out.backTo}${out.backTo.includes("?") ? "&" : "?"}card=cancelled`);
  } catch (e) {
    logEvent("card.return_failed", { user_id: userId, ...errorFields(e) });
    return settings("error");
  }
}
