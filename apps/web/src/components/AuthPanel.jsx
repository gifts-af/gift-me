import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function AuthPanel({ session }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState(null) // { tone: 'error' | 'ok', text }

  if (!supabase) {
    return (
      <p className="auth auth__note">
        Sign-in is off: Supabase isn’t configured for this build.
      </p>
    )
  }

  if (session) {
    return (
      <div className="auth">
        <span className="auth__who">
          Signed in as <strong>{session.user.email}</strong>
        </span>
        <button type="button" className="btn btn--secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="auth">
        <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
          Sign in
        </button>
      </div>
    )
  }

  // One form, two submit buttons: the clicked button's name picks the action.
  async function handleSubmit(event) {
    event.preventDefault()
    const mode = event.nativeEvent.submitter?.name ?? 'signin'
    setPending(true)
    setMessage(null)

    const credentials = { email: email.trim(), password }
    const { data, error } =
      mode === 'signup'
        ? await supabase.auth.signUp({
            ...credentials,
            options: { emailRedirectTo: window.location.origin },
          })
        : await supabase.auth.signInWithPassword(credentials)

    setPending(false)
    if (error) {
      setMessage({ tone: 'error', text: error.message })
      return
    }

    setPassword('')
    // With "Confirm email" on, signUp succeeds but returns no session yet.
    if (mode === 'signup' && !data.session) {
      setMessage({ tone: 'ok', text: 'Check your email to confirm your account, then sign in.' })
    }
  }

  return (
    <form className="auth auth--form" onSubmit={handleSubmit}>
      <input
        type="email"
        autoComplete="email"
        placeholder="Email"
        aria-label="Email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        required
        minLength={6}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" name="signin" className="btn btn--primary" disabled={pending}>
        Sign in
      </button>
      <button type="submit" name="signup" className="btn btn--secondary" disabled={pending}>
        Create account
      </button>
      {message && (
        <p
          className={`status status--${message.tone} auth__message`}
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </form>
  )
}
