import { nextAction, roundToCreate, toldBefore, type ScheduleSettings } from "@gifts-af/core";
import { errorFields, logEvent } from "@/lib/log";
import type { IdeaOutcome } from "../ideas/run";
import type { NotifyDeps } from "../notify/notify";
import { planJobs, type JobMessage, type SendJobs } from "./fanout";
import type { ClaimedRound, RoundStore } from "./store";
import { retryDeliveredEmails } from "../tracking/delivered";
import { runHeld, retryOrderedEmails, tellOwnerOfRejection, tellOwnersOfRejections } from "./money-path";
import { dayOf, releaseQuietly, view, sendHeadsUp, ideaPass, moveToGenerating, sendStep, trySend, finishStep } from "./steps";

// The round engine (ALL-28, design §5.1). The daily tick creates rounds that
// are due, then claims each due round with a lease and runs its next step:
// one email, a status move, and the day to look again. What to do is decided
// in packages/core (round-plan.ts); this file only carries it out.
//
// One step, in order: record the send → notify → (on a clean refusal: forget
// the send and fail; the deadline skip finishes anyway) → finish. A step that dies after recording keeps the
// record, so a retry never sends the same email twice (AC-11). A step that
// fails leaves its lease to expire and is retried by the next tick (AC-12).
//
// Money-path rounds (needs_attention, ALL-32) never use finish: their status
// belongs to reconcile_round, which every money-path SQL function calls. The
// engine sends the hold and failure emails, retries placing, closes the round
// at its deadline through cancel_held, and gives the lease back with
// release_round (plan, "How reconcile_round decides").
//
// Gift ideas (ALL-27, design §5.1 "Long steps"): a round whose next step is an idea run keeps
// its lease while the tick finishes everything else, money path first. Then the idea pass runs
// the rounds nearest their deadline, idea_rounds_per_tick at most, and only while the run's
// worst case still fits before tick_deadline_ms. The rest are released for the next tick.
// The deadline bounds only the idea pass: it never releases a held or other money round.


export type GenerateIdeas = (
  round: { id: string; userId: string; personId: string },
  signal: AbortSignal,
) => Promise<IdeaOutcome>;

/** The buying side, bound by the caller from the Zinc wiring; null where Zinc is off (E3). */
export type EngineZinc = {
  /**
   * placeRound with the round's lease held; it never writes round status. `deadlineMs` (on the
   * engine's clock) is the run's one placing budget (zinc_place_budget_ms): no POST starts after it.
   */
  placeRound: (roundId: string, lock: Date, deadlineMs: number, opts?: { address?: boolean }) => Promise<unknown>;
  /** Settles orders left placing (sweepStalePlacing); runs first on each tick. */
  sweep: () => Promise<unknown>;
  /** The user's wallet; only called for a user with paid features and Zinc connected (AC-11). */
  wallet: (userId: string) => Promise<{ balanceCents: number | null; autoTopUp: boolean | null }>;
  /** What the user's rounds due within `days` will need (lookaheadCents). */
  lookahead: (userId: string, days: number, feeCents: number) => Promise<{ cents: number; atLeast: boolean }>;
  /** The user's Zinc wallet page, for "Top up your Zinc balance". */
  walletUrl: string;
};

export type EngineDeps = {
  store: RoundStore;
  notify: NotifyDeps;
  now: Date;
  generateIdeas: GenerateIdeas;
  zinc: EngineZinc | null;
  /** Milliseconds, for the placing budget and the tick's deadline; Date.now when left out. */
  clock?: () => number;
  /** The daily clear-out of unfiled emailed notes (ALL-31), bound by the caller (E3). */
  clearUnfiledNotes?: () => Promise<{ cleared: number; imagesRemoved: number }>;
  /** Deletes emailed buttons long past expiry and returns how many, bound by the caller (E3). */
  pruneActionLinks?: () => Promise<number>;
  /** The daily tracking news (ALL-33): late, back-on-time and late store-cancel news, one email per buyer. */
  trackingNews?: () => Promise<{ sent: number }>;
  /** Queues due rounds for their own function calls (ALL-125); the tick runs them itself without it. */
  sendJobs?: SendJobs;
  /** A test clock: queued messages carry the tick's `now`. */
  testClock?: boolean;
};

