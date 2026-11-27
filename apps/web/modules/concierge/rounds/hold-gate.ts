import type { Database } from "@gifts-af/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPaidFeatures } from "../paid-features";
import { fail } from "../purchase/store";

type Db = SupabaseClient<Database>;

/** What placing checks before anything else (placeRound's gates), read now: a round's stored reason can lag behind it. */
export type HoldGate = { orderingOn: boolean; paid: boolean; setUp: boolean };

/**
 * Read as the user, except whether they're set up: the phone, the key's environment and the card
 * aren't theirs to read, so `adminDb` answers that and only yes or no leaves here. `zincEnv` is this
 * app's, null where Zinc is off. A card buyer is set up with a phone and a saved card, and ordering
 * is on for them only while card payments are too; a wallet buyer needs their own Zinc key.
 */
export async function readHoldGate(userDb: Db, userId: string, o: { adminDb: Db; zincEnv: string | null }): Promise<HoldGate> {
  const [ordering, connect, paid, account] = await Promise.all([
    userDb.schema("concierge").rpc("setting_int", { p_key: "zinc_ordering_enabled" }),
    userDb.schema("concierge").rpc("setting_int", { p_key: "connect_enabled" }),
    hasPaidFeatures(userDb, userId),
    o.adminDb
      .schema("concierge")
      .from("accounts")
      .select("zinc_connected_at, zinc_api_key_secret_id, buyer_phone, zinc_env, funding_mode, stripe_payment_method_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (ordering.error) fail("Reading whether ordering is on failed", ordering.error);
  if (typeof ordering.data !== "number") throw new Error("Setting zinc_ordering_enabled is missing.");
  if (connect.error) fail("Reading whether card payments are on failed", connect.error);
  if (typeof connect.data !== "number") throw new Error("Setting connect_enabled is missing.");
  if (account.error) fail("Reading whether payment is set up failed", account.error);
  const a = account.data;
  if (a?.funding_mode === "connect") {
    return {
      orderingOn: ordering.data === 1 && connect.data === 1 && o.zincEnv !== null,
      paid,
      setUp: !!a.buyer_phone && !!a.stripe_payment_method_id,
    };
  }
  return {
    orderingOn: ordering.data === 1 && o.zincEnv !== null,
    paid,
    setUp: !!a && !!a.zinc_connected_at && !!a.zinc_api_key_secret_id && !!a.buyer_phone && a.zinc_env === o.zincEnv,
  };
}
