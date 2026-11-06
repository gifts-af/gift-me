// Wallet funding math (design §4.2, ALL-32). Zinc sets aside each order's
// full cap plus the fee, so the wallet has to cover that sum. All money is
// whole cents; the fee is a setting passed in by the caller (T23).

type OrderCap = { maxPriceCents: number; feeCents: number };

export type LookaheadRound = {
  /** The round's real order caps, or null while it has no orders yet. */
  orders: OrderCap[] | null;
  budgetCents: number | null;
};

function checkCents(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be whole cents, 0 or more; got ${value}`);
  }
}

function requiredCents(orders: OrderCap[]): number {
  return orders.reduce((sum, o) => {
    checkCents(o.maxPriceCents, "max_price");
    checkCents(o.feeCents, "Fee");
    return sum + o.maxPriceCents + o.feeCents;
  }, 0);
}

/** What the wallet is missing to cover these orders' caps plus fees; 0 when it already does. */
export function shortfallCents(orders: OrderCap[], balanceCents: number): number {
  checkCents(balanceCents, "Balance");
  return Math.max(0, requiredCents(orders) - balanceCents);
}

/**
 * What upcoming rounds are likely to need: the real caps where orders exist,
 * else the budget plus one order fee. A round with neither adds nothing and
 * makes the total a lower bound (`atLeast`).
 */
export function lookaheadCents(rounds: LookaheadRound[], feeCents: number): { cents: number; atLeast: boolean } {
  checkCents(feeCents, "Fee");
  let cents = 0;
  let atLeast = false;
  for (const r of rounds) {
    if (r.orders !== null) {
      cents += requiredCents(r.orders);
    } else if (r.budgetCents !== null) {
      checkCents(r.budgetCents, "Budget");
      cents += r.budgetCents + feeCents;
    } else {
      atLeast = true;
    }
  }
  return { cents, atLeast };
}

/**
 * A wallet balance worth suggesting: enough for the largest budget and one
 * fee. An order never costs more than the budget, so the margin can't push
 * past it; it is checked here so a bad setting shows up early. `null` with
 * no budget to go on.
 */
export function suggestedMinimumCents(largestBudgetCents: number | null, marginPct: number, feeCents: number): number | null {
  if (!Number.isFinite(marginPct) || marginPct < 0) {
    throw new RangeError(`Margin percent must be 0 or more; got ${marginPct}`);
  }
  checkCents(feeCents, "Fee");
  if (largestBudgetCents === null) return null;
  checkCents(largestBudgetCents, "Budget");
  return largestBudgetCents + feeCents;
}