/** `failed` includes `fanoutFailed`, the fan-out's sends that failed, set only when it fanned out. */
export type TickSummary = { enabled: boolean; created: number; advanced: number; failed: number; fanoutFailed?: number };

/** "off": the engine is switched off (`round_engine_enabled`), so nothing was touched. */
export type AdvanceResult = "advanced" | "busy" | "failed" | "off";


async function engineOn(store: RoundStore): Promise<boolean> {
  return (await store.setting("round_engine_enabled")) === 1;
}

export async function runTick(deps: EngineDeps): Promise<TickSummary> {
  const { store, now } = deps;
  const clock = deps.clock ?? Date.now;
  const startedMs = clock();
  // The money path runs whatever round_engine_enabled says (owner): the sweep, the "ordered"
  // retry and the rounds that need attention. The switch stops round creation, ideas and the
  // approval reminders; ordering itself has its own switch (zinc_ordering_enabled).
  const on = await engineOn(store);

  // Orders left placing are settled first, so their rounds below see the outcome.
  if (deps.zinc) {
    try {
      await deps.zinc.sweep();
    } catch (err) {
      logEvent("order.sweep_run_failed", { ...errorFields(err) });
    }
  }
  // "Ordered" emails the service refused before (or orders settled by hand) go out now.
  try {
    await retryOrderedEmails(deps);
  } catch (err) {
    logEvent("order.ordered_retry_failed", { ...errorFields(err) });
  }
  // Delivered emails the service refused before go out now (ALL-33), on their own so a failure
  // can't stop the tick.
  try {
    await retryDeliveredEmails(deps);
  } catch (err) {
    logEvent("tracking.delivered_retry_failed", { ...errorFields(err), alert: true });
  }

  // Emailed notes nobody filed are cleared, and old dedupe rows pruned. Housekeeping, so it runs
  // whatever round_engine_enabled says, and its failure never stops the tick.
  if (deps.clearUnfiledNotes) {
    try {
      const result = await deps.clearUnfiledNotes();
      if (result.cleared > 0) logEvent("inbound.notes_cleared", { ...result });
    } catch (err) {
      logEvent("inbound.notes_clear_failed", { ...errorFields(err) });
    }
  }

  // Spent emailed buttons are deleted. Housekeeping too, on its own so it can't fail the clear-out
  // above or the tick; action_link_prune_days at 0 turns it off.
  if (deps.pruneActionLinks) {
    try {
      const deleted = await deps.pruneActionLinks();
      logEvent("housekeeping.action_links_pruned", { deleted });
    } catch (err) {
      logEvent("housekeeping.action_links_prune_failed", { ...errorFields(err) });
    }
  }

  // The tracking news is told only from here (owner, 2026-11-23), on its own so it can't fail the
  // tick. It runs whatever round_engine_enabled says: store cancels are always told, and the late
  // check has its own switch (late_check_enabled).
  if (deps.trackingNews) {
    try {
      const { sent } = await deps.trackingNews();
      logEvent("tracking.news_run", { sent });
    } catch (err) {
      logEvent("tracking.news_run_failed", { ...errorFields(err), alert: true });
    }
  }

  // Fan-out (ALL-125): with the switch on, due rounds go to the queue and jobs run them. An
  // unreadable switch means off.
  let fanout = false;
  // Without sendJobs the switch isn't read, so callers that don't fan out run exactly as before.
  if (deps.sendJobs) {
    try {
      fanout = (await store.setting("round_fanout_enabled")) === 1;
    } catch {
      logEvent("round_fanout_setting_unreadable", {});
    }
  }
  // `deps.sendJobs` again only so TypeScript knows it's set.
  if (fanout && deps.sendJobs) {
    const { created, failed: createFailed } = on ? await createDueRounds(deps, await store.scheduleSettings()) : { created: 0, failed: 0 };
    await tellOwnersOfRejections(deps);
    const due = await store.dueRounds(now);
    const result = await deps.sendJobs(planJobs(due, on, now, deps.testClock ?? false));
    logEvent("round_fanout", { enabled: on, due: due.length, sent: result.sent, failed: result.failed });
    if (result.failed > 0) logEvent("round_fanout_send_failed", { count: result.failed, alert: true });
    const summary = { enabled: on, created, advanced: 0, failed: createFailed + result.failed, fanoutFailed: result.failed };
    logEvent("round_tick", summary);
    return summary;
  }

  const s = await store.scheduleSettings();
  // One placing budget for the whole tick, shared by every round it places (zinc_place_budget_ms).
  const placeBy = await placeDeadline(deps);
  if (!on) {
    let advanced = 0;
    let failed = 0;
    for (const round of await store.claimDueMoney(now)) {
      const result = await advanceClaimed(round, deps, s, false, placeBy);
      if (result === "failed") failed++;
      else advanced++;
      // Money rounds never need ideas; if one ever did, its lease goes back rather than being held.
      if (typeof result === "object") await releaseQuietly(result.generate, deps);
    }
    await tellOwnersOfRejections(deps);
    const summary = { enabled: false, created: 0, advanced, failed };
    logEvent("round_tick", summary);
    return summary;
  }
  const { created, failed: createFailed } = await createDueRounds(deps, s);

  // One after another, each on its own: one failing round can't stop the rest.
  // `failed` counts occasions that couldn't be created and rounds that failed.
  // claim_due_rounds hands back held rounds first, earliest deadline first (AC-21).
  let advanced = 0;
  let failed = createFailed;
  const ideaTurns: ClaimedRound[] = [];
  // No deadline here: held gifts and every other step run as they always have (controller ruling).
  for (const round of await store.claimDue(now)) {
    const result = await advanceClaimed(round, deps, s, false, placeBy);
    if (result === "advanced") advanced++;
    else if (result === "failed") failed++;
    else ideaTurns.push(result.generate);
  }
  await tellOwnersOfRejections(deps);

  // Last, so a slow AI or Zinc call can't hold up the money path or the emails above.
  // tick_deadline_ms bounds only this pass: no run starts past it, and each run's signal ends at it.
  // Unreadable, the idea pass is skipped (its rounds are released for the next tick).
  let tickDeadline: number | null = null;
  try {
    tickDeadline = startedMs + (await store.setting("tick_deadline_ms"));
  } catch (err) {
    logEvent("round_tick_deadline_unreadable", { ...errorFields(err) });
  }
  if (tickDeadline === null) {
    for (const round of ideaTurns) await releaseQuietly(round, deps);
  } else {
    const ideas = await ideaPass(ideaTurns, deps, s, tickDeadline);
    advanced += ideas.advanced;
    failed += ideas.failed;
  }

  const summary = { enabled: true, created, advanced, failed };
  logEvent("round_tick", summary);
  return summary;
}

