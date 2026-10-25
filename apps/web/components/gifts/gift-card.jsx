import { useState } from 'react'
import { formatCents } from '@/lib/format.js'

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
    <article className="gift-card">
      <div className={`gift-card__media${showImage ? '' : ' gift-card__media--empty'}`}>
        {showImage ? (
          // Decorative: the name is visible text directly below, and alt={name}
          // would make a screen reader announce it twice.
          <img
            src={gift.imageUrl}
            alt=""
            onLoad={handleLoad}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="gift-card__placeholder">No image</span>
        )}
      </div>

      <div className="gift-card__body">
        <h3 className="gift-card__name">{gift.name}</h3>
        <p className="gift-card__price">{formatCents(gift.priceCents)}</p>
        {gift.productUrl && (
          <a
            className="gift-card__link"
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
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
        {actions && <div className="gift-card__actions">{actions}</div>}
      </div>

      {/* Absent on a shared list, which is read-only. */}
      {onRemove && (
        <button
          type="button"
          className="gift-card__remove"
          onClick={() => onRemove(gift.id)}
          aria-label={`Remove ${gift.name} from your list`}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </article>
  )
}
