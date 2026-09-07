/**
 * Trending hashtags and prompt tag matching.
 *
 * A "week" is WEEK_MS of wall clock (shortened by the `weekSpeed` effect). Each week a
 * deterministic trio of tags trends — seeded by the week index — so every player on the same
 * week sees the same board, demos can pin a week via `state.weekOverride`, and the server can
 * override the board for half an hour with real trending data (`state.liveTrending`).
 */
import type { Catalog } from '@/data'
import { buildIndex, indexById } from '@/game/catalog'
import {
  EXTRA_KEYWORD_BONUS,
  MAX_EXTRA_KEYWORDS,
  MAX_MATCHED_TRENDING,
  TRENDING_COUNT,
  TRENDING_WEIGHTS,
  WEEK_MS,
} from '@/game/constants'
import { mulberry32 } from '@/game/rng'
import type { GameState, HashtagDef, ModelKind } from '@/game/types'

/** Server-provided trending tags are trusted for this long after `fetchedAt`. */
export const LIVE_TRENDING_TTL_MS = 30 * 60_000
/** A trending type tag (#videogen on a video post) adds this without using a match slot. */
export const TYPE_TAG_BONUS = 0.2

/** The subset of the catalog the hashtag module needs; a full `Catalog` satisfies it. */
export type HashtagCatalog = Pick<Catalog, 'hashtags'>

/** Length of one in-game week at the given speed multiplier (`weekSpeed` 2 = weeks twice as short). */
export function weekPeriodMs(weekSpeed = 1): number {
  const speed = Number.isFinite(weekSpeed) && weekSpeed > 0 ? weekSpeed : 1
  return WEEK_MS / speed
}

/** `floor(now / (WEEK_MS / weekSpeed))`. */
export function weekIndex(now: number, weekSpeed = 1): number {
  return Math.floor(now / weekPeriodMs(weekSpeed))
}

/** Milliseconds until the next week boundary — in `(0, period]`. */
export function msUntilRollover(now: number, weekSpeed = 1): number {
  const period = weekPeriodMs(weekSpeed)
  const into = ((now % period) + period) % period
  return period - into
}

function isTypeTag(def: HashtagDef | undefined): boolean {
  return def?.kind !== undefined
}

/**
 * The TRENDING_COUNT distinct tags trending on `week`, via a partial Fisher–Yates shuffle
 * driven by `mulberry32(week)`. Guarantees at least one non-type tag so there is always
 * something a prompt can chase (type tags match by model kind, not by words).
 */
export function trendingForWeek(week: number, catalog: HashtagCatalog): string[] {
  const defs = catalog.hashtags
  if (defs.length === 0) return []
  const byId = indexById(defs)
  const rng = mulberry32(Math.floor(week))
  const ids = defs.map((h) => h.id)
  const count = Math.min(TRENDING_COUNT, ids.length)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (ids.length - i))
    const tmp = ids[i] as string
    ids[i] = ids[j] as string
    ids[j] = tmp
  }
  const picked = ids.slice(0, count)
  if (picked.every((id) => isTypeTag(byId[id]))) {
    const rest = ids.slice(count).filter((id) => !isTypeTag(byId[id]))
    if (rest.length > 0) picked[count - 1] = rest[Math.floor(rng() * rest.length)] as string
  }
  return picked
}

/**
 * What is trending right now: the server board while it is fresh (unknown ids dropped),
 * otherwise the deterministic week board. `weekSpeed` is `derived.weekSpeed` and is required:
 * the Fast Weeks prestige node halves the week, and a board computed at the wrong speed is a
 * board the posts are not scored against.
 */
export function currentTrending(state: GameState, now: number, catalog: Catalog, weekSpeed: number): string[] {
  const live = state.liveTrending
  if (live && now - live.fetchedAt < LIVE_TRENDING_TTL_MS) {
    const { hashtagById } = buildIndex(catalog)
    const ids: string[] = []
    for (const id of live.tags) {
      if (hashtagById[id] && !ids.includes(id)) ids.push(id)
      if (ids.length >= TRENDING_COUNT) break
    }
    if (ids.length > 0) return ids
  }
  const week = state.weekOverride ?? weekIndex(now, weekSpeed)
  return trendingForWeek(week, catalog)
}