/**
 * What one queue job came to (ALL-125). "off": the fan-out switch (or, for a round message, the
 * engine) is off. "busy": nothing was run, because another run holds the round, it's no longer
 * due, or it belongs to the other kind of message now.
 */
export type JobResult = "off" | "busy" | "advanced" | "failed";

/**
 * Runs one queue message (ALL-125): one round, or one buyer's held gifts. Every round is claimed
 * first (claim_round), so a step never runs twice at once and placing never runs on a round
 * someone else holds. Throws only when it fails before claiming any round (a setting it reads
 * first, the fan-out switch among them, couldn't be read): no lease is held, so handleJob
 * rethrows and the queue redelivers, which a deadline-day held gift can't wait a day for. A
 * failure once a round is claimed is logged and returns "failed": the lease stands, and the next
 * tick (and round_stuck) picks the round up.
 */
export async function runRoundJob(message: JobMessage, deps: EngineDeps): Promise<JobResult> {
  const jobStartMs = (deps.clock ?? Date.now)();
  const id: Record<string, string> = message.kind === "round" ? { round_id: message.roundId } : { user_id: message.userId };
  const progress: JobProgress = { claimed: false };
  let result: JobResult;
  let rounds = 0;
  try {
    if ((await deps.store.setting("round_fanout_enabled")) !== 1) result = "off";
    else if (message.kind === "round") ({ result, rounds } = await roundJob(message.roundId, deps, jobStartMs, progress));
    else ({ result, rounds } = await buyerJob(message.roundIds, deps, progress));
  } catch (err) {
    // Before any claim, handleJob logs it (with the alert) as it rethrows.
    if (!progress.claimed) throw err;
    logEvent("round_job", { ...errorFields(err), kind: message.kind, result: "failed", ...id, rounds });
    return "failed";
  }
  logEvent("round_job", { kind: message.kind, result, ...id, rounds });
  return result;
}

