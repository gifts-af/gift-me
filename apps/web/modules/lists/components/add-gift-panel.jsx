import { useLayoutEffect, useRef, useState } from 'react'
import { lookupAmazonProduct } from '@/modules/lists/lib/amazon.js'
import { centsToInputValue, formatCents, parsePriceToCents } from '@/modules/lists/lib/format.js'
import LookupStatus from './lookup-status.jsx'
import { buttonClass, inputClass, labelClass } from './ui.jsx'

const EMPTY_DRAFT = { name: '', price: '', imageUrl: '' }
const EMPTY_META = { productUrl: null, asin: null, source: 'manual' }

function ImagePreview({ src }) {
  const [failed, setFailed] = useState(false)
  if (!src.trim()) return null
  if (failed) {
    return (
      <span className="grid size-11 flex-none place-items-center rounded-md bg-muted text-[13px]" aria-hidden="true">
        n/a
      </span>
    )
  }
  return (
    <img
      className="size-11 flex-none rounded-md object-contain"
      src={src}
      alt="Preview of the gift image"
      // Amazon returns a 1x1 GIF placeholder (HTTP 200) for ASINs it lacks a
      // photo for, so onError never fires -- catch it via naturalWidth.
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth <= 1) setFailed(true)
      }}
      onError={() => setFailed(true)}
    />
  )
}

function FieldError({ id, children }) {
  return (
    <p className="text-[13px] font-normal text-destructive" id={id}>
      {children}
    </p>
  )
}

/**
 * Paste a link and tap Add (mock-up "list"): a full match shows as a card to
 * confirm; a partial one opens the details, prefilled, at the missing field.
 * "Add by hand" opens the same details empty.
 */
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
  // 'closed' | 'found' (confirm a full match) | 'details' (the editable fields)
  const [mode, setMode] = useState('closed')

  // Discards out-of-order lookups: paste A, add, paste B, add -- A's response
  // must not land on top of B's.
  const requestId = useRef(0)
  const urlRef = useRef(null)
  const nameRef = useRef(null)
  const priceRef = useRef(null)
  const addRef = useRef(null)

  function setField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  // Focus has to wait for the fields to render after a mode change, so it's
  // queued here and applied straight after that render -- never on a timer,
  // which could pull a fast typist out of the field they'd moved to.
  const pendingFocus = useRef(null)
  function focusSoon(ref) {
    pendingFocus.current = ref
  }
  useLayoutEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current.current?.focus()
    pendingFocus.current = null
  })

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
    if (result.missing.includes('name')) {
      setMode('details')
      focusSoon(nameRef)
    } else if (result.missing.includes('priceCents')) {
      setMode('details')
      focusSoon(priceRef)
    } else {
      setMode('found')
      focusSoon(addRef)
    }
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
      setMode('details')
      focusSoon(nextErrors.name ? nameRef : priceRef)
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
    setMode('closed')
    setAnnouncement(`Added ${name} to your list.`)
    urlRef.current?.focus()
  }

  return (
    <section className="flex flex-col gap-3 lg:max-w-xl" aria-label="Add a gift">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="amazon-url" className={labelClass}>
              Paste an Amazon link
            </label>
            <input
              id="amazon-url"
              ref={urlRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="amazon.com/dp/…"
              className={inputClass}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                // After pasting a link, Enter should mean "look it up".
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleAutofill()
                }
              }}
            />
          </div>
          {/* type="button" is essential: the default is submit, and being the
              first button in the form it would become the implicit Enter target. */}
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={handleAutofill}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? 'Looking…' : 'Add'}
          </button>
        </div>
        <LookupStatus lookup={lookup} pending={pending} />

        {mode === 'found' && (
          <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <ImagePreview key={draft.imageUrl} src={draft.imageUrl} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{draft.name}</p>
              <p className="num text-[13px] text-muted-foreground">
                {formatCents(parsePriceToCents(draft.price) ?? 0)} · found on Amazon
              </p>
              <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-[3px]" onClick={() => setMode('details')}>
                Edit details
              </button>
            </div>
            <button ref={addRef} type="submit" className={buttonClass.secondarySm}>
              Add to list
            </button>
          </div>
        )}

        {mode !== 'details' && (
          <button
            type="button"
            className={`${buttonClass.link} self-start`}
            onClick={() => {
              setMode('details')
              focusSoon(nameRef)
            }}
          >
            Add by hand
          </button>
        )}

        {mode === 'details' && (
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Gift details</legend>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="gift-name" className={labelClass}>
                Gift name
              </label>
              <input
                id="gift-name"
                ref={nameRef}
                type="text"
                className={inputClass}
                value={draft.name}
                onChange={(event) => setField('name', event.target.value)}
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={errors.name ? 'gift-name-error' : undefined}
              />
              {errors.name && <FieldError id="gift-name-error">{errors.name}</FieldError>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="gift-price" className={labelClass}>
                Price
              </label>
              <div className="relative max-w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true">
                  $
                </span>
                {/* Held as the raw typed string and converted only on submit: round
                    -tripping through a formatter rewrites "12." and jumps the caret. */}
                <input
                  id="gift-price"
                  ref={priceRef}
                  type="text"
                  inputMode="decimal"
                  placeholder="24.99"
                  className={`${inputClass} num pl-7`}
                  value={draft.price}
                  onChange={(event) => setField('price', event.target.value)}
                  aria-invalid={errors.price ? 'true' : undefined}
                  aria-describedby={errors.price ? 'gift-price-error' : undefined}
                />
              </div>
              {errors.price && <FieldError id="gift-price-error">{errors.price}</FieldError>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="gift-image" className={labelClass}>
                Image URL <span className="font-normal text-muted-foreground">Optional</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="gift-image"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://…"
                  className={inputClass}
                  value={draft.imageUrl}
                  onChange={(event) => setField('imageUrl', event.target.value)}
                />
                {/* key resets the preview's failure flag whenever the URL changes. */}
                <ImagePreview key={draft.imageUrl} src={draft.imageUrl} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button ref={addRef} type="submit" className={buttonClass.secondary}>
                Add to list
              </button>
              <button
                type="button"
                className={buttonClass.link}
                onClick={() => {
                  setMode('closed')
                  setErrors({})
                }}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        )}
      </form>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}
