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
  // A round with a $100 budget; this order's pick was estimated at $58.
  const order = { ceilingCents: 10000, budgetCents: 10000, committedCents: 0, reservedCents: 0, feeCents: 100, pickTotalCents: 5800, marginPct: 10 };

  it("leaves room for the other picks and the order fee", () => {
    expect(maxPriceCents({ ...order, reservedCents: 4000 })).toBe(5900);
  });

  it("subtracts what earlier orders in the round committed", () => {
    expect(maxPriceCents({ ...order, committedCents: 4100 })).toBe(5800);
  });

  it("subtracts whatever fee is configured", () => {
    expect(maxPriceCents({ ...order, feeCents: 250, marginPct: 1000 })).toBe(9750);
  });

  it("with a budget, lets a price rise use the budget's room (D28), up to the margin", () => {
    expect(maxPriceCents({ ...order, marginPct: 1000 })).toBe(9900);
    expect(maxPriceCents(order)).toBe(6280);
  });

  it("refuses when nothing is left, rather than placing a $0 order", () => {
    expect(() => maxPriceCents({ ...order, committedCents: 9900 })).toThrow(RangeError);
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
    const order = { ceilingCents: 10000, budgetCents: 10000, committedCents: 0, reservedCents: 0, feeCents: 100, pickTotalCents: 5800, marginPct: 10 };
    expect(() => maxPriceCents({ ...order, feeCents: -1 })).toThrow(RangeError);
    expect(() => maxPriceCents({ ...order, pickTotalCents: -1 })).toThrow(RangeError);
    expect(() => maxPriceCents({ ...order, budgetCents: 0.5 })).toThrow(RangeError);
  });
});

describe("no budget", () => {
  it("never counts a total as over budget", () => {
    expect(classifyTotal(1_000_000, null, 15)).toBe("within");
  });

  it("caps the round at the sum of the picks the user approved", () => {
    expect(approvalCeilingCents([4200, 6800], null, 15, false)).toBe(11000);
  });

  it("is still refused with nothing picked", () => {
    expect(approvalCeilingCents([], null, 15, false)).toBeNull();
  });

  it("caps each order at its own estimated total", () => {
    expect(maxPriceCents({ ceilingCents: 11000, budgetCents: null, committedCents: 0, reservedCents: 6800, feeCents: 100, pickTotalCents: 4200, marginPct: 10 })).toBe(4100);
  });
});

// Picks of $42 and $68 (each including the $1 fee), approved together.
const noBudget = { ceilingCents: 11000, budgetCents: null, feeCents: 100, pickTotalCents: 6800, marginPct: 10 };

describe("no budget, once other orders in the round settle", () => {
  it("never lets an order cost more than its own approved total when an earlier one came in cheaper", () => {
    expect(maxPriceCents({ ...noBudget, committedCents: 3100, reservedCents: 0 })).toBe(6700);
  });

  it("never lets an order use the room a failed order released", () => {
    expect(maxPriceCents({ ...noBudget, committedCents: 0, reservedCents: 0 })).toBe(6700);
  });
});

describe("the per-pick cap can't be skipped", () => {
  it("refuses an order without its pick's approved total", () => {
    const { pickTotalCents: _, ...missing } = { ...noBudget, committedCents: 0, reservedCents: 0 };
    // @ts-expect-error pickTotalCents is required
    expect(() => maxPriceCents(missing)).toThrow(RangeError);
  });

  it("refuses an order without the round's budget", () => {
    const { budgetCents: _, ...missing } = { ...noBudget, committedCents: 0, reservedCents: 0 };
    // @ts-expect-error budgetCents is required (null means no budget)
    expect(() => maxPriceCents(missing)).toThrow(RangeError);
  });
});

describe("a confirmed over-budget round, once other orders in the round settle", () => {
  // A $100 budget; the user confirmed $110 of picks, so the ceiling is their sum.
  const over = { ...noBudget, budgetCents: 10000 };

  it("starts from the approved sum", () => {
    expect(approvalCeilingCents([4200, 6800], 10000, 15, true)).toBe(11000);
  });

  it("never lets an order use the room a failed order released", () => {
    expect(maxPriceCents({ ...over, committedCents: 0, reservedCents: 0 })).toBe(6700);
  });

  it("never lets an order cost more than its own approved total when an earlier one came in cheaper", () => {
    expect(maxPriceCents({ ...over, committedCents: 3100, reservedCents: 0 })).toBe(6700);
  });
});

describe("margin cap on one order (AC-10)", () => {
  const base = { ceilingCents: 10000, budgetCents: 10000, committedCents: 0, reservedCents: 0, feeCents: 100, pickTotalCents: 4200 };

  it("allows the pick plus the margin, less the fee", () => {
    expect(maxPriceCents({ ...base, marginPct: 10 })).toBe(4520);
  });

  it("with no margin, is the pick less the fee", () => {
    expect(maxPriceCents({ ...base, marginPct: 0 })).toBe(4100);
  });

  it("lets the smaller limit win when there is no budget", () => {
    expect(maxPriceCents({ ...base, budgetCents: null, ceilingCents: 4200, marginPct: 10 })).toBe(4100);
  });

  it("refuses a negative margin", () => {
    expect(() => maxPriceCents({ ...base, marginPct: -1 })).toThrow(RangeError);
  });
});

describe("held orders (AC-15)", () => {
  const held: CommittedOrder = { id: "o1", status: "held", maxPriceCents: 4520, finalTotalCents: null, feeCents: 100 };

  it("count like an order being placed", () => {
    expect(committedSpendCents([held])).toBe(4620);
  });

  it("leave out the orders named in excludeRoundOrderIds", () => {
    expect(committedSpendCents([held], ["o1"])).toBe(0);
    expect(committedSpendCents([held, { ...held, id: "o2" }], ["o1"])).toBe(4620);
  });
});
