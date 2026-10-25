import Link from 'next/link'
import { AppHeader } from './gift-app.jsx'
import './gifts.css'

// Server-rendered, and given no list data: the owner's HTML holds nothing
// they could be spoiled by until they choose to go on.
export default function OwnerGate({ proceedHref }) {
  return (
    <div className="giftme app">
      <AppHeader />
      <section className="gate" aria-labelledby="gate-heading">
        <h2 id="gate-heading">This is your list</h2>
        <p>
          Are you sure you want to view this list as a guest? Proceeding may reveal gifts claimed
          by others and could spoil your surprise.
        </p>
        <div className="gate__actions">
          <Link href={proceedHref} className="btn btn--secondary">
            Yes, I accept the risk
          </Link>
          <Link href="/" className="btn btn--primary">
            No
          </Link>
        </div>
      </section>
    </div>
  )
}
