import { errorFields, logEvent } from "@/lib/log";
import { notify, type NotifyDeps } from "../notify/notify";
import type { InboundStore } from "./store";

export type TipDeps = {
  store: Pick<InboundStore, "claimFlag">;
  notify: NotifyDeps;
  /** Where replies to the tip go: the inbound notes address. */
  notesAddress: string;
};

/**
 * The "Did you know" email, sent once per user when their first person is added (ALL-31 AC-15).
 * Claims the one-time flag first, so two people added at once still send one tip. Replies to it
 * file to that person, because the notification row carries their id. Never throws: adding a
 * person must not fail because a tip did.
 */
export async function sendNotesTipOnce(
  userId: string,
  person: { id: string; name: string },
  deps: TipDeps,
): Promise<void> {
  const fields = { user_id: userId, person_id: person.id };
  try {
    if (!(await deps.store.claimFlag(userId, "notes_tip_sent_at"))) return;
    const result = await notify(
      {
        userId,
        personId: person.id,
        kind: "notes_tip",
        data: { personName: person.name },
        links: {},
        replyTo: deps.notesAddress,
      },
      deps.notify,
    );
    if (!result.ok) logEvent("inbound.tip_failed", fields);
  } catch (err) {
    logEvent("inbound.tip_failed", { ...fields, ...errorFields(err) });
  }
}
