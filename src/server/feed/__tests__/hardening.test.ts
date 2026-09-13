/**
 * Regressions in the feed pipeline: the vocabulary the refresh path actually uses, the seed's
 * reserved slots, the body-read deadline, and the scheme check on the one URL the player clicks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HASHTAGS } from '@/data/hashtags'
import { FEED_VOCAB, normalizeItems } from '@/server/feed/normalize'
import { SEED_FEED_ITEMS } from '@/server/feed/seed'
import type { FeedItem } from '@/server/feed/types'
import { FEED_LIMIT, withSeed } from '@/server/feed/store'
import { FETCH_TIMEOUT_MS, fetchText } from '@/server/feed/util'

// ---------------------------------------------------------------------------
// The vocabulary the live refresh uses
// ---------------------------------------------------------------------------
const keywordsOf = (vocab: { id: string; keywords: string[] }[], id: string): string[] =>
  vocab.find((e) => e.id === id)?.keywords ?? []

describe('feed vocabulary', () => {
  it('the feed-tuned keywords win over the game catalog where both know an id', () => {
    // The catalog lists are written for player prompts, so they over-tag real-world posts.
    expect(keywordsOf(HASHTAGS, 'fluxkontext')).toContain('dev')
    expect(keywordsOf(FEED_VOCAB, 'fluxkontext')).not.toContain('dev')
    expect(keywordsOf(HASHTAGS, 'sdxl')).toContain('1024')
    expect(keywordsOf(FEED_VOCAB, 'sdxl')).not.toContain('1024')
    expect(keywordsOf(FEED_VOCAB, 'appmode')).not.toContain('app')
  })

  it('refreshFeed leaves the vocabulary to collectFeed instead of passing the raw catalog', async () => {
    const collectFeed = vi.fn().mockResolvedValue({ items: [], trending: [], errors: {}, fetchedAt: new Date().toISOString() })
    vi.doMock('@/server/feed', () => ({ collectFeed }))
    vi.resetModules()
    const { refreshFeed } = await import('@/server/feed/store')
    await refreshFeed()
    expect(collectFeed).toHaveBeenCalledTimes(1)
    expect(collectFeed.mock.calls[0][0]).not.toHaveProperty('hashtags')
    vi.doUnmock('@/server/feed')
    vi.resetModules()
  })

  it('release-note noise is not tagged as a model release', () => {
    const item: FeedItem = {
      id: 'github:1',
      source: 'github',
      author: 'comfy-org',
      handle: 'comfy-org',
      url: 'https://github.com/comfy-org/comfyui/releases/tag/v0.3.70',
      text: 'ComfyUI v0.3.70: dev build, 1024 px previews',
      date: '2026-09-01T00:00:00.000Z',
      likes: null,
      tags: [],
      verified: true,
    }
    const tags = normalizeItems([item], FEED_VOCAB)[0].tags
    expect(tags).not.toContain('fluxkontext')
    expect(tags).not.toContain('sdxl')
  })
})

// ---------------------------------------------------------------------------
// The curated founder posts
// ---------------------------------------------------------------------------
describe('withSeed', () => {
  const live = (n: number): FeedItem[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `live:${i}`,
      source: 'hn' as const,
      author: 'someone',
      handle: 'someone',
      url: `https://news.ycombinator.com/item?id=${i}`,
      text: `story ${i}`,
      date: '2026-09-01T00:00:00.000Z',
      likes: null,
      tags: [],
      verified: false,
    }))

  it('keeps every founder post even when the table is full of newer rows', () => {
    const out = withSeed(live(FEED_LIMIT))
    expect(out.length).toBeLessThanOrEqual(FEED_LIMIT)
    const ids = new Set(out.map((i) => i.id))
    for (const seed of SEED_FEED_ITEMS) expect(ids.has(seed.id), `${seed.id} was cut`).toBe(true)
  })

  it('does not duplicate a founder post that is also live, and stays newest first', () => {
    const out = withSeed([...live(10), { ...SEED_FEED_ITEMS[0] }])
    expect(out.filter((i) => i.id === SEED_FEED_ITEMS[0].id)).toHaveLength(1)
    const dates = out.map((i) => Date.parse(i.date))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })
})

// ---------------------------------------------------------------------------
// The request deadline
// ---------------------------------------------------------------------------
describe('fetchText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aborts a response whose headers arrive and whose body never does', async () => {
    // The old code cleared its timer as soon as `fetch` resolved, which is when the headers land,
    // so `res.text()` had no deadline left and froze its mapLimit worker for the whole run.
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      })
    })
    await expect(fetchText('https://example.test/stalled', {}, 30)).rejects.toThrow(/timeout after 30 ms/)
  })

  it('still returns a body that arrives in time', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('hello') }))
    await expect(fetchText('https://example.test/ok')).resolves.toBe('hello')
    expect(FETCH_TIMEOUT_MS).toBe(5_000)
  })
})

// ---------------------------------------------------------------------------
// The clickable URL
// ---------------------------------------------------------------------------
describe('normalizeItems url', () => {
  const base: FeedItem = {
    id: 'blog:1',
    source: 'blog',
    author: 'blog.comfy.org',
    handle: 'blog.comfy.org',
    url: 'https://blog.comfy.org/p/one',
    text: 'a real post about workflows',
    date: '2026-09-01T00:00:00.000Z',
    likes: null,
    tags: [],
    verified: false,
  }

  it('drops anything that is not http(s), the way avatarUrl and mediaUrl already are', () => {
    for (const url of ['//attacker.example/phish', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', '']) {
      const out = normalizeItems([{ ...base, url }], FEED_VOCAB)
      expect(out, `${url || '<empty>'} survived`).toHaveLength(0)
    }
  })

  it('keeps a normal link', () => {
    const out = normalizeItems([base], FEED_VOCAB)
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://blog.comfy.org/p/one')
  })
})