type JobOutcome = { result: JobResult; rounds: number };
/** Set once the job holds a round's lease: from then on a failure is acknowledged, not redelivered. */
type JobProgress = { claimed: boolean };

/** A round message: the round's step, and its idea run when that's the step (one run, no per-tick cap). */
async function roundJob(roundId: string, deps: EngineDeps, jobStartMs: number, progress: JobProgress): Promise<JobOutcome> {
  const { store } = deps;
  if (!(await engineOn(store))) return { result: "off", rounds: 0 };
  // Before the claim, so a failed read never leaves a lease held for round_lock_minutes.
  const s = await store.scheduleSettings();
  const round = await store.claim(roundId, deps.now);
  if (!round) return { result: "busy", rounds: 0 };
  progress.claimed = true;
  if (round.status === "needs_attention") {
    // It became a money round after the tick read it: the next tick's buyer message takes it.
    await releaseQuietly(round, deps);
    return { result: "busy", rounds: 0 };
  }
  const step = await advanceClaimed(round, deps, s, false, 0);
  if (step === "advanced") return { result: "advanced", rounds: 1 };
  if (step === "failed") return { result: "failed", rounds: 0 };
  let deadlineMs: number;
  try {
    deadlineMs = await store.setting("tick_deadline_ms");
  } catch (err) {
    // As on the tick: no run without a deadline; the round stays due.
    logEvent("round_tick_deadline_unreadable", { ...errorFields(err) });
    await releaseQuietly(step.generate, deps);
    return { result: "failed", rounds: 0 };
  }
  const ideas = await ideaPass([step.generate], deps, s, jobStartMs + deadlineMs, 1);
  if (ideas.advanced > 0) return { result: "advanced", rounds: 1 };
  return { result: ideas.failed > 0 ? "failed" : "busy", rounds: 0 };
}

/**
 * A buyer message: each of the buyer's held rounds in order, with one placing budget for the
 * message. Runs whatever round_engine_enabled says, like the money path on the tick.
 */
async function buyerJob(roundIds: string[], deps: EngineDeps, progress: JobProgress): Promise<JobOutcome> {
  const { store } = deps;
  // Unreadable, the job throws before any claim, and the queue redelivers it.
  const on = await engineOn(store);
  const s = await store.scheduleSettings();
  const placeBy = await placeDeadline(deps);
  let advanced = 0;
  let failed = 0;
  const claimedIds: string[] = [];
  for (const roundId of roundIds) {
    let round: ClaimedRound | null;
    try {
      round = await store.claim(roundId, deps.now);
    } catch (err) {
      // Nothing claimed yet: no lease is held, so let the queue redeliver (and alert).
      if (!progress.claimed) throw err;
      logEvent("round_failed", { round_id: roundId, ...errorFields(err) });
      failed++;
      continue;
    }
    // Approved, skipped or otherwise moved on since the tick, or someone else holds it.
    if (!round) continue;
    progress.claimed = true;
    if (round.status !== "needs_attention" && !on) {
      // It left the money path, and the engine is off: nothing of its runs now.
      await releaseQuietly(round, deps);
      continue;
    }
    const step = await advanceClaimed(round, deps, s, false, placeBy);
    if (step === "advanced") advanced++;
    else if (step === "failed") failed++;
    // An idea run belongs to a round message: the next tick sends one.
    else await releaseQuietly(step.generate, deps);
    claimedIds.push(roundId);
  }
  // A store that refused a shared address while placing: its owner hears now, as on the inline
  // tick, not at tomorrow's tick (a deadline-day close doesn't tell them itself).
  if (claimedIds.length > 0) {
    try {
      const rejected = new Set(await store.roundsWithRejectedAddresses());
      for (const id of claimedIds) if (rejected.has(id)) await tellOwnerOfRejection(id, deps);
    } catch (err) {
      logEvent("order.shared_address_notice_failed", { ...errorFields(err), alert: true });
    }
  }
  const result: JobResult = failed > 0 ? "failed" : advanced > 0 ? "advanced" : "busy";
  return { result, rounds: advanced };
}

