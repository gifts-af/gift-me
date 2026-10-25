import { describe, expect, it } from "vitest";
import {
  approvalCeilingCents,
  classifyTotal,
  committedSpendCents,
  estimatedTotalCents,
  maxPriceCents,
  overBudgetLimitCents,
  walletRequiredCents,
  type CommittedOrder,
} from "./budget";

describe("estimated total", () => {
  it("adds price, shipping, tax and the order fee", () => {
    expect(estimatedTotalCents({ priceCents: 4000, shippingCents: 500, taxCents: 300, feeCents: 100 })).toBe(4900);
  });

  it("uses whatever fee it's given, since the fee is a setting", () => {
    expect(estimatedTotalCents({ priceCents: 4000, shippingCents: 0, taxCents: 0, feeCents: 0 })).toBe(4000);
    expect(estimatedTotalCents({ priceCents: 4000, shippingCents: 0, taxCents: 0, feeCents: 250 })).toBe(4250);
  });
});

describe("over-budget limit", () => {
  it("is the budget plus the over-budget percent", () => {
    expect(overBudgetLimitCents(10000, 15)).toBe(11500);
  });

  it("rounds down to whole cents", () => {
    // 3333 × 1.15 = 3832.95
    expect(overBudgetLimitCents(3333, 15)).toBe(3832);
  });
});

describe("classifying a total", () => {
  it("sorts a $100 budget at 15% into within, over and dropped", () => {
    expect(classifyTotal(10000, 10000, 15)).toBe("within");
    expect(classifyTotal(10001, 10000, 15)).toBe("over");
    expect(classifyTotal(11500, 10000, 15)).toBe("over");
    expect(classifyTotal(11501, 10000, 15)).toBe("dropped");
  });

  it("counts the rounded-down limit itself as over budget", () => {
    expect(classifyTotal(3832, 3333, 15)).toBe("over");
    expect(classifyTotal(3833, 3333, 15)).toBe("dropped");
  });
});

describe("approval ceiling for one or more picks", () => {
  it("is the budget when the picks fit within it", () => {
    expect(approvalCeilingCents([4000, 5000], 10000, 15, false)).toBe(10000);
  });

  it("is refused over budget unless the user confirmed it", () => {
    expect(approvalCeilingCents([6000, 5000], 10000, 15, false)).toBeNull();
    expect(approvalCeilingCents([6000, 5000], 10000, 15, true)).toBe(11000);
  });

  it("is refused past the over-budget limit even when confirmed", () => {
    expect(approvalCeilingCents([6000, 6000], 10000, 15, true)).toBeNull();
  });

  it("is refused with nothing picked", () => {
    expect(approvalCeilingCents([], 10000, 15, false)).toBeNull();
  });
});

describe("committed spend", () => {
  const order = (o: Partial<CommittedOrder>): CommittedOrder => ({
    status: "placing",
    maxPriceCents: 5000,
    finalTotalCents: null,
    feeCents: 100,
    ...o,
  });

  it("holds the full cap plus fee while an order is being placed", () => {
    expect(committedSpendCents([order({})])).toBe(5100);
  });

  it("uses the real total once the order is placed", () => {
    expect(committedSpendCents([order({ status: "placed", finalTotalCents: 4200 })])).toBe(4300);
  });

  it("releases failed, cancelled and refunded orders", () => {
    expect(
      committedSpendCents([
        order({ status: "failed" }),
        order({ status: "cancelled", finalTotalCents: 4200 }),
        order({ status: "refunded", finalTotalCents: 4200 }),
      ]),
    ).toBe(0);
  });

  it("adds up shipped and delivered orders", () => {
    expect(
      committedSpendCents([
        order({ status: "shipped", finalTotalCents: 2000 }),
        order({ status: "delivered", finalTotalCents: 3000 }),
      ]),
    ).toBe(5200);
  });
});

describe("max_price for an order", () => {
  const fee = { feeCents: 100 };

  it("leaves room for the other picks and the order fee", () => {
    expect(maxPriceCents({ ceilingCents: 10000, committedCents: 0, reservedCents: 4000, ...fee })).toBe(5900);
  });

  it("subtracts what earlier orders in the round committed", () => {
    expect(maxPriceCents({ ceilingCents: 10000, committedCents: 4100, reservedCents: 0, ...fee })).toBe(5800);
  });

  it("subtracts whatever fee is configured", () => {
    expect(maxPriceCents({ ceilingCents: 10000, committedCents: 0, reservedCents: 0, feeCents: 250 })).toBe(9750);
  });

  it("refuses when nothing is left, rather than placing a $0 order", () => {
    expect(() => maxPriceCents({ ceilingCents: 10000, committedCents: 9900, reservedCents: 0, ...fee })).toThrow(RangeError);
  });
});

describe("wallet", () => {
  it("must hold the full cap plus the fee", () => {
    expect(walletRequiredCents(5900, 100)).toBe(6000);
    expect(walletRequiredCents(5900, 250)).toBe(6150);
  });
});

describe("bad input", () => {
  it("rejects negative or fractional cents", () => {
    expect(() => classifyTotal(-1, 10000, 15)).toThrow(RangeError);
    expect(() => classifyTotal(100.5, 10000, 15)).toThrow(RangeError);
    expect(() => overBudgetLimitCents(10000, -5)).toThrow(RangeError);
    expect(() => estimatedTotalCents({ priceCents: 1, shippingCents: -1, taxCents: 0, feeCents: 100 })).toThrow(RangeError);
    expect(() => walletRequiredCents(0.5, 100)).toThrow(RangeError);
    expect(() => walletRequiredCents(5900, -1)).toThrow(RangeError);
    expect(() => maxPriceCents({ ceilingCents: 10000, committedCents: 0, reservedCents: 0, feeCents: -1 })).toThrow(RangeError);
  });
});
