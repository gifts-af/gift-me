import { describe, expect, it } from "vitest";
import { lookaheadCents, shortfallCents, suggestedMinimumCents } from "./funding";

describe("shortfallCents", () => {
  const orders = [{ maxPriceCents: 4520, feeCents: 100 }];

  it("is what the wallet is missing for the caps plus fees", () => {
    expect(shortfallCents(orders, 1200)).toBe(3420);
  });

  it("is 0 when the wallet covers them", () => {
    expect(shortfallCents(orders, 4620)).toBe(0);
    expect(shortfallCents(orders, 9999)).toBe(0);
  });

  it("adds up several orders", () => {
    expect(shortfallCents([...orders, { maxPriceCents: 1000, feeCents: 100 }], 0)).toBe(5720);
  });

  it("refuses bad cents", () => {
    expect(() => shortfallCents(orders, -1)).toThrow(RangeError);
  });
});

describe("lookaheadCents", () => {
  it("uses the real caps where orders exist and the budget plus fee where they don't", () => {
    expect(
      lookaheadCents(
        [
          { orders: [{ maxPriceCents: 4520, feeCents: 100 }], budgetCents: 10000 },
          { orders: null, budgetCents: 5000 },
        ],
        100,
      ),
    ).toEqual({ cents: 9720, atLeast: false });
  });

  it("is only a lower bound when a round has neither orders nor a budget", () => {
    expect(lookaheadCents([{ orders: null, budgetCents: 5000 }, { orders: null, budgetCents: null }], 100)).toEqual({
      cents: 5100,
      atLeast: true,
    });
  });

  it("is 0 for no rounds", () => {
    expect(lookaheadCents([], 100)).toEqual({ cents: 0, atLeast: false });
  });
});

describe("suggestedMinimumCents", () => {
  it("is the largest budget plus one fee", () => {
    expect(suggestedMinimumCents(10000, 10, 100)).toBe(10100);
  });

  it("is null with no budget to go on", () => {
    expect(suggestedMinimumCents(null, 10, 100)).toBeNull();
  });
});
