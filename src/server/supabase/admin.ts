/**
 * Service-role Supabase client. SERVER ONLY. Bypasses RLS.
 *
 * Use it for the feed pipeline (feed_items / trending_tags / feed_meta writes),
 * `refresh_hub_runs_24h()`, and hub counters. Never import from a client component;
 * the module throws at load time if it ever ends up in a browser bundle.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getPublicEnv, getServiceRoleKey } from '@/server/supabase/env'
import type { Database } from '@/server/supabase/types'

if (typeof window !== 'undefined') {
  throw new Error('src/server/supabase/admin.ts is server-only and must not be bundled for the browser.')
}

export type SupabaseAdminClient = SupabaseClient<Database>

let cached: SupabaseAdminClient | null = null

/** Process-wide service-role client, or `null` when the URL or service key is missing. */
export function getSupabaseAdminClient(): SupabaseAdminClient | null {
  if (cached) return cached
  const url = getPublicEnv()?.url ?? null
  const key = getServiceRoleKey()
  if (!url || !key) return null
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-comfy-clicker': 'server' } },
  })
  return cached
}

/** Throwing variant for crons and pipelines that cannot run without the service role. */
export function requireSupabaseAdminClient(): SupabaseAdminClient {
  const client = getSupabaseAdminClient()
  if (!client) {
    throw new Error(
      'Supabase admin client unavailable: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only).',
    )
  }
  return client
}

/** Recompute `hub_workflows.runs_24h`. Returns how many workflow rows changed. */
export async function refreshHubRuns24h(client: SupabaseAdminClient = requireSupabaseAdminClient()): Promise<number> {
  const { data, error } = await client.rpc('refresh_hub_runs_24h')
  if (error) throw new Error(`refresh_hub_runs_24h failed: ${error.message}`)
  return data ?? 0
}
