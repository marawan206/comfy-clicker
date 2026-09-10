/**
 * Client for `/api/feed`. Module-level cache with a tiny subscribe/snapshot API so React can bind
 * with `useSyncExternalStore`. Polls every ten minutes, refetches when the tab comes back after a
 * while, and pushes the server's trending trio into the game store so posts score against it.
 */
import type { FeedItem } from '@/server/feed/types'
import { getGameStore } from '@/state/store'
import { TRENDING_COUNT } from '@/game/constants'

export type FeedOrigin = 'db' | 'memory' | 'seed' | 'none'

/** Wire shape of `GET /api/feed` (the fields the client reads). */
export interface FeedPayload {
  items: FeedItem[]
  trending: string[]
  updatedAt: string | null
  origin: 'db' | 'memory' | 'seed'
}

export interface FeedSnapshot {
  items: FeedItem[]
  trending: string[]
  /** ISO timestamp of the server's last collection run, null before the first successful fetch. */
  updatedAt: string | null
  origin: FeedOrigin
  /** True while a request is in flight and nothing has loaded yet. */
  loading: boolean
  error: string | null
  /** Wall-clock ms of the last successful fetch (0 = never). */
  fetchedAt: number
}

export const FEED_POLL_MS = 10 * 60_000
const FEED_URL = '/api/feed'

const EMPTY: FeedSnapshot = { items: [], trending: [], updatedAt: null, origin: 'none', loading: false, error: null, fetchedAt: 0 }

let snapshot: FeedSnapshot = EMPTY
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Partial<FeedSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const l of listeners) l()
}

export function getFeedSnapshot(): FeedSnapshot {
  return snapshot
}

/** Stable value for the server render / first hydration pass. */
export function getFeedServerSnapshot(): FeedSnapshot {
  return EMPTY
}

export function subscribeFeed(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function isPayload(x: unknown): x is FeedPayload {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return Array.isArray(o.items) && Array.isArray(o.trending)
}

/** Fetch the feed once (coalesces concurrent callers). Never throws; errors land in the snapshot. */
export function fetchFeed(): Promise<void> {
  if (inflight) return inflight
  if (typeof window === 'undefined') return Promise.resolve()
  if (snapshot.fetchedAt === 0) set({ loading: true })
  inflight = (async () => {
    try {
      const res = await fetch(FEED_URL, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`feed ${res.status}`)
      const json: unknown = await res.json()
      if (!isPayload(json)) throw new Error('feed: unexpected payload')
      const items = json.items.filter((i): i is FeedItem => Boolean(i && typeof i.id === 'string' && typeof i.text === 'string'))
      const trending = json.trending.filter((t): t is string => typeof t === 'string')
      set({
        items,
        trending,
        updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
        origin: json.origin === 'db' || json.origin === 'memory' || json.origin === 'seed' ? json.origin : 'seed',
        loading: false,
        error: null,
        fetchedAt: Date.now(),
      })
      if (trending.length === TRENDING_COUNT) getGameStore().setLiveTrending(trending)
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'feed unavailable' })
    }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

let pollers = 0
let timer: ReturnType<typeof setInterval> | null = null

function onVisible(): void {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - snapshot.fetchedAt >= FEED_POLL_MS) void fetchFeed()
}

/**
 * Start polling (fetch now, then every FEED_POLL_MS, plus a catch-up fetch when the tab becomes
 * visible again). Reference counted: the returned function stops this caller's share.
 */
export function startFeedPolling(): () => void {
  if (typeof window === 'undefined') return () => {}
  pollers += 1
  if (pollers === 1) {
    void fetchFeed()
    timer = setInterval(() => void fetchFeed(), FEED_POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    pollers -= 1
    if (pollers === 0) {
      if (timer) clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}
