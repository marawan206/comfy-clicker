import { describe, expect, it } from 'vitest'
import { FEED_VOCAB_FALLBACK } from '@/server/feed/normalize'
import { computeTrending, itemWeight, trendingCandidates } from '@/server/feed/trending'
import type { FeedItem, FeedSource } from '@/server/feed/types'

const VOCAB = FEED_VOCAB_FALLBACK
const NOW = Date.parse('2026-09-13T12:00:00.000Z')
const DAY = 86_400_000

let seq = 0
function post(text: string, likes: number | null = 0, daysAgo = 1, source: FeedSource = 'x', tags: string[] = []): FeedItem {
  seq += 1
  return {
    id: `${source}:${seq}`,
    source,
    author: 'A',
    handle: 'a',
    url: `https://example.com/${seq}`,
    text,
    date: new Date(NOW - daysAgo * DAY).toISOString(),
    likes,
    tags,
    verified: false,
  }
}

describe('computeTrending', () => {
  it('returns [] with fewer than 5 recent items', () => {
    const items = [post('dragon'), post('dragon'), post('dragon'), post('dragon')]
    expect(computeTrending(items, VOCAB, { now: NOW })).toEqual([])
  })

  it('ranks by like-weighted keyword hits and skips ubiquitous tags', () => {
    // dragons: (1+ln 501) + (1+ln 51) ≈ 12.2; cats: (1+ln 101) + (1+ln 11) ≈ 9.0; cozy ≈ 2.8; space = 1
    const items = [
      post('ComfyUI dragon render', 500),
      post('ComfyUI dragon again', 50),
      post('ComfyUI cat', 100),
      post('ComfyUI cat', 10),
      post('ComfyUI cozy cabin', 5),
      post('ComfyUI space station', 0),
    ]
    const trending = computeTrending(items, VOCAB, { now: NOW })
    expect(trending).toEqual(['dragons', 'cats', 'cozy'])
    expect(trending).not.toContain('comfyui')
  })

  it('never trends the feed subject and skips tags present on most items', () => {
    // comfyui on 2/6 items with huge weight: excluded by name. cats on 5/6 (> 70%): excluded as ubiquitous.
    const items = [
      post('comfyui cat', 5000),
      post('comfyui cat', 5000),
      post('cat dragon', 1),
      post('cat dragon', 1),
      post('cat cozy', 1),
      post('space', 1),
    ]
    expect(computeTrending(items, VOCAB, { now: NOW })).toEqual(['dragons', 'cozy', 'space'])
  })

  it('always includes at least one non-type tag', () => {
    // Raw top 3 would be videogen, 3dgen, musicgen (all type tags); the weakest slot yields to the best non-type tag.
    const items = [
      post('video video video', 900),
      post('3d mesh glb', 900),
      post('music audio song', 900),
      post('video i2v clip', 900),
      post('retro vhs', 1),
    ]
    expect(computeTrending(items, VOCAB, { now: NOW })).toEqual(['videogen', '3dgen', 'retro'])
  })

  it('returns [] when no non-type tag scored at all', () => {
    const items = Array.from({ length: 6 }, () => post('video video', 10))
    expect(computeTrending(items, VOCAB, { now: NOW })).toEqual([])
  })

  it('ignores items outside the 14-day window and registry rows', () => {
    const fresh = [post('dragon', 10), post('dragon', 10), post('cat', 10), post('cat', 10)]
    const stale = post('robot robot', 9999, 20)
    const registry = post('robot custom node', 9999, 1, 'registry', ['customnodes'])
    expect(trendingCandidates([...fresh, stale, registry], NOW, 14)).toHaveLength(4)
    expect(computeTrending([...fresh, stale, registry], VOCAB, { now: NOW })).toEqual([])
    const withOneMore = [...fresh, post('anime portrait', 1)]
    const trending = computeTrending([...withOneMore, stale, registry], VOCAB, { now: NOW })
    expect(trending).not.toContain('robots')
    expect(trending).not.toContain('customnodes')
    expect(trending).toEqual(expect.arrayContaining(['dragons', 'cats']))
  })

  it('counts curated tags as a hit and honours count', () => {
    const items = [
      post('nothing to see', 100, 1, 'linkedin', ['hackathon']),
      post('nothing to see', 100, 1, 'linkedin', ['hackathon']),
      post('cat', 1),
      post('dragon', 1),
      post('cozy', 1),
    ]
    expect(computeTrending(items, VOCAB, { now: NOW, count: 1 })).toEqual(['hackathon'])
  })

  it('weights likes logarithmically with a floor of 1', () => {
    expect(itemWeight(null)).toBe(1)
    expect(itemWeight(0)).toBe(1)
    expect(itemWeight(Math.E - 1)).toBeCloseTo(2, 10)
    expect(itemWeight(500)).toBeLessThan(8)
  })
})
