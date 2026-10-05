import Link from 'next/link'
import { useState } from 'react'
import Modal from './modal.jsx'

const NAME_KEY = 'giftme:guest-name'
const MAX_NAME_LENGTH = 80

// Storage can throw (private mode, blocked site data); a name is a nicety.
function readSavedName() {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name) {
  try {
    window.localStorage.setItem(NAME_KEY, name)
  } catch {
    // Not worth bothering anyone about.
  }
}

/**
 * Confirms a claim. `onConfirm(name)` resolves to the action's result; on
 * success the parent closes us, on failure we show its message.
 */
export default function ClaimDialog({ gift, viewer, loginHref, onConfirm, onClose }) {
  const [name, setName] = useState(() => (viewer.signedIn ? '' : readSavedName()))
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (pending) return

    const trimmed = name.trim()
    if (!viewer.signedIn && !trimmed) {
      setNameError('Enter your name so others know who is buying this.')
      return
    }
    setNameError('')
    setError('')
    setPending(true)

    let result
    try {
      result = await onConfirm(viewer.signedIn ? undefined : trimmed)
    } catch {
      result = { ok: false, error: "This gift couldn't be claimed. Check your connection and try again." }
    }
    // On success the parent unmounts us; only a failure needs local state.
    if (!result.ok) {
      setPending(false)
      setError(result.error)
      return
    }
    if (!viewer.signedIn) saveName(trimmed)
  }

  return (
    <Modal labelledBy="claim-dialog-title" describedBy="claim-dialog-desc" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <h2 id="claim-dialog-title">Claim a Gift?</h2>
        <p className="modal__gift">{gift.name}</p>
        <p id="claim-dialog-desc">
          Claiming and not buying can cause this person to not get a gift they really wanted, only
          claim if you will definitely buy it.
        </p>

        {viewer.signedIn ? (
          <p className="modal__meta">
            Claiming as <strong>{viewer.email ?? 'your account'}</strong>. Everyone with the link
            will see this.
          </p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="claim-name">
                Your name <span className="field__req" aria-hidden="true">*</span>
              </label>
              <input
                id="claim-name"
                type="text"
                autoComplete="name"
                maxLength={MAX_NAME_LENGTH}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={nameError ? 'true' : undefined}
                aria-describedby={nameError ? 'claim-name-error' : undefined}
                required
                autoFocus
              />
              {nameError && (
                <p className="field__error" id="claim-name-error">
                  {nameError}
                </p>
              )}
            </div>
            <p className="status status--warn">
              Guest claims can’t be undone. <Link href={loginHref}>Log in</Link> so you can
              unclaim this gift if you don’t end up buying it, and to claim faster next time.
            </p>
          </>
        )}

        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Dismiss
          </button>
          <button type="submit" className="btn btn--primary" disabled={pending} aria-busy={pending}>
            {pending ? 'Claiming…' : 'Yes, I will buy this gift'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
