import { ideaRunWorstMs, nextAction, type CalendarDate, type RoundStatus, type RoundView, type ScheduleSettings, type StepKey } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import type { IdeaOutcome } from "../ideas/run";
import type { Funding } from "../notify/templates";
import type { ClaimedRound, RoundContext, RoundFinish } from "./store";
import { money, sendEmail } from "./emails";
import type { EngineDeps } from "./engine";

// Taking one ordinary step of a round: record the send, notify, finish (see engine.ts),
// plus the heads-up and the idea pass.

const FINISHED: RoundStatus[] = ["complete", "skipped", "ordered", "delivered"];

/** The engine's calendar day: the UTC day of `now`. */
export const dayOf = (now: Date): CalendarDate => now.toISOString().slice(0, 10);

/** A round due on a day is due from its first moment, so that day's tick picks it up. */
const startOf = (day: CalendarDate) => new Date(`${day}T00:00:00Z`);
/** Gives a lease back without a step; a failure is only logged, as the lease expires anyway. */
export async function releaseQuietly(round: ClaimedRound, deps: EngineDeps): Promise<void> {
  try {
    if (!(await deps.store.release(round.id, round.lockedUntil))) throw new Error("Lost the lease on the round");
  } catch (err) {
    logEvent("round_release_failed", { round_id: round.id, user_id: round.userId, ...errorFields(err) });
  }
}

/**
 * The heads-up's low-balance warning (AC-11): what the next few weeks need against the
 * wallet, when auto top-up isn't known to be on. Only for a user with paid features and
 * Zinc connected; any Zinc error leaves it out rather than holding up the email.
 */
async function headsUpFunding(round: ClaimedRound, deps: EngineDeps): Promise<Funding | undefined> {
  const { zinc, store } = deps;
  if (!zinc) return undefined;
  try {
    if (!(await store.canBuy(round.userId))) return undefined;
    const wallet = await zinc.wallet(round.userId);
    if (wallet.balanceCents === null || wallet.autoTopUp === true) return undefined;
    const [days, feeCents] = await Promise.all([store.setting("funding_lookahead_days"), store.setting("zinc_order_fee_cents")]);
    const due = await zinc.lookahead(round.userId, days, feeCents);
    if (due.cents <= wallet.balanceCents) return undefined;
    return {
      dueText: money(due.cents),
      haveText: money(wallet.balanceCents),
      atLeast: due.atLeast,
      windowText: days % 7 === 0 ? `the next ${days / 7 === 1 ? "week" : `${days / 7} weeks`}` : `the next ${days} days`,
      walletUrl: zinc.walletUrl,
    };
  } catch (err) {
    logEvent("heads_up_funding_failed", { round_id: round.id, user_id: round.userId, ...errorFields(err) });
    return undefined;
  }
}

export function view(round: ClaimedRound, ctx: RoundContext, sent: Set<StepKey>, placeTried = false, orderingPaused = false): RoundView {
  // A round whose ideas are saved needs no run, whatever the checks say now: its heads-up goes (B1).
  const hasIdeas = ctx.ideas.length > 0;
  return {
    status: round.status,
    shipByDeadline: round.shipByDeadline,
    headsUpOn: round.headsUpOn,
    hasAddress: ctx.hasAddress,
    hasSharedAddress: ctx.hasSharedAddress,
    sent,
    attentionReason: round.status === "needs_attention" ? round.attentionReason : null,
    holdCount: round.holdCount,
    seenBalanceCents: round.seenBalanceCents,
    emailedBalanceCents: round.emailedBalanceCents,
    placeTried,
    orderingPaused,
    hasInputs: hasIdeas || ctx.hasFacts || ctx.hasListGifts,
    ideaRunsLeft: hasIdeas || ctx.ideaRunsLeft,
    ranSinceNoIdeas: ctx.ranSinceNoIdeas,
    paid: ctx.paid,
    ideaEngineOn: ctx.ideaEngineOn,
  };
}

/** Sends the heads-up with the round's saved ideas and moves it to awaiting approval. */
export async function sendHeadsUp(round: ClaimedRound, deps: EngineDeps, s: ScheduleSettings): Promise<void> {
  const ctx = await deps.store.roundContext(round.id);
  const sent = await deps.store.sentSteps(round.id);
  const funding = await headsUpFunding(round, deps);
  await sendStep(round, ctx, "heads_up", sent, deps, { funding });
  return finishStep(round, ctx, sent, { status: "awaiting_approval", headsUpOn: dayOf(deps.now) }, deps, s, "heads_up");
}

