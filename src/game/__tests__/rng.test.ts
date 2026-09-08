import { describe, expect, it } from 'vitest'
import { chance, hashString, mulberry32, pick, uniform, weightedPick } from '@/game/rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    const seqA = Array.from({ length: 50 }, () => a())
    const seqB = Array.from({ length: 50 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('differs across seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('stays in [0, 1) and is roughly uniform', () => {
    const rng = mulberry32(99)
    const buckets = new Array<number>(10).fill(0)
    const N = 20_000
    for (let i = 0; i < N; i++) {
      const x = rng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      buckets[Math.floor(x * 10)]! += 1
    }
    for (const count of buckets) {
      expect(count / N).toBeGreaterThan(0.08)
      expect(count / N).toBeLessThan(0.12)
    }
  })

  it('treats seeds as uint32 (negative and fractional seeds still work)', () => {
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)())
    expect(mulberry32(7.9)()).toBe(mulberry32(7)())
  })
})

describe('hashString', () => {
  it('is stable and returns a uint32', () => {
    const h = hashString('a cat wearing a ComfyUI hoodie')
    expect(h).toBe(hashString('a cat wearing a ComfyUI hoodie'))
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
    expect(hashString('')).toBe(0x811c9dc5)
  })

  it('separates nearby strings', () => {
    expect(hashString('flux-dev')).not.toBe(hashString('flux-def'))
    expect(hashString('sd15')).not.toBe(hashString('sdxl'))
  })
})

describe('uniform / pick / chance', () => {
  it('uniform maps into [a, b)', () => {
    const rng = mulberry32(5)
    for (let i = 0; i < 1000; i++) {
      const x = uniform(rng, 3, 8)
      expect(x).toBeGreaterThanOrEqual(3)
      expect(x).toBeLessThan(8)
    }
  })

  it('pick returns members and throws on empty', () => {
    const rng = mulberry32(5)
    const arr = ['sd15', 'sdxl', 'flux-dev']
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(rng, arr))
    expect(() => pick(rng, [])).toThrow(RangeError)
  })

  it('chance respects p, clamped', () => {
    const rng = mulberry32(11)
    expect(chance(rng, 0)).toBe(false)
    expect(chance(rng, -1)).toBe(false)
    expect(chance(rng, 1)).toBe(true)
    expect(chance(rng, 2)).toBe(true)
    expect(chance(rng, NaN)).toBe(false)
    let hits = 0
    const N = 10_000
    for (let i = 0; i < N; i++) if (chance(rng, 0.25)) hits++
    expect(Math.abs(hits / N - 0.25)).toBeLessThan(0.03)
  })
})

describe('weightedPick', () => {
  it('matches the weight distribution within 3% over 10k draws', () => {
    const rng = mulberry32(2024)
    const items = [
      { id: 'modelDrop', weight: 5 },
      { id: 'nodeBroke', weight: 3 },
      { id: 'cloudPromo', weight: 2 },
    ]
    const counts: Record<string, number> = { modelDrop: 0, nodeBroke: 0, cloudPromo: 0 }
    const N = 10_000
    for (let i = 0; i < N; i++) counts[weightedPick(rng, items).id]! += 1
    expect(Math.abs(counts.modelDrop! / N - 0.5)).toBeLessThan(0.03)
    expect(Math.abs(counts.nodeBroke! / N - 0.3)).toBeLessThan(0.03)
    expect(Math.abs(counts.cloudPromo! / N - 0.2)).toBeLessThan(0.03)
  })

  it('never returns zero-weight entries', () => {
    const rng = mulberry32(3)
    const items = [
      { id: 'never', weight: 0 },
      { id: 'always', weight: 1 },
      { id: 'negative', weight: -4 },
    ]
    for (let i = 0; i < 500; i++) expect(weightedPick(rng, items).id).toBe('always')
  })

  it('falls back to uniform when nothing has weight, throws on empty', () => {
    const rng = mulberry32(3)
    const items = [
      { id: 'a', weight: 0 },
      { id: 'b', weight: 0 },
    ]
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(weightedPick(rng, items).id)
    expect(seen).toEqual(new Set(['a', 'b']))
    expect(() => weightedPick(rng, [])).toThrow(RangeError)
  })

  it('is deterministic under the same seed', () => {
    const items = [
      { id: 'x', weight: 1 },
      { id: 'y', weight: 2 },
    ]
    const a = mulberry32(77)
    const b = mulberry32(77)
    const seqA = Array.from({ length: 30 }, () => weightedPick(a, items).id)
    const seqB = Array.from({ length: 30 }, () => weightedPick(b, items).id)
    expect(seqA).toEqual(seqB)
  })
})
