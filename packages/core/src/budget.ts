// Budget math (design §4.2, PRD D10, D11, D28, D29). All money is whole
// cents; anything that has to round, rounds down, so a rounding error can
// only ever spend less.
//
// The budget is optional (product decision 36): `null` means no budget, so
// nothing is over budget and the cap comes from the approved picks instead.
//
// The checkout service's per-order fee is a setting, not a constant (T23):
// callers read it from `concierge.app_settings` and pass it in as `feeCents`.

export type BudgetFit = "within" | "over" | "dropped";

function checkCents(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be whole cents, 0 or more; got ${value}`);
  }
}

export function estimatedTotalCents(p: {
  priceCents: number;
  shippingCents: number;
  taxCents: number;
  feeCents: number;
}): number {
  for (const [what, v] of [["Price", p.priceCents], ["Shipping", p.shippingCents], ["Tax", p.taxCents], ["Fee", p.feeCents]] as const) {
    checkCents(v, what);
  }
  return p.priceCents + p.shippingCents + p.taxCents + p.feeCents;
}

/** The most an over-budget idea may cost: budget × (1 + pct / 100), rounded down. */
export function overBudgetLimitCents(budgetCents: number, overBudgetPct: number): number {
  checkCents(budgetCents, "Budget");
  if (!Number.isFinite(overBudgetPct) || overBudgetPct < 0) {
    throw new RangeError(`Over-budget percent must be 0 or more; got ${overBudgetPct}`);
  }
  return Math.floor((budgetCents * (100 + overBudgetPct)) / 100);
}

/**
 * Within budget, over budget (up to and including the limit), or dropped.
 * Used for a single idea and for the sum of several picks alike. With no
 * budget, everything is within it.
 */
export function classifyTotal(totalCents: number, budgetCents: number | null, overBudgetPct: number): BudgetFit {
  checkCents(totalCents, "Total");
  if (budgetCents === null || totalCents <= budgetCents) return "within";
  return totalCents <= overBudgetLimitCents(budgetCents, overBudgetPct) ? "over" : "dropped";
}

/**
 * The most the round may spend once the user approves these picks: the
 * budget when they fit, or their sum when the user deliberately approved
 * going over. With no budget, it's their sum, so a price rise above what
 * was approved stops the order. `null` means the approval is refused.
 */
export function approvalCeilingCents(
  selectedTotalsCents: number[],
  budgetCents: number | null,
  overBudgetPct: number,
  overBudgetConfirmed: boolean,
): number | null {
  if (selectedTotalsCents.length === 0) return null;
  const sum = selectedTotalsCents.reduce((a, b) => a + b, 0);
  switch (classifyTotal(sum, budgetCents, overBudgetPct)) {
    case "within":
      return budgetCents ?? sum;
    case "over":
      return overBudgetConfirmed ? sum : null;
    case "dropped":
      return null;
  }
}

export type CommittedOrder = {
  status: "placing" | "placed" | "failed" | "shipped" | "delivered" | "cancelled" | "refunded";
  maxPriceCents: number;
  finalTotalCents: number | null;
  feeCents: number;
};

const RELEASED: ReadonlySet<CommittedOrder["status"]> = new Set(["failed", "cancelled", "refunded"]);

/**
 * Spend already used up in a round. An order holds its full cap until its
 * real total is known; failed, cancelled and refunded orders release theirs.
 */
export function committedSpendCents(orders: CommittedOrder[]): number {
  return orders
    .filter((o) => !RELEASED.has(o.status))
    .reduce((sum, o) => sum + (o.finalTotalCents ?? o.maxPriceCents) + o.feeCents, 0);
}

/**
 * The `max_price` to send Zinc for one order. It covers item, shipping and
 * tax, but not the order fee. `reservedCents` holds back room for the round's
 * other picks that haven't been ordered yet, so the first order can't use
 * up the whole budget.
 *
 * With no budget, pass the pick's own approved total as `pickTotalCents`:
 * the order is then never allowed to cost more than that, even when other
 * orders in the round came in cheaper or failed and freed up room.
 */
export function maxPriceCents(p: {
  ceilingCents: number;
  committedCents: number;
  reservedCents: number;
  feeCents: number;
  pickTotalCents?: number;
}): number {
  checkCents(p.ceilingCents, "Ceiling");
  checkCents(p.committedCents, "Committed spend");
  checkCents(p.reservedCents, "Reserved spend");
  checkCents(p.feeCents, "Fee");
  let max = p.ceilingCents - p.committedCents - p.reservedCents - p.feeCents;
  if (p.pickTotalCents !== undefined) {
    checkCents(p.pickTotalCents, "Pick total");
    max = Math.min(max, p.pickTotalCents - p.feeCents);
  }
  if (max <= 0) {
    // A budget bug, never an order: there's no room left in this round.
    throw new RangeError(`No budget left for this order (max_price would be ${max} cents)`);
  }
  return max;
}

/** In wallet mode, Zinc sets aside the full cap plus the fee when it places an order. */
export function walletRequiredCents(maxPrice: number, feeCents: number): number {
  checkCents(maxPrice, "max_price");
  checkCents(feeCents, "Fee");
  return maxPrice + feeCents;
}
