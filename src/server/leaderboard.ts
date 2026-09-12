/**
 * Leaderboard read model. The `leaderboard` view is public (anon-readable, top 100 by lifetime
 * credits, no private state), so it is read with a plain anon client that carries no cookies.
 *
 * Plausibility: a save cannot honestly hold more lifetime credits than its current income could
 * have produced since the profile was created, with headroom for offline multipliers, contracts,
 * dailies and prestige swings:
 *   lifetime_credits <= cps × secondsSinceCreated × PLAUSIBILITY_MULT + PLAUSIBILITY_FLOOR
 * Rows that fail are flagged, not dropped. A false positive on a legitimate whale would be
 * worse than an asterisk next to a cheater.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPublicEnv } from '@/server/supabase/env'
import type { Database, LeaderboardRow } from '@/server/supabase/types'

export const PLAUSIBILITY_MULT = 12
export const PLAUSIBILITY_FLOOR = 1e6
export const LEADERBOARD_LIMIT = 100

export interface LeaderboardEntry {
  rank: number
  userId: string
  handle: string
  cps: number
  lifetimeCredits: number
  followers: number
  season: number
  /** Failed the plausibility check; shown with a marker, still ranked. */
  flagged: boolean
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[]
  /** ISO timestamp of the read. */
  updatedAt: string
  /** False when Supabase is not configured (empty board, nothing to show). */
  available: boolean
}

/** True when `lifetimeCredits` could have been earned at `cps` since `createdAtMs`. */
export function isPlausible(lifetimeCredits: number, cps: number, createdAtMs: number, now: number): boolean {
  const seconds = Math.max(0, (now - createdAtMs) / 1000)
  return lifetimeCredits <= cps * seconds * PLAUSIBILITY_MULT + PLAUSIBILITY_FLOOR
}

type AnonClient = SupabaseClient<Database>
let anon: AnonClient | null = null

/** Cookie-less anon client for public reads. Null when Supabase is not configured. */
export function getAnonClient(): AnonClient | null {
  if (anon) return anon
  const env = getPublicEnv()
  if (!env) return null
  anon = createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-comfy-clicker': 'leaderboard' } },
  })
  return anon
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Ranks the view rows and joins `profiles.created_at` for the plausibility check. */
export function rankRows(rows: LeaderboardRow[], createdAt: Map<string, number>, now: number): LeaderboardEntry[] {
  return [...rows]
    .sort((a, b) => num(b.lifetime_credits) - num(a.lifetime_credits))
    .slice(0, LEADERBOARD_LIMIT)
    .map((row, i) => {
      const lifetime = num(row.lifetime_credits)
      const cps = num(row.cps)
      const created = createdAt.get(row.user_id)
      return {
        rank: i + 1,
        userId: row.user_id,
        handle: row.handle,
        cps,
        lifetimeCredits: lifetime,
        followers: num(row.followers),
        season: Math.max(1, Math.floor(num(row.season))),
        flagged: created === undefined ? false : !isPlausible(lifetime, cps, created, now),
      }
    })
}

export async function fetchLeaderboard(now: number = Date.now(), client: AnonClient | null = getAnonClient()): Promise<LeaderboardResult> {
  const updatedAt = new Date(now).toISOString()
  if (!client) return { entries: [], updatedAt, available: false }

  const { data: rows, error } = await client.from('leaderboard').select('*').limit(LEADERBOARD_LIMIT)
  if (error) throw new Error(`leaderboard read failed: ${error.message}`)
  if (!rows || rows.length === 0) return { entries: [], updatedAt, available: true }

  const ids = rows.map((r) => r.user_id)
  const { data: profiles, error: profileError } = await client.from('profiles').select('id, created_at').in('id', ids)
  if (profileError) throw new Error(`profiles read failed: ${profileError.message}`)

  const createdAt = new Map<string, number>()
  for (const p of profiles ?? []) {
    const t = Date.parse(p.created_at)
    if (Number.isFinite(t)) createdAt.set(p.id, t)
  }
  return { entries: rankRows(rows, createdAt, now), updatedAt, available: true }
}
