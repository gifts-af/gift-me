import { describe, expect, it } from "vitest";
import { chargeCents, feeParts, goodsCapCents, type FeeInputs } from "./card-fees";

const F: FeeInputs = { marginCents: 100, zincFeeCents: 100, cardFeeBps: 290, cardFeeFixedCents: 30 };

describe("chargeCents", () => {
  it("matches Zinc's documented example: $50 goods, $2.50 margin, $1 fee gives $55.41", () => {
    expect(chargeCents(5000, { ...F, marginCents: 250 })).toBe(5541);
  });

  it("charges a $22.59 gift $25.64 with the launch fees", () => {
    expect(chargeCents(2259, F)).toBe(2564);
  });

  it("rejects fractions, negatives and a card rate of 100% or more", () => {
    expect(() => chargeCents(10.5, F)).toThrow(RangeError);
    expect(() => chargeCents(-1, F)).toThrow(RangeError);
    expect(() => chargeCents(100, { ...F, cardFeeBps: 10000 })).toThrow(RangeError);
    expect(() => chargeCents(100, { ...F, marginCents: -1 })).toThrow(RangeError);
  });

  it("accepts a $0 margin", () => {
    expect(chargeCents(2259, { ...F, marginCents: 0 })).toBe(2461);
  });
});

describe("feeParts", () => {
  it("splits a $22.59 gift's $3.05 fee into its parts", () => {
    expect(feeParts(2259, F)).toEqual({ marginCents: 100, zincFeeCents: 100, cardFeeCents: 105, totalFeeCents: 305 });
  });
});

describe("goodsCapCents", () => {
  it("never lets the charge at the cap exceed the maximum", () => {
    for (let max = 300; max <= 60000; max++) {
      expect(chargeCents(goodsCapCents(max, F), F)).toBeLessThanOrEqual(max);
    }
  });

  it("gives back at least the goods that a charge came from", () => {
    for (let g = 1; g <= 60000; g++) {
      expect(goodsCapCents(chargeCents(g, F), F)).toBeGreaterThanOrEqual(g);
    }
  });

  it("refuses a maximum too small to cover the fees", () => {
    expect(() => goodsCapCents(230, F)).toThrow(RangeError);
  });
});
