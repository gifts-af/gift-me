import Modal from './modal.jsx'

/**
 * Shown before opening an unclaimed gift's product page, as a reminder to
 * come back and claim it. The "go" choice is a real link so the new tab
 * isn't eaten by a popup blocker.
 */
export default function ViewDialog({ gift, onClose }) {
  return (
    <Modal labelledBy="view-dialog-title" describedBy="view-dialog-desc" onClose={onClose}>
      <h2 id="view-dialog-title">Are you going to buy?</h2>
      <p id="view-dialog-desc">
        Nobody wants to get the same gift twice, and nobody wants to give an already gifted gift.
        If you are going to purchase this gift, please ensure you ‘claim’ this gift before
        continuing.
      </p>
      <div className="modal__actions modal__actions--stacked">
        <a
          className="btn btn--primary"
          href={gift.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
        >
          I acknowledge that if I buy this I will return and claim it.
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </Modal>
  )
}
