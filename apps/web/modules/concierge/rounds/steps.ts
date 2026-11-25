import { ideaRunWorstMs, isLastTick, nextAction, type CalendarDate, type RoundStatus, type RoundView, type ScheduleSettings, type StepKey } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import type { IdeaOutcome } from "../ideas/run";
import type { Funding } from "../notify/templates";
import { LeaseLost } from "./lease-lost";
import type { ClaimedRound, RoundContext, RoundFinish } from "./store";
import { money, sendEmail } from "./emails";
import type { StepDeps } from "./engine";

// Taking one ordinary step of a round: record the send, notify, finish (see engine.ts),
// plus the heads-up and the idea pass.

const FINISHED: RoundStatus[] = ["complete", "skipped", "ordered", "delivered"];

/** The engine's calendar day: the UTC day of `now`. */
export const dayOf = (now: Date): CalendarDate => now.toISOString().slice(0, 10);

/** A round due on a day is due from its first moment, so that day's tick picks it up. */
const startOf = (day: CalendarDate) => new Date(`${day}T00:00:00Z`);

/**
 * Whether a step stopped because the buyer changed the occasion's date, which ended the round:
 * a quiet stop, not a failure. A check that fails counts as no, so the failure is still seen.
 */
export async function endedByMove(err: unknown, round: ClaimedRound, deps: StepDeps): Promise<boolean> {
  if (!(err instanceof LeaseLost)) return false;
  try {
    if (!(await deps.store.endedByMove(round.id))) return false;
  } catch (check) {
    logEvent("round_move_check_failed", { round_id: round.id, user_id: round.userId, ...errorFields(check) });
    return false;
  }
  logEvent("round_ended_by_move", { round_id: round.id, user_id: round.userId });
  return true;
}

/** What giving a lease back came to. "ended": a date change had ended the round. "failed": the lease runs out by itself. */
export type Release = "released" | "ended" | "failed";

/** Gives a lease back without a step. Never throws: a failure is only logged, as the lease expires anyway. */
export async function releaseQuietly(round: ClaimedRound, deps: StepDeps): Promise<Release> {
  try {
    if (!(await deps.store.release(round.id, round.lockedUntil))) throw new LeaseLost();
    return "released";
  } catch (err) {
    if (await endedByMove(err, round, deps)) return "ended";
    logEvent("round_release_failed", { round_id: round.id, user_id: round.userId, ...errorFields(err) });
    return "failed";
  }
}

/**
 * The heads-up's low-balance warning (AC-11): what the next few weeks need against the
 * wallet, when auto top-up isn't known to be on. Only for a user with paid features and
 * Zinc connected; any Zinc error leaves it out rather than holding up the email.
 */
