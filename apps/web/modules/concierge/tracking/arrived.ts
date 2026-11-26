import { errorFields, logEvent } from "@/lib/log";
import { isId } from "../profile/rules";
import { concierge, fail } from "../purchase/store";
import type { DbDeps } from "../zinc/types";

// The buyer's "Mark as arrived" tap on the round screen, because Zinc's delivered event can be late or
// missing. Only a shipped gift can be marked (mark_delivered with 'buyer'): on a placed one a
// mistaken tap could hide a later store cancel. Behind order_tracking_enabled, like Zinc's
// delivered event (E7). Logs carry ids only (E6).

export type ArrivedDeps = DbDeps & {
  /** A whole-number app setting; throws when it's missing (T23). */
  setting: (key: string) => Promise<number>;
  /** The delivered email, once the round is delivered. */
  tellDelivered: (roundId: string) => Promise<unknown>;
};

/**
 * Marks the user's own shipped gift on this round delivered; the delivered email goes once the
 * round's last gift has arrived. `ok: false` when it changed nothing: switched off, not their
 * order or not this round's, or not shipped.
 */
export async function markGiftArrived(
  input: { userId: string; roundId: string; orderId: string },
  deps: ArrivedDeps,
): Promise<{ ok: boolean }> {
  const { userId, roundId, orderId } = input;
  const ids = { user_id: userId, round_id: roundId, order_id: orderId };
  if ((await deps.setting("order_tracking_enabled")) !== 1) {
    logEvent("tracking.arrived_refused", { ...ids, reason: "off" });
    return { ok: false };
  }
  if (!isId(roundId) || !isId(orderId)) return { ok: false };

  // mark_delivered checks the order is the user's; the round in the link must be its round too.
  const { data: order, error } = await concierge(deps).from("orders").select("round_id").eq("id", orderId).eq("user_id", userId).maybeSingle();
  if (error) fail("Loading the order failed", error);
  if (!order || order.round_id !== roundId) {
    logEvent("tracking.arrived_refused", { ...ids, reason: "not_found" });
    return { ok: false };
  }

  const marked = await concierge(deps).rpc("mark_delivered", { p_user_id: userId, p_order_id: orderId, p_by: "buyer" });
  if (marked.error) fail("Marking the gift arrived failed", marked.error);
  const result = marked.data?.[0];
  if (!result?.applied) {
    logEvent("tracking.arrived_refused", { ...ids, reason: "not_shipped" });
    return { ok: false };
  }
  logEvent("tracking.order_updated", { ...ids, status: "delivered", delivered_by: "buyer" });
  if (result.round_status === "delivered") {
    // The gift is marked either way; a missed email is sent by the tick's retry.
    try {
      await deps.tellDelivered(roundId);
    } catch (err) {
      logEvent("tracking.delivered_email_failed", { ...ids, ...errorFields(err), alert: true });
    }
  }
  return { ok: true };
}
