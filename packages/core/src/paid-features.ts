// The alpha money wording (ALL-94, decision 53): every action that spends money
// says so, next to the action. The amounts come from app_settings (T23).

export function centsLabel(cents: number): string {
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(2)}`;
}

export function captureReadNotice(estimateCents: number): string {
  return `Alpha: we read each capture with AI, which spends real money, about ${centsLabel(estimateCents)} each.`;
}

export const CAPTURE_READ_OFF = "Reading captures spends real money, so during alpha it's only on for test accounts.";
