'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { claimGift, unclaimGift } from '@/modules/lists/actions/claims'
import { PageFrame } from '@/components/app-shell/page-frame'
import { TopBar } from '@/components/app-shell/top-bar'
import ClaimDialog from './claim-dialog.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import { Banner, buttonClass } from './ui.jsx'
import ViewDialog from './view-dialog.jsx'

/**
 * @param {{ list: import('@/modules/lists/lib/lists').SharedList, token: string }} props
 */
export default function SharedList({ list, token }) {
  const router = useRouter()
  // Claims change here without a reload. A refresh hands down a new
  // list.items, which replaces the local copy (React's "adjust state when a
  // prop changes" pattern, rather than an effect that renders twice).
  const [items, setItems] = useState(list.items)
  const [sourceItems, setSourceItems] = useState(list.items)
  if (sourceItems !== list.items) {
    setSourceItems(list.items)
    setItems(list.items)
  }

  const [claiming, setClaiming] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [unclaimingId, setUnclaimingId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [announcement, setAnnouncement] = useState('')

  const loginHref = `/auth/login?next=${encodeURIComponent(`/share/${token}`)}`

  function setClaim(itemId, claim) {
    setItems((prev) => prev.map((gift) => (gift.id === itemId ? { ...gift, claim } : gift)))
  }

  async function handleClaim(name) {
    const gift = claiming
    const result = await claimGift({ token, itemId: gift.id, name })
    if (result.ok) {
      setClaim(gift.id, result.claim)
      setClaiming(null)
      setActionError('')
      setAnnouncement(`You claimed ${gift.name}.`)
    } else if (result.alreadyClaimed) {
      // The dialog says so; the refresh shows who got there first.
      router.refresh()
    }
    return result
  }

  async function handleUnclaim(gift) {
    setUnclaimingId(gift.id)
    setActionError('')
    let result
    try {
      result = await unclaimGift({ token, itemId: gift.id })
    } catch {
      result = { ok: false, error: "This gift couldn't be unclaimed. Check your connection and try again." }
    }
    setUnclaimingId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    setClaim(gift.id, null)
    setAnnouncement(`You unclaimed ${gift.name}.`)
  }

  function renderActions(gift) {
    // The owner never sees claims (product decision 39); the database sends
    // none, and there's nothing for them to claim.
    if (list.isOwner) return null

    if (gift.claim) {
      return (
        <>
          <span className="text-[13px] text-muted-foreground">
            Claimed by {gift.claim.mine ? 'you' : gift.claim.name}
          </span>
          {gift.claim.mine && (
            <button
              type="button"
              className={buttonClass.secondarySm}
              onClick={() => handleUnclaim(gift)}
              disabled={unclaimingId === gift.id}
              aria-busy={unclaimingId === gift.id}
              aria-label={`Unclaim ${gift.name}`}
            >
              {unclaimingId === gift.id ? 'Unclaiming…' : 'Unclaim'}
            </button>
          )}
        </>
      )
    }

    return (
      <button
        type="button"
        className={`${buttonClass.secondarySm} w-full`}
        onClick={() => {
          setActionError('')
          setClaiming(gift)
        }}
        aria-label={`Claim ${gift.name}`}
      >
        Claim
      </button>
    )
  }

  return (
    <>
      <TopBar wide />
      <PageFrame wide className="gap-4">
        {list.isOwner && (
          <Banner tone="accent">
            This is your list. Claims are hidden from you, so your gifts stay a surprise.
          </Banner>
        )}
        <div className="flex flex-col gap-1">
          <h1 id="list-heading" className="text-[22px] font-bold leading-tight [overflow-wrap:anywhere]">
            {list.title}
          </h1>
          <GiftSummary gifts={items} />
          {!list.isOwner && (
            <p className="text-[13px] text-muted-foreground">
              Planning to buy something? Claim it so nobody else buys the same gift.
            </p>
          )}
        </div>
        {actionError && (
          <Banner tone="error" role="alert">
            {actionError}
          </Banner>
        )}
        {/* No onRemove: shared lists are read-only. Only unclaimed gifts ask
            "are you going to buy?"; the owner can't claim, so isn't asked. */}
        <section aria-labelledby="list-heading">
          <GiftList
            gifts={items}
            emptyMessage="This list is empty."
            renderActions={renderActions}
            onView={
              list.isOwner
                ? undefined
                : (gift) => {
                    const current = items.find((item) => item.id === gift.id)
                    if (current?.claim) {
                      window.open(gift.productUrl, '_blank', 'noopener,noreferrer')
                    } else {
                      setViewing(gift)
                    }
                  }
            }
          />
        </section>
      </PageFrame>

      {viewing && <ViewDialog gift={viewing} onClose={() => setViewing(null)} />}
      {claiming && (
        <ClaimDialog
          gift={claiming}
          viewer={list.viewer}
          loginHref={loginHref}
          onConfirm={handleClaim}
          onClose={() => setClaiming(null)}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
