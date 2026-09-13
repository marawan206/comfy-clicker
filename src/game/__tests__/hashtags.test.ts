import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import { HASHTAGS } from '@/data/hashtags'
import {
  EXTRA_KEYWORD_BONUS,
  MAX_EXTRA_KEYWORDS,
  MAX_MATCHED_TRENDING,
  TRENDING_COUNT,
  TRENDING_WEIGHTS,
  WEEK_MS,
} from '@/game/constants'
import {
  LIVE_TRENDING_TTL_MS,
  TYPE_TAG_BONUS,
  currentTrending,
  matchTags,
  matchedTrending,
  mismatchedTypeTags,
  msUntilRollover,
  normalizePromptText,
  trendMult,
  trendingForWeek,
  weekIndex,
} from '@/game/hashtags'
import { createInitialState } from '@/game/state'
import type { HashtagDef } from '@/game/types'

const T0 = 1_757_800_000_000 // 2025-09-13T22:26:40Z, nothing special about it

// ---------------------------------------------------------------------------
// Fixture: a small hashtag catalog with one type tag per kind
// ---------------------------------------------------------------------------
const TAGS: HashtagDef[] = [
  { id: 'cats', tag: 'cats', keywords: ['cat', 'cats', 'kitten'] },
  { id: 'space', tag: 'space', keywords: ['space', 'galaxy', 'moon'] },
  { id: 'cyberpunk', tag: 'cyberpunk', keywords: ['neon', 'city', 'rain'] },
  { id: 'sd15forever', tag: 'sd15forever', family: 'sd', keywords: ['sd1.5', 'stable diffusion'] },
  { id: 'portrait', tag: 'portrait', keywords: ['close-up', 'portrait'] },
  { id: 'videogen', tag: 'videogen', kind: 'video', keywords: ['video', 'clip'] },
  { id: 'musicgen', tag: 'musicgen', kind: 'audio', keywords: ['song'] },
]
const FIX = createCatalog({ hashtags: TAGS })

describe('week arithmetic', () => {
  it('weekIndex floors now over WEEK_MS and honours weekSpeed', () => {
    expect(weekIndex(0)).toBe(0)
    expect(weekIndex(WEEK_MS - 1)).toBe(0)
    expect(weekIndex(WEEK_MS)).toBe(1)
    expect(weekIndex(7 * WEEK_MS + 5)).toBe(7)
    // Weeks twice as short → index twice as high.
    expect(weekIndex(7 * WEEK_MS + 5, 2)).toBe(14)
    expect(weekIndex(T0, 0)).toBe(weekIndex(T0, 1)) // degenerate speed falls back to 1
  })

  it('msUntilRollover is positive, at most WEEK_MS, and lands on the boundary', () => {
    const now = 3 * WEEK_MS + 123_456
    const ms = msUntilRollover(now)
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThan(WEEK_MS)
    expect(weekIndex(now + ms)).toBe(weekIndex(now) + 1)
    expect(weekIndex(now + ms - 1)).toBe(weekIndex(now))
    expect(msUntilRollover(3 * WEEK_MS)).toBe(WEEK_MS) // exactly on a boundary: a full week
    expect(msUntilRollover(now, 2)).toBeLessThanOrEqual(WEEK_MS / 2)
    expect(msUntilRollover(T0)).toBeLessThan(WEEK_MS)
  })
})

describe('trendingForWeek', () => {
  it('returns TRENDING_COUNT distinct known ids, deterministically', () => {
    for (const week of [0, 1, 42, 2_931_000]) {
      const a = trendingForWeek(week, CATALOG)
      const b = trendingForWeek(week, CATALOG)
      expect(a).toEqual(b)
      expect(a).toHaveLength(TRENDING_COUNT)
      expect(new Set(a).size).toBe(TRENDING_COUNT)
      for (const id of a) expect(HASHTAGS.some((h) => h.id === id), id).toBe(true)
    }
  })

  it('differs between adjacent weeks', () => {
    for (let week = 0; week < 60; week++) {
      const a = trendingForWeek(week, CATALOG)
      const b = trendingForWeek(week + 1, CATALOG)
      expect(a, `week ${week}`).not.toEqual(b)
    }
  })

  it('always includes at least one non-type tag', () => {
    const byId = new Map(HASHTAGS.map((h) => [h.id, h]))
    for (let week = 0; week < 500; week++) {
      const tags = trendingForWeek(week, CATALOG)
      expect(tags.some((id) => byId.get(id)?.kind === undefined), `week ${week}`).toBe(true)
    }
    // A catalog that is mostly type tags still gets its non-type guarantee.
    const typeHeavy = createCatalog({
      hashtags: [
        { id: 'videogen', tag: 'videogen', kind: 'video', keywords: [] },
        { id: '3dgen', tag: '3dgen', kind: '3d', keywords: [] },
        { id: 'musicgen', tag: 'musicgen', kind: 'audio', keywords: [] },
        { id: 'cats', tag: 'cats', keywords: ['cat'] },
      ],
    })
    for (let week = 0; week < 200; week++) {
      expect(trendingForWeek(week, typeHeavy), `week ${week}`).toContain('cats')
    }
  })

  it('handles tiny and empty catalogs', () => {
    expect(trendingForWeek(3, createCatalog())).toEqual([])
    expect(trendingForWeek(3, createCatalog({ hashtags: TAGS.slice(0, 2) }))).toHaveLength(2)
  })
})