/** Outcomes that started a run, so they use one of the tick's idea_rounds_per_tick turns. */
const USES_TURN: IdeaOutcome["status"][] = ["saved", "none", "failed", "deadline", "cost_cap"];

/**
 * The idea pass (ALL-27, design §5.1 "Long steps"): the rounds waiting for ideas, nearest
 * deadline first. Each run starts only while fewer than idea_rounds_per_tick have started and
 * its worst case fits before the tick's deadline; a refusal doesn't use a turn. Rounds that
 * get no turn are released, with no run counted, for the next tick. Once a run finds the AI
 * credit gone (no_credit), every later run would too, so the rest are released without one.
 */
export async function ideaPass(
  turns: ClaimedRound[],
  deps: EngineDeps,
  s: ScheduleSettings,
  tickDeadline: number,
  /** A job's own cap (ALL-125), in place of reading idea_rounds_per_tick. */
  maxRuns?: number,
): Promise<{ advanced: number; failed: number }> {
  if (turns.length === 0) return { advanced: 0, failed: 0 };
  const { store } = deps;
  const clock = deps.clock ?? Date.now;
  let worstMs: number;
  let perTick: number;
  try {
    const [rounds, aiMs, zincMs, listLookupsMax, zincPerSecond] = await Promise.all([
      maxRuns ?? store.setting("idea_rounds_per_tick"),
      store.setting("idea_ai_timeout_ms"),
      store.setting("idea_zinc_timeout_ms"),
      store.setting("idea_list_lookups_max"),
      store.setting("zinc_requests_per_second"),
    ]);
    perTick = rounds;
    worstMs = ideaRunWorstMs(aiMs, zincMs, listLookupsMax, zincPerSecond);
  } catch (err) {
    logEvent("ideas.pass_failed", { ...errorFields(err) });
    for (const round of turns) await releaseQuietly(round, deps);
    return { advanced: 0, failed: turns.length };
  }

  let advanced = 0;
  let failed = 0;
  let started = 0;
  let noCredit = false;
  const byDeadline = [...turns].sort((a, b) => (a.shipByDeadline < b.shipByDeadline ? -1 : a.shipByDeadline > b.shipByDeadline ? 1 : 0));
  for (const claimed of byDeadline) {
    if (noCredit || started >= perTick || tickDeadline - clock() < worstMs) {
      await releaseQuietly(claimed, deps);
      continue;
    }
    const ids = { round_id: claimed.id, user_id: claimed.userId, status: claimed.status };
    try {
      // Saved as `generating` first, so a run that dies is tried again from there.
      let round = claimed;
      if (round.status !== "generating") {
        const regained = await moveToGenerating(round, deps);
        if (!regained) continue; // another run took it in between; it carries on
        round = regained;
      }
      const outcome = await deps.generateIdeas(
        { id: round.id, userId: round.userId, personId: round.personId },
        AbortSignal.timeout(Math.max(0, tickDeadline - clock())),
      );
      if (USES_TURN.includes(outcome.status)) started++;
      if (outcome.status === "no_credit") noCredit = true;
      await afterIdeaRun(round, outcome, deps, s);
      advanced++;
    } catch (err) {
      logEvent("round_failed", { ...ids, ...errorFields(err) });
      failed++;
    }
  }
  return { advanced, failed };
}

