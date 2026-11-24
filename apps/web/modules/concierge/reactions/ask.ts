import { compareDates, RATINGS } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import { shortDate } from "@/lib/occasion-format";
import { notify, type NotifyDeps, type NotifyResult } from "../notify/notify";
import { occasionWord } from "../rounds/emails";
import type { ReactionAsk, RoundStore } from "../rounds/store";

// Asking how the gifts went over, from the daily tick: rounds that are done close first, then each
// buyer gets one email about all their rounds due today. Each round is claimed once, as its
// `reaction_prompt` key in round_sends. SQL decides what closes and what's due; switched off, both
// find nothing.

type AskDeps = { store: RoundStore; notify: NotifyDeps; now: Date };
type ClaimedAsk = { roundId: string; ask: ReactionAsk };

/** `asked` counts rounds. One buyer or round that fails never stops the rest, nor does a failed close. */
export async function runReactions(deps: AskDeps): Promise<{ closed: number; asked: number }> {
  // The UTC day, as the tick counts days.
  const today = deps.now.toISOString().slice(0, 10);
  let closed = 0;
  let closeFailed: { err: unknown } | null = null;
  try {
    closed = await deps.store.closeReactedRounds(today);
  } catch (err) {
    closeFailed = { err };
  }
  const byUser = new Map<string, string[]>();
  for (const { roundId, userId } of await deps.store.reactionsDue(today)) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), roundId]);
  }
  let asked = 0;
  for (const [userId, roundIds] of byUser) asked += await askBuyer(userId, roundIds, deps);
  // Last, so it can't stop the asking; the tick alerts.
  if (closeFailed) throw closeFailed.err;
  return { closed, asked };
}

function failed(phase: "claim" | "read" | "send" | "forget", userId: string, roundId: string, err?: unknown) {
  logEvent("reactions.ask_failed", { ...(err === undefined ? {} : errorFields(err)), phase, round_id: roundId, user_id: userId, alert: true });
}

/** How many of the buyer's rounds were asked about. Never throws: a round that wasn't gives its key back (best effort). */
async function askBuyer(userId: string, roundIds: string[], deps: AskDeps): Promise<number> {
  const claimed: ClaimedAsk[] = [];
  for (const roundId of roundIds) {
    const ask = await claim(userId, roundId, deps);
    if (ask) claimed.push({ roundId, ask });
  }
  if (claimed.length === 0) return 0;
  // Earliest occasion first; the round id settles ties, since SQL gives no order.
  claimed.sort((a, b) => compareDates(a.ask.occasionDate, b.ask.occasionDate) || (a.roundId < b.roundId ? -1 : 1));
  try {
    const result = await send(userId, claimed, deps);
    if (result.ok) return claimed.length;
    for (const c of claimed) failed("send", userId, c.roundId);
  } catch (err) {
    for (const c of claimed) failed("send", userId, c.roundId, err);
  }
  for (const c of claimed) await giveBack(userId, c.roundId, deps);
  return 0;
}

/** Claims the round, then reads its unanswered gifts, so one just answered isn't asked about. Null: leave it out. */
async function claim(userId: string, roundId: string, deps: AskDeps): Promise<ReactionAsk | null> {
  try {
    if (!(await deps.store.recordSend(roundId, userId, "reaction_prompt"))) return null;
  } catch (err) {
    failed("claim", userId, roundId, err);
    return null;
  }
  try {
    const ask = await deps.store.reactionGifts(roundId);
    if (ask && ask.gifts.length > 0) return ask;
  } catch (err) {
    failed("read", userId, roundId, err);
  }
  await giveBack(userId, roundId, deps);
  return null;
}

async function giveBack(userId: string, roundId: string, deps: AskDeps): Promise<void> {
  try {
    await deps.store.forgetSend(roundId, "reaction_prompt");
  } catch (err) {
    failed("forget", userId, roundId, err);
  }
}

function send(userId: string, claimed: ClaimedAsk[], deps: AskDeps): Promise<NotifyResult> {
  const gifts = claimed.flatMap(({ roundId, ask }) => ask.gifts.map((g) => ({ roundId, orderId: g.orderId })));
  // Plain links: opening one only chooses the answer on the page, and Save keeps it.
  const links = Object.fromEntries(
    gifts.flatMap((g, i) => RATINGS.map((r) => [`${r}${i}`, { path: `/rounds/${g.roundId}/reaction?gift=${g.orderId}&r=${r}` }])),
  );
  const rounds = claimed.map(({ ask }) => ({
    personName: ask.personName,
    occasion: occasionWord(ask.occasionKind),
    dateText: shortDate(ask.occasionDate),
    gifts: ask.gifts.map((g) => ({ title: g.title })),
  }));
  // An email about several rounds belongs to none of them, like the tracking news.
  const base = { userId, ...(claimed.length === 1 ? { roundId: claimed[0].roundId } : {}) };
  return notify({ ...base, kind: "reaction_prompt", data: { rounds }, links }, deps.notify);
}