describe('currentTrending', () => {
  it('uses the deterministic week board by default and honours weekOverride', () => {
    const state = createInitialState(T0, 'g')
    expect(currentTrending(state, T0, CATALOG, 1)).toEqual(trendingForWeek(weekIndex(T0), CATALOG))
    expect(currentTrending(state, T0, CATALOG, 2)).toEqual(trendingForWeek(weekIndex(T0, 2), CATALOG))
    state.weekOverride = 7
    expect(currentTrending(state, T0, CATALOG, 1)).toEqual(trendingForWeek(7, CATALOG))
    // The override wins at every week speed.
    expect(currentTrending(state, T0, CATALOG, 2)).toEqual(trendingForWeek(7, CATALOG))
  })

  it('prefers a fresh live board, drops unknown ids, and expires it after 30 minutes', () => {
    const state = createInitialState(T0, 'g')
    state.liveTrending = { tags: ['cats', 'nonsense', 'wan22', 'cats', 'space', 'retro'], fetchedAt: T0 }
    expect(currentTrending(state, T0 + 1000, CATALOG, 1)).toEqual(['cats', 'wan22', 'space'])
    expect(currentTrending(state, T0 + LIVE_TRENDING_TTL_MS, CATALOG, 1)).toEqual(
      trendingForWeek(weekIndex(T0 + LIVE_TRENDING_TTL_MS), CATALOG),
    )
    // A live board with no known ids falls back too.
    state.liveTrending = { tags: ['nope'], fetchedAt: T0 }
    expect(currentTrending(state, T0, CATALOG, 1)).toEqual(trendingForWeek(weekIndex(T0), CATALOG))
  })
})

describe('matchTags', () => {
  it('matches keywords on word boundaries, case-insensitively', () => {
    expect(matchTags('A CAT on the moon', [], FIX)).toEqual({
      matched: ['cats', 'space'],
      keywordHits: 2,
      explicit: [],
    })
    // 'catalog' is not a cat; 'spaceship' is not space.
    expect(matchTags('catalog of spaceship parts', [], FIX).matched).toEqual([])
    expect(matchTags('', [], FIX)).toEqual({ matched: [], keywordHits: 0, explicit: [] })
  })

  it('matches multi-word and punctuated keywords as phrases', () => {
    expect(matchTags('stable diffusion portrait', [], FIX).matched).toEqual(['sd15forever', 'portrait'])
    expect(matchTags('an SD1.5 close-up', [], FIX).matched).toEqual(['sd15forever', 'portrait'])
    expect(matchTags('a close up shot', [], FIX).matched).toEqual(['portrait'])
    // Punctuation is a word break, so 'stable, diffusion' still reads as the phrase…
    expect(matchTags('stable, diffusion', [], FIX).matched).toEqual(['sd15forever'])
    // …but words in between break it.
    expect(matchTags('stable and diffusion', [], FIX).matched).toEqual([])
    expect(matchTags('diffusion stable', [], FIX).matched).toEqual([])
  })

  it('counts distinct keyword hits, not tags', () => {
    const { matched, keywordHits } = matchTags('neon city rain, cats and kittens', [], FIX)
    expect(matched).toEqual(['cats', 'cyberpunk'])
    expect(keywordHits).toBe(4) // neon, city, rain, cats ('kittens' is not 'kitten')
    expect(matchTags('cat cat cat', [], FIX).keywordHits).toBe(1)
  })

  it('literal #tags match ids without counting as keyword hits', () => {
    const r = matchTags('just vibes #space #Cats #unknown', [], FIX)
    expect(r.matched).toEqual(['space', 'cats'])
    expect(r.keywordHits).toBe(0)
  })

  it('adds selected ids, dedupes, and drops unknown ids', () => {
    const r = matchTags('a cat', ['cats', 'space', 'space', 'bogus'], FIX)
    expect(r.matched).toEqual(['cats', 'space'])
    expect(r.keywordHits).toBe(1)
  })

  it('works against the shipped catalog', () => {
    const r = matchTags('wan2.2 i2v clip of a dragon over a neon city', [], CATALOG)
    expect(r.matched).toEqual(expect.arrayContaining(['wan22', 'videogen', 'dragons', 'cyberpunk']))
    expect(r.matched).not.toContain('appmode') // 'app' must not match inside other words
  })

  it('normalizePromptText pads and collapses', () => {
    expect(normalizePromptText('Close-Up of SD1.5!')).toBe(' close up of sd1 5 ')
    expect(normalizePromptText('   ')).toBe(' ')
  })
})

