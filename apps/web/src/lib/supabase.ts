import { createClient } from '@supabase/supabase-js'
import type { Database } from '@at/shared/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see apps/web/.env.example)',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // PKCE puts ?code= in the query string, which leaves the hash router alone.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** Where auth emails and OAuth send the user back: the app root, e.g. https://me.github.io/repo/ */
export function authRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString()
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
