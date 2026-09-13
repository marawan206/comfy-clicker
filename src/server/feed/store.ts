/**
 * Persistence for the live feed: Supabase tables when configured, an in-memory cache otherwise,
 * and the committed seed as the last resort. Refreshes are lazy (stale > FEED_TTL_MS) and
 * can also be triggered by cron via /api/feed/refresh.
 */
import { collectFeed } from '@/server/feed'
import { seedFeedItems } from '@/server/feed/seed'
import type { FeedItem, FeedResult } from '@/server/feed/types'
import { getSupabaseAdminClient } from '@/server/supabase/admin'

export const FEED_TTL_MS = 15 * 60_000
export const FEED_LIMIT = 120
/** Rows older than this are pruned after every refresh; reads only ever look at the newest FEED_LIMIT anyway. */
export const FEED_RETENTION_DAYS = 30
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

const byDateDesc = (a: FeedItem, b: FeedItem): number => Date.parse(b.date) - Date.parse(a.date)

/**
 * Top the live rows up with the curated founder posts, reserving their slots before the cut.
 * Merging first and slicing afterwards dropped every one of them as soon as the table held
 * FEED_LIMIT newer rows, which the cron reaches within a day: the founder posts are all dated
 * 2026-06-04 or earlier, and `prune` deletes their rows on every refresh because they sit outside
 * the retention window, so this read-time top-up is the only thing keeping them in the feed.
 */
export function withSeed(items: FeedItem[]): FeedItem[] {
  const seen = new Set(items.map(i => i.id))
  const extra = seedFeedItems().filter(s => !seen.has(s.id))
  const live = [...items].sort(byDateDesc).slice(0, Math.max(0, FEED_LIMIT - extra.length))
  return [...live, ...extra].sort(byDateDesc)
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
    // No `hashtags` option: `collectFeed` falls back to FEED_VOCAB, the merge of the catalog ids
    // with the feed-tuned keyword lists. Handing it the raw catalog instead bypasses that merge,
    // and the game's keywords are written for player prompts ('dev', 'app', '1024', 'pack'), so
    // ordinary release notes get tagged with model hashtags and those false hits reach trending.
    const result = await collectFeed({ now: Date.now() })
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
  await prune(db)
}

/**
 * Retention: drop feed rows older than FEED_RETENTION_DAYS and every trending snapshot but the
 * newest 200. The curated founder posts are re-seeded on read, so they never disappear from the
 * feed even when their rows age out. Failures are recorded in memory and never block the refresh.
 */
async function prune(db: NonNullable<ReturnType<typeof getSupabaseAdminClient>>): Promise<void> {
  const cutoff = new Date(Date.now() - FEED_RETENTION_DAYS * 86_400_000).toISOString()
  const items = await db.from('feed_items').delete().lt('date', cutoff)
  if (items.error) memory.errors.prune = items.error.message
  const keep = await db.from('trending_tags').select('id').order('computed_at', { ascending: false }).range(200, 200)
  const oldest = keep.data?.[0]?.id
  if (oldest !== undefined) {
    const tags = await db.from('trending_tags').delete().lte('id', oldest)
    if (tags.error) memory.errors.prune = tags.error.message
  }
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
