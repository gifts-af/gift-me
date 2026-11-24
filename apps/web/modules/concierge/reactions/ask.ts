import { RATINGS } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { shortDate } from "@/lib/occasion-format";
import { notify, type NotifyDeps, type NotifyResult } from "../notify/notify";
import { occasionWord } from "../rounds/emails";
import type { RoundStore } from "../rounds/store";

// Asking how the gifts went over, from the daily tick: rounds that are done close first, then each
// round due today gets one email, claimed once as its `reaction_prompt` key in round_sends. SQL
// decides what closes and what's due; switched off, both find nothing.

type AskDeps = { store: RoundStore; notify: NotifyDeps; now: Date };
type DueRound = { roundId: string; userId: string };

/** One round that fails never stops the rest. */
export async function runReactions(deps: AskDeps): Promise<{ closed: number; asked: number }> {
  // The UTC day, as the tick counts days.
  const today = deps.now.toISOString().slice(0, 10);
  const closed = await deps.store.closeReactedRounds(today);
  let asked = 0;
  for (const round of await deps.store.reactionsDue(today)) {
    if (await ask(round, deps)) asked++;
  }
  return { closed, asked };
}

/** Never throws. False: nothing was sent, and a key this run claimed was given back (best effort). */
async function ask({ roundId, userId }: DueRound, deps: AskDeps): Promise<boolean> {
  const failed = (err?: unknown) =>
    logEvent("reactions.ask_failed", { ...(err === undefined ? {} : errorFields(err)), round_id: roundId, user_id: userId, alert: true });
  try {
    if (!(await deps.store.recordSend(roundId, userId, "reaction_prompt"))) return false;
  } catch (err) {
    failed(err);
    return false;
  }
  try {
    const result = await send(roundId, userId, deps);
    if (result?.ok) return true;
    if (result) failed();
  } catch (err) {
    failed(err);
  }
  try {
    await deps.store.forgetSend(roundId, "reaction_prompt");
  } catch (err) {
    failed(err);
  }
  return false;
}

/** Null when there's nothing left to ask about. Read after the claim, so a gift just answered isn't asked about. */
async function send(roundId: string, userId: string, { store, notify: notifyDeps }: AskDeps): Promise<NotifyResult | null> {
  const round = await store.reactionGifts(roundId);
  if (!round || round.gifts.length === 0) return null;
  // Plain links: opening one only chooses the answer on the page, and Save keeps it.
  const links = Object.fromEntries(
    round.gifts.flatMap((g, i) => RATINGS.map((r) => [`${r}${i}`, { path: `/rounds/${roundId}/reaction?gift=${g.orderId}&r=${r}` }])),
  );
  return notify(
    {
      userId,
      roundId,
      kind: "reaction_prompt",
      data: {
        personName: round.personName,
        occasion: occasionWord(round.occasionKind),
        dateText: shortDate(round.occasionDate),
        gifts: round.gifts.map((g) => ({ title: g.title })),
      },
      links,
    },
    notifyDeps,
  );
}
