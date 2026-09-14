import { useState } from 'react'
import { formatCents } from '../lib/format.js'

export default function GiftCard({ gift, onRemove }) {
  // Never reassign img.src inside onError: if the fallback also fails the
  // handler re-fires on the new src and loops. Track a flag instead.
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = gift.imageUrl && !imageFailed

  return (
    <article className="gift-card">
      <div className={`gift-card__media${showImage ? '' : ' gift-card__media--empty'}`}>
        {showImage ? (
          // Decorative: the name is visible text directly below, and alt={name}
          // would make a screen reader announce it twice.
          <img src={gift.imageUrl} alt="" onError={() => setImageFailed(true)} />
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
          >
            View on Amazon
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
      </div>

      <button
        type="button"
        className="gift-card__remove"
        onClick={() => onRemove(gift.id)}
        aria-label={`Remove ${gift.name} from your list`}
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  )
}
