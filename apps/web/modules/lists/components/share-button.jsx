import { Share } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BlockedButton, buttonClass } from './ui.jsx'

const COPIED_MS = 2000

export default function ShareButton({ blockedReason, onShare }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const label = (
    <>
      <Share className="size-4" aria-hidden="true" />
      {copied ? 'Copied!' : 'Share'}
    </>
  )

  if (blockedReason) {
    return (
      <BlockedButton id="share-tooltip" reason={blockedReason} className={buttonClass.secondarySm}>
        {label}
      </BlockedButton>
    )
  }

  async function handleClick() {
    if (await onShare()) setCopied(true)
  }

  return (
    <button type="button" className={buttonClass.secondarySm} onClick={handleClick}>
      {label}
    </button>
  )
}
