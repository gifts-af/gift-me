import type { PaymentSummary } from "@/modules/concierge";

/** The right-hand text of Settings' "Paying for gifts" row (ALL-115 AC-9). */
const PAYMENT_TEXT: Record<PaymentSummary | "error", string> = {
  not_allowed: "Not available yet",
  off: "Not available yet",
  paused: "Paused",
  not_connected: "Not set up",
  waiting: "Connecting",
  needs_phone: "Add your phone",
  connected: "Connected",
  error: "Couldn't load",
};

export function paymentRowText(s: PaymentSummary | "error"): string {
  return PAYMENT_TEXT[s];
}
