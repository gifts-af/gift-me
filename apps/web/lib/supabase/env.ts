// The template expects NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY, but the
// Vercel Supabase integration for this project was connected with a "GIFT"
// prefix, so it provides NEXT_PUBLIC_GIFT_SUPABASE_*. Older integrations may
// only provide an ANON_KEY. Any of these works: they are all public keys
// limited by Row Level Security.
// Each variable is referenced literally so Next can inline it into client code.
export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_GIFT_SUPABASE_URL;

export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_GIFT_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_GIFT_SUPABASE_ANON_KEY;
