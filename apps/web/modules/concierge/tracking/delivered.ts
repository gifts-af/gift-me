import { shortDate } from "@/lib/occasion-format";
import { errorFields, logEvent } from "@/lib/log";
import { notify, type NotifyDeps } from "../notify/notify";
import { occasionWord } from "../rounds/emails";
import type { RoundStore } from "../rounds/store";

// The delivered email (ALL-33 AC-11, AC-13): one email when every gift of an occasion has
// arrived, claimed once as the round's `delivered` key in round_sends. The webhook that delivers
// the last gift tells it at once; the tick tells any round that missed it (a refused send gives
// the key back).

// A gift not yet in the buyer's hands, so the round isn't done.
const NOT_YET = ["held", "placing", "unconfirmed", "placed", "shipped"];

/**
 * Tells the buyer that all of a round's gifts arrived. "none": nothing to tell (no delivered gift,
 * a gift still on its way, or already told by another run). "refused": the email didn't go and
 * the key was given back, so the next tick tries again.
 */
export async function tellDelivered(roundId: string, deps: { store: RoundStore; notify: NotifyDeps }): Promise<"sent" | "none" | "refused"> {
  const { store } = deps;
  const ctx = await store.roundContext(roundId);
  const delivered = ctx.orders.filter((o) => o.status === "delivered");
  if (delivered.length === 0 || ctx.orders.some((o) => NOT_YET.includes(o.status))) return "none";
  if (!(await store.recordSend(roundId, ctx.userId, "delivered"))) return "none";
  let ok = false;
  let threw = false;
  try {
    const result = await notify(
      {
        userId: ctx.userId,
        roundId,
        kind: "delivered",
        data: {
          personName: ctx.personName,
          occasion: occasionWord(ctx.occasionKind),
          dateText: shortDate(ctx.occasionDate),
          // mark_delivered always sets delivered_at; a row without one says "Delivered", never a guessed date.
          gifts: delivered.map((o) => ({ title: o.title, ...(o.deliveredAt ? { deliveredText: shortDate(o.deliveredAt.slice(0, 10)) } : {}) })),
        },
        links: { open: { path: `/rounds/${roundId}` } },
      },
      deps.notify,
    );
    ok = result.ok;
  } catch (err) {
    threw = true;
    logEvent("tracking.delivered_email_failed", { round_id: roundId, user_id: ctx.userId, ...errorFields(err), alert: true });
  }
  if (ok) {
    logEvent("tracking.delivered_sent", { round_id: roundId, user_id: ctx.userId });
    return "sent";
  }
  await store.forgetSend(roundId, "delivered");
  if (!threw) logEvent("tracking.delivered_email_failed", { round_id: roundId, user_id: ctx.userId, alert: true });
  return "refused";
}

/** The tick's retry: every delivered round whose email isn't recorded. One failing round never stops the rest. */
export async function retryDeliveredEmails(deps: { store: RoundStore; notify: NotifyDeps }): Promise<void> {
  for (const { roundId } of await deps.store.deliveredRoundsUntold()) {
    try {
      await tellDelivered(roundId, deps);
    } catch (err) {
      logEvent("tracking.delivered_email_failed", { round_id: roundId, ...errorFields(err), alert: true });
    }
  }
}
