import { createClient } from '@supabase/supabase-js'

// Both values are public by design: the anon key only grants what Row Level
// Security allows. Accept VITE_* too, for anyone setting them by hand.
const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
const anonKey =
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY

// Login is optional, so a missing config disables auth instead of crashing the
// whole app. AuthPanel explains what to set.
export const supabase = url && anonKey ? createClient(url, anonKey) : null

if (!supabase) {
  console.warn(
    'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see README).',
  )
}
