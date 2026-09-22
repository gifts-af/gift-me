import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// The current Supabase session, or null when signed out. supabase-js persists
// it in localStorage and refreshes the token, so a reload stays signed in.
export function useSession() {
  const [session, setSession] = useState(null)

  useEffect(() => {
    if (!supabase) return

    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  return session
}
