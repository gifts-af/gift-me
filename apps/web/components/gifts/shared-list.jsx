'use client'

import { AppHeader } from './gift-app.jsx'
import GiftList from './gift-list.jsx'
import GiftSummary from './gift-summary.jsx'
import './gifts.css'

/** @param {{ list: import('@/lib/lists').SharedList }} props */
export default function SharedList({ list }) {
  return (
    <div className="giftme app">
      <AppHeader />

      <section className="list-section" aria-labelledby="list-heading">
        <div className="list-section__head">
          <h2 id="list-heading">{list.title}</h2>
          <GiftSummary gifts={list.items} />
        </div>
        <p className="shared-note">You’re viewing this list as a guest. It can’t be changed here.</p>
        {/* No onRemove: shared lists are read-only. */}
        <GiftList gifts={list.items} emptyMessage="This list is empty." />
      </section>
    </div>
  )
}
