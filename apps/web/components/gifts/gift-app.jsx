'use client'

import { useRef, useState } from 'react'
import AddGiftPanel from './add-gift-panel.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import './gifts.css'

// crypto.randomUUID is undefined outside a secure context -- which includes
// demoing over plain HTTP on a phone via `next dev -H 0.0.0.0`.
function newId() {
  return crypto.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export default function GiftApp() {
  const [gifts, setGifts] = useState([])
  const headingRef = useRef(null)

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

  return (
    <div className="giftme app">
      <header className="app-header">
        <h1>
          GiftMe<span className="app-header__tld">.com</span>
        </h1>
        <p className="tagline">A list of the gifts you’d actually like to receive.</p>
      </header>

      <AddGiftPanel onAdd={addGift} />

      <section className="list-section" aria-labelledby="list-heading">
        <div className="list-section__head">
          <h2 id="list-heading" ref={headingRef} tabIndex={-1}>
            Your list
          </h2>
          <GiftSummary gifts={gifts} />
        </div>
        <GiftList gifts={gifts} onRemove={removeGift} />
      </section>
    </div>
  )
}