async function headsUpFunding(round: ClaimedRound, deps: StepDeps): Promise<Funding | undefined> {
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

/**
 * "None of these" brought nothing new and no search is left: the rejected ideas come back on offer
 * (T85). True when any did; the round stays generating, for sendHeadsUp. A failure (a database
 * without the function, say) never silences the round: the no-ideas email goes as if none came back.
 */
export async function restoreIdeas(round: ClaimedRound, { store, now }: StepDeps): Promise<boolean> {
  const ids = { round_id: round.id, user_id: round.userId };
  let back: { count: number; outcome: string | null };
  try {
    back = await store.restoreRejected(round.id, round.lockedUntil, now);
  } catch (err) {
    if (err instanceof LeaseLost) throw err;
    logEvent("round.ideas_restore_failed", { ...ids, ...errorFields(err), alert: true });
    // It may have worked and only its answer been lost.
    return (await store.roundContext(round.id)).ideas.length > 0;
  }
  if (back.count === 0) return false;
  logEvent("round.ideas_restored", { ...ids, ...back });
  return true;
}

export const isNoIdeas = (step: StepKey) => step === "no_ideas" || step === "no_ideas_again" || step === "no_ideas_late";

/** Sends the heads-up with the round's saved ideas and moves it to awaiting approval. */
export async function sendHeadsUp(round: ClaimedRound, deps: StepDeps, s: ScheduleSettings): Promise<void> {
  const ctx = await deps.store.roundContext(round.id);
  const sent = await deps.store.sentSteps(round.id);
  const funding = await headsUpFunding(round, deps);
  await sendStep(round, ctx, "heads_up", sent, deps, { funding });
  return finishStep(round, ctx, sent, { status: "awaiting_approval", headsUpOn: dayOf(deps.now) }, deps, s, "heads_up");
}

/** Outcomes that started a run, so they use one of the tick's idea_rounds_per_tick turns. */
const USES_TURN: IdeaOutcome["status"][] = ["saved", "none", "failed", "deadline", "cost_cap"];

/**
 * How one round's turn in the idea pass ended. "waiting": no step finished and the round stays due.
 * "busy": it isn't ours any more. `ideas`: what its run came to ("saved", "refused:busy"), or why
 * none started ("no_time", "no_turn"). `release`: how giving the lease back went, when that was all the turn did.
 */
export type IdeaTurn = { result: "advanced" | "waiting" | "busy" | "failed"; ideas?: string; release?: Release };

/**
 * The idea pass (ALL-27, design §5.1 "Long steps"): the rounds waiting for ideas, nearest
 * deadline first. Each run starts only while fewer than idea_rounds_per_tick have started and
 * its worst case fits before the tick's deadline; a refusal doesn't use a turn. Rounds that
 * get no turn are released, with no run counted, for the next tick. Once a run finds the AI
 * credit gone (no_credit), every later run would too, so the rest are released without one.
 * Returns one turn per round.
 */
export async function ideaPass(
  turns: ClaimedRound[],
  deps: StepDeps,
  s: ScheduleSettings,
  tickDeadline: number,
  /** A job's own cap (ALL-125), in place of reading idea_rounds_per_tick. */
  maxRuns?: number,
): Promise<IdeaTurn[]> {
  if (turns.length === 0) return [];
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
    const unread: IdeaTurn[] = [];
    for (const round of turns) unread.push({ result: "failed", release: await releaseQuietly(round, deps) });
    return unread;
  }

  const done: IdeaTurn[] = [];
  let started = 0;
  let noCredit = false;
  const byDeadline = [...turns].sort((a, b) => (a.shipByDeadline < b.shipByDeadline ? -1 : a.shipByDeadline > b.shipByDeadline ? 1 : 0));
  for (const claimed of byDeadline) {
    const noTurn = noCredit || started >= perTick;
    if (noTurn || tickDeadline - clock() < worstMs) {
      const release = await releaseQuietly(claimed, deps);
      // Ended by a date change: no run ended, so there's no outcome to tell.
      done.push(release === "ended" ? { result: "busy", release } : { result: "waiting", ideas: noTurn ? "no_turn" : "no_time", release });
      continue;
    }
    const ids = { round_id: claimed.id, user_id: claimed.userId, status: claimed.status };
    // Set as soon as the run ends, so a throw after it keeps what the run came to.
    let ideas: string | undefined;
    try {
      // Saved as `generating` first, so a run that dies is tried again from there.
      let round = claimed;
      if (round.status !== "generating") {
        const regained = await moveToGenerating(round, deps);
        if (!regained) {
          done.push({ result: "busy" }); // another run took it in between; it carries on
          continue;
        }
        round = regained;
      }
      // moveToGenerating let go of the lease for a moment, and another run may have told the buyer it's too late.
      if ((await store.sentSteps(round.id)).has("no_ideas_late")) {
        done.push({ result: "busy", release: await releaseQuietly(round, deps) });
        continue;
      }
      const outcome = await deps.generateIdeas(
        { id: round.id, userId: round.userId, personId: round.personId },
        AbortSignal.timeout(Math.max(0, tickDeadline - clock())),
      );
      ideas = cameTo(outcome);
      if (USES_TURN.includes(outcome.status)) started++;
      if (outcome.status === "no_credit") noCredit = true;
      const release = await afterIdeaRun(round, outcome, ideas, deps, s);
      if (release) done.push({ result: release === "ended" ? "busy" : "waiting", ideas, release });
      else done.push({ result: "advanced", ideas });
    } catch (err) {
      if (await endedByMove(err, claimed, deps)) {
        done.push({ result: "busy", ideas });
        continue;
      }
      logEvent("round_failed", { ...ids, ...errorFields(err) });
      done.push({ result: "failed", ideas });
    }
  }
  return done;
}

/** What a run came to, for the log: "none", "refused:busy" (a reason, never text). */
const cameTo = (outcome: IdeaOutcome) => (outcome.status === "refused" ? `refused:${outcome.reason}` : outcome.status);

/**
 * The too-late email, once. A refusal keeps the record, so no duplicate tick or job can run or tell
 * again before the ship-by day; the close then emails the buyer instead (lateEmailSent).
 */
