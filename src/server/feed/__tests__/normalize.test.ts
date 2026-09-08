import { describe, expect, it } from 'vitest'
import { HASHTAGS } from '@/data/hashtags'
import {
  FEED_VOCAB,
  FEED_VOCAB_FALLBACK,
  buildFeedVocabulary,
  isOfficialHandle,
  matchVocabTags,
  normalizeItems,
  tagsFor,
} from '@/server/feed/normalize'
import type { FeedItem } from '@/server/feed/types'

const VOCAB = FEED_VOCAB_FALLBACK

function item(over: Partial<FeedItem>): FeedItem {
  return {
    id: 'x:1',
    source: 'x',
    author: 'A',
    handle: 'a',
    url: 'https://x.com/a/status/1',
    text: 'hello',
    date: '2026-09-01T00:00:00.000Z',
    likes: 1,
    tags: [],
    verified: false,
    ...over,
  }
}

describe('vocabulary matching', () => {
  it('matches keywords, multi-word keywords and literal hashtags case-insensitively', () => {
    const tags = tagsFor('Made a Cozy cat VIDEO with Wan 2.2 and #ltx2, rendered in ComfyUI', VOCAB)
    expect(tags).toEqual(expect.arrayContaining(['cozy', 'cats', 'videogen', 'wan22', 'ltx2', 'comfyui']))
  })
  it('respects word boundaries', () => {
    expect(tagsFor('concatenate categories, spaceship', VOCAB)).not.toContain('cats')
    expect(tagsFor('concatenate categories, spaceship', VOCAB)).not.toContain('space')
    expect(tagsFor('sd1.5 still works on my 3D printer', VOCAB)).toEqual(expect.arrayContaining(['sd15forever', '3dgen']))
  })
  it('orders by hit count and caps hits per tag', () => {
    const hits = matchVocabTags('dragon dragon dragon dragon dragon dragon dragon cat', VOCAB)
    expect(hits.dragons).toBe(5)
    expect(hits.cats).toBe(1)
    expect(tagsFor('cat dragon dragon', VOCAB)).toEqual(['dragons', 'cats'])
  })
  it('every fallback entry has an id and keywords; type tags are video/3d/audio', () => {
    for (const v of VOCAB) {
      expect(v.id).toMatch(/^[a-z0-9]+$/)
      expect(v.keywords.length).toBeGreaterThan(0)
    }
    expect(VOCAB.filter((v) => v.kind).map((v) => v.id)).toEqual(['videogen', '3dgen', 'musicgen'])
    expect(new Set(VOCAB.map((v) => v.id)).size).toBe(VOCAB.length)
  })
  it('mirrors the game catalog ids exactly', () => {
    expect(VOCAB.map((v) => v.id).sort()).toEqual(HASHTAGS.map((h) => h.id).sort())
  })
  it('FEED_VOCAB takes ids/kinds from the catalog and keywords from the tuned list', () => {
    expect(FEED_VOCAB.map((v) => v.id)).toEqual(HASHTAGS.map((h) => h.id))
    for (const entry of FEED_VOCAB) {
      const catalog = HASHTAGS.find((h) => h.id === entry.id)!
      const tuned = VOCAB.find((v) => v.id === entry.id)!
      expect(entry.kind).toBe(catalog.kind)
      expect(entry.keywords).toEqual(tuned.keywords)
    }
    // Catalog-only ids keep their catalog keywords; an empty catalog falls back entirely.
    const mixed = buildFeedVocabulary([{ id: 'newtag', keywords: ['brand new'] }, { id: 'cats', keywords: ['x'] }], VOCAB)
    expect(mixed.map((v) => v.id)).toEqual(['newtag', 'cats'])
    expect(mixed[0].keywords).toEqual(['brand new'])
    expect(mixed[1].keywords).toEqual(VOCAB.find((v) => v.id === 'cats')!.keywords)
    expect(buildFeedVocabulary([], VOCAB)).toBe(VOCAB)
  })
})

describe('isOfficialHandle', () => {
  it('flags founders and org accounts, ignoring @ and case', () => {
    expect(isOfficialHandle('@yoland_yan')).toBe(true)
    expect(isOfficialHandle('RobinJHuang')).toBe(true)
    expect(isOfficialHandle('ComfyUI')).toBe(true)
    expect(isOfficialHandle('someone')).toBe(false)
    expect(isOfficialHandle(null)).toBe(false)
  })
})

describe('normalizeItems', () => {
  const now = Date.parse('2026-09-13T00:00:00.000Z')

  it('tags untagged items, keeps curated tags, strips @, flags official handles', () => {
    const [a, b] = normalizeItems(
      [
        item({ id: 'x:1', handle: '@yoland_yan', text: 'cozy cats', tags: [] }),
        item({ id: 'x:2', text: 'cozy cats', tags: ['retro'], date: '2026-08-01T00:00:00.000Z' }),
      ],
      VOCAB,
      now,
    )
    expect(a.handle).toBe('yoland_yan')
    expect(a.verified).toBe(true)
    expect(a.tags).toEqual(['cozy', 'cats'])
    expect(b.tags).toEqual(['retro'])
    expect(b.verified).toBe(false)
  })

  it('dedupes by id (first wins), sorts newest first, repairs dates and likes', () => {
    const out = normalizeItems(
      [
        item({ id: 'x:1', text: 'live', likes: 10.4, date: '2026-09-01T00:00:00.000Z' }),
        item({ id: 'X:1', text: 'seed', likes: 1 }),
        item({ id: 'x:2', text: 'newer', date: '2026-09-10T00:00:00.000Z', likes: -3 }),
        item({ id: 'x:3', text: 'bad date', date: 'not a date', likes: Number.NaN }),
      ],
      VOCAB,
      now,
    )
    expect(out.map((i) => i.id)).toEqual(['x:3', 'x:2', 'x:1'])
    expect(out[2].text).toBe('live')
    expect(out[2].likes).toBe(10)
    expect(out[1].likes).toBe(0)
    expect(out[0].likes).toBeNull()
    expect(out[0].date).toBe(new Date(now).toISOString())
  })

  it('drops items without id/url/text and non-http media', () => {
    const out = normalizeItems(
      [
        item({ id: '', text: 'no id' }),
        item({ id: 'x:9', url: '', text: 'no url' }),
        item({ id: 'x:10', text: '   ' }),
        item({ id: 'x:11', text: 'ok', avatarUrl: 'data:image/png;base64,xx', mediaUrl: 'https://img.example/a.png', stats: {} }),
      ],
      VOCAB,
      now,
    )
    expect(out).toHaveLength(1)
    expect(out[0].avatarUrl).toBeUndefined()
    expect(out[0].mediaUrl).toBe('https://img.example/a.png')
    expect(out[0].stats).toBeUndefined()
  })

  it('drops adult-content posts but keeps #foodporn', () => {
    const out = normalizeItems(
      [
        item({ id: 'reddit:1', text: 'Best place to start for NSFW AI image creation' }),
        item({ id: 'reddit:2', text: 'ramen night #foodporn' }),
      ],
      VOCAB,
      now,
    )
    expect(out.map((i) => i.id)).toEqual(['reddit:2'])
    expect(out[0].tags).toContain('foodporn')
  })

  it('clamps long text', () => {
    const [out] = normalizeItems([item({ text: 'word '.repeat(400) })], VOCAB, now)
    expect(out.text.length).toBeLessThanOrEqual(601)
    expect(out.text.endsWith('…')).toBe(true)
  })
})
