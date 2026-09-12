/**
 * Types for the live feed pipeline (server-only, pure TypeScript).
 * Every source fetcher normalises into `FeedItem`; `collectFeed()` returns a `FeedResult`.
 */

export type FeedSource = 'linkedin' | 'x' | 'reddit' | 'hn' | 'blog' | 'github' | 'registry' | 'youtube'

export const FEED_SOURCES: readonly FeedSource[] = [
  'linkedin',
  'x',
  'reddit',
  'hn',
  'blog',
  'github',
  'registry',
  'youtube',
]

/** Secondary engagement numbers; `likes` stays the primary one so cards render uniformly. */
export interface FeedItemStats {
  comments?: number
  reposts?: number
  views?: number
  downloads?: number
  stars?: number
}

export interface FeedItem {
  /** Stable id: `${source}:${nativeId}` (e.g. `x:1803104946679849253`, `linkedin:7453496735747760128`). */
  id: string
  source: FeedSource
  author: string
  /** Handle without the leading `@` (x screen name, LinkedIn slug, reddit user, GitHub repo…). */
  handle: string
  avatarUrl?: string
  url: string
  text: string
  /** ISO 8601 timestamp. */
  date: string
  likes: number | null
  mediaUrl?: string
  /** Hashtag vocabulary ids (see `src/data/hashtags.ts`), matched by keyword. */
  tags: string[]
  /** Founder / official Comfy accounts. */
  verified: boolean
  stats?: FeedItemStats
}

/** What a single source fetcher returns. Fetchers never throw. */
export interface SourceResult {
  items: FeedItem[]
  /** Set when the source failed entirely or partially; `items` may still be non-empty. */
  error?: string
}

export type SourceFetcher = () => Promise<SourceResult>

export interface FeedResult {
  items: FeedItem[]
  /** Top hashtag ids by weighted keyword hits over the last 14 days (`[]` if the feed is too thin). */
  trending: string[]
  /** Error message keyed by source id for sources that failed (fully or partially). */
  errors: Record<string, string>
  /** ISO timestamp of the collection run. */
  fetchedAt: string
}

/**
 * Minimal structural view of a `HashtagDef` (`src/game/types.ts`) so the feed can tag items with
 * the game vocabulary without depending on the game catalog at import time.
 */
export interface FeedVocabEntry {
  id: string
  /** Without `#`; defaults to `id`. */
  tag?: string
  keywords: string[]
  /** Type tag (image/video/3d/audio); trending must always contain at least one non-type tag. */
  kind?: string
  family?: string
}

export interface CollectFeedOptions {
  /** Game hashtag vocabulary (pass `CATALOG.hashtags`); defaults to the built-in mirror. */
  hashtags?: FeedVocabEntry[]
  /** Clock override for tests. */
  now?: number
  /** Restrict to a subset of sources (default: all). */
  sources?: FeedSource[]
}

export interface XProfile {
  name: string
  handle: string
  url: string
  avatarUrl?: string
  followers: number | null
  verified: boolean
}

export interface RegistryNode {
  id: string
  name: string
  description: string
  downloads: number
  githubStars: number
  icon?: string
  repository?: string
  publisher: string
  /** Latest version publish time, else node creation time. */
  updatedAt: string | null
}
