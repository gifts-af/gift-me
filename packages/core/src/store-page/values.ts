// Small value readers shared by the generic reader and the Amazon reader.
import { MAX_PRICE_CENTS } from "./limits";

// Only US prices for now. A price with no currency is taken as USD.
const ACCEPTED_CURRENCY = "USD";

export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

/** "$1,024.50", "19.97" or 12 → cents; anything else → null. */
export function toCents(value: unknown, currency: unknown = null): number | null {
  if (currency !== null && currency !== undefined && currency !== "") {
    if (typeof currency !== "string" || currency.trim().toUpperCase() !== ACCEPTED_CURRENCY) return null;
  }
  let amount: number;
  if (typeof value === "number") amount = value;
  else if (typeof value === "string") {
    const digits = value.replace(/[$,\s]/g, "").replace(/^USD/i, "");
    if (!/^\d+(\.\d+)?$/.test(digits)) return null;
    amount = Number(digits);
  } else return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents > MAX_PRICE_CENTS ? null : cents;
}
