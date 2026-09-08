/**
 * Live trending hashtags: weighted keyword hits over recent social items.
 * Weight per item = 1 + ln(1 + likes) so a like-less Reddit post still counts once and a 500-like
 * founder post counts ~7x. The feed's own subject (`comfyui`) and any tag present on most items are
 * background, not trend, and are skipped.
 */
import { TRENDING_COUNT } from '@/game/constants'
import { matchVocabTags } from '@/server/feed/normalize'
import type { FeedItem, FeedSource, FeedVocabEntry } from '@/server/feed/types'

export const TRENDING_WINDOW_DAYS = 14
export const TRENDING_MIN_ITEMS = 5
/** A tag on more than this share of eligible items is background noise, not a trend. */
export const TRENDING_UBIQUITY_CUTOFF = 0.7
/** Every source is a ComfyUI source, so `comfyui` is the feed's subject, never its trend. */
export const TRENDING_EXCLUDED_IDS: ReadonlySet<string> = new Set(['comfyui'])
/** Registry entries are catalog rows, not posts; they'd make `customnodes` trend forever. */
const NON_SOCIAL_SOURCES: ReadonlySet<FeedSource> = new Set<FeedSource>(['registry'])

export interface TrendingOptions {
  now?: number
  windowDays?: number
  count?: number
  minItems?: number
  ubiquityCutoff?: number
}

export function itemWeight(likes: number | null): number {
  return 1 + Math.log1p(Math.max(0, likes ?? 0))
}

/** Items that count towards trending: social sources, dated within the window. */
export function trendingCandidates(items: FeedItem[], now: number, windowDays: number): FeedItem[] {
  const windowMs = windowDays * 86_400_000
  return items.filter((item) => {
    if (NON_SOCIAL_SOURCES.has(item.source)) return false
    const t = Date.parse(item.date)
    return Number.isFinite(t) && now - t <= windowMs && t - now <= 86_400_000
  })
}

/**
 * Weighted score per vocabulary id plus the number of items each id appears on.
 * Keyword hits come from the text; an item's pre-assigned tags (curated seed) count as one hit each.
 */
export function trendingScores(
  items: FeedItem[],
  vocab: FeedVocabEntry[],
): { scores: Record<string, number>; presence: Record<string, number> } {
  const scores: Record<string, number> = {}
  const presence: Record<string, number> = {}
  for (const item of items) {
    const weight = itemWeight(item.likes)
    const hits = matchVocabTags(item.text, vocab)
    for (const tag of item.tags) if (!(tag in hits)) hits[tag] = 1
    for (const [id, n] of Object.entries(hits)) {
      scores[id] = (scores[id] ?? 0) + n * weight
      presence[id] = (presence[id] ?? 0) + 1
    }
  }
  return { scores, presence }
}

/**
 * Top `count` vocabulary ids (default TRENDING_COUNT = 3) over the last `windowDays`.
 * Guarantees at least one non-type tag (an id without `kind`); returns `[]` when fewer than
 * `minItems` recent items exist or no non-type tag scored.
 */
export function computeTrending(items: FeedItem[], vocab: FeedVocabEntry[], opts: TrendingOptions = {}): string[] {
  const now = opts.now ?? Date.now()
  const count = opts.count ?? TRENDING_COUNT
  const candidates = trendingCandidates(items, now, opts.windowDays ?? TRENDING_WINDOW_DAYS)
  if (candidates.length < (opts.minItems ?? TRENDING_MIN_ITEMS)) return []

  const known = new Map(vocab.map((v) => [v.id, v]))
  const { scores, presence } = trendingScores(candidates, vocab)
  const cutoff = (opts.ubiquityCutoff ?? TRENDING_UBIQUITY_CUTOFF) * candidates.length
  const ranked = Object.keys(scores)
    .filter((id) => known.has(id) && !TRENDING_EXCLUDED_IDS.has(id) && presence[id] <= cutoff)
    .sort((a, b) => scores[b] - scores[a] || a.localeCompare(b))

  const isType = (id: string): boolean => Boolean(known.get(id)?.kind)
  const firstNonType = ranked.find((id) => !isType(id))
  if (!firstNonType) return []
  const top = ranked.slice(0, count)
  if (!top.some((id) => !isType(id))) top[top.length - 1] = firstNonType
  return top
}
