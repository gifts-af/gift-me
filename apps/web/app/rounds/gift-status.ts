import { shortDate } from "@/lib/occasion-format";
import { money } from "@/app/people/[id]/money";

// Where a bought gift ended up, in the same words on the round screen and in past gifts.

/** Zinc's own refund amount; without one, no amount (never what we were charged). */
export function storeCancelledText(refundCents: number | null): string {
  const amount = refundCents !== null && refundCents > 0 ? `${money(refundCents)} back in Zinc` : "the money is back in Zinc";
  return `The store cancelled it · ${amount}`;
}

export function deliveredText(deliveredAt: string | null): string {
  return deliveredAt ? `Delivered ${shortDate(deliveredAt.slice(0, 10))}` : "Delivered";
}
