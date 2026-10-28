import GiftCard from './gift-card.jsx'

const DEFAULT_EMPTY_MESSAGE = 'Nothing here yet. Paste an Amazon link above, or add a gift by hand.'

// Without onRemove the list is read-only, as on a shared list. onView and
// renderActions pass through to each card (see GiftCard).
export default function GiftList({
  gifts,
  onRemove,
  onView,
  renderActions,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
}) {
  if (gifts.length === 0) {
    return <p className="text-[15px] text-muted-foreground">{emptyMessage}</p>
  }

  // Two cards per row on a phone, three from 1024 px (mock-ups "list", "list-wide").
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {gifts.map((gift) => (
        // Keyed by a per-add id, never the ASIN: adding the same product twice
        // would collide and make React remove the wrong card.
        <li key={gift.id} className="min-w-0">
          <GiftCard
            gift={gift}
            onRemove={onRemove}
            onView={onView}
            actions={renderActions?.(gift)}
          />
        </li>
      ))}
    </ul>
  )
}
