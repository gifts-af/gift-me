import type { HealthSnapshot } from "../health/store";
import type { HealthSettings, Vendors } from "../health/report";

export const TUESDAY = new Date("2026-11-24T14:00:00Z");
export const MONDAY = new Date("2026-11-23T14:00:00Z");

export const settings: HealthSettings = {
  allClearWeekday: 1,
  aiCreditLowCents: 500,
  zincAppBalanceLowCents: 500,
  ideaEngineEnabled: false,
  captureExtractionEnabled: false,
  amazonPasteLookupEnabled: false,
};

/** The credit and Zinc balance checks run only while something spends them. */
export const spending: HealthSettings = { ...settings, captureExtractionEnabled: true, amazonPasteLookupEnabled: true };

export const vendors: Vendors = { aiCreditCents: 5000, zincAppBalanceCents: 5000, aiConfigured: true, zincConfigured: true };

export function snapshot(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    tick: {
      lastOkFinishedAt: "2026-11-23T10:05:00Z",
      today: { startedAt: "2026-11-24T10:00:00Z", finishedAt: "2026-11-24T10:04:00Z", result: "ok", roundsFailed: 0, fanoutFailed: 0 },
    },
    noCreditRuns: 0,
    stuckRounds: [],
    unconfirmed: [],
    placingStale: [],
    heldZinc: [],
    deadlineClose: [],
    ideasWaiting: [],
    weekly: { waitingAddress: 0, waitingFunds: 0, waitingSetup: 0, waitingApproval: 0, noIdeas: 0, roundsFailed: 0, failedCaptures: 0 },
    ...over,
  };
}

export const withToday = (today: Partial<NonNullable<HealthSnapshot["tick"]["today"]>>): HealthSnapshot => {
  const base = snapshot();
  return { ...base, tick: { ...base.tick, today: { ...base.tick.today!, ...today } } };
};
