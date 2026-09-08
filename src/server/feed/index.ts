/**
 * Live feed collector. Runs every source in parallel (each isolated: 5 s per request, never throws),
 * backfills the curated founder posts from the seed, normalises, and computes trending hashtag ids.
 * Server-only: uses `fetch` and is meant to be called from a route handler or cron.
 */
import { FEED_VOCAB, normalizeItems } from '@/server/feed/normalize'
import { SEED_FEED_ITEMS } from '@/server/feed/seed'
import { fetchBlog } from '@/server/feed/sources/blog'
import { fetchGithub } from '@/server/feed/sources/github'
import { fetchHn } from '@/server/feed/sources/hn'
import { fetchLinkedIn } from '@/server/feed/sources/linkedin'
import { fetchReddit } from '@/server/feed/sources/reddit'
import { fetchRegistry } from '@/server/feed/sources/registry'
import { fetchX, fetchXProfile } from '@/server/feed/sources/x'
import { fetchYoutube } from '@/server/feed/sources/youtube'
import { computeTrending } from '@/server/feed/trending'
import {
  FEED_SOURCES,
  type CollectFeedOptions,
  type FeedItem,
  type FeedResult,
  type FeedSource,
  type SourceFetcher,
  type SourceResult,
} from '@/server/feed/types'
import { errorMessage } from '@/server/feed/util'

export type { CollectFeedOptions, FeedItem, FeedItemStats, FeedResult, FeedSource, FeedVocabEntry, SourceResult } from '@/server/feed/types'
export { FEED_SOURCES } from '@/server/feed/types'
export { FEED_VOCAB, FEED_VOCAB_FALLBACK, buildFeedVocabulary, normalizeItems, tagsFor } from '@/server/feed/normalize'
export { computeTrending } from '@/server/feed/trending'
export { SEED_FEED_ITEMS, seedFeedItems } from '@/server/feed/seed'

/** Upper bound per source so one stalled host can't hold the whole collection (LinkedIn fans out to ~12 pages). */
export const SOURCE_DEADLINE_MS = 25_000
/** Org-authored items with no avatar of their own borrow the official @ComfyUI avatar. */
const OFFICIAL_AVATAR_SOURCES: ReadonlySet<FeedSource> = new Set<FeedSource>(['blog', 'github', 'youtube'])

export const SOURCE_FETCHERS: Record<FeedSource, SourceFetcher> = {
  linkedin: fetchLinkedIn,
  x: fetchX,
  reddit: fetchReddit,
  hn: fetchHn,
  blog: fetchBlog,
  github: fetchGithub,
  registry: fetchRegistry,
  youtube: fetchYoutube,
}

function withDeadline(run: Promise<SourceResult>, ms: number): Promise<SourceResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ items: [], error: `source deadline of ${ms} ms exceeded` }), ms)
    run.then(
      (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      (err: unknown) => {
        clearTimeout(timer)
        resolve({ items: [], error: errorMessage(err) })
      },
    )
  })
}

async function runSource(source: FeedSource): Promise<[FeedSource, SourceResult]> {
  try {
    return [source, await withDeadline(SOURCE_FETCHERS[source](), SOURCE_DEADLINE_MS)]
  } catch (err) {
    return [source, { items: [], error: errorMessage(err) }]
  }
}

export async function collectFeed(opts: CollectFeedOptions = {}): Promise<FeedResult> {
  const now = opts.now ?? Date.now()
  const vocab = opts.hashtags && opts.hashtags.length > 0 ? opts.hashtags : FEED_VOCAB
  const sources = opts.sources ?? FEED_SOURCES

  const wantsOfficialAvatar = sources.some((s) => OFFICIAL_AVATAR_SOURCES.has(s))
  const [results, officialProfile] = await Promise.all([
    Promise.all(sources.map(runSource)),
    wantsOfficialAvatar ? fetchXProfile() : Promise.resolve(null),
  ])

  const errors: Record<string, string> = {}
  const live: FeedItem[] = []
  for (const [source, result] of results) {
    if (result.error) errors[source] = result.error
    live.push(...result.items)
  }

  // Curated founder posts are always present; live copies (fresh likes/avatars) win on id.
  const seen = new Set(live.map((item) => item.id))
  const merged = [...live, ...SEED_FEED_ITEMS.filter((item) => !seen.has(item.id)).map((item) => ({ ...item, tags: [...item.tags] }))]

  const avatar = officialProfile?.avatarUrl
  if (avatar) {
    for (const item of merged) {
      if (!item.avatarUrl && item.verified && OFFICIAL_AVATAR_SOURCES.has(item.source)) item.avatarUrl = avatar
    }
  }

  const items = normalizeItems(merged, vocab, now)
  const trending = computeTrending(items, vocab, { now })
  return { items, trending, errors, fetchedAt: new Date(now).toISOString() }
}
