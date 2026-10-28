import { formatCents } from '@/modules/lists/lib/format.js'

export default function GiftSummary({ gifts }) {
  // Derived at render. Summing integer cents keeps the total exact.
  const totalCents = gifts.reduce((sum, gift) => sum + (gift.priceCents ?? 0), 0)

  return (
    <p className="num text-[13px] text-muted-foreground">
      {gifts.length === 1 ? '1 gift' : `${gifts.length} gifts`}
      <span aria-hidden="true"> · </span>
      {formatCents(totalCents)}
      <span className="sr-only"> total</span>
    </p>
  )
}