// ---------------------------------------------------------------------------
// explicit tags and the mismatch rule
// ---------------------------------------------------------------------------
describe('matchTags explicit', () => {
  it('carries literal #tags and selected ids, never keyword hits', () => {
    // 'clip' is a #videogen keyword: matched, but nobody claimed anything.
    const prose = matchTags('a clip of a cat', [], FIX)
    expect(prose.matched).toEqual(['cats', 'videogen'])
    expect(prose.explicit).toEqual([])
    // The same words typed as a tag are a claim.
    expect(matchTags('a cat #videogen', [], FIX).explicit).toEqual(['videogen'])
    // So is picking the chip in the Studio.
    expect(matchTags('a cat', ['videogen'], FIX).explicit).toEqual(['videogen'])
  })

  it('lists literals before selections, deduped, unknown ids dropped', () => {
    const r = matchTags('#space #Cats #bogus', ['cats', 'videogen', 'videogen', 'nope'], FIX)
    expect(r.explicit).toEqual(['space', 'cats', 'videogen'])
    expect(r.matched).toEqual(['space', 'cats', 'videogen'])
    expect(r.keywordHits).toBe(0)
  })

  it('is a subset of matched on the shipped catalog', () => {
    const r = matchTags('a dragon over a neon city #videogen', ['cats'], CATALOG)
    expect(r.explicit).toEqual(['videogen', 'cats'])
    for (const id of r.explicit) expect(r.matched).toContain(id)
  })
})

describe('mismatchedTypeTags', () => {
  it('flags an explicit type tag whose kind is not the post kind', () => {
    expect(mismatchedTypeTags(['videogen'], 'image', FIX)).toEqual(['videogen'])
    expect(mismatchedTypeTags(['musicgen'], 'video', FIX)).toEqual(['musicgen'])
  })

  it('says nothing about a correctly typed tag, or a tag with no kind', () => {
    expect(mismatchedTypeTags(['videogen'], 'video', FIX)).toEqual([])
    expect(mismatchedTypeTags(['musicgen'], 'audio', FIX)).toEqual([])
    expect(mismatchedTypeTags(['cats', 'space', 'portrait'], 'image', FIX)).toEqual([])
    expect(mismatchedTypeTags([], 'image', FIX)).toEqual([])
  })

  it('returns several in catalog order, whatever order they were claimed in', () => {
    const order = FIX.hashtags.map((h) => h.id)
    expect(order.indexOf('videogen')).toBeLessThan(order.indexOf('musicgen'))
    expect(mismatchedTypeTags(['musicgen', 'videogen'], 'image', FIX)).toEqual(['videogen', 'musicgen'])
    // The right one survives when a matching tag rides along.
    expect(mismatchedTypeTags(['videogen', 'musicgen', 'cats'], 'audio', FIX)).toEqual(['videogen'])
  })

  it('a keyword hit alone never reaches it: prose is not a claim', () => {
    // "a cat in motion" on an image model matches #videogen by keyword, and must cost nothing.
    const r = matchTags('a cat in motion', [], CATALOG)
    expect(r.matched).toContain('videogen')
    expect(r.explicit).toEqual([])
    expect(mismatchedTypeTags(r.explicit, 'image', CATALOG)).toEqual([])
    // Typed as a tag, the same word is a claim the image model cannot back up.
    const claimed = matchTags('a cat in motion #videogen', [], CATALOG)
    expect(mismatchedTypeTags(claimed.explicit, 'image', CATALOG)).toEqual(['videogen'])
    expect(mismatchedTypeTags(claimed.explicit, 'video', CATALOG)).toEqual([])
  })

  it('an unknown catalog knows nothing about kinds, so nothing is a mismatch', () => {
    expect(mismatchedTypeTags(['videogen'], 'image', createCatalog())).toEqual([])
  })
})

