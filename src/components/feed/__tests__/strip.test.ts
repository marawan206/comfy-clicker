import { describe, expect, it } from 'vitest'
import { trendingMarker, weekLengthHint } from '@/components/feed/feedHooks'

describe('trendingMarker', () => {
  it('reads the wire when the board is live', () => {
    expect(trendingMarker(true, false)).toEqual({ tone: 'live', word: 'live', title: 'From the real wire' })
  })

  it('falls back to the seeded week', () => {
    expect(trendingMarker(false, false)).toEqual({ tone: 'seeded', word: 'seeded', title: 'Seeded from the week index' })
  })

  it('lets a pin outrank a live fetch', () => {
    expect(trendingMarker(true, true).tone).toBe('pinned')
    expect(trendingMarker(false, true).tone).toBe('pinned')
    expect(trendingMarker(true, true).word).toBe('pinned')
  })

  it('keeps every word short enough for the 6 px dot tooltip', () => {
    for (const m of [trendingMarker(true, false), trendingMarker(false, false), trendingMarker(false, true)]) {
      expect(m.word).toMatch(/^[a-z]+$/)
      expect(m.title.length).toBeGreaterThan(m.word.length)
    }
  })
})

describe('weekLengthHint', () => {
  it('pluralises minutes', () => {
    expect(weekLengthHint(600_000)).toBe('AI weeks are 10 minutes')
    expect(weekLengthHint(60_000)).toBe('AI weeks are 1 minute')
  })

  it('rounds and never claims a zero-minute week', () => {
    expect(weekLengthHint(90_000)).toBe('AI weeks are 2 minutes')
    expect(weekLengthHint(1_000)).toBe('AI weeks are 1 minute')
    expect(weekLengthHint(0)).toBe('AI weeks are 1 minute')
  })
})
