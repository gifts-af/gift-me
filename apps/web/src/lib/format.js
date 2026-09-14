const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// Prices are carried as integer cents everywhere, so the list total is exact.
// Formatting is the only place a price ever becomes a string.
export function formatCents(cents) {
  if (!Number.isFinite(cents)) return '--'
  return CURRENCY.format(cents / 100)
}

const MAX_PRICE_CENTS = 100_000_000 // $1,000,000

export function parsePriceToCents(raw) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[$£€,\s]/g, '')
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  // Round rather than truncate: 19.99 * 100 === 1998.9999999999998, and
  // truncating that would silently charge a cent less.
  const cents = Math.round(value * 100)
  return cents > MAX_PRICE_CENTS ? null : cents
}

export function centsToInputValue(cents) {
  if (!Number.isFinite(cents)) return ''
  return (cents / 100).toFixed(2)
}
