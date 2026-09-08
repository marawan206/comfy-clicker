/**
 * Persistence for the live feed: Supabase tables when configured, an in-memory cache otherwise,
 * and the committed seed as the last resort. Refreshes are lazy (stale > FEED_TTL_MS) and
 * can also be triggered by cron via /api/feed/refresh.
 */
import { collectFeed } from '@/server/feed'
import { seedFeedItems } from '@/server/feed/seed'
import type { FeedItem, FeedResult } from '@/server/feed/types'
import { getSupabaseAdminClient } from '@/server/supabase/admin'
import { HASHTAGS } from '@/data/hashtags'

export const FEED_TTL_MS = 15 * 60_000
export const FEED_LIMIT = 120
const META_KEY = 'feed'

export interface FeedSnapshot {
  items: FeedItem[]
  trending: string[]
  updatedAt: string | null
  stale: boolean
  origin: 'db' | 'memory' | 'seed'
  errors?: Record<string, string>
}

type Memory = { items: FeedItem[]; trending: string[]; updatedAt: string | null; errors: Record<string, string> }
const memory: Memory = { items: [], trending: [], updatedAt: null, errors: {} }
let inflight: Promise<FeedResult> | null = null

function isStale(updatedAt: string | null, now = Date.now()): boolean {
  return !updatedAt || now - new Date(updatedAt).getTime() > FEED_TTL_MS
}

function withSeed(items: FeedItem[]): FeedItem[] {
  const seen = new Set(items.map(i => i.id))
  const merged = [...items, ...seedFeedItems().filter(s => !seen.has(s.id))]
  return merged.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, FEED_LIMIT)
}

/** Current feed without triggering network work (fast path for GET /api/feed). */
export async function readFeed(): Promise<FeedSnapshot> {
  const db = getSupabaseAdminClient()
  if (db) {
    const [items, trending, meta] = await Promise.all([
      db.from('feed_items').select('*').order('date', { ascending: false }).limit(FEED_LIMIT),
      db.from('trending_tags').select('tags, computed_at').order('computed_at', { ascending: false }).limit(1),
      db.from('feed_meta').select('updated_at, errors').eq('key', META_KEY).maybeSingle(),
    ])
    if (!items.error && items.data && items.data.length) {
      const updatedAt = meta.data?.updated_at ?? null
      return {
        items: withSeed(items.data.map(rowToItem)),
        trending: trending.data?.[0]?.tags ?? [],
        updatedAt,
        stale: isStale(updatedAt),
        origin: 'db',
        errors: (meta.data?.errors as Record<string, string> | null) ?? undefined,
      }
    }
  }
  if (memory.items.length) {
    return { items: withSeed(memory.items), trending: memory.trending, updatedAt: memory.updatedAt, stale: isStale(memory.updatedAt), origin: 'memory', errors: memory.errors }
  }
  return { items: withSeed([]), trending: [], updatedAt: null, stale: true, origin: 'seed' }
}

/** Fetch every source, persist, and return the fresh result. Coalesces concurrent callers. */
export async function refreshFeed(): Promise<FeedResult> {
  if (inflight) return inflight
  inflight = (async () => {
    const result = await collectFeed({ hashtags: HASHTAGS, now: Date.now() })
    await persist(result)
    return result
  })().finally(() => {
    inflight = null
  })
  return inflight
}

async function persist(result: FeedResult): Promise<void> {
  memory.items = result.items
  memory.trending = result.trending
  memory.updatedAt = result.fetchedAt
  memory.errors = result.errors
  const db = getSupabaseAdminClient()
  if (!db || !result.items.length) return
  const rows = result.items.map(itemToRow)
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from('feed_items').upsert(rows.slice(i, i + 100), { onConflict: 'id' })
    if (error) memory.errors.db = error.message
  }
  if (result.trending.length) await db.from('trending_tags').insert({ tags: result.trending, computed_at: result.fetchedAt })
  await db.from('feed_meta').upsert({ key: META_KEY, updated_at: result.fetchedAt, errors: result.errors }, { onConflict: 'key' })
}

function rowToItem(row: {
  id: string
  source: string
  author: string
  handle: string
  avatar_url: string | null
  url: string
  text: string
  date: string
  likes: number | null
  media_url: string | null
  tags: string[] | null
  verified: boolean | null
}): FeedItem {
  return {
    id: row.id,
    source: row.source as FeedItem['source'],
    author: row.author,
    handle: row.handle,
    avatarUrl: row.avatar_url ?? undefined,
    url: row.url,
    text: row.text,
    date: row.date,
    likes: row.likes,
    mediaUrl: row.media_url ?? undefined,
    tags: row.tags ?? [],
    verified: row.verified ?? false,
  }
}

function itemToRow(item: FeedItem) {
  return {
    id: item.id,
    source: item.source,
    author: item.author,
    handle: item.handle,
    avatar_url: item.avatarUrl ?? null,
    url: item.url,
    text: item.text,
    date: item.date,
    likes: item.likes,
    media_url: item.mediaUrl ?? null,
    tags: item.tags,
    verified: item.verified,
    fetched_at: new Date().toISOString(),
  }
}
