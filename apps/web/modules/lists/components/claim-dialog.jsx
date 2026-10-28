import Link from 'next/link'
import { useState } from 'react'
import Modal from './modal.jsx'
import { Banner, buttonClass, inputClass, labelClass } from './ui.jsx'

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
 * success the parent closes us, on failure we show its message. A claim that
 * lost the race says so here and offers only Cancel (mock-up "shared").
 */
export default function ClaimDialog({ gift, viewer, loginHref, onConfirm, onClose }) {
  const [name, setName] = useState(() => (viewer.signedIn ? '' : readSavedName()))
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')
  const [taken, setTaken] = useState(false)
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
      if (result.alreadyClaimed) setTaken(true)
      else setError(result.error)
      return
    }
    if (!viewer.signedIn) saveName(trimmed)
  }

  return (
    <Modal labelledBy="claim-dialog-title" describedBy="claim-dialog-desc" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="claim-dialog-title" className="text-[17px] font-semibold">
            Claim this gift
          </h2>
          <p className="text-[15px] font-semibold [overflow-wrap:anywhere]">{gift.name}</p>
        </div>

        {taken ? (
          <Banner tone="warn" role="alert">
            Someone else just claimed this. Pick another gift.
          </Banner>
        ) : (
          <>
            <p id="claim-dialog-desc" className="text-[15px] text-muted-foreground">
              Only claim it if you’ll definitely buy it. Other friends will see it’s claimed; the
              list’s owner won’t.
            </p>

            {viewer.signedIn ? (
              <p className="text-[13px] text-muted-foreground">
                Claiming as <strong className="text-foreground">{viewer.name ?? viewer.email ?? 'your account'}</strong>.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="claim-name" className={labelClass}>
                    Your name
                  </label>
                  <input
                    id="claim-name"
                    type="text"
                    autoComplete="name"
                    maxLength={MAX_NAME_LENGTH}
                    className={inputClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={nameError ? 'true' : undefined}
                    aria-describedby={nameError ? 'claim-name-error' : undefined}
                    required
                    autoFocus
                  />
                  {nameError && (
                    <p className="text-[13px] text-destructive" id="claim-name-error">
                      {nameError}
                    </p>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  A guest claim can’t be undone.{' '}
                  <Link href={loginHref} className="text-foreground underline underline-offset-[3px]">
                    Sign in
                  </Link>{' '}
                  to be able to unclaim it if plans change.
                </p>
              </>
            )}

            {error && (
              <p className="text-[13px] text-destructive" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className={`${buttonClass.primary} w-full`} disabled={pending} aria-busy={pending}>
              {pending ? 'Claiming…' : 'Claim gift'}
            </button>
          </>
        )}
        <button type="button" className={`${buttonClass.link} self-center`} onClick={onClose}>
          Cancel
        </button>
      </form>
    </Modal>
  )
}
