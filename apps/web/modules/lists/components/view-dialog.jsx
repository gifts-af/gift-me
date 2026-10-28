import Modal from './modal.jsx'
import { buttonClass } from './ui.jsx'

/**
 * Shown before opening an unclaimed gift's product page, as a reminder to
 * come back and claim it. The "go" choice is a real link so the new tab
 * isn't eaten by a popup blocker.
 */
export default function ViewDialog({ gift, onClose }) {
  return (
    <Modal labelledBy="view-dialog-title" describedBy="view-dialog-desc" onClose={onClose}>
      <h2 id="view-dialog-title" className="text-[17px] font-semibold">
        Going to buy it?
      </h2>
      <p id="view-dialog-desc" className="text-[15px] text-muted-foreground">
        If you buy {gift.name}, come back and claim it, so nobody else buys it too.
      </p>
      <a
        className={`${buttonClass.primary} w-full whitespace-normal text-center`}
        href={gift.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
      >
        Open on Amazon, and I’ll claim it if I buy it
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <button type="button" className={`${buttonClass.link} self-center`} onClick={onClose}>
        Cancel
      </button>
    </Modal>
  )
}
