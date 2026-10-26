import { describe, expect, it } from "vitest";
import { Constants } from "./database.types";
import { canTransition, ROUND_STATUSES, type RoundStatus } from "./rounds";

const allowed: [RoundStatus, RoundStatus][] = [
  ["scheduled", "generating"],
  ["scheduled", "needs_address"],
  ["generating", "awaiting_approval"],
  ["generating", "needs_attention"],
  ["awaiting_approval", "ordered"],
  ["awaiting_approval", "generating"],
  ["awaiting_approval", "skipped"],
  ["ordered", "delivered"],
  ["ordered", "needs_attention"],
  ["delivered", "complete"],
  ["needs_address", "generating"],
  ["needs_address", "skipped"],
  ["needs_attention", "ordered"],
  ["needs_attention", "generating"],
  ["needs_attention", "skipped"],
];

describe("round statuses", () => {
  it("has the 9 statuses from design §5, main path first", () => {
    expect(ROUND_STATUSES).toEqual([
      "scheduled",
      "generating",
      "awaiting_approval",
      "ordered",
      "delivered",
      "complete",
      "needs_address",
      "needs_attention",
      "skipped",
    ]);
  });

  it.each(allowed)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("allows exactly those moves and no others", () => {
    const count = ROUND_STATUSES.flatMap((from) => ROUND_STATUSES.filter((to) => canTransition(from, to))).length;
    expect(count).toBe(allowed.length);
  });

  it("never leaves complete or skipped", () => {
    for (const to of ROUND_STATUSES) {
      expect(canTransition("complete", to)).toBe(false);
      expect(canTransition("skipped", to)).toBe(false);
    }
  });

  it("matches the database's round_status enum", () => {
    expect([...Constants.concierge.Enums.round_status]).toEqual([...ROUND_STATUSES]);
  });

  it("can't regenerate ideas after buying", () => {
    expect(canTransition("ordered", "generating")).toBe(false);
  });
});