/**
 * Lowercase and collapse every run of non-alphanumerics to one space, padded on both sides,
 * so phrase membership is a plain `includes(' kw ')` with word boundaries for free.
 * `'Close-Up of SD1.5'` → `' close up of sd1 5 '`.
 */
export function normalizePromptText(text: string): string {
  const collapsed = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return collapsed ? ` ${collapsed} ` : ' '
}

const LITERAL_TAG_RE = /#([a-z0-9_]+)/g

/**
 * Which hashtags a post carries: keyword hits in the prompt (word-boundary, phrases allowed),
 * literal `#tags`, and explicitly selected ids — deduped, unknown ids dropped.
 * `keywordHits` counts distinct keywords found in the prose (literal tags excluded), which
 * `trendMult` turns into the small "descriptive prompt" bonus.
 */
export function matchTags(
  prompt: string,
  selected: string[],
  catalog: HashtagCatalog,
): { matched: string[]; keywordHits: number } {
  const byId = indexById(catalog.hashtags)
  const matched: string[] = []
  const seen = new Set<string>()
  const add = (id: string): void => {
    if (seen.has(id) || !byId[id]) return
    seen.add(id)
    matched.push(id)
  }

  const lower = prompt.toLowerCase()
  const prose = normalizePromptText(lower.replace(LITERAL_TAG_RE, ' '))
  let keywordHits = 0
  for (const def of catalog.hashtags) {
    let hit = false
    for (const keyword of def.keywords) {
      const needle = normalizePromptText(keyword)
      if (needle === ' ') continue
      if (prose.includes(needle)) {
        keywordHits += 1
        hit = true
      }
    }
    if (hit) add(def.id)
  }
  for (const m of lower.matchAll(LITERAL_TAG_RE)) add(m[1] as string)
  for (const id of selected) add(id)
  return { matched, keywordHits }
}

/**
 * Reach multiplier from trending matches.
 * - Matched trending tags, hottest first: `1 + TRENDING_WEIGHTS[rank]` summed over the first
 *   MAX_MATCHED_TRENDING (one match → 2.0, two → 2.4).
 * - More than MAX_MATCHED_TRENDING matched → 1.0 flat: that is tag spam, and the algorithm knows.
 * - A trending type tag whose kind matches the post is a free +TYPE_TAG_BONUS: it never occupies
 *   a slot and needs no keyword (type tags match any post of their kind).
 * - Plus EXTRA_KEYWORD_BONUS per distinct keyword hit, capped at MAX_EXTRA_KEYWORDS.
 */
export function trendMult(
  matched: string[],
  trending: string[],
  extraKeywordHits: number,
  kind: ModelKind,
  catalog: HashtagCatalog,
): number {
  const byId = indexById(catalog.hashtags)
  const matchedSet = new Set(matched)
  let typeBonus = 0
  let slots = 0
  for (const id of trending) {
    const def = byId[id]
    if (isTypeTag(def)) {
      if (def?.kind === kind) typeBonus += TYPE_TAG_BONUS
      continue
    }
    if (matchedSet.has(id)) slots += 1
  }
  if (slots > MAX_MATCHED_TRENDING) return 1
  let mult = 1
  for (let rank = 0; rank < slots; rank++) mult += TRENDING_WEIGHTS[rank] ?? 0
  mult += typeBonus
  const hits = Number.isFinite(extraKeywordHits) ? Math.max(0, Math.floor(extraKeywordHits)) : 0
  mult += EXTRA_KEYWORD_BONUS * Math.min(MAX_EXTRA_KEYWORDS, hits)
  return mult
}

/**
 * The trending ids a post actually rides, hottest first — matched non-type tags plus a type tag
 * of the post's kind — for the post card. Empty when the spam rule voided the match.
 */
export function matchedTrending(
  matched: string[],
  trending: string[],
  kind: ModelKind,
  catalog: HashtagCatalog,
): string[] {
  const byId = indexById(catalog.hashtags)
  const matchedSet = new Set(matched)
  const out: string[] = []
  let slots = 0
  for (const id of trending) {
    const def = byId[id]
    if (isTypeTag(def)) {
      if (def?.kind === kind) out.push(id)
      continue
    }
    if (matchedSet.has(id)) {
      out.push(id)
      slots += 1
    }
  }
  return slots > MAX_MATCHED_TRENDING ? [] : out
}
