// The alpha money wording (ALL-94, decision 53): every action that spends money
// says so, next to the action. The amounts come from app_settings (T23).

export function centsLabel(cents: number): string {
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(2)}`;
}

export function captureReadNotice(estimateCents: number): string {
  return `Alpha: we read each capture with AI, which spends real money, about ${centsLabel(estimateCents)} each.`;
}

export const CAPTURE_READ_OFF = "Reading captures spends real money, so during alpha it's only on for test accounts.";

/** Whole dollars without cents ("$101"), else with them ("$40.50"). For the Zinc guide. */
export function dollarsLabel(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function zincFeeNotice(feeCents: number): string {
  return `Alpha: each gift costs its price plus Zinc's ${dollarsLabel(feeCents)} order fee, taken from your Zinc balance.`;
}

/** "2.9% + 30¢", from the basis points and fixed cents in app_settings (T23). */
export function topUpFeeLabel(bps: number, fixedCents: number): string {
  return `${bps / 100}% + ${centsLabel(fixedCents)}`;
}