/**
 * Moves one round on now, if it's due and no one else holds it (AC-10). `justPlaced`: the
 * caller (approval, a webhook, the sweep, placing held gifts) has just tried placing it, so
 * the engine only tells the buyer, and claims it whatever its next_action_at (claimNow):
 * reconcile_round set that from the database's clock, after the caller's `now` was taken.
 */
export async function advanceRound(
  roundId: string,
  deps: EngineDeps,
  opts: { justPlaced?: boolean } = {},
): Promise<AdvanceResult> {
  // A just-placed round is on the money path, which runs with the engine off too (owner).
  if (!opts.justPlaced && !(await engineOn(deps.store))) return "off";
  const round = opts.justPlaced ? await deps.store.claimNow(roundId, deps.now) : await deps.store.claim(roundId, deps.now);
  if (!round) return "busy";
  if (opts.justPlaced && round.status !== "needs_attention") {
    // Nothing to tell (claimNow also takes rounds awaiting approval): give the lease back.
    if (!(await deps.store.release(round.id, round.lockedUntil))) throw new Error("Lost the lease on the round");
    return "busy";
  }
  const s = await deps.store.scheduleSettings();
  const placeBy = opts.justPlaced ? 0 : await placeDeadline(deps);
  const result = await advanceClaimed(round, deps, s, opts.justPlaced ?? false, placeBy);
  if (typeof result === "string") return result;
  // Idea runs belong to the tick, which has the time for them: the next one picks this up.
  try {
    const next = result.generate;
    if (!(await deps.store.finish(next.id, next.lockedUntil, { status: next.status, nextActionAt: deps.now }))) {
      throw new Error("Lost the lease on the round");
    }
    logEvent("round_step", { round_id: next.id, user_id: next.userId, status: next.status, next_status: next.status, step: "generate_later" });
    return "advanced";
  } catch (err) {
    logEvent("round_failed", { round_id: round.id, user_id: round.userId, status: round.status, ...errorFields(err) });
    return "failed";
  }
}

/** When placing must stop: now plus zinc_place_budget_ms on the engine's clock (0 with Zinc off). */
async function placeDeadline(deps: EngineDeps): Promise<number> {
  if (!deps.zinc) return 0;
  return (deps.clock ?? Date.now)() + (await deps.store.setting("zinc_place_budget_ms"));
}

async function createDueRounds(
  { store, now }: EngineDeps,
  s: ScheduleSettings,
): Promise<{ created: number; failed: number }> {
  const today = dayOf(now);
  let created = 0;
  let failed = 0;
  for (const c of await store.candidates(today)) {
    // Each occasion on its own: one bad one can't stop the tick.
    try {
      const plan = roundToCreate(c.rule, today, s);
      if (!plan) continue;
      // The unique (person, occasion, year) key makes a repeat a no-op (AC-4).
      const inserted = await store.insertRound({
        userId: c.userId,
        personId: c.personId,
        occasionId: c.occasionId,
        occasionYear: plan.occasionYear,
        occasionDate: plan.occasionDate,
        shipByDeadline: plan.shipByDeadline,
        budgetCents: c.budgetCents,
        late: plan.late,
        nextActionAt: now,
      });
      if (inserted) created++;
    } catch {
      failed++;
      logEvent("round_create_failed", { occasion_id: c.occasionId, person_id: c.personId, user_id: c.userId });
    }
  }
  return { created, failed };
}

