'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { onBeforeLeaving } from '@/lib/leaving-page'
import { saveList } from '@/modules/lists/actions/lists'
import { readStorePage } from '@/modules/lists/actions/store-page'
import { createListSaver } from '@/modules/lists/lib/list-saver.js'
import AddGiftPanel from './add-gift-panel.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import Link from 'next/link'
import { PageFrame } from '@/components/app-shell/page-frame'
import ShareButton from './share-button.jsx'
import { Banner, buttonClass, inputClass } from './ui.jsx'

export { UNDO_MS } from '@/modules/lists/lib/list-saver.js'

// A guest's list is carried across the trip to /auth/* in localStorage, so
// signing in (or confirming a sign-up email in a new tab) doesn't lose it.
const GUEST_STASH_KEY = 'giftme:guest-list'
const GUEST_STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000

// Where a closing tab sends a remove still held for Undo (ALL-127).
const CLOSE_ROUTE = '/api/lists/save-on-close'

// crypto.randomUUID is undefined outside a secure context -- which includes
// demoing over plain HTTP on a phone via `next dev -H 0.0.0.0`.
function newId() {
  return crypto.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`
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

// A keepalive fetch outlives the page; a server action started now wouldn't.
// Only ids go: keepalive bodies are capped at 64 KiB.
function sendOnClose(body) {
  fetch(CLOSE_ROUTE, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}

// The same while loading and loaded, so Share arriving doesn't move the page.
const TITLE_ROW = 'flex min-h-11 items-center justify-between gap-3'

export function GiftAppSkeleton() {
  return (
    <PageFrame wide>
      <div className={TITLE_ROW}>
        <h1 className="text-[22px] font-bold leading-tight">My list</h1>
      </div>
      <p className="text-[15px] text-muted-foreground" aria-busy="true">
        Loading your list…
      </p>
    </PageFrame>
  )
}

const STATUS_TEXT = { idle: 'Saved', saving: 'Saving…', error: "Couldn't save" }

/**
 * @param {{ initial: import('@/modules/lists/lib/lists').MyList | null, footer?: import('react').ReactNode }} props
 * `initial` is null for a guest. `footer` shows below the list once a saved list exists.
 * The list is built from `initial` once: a later render with new data (a
 * router refresh) doesn't replace what's on screen.
 */
export default function GiftApp({ initial, footer = null }) {
  const isGuest = initial === null
  const loadError = initial?.loadError ?? null
  // Fixed at the first render, so a refresh that fails to load can't stop a
  // save that's on its way.
  const [canSave] = useState(() => initial !== null && !initial.loadError)
  const [saver] = useState(() =>
    createListSaver({ initial, enabled: canSave, save: saveList, sendOnClose }),
  )
  const list = useSyncExternalStore(saver.subscribe, saver.getSnapshot, saver.getSnapshot)
  const gifts = list.gifts

  // Kept apart from `notice` so copying a link never hides the carried-gifts
  // message. `url` is set when the clipboard can't be written, to copy by hand.
  const [shareNotice, setShareNotice] = useState(null)
  const [notice, setNotice] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef(null)

  const shareBlockedReason = isGuest
    ? 'Sign in to share your list'
    : !list.shareToken
      ? 'Save your list to share it'
      : null
  // Guests lose everything on leaving. Members are warned only while a save
  // is on its way or has failed: a held remove is sent as the tab goes.
  const atRisk = isGuest
    ? gifts.length > 0
    : canSave
      ? list.status !== 'idle'
      : list.dirty
  const askBeforeLeaving = !isGuest && (canSave ? list.status === 'error' : list.dirty)

  // Pick up a list brought over from before signing in (or from a guest's
  // own trip to the sign-in page and back). Read in an effect, not during
  // render, so the server-rendered HTML still matches on hydration. A
  // member's carried gifts save straight away.
  useEffect(() => {
    const carried = takeGuestStash({ keep: loadError !== null })
    if (carried.length === 0) return
    saver.add(...carried)
    if (!isGuest && !loadError) {
      setNotice(
        `We brought over ${carried.length === 1 ? '1 gift' : `${carried.length} gifts`} from before you signed in.`,
      )
    }
  }, [isGuest, loadError, saver])

  // Client-side navigation to /auth/* unmounts the app; stash the guest's
  // list on the way out. Closing the tab runs no cleanup, so that still loses
  // it -- guests are only ever warned, never saved.
  useEffect(() => {
    if (!isGuest) return
    return () => {
      const { gifts: left } = saver.getSnapshot()
      if (left.length > 0) putGuestStash(left)
    }
  }, [isGuest, saver])

  // A remove held for Undo is sent before the page goes: when the tab is
  // hidden, when this page is left in the app (Next keeps a left page mounted
  // but hidden, and that runs this cleanup), before Sign out, and as the tab
  // closes (pagehide, to the close route with keepalive).
  useEffect(() => {
    if (!canSave) return
    function onVisibility() {
      if (document.visibilityState === 'hidden') saver.flush()
    }
    function onPageHide() {
      saver.closing()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    const stopWaiting = onBeforeLeaving(() => saver.flush())
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      stopWaiting()
      saver.flush()
    }
  }, [canSave, saver])

  useEffect(() => {
    if (!atRisk) return
    function warn(event) {
      event.preventDefault()
      event.returnValue = '' // still required by some browsers
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [atRisk])

  // In-app links (Get, Give, the logo) navigate without beforeunload, so ask
  // here, but only once a save has failed: one on its way finishes with the
  // page hidden. Capture on document runs before React's own listeners, so
  // stopping the click keeps <Link> from navigating. Guests are stashed on
  // unmount. `data-leaves-page` marks anything else that leaves: Sign out in
  // AccountMenu.
  useEffect(() => {
    if (!askBeforeLeaving) return
    function confirmLeave(event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const leaving = event.target instanceof Element ? event.target.closest('a[href], [data-leaves-page]') : null
      if (!leaving) return
      if (leaving.matches('a[href]')) {
        if (leaving.target === '_blank' || leaving.origin !== window.location.origin) return
        if (leaving.pathname === window.location.pathname) return
      }
      if (window.confirm('You have unsaved changes. Leave without saving?')) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('click', confirmLeave, true)
    return () => document.removeEventListener('click', confirmLeave, true)
  }, [askBeforeLeaving])

  function addGift(draft) {
    setNotice('')
    saver.add({ ...draft, id: newId(), addedAt: Date.now() })
  }

  function removeGift(id) {
    saver.remove(id)
    // Removing the focused button would otherwise drop focus onto <body> and
    // strand keyboard users at the top of the document.
    headingRef.current?.focus()
  }

  // Resolves true once the link is on the clipboard.
  async function handleShare() {
    if (!list.shareToken) return false
    const url = `${window.location.origin}/share/${list.shareToken}`
    setAnnouncement('')
    try {
      // Undefined outside a secure context, e.g. a phone on plain HTTP.
      await navigator.clipboard.writeText(url)
    } catch {
      setShareNotice({ text: 'Copy this link to share your list.', url })
      return false
    }
    setShareNotice(null)
    setAnnouncement('Share link copied.')
    return true
  }

  return (
    <>
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
        {list.notice && (
          <Banner tone="accent" role="status">
            {list.notice}
          </Banner>
        )}
        {list.status === 'error' && list.error && (
          <Banner tone="error" role="alert">
            {list.error}
          </Banner>
        )}

        <div className="flex flex-col gap-1">
          <div className={TITLE_ROW}>
            <h1
              id="list-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-[22px] font-bold leading-tight"
            >
              My list
            </h1>
            {!isGuest && <ShareButton blockedReason={shareBlockedReason} onShare={handleShare} />}
          </div>
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3">
            <GiftSummary gifts={gifts} />
            {canSave && (
              <div className="flex items-center gap-1">
                <p
                  role="status"
                  aria-label="Save status"
                  className={`text-[13px] ${list.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {list.status === 'idle' && !list.listId ? '' : STATUS_TEXT[list.status]}
                </p>
                {list.status === 'error' && (
                  <button type="button" className={`${buttonClass.link} text-[13px]`} onClick={saver.retry}>
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

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

        {/* Only signed-in people can have our server read a store page (ALL-10). */}
        <AddGiftPanel onAdd={addGift} readStorePage={isGuest ? undefined : readStorePage} />

        <section aria-labelledby="list-heading" className="pt-2">
          <GiftList gifts={gifts} onRemove={removeGift} />
        </section>

        {list.listId && !loadError && footer}
      </PageFrame>

      {/* Undo stays in view at the bottom, in thumb reach on a phone, lined
          up with the list's column (design/ui.md > My list). */}
      {list.held && (
        <div className="sticky bottom-0 border-t bg-background pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 sm:px-8">
            <p className="min-w-0 truncate text-[15px]">Removed {list.held.gift.name}</p>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <button type="button" className={buttonClass.secondarySm} onClick={saver.undo}>
              Undo
            </button>
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