describe('trendMult', () => {
  const trending = ['cats', 'space', 'cyberpunk']

  it('one trending match → 2.0, two → 2.4', () => {
    expect(trendMult(['cats'], trending, 0, 'image', FIX)).toBeCloseTo(1 + TRENDING_WEIGHTS[0], 10)
    expect(trendMult(['cats'], trending, 0, 'image', FIX)).toBeCloseTo(2.0, 10)
    expect(trendMult(['space', 'cats'], trending, 0, 'image', FIX)).toBeCloseTo(2.4, 10)
    // Non-trending matches do nothing.
    expect(trendMult(['portrait'], trending, 0, 'image', FIX)).toBe(1)
    expect(trendMult([], trending, 0, 'image', FIX)).toBe(1)
  })

  it('more than MAX_MATCHED_TRENDING matched → 1.0 (spam), even with keywords', () => {
    expect(MAX_MATCHED_TRENDING).toBe(2)
    expect(trendMult(['cats', 'space', 'cyberpunk'], trending, 0, 'image', FIX)).toBe(1)
    expect(trendMult(['cats', 'space', 'cyberpunk'], trending, 3, 'image', FIX)).toBe(1)
  })

  it('a trending type tag of the post kind is a free +0.2 that never occupies a slot', () => {
    const t = ['videogen', 'cats', 'space']
    expect(trendMult([], t, 0, 'video', FIX)).toBeCloseTo(1 + TYPE_TAG_BONUS, 10)
    expect(trendMult(['cats'], t, 0, 'video', FIX)).toBeCloseTo(2.2, 10)
    // Two real matches plus the type tag: not spam.
    expect(trendMult(['cats', 'space', 'videogen'], t, 0, 'video', FIX)).toBeCloseTo(2.6, 10)
    // Wrong kind: nothing, and tagging it explicitly still gives nothing.
    expect(trendMult([], t, 0, 'image', FIX)).toBe(1)
    expect(trendMult(['videogen'], t, 0, 'image', FIX)).toBe(1)
  })

  it('extra keywords add EXTRA_KEYWORD_BONUS each, capped at MAX_EXTRA_KEYWORDS', () => {
    expect(trendMult([], trending, 1, 'image', FIX)).toBeCloseTo(1 + EXTRA_KEYWORD_BONUS, 10)
    expect(trendMult([], trending, 3, 'image', FIX)).toBeCloseTo(1 + 3 * EXTRA_KEYWORD_BONUS, 10)
    expect(trendMult([], trending, 99, 'image', FIX)).toBeCloseTo(1 + MAX_EXTRA_KEYWORDS * EXTRA_KEYWORD_BONUS, 10)
    expect(trendMult(['cats'], trending, 2, 'image', FIX)).toBeCloseTo(2.2, 10)
    expect(trendMult([], trending, -4, 'image', FIX)).toBe(1)
  })

  it('scores against whatever catalog it is given, the shipped one included', () => {
    const t = ['videogen', 'cats', 'space']
    expect(trendMult(['cats'], t, 0, 'video', CATALOG)).toBeCloseTo(2.2, 10)
    expect(trendMult(['cats'], t, 0, 'image', CATALOG)).toBeCloseTo(2.0, 10)
    // The catalog is what tells a type tag from a subject tag: without it #videogen is just a word.
    expect(trendMult(['cats'], t, 0, 'video', createCatalog())).toBeCloseTo(2.0, 10)
  })

  it('matchedTrending lists the ridden tags hottest first, empty on spam', () => {
    const t = ['videogen', 'cats', 'space']
    expect(matchedTrending(['space', 'cats'], t, 'video', FIX)).toEqual(['videogen', 'cats', 'space'])
    expect(matchedTrending(['space'], t, 'image', FIX)).toEqual(['space'])
    expect(matchedTrending(['cats', 'space', 'cyberpunk'], ['cats', 'space', 'cyberpunk'], 'image', FIX)).toEqual([])
  })
})
