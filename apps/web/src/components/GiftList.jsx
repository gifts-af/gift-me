import GiftCard from './GiftCard.jsx'

export default function GiftList({ gifts, onRemove }) {
  if (gifts.length === 0) {
    return (
      <p className="empty">
        Nothing here yet. Paste an Amazon link above, or fill the fields in yourself.
      </p>
    )
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
