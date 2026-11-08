import {
  addDays,
  EMAILED_HOLDS,
  nextAction,
  roundToCreate,
  type AttentionReason,
  type CalendarDate,
  type OccasionKind,
  type RoundStatus,
  type RoundView,
  type ScheduleSettings,
  type StepKey,
} from "@gifts-af/core";
import { OCCASION_NAMES, shortDate } from "@/components/occasion-format";
import { errorFields, logEvent } from "@/lib/log";
import { notify, type NotifyDeps, type NotifyResult } from "../notify/notify";
import { endedAddressReason } from "../notify/templates";
import type { FailedGift, Funding } from "../notify/templates";
import type { ClaimedRound, RoundContext, RoundFinish, RoundOrder, RoundStore } from "./store";

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

export type GenerateIdeas = (roundId: string) => Promise<void>;

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
  /** Milliseconds, for the placing budget; Date.now when left out. */
  clock?: () => number;
};

export type TickSummary = { enabled: boolean; created: number; advanced: number; failed: number };

/** "off": the engine is switched off (`round_engine_enabled`), so nothing was touched. */
export type AdvanceResult = "advanced" | "busy" | "failed" | "off";

const FINISHED: RoundStatus[] = ["complete", "skipped", "ordered", "delivered"];

/** The engine's calendar day: the UTC day of `now`. */
const dayOf = (now: Date): CalendarDate => now.toISOString().slice(0, 10);

/** A round due on a day is due from its first moment, so that day's tick picks it up. */
const startOf = (day: CalendarDate) => new Date(`${day}T00:00:00Z`);

async function engineOn(store: RoundStore): Promise<boolean> {
  return (await store.setting("round_engine_enabled")) === 1;
}

