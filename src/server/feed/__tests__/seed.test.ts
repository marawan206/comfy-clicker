import { describe, expect, it } from 'vitest'
import { realPostsSeed } from '@/data/realPostsSeed'
import { collectFeed } from '@/server/feed/index'
import { FEED_VOCAB_FALLBACK } from '@/server/feed/normalize'
import { SEED_FEED_ITEMS, realPostToFeedItem, seedFeedItems } from '@/server/feed/seed'

const VOCAB_IDS = new Set(FEED_VOCAB_FALLBACK.map((v) => v.id))

describe('realPostsSeed', () => {
  it('has the 12 verified founder posts with unique ids and valid fields', () => {
    expect(realPostsSeed).toHaveLength(12)
    expect(new Set(realPostsSeed.map((p) => p.id)).size).toBe(12)
    for (const post of realPostsSeed) {
      expect(post.capturedAt).toBe('2026-09-13')
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(post.handle.startsWith('@')).toBe(false)
      expect(post.likes).toBeGreaterThanOrEqual(0)
      expect(post.text.length).toBeGreaterThan(10)
      expect(post.tags.length).toBeGreaterThan(0)
      for (const tag of post.tags) expect(VOCAB_IDS.has(tag)).toBe(true)
      expect(post.url.startsWith(post.platform === 'x' ? 'https://x.com/' : 'https://www.linkedin.com/posts/')).toBe(true)
    }
    expect(realPostsSeed.filter((p) => p.platform === 'x')).toHaveLength(4)
    expect(realPostsSeed.filter((p) => p.platform === 'linkedin')).toHaveLength(8)
  })
})

describe('seed feed items', () => {
  it('derives canonical ids and precise timestamps that agree with the captured dates', () => {
    expect(SEED_FEED_ITEMS).toHaveLength(12)
    expect(new Set(SEED_FEED_ITEMS.map((i) => i.id)).size).toBe(12)
    for (const post of realPostsSeed) {
      const item = realPostToFeedItem(post)
      expect(item.id).toMatch(/^(x|linkedin):\d{19}$/)
      expect(item.date.slice(0, 10)).toBe(post.date)
      expect(item.verified).toBe(true)
      expect(item.likes).toBe(post.likes)
      expect(item.tags).toEqual(post.tags)
    }
    expect(realPostToFeedItem(realPostsSeed[0]).id).toBe('x:1803104946679849253')
    expect(realPostToFeedItem(realPostsSeed[8]).id).toBe('linkedin:7453496735747760128')
  })

  it('seedFeedItems returns fresh, newest-first copies', () => {
    const a = seedFeedItems()
    const b = seedFeedItems()
    expect(a).not.toBe(b)
    a[0].tags.push('zzz')
    expect(b[0].tags).not.toContain('zzz')
    for (let i = 1; i < a.length; i += 1) expect(a[i - 1].date >= a[i].date).toBe(true)
  })
})

describe('collectFeed offline', () => {
  it('serves the seed with no sources enabled and makes no network calls', async () => {
    const now = Date.parse('2026-09-13T00:00:00.000Z')
    const result = await collectFeed({ sources: [], now })
    expect(result.items).toHaveLength(12)
    expect(result.errors).toEqual({})
    expect(result.fetchedAt).toBe('2026-09-13T00:00:00.000Z')
    // Newest seed post is 2026-06-04: outside the 14-day window, so nothing trends.
    expect(result.trending).toEqual([])
    expect(result.items[0].id).toMatch(/^(x|linkedin):/)
    for (const item of result.items) expect(item.verified).toBe(true)
  })
})
