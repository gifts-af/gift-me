'use client'

import { useEffect, useRef, useState } from 'react'
import { saveList } from '@/app/actions/lists'
import AddGiftPanel from './add-gift-panel.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import SaveButton from './save-button.jsx'
import './gifts.css'

// A guest's list is carried across the trip to /auth/* in localStorage, so
// signing in (or confirming a sign-up email in a new tab) doesn't lose it.
const GUEST_STASH_KEY = 'giftme:guest-list'
const GUEST_STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000

// crypto.randomUUID is undefined outside a secure context -- which includes
// demoing over plain HTTP on a phone via `next dev -H 0.0.0.0`.
function newId() {
  return crypto.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// What "unsaved changes" compares: the content and order of the list, never
// the ids, which change when the server hands back its own rows.
function serialize(gifts) {
  return JSON.stringify(
    gifts.map((g) => [g.name, g.priceCents, g.imageUrl, g.productUrl, g.asin, g.source]),
  )
}

// `keep` leaves the stash in place, for when the list it would join can't be
// saved yet -- a later, successful load picks it up again.
function takeGuestStash({ keep = false } = {}) {
  try {
    const raw = localStorage.getItem(GUEST_STASH_KEY)
    if (!raw) return []
    if (!keep) localStorage.removeItem(GUEST_STASH_KEY)
    const stash = JSON.parse(raw)
    if (!Array.isArray(stash?.items) || Date.now() - stash.at > GUEST_STASH_MAX_AGE_MS) return []
    return stash.items.map((gift) => ({ ...gift, id: newId() }))
  } catch {
    return [] // storage blocked, or a corrupt entry
  }
}

function putGuestStash(items) {
  try {
    localStorage.setItem(GUEST_STASH_KEY, JSON.stringify({ items, at: Date.now() }))
  } catch {
    // Storage blocked: the list is lost on the way to sign in, as without this.
  }
}

export function GiftAppSkeleton() {
  return (
    <div className="giftme app" aria-busy="true">
      <AppHeader />
      <p className="empty">Loading your list…</p>
    </div>
  )
}

function AppHeader() {
  return (
    <header className="app-header">
      <h1>
        GiftMe<span className="app-header__tld">.com</span>
      </h1>
      <p className="tagline">A list of the gifts you’d actually like to receive.</p>
    </header>
  )
}

/** @param {{ initial: import('@/lib/lists').MyList | null }} props -- null for a guest */
export default function GiftApp({ initial }) {
  const isGuest = initial === null
  const loadError = initial?.loadError ?? null
  const saveBlockedReason = isGuest
    ? 'Sign in to save your list'
    : loadError
      ? 'Saving is paused until your list loads'
      : null
  const [gifts, setGifts] = useState(() => initial?.items ?? [])
  const [listId, setListId] = useState(() => initial?.list?.id ?? null)
  const [savedKey, setSavedKey] = useState(() => serialize(initial?.items ?? []))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef(null)
  const giftsRef = useRef(gifts)

  const dirty = serialize(gifts) !== savedKey
  // Guests lose everything on leaving; members lose only what isn't saved.
  const atRisk = isGuest ? gifts.length > 0 : dirty

  useEffect(() => {
    giftsRef.current = gifts
  }, [gifts])

  // Pick up a list brought over from before signing in (or from a guest's
  // own trip to the sign-in page and back). Read in an effect, not during
  // render, so the server-rendered HTML still matches on hydration.
  useEffect(() => {
    const carried = takeGuestStash({ keep: loadError !== null })
    if (carried.length === 0) return
    setGifts((prev) => [...prev, ...carried])
    if (!isGuest && !loadError) {
      setNotice(
        `We brought over ${carried.length === 1 ? '1 gift' : `${carried.length} gifts`} from before you signed in. Save to keep ${carried.length === 1 ? 'it' : 'them'}.`,
      )
    }
  }, [isGuest, loadError])

  // Client-side navigation to /auth/* unmounts the app; stash the guest's
  // list on the way out. Closing the tab runs no cleanup, so that still loses
  // it -- guests are only ever warned, never saved.
  useEffect(() => {
    if (!isGuest) return
    return () => {
      if (giftsRef.current.length > 0) putGuestStash(giftsRef.current)
    }
  }, [isGuest])

  useEffect(() => {
    if (!atRisk) return
    function warn(event) {
      event.preventDefault()
      event.returnValue = '' // still required by some browsers
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [atRisk])

  function addGift(draft) {
    // The id is made here rather than inside the updater: StrictMode
    // double-invokes updaters in development, so the body has to stay pure.
    const gift = { ...draft, id: newId(), addedAt: Date.now() }
    setGifts((prev) => [...prev, gift])
  }

  function removeGift(id) {
    setGifts((prev) => prev.filter((gift) => gift.id !== id))
    // Removing the focused button would otherwise drop focus onto <body> and
    // strand keyboard users at the top of the document.
    headingRef.current?.focus()
  }

  async function handleSave() {
    if (saveBlockedReason || saving) return
    const sent = gifts
    setSaving(true)
    setSaveError('')
    setAnnouncement('')

    let result
    try {
      result = await saveList({ listId, items: sent })
    } catch {
      result = { ok: false, error: "Your list couldn't be saved. Check your connection and try again." }
    }
    setSaving(false)

    if (!result.ok) {
      setSaveError(result.error)
      return
    }

    setListId(result.listId)
    setSavedKey(serialize(sent))
    // Adopt the server's rows only if nothing was edited mid-save; otherwise
    // keep the newer local edits, which then still show as unsaved.
    setGifts((current) => (current === sent ? result.items : current))
    setNotice('')
    setAnnouncement('List saved.')
  }

  return (
    <div className="giftme app">
      <AppHeader />

      <AddGiftPanel onAdd={addGift} />

      <section className="list-section" aria-labelledby="list-heading">
        <div className="list-section__head">
          <h2 id="list-heading" ref={headingRef} tabIndex={-1}>
            Your list
          </h2>
          <div className="list-section__actions">
            <GiftSummary gifts={gifts} />
            <SaveButton blockedReason={saveBlockedReason} dirty={dirty} saving={saving} onSave={handleSave} />
          </div>
        </div>
        {loadError && (
          <p className="status status--error list-section__notice" role="alert">
            {loadError}
          </p>
        )}
        {notice && (
          <p className="status status--info list-section__notice" role="status">
            {notice}
          </p>
        )}
        {saveError && (
          <p className="status status--error list-section__notice" role="alert">
            {saveError}
          </p>
        )}
        <GiftList gifts={gifts} onRemove={removeGift} />
      </section>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
