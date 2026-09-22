import { formatCents } from '@/lib/format.js'

export default function GiftSummary({ gifts }) {
  // Derived at render. Summing integer cents keeps the total exact.
  const totalCents = gifts.reduce((sum, gift) => sum + (gift.priceCents ?? 0), 0)

  return (
    <p className="summary">
      <span>{gifts.length === 1 ? '1 gift' : `${gifts.length} gifts`}</span>
      <span className="summary__dot" aria-hidden="true">·</span>
      <strong>{formatCents(totalCents)}</strong>
      <span className="visually-hidden"> total</span>
    </p>
  )
}
