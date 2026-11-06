import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { siteUrl } from "@/lib/site-url";
import type { PlaceHeld, ZincDeps } from "@/modules/concierge";

type Env = Record<string, string | undefined>;

// Where ZINC_ENV, ZINC_API_BASE and ZINC_WALLET_URL are read (E3): the module logic only sees `deps`.
// Anything missing, or ZINC_ENV not "test" or "live", means Zinc is off in this environment.
// The webhook address Zinc is told about is the site's own (siteUrl), never the request's Host,
// so a preview or vercel.app address can't end up registered.
export async function zincWiring(
  db: SupabaseClient<Database>,
  env: Env = process.env,
): Promise<{ deps: ZincDeps; walletUrl: string } | null> {
  const zincEnv = env.ZINC_ENV;
  const base = env.ZINC_API_BASE;
  const walletUrl = env.ZINC_WALLET_URL;
  if ((zincEnv !== "test" && zincEnv !== "live") || !base || !walletUrl) return null;
  const { data, error } = await db.schema("concierge").rpc("setting_int", { p_key: "zinc_timeout_ms" });
  if (error || typeof data !== "number") throw new Error("Reading setting zinc_timeout_ms failed.");
  return {
    deps: { db, http: { base, timeoutMs: data, fetch }, env: zincEnv, webhookBaseUrl: siteUrl(env), now: new Date() },
    walletUrl,
  };
}

// ALL-32 Task 7 swaps in the real placeHeldForUser. Until then, held orders are picked up by the daily tick.
export const placeHeld: PlaceHeld = async () => {};
