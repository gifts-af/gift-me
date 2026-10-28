// The over-budget allowance is a whole percent from 0 to 100; the database
// checks the same range (concierge.accounts.over_budget_pct).
export function parseOverBudgetPct(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const pct = Number(trimmed);
  return pct <= 100 ? pct : null;
}
