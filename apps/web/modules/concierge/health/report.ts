import type { CostPerGift } from "./costs";
import type { HealthSnapshot, LaunchNumbers } from "./store";

export type HealthSettings = {
  allClearWeekday: number;
  aiCreditLowCents: number;
  zincAppBalanceLowCents: number;
  ideaEngineEnabled: boolean;
  captureExtractionEnabled: boolean;
  amazonPasteLookupEnabled: boolean;
};

/** Null means not checked, or the call failed; the failed flags say which. */
export type Vendors = {
  aiCreditCents: number | null;
  zincAppBalanceCents: number | null;
  aiConfigured: boolean;
  zincConfigured: boolean;
  aiFailed: boolean;
  zincFailed: boolean;
};

export type ProblemKind =
  | "db_down"
  | "tick_missed"
  | "no_credit"
  | "ideas_failed"
  | "tick_failed"
  | "stuck_round"
  | "unconfirmed"
  | "placing"
  | "held_zinc"
  | "ideas_not_configured"
  | "vendor_failed"
  | "credit_low"
  | "zinc_low"
  | "deadline_close"
  | "over_max_charge"
  | "check_failed";

/** Where a health check that couldn't run stopped: a fixed token, never the error's text (E6). */
export type HealthStage = "settings" | "snapshot" | "wiring";

export type Problem = {
  kind: ProblemKind;
  ids?: { roundId?: string; orderId?: string; userId?: string };
  detail?: Record<string, number | string>;
  /** Rounds waiting on ideas, listed under no_credit. */
  waiting?: HealthSnapshot["ideasWaiting"];
};

export type HealthReport = {
  problems: Problem[];
  weekly: HealthSnapshot["weekly"] | null;
  isWeekly: boolean;
  /** Added on the weekly day, after the report is built; null when cost tracking is off. */
  costs?: CostPerGift | "unreadable" | null;
  /** Added after the report is built while health_launch_numbers is 1; absent when it's 0. */
  launch?: LaunchNumbers | "unreadable";
};

/** The one-line report for a check that couldn't run, so a dead checker isn't silent. */
export function checkFailedReport(stage: HealthStage): HealthReport {
  return { problems: [{ kind: "check_failed", detail: { stage } }], weekly: null, isWeekly: false };
}

/**
 * What needs the owner today, in the order the email shows it. Pure: the
 * snapshot, vendor balances and settings come in as arguments (E3). A null
 * snapshot means the database can't be reached, so nothing else is read.
 */
export function healthReport(
  snap: HealthSnapshot | null,
  vendors: Vendors | null,
  s: HealthSettings | null,
  now: Date,
): HealthReport {
  if (!snap) return { problems: [{ kind: "db_down" }], weekly: null, isWeekly: false };

  const problems: Problem[] = [];
  const { today } = snap.tick;

  // A row that started and never finished is a killed tick.
  if (!today || !today.finishedAt) {
    problems.push({
      kind: "tick_missed",
      detail: snap.tick.lastOkFinishedAt ? { lastOkFinishedAt: snap.tick.lastOkFinishedAt } : {},
    });
  }

  // A balance only matters while something spends it (E8): AI for ideas and capture, the app's
  // Zinc key for ideas and Amazon paste lookups. Otherwise the owner who switched ideas off to stop
  // spending would be told every day. At or below 0 is out: an overrun comes back negative.
  const aiInUse = s !== null && (s.ideaEngineEnabled || s.captureExtractionEnabled);
  const zincInUse = s !== null && (s.ideaEngineEnabled || s.amazonPasteLookupEnabled);
  const credit = aiInUse ? (vendors?.aiCreditCents ?? null) : null;
  if (snap.noCreditRuns > 0 || (credit !== null && credit <= 0)) {
    problems.push({ kind: "no_credit", detail: { noCreditRuns: snap.noCreditRuns }, waiting: snap.ideasWaiting });
  }

  // The heartbeat doesn't count these: a tick whose idea runs all failed still finishes ok.
  if (snap.failedRuns > 0) problems.push({ kind: "ideas_failed", detail: { runs: snap.failedRuns } });

  // A failed round step alone retries; repeats show up as stuck rounds and the count goes in the weekly email (T76).
  if (today && (today.result === "failed" || today.fanoutFailed > 0)) {
    problems.push({ kind: "tick_failed", detail: { roundsFailed: today.roundsFailed, fanoutFailed: today.fanoutFailed } });
  }

  for (const r of snap.stuckRounds) {
    problems.push({ kind: "stuck_round", ids: { roundId: r.roundId, userId: r.userId }, detail: { attempts: r.attempts } });
  }
  for (const o of snap.unconfirmed) {
    problems.push({ kind: "unconfirmed", ids: { orderId: o.orderId, roundId: o.roundId, userId: o.userId } });
  }
  for (const o of snap.placingStale) {
    problems.push({ kind: "placing", ids: { orderId: o.orderId, roundId: o.roundId, userId: o.userId } });
  }
  for (const o of snap.heldZinc) {
    problems.push({
      kind: "held_zinc",
      ids: { orderId: o.orderId, roundId: o.roundId, userId: o.userId },
      detail: { holdReason: o.holdReason },
    });
  }

  if (vendors && s) {
    const ideasMissing = s.ideaEngineEnabled && (!vendors.aiConfigured || !vendors.zincConfigured);
    const captureMissing = s.captureExtractionEnabled && !vendors.aiConfigured;
    if (ideasMissing || captureMissing) {
      const missing = [!vendors.aiConfigured && "AI Gateway", s.ideaEngineEnabled && !vendors.zincConfigured && "Zinc"].filter(Boolean);
      problems.push({ kind: "ideas_not_configured", detail: { missing: missing.join(" and ") } });
    }
    if (aiInUse && vendors.aiFailed) problems.push({ kind: "vendor_failed", detail: { vendor: "AI Gateway" } });
    if (zincInUse && vendors.zincFailed) problems.push({ kind: "vendor_failed", detail: { vendor: "Zinc" } });
    if (credit !== null && credit > 0 && credit < s.aiCreditLowCents) {
      problems.push({ kind: "credit_low", detail: { balanceCents: credit, lowCents: s.aiCreditLowCents } });
    }
    const zinc = zincInUse ? vendors.zincAppBalanceCents : null;
    if (zinc !== null && zinc < s.zincAppBalanceLowCents) {
      problems.push({ kind: "zinc_low", detail: { balanceCents: zinc, lowCents: s.zincAppBalanceLowCents } });
    }
  }

  for (const r of snap.deadlineClose) {
    problems.push({
      kind: "deadline_close",
      ids: { roundId: r.roundId, userId: r.userId },
      detail: { reason: r.reason, shipByDeadline: r.shipByDeadline },
    });
  }

  // A card charged more than the "Most you'll pay" the buyer agreed to: refunded by hand.
  for (const o of snap.overMaxCharge) {
    problems.push({
      kind: "over_max_charge",
      ids: { orderId: o.orderId, roundId: o.roundId, userId: o.userId },
      detail: { chargeCents: o.chargeCents, maxChargeCents: o.maxChargeCents },
    });
  }

  return { problems, weekly: snap.weekly, isWeekly: s !== null && now.getUTCDay() === s.allClearWeekday };
}
