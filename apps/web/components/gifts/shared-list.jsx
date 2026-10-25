'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { claimGift, unclaimGift } from '@/app/actions/claims'
import ClaimDialog from './claim-dialog.jsx'
import { AppHeader } from './gift-app.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import ViewDialog from './view-dialog.jsx'
import './gifts.css'

const OWNER_REASON = 'You can’t claim gifts on your own list.'

/**
 * @param {{ list: import('@/lib/lists').SharedList, token: string }} props
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
      // Show who got there first instead of a dialog that can't succeed.
      setClaiming(null)
      setActionError(`${gift.name} was just claimed by someone else.`)
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
    if (gift.claim) {
      return (
        <>
          <span className="claim-badge">
            Claimed by {gift.claim.mine ? 'you' : gift.claim.name}
          </span>
          {gift.claim.mine && (
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => handleUnclaim(gift)}
              disabled={unclaimingId === gift.id}
              aria-busy={unclaimingId === gift.id}
            >
              {unclaimingId === gift.id ? 'Unclaiming…' : 'Unclaim'}
              <span className="visually-hidden"> {gift.name}</span>
            </button>
          )}
        </>
      )
    }

    if (list.isOwner) {
      // aria-disabled, not disabled, so the tooltip explaining why can show.
      const tooltipId = `claim-tooltip-${gift.id}`
      return (
        <span className="tooltip-anchor">
          <button
            type="button"
            className="btn btn--muted btn--small"
            aria-disabled="true"
            aria-describedby={tooltipId}
            onClick={(event) => event.preventDefault()}
          >
            Claim<span className="visually-hidden"> {gift.name}</span>
          </button>
          <span className="tooltip tooltip--start" id={tooltipId} role="tooltip">
            {OWNER_REASON}
          </span>
        </span>
      )
    }

    return (
      <button
        type="button"
        className="btn btn--primary btn--small"
        onClick={() => {
          setActionError('')
          setClaiming(gift)
        }}
      >
        Claim<span className="visually-hidden"> {gift.name}</span>
      </button>
    )
  }

  return (
    <div className="giftme app">
      <AppHeader />

      <section className="list-section" aria-labelledby="list-heading">
        <div className="list-section__head">
          <h2 id="list-heading">{list.title}</h2>
          <GiftSummary gifts={items} />
        </div>
        <p className="shared-note">
          {list.isOwner
            ? 'You’re viewing your own list as a guest. You can see claims, but can’t claim gifts here.'
            : 'Planning to buy something? Claim it so nobody else buys the same gift.'}
        </p>
        {actionError && (
          <p className="status status--error" role="alert">
            {actionError}
          </p>
        )}
        {/* No onRemove: shared lists are read-only. Only unclaimed gifts ask
            "are you going to buy?"; the owner can't claim, so isn't asked. */}
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

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
