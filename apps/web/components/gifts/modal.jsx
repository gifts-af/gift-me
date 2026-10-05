import { useEffect, useRef } from 'react'

/**
 * A native <dialog> opened with showModal(): the browser handles the focus
 * trap, Esc, inert background and returning focus to whatever opened it.
 * Rendered only while open, so each opening starts with fresh state.
 */
export default function Modal({ labelledBy, describedBy, onClose, children }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    // No close() on cleanup: unmounting removes it from the top layer anyway,
    // and under StrictMode's re-run a queued `close` event would fire
    // onClose and shut the dialog the moment it opened.
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Esc fires `cancel` then `close`; route both through onClose so the
      // parent unmounts us rather than leaving a closed dialog in the tree.
      onClose={onClose}
      // A click on the dialog element itself (not its contents) is the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal__body">{children}</div>
    </dialog>
  )
}
