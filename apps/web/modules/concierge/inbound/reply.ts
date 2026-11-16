import { errorFields, logEvent } from "@/lib/log";
import { notify, type NotifyDeps, type NotifyInput } from "../notify/notify";
import type { NotificationKind } from "../notify/templates";
import type { InboundStore } from "./store";

// An email sent back about an emailed note (ALL-31): from the webhook's handler and from the
// "Who is this about?" buttons.

export type ReplyDeps = {
  store: Pick<InboundStore, "countToday" | "recordEvent">;
  /** inbound_max_per_user_per_day. */
  maxPerDay: number;
  notify: NotifyDeps;
};

/**
 * Every email sent back counts toward the daily cap, so a reply that would go over it isn't
 * sent (AC-11). It's counted before sending so a failing send can't loop uncounted. A failed
 * send is logged and never thrown; the note itself is already handled. `ids`: the caller's
 * ids for the events (E6), on top of the user and the kind.
 */
export async function sendInboundReply<K extends NotificationKind>(
  input: NotifyInput<K>,
  deps: ReplyDeps,
  ids: Record<string, string>,
): Promise<void> {
  const fields = { ...ids, user_id: input.userId, kind: input.kind };
  try {
    if ((await deps.store.countToday(input.userId)) >= deps.maxPerDay) {
      logEvent("inbound.reply_capped", fields);
      return;
    }
    await deps.store.recordEvent(input.userId);
    const result = await notify(input, deps.notify);
    if (!result.ok) logEvent("inbound.reply_failed", fields);
  } catch (err) {
    logEvent("inbound.reply_failed", { ...fields, ...errorFields(err) });
  }
}
