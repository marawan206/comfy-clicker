/**
 * Browser-side Supabase client (cookie-backed session via @supabase/ssr so server
 * components and route handlers can read the same session).
 *
 * Returns `null` when Supabase isn't configured so the game keeps working in guest
 * mode — callers must branch on it rather than assume a client exists.
 */
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getPublicEnv } from '@/server/supabase/env'
import type { Database } from '@/server/supabase/types'

export type SupabaseBrowserClient = SupabaseClient<Database>

let cached: SupabaseBrowserClient | null = null

/** Singleton browser client, or `null` when env is missing. Safe to call during SSR (returns a client that has no cookies to read). */
export function getSupabaseBrowserClient(): SupabaseBrowserClient | null {
  if (cached) return cached
  const env = getPublicEnv()
  if (!env) return null
  cached = createBrowserClient<Database>(env.url, env.anonKey)
  return cached
}

/** Throwing variant for code paths that only run when `hasSupabase()` is true. */
export function requireSupabaseBrowserClient(): SupabaseBrowserClient {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Supabase is not configured (see .env.example).')
  return client
}
