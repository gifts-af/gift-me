import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The Vercel Supabase integration names its public vars NEXT_PUBLIC_*. Only
  // prefixed vars reach the browser, so expose those rather than duplicating
  // them as VITE_*. Never give a secret (e.g. the service-role key) this prefix.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
})
