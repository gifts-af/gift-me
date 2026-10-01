import GiftCard from './gift-card.jsx'

const DEFAULT_EMPTY_MESSAGE =
  'Nothing here yet. Paste an Amazon link above, or fill the fields in yourself.'

// Without onRemove the list is read-only, as on a shared list.
export default function GiftList({ gifts, onRemove, emptyMessage = DEFAULT_EMPTY_MESSAGE }) {
  if (gifts.length === 0) {
    return <p className="empty">{emptyMessage}</p>
  }

  return (
    <ul className="gift-grid">
      {gifts.map((gift) => (
        // Keyed by a per-add id, never the ASIN: adding the same product twice
        // would collide and make React remove the wrong card.
        <li key={gift.id}>
          <GiftCard gift={gift} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  )
}
