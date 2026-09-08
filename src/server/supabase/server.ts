/**
 * Server-side Supabase clients bound to the request's cookies.
 *
 *  - `createSupabaseServerClient()` — for route handlers, server actions and server
 *    components (uses `next/headers`). One client per request; never cache it.
 *  - `createSupabaseProxyClient(req, res)` — for `proxy.ts` (Next 16's middleware),
 *    where cookies must be written onto the outgoing response so refreshed tokens
 *    reach the browser.
 *
 * All return `null` when Supabase isn't configured (guest mode).
 */
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'

import { getPublicEnv } from '@/server/supabase/env'
import type { Database } from '@/server/supabase/types'

export type SupabaseServerClient = SupabaseClient<Database>

/** Request-scoped client for route handlers / server components. */
export async function createSupabaseServerClient(): Promise<SupabaseServerClient | null> {
  const env = getPublicEnv()
  if (!env) return null
  const store = await cookies()
  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options)
        } catch {
          // Server components cannot set cookies; the proxy (middleware) refreshes
          // the session instead, so ignoring the write here is expected.
        }
      },
    },
  })
}

/**
 * Client for `proxy.ts`. Cookies written by the auth refresh land on both the
 * request (so downstream server components see them) and the response.
 */
export function createSupabaseProxyClient(
  request: NextRequest,
  response: NextResponse,
): SupabaseServerClient | null {
  const env = getPublicEnv()
  if (!env) return null
  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        for (const [key, val] of Object.entries(headers)) response.headers.set(key, val)
      },
    },
  })
}

/**
 * The authenticated user for this request, verified against Supabase Auth
 * (not just decoded from the cookie). `null` when signed out or unconfigured.
 */
export async function getServerUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user
}
