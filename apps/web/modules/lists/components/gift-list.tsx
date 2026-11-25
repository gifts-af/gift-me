import type { ReactNode } from "react";
import type { Gift } from "@/modules/lists/lib/lists";
import GiftCard from "./gift-card";

const DEFAULT_EMPTY_MESSAGE = "Nothing here yet. Paste a link from any store above, or add a gift by hand.";

// Without onRemove the list is read-only, as on a shared list. onView and
// renderActions pass through to each card (see GiftCard).
export type GiftListProps<G extends Gift = Gift> = {
  gifts: G[];
  onRemove?: (id: string) => void;
  onView?: (gift: G) => void;
  renderActions?: (gift: G) => ReactNode;
  emptyMessage?: string;
};

export default function GiftList<G extends Gift>({
  gifts,
  onRemove,
  onView,
  renderActions,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
}: GiftListProps<G>) {
  if (gifts.length === 0) {
    return <p className="text-[15px] text-muted-foreground">{emptyMessage}</p>;
  }

  // Two cards per row on a phone, three from 1024 px (mock-ups "list", "list-wide").
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {gifts.map((gift) => (
        // Keyed by a per-add id, never the ASIN: adding the same product twice
        // would collide and make React remove the wrong card.
        // The id is what a link to one gift on a list points at.
        <li key={gift.id} id={`gift-${gift.id}`} className="min-w-0">
          <GiftCard gift={gift} onRemove={onRemove} onView={onView} actions={renderActions?.(gift)} />
        </li>
      ))}
    </ul>
  );
}