export async function runTick(deps: EngineDeps): Promise<TickSummary> {
  const { store, now } = deps;
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

  const s = await store.scheduleSettings();
  // One placing budget for the whole tick, shared by every round it places (zinc_place_budget_ms).
  const placeBy = await placeDeadline(deps);
  if (!on) {
    let advanced = 0;
    let failed = 0;
    for (const round of await store.claimDueMoney(now)) {
      if (await advanceClaimed(round, deps, s, false, placeBy)) advanced++;
      else failed++;
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
  for (const round of await store.claimDue(now)) {
    if (await advanceClaimed(round, deps, s, false, placeBy)) advanced++;
    else failed++;
  }
  await tellOwnersOfRejections(deps);

  const summary = { enabled: true, created, advanced, failed };
  logEvent("round_tick", summary);
  return summary;
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
  return (await advanceClaimed(round, deps, s, opts.justPlaced ?? false, placeBy)) ? "advanced" : "failed";
}

/** When placing must stop: now plus zinc_place_budget_ms on the engine's clock (0 with Zinc off). */
async function placeDeadline(deps: EngineDeps): Promise<number> {
  if (!deps.zinc) return 0;
  return (deps.clock ?? Date.now)() + (await deps.store.setting("zinc_place_budget_ms"));
}

/** After a person's address is saved: their rounds waiting for it go on at once (AC-9). */
export async function resumeRoundsForPerson(personId: string, deps: EngineDeps): Promise<void> {
  if (!(await engineOn(deps.store))) return;
  for (const roundId of await deps.store.waitingRoundsForPerson(personId, deps.now)) {
    await advanceRound(roundId, deps);
  }
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

/** Runs a claimed round's step; true if it finished. Never throws. */
async function advanceClaimed(
  round: ClaimedRound,
  deps: EngineDeps,
  s: ScheduleSettings,
  justPlaced: boolean,
  placeBy: number,
): Promise<boolean> {
  const ids = { round_id: round.id, user_id: round.userId, status: round.status, attempts: round.attempts };
  try {
    // `attempts` counts this claim, so above the limit means that many claims
    // already ended without finishing (a throw or a killed process). Log it for
    // the owner and still try: the round recovers by itself once the fault is fixed.
    if (round.attempts > (await deps.store.setting("round_max_attempts"))) logEvent("round_stuck", ids);
    if (round.status === "needs_attention") await runHeld(round, deps, s, justPlaced, placeBy);
    else await runStep(round, deps, s);
    return true;
  } catch (err) {
    logEvent("round_failed", { ...ids, ...errorFields(err) });
    return false;
  }
}

async function runStep(claimed: ClaimedRound, deps: EngineDeps, s: ScheduleSettings): Promise<void> {
  const { store, now, generateIdeas } = deps;
  const today = dayOf(now);
  let round = claimed;
  let ctx = await store.roundContext(round.id);
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
      // Tell the buyer about a skip only if we asked them something (ruling 13).
      if (!sent.has("heads_up") && !sent.has("address_request")) {
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
      // Saved as `generating` first, so a crash mid-generation is retried from there.
      if (round.status !== "generating") {
        const regained = await moveToGenerating(round, deps);
        if (!regained) return; // another run took it in between; it carries on
        round = regained;
      }
      await generateIdeas(round.id);
      ctx = await store.roundContext(round.id);
      const funding = await headsUpFunding(round, deps);
      await sendStep(round, ctx, "heads_up", sent, deps, { funding });
      return finishStep(round, ctx, sent, { status: "awaiting_approval", headsUpOn: today }, deps, s, "heads_up");
    }
    case "place":
    case "send_hold":
      // Only needs_attention rounds get these, and they run in runHeld.
      throw new Error(`${action.do} for a ${round.status} round`);
  }
}

/**
 * A round on the money path (ALL-32). Tells the buyer about a new hold or failure first,
 * then tries placing once, then sends whatever reminder is due; at the deadline it closes
 * the round with cancel_held. reconcile_round sets the status and the next look; the lease
 * goes back with release_round. Never finish_round (plan, rule 6).
 */
async function runHeld(
  claimed: ClaimedRound,
  deps: EngineDeps,
  s: ScheduleSettings,
  justPlaced: boolean,
  placeBy: number,
): Promise<void> {
  const { store, now } = deps;
  const today = dayOf(now);
  const ids = { round_id: claimed.id, user_id: claimed.userId };
  let round = claimed;
  let placeTried = justPlaced;
  // At most one email to the buyer per run: after one goes out, only a try at placing may
  // follow, and anything else due waits for the next look (a hold starting a few days before
  // the deadline gets its notice today and the reminder tomorrow, not both at once).
  let emailed = false;
  const steps: string[] = [];
  // Ordering switched off outranks a funds hold for emailing (round-plan, orderingPaused).
  const orderingPaused = (await store.setting("zinc_ordering_enabled")) !== 1;
  // Failures the buyer hasn't heard about go first, in one email, whatever the round's reason
  // (ALL-116). Not part of "one email per run": each is news about a different gift. On the
  // deadline day the close tells them instead, in its own email.
  const atDeadline = round.shipByDeadline <= today;
  // A refusal isn't tried again this run; the next look does (one owner alert a look).
  let failuresRefused = false;
  const tellNow = async () => {
    if (atDeadline || failuresRefused) return;
    const told = await tellFailures(round, deps);
    if (told === "sent") steps.push("failures");
    failuresRefused = told === "refused";
  };
  await tellNow();
  // Each pass sends a new key or tries placing once, so this ends; the cap is a backstop.
  for (let pass = 0; pass < 5 && round.status === "needs_attention"; pass++) {
    const ctx = await store.roundContext(round.id);
    const sent = await store.sentSteps(round.id);
    const action = nextAction(view(round, ctx, sent, placeTried, orderingPaused), today, s);
    if (emailed && action.do !== "place") break;
    if (action.do === "skip") {
      steps.push(await closeAtDeadline(round, ctx, sent, deps, orderingPaused));
      break;
    }
    if (action.do === "place") {
      placeTried = true;
      steps.push("place");
      if (!deps.zinc) logEvent("zinc.wiring_missing", ids);
      // The run's placing budget is spent: the next tick tries it (the reminders still go today).
      else if ((deps.clock ?? Date.now)() >= placeBy) logEvent("order.place_budget_spent", ids);
      else await deps.zinc.placeRound(round.id, round.lockedUntil, placeBy, { address: round.attentionReason === "address" });
    } else if (action.do === "send_hold") {
      await sendStep(round, ctx, action.send, sent, deps);
      emailed = true;
      steps.push(action.send);
      const reason = round.attentionReason;
      if (action.send.startsWith("hold:") && reason && EMAILED_HOLDS.includes(reason)) {
        // What the buyer was told (reconcile rule 4), and the balance named in a funds email (AC-22).
        await store.markHoldEmailed(round.id, reason, reason === "funds" ? round.seenBalanceCents : null);
      }
      await store.reconcile(round.id);
    } else {
      break;
    }
    round = await store.refresh(round);
  }
  // A failure from this run's own placing is told now, not tomorrow (plan review S1).
  await tellNow();
  // Sets next_action_at for what's left (tomorrow, or the deadline once ordered).
  const status = await store.reconcile(round.id);
  if (!(await store.release(round.id, round.lockedUntil))) throw new Error("Lost the lease on the round");
  logEvent("round_step", { ...ids, status: claimed.status, next_status: status, step: steps.join(",") || null });
}

/**
 * The deadline for a held round (AC-23 to AC-25). cancel_held cancels what was never sent and
 * says where the round ends up. The buyer is always told, and an email the service refuses is
 * tried again on the next look, so the round isn't closed until the email that decides what
 * they hear has gone (owner):
 * - held gifts next to one placed, placing or unconfirmed: "we cancelled <gift>, nothing was
 *   charged" goes first, naming the other gift as on its way only once it's placed (a placing
 *   or unconfirmed one has its own emails);
 * - nothing placed, placing or unconfirmed: the skipped email (or missed_on_us when our own
 *   switch kept it back) goes first;
 * - still unconfirmed after closing: "still confirming". The round stays open, so a refusal is
 *   retried; when the cancel email went this run, it waits for the next look (one email a run).
 */
async function closeAtDeadline(
  round: ClaimedRound,
  ctx: RoundContext,
  sent: Set<StepKey>,
  deps: EngineDeps,
  orderingPaused: boolean,
): Promise<string> {
  const ids = { round_id: round.id, user_id: round.userId };
  const held = ctx.orders.filter(LIVE_HELD);
  const placed = ctx.orders.filter((o) => ["placed", "shipped", "delivered", "refunded"].includes(o.status));
  const pending = ctx.orders.some((o) => o.status === "placing" || o.status === "unconfirmed");
  // Our own switch kept it back: ordering is off now, whatever reason the hold was stored with
  // (gate_held_orders never replaces funds with paused), or the hold says paused.
  const skipStep: StepKey = round.attentionReason === "paused" || orderingPaused ? "missed_on_us" : "skipped";

  let emailed = false;
  // The email that decides what the buyer hears goes before closing; a refusal keeps the round
  // open for the next look. Past the deadline that means a gift held open: alert the owner (once
  // a look, so once a day).
  const heldOpen = () => {
    if (dayOf(deps.now) > round.shipByDeadline) logEvent("round_deadline_email_held_open", { ...ids, alert: true });
  };
  const before = async (step: StepKey, extra: Extra = {}) => {
    try {
      await sendStep(round, ctx, step, sent, deps, extra);
    } catch (err) {
      heldOpen();
      throw err;
    }
  };
  // Failures the buyer hasn't heard about: one "We couldn't buy" email names them and any held
  // gift cancelled now, in place of the cancelled or skipped email (owner, 2026-11-08, ALL-116).
  if (ctx.orders.some((o) => isUntold(o, sent))) {
    const told = await tellClosing(round, held, deps);
    if (told === "refused") {
      heldOpen();
      throw new Error("Sending the deadline's failure email failed");
    }
    emailed = told === "sent";
  }
  if (emailed) {
    // Told above.
  } else if (held.length > 0 && (placed.length > 0 || pending)) {
    const partial = { cancelled: held.map((o) => o.title), onItsWay: placed.map((o) => o.title) };
    await before("held_cancelled", { partial });
    emailed = true;
  } else if (placed.length === 0 && !pending) {
    await before(skipStep);
    emailed = true;
  }

  const status = await deps.store.cancelHeld(round.id);
  // A failure the close found untold (one that arrived while we closed) goes to the late email,
  // which says what happened better than "skipped": send it now rather than at the next tick.
  const late = (await deps.store.roundContext(round.id)).orders.some((o) => o.status === "failed" && o.failedAfterClose);
  if (late) {
    try {
      await tellOrdered(round.id, deps);
    } catch (err) {
      logEvent("order.failed_late_email_failed", { ...ids, ...errorFields(err), alert: true });
    }
  }
  // A placing order failed while we closed (rare), so the round ended skipped after all: the
  // skipped email still goes (its own key, so never twice), best effort now the round is closed,
  // unless the late email just told them what happened.
  if (status === "skipped" && (!emailed || pending) && !late) {
    if (!(await trySend(round, ctx, skipStep, sent, deps))) logEvent("round_skip_email_failed", { ...ids, alert: true });
  } else if (status === "needs_attention" && !emailed) {
    const after = await deps.store.refresh(round);
    if (after.attentionReason === "unconfirmed") {
      const step: StepKey = `hold:${after.holdCount}:deadline`;
      // A refusal is forgotten, and the round stays open, so the next day's look tries again.
      if (!(await trySend(after, ctx, step, sent, deps))) logEvent("round_hold_email_failed", ids);
    }
  }
  return `deadline:${status}`;
}

/**
 * The rounds with an order Zinc placed whose "ordered" email hasn't gone (a refused send is
 * forgotten): the tick sends them again, so the buyer is always told (owner).
 */
export async function retryOrderedEmails(deps: EngineDeps): Promise<void> {
  for (const roundId of await deps.store.roundsMissingOrderedEmail()) {
    try {
      await tellOrdered(roundId, deps);
    } catch (err) {
      logEvent("order.ordered_email_failed", { round_id: roundId, ...errorFields(err), alert: true });
    }
  }
}

/**
 * Asks a list owner to check their shared address after a store couldn't use it (ALL-112), at
 * most once per round, then clears what's left of the rejected address. The email says nothing
 * of a gift (decision 39). `refused`: there's an owner but the email didn't go; the tick tries
 * again until check_address_retry_days, then gives up and clears the address (T42). `retry`: a
 * failed lookup, which the tick also tries again.
 */
export async function tellOwnerOfRejection(roundId: string, deps: EngineDeps): Promise<"asked" | "ruled_out" | "refused" | "retry"> {
  const { store, now } = deps;
  const ids = { round_id: roundId };
  try {
    // First, because clearing the rejected address means there's no owner to find later on.
    const alreadyAsked = (await store.sentSteps(roundId)).has("shared_address");
    const owner = alreadyAsked ? null : await store.sharedAddressOwnerToTell(roundId);
    if (owner) {
      const { userId, orders } = await store.roundContext(roundId);
      // Read first: a blip after recording would lose the email for good.
      const [days, retryDays] = await Promise.all([store.setting("check_address_link_days"), store.setting("check_address_retry_days")]);
      // Another run has it, and may yet be refused: it stays on the to-do list, so nothing is cleared.
      if (!(await store.recordSend(roundId, userId, "shared_address"))) return "asked";
      const result = await notify(
        {
          userId: owner,
          kind: "check_your_address",
          data: {},
          links: { open: { action: "check_my_address", expiresAt: new Date(now.getTime() + days * 86_400_000) } },
        },
        deps.notify,
      );
      if (!result.ok) {
        await store.forgetSend(roundId, "shared_address");
        // When it failed, which nothing later moves (ALL-116), so the window never restarts.
        const rejectedAt = orders.find((o) => o.failureType === "address_rejected")?.failedAt;
        if (rejectedAt && now.getTime() - Date.parse(rejectedAt) > retryDays * 86_400_000) {
          await store.clearRejectedAddresses(roundId);
          logEvent("order.shared_address_notice_abandoned", { ...ids, alert: true });
        } else {
          logEvent("order.shared_address_notice_failed", { ...ids, alert: true });
        }
        return "refused";
      }
      logEvent("order.shared_address_notice", ids);
    }
    await store.clearRejectedAddresses(roundId);
    return alreadyAsked || owner ? "asked" : "ruled_out";
  } catch (err) {
    logEvent("order.shared_address_notice_failed", { ...ids, ...errorFields(err), alert: true });
    return "retry";
  }
}

/** For the tick: any round a run hasn't dealt with, including closed and cancelled ones. */
export async function tellOwnersOfRejections(deps: EngineDeps): Promise<void> {
  try {
    for (const roundId of await deps.store.roundsWithRejectedAddresses()) await tellOwnerOfRejection(roundId, deps);
  } catch (err) {
    logEvent("order.shared_address_notice_failed", { ...errorFields(err), alert: true });
  }
}

/**
 * The emails for orders Zinc settled (owner: customers are always told), each once, keyed in
 * round_sends so it never goes twice:
 * - "ordered" (PRD A-8) for each order Zinc confirmed placed, `ordered:<order id>`;
 * - "we couldn't buy it" (failed_late) for each order that failed after its round closed,
 *   `late_fail:<order id>`: the engine never looks at a closed round again (S2).
 * Called after a webhook or the sweep settles an order, and by the tick for any not yet sent.
 * A refusal is forgotten and logged for the owner.
 */
export async function tellOrdered(roundId: string, deps: EngineDeps): Promise<void> {
  const ctx = await deps.store.roundContext(roundId);
  const sent = await deps.store.sentSteps(roundId);
  const occasion = {
    personName: ctx.personName,
    occasion: occasionWord(ctx.occasionKind),
    dateText: shortDate(ctx.occasionDate),
  };
  const open = { action: "open_person" as const, expiresAt: new Date(`${ctx.occasionDate}T23:59:00Z`) };
  const placed = ctx.orders.filter((x) => ["placed", "shipped", "delivered"].includes(x.status));
  for (const o of placed) {
    const step: StepKey = `ordered:${o.id}`;
    if (sent.has(step)) continue;
    if (!(await deps.store.recordSend(roundId, ctx.userId, step))) continue;
    const result = await notify(
      {
        userId: ctx.userId,
        roundId,
        kind: "ordered",
        data: { ...occasion, giftTitle: o.title, ...(o.shipCity ? { cityText: o.shipCity } : {}) },
        links: { open },
      },
      deps.notify,
    );
    if (!result.ok) {
      await deps.store.forgetSend(roundId, step);
      logEvent("order.ordered_email_failed", { round_id: roundId, user_id: ctx.userId, order_id: o.id, alert: true });
    }
  }
  // Every late failure not yet told goes in one email (ALL-116). Only the keys this call recorded
  // are its own: another run that got some first sends those, and a refusal forgets only these.
  const fresh: RoundOrder[] = [];
  for (const o of ctx.orders.filter((x) => x.status === "failed" && x.failedAfterClose && !sent.has(`late_fail:${x.id}`))) {
    if (await deps.store.recordSend(roundId, ctx.userId, `late_fail:${o.id}`)) fresh.push(o);
  }
  if (fresh.length === 0) return;
  const onItsWay = placed.map((x) => x.title);
  const result = await notify(
    {
      userId: ctx.userId,
      roundId,
      kind: "failed_late",
      data: {
        ...occasion,
        failed: fresh.map((o) => ({ title: o.title, detail: lateDetail(o, ctx.personName) })),
        ...(onItsWay.length > 0 ? { onItsWay } : {}),
        ...(ctx.closedEarly ? { closedEarly: true } : {}),
        ...(ctx.personRemoved ? { personRemoved: true } : {}),
      },
      links: { open },
    },
    deps.notify,
  );
  for (const o of fresh) {
    if (!result.ok) await deps.store.forgetSend(roundId, `late_fail:${o.id}`);
    const event = result.ok ? "order.failed_late_told" : "order.failed_late_email_failed";
    logEvent(event, { round_id: roundId, user_id: ctx.userId, order_id: o.id, ...(result.ok ? {} : { alert: true }) });
  }
}

// ─── Telling failures (ALL-116) ──────────────────────────────────────────────

/**
 * A failure the buyer hasn't heard about, as far as this run can tell. The database's
 * untold_failures (through claimFailureNotices) has the last word, including keys older code wrote.
 */
function isUntold(o: RoundOrder, sent: Set<StepKey>): boolean {
  return (
    o.status === "failed" &&
    !o.resolved &&
    !o.failedAfterClose &&
    o.failureType !== "invalid_shipping_address" &&
    !sent.has(`fail:${o.id}`)
  );
}

/** "Choose by": the day before the ship-by day, since that day's tick closes the round. */
const chooseBy = (shipBy: CalendarDate) => shortDate(addDays(shipBy, -1));

/** Why a gift failed, for a closed round: no choice left to offer. */
function lateDetail(o: RoundOrder, personName: string): string {
  switch (o.failureType) {
    case "price_up":
      return "The price went up more than you allowed for.";
    case "out_of_stock":
      return "The store ran out.";
    case "too_late":
      return "It wouldn't have arrived in time.";
    case "address_withdrawn":
      return `We couldn't use the address ${personName} was sharing.`;
    case "address_rejected":
      return `The store couldn't use the address ${personName} saved.`;
    default:
      return "The store couldn't place the order.";
  }
}

/** Why a gift failed and what the buyer can do now, for a summary while the round is open. */
function openRow(o: RoundOrder, personName: string, ownerAsked: boolean): FailedGift {
  const choose = `Choose another gift instead of the ${o.title}`;
  switch (o.failureType) {
    case "price_up":
      return {
        title: o.title,
        detail: "The price went up more than you allowed for. Approve the new price, or choose another gift.",
        action: `Review the new price for the ${o.title}`,
      };
    case "out_of_stock":
      return { title: o.title, detail: "The store ran out. Choose another gift.", action: choose };
    case "too_late":
      return { title: o.title, detail: "It wouldn't arrive in time anymore. Choose something that ships faster.", action: choose };
    case "address_withdrawn":
    case "address_rejected": {
      const asked = o.failureType === "address_rejected" && ownerAsked ? ` We'll ask ${personName} to check it, without mentioning a gift.` : "";
      return { title: o.title, detail: `${lateDetail(o, personName)}${asked} Choose another gift.`, action: choose };
    }
    default:
      return { title: o.title, detail: "The store couldn't place the order. Choose another gift.", action: choose };
  }
}

/**
 * Tells the round's untold failures while it's open, in one email: the gift's own email for one,
 * the summary for two or more. Keys are claimed under the round's lock first; a refusal gives
 * them back (and the run goes on, so a held gift is still tried). A crash after claiming keeps
 * them, so nothing is ever sent twice (AC-11).
 */
async function tellFailures(round: ClaimedRound, deps: EngineDeps): Promise<"sent" | "none" | "refused"> {
  const { store } = deps;
  const ids = { round_id: round.id, user_id: round.userId };
  let ctx = await store.roundContext(round.id);
  const sent = await store.sentSteps(round.id);
  const untold = ctx.orders.filter((o) => isUntold(o, sent));
  if (untold.length === 0) return "none";
  // The owner of a rejected shared address hears first, so the buyer's email can say so (ALL-112).
  let ownerAsked = false;
  if (untold.some((o) => o.failureType === "address_rejected")) {
    const told = await tellOwnerOfRejection(round.id, deps);
    ownerAsked = told === "asked" || told === "refused";
  }
  const claimed = await store.claimFailureNotices(round.id);
  if (claimed.length === 0) return "none";
  ctx = await store.roundContext(round.id);
  const failed = claimed.map((id) => ctx.orders.find((o) => o.id === id)).filter((o): o is RoundOrder => o !== undefined);
  const result = await sendOpenFailures(round, ctx, failed, ownerAsked, deps);
  if (!result.ok) {
    await store.releaseFailureNotices(round.id, claimed);
    logEvent("round_failure_email_failed", { ...ids, alert: true });
    return "refused";
  }
  logEvent("round_failures_told", { ...ids, count: failed.length });
  return "sent";
}

async function sendOpenFailures(
  round: ClaimedRound,
  ctx: RoundContext,
  failed: RoundOrder[],
  ownerAsked: boolean,
  deps: EngineDeps,
): Promise<NotifyResult> {
  const base = { userId: round.userId, roundId: round.id };
  const occasion = { personName: ctx.personName, occasion: occasionWord(ctx.occasionKind), dateText: shortDate(ctx.occasionDate) };
  const open = { open: { action: "open_person" as const, expiresAt: new Date(`${round.shipByDeadline}T23:59:00Z`) } };
  const orderByText = chooseBy(round.shipByDeadline);
  if (failed.length > 1) {
    const tried = new Set(ctx.orders.filter((o) => o.status !== "cancelled").map((o) => o.ideaId)).size;
    const onItsWay = ctx.orders.filter((o) => ["placed", "shipped", "delivered"].includes(o.status)).map((o) => o.title);
    return notify(
      {
        ...base,
        kind: "failed_several",
        data: {
          ...occasion,
          tried: Math.max(tried, failed.length),
          failed: failed.map((o) => openRow(o, ctx.personName, ownerAsked)),
          ...(onItsWay.length > 0 ? { onItsWay } : {}),
          orderByText,
        },
        links: open,
      },
      deps.notify,
    );
  }
  const [o] = failed;
  const one = { ...occasion, giftTitle: o.title, orderByText };
  switch (o.failureType) {
    case "price_up":
      return notify({ ...base, kind: "price_up", data: one, links: open }, deps.notify);
    case "out_of_stock":
      return notify({ ...base, kind: "out_of_stock", data: one, links: open }, deps.notify);
    case "too_late":
      return notify({ ...base, kind: "too_late", data: one, links: open }, deps.notify);
    case "address_withdrawn":
    case "address_rejected": {
      const reason = endedAddressReason(o.failureType, ctx.personName, [o.title], ownerAsked);
      return notify({ ...base, kind: "needs_attention", data: { ...occasion, reason, orderByText }, links: open }, deps.notify);
    }
    default: {
      const reason = `the store couldn't place the order for the ${o.title}, and you haven't been charged.`;
      return notify({ ...base, kind: "needs_attention", data: { ...occasion, reason, orderByText }, links: open }, deps.notify);
    }
  }
}

/**
 * The deadline with untold failures (owner, 2026-11-08): before the round closes, one "We
 * couldn't buy" email names them and any held gift cancelled now, in place of the cancelled
 * or skipped email. "none": another run got them first.
 */
async function tellClosing(round: ClaimedRound, held: RoundOrder[], deps: EngineDeps): Promise<"sent" | "none" | "refused"> {
  const { store } = deps;
  const ids = { round_id: round.id, user_id: round.userId };
  const claimed = await store.claimFailureNotices(round.id);
  if (claimed.length === 0) return "none";
  // The held gifts are named here only if the cancelled email hasn't gone.
  const heldToo = held.length > 0 && (await store.recordSend(round.id, round.userId, "held_cancelled"));
  const ctx = await store.roundContext(round.id);
  const failed = claimed.map((id) => ctx.orders.find((o) => o.id === id)).filter((o): o is RoundOrder => o !== undefined);
  const rows = [
    ...failed.map((o) => ({ title: o.title, detail: lateDetail(o, ctx.personName) })),
    ...(heldToo ? held.map((o) => ({ title: o.title, detail: "It couldn't be bought in time, so we cancelled it." })) : []),
  ];
  const onItsWay = ctx.orders.filter((o) => ["placed", "shipped", "delivered"].includes(o.status)).map((o) => o.title);
  const result = await notify(
    {
      userId: round.userId,
      roundId: round.id,
      kind: "failed_late",
      data: {
        personName: ctx.personName,
        occasion: occasionWord(ctx.occasionKind),
        dateText: shortDate(ctx.occasionDate),
        failed: rows,
        ...(onItsWay.length > 0 ? { onItsWay } : {}),
        ...(ctx.personRemoved ? { personRemoved: true } : {}),
      },
      links: { open: { action: "open_person", expiresAt: new Date(`${ctx.occasionDate}T23:59:00Z`) } },
    },
    deps.notify,
  );
  if (!result.ok) {
    await store.releaseFailureNotices(round.id, claimed);
    if (heldToo) await store.forgetSend(round.id, "held_cancelled");
    logEvent("round_failure_email_failed", { ...ids, alert: true });
    return "refused";
  }
  logEvent("round_failures_told", { ...ids, count: failed.length });
  return "sent";
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

function view(round: ClaimedRound, ctx: RoundContext, sent: Set<StepKey>, placeTried = false, orderingPaused = false): RoundView {
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
  };
}

/** Saves `generating` and takes a fresh lease on the round, or null if someone else got it. */
async function moveToGenerating(round: ClaimedRound, { store, now }: EngineDeps): Promise<ClaimedRound | null> {
  const ok = await store.finish(round.id, round.lockedUntil, { status: "generating", nextActionAt: now });
  if (!ok) throw new Error("Lost the lease on the round");
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: "generating", step: null });
  return store.claim(round.id, now);
}