export async function sendTooLate(round: ClaimedRound, ctx: RoundContext, sent: Set<StepKey>, deps: StepDeps): Promise<void> {
  if (await trySend(round, ctx, "no_ideas_late", sent, deps)) return;
  logEvent("round_too_late_email_failed", { round_id: round.id, user_id: round.userId });
  await deps.store.recordSend(round.id, round.userId, "no_ideas_late");
  sent.add("no_ideas_late");
}

/**
 * What a round does after its idea run (S1); `round` is generating, with its lease. Returns how the
 * release went when the round was only given back to wait; nothing when it took a step.
 */
async function afterIdeaRun(
  round: ClaimedRound,
  outcome: IdeaOutcome,
  ideas: string,
  deps: StepDeps,
  s: ScheduleSettings,
): Promise<Release | void> {
  const { store } = deps;
  const atDeadline = () => finishAt(round, startOf(round.shipByDeadline), deps, ideas);
  const release = async () => {
    const released = await releaseQuietly(round, deps);
    logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: round.status, step: `ideas:${ideas}` });
    return released;
  };
  switch (outcome.status) {
    case "saved":
      // None saved: the person was removed mid-run. The deadline closes the round.
      return outcome.count > 0 ? sendHeadsUp(round, deps, s) : atDeadline();
    case "off":
      return release();
    case "no_credit":
      // No AI was bought, so the round waits where it is, still due, until the credit is topped up (T87).
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
        case "closed":
          // The round ended while it waited for its run.
          throw new LeaseLost();
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
  // Now, not on the next tick: that one may be the ship-by day, which closes the round.
  if (await restoreIdeas(round, deps)) return sendHeadsUp(round, deps, s);
  // Read again: the run used up a run, or found the facts gone.
  const ctx = await store.roundContext(round.id);
  const sent = await store.sentSteps(round.id);
  if (isLastTick(dayOf(deps.now), round.shipByDeadline) && ctx.ideas.length === 0) {
    // No later tick can run or tell, so a run still allowed doesn't count, and the email goes now.
    // The round isn't due again before the ship-by day, so a duplicate tick or job can't run or tell twice.
    const action = nextAction({ ...view(round, ctx, sent), ideaRunsLeft: false }, dayOf(deps.now), s);
    if (action.do === "send" && isNoIdeas(action.send)) {
      await sendTooLate(round, ctx, sent, deps);
      return atDeadline();
    }
    if (action.do === "wait") return atDeadline();
  }
  return finishStep(round, ctx, sent, { status: "generating" }, deps, s, `ideas:${ideas}`);
}

/** Finishes the round at its status, to be looked at again at `at`. */
async function finishAt(round: ClaimedRound, at: Date, { store }: StepDeps, step: string): Promise<void> {
  if (!(await store.finish(round.id, round.lockedUntil, { status: round.status, nextActionAt: at }))) {
    throw new LeaseLost();
  }
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: round.status, step: `ideas:${step}` });
}

/** Saves `generating` and takes a fresh lease on the round, or null if someone else got it. */
export async function moveToGenerating(round: ClaimedRound, { store, now }: StepDeps): Promise<ClaimedRound | null> {
  const ok = await store.finish(round.id, round.lockedUntil, { status: "generating", nextActionAt: now });
  if (!ok) throw new LeaseLost();
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: "generating", step: null });
  return store.claim(round.id, now);
}

/** What some emails add to the round's own data. */
export type Extra = { funding?: Funding; partial?: { cancelled: string[]; onItsWay: string[]; coming: boolean } };

/** Records the step, then sends it; fails on a clean refusal, so the next tick tries again. */
export async function sendStep(
  round: ClaimedRound,
  ctx: RoundContext,
  step: StepKey,
  sent: Set<StepKey>,
  deps: StepDeps,
  extra: Extra = {},
): Promise<void> {
  if (!(await trySend(round, ctx, step, sent, deps, extra))) throw new Error(`Sending ${step} failed`);
}

/**
 * Records the step, then sends it. An already-recorded step isn't sent again (AC-11).
 * False on a clean refusal: nothing went out, so the record is forgotten. Throws LeaseLost, with
 * nothing recorded, when the round is no longer ours (its date changed, say).
 */
export async function trySend(
  round: ClaimedRound,
  ctx: RoundContext,
  step: StepKey,
  sent: Set<StepKey>,
  deps: StepDeps,
  extra: Extra = {},
): Promise<boolean> {
  if (!(await deps.store.holdsLease(round.id, round.lockedUntil))) throw new LeaseLost();
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
  { store, now }: StepDeps,
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
  if (!ok) throw new LeaseLost();
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: next.status, step });
}
