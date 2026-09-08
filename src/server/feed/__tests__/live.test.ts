import { describe, expect, it } from 'vitest'
import { collectFeed } from '@/server/feed/index'
import { FEED_SOURCES } from '@/server/feed/types'

/** Network smoke test. Run with `RUN_LIVE=1 npx vitest run src/server/feed/__tests__/live.test.ts`. */
describe.skipIf(!process.env.RUN_LIVE)('live collectFeed', () => {
  it(
    'collects items from the real sources and computes trending',
    async () => {
      const result = await collectFeed()
      const bySource = Object.fromEntries(FEED_SOURCES.map((s) => [s, result.items.filter((i) => i.source === s).length]))
      console.log('feed summary', { bySource, trending: result.trending, errors: result.errors, fetchedAt: result.fetchedAt })

      expect(result.items.length).toBeGreaterThan(12)
      expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false)
      expect(new Set(result.items.map((i) => i.id)).size).toBe(result.items.length)
      for (const item of result.items) {
        expect(item.url).toMatch(/^https?:\/\//)
        expect(item.text.length).toBeGreaterThan(0)
        expect(Number.isNaN(Date.parse(item.date))).toBe(false)
      }
      // Keyless JSON/Atom sources should all be reachable.
      for (const source of ['hn', 'blog', 'github', 'registry', 'youtube'] as const) {
        expect(bySource[source], `no items from ${source}: ${result.errors[source] ?? ''}`).toBeGreaterThan(0)
      }
      // Reddit rate-limits repeated runs from one IP; a 429/403 is an acceptable outcome here.
      if (bySource.reddit === 0) expect(result.errors.reddit).toMatch(/HTTP (429|403)/)
      expect(Array.isArray(result.trending)).toBe(true)
    },
    90_000,
  )
})