/** What some emails add to the round's own data. */
type Extra = { funding?: Funding; partial?: { cancelled: string[]; onItsWay: string[] } };

/** Records the step, then sends it; fails on a clean refusal, so the next tick tries again. */
async function sendStep(
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
async function trySend(
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
async function finishStep(
  round: ClaimedRound,
  ctx: RoundContext,
  sent: Set<StepKey>,
  next: Omit<RoundFinish, "nextActionAt">,
  { store, now }: EngineDeps,
  s: ScheduleSettings,
  step: StepKey | null = null,
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

// ─── The emails ────────────────────────────────────────────────────────────

/** "$42" or "$38.50". */
function money(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}

/** "birthday", "Mother's Day": a holiday keeps its capitals in a sentence. */
function occasionWord(kind: OccasionKind): string {
  return kind === "birthday" || kind === "anniversary" ? OCCASION_NAMES[kind].toLowerCase() : OCCASION_NAMES[kind];
}

type PlainStep = Exclude<StepKey, `hold:${string}` | `fail:${string}` | `ordered:${string}` | `late_fail:${string}` | "shared_address">;
/** Which email a step key sends; the numbered keys group by kind. Failures are told by tellFailures. */
type EmailStep = PlainStep | "hold" | "hold_short" | "hold_deadline" | "fail" | "ordered";

function emailStep(step: StepKey): EmailStep {
  if (step.startsWith("hold:")) {
    if (step.includes(":short:")) return "hold_short";
    return step.endsWith(":deadline") ? "hold_deadline" : "hold";
  }
  if (step.startsWith("fail:")) return "fail";
  if (step.startsWith("ordered:") || step.startsWith("late_fail:")) return "ordered";
  return step as PlainStep;
}

const LIVE_HELD = (o: RoundOrder) => o.status === "held";
const ON_ITS_WAY = (o: RoundOrder) => ["placing", "placed", "shipped", "delivered"].includes(o.status);

async function sendEmail(step: StepKey, round: ClaimedRound, ctx: RoundContext, deps: EngineDeps, extra: Extra): Promise<NotifyResult> {
  const notifyDeps: NotifyDeps = deps.notify;
  const base = { userId: round.userId, roundId: round.id };
  const occasion = {
    personName: ctx.personName,
    occasion: occasionWord(ctx.occasionKind),
    dateText: shortDate(ctx.occasionDate),
  };
  const ideas = ctx.ideas.map((i) => ({ title: i.title, price: money(i.totalCents) }));
  // Every button opens the person's page until the approval screen (ALL-29).
  // Links last until the end of the deadline day.
  const link = { action: "open_person" as const, expiresAt: new Date(`${round.shipByDeadline}T23:59:00Z`) };
  // The address emails open the person's address form instead (ALL-81).
  const addressLink = { ...link, action: "add_address" as const };
  // Open guided questions, when there are any (ALL-26, design §6.7).
  const asks = ctx.openQuestions > 0 ? { questions: ctx.openQuestions } : {};
  const questionsLink = ctx.openQuestions > 0 ? { questions: { ...link, action: "answer_questions" as const } } : {};
  // The hold emails (ALL-32): the gifts waiting, and a plain "Cancel this gift" link.
  const cancelLink = { ...link, action: "cancel_held_gift" as const };
  const held = ctx.orders.filter(LIVE_HELD);
  const gifts = { ...occasion, giftTitles: held.map((o) => o.title) };
  const feeText = async () => money(await deps.store.setting("zinc_order_fee_cents"));
  const reason: AttentionReason | null = round.attentionReason;

  const kind = emailStep(step);
  switch (kind) {
    case "heads_up":
      return notify(
        {
          ...base,
          kind: "heads_up",
          data: { ...occasion, ...asks, mode: "reminder", ideas, late: round.late, ...(extra.funding ? { funding: extra.funding } : {}) },
          links: { choose: link, ...questionsLink },
        },
        notifyDeps,
      );
    case "reminder_1":
    case "reminder_2":
      return notify(
        { ...base, kind: "reminder", data: { ...occasion, ...asks, ideas }, links: { choose: link, ...questionsLink } },
        notifyDeps,
      );
    case "final_notice":
      return notify(
        {
          ...base,
          kind: "final_notice",
          // The day before ship-by: that day's tick closes the round (ALL-116 plan review).
          data: { ...occasion, ideas, orderByText: chooseBy(round.shipByDeadline) },
          links: { choose: link },
        },
        notifyDeps,
      );
    case "held_cancelled":
    case "skipped":
      // A money-path round at its deadline: the buyer had chosen a gift (ALL-32).
      return notify(
        {
          ...base,
          kind: "skipped",
          data: {
            ...occasion,
            ...(round.status === "needs_attention" ? { held: true } : {}),
            ...(extra.partial ? { partial: extra.partial } : {}),
          },
          links: { open: link },
        },
        notifyDeps,
      );
    case "address_request":
      return notify({ ...base, kind: "needs_address", data: occasion, links: { addAddress: addressLink } }, notifyDeps);
    case "address_reminder_1":
    case "address_reminder_2":
    case "address_final_notice":
      return notify(
        { ...base, kind: "needs_address", data: { ...occasion, reminder: true }, links: { addAddress: addressLink } },
        notifyDeps,
      );
    case "missed_on_us":
      return notify({ ...base, kind: "missed_on_us", data: gifts, links: { open: link } }, notifyDeps);
    case "hold_trouble":
      return notify(
        { ...base, kind: "hold_trouble", data: { ...gifts, feeText: await feeText() }, links: { open: link, cancel: cancelLink } },
        notifyDeps,
      );
    case "hold_deadline":
      return notify(
        { ...base, kind: "hold_unconfirmed", data: { ...gifts, giftTitles: unconfirmedTitles(ctx) }, links: { open: link } },
        notifyDeps,
      );
    case "hold":
    case "hold_short":
      return sendHold(reason, kind === "hold_short");
    case "fail":
      // Told by tellFailures and tellClosing, which claim each failure's key first; never a round step.
      throw new Error("Failures are told by tellFailures");
    case "ordered":
      // Sent by tellOrdered, which knows the order (ordered and late_fail); never a round step.
      throw new Error("The ordered and late failure emails are sent by tellOrdered");
    default: {
      const unknown: never = kind;
      throw new Error(`No email for step ${String(unknown)}`);
    }
  }

  async function sendHold(r: AttentionReason | null, still: boolean): Promise<NotifyResult> {
    switch (r) {
      case "funds": {
        const needed = held.reduce((sum, o) => sum + o.maxPriceCents + o.feeCents, 0);
        const have = round.seenBalanceCents;
        const placed = ctx.orders.find(ON_ITS_WAY);
        return notify(
          {
            ...base,
            kind: "hold_funds",
            data: {
              ...gifts,
              neededText: money(needed),
              ...(have !== null ? { haveText: money(have), shortText: money(Math.max(0, needed - have)) } : {}),
              feeText: await feeText(),
              walletUrl: deps.zinc?.walletUrl ?? `${notifyDeps.baseUrl}/settings`,
              ...(placed ? { placedTitle: placed.title } : {}),
              ...(still ? { still: true } : {}),
            },
            links: { cancel: cancelLink },
          },
          notifyDeps,
        );
      }
      case "setup":
        return notify(
          {
            ...base,
            kind: "hold_setup",
            data: { ...gifts, feeText: await feeText() },
            links: { setup: { ...link, action: "open_settings" }, cancel: cancelLink },
          },
          notifyDeps,
        );
      case "address":
        return notify(
          {
            ...base,
            kind: "hold_address",
            data: { ...gifts, feeText: await feeText() },
            links: { addAddress: addressLink, cancel: cancelLink },
          },
          notifyDeps,
        );
      case "unconfirmed":
        return notify(
          { ...base, kind: "hold_unconfirmed", data: { ...gifts, giftTitles: unconfirmedTitles(ctx) }, links: { open: link } },
          notifyDeps,
        );
      default:
        throw new Error(`No hold email for reason ${r}`);
    }
  }

}

function unconfirmedTitles(ctx: RoundContext): string[] {
  return ctx.orders.filter((o) => o.status === "unconfirmed").map((o) => o.title);
}
