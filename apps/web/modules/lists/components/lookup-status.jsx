export default function LookupStatus({ lookup, pending }) {
  if (pending) {
    return (
      <p className="text-[13px] text-muted-foreground" role="status">
        Looking up that link…
      </p>
    )
  }

  if (!lookup) return null

  if (lookup.status === 'error') {
    // Assertive, because the paste the user just made did not work.
    return (
      <p className="text-[13px] text-destructive" role="alert">
        {lookup.error.message}
      </p>
    )
  }

  if (lookup.status === 'complete') {
    return (
      <p className="text-[13px] text-success" role="status">
        Found it. Check the details, then add it.
      </p>
    )
  }

  const needsName = lookup.missing.includes('name')
  if (lookup.product.source === 'store-url') {
    return (
      <p className="text-[13px] text-warning" role="status">
        {needsName ? 'Saved the link.' : 'Got the name from that link.'} We can’t read prices from{' '}
        {lookup.product.store} yet, so {needsName ? 'name it and add the price' : 'add the price'} below.
      </p>
    )
  }
  return (
    <p className="text-[13px] text-warning" role="status">
      Got the image{needsName ? '' : ' and the name'} from that link. Amazon doesn’t share prices
      with browsers, so {needsName ? 'name it and add the price' : 'add the price'} below.
    </p>
  )
}