/** What a round does after its idea run (S1); `round` is generating, with its lease. */
async function afterIdeaRun(round: ClaimedRound, outcome: IdeaOutcome, deps: EngineDeps, s: ScheduleSettings): Promise<void> {
  const { store } = deps;
  // What the run came to, for round_step: "none", "refused:busy" (a reason, never text).
  const ended = outcome.status === "refused" ? `refused:${outcome.reason}` : outcome.status;
  const atDeadline = () => finishAt(round, startOf(round.shipByDeadline), deps, ended);
  const release = async () => {
    await releaseQuietly(round, deps);
    logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: round.status, step: `ideas:${ended}` });
  };
  switch (outcome.status) {
    case "saved":
      // None saved: the person was removed mid-run. The deadline closes the round.
      return outcome.count > 0 ? sendHeadsUp(round, deps, s) : atDeadline();
    case "off":
      return release();
    case "no_credit":
      // No AI was bought, so the round waits where it is, still due, until the credit is topped up (T68).
      logEvent("ideas.no_credit", { round_id: round.id, user_id: round.userId, alert: true });
      return release();
    case "refused":
      switch (outcome.reason) {
        case "done":
          return sendHeadsUp(round, deps, s);
        case "busy":
          return release();
        case "daily_limit":
          // Today's runs are used up. Nothing failed, so the round stays due for the next tick.
          logEvent("ideas.daily_limit_reached", { round_id: round.id, user_id: round.userId, alert: true });
          return release();
        case "not_paid":
        case "not_found":
          return atDeadline();
        case "limit":
          break; // the plan sends no_ideas, or waits
      }
      break;
    case "none":
    case "failed":
    case "deadline":
    case "cost_cap":
    case "no_facts":
      break; // the plan decides: the next tick runs again, sends no_ideas, or waits
  }
  // Read again: the run used up a run, or found the facts gone.
  const ctx = await store.roundContext(round.id);
  const sent = await store.sentSteps(round.id);
  return finishStep(round, ctx, sent, { status: "generating" }, deps, s, `ideas:${ended}`);
}

/** Finishes the round at its status, to be looked at again at `at`. */
async function finishAt(round: ClaimedRound, at: Date, { store }: EngineDeps, step: string): Promise<void> {
  if (!(await store.finish(round.id, round.lockedUntil, { status: round.status, nextActionAt: at }))) {
    throw new Error("Lost the lease on the round");
  }
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: round.status, step: `ideas:${step}` });
}

/** Saves `generating` and takes a fresh lease on the round, or null if someone else got it. */
export async function moveToGenerating(round: ClaimedRound, { store, now }: EngineDeps): Promise<ClaimedRound | null> {
  const ok = await store.finish(round.id, round.lockedUntil, { status: "generating", nextActionAt: now });
  if (!ok) throw new Error("Lost the lease on the round");
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: "generating", step: null });
  return store.claim(round.id, now);
}

/** What some emails add to the round's own data. */
export type Extra = { funding?: Funding; partial?: { cancelled: string[]; onItsWay: string[] } };

/** Records the step, then sends it; fails on a clean refusal, so the next tick tries again. */
export async function sendStep(
  round: ClaimedRound,
  ctx: RoundContext,
  step: StepKey,
  sent: Set<StepKey>,
  deps: EngineDeps,
  extra: Extra = {},
): Promise<void> {
  if (!(await trySend(round, ctx, step, sent, deps, extra))) throw new Error(`Sending ${step} failed`);
}

/**
 * Records the step, then sends it. An already-recorded step isn't sent again (AC-11).
 * False on a clean refusal: nothing went out, so the record is forgotten.
 */
export async function trySend(
  round: ClaimedRound,
  ctx: RoundContext,
  step: StepKey,
  sent: Set<StepKey>,
  deps: EngineDeps,
  extra: Extra = {},
): Promise<boolean> {
  const fresh = await deps.store.recordSend(round.id, round.userId, step);
  sent.add(step);
  if (!fresh) return true;
  const result = await sendEmail(step, round, ctx, deps, extra);
  if (result.ok) return true;
  sent.delete(step);
  await deps.store.forgetSend(round.id, step);
  return false;
}

/** Writes the new status and when to look again, and releases the lease. */
export async function finishStep(
  round: ClaimedRound,
  ctx: RoundContext,
  sent: Set<StepKey>,
  next: Omit<RoundFinish, "nextActionAt">,
  { store, now }: EngineDeps,
  s: ScheduleSettings,
  step: StepKey | `ideas:${string}` | null = null,
): Promise<void> {
  const after = { ...round, status: next.status, headsUpOn: next.headsUpOn ?? round.headsUpOn };
  let nextActionAt: Date | null = null;
  if (!FINISHED.includes(next.status)) {
    const upcoming = nextAction(view(after, ctx, sent), dayOf(now), s);
    nextActionAt = upcoming.do === "wait" ? startOf(upcoming.until) : now;
  }
  const ok = await store.finish(round.id, round.lockedUntil, { ...next, nextActionAt });
  if (!ok) throw new Error("Lost the lease on the round");
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: next.status, step });
}
