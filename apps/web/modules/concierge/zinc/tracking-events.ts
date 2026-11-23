// Zinc's tracking, shipped, estimate, delivered and pickup events: where a bought gift is.
// Order status only moves forward, and every write locks the round first in SQL
// (record_tracking, mark_delivered), so a retry or a duplicate running alongside changes
// nothing twice. Packages are whitelisted before and again inside SQL (T42). Logs carry ids
// only: never tracking numbers or links (E6).
import { z } from "zod";
import { latestEstimate, packagesFromZinc, packagesToRows, type TrackedPackage } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { call } from "./client";
import { eventTime, findOurOrder, userZincKey } from "./events";
import type { ZincEvent } from "./signature";
import type { ZincDeps } from "./types";

export type TrackingDeps = ZincDeps & {
  /** A whole-number app setting; throws when it's missing (T23). */
  setting: (key: string) => Promise<number>;
  /** The engine's tellOrdered, for an order whose order.placed was lost. */
  orderPlaced?: (roundId: string) => Promise<unknown>;
  /** The delivered email, once the round is delivered. */
  tellDelivered?: (roundId: string) => Promise<unknown>;
};

export const TRACKING_EVENTS = new Set([
  "order.tracking_received",
  "order.shipped",
  "order.estimated_delivery_updated",
  "order.delivered",
  "order.available_for_pickup",
]);

const zincTracking = z.object({ tracking_numbers: z.unknown() });
const day = /^\d{4}-\d{2}-\d{2}/;

/** Applies one tracking event to the user's own order. Throws only where a Zinc retry could help. */
export async function handleTrackingEvent(userId: string, event: ZincEvent, deps: TrackingDeps): Promise<void> {
  if ((await deps.setting("order_tracking_enabled")) !== 1) {
    logEvent("tracking.event_ignored", { user_id: userId, zinc_event: event.event, reason: "off" });
    return;
  }
  // Gifts ship to a home address; pickup isn't handled in the MVP.
  if (event.event === "order.available_for_pickup") {
    logEvent("tracking.event_ignored", { user_id: userId, zinc_event: event.event, reason: "pickup" });
    return;
  }
  if (!event.orderId) {
    logEvent("zinc.webhook_unmatched", { user_id: userId, reason: "no_order_id" });
    return;
  }
  const ourId = await findOurOrder(userId, event.orderId, deps);
  if (!ourId) {
    logEvent("zinc.webhook_unmatched", { user_id: userId, provider_order_id: event.orderId, alert: true });
    return;
  }
  const concierge = deps.db.schema("concierge");
  const found = await concierge.rpc("order_by_reference", { p_user_id: userId, p_order_id: ourId });
  if (found.error) throw new Error("Looking up the order failed.");
  const order = found.data?.[0];
  if (!order) {
    logEvent("tracking.event_ignored", { user_id: userId, zinc_event: event.event, order_id: null, status: null });
    return;
  }
  if (order.provider_order_id && order.provider_order_id !== event.orderId) {
    logEvent("zinc.webhook_provider_id_mismatch", { user_id: userId, order_id: order.id });
    return;
  }

  // Tracking on an order still placing or unconfirmed means Zinc's order.placed was lost:
  // settle it placed first, with the usual "ordered" email (tellOrdered sends it once).
  if (order.status === "placing" || order.status === "unconfirmed") {
    const settled = await concierge.rpc("settle_order", {
      p_user_id: userId,
      p_order_id: order.id,
      p_status: "placed",
      p_failure_type: "failed",
      p_price: { provider_order_id: event.orderId },
    });
    if (settled.error) throw new Error(`Settling the order failed (${settled.error.code}).`);
    logEvent("zinc.order_settled", { user_id: userId, order_id: order.id, status: "placed" });
    await tell(deps.orderPlaced, order.round_id, userId);
  }

  const at = eventTime(event.timestamp) ?? deps.now.toISOString();
  const ids = { user_id: userId, order_id: order.id, zinc_event: event.event };

  if (event.event === "order.delivered") {
    const { data, error } = await concierge.rpc("mark_delivered", { p_user_id: userId, p_order_id: order.id, p_by: "zinc" });
    if (error) throw new Error(`Marking the order delivered failed (${error.code}).`);
    const result = data?.[0];
    if (!result?.applied) {
      const now = await concierge.rpc("order_by_reference", { p_user_id: userId, p_order_id: order.id });
      logEvent("tracking.event_ignored", { ...ids, status: now.data?.[0]?.status ?? null });
      return;
    }
    logEvent("tracking.order_updated", { ...ids, status: "delivered" });
    if (result.round_status === "delivered") await tell(deps.tellDelivered, order.round_id, userId);
    return;
  }

  let packages: TrackedPackage[] | null = null;
  let est: string | null = null;
  if (event.event === "order.estimated_delivery_updated") {
    est = event.estimatedDelivery && day.test(event.estimatedDelivery) ? event.estimatedDelivery.slice(0, 10) : null;
    if (!est) {
      logEvent("tracking.event_ignored", { ...ids, reason: "no_estimate" });
      return;
    }
  } else {
    packages = packagesFromZinc(event.trackingNumbers);
    if ((await deps.setting("zinc_tracking_fetch_enabled")) === 1) {
      const fetched = await fetchPackages(userId, event.orderId, deps);
      if (fetched) {
        // Zinc's own order comes last, so its entry wins for a package both name.
        packages = [...packages, ...fetched];
        est = latestEstimate(fetched);
      }
    }
  }

  const { data: status, error } = await concierge.rpc("record_tracking", {
    p_user_id: userId,
    p_order_id: order.id,
    p_shipped: event.event === "order.shipped",
    p_packages: packages ? packagesToRows(packages) : null,
    // The generated types mark every argument required; SQL reads null as "leave the estimate".
    p_est: est as string,
    p_event_at: at,
  });
  if (error) throw new Error(`Saving tracking failed (${error.code}).`);
  if (status !== "placed" && status !== "shipped") {
    logEvent("tracking.event_ignored", { ...ids, status: status ?? null });
    return;
  }
  logEvent("tracking.order_updated", { ...ids, status });
}

/**
 * Zinc's Get Order (no charge in Zinc's docs; switched off by zinc_tracking_fetch_enabled) for
 * the carrier's estimate and Zinc's tracking link. Null on any failure: the event's own
 * packages are saved without an estimate, and a later event or the daily run catches up.
 */
async function fetchPackages(userId: string, zincOrderId: string, deps: TrackingDeps): Promise<TrackedPackage[] | null> {
  try {
    const key = await userZincKey(userId, deps);
    if (!key) return null;
    const order = await call(deps.http, "GET", `/orders/${encodeURIComponent(zincOrderId)}`, zincTracking, { key });
    return packagesFromZinc(order.tracking_numbers);
  } catch (error) {
    logEvent("tracking.estimate_fetch_failed", { user_id: userId, ...errorFields(error) });
    return null;
  }
}

async function tell(fn: ((roundId: string) => Promise<unknown>) | undefined, roundId: string, userId: string): Promise<void> {
  if (!fn) return;
  try {
    await fn(roundId);
  } catch (e) {
    // The daily run retries the email; Zinc mustn't retry an event that's done.
    logEvent("tracking.tell_deferred", { user_id: userId, round_id: roundId, ...errorFields(e) });
  }
}
