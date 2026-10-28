'use client'

import { useEffect, useRef, useState } from 'react'
import { saveList } from '@/modules/lists/actions/lists'
import AddGiftPanel from './add-gift-panel.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import Link from 'next/link'
import { PageFrame } from '@/components/app-shell/page-frame'
import { TopBar } from '@/components/app-shell/top-bar'
import SaveButton from './save-button.jsx'
import ShareButton from './share-button.jsx'
import { Banner, inputClass } from './ui.jsx'

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
    <>
      <TopBar links current="list" wide />
      <PageFrame wide>
        <h1 className="text-[22px] font-bold leading-tight">My list</h1>
        <p className="text-[15px] text-muted-foreground" aria-busy="true">
          Loading your list…
        </p>
      </PageFrame>
    </>
  )
}

/** @param {{ initial: import('@/modules/lists/lib/lists').MyList | null }} props -- null for a guest */
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
  const [shareToken, setShareToken] = useState(() => initial?.list?.shareToken ?? null)
  // Kept apart from `notice` so copying a link never hides the carried-gifts
  // message. `url` is set when the clipboard can't be written, to copy by hand.
  const [shareNotice, setShareNotice] = useState(null)
  const [savedKey, setSavedKey] = useState(() => serialize(initial?.items ?? []))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef(null)
  const giftsRef = useRef(gifts)

  const dirty = serialize(gifts) !== savedKey
  const shareBlockedReason = isGuest
    ? 'Sign in to share your list'
    : !shareToken
      ? 'Save your list to share it'
      : null
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

  // In-app links (Home, the top bar) navigate without beforeunload, so ask
  // here. Capture on document runs before React's own listeners, so stopping
  // the click keeps <Link> from navigating. Guests are stashed on unmount.
  useEffect(() => {
    if (isGuest || !dirty) return
    function confirmLeave(event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return
      if (link.pathname === window.location.pathname) return
      if (window.confirm('You have unsaved changes. Leave without saving?')) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('click', confirmLeave, true)
    return () => document.removeEventListener('click', confirmLeave, true)
  }, [isGuest, dirty])

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
    if (result.shareToken) setShareToken(result.shareToken)
    setSavedKey(serialize(sent))
    // Adopt the server's rows only if nothing was edited mid-save; otherwise
    // keep the newer local edits, which then still show as unsaved.
    setGifts((current) => (current === sent ? result.items : current))
    setNotice('')
    setAnnouncement('List saved.')
  }

  // Resolves true once the link is on the clipboard.
  async function handleShare() {
    if (!shareToken) return false
    const url = `${window.location.origin}/share/${shareToken}`
    const unsavedNote = dirty ? " Unsaved changes won't appear until you save." : ''
    setAnnouncement('')
    try {
      // Undefined outside a secure context, e.g. a phone on plain HTTP.
      await navigator.clipboard.writeText(url)
    } catch {
      setShareNotice({ text: `Copy this link to share your list.${unsavedNote}`, url })
      return false
    }
    setShareNotice(unsavedNote ? { text: `Link copied.${unsavedNote}`, url: null } : null)
    setAnnouncement('Share link copied.')
    return true
  }

  return (
    <>
      <TopBar
        back={isGuest ? undefined : { href: '/', label: 'Home' }}
        links={!isGuest}
        current="list"
        wide
        actions={isGuest ? null : <ShareButton blockedReason={shareBlockedReason} onShare={handleShare} />}
      />

      <PageFrame wide className="gap-4">
        {isGuest && (
          <Banner>
            You’re not signed in.{' '}
            <Link href="/auth/login?next=%2Flists" className="underline underline-offset-[3px]">
              Sign in
            </Link>{' '}
            to save and share your list.
          </Banner>
        )}
        {loadError && (
          <Banner tone="error" role="alert">
            {loadError}
          </Banner>
        )}
        {notice && (
          <Banner tone="accent" role="status">
            {notice}
          </Banner>
        )}
        {shareNotice && (
          <Banner tone="accent" className="flex flex-col gap-2">
            <p role="status">{shareNotice.text}</p>
            {shareNotice.url && (
              <>
                <label htmlFor="share-url" className="sr-only">
                  Share link
                </label>
                <input
                  id="share-url"
                  type="text"
                  readOnly
                  value={shareNotice.url}
                  autoFocus
                  className={`${inputClass} num text-foreground`}
                  onFocus={(event) => event.target.select()}
                />
              </>
            )}
          </Banner>
        )}
        {saveError && (
          <Banner tone="error" role="alert">
            {saveError}
          </Banner>
        )}

        <div className="flex flex-col gap-1">
          <h1
            id="list-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-[22px] font-bold leading-tight"
          >
            My list
          </h1>
          <GiftSummary gifts={gifts} />
        </div>

        <AddGiftPanel onAdd={addGift} />

        <section aria-labelledby="list-heading" className="pt-2">
          <GiftList gifts={gifts} onRemove={removeGift} />
        </section>
      </PageFrame>

      {/* The main button sits at the bottom, in thumb reach, on a phone;
          inline under the list from 640 px (design/ui.md). */}
      {!isGuest && (dirty || saving) && (
        <div className="sticky bottom-0 border-t bg-background px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:static sm:border-t-0 sm:bg-transparent sm:pt-0">
          <div className="mx-auto flex max-w-5xl items-center gap-3 sm:px-4">
            <span className="flex-1 text-[15px] text-muted-foreground">Unsaved changes</span>
            <SaveButton blockedReason={saveBlockedReason} saving={saving} onSave={handleSave} />
          </div>
        </div>
      )}
      {isGuest && (
        <div className="sticky bottom-0 border-t bg-background px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 text-center text-[13px] text-muted-foreground sm:static">
          Guest lists are lost when you leave. Sign in to keep it.
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
