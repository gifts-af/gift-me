import { useEffect, useState } from 'react'

const COPIED_MS = 2000

export default function ShareButton({ blockedReason, onShare }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  if (blockedReason) {
    // Same aria-disabled pattern as SaveButton, so the reason stays reachable.
    return (
      <span className="tooltip-anchor">
        <button
          type="button"
          className="btn btn--muted"
          aria-disabled="true"
          aria-describedby="share-tooltip"
          onClick={(event) => event.preventDefault()}
        >
          Share
        </button>
        <span className="tooltip" id="share-tooltip" role="tooltip">
          {blockedReason}
        </span>
      </span>
    )
  }

  async function handleClick() {
    if (await onShare()) setCopied(true)
  }

  return (
    <button type="button" className="btn btn--secondary" onClick={handleClick}>
      {copied ? 'Copied!' : 'Share'}
    </button>
  )
}
