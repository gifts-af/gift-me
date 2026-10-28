import { X } from 'lucide-react'
import { useState } from 'react'
import { formatCents } from '@/modules/lists/lib/format.js'

/**
 * `onView`, when given, intercepts the product link (the shared list asks
 * "are you going to buy?" first). `actions` renders under the details, e.g.
 * a gift's claim status.
 */
export default function GiftCard({ gift, onRemove, onView, actions }) {
  // Never reassign img.src inside onError: if the fallback also fails the
  // handler re-fires on the new src and loops. Track a flag instead.
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = gift.imageUrl && !imageFailed

  // Amazon's P/{ASIN}.01._SCLZZZZZZZ_.jpg CDN returns a 1x1 GIF for ASINs
  // it doesn't have a product photo for -- HTTP 200, so onError never fires.
  // Treat any tiny image as absent, so the placeholder shows instead of an
  // empty box.
  function handleLoad(event) {
    if (event.currentTarget.naturalWidth <= 1) setImageFailed(true)
  }

  return (
    <article className="relative flex h-full min-w-0 flex-col gap-1 rounded-lg border bg-card px-2 pb-3 pt-2">
      <div className="mb-1 grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-md bg-muted">
        {showImage ? (
          // Decorative: the name is visible text directly below, and alt={name}
          // would make a screen reader announce it twice.
          <img
            src={gift.imageUrl}
            alt=""
            className="h-full w-full object-contain"
            onLoad={handleLoad}
            onError={() => setImageFailed(true)}
          />
        ) : (
          // --foreground, not the grey: grey on the grey fill is under 4.5:1.
          <span className="text-[13px]">No image</span>
        )}
      </div>

      <h3 className="text-[15px] font-semibold [overflow-wrap:anywhere]">{gift.name}</h3>
      <p className="num text-[15px] font-semibold">{formatCents(gift.priceCents)}</p>
      {gift.productUrl && (
        <a
          className="self-start text-[13px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
          href={gift.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            onView &&
            ((event) => {
              event.preventDefault()
              onView(gift)
            })
          }
        >
          View on Amazon
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {actions && <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{actions}</div>}

      {/* Absent on a shared list, which is read-only. */}
      {onRemove && (
        <button
          type="button"
          className="absolute right-1 top-1 grid size-11 place-items-center rounded-full bg-background/90 hover:bg-muted"
          onClick={() => onRemove(gift.id)}
          aria-label={`Remove ${gift.name} from your list`}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </article>
  )
}
