// Which of Zinc's error codes mean the buyer's card was refused, and what failure each Zinc
// code becomes on our order. Shared by every place that fails an order from Zinc's answer: a
// first 4xx, an order found already failed, the sweep, and a webhook event.

/**
 * Zinc's documented card-payment codes (assumption A1 until a real decline): the bank or Stripe
 * refused the card, or wants the buyer to approve. `payment_declined` is the store refusing
 * payment, not the bank, so it isn't one.
 */
export const CARD_CODES: readonly string[] = [
  "payment_failed",
  "invalid_payment_method",
  "payment_method_required",
  "card_verification_required",
  "insufficient_funds",
];

export function isCardCode(code: string | undefined): boolean {
  return code !== undefined && CARD_CODES.includes(code);
}

/**
 * Zinc's error type to the failure type our SQL takes. On a card order a card code is
 * `card_declined` (fail_order_row ends it as card_needed and clears the card if it's still the
 * saved one). On a wallet order there's no card of ours, so it's an ordinary failure. Anything
 * unknown is a plain failure, never `funds`.
 */
export function failureTypeFor(code: string | undefined, fundingMode: string): string {
  if (fundingMode === "connect" && isCardCode(code)) return "card_declined";
  if (code === "max_price_exceeded") return "price_up";
  if (code === "out_of_stock" || code === "invalid_shipping_address") return code;
  return "failed";
}
