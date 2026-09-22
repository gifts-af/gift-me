import { useRef, useState } from 'react'
import { lookupAmazonProduct } from '@/lib/amazon.js'
import { centsToInputValue, parsePriceToCents } from '@/lib/format.js'
import LookupStatus from './lookup-status.jsx'

const EMPTY_DRAFT = { name: '', price: '', imageUrl: '' }
const EMPTY_META = { productUrl: null, asin: null, source: 'manual' }

function ImagePreview({ src }) {
  const [failed, setFailed] = useState(false)
  if (!src.trim()) return null
  if (failed) return <span className="thumb thumb--empty" aria-hidden="true">n/a</span>
  return (
    <img
      className="thumb"
      src={src}
      alt="Preview of the gift image"
      onError={() => setFailed(true)}
    />
  )
}

export default function AddGiftPanel({ onAdd }) {
  const [url, setUrl] = useState('')
  // Every field is seeded with '' and never undefined, so React never has to
  // switch an input from uncontrolled to controlled when autofill lands.
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [meta, setMeta] = useState(EMPTY_META)
  const [lookup, setLookup] = useState(null)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState({})
  const [announcement, setAnnouncement] = useState('')

  // Discards out-of-order lookups: paste A, autofill, paste B, autofill --
  // A's response must not land on top of B's.
  const requestId = useRef(0)
  const urlRef = useRef(null)
  const nameRef = useRef(null)
  const priceRef = useRef(null)
  const addRef = useRef(null)

  function setField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  async function handleAutofill() {
    const myRequest = ++requestId.current
    setPending(true)
    setAnnouncement('')

    let result
    try {
      result = await lookupAmazonProduct(url)
    } catch {
      result = {
        status: 'error',
        product: null,
        missing: [],
        error: { code: 'NETWORK_ERROR', message: 'That lookup failed. Try again.' },
      }
    }

    if (myRequest !== requestId.current) return // superseded
    setPending(false)
    setLookup(result)

    if (result.status === 'error') {
      // Leave the fields alone -- a failed lookup must never wipe typed input.
      urlRef.current?.focus()
      return
    }

    const { product } = result
    setDraft((prev) => ({
      name: product.name ?? '',
      price: product.priceCents === null ? prev.price : centsToInputValue(product.priceCents),
      imageUrl: product.imageUrl ?? '',
    }))
    setMeta({ productUrl: product.productUrl, asin: product.asin, source: product.source })
    setErrors({})

    // Land the cursor on the first thing still needed.
    if (result.missing.includes('name')) nameRef.current?.focus()
    else if (result.missing.includes('priceCents')) priceRef.current?.focus()
    else addRef.current?.focus()
  }

  function handleSubmit(event) {
    event.preventDefault()

    // Validate the draft unconditionally: autofill may have been edited since,
    // so where the data came from is irrelevant here.
    const name = draft.name.trim()
    const priceCents = parsePriceToCents(draft.price)
    const nextErrors = {}

    if (!name) nextErrors.name = 'Give the gift a name.'
    if (draft.price.trim() === '') nextErrors.price = 'Add a price.'
    else if (priceCents === null) nextErrors.price = 'Enter a price like 24.99.'

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      if (nextErrors.name) nameRef.current?.focus()
      else priceRef.current?.focus()
      return
    }

    onAdd({
      name,
      priceCents,
      imageUrl: draft.imageUrl.trim() || null,
      productUrl: meta.productUrl,
      asin: meta.asin,
      source: meta.source,
    })

    setUrl('')
    setDraft(EMPTY_DRAFT)
    setMeta(EMPTY_META)
    setLookup(null)
    setErrors({})
    setAnnouncement(`Added ${name} to your list.`)
    urlRef.current?.focus()
  }

  return (
    <section className="add-panel" aria-labelledby="add-heading">
      <h2 id="add-heading">Add a gift</h2>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="amazon-url">
            Amazon link <span className="field__hint">(optional)</span>
          </label>
          <div className="field-row">
            <input
              id="amazon-url"
              ref={urlRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://www.amazon.com/…/dp/B0863TXGM3"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                // After pasting a link, Enter should mean "autofill".
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleAutofill()
                }
              }}
            />
            {/* type="button" is essential: the default is submit, and being the
                first button in the form it would become the implicit Enter target. */}
            <button
              type="button"
              className="btn btn--secondary"
              onClick={handleAutofill}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? 'Looking up…' : 'Autofill'}
            </button>
          </div>
          <LookupStatus lookup={lookup} pending={pending} />
        </div>

        <p className="divider">
          <span>or fill it in yourself</span>
        </p>

        <div className="field">
          <label htmlFor="gift-name">
            Gift name <span className="field__req" aria-hidden="true">*</span>
          </label>
          <input
            id="gift-name"
            ref={nameRef}
            type="text"
            placeholder="e.g. Sony WH-1000XM4 Headphones"
            value={draft.name}
            onChange={(event) => setField('name', event.target.value)}
            aria-invalid={errors.name ? 'true' : undefined}
            aria-describedby={errors.name ? 'gift-name-error' : undefined}
          />
          {errors.name && (
            <p className="field__error" id="gift-name-error">
              {errors.name}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="gift-price">
            Price <span className="field__req" aria-hidden="true">*</span>
          </label>
          <div className={`price-input${errors.price ? ' price-input--invalid' : ''}`}>
            <span className="price-input__symbol" aria-hidden="true">$</span>
            {/* Held as the raw typed string and converted only on submit: round
                -tripping through a formatter rewrites "12." and jumps the caret. */}
            <input
              id="gift-price"
              ref={priceRef}
              type="text"
              inputMode="decimal"
              placeholder="24.99"
              value={draft.price}
              onChange={(event) => setField('price', event.target.value)}
              aria-invalid={errors.price ? 'true' : undefined}
              aria-describedby={errors.price ? 'gift-price-error' : undefined}
            />
          </div>
          {errors.price && (
            <p className="field__error" id="gift-price-error">
              {errors.price}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="gift-image">Image URL</label>
          <div className="field-row">
            <input
              id="gift-image"
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://…"
              value={draft.imageUrl}
              onChange={(event) => setField('imageUrl', event.target.value)}
            />
            {/* key resets the preview's failure flag whenever the URL changes. */}
            <ImagePreview key={draft.imageUrl} src={draft.imageUrl} />
          </div>
        </div>

        <div className="form-actions">
          <button ref={addRef} type="submit" className="btn btn--primary">
            Add to my list
          </button>
        </div>
      </form>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}