/** What a claimed round's step came to: done, failed, or an idea run for the idea pass (lease kept). */
type StepResult = "advanced" | "failed" | { generate: ClaimedRound };

/** Runs a claimed round's step. Never throws. */
async function advanceClaimed(
  round: ClaimedRound,
  deps: EngineDeps,
  s: ScheduleSettings,
  justPlaced: boolean,
  placeBy: number,
): Promise<StepResult> {
  const ids = { round_id: round.id, user_id: round.userId, status: round.status, attempts: round.attempts };
  try {
    // `attempts` counts this claim, so above the limit means that many claims
    // already ended without finishing (a throw or a killed process). Log it for
    // the owner and still try: the round recovers by itself once the fault is fixed.
    if (round.attempts > (await deps.store.setting("round_max_attempts"))) logEvent("round_stuck", ids);
    if (round.status === "needs_attention") {
      await runHeld(round, deps, s, justPlaced, placeBy);
      return "advanced";
    }
    const generate = await runStep(round, deps, s);
    return generate ? { generate } : "advanced";
  } catch (err) {
    logEvent("round_failed", { ...ids, ...errorFields(err) });
    return "failed";
  }
}

/** Runs a round's step; returns the round, still leased, when its step is an idea run. */
async function runStep(claimed: ClaimedRound, deps: EngineDeps, s: ScheduleSettings): Promise<ClaimedRound | void> {
  const { store, now } = deps;
  const today = dayOf(now);
  let round = claimed;
  const ctx = await store.roundContext(round.id);
  const sent = await store.sentSteps(round.id);
  const action = nextAction(view(round, ctx, sent), today, s);

  switch (action.do) {
    case "wait":
      return finishStep(round, ctx, sent, { status: round.status }, deps, s);
    case "send":
      await sendStep(round, ctx, action.send, sent, deps);
      return finishStep(round, ctx, sent, { status: round.status }, deps, s, action.send);
    case "skip": {
      const ids = { round_id: round.id, user_id: round.userId };
      // Tell the buyer about a skip only if we asked or told them something (ruling 13, ALL-27 AC-9).
      // A rejection renames what was sent (heads_up@1), and that still counts (ALL-29 AC-13). A
      // round left waiting on our AI credit (T87) is told too: the miss is ours, not the buyer's.
      if (!toldBefore(sent) && !ctx.waitingOnCredit) {
        logEvent("round_skipped_silently", { ...ids, status: round.status });
        return finishStep(round, ctx, sent, { status: "skipped" }, deps, s);
      }
      // The deadline never waits on its email (ruling 12): a refused send is logged, not retried.
      const delivered = await trySend(round, ctx, action.send, sent, deps);
      if (!delivered) logEvent("round_skip_email_failed", ids);
      return finishStep(round, ctx, sent, { status: "skipped" }, deps, s, delivered ? action.send : null);
    }
    case "request_address":
      await sendStep(round, ctx, action.send, sent, deps);
      return finishStep(round, ctx, sent, { status: "needs_address", headsUpOn: today }, deps, s, action.send);
    case "generate": {
      // No ideas yet: the idea pass runs one, after the rest of the tick. Ideas already saved
      // (a run that ended before its heads-up went): the heads-up goes now, with no run (B1).
      if (ctx.ideas.length === 0) return round;
      if (round.status !== "generating") {
        const regained = await moveToGenerating(round, deps);
        if (!regained) return; // another run took it in between; it carries on
        round = regained;
      }
      return sendHeadsUp(round, deps, s);
    }
    case "place":
    case "send_hold":
      // Only needs_attention rounds get these, and they run in runHeld.
      throw new Error(`${action.do} for a ${round.status} round`);
  }
}
