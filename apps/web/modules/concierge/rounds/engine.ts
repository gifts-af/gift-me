import {
  nextAction,
  roundToCreate,
  type CalendarDate,
  type OccasionKind,
  type RoundStatus,
  type RoundView,
  type ScheduleSettings,
  type StepKey,
} from "@gifts-af/core";
import { OCCASION_NAMES, shortDate } from "@/components/occasion-format";
import { logEvent } from "@/lib/log";
import { notify, type NotifyDeps, type NotifyResult } from "../notify/notify";
import type { ClaimedRound, RoundContext, RoundFinish, RoundStore } from "./store";

// The round engine (ALL-28, design §5.1). The daily tick creates rounds that
// are due, then claims each due round with a lease and runs its next step:
// one email, a status move, and the day to look again. What to do is decided
// in packages/core (round-plan.ts); this file only carries it out.
//
// One step, in order: record the send → notify → (on a clean refusal: forget
// the send and fail; the deadline skip finishes anyway) → finish. A step that dies after recording keeps the
// record, so a retry never sends the same email twice (AC-11). A step that
// fails leaves its lease to expire and is retried by the next tick (AC-12).

export type GenerateIdeas = (roundId: string) => Promise<void>;

export type EngineDeps = { store: RoundStore; notify: NotifyDeps; now: Date; generateIdeas: GenerateIdeas };

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
  if (!(await engineOn(store))) {
    logEvent("round_tick", { enabled: false });
    return { enabled: false, created: 0, advanced: 0, failed: 0 };
  }

  const s = await store.scheduleSettings();
  const { created, failed: createFailed } = await createDueRounds(deps, s);

  // One after another, each on its own: one failing round can't stop the rest.
  // `failed` counts occasions that couldn't be created and rounds that failed.
  let advanced = 0;
  let failed = createFailed;
  for (const round of await store.claimDue(now)) {
    if (await advanceClaimed(round, deps, s)) advanced++;
    else failed++;
  }

  const summary = { enabled: true, created, advanced, failed };
  logEvent("round_tick", summary);
  return summary;
}

/** Moves one round on now, if it's due and no one else holds it (AC-10). */
export async function advanceRound(roundId: string, deps: EngineDeps): Promise<AdvanceResult> {
  if (!(await engineOn(deps.store))) return "off";
  const round = await deps.store.claim(roundId, deps.now);
  if (!round) return "busy";
  const s = await deps.store.scheduleSettings();
  return (await advanceClaimed(round, deps, s)) ? "advanced" : "failed";
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
async function advanceClaimed(round: ClaimedRound, deps: EngineDeps, s: ScheduleSettings): Promise<boolean> {
  const ids = { round_id: round.id, user_id: round.userId, status: round.status, attempts: round.attempts };
  try {
    // `attempts` counts this claim, so above the limit means that many claims
    // already ended without finishing (a throw or a killed process). Log it for
    // the owner and still try: the round recovers by itself once the fault is fixed.
    if (round.attempts > (await deps.store.setting("round_max_attempts"))) logEvent("round_stuck", ids);
    await runStep(round, deps, s);
    return true;
  } catch (err) {
    logEvent("round_failed", { ...ids, error: err instanceof Error ? err.name : "unknown" });
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
      await sendStep(round, ctx, "heads_up", sent, deps);
      return finishStep(round, ctx, sent, { status: "awaiting_approval", headsUpOn: today }, deps, s, "heads_up");
    }
  }
}

function view(round: ClaimedRound, ctx: RoundContext, sent: Set<StepKey>): RoundView {
  return {
    status: round.status,
    shipByDeadline: round.shipByDeadline,
    headsUpOn: round.headsUpOn,
    hasAddress: ctx.hasAddress,
    sent,
  };
}

/** Saves `generating` and takes a fresh lease on the round, or null if someone else got it. */
async function moveToGenerating(round: ClaimedRound, { store, now }: EngineDeps): Promise<ClaimedRound | null> {
  const ok = await store.finish(round.id, round.lockedUntil, { status: "generating", nextActionAt: now });
  if (!ok) throw new Error("Lost the lease on the round");
  logEvent("round_step", { round_id: round.id, user_id: round.userId, status: round.status, next_status: "generating", step: null });
  return store.claim(round.id, now);
}

/** Records the step, then sends it; fails on a clean refusal, so the next tick tries again. */
async function sendStep(
  round: ClaimedRound,
  ctx: RoundContext,
  step: StepKey,
  sent: Set<StepKey>,
  deps: EngineDeps,
): Promise<void> {
  if (!(await trySend(round, ctx, step, sent, deps))) throw new Error(`Sending ${step} failed`);
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
): Promise<boolean> {
  const fresh = await deps.store.recordSend(round.id, round.userId, step);
  sent.add(step);
  if (!fresh) return true;
  const result = await sendEmail(step, round, ctx, deps.notify);
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

function sendEmail(step: StepKey, round: ClaimedRound, ctx: RoundContext, deps: NotifyDeps): Promise<NotifyResult> {
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

  switch (step) {
    case "heads_up":
      return notify(
        { ...base, kind: "heads_up", data: { ...occasion, mode: "reminder", ideas, late: round.late }, links: { choose: link } },
        deps,
      );
    case "reminder_1":
    case "reminder_2":
      return notify({ ...base, kind: "reminder", data: { ...occasion, ideas }, links: { choose: link } }, deps);
    case "final_notice":
      return notify(
        {
          ...base,
          kind: "final_notice",
          data: { ...occasion, ideas, orderByText: shortDate(round.shipByDeadline) },
          links: { choose: link },
        },
        deps,
      );
    case "skipped":
      return notify({ ...base, kind: "skipped", data: occasion, links: { open: link } }, deps);
    case "address_request":
      return notify({ ...base, kind: "needs_address", data: occasion, links: { addAddress: addressLink } }, deps);
    case "address_reminder_1":
    case "address_reminder_2":
    case "address_final_notice":
      return notify(
        { ...base, kind: "needs_address", data: { ...occasion, reminder: true }, links: { addAddress: addressLink } },
        deps,
      );
  }
}
