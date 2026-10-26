export default function LookupStatus({ lookup, pending }) {
  if (pending) {
    return (
      <p className="status status--info" role="status">
        Looking up that link…
      </p>
    )
  }

  if (!lookup) return null

  if (lookup.status === 'error') {
    // Assertive, because the paste the user just made did not work.
    return (
      <p className="status status--error" role="alert">
        {lookup.error.message}
      </p>
    )
  }

  if (lookup.status === 'complete') {
    return (
      <p className="status status--ok" role="status">
        Found it — <strong>{lookup.product.name}</strong>. Check the details, then add it.
      </p>
    )
  }

  const needsName = lookup.missing.includes('name')
  return (
    <p className="status status--warn" role="status">
      Got the image{needsName ? '' : ' and the name'} from that link. Amazon doesn’t share
      prices with browsers, so {needsName ? 'name it and add the price' : 'add the price'}{' '}
      yourself below.
    </p>
  )
}
