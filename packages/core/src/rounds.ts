// Gift round statuses and the moves between them (design §5, T14). The
// database's `gift_rounds.status` enum uses the same list.

export const ROUND_STATUSES = [
  // Main path
  "scheduled",
  "generating",
  "awaiting_approval",
  "ordered",
  "delivered",
  "complete",
  // Side statuses
  "needs_address",
  "needs_attention",
  "skipped",
] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

const NEXT: Record<RoundStatus, readonly RoundStatus[]> = {
  scheduled: ["generating", "needs_address", "skipped"],
  generating: ["awaiting_approval", "needs_attention", "skipped"],
  awaiting_approval: ["ordered", "generating", "needs_attention", "skipped"],
  ordered: ["delivered", "needs_attention"],
  delivered: ["complete"],
  complete: [],
  needs_address: ["generating", "skipped"],
  // awaiting_approval: "Pick a different gift" drops the only failed gift (drop_failed_order).
  needs_attention: ["ordered", "generating", "skipped", "awaiting_approval"],
  skipped: [],
};

export function canTransition(from: RoundStatus, to: RoundStatus): boolean {
  return NEXT[from].includes(to);
}
