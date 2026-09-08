import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CATALOG } from '@/data'
import { MODELS } from '@/data/models'
import { HASHTAGS } from '@/data/hashtags'
import { PRECISIONS, PRECISION_ORDER } from '@/data/precisions'
import { SETUP_FEE_MULT } from '@/game/constants'
import { nativeHardware, quantFee, setupFee } from '@/game/quantize'
import type { Derived, ModelKind, Precision } from '@/game/types'

const VENDOR_DIR = fileURLToPath(new URL('../../assets/brand/vendors/', import.meta.url))

const KINDS: ModelKind[] = ['image', 'video', '3d', 'audio']
const local = MODELS.filter((m) => !m.api)
const apiModels = MODELS.filter((m) => m.api)

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('models data', () => {
  it('has unique ids, art ids and names', () => {
    const ids = MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    const arts = MODELS.map((m) => m.art)
    expect(new Set(arts).size).toBe(arts.length)
    const names = MODELS.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses kebab-case ids and art id `model-<id>`', () => {
    for (const m of MODELS) {
      expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(m.art).toBe(`model-${m.id}`)
    }
  })

  it('every vendorIcon exists as an svg under src/assets/brand/vendors', () => {
    for (const m of MODELS) {
      const file = path.join(VENDOR_DIR, `${m.vendorIcon}.svg`)
      expect(existsSync(file), `${m.id}: missing vendor icon ${file}`).toBe(true)
    }
  })

  it('baseCost is monotonic with vram within each kind (local models)', () => {
    for (const kind of KINDS) {
      const sorted = local.filter((m) => m.kind === kind).sort((a, b) => a.vram - b.vram)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!
        const cur = sorted[i]!
        expect(cur.baseCost, `${kind}: ${cur.id} (${cur.vram} GB) should cost ≥ ${prev.id}`).toBeGreaterThanOrEqual(
          prev.baseCost,
        )
        if (cur.vram > prev.vram) expect(cur.baseCost).toBeGreaterThan(prev.baseCost)
      }
    }
  })

  it('baseLikes grows with vram within each kind (local models)', () => {
    for (const kind of KINDS) {
      const sorted = local.filter((m) => m.kind === kind).sort((a, b) => a.vram - b.vram)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.baseLikes).toBeGreaterThanOrEqual(sorted[i - 1]!.baseLikes)
      }
    }
  })

  it('video pays out more than image on average', () => {
    const video = mean(MODELS.filter((m) => m.kind === 'video').map((m) => m.payoutRatio))
    const image = mean(MODELS.filter((m) => m.kind === 'image').map((m) => m.payoutRatio))
    expect(video).toBeGreaterThan(image)
  })

  it('costSecs and baseTime stay within the design bands', () => {
    for (const m of MODELS) {
      expect(m.costSecs, m.id).toBeGreaterThanOrEqual(4)
      expect(m.costSecs, m.id).toBeLessThanOrEqual(20)
      expect(m.baseTime, m.id).toBeGreaterThanOrEqual(4)
      expect(m.baseTime, m.id).toBeLessThanOrEqual(14)
      // EV/cost = payoutRatio × E[roll × founder] (≈ 1.2765) must sit in the contract band [1.05, 1.6];
      // virality.test.ts asserts the band itself, this is the raw-data view of the same rule.
      expect(m.payoutRatio, m.id).toBeGreaterThanOrEqual(1.1)
      expect(m.payoutRatio, m.id).toBeLessThanOrEqual(1.25)
      expect(m.baseCost, m.id).toBeGreaterThan(0)
      expect(m.baseLikes, m.id).toBeGreaterThan(0)
    }
  })

  it('api models have vram 0, are not quantizable and gate on the api-nodes map node', () => {
    expect(apiModels.length).toBeGreaterThan(0)
    for (const m of apiModels) {
      expect(m.vram, m.id).toBe(0)
      expect(m.quantizable, m.id).toBe(false)
      expect(m.unlock, m.id).toEqual({ type: 'mapNode', id: 'api-nodes' })
    }
    for (const m of local) expect(m.vram, m.id).toBeGreaterThan(0)
  })

  it('sd15 is the preinstalled starter and cannot be quantized', () => {
    const sd15 = MODELS.find((m) => m.id === 'sd15')
    expect(sd15).toBeDefined()
    expect(sd15!.preinstalled).toBe(true)
    expect(sd15!.quantizable).toBe(false)
    expect(sd15!.cpuOk).toBe(true)
    expect(MODELS.filter((m) => m.preinstalled)).toHaveLength(1)
  })

  it('every model has 6–10 lowercase thumbTags with no duplicates', () => {
    for (const m of MODELS) {
      expect(m.thumbTags.length, m.id).toBeGreaterThanOrEqual(6)
      expect(m.thumbTags.length, m.id).toBeLessThanOrEqual(10)
      expect(new Set(m.thumbTags).size, m.id).toBe(m.thumbTags.length)
      for (const t of m.thumbTags) expect(t, `${m.id}: ${t}`).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('every model has a flavor line', () => {
    for (const m of MODELS) expect(m.flavor.trim().length, m.id).toBeGreaterThan(10)
  })

  it('covers every kind', () => {
    for (const kind of KINDS) expect(MODELS.some((m) => m.kind === kind), kind).toBe(true)
  })

  it('setting up a model you cannot hold and quantizing it always undercuts buying its native rig', () => {
    // The lock reason steers the player toward "quantize FP8 for N"; that must be the better deal.
    expect(SETUP_FEE_MULT).toBeLessThanOrEqual(1)
    const noVram = { bestVram: 0 } as Derived
    for (const m of local.filter((x) => x.quantizable !== false)) {
      const rig = nativeHardware(m, CATALOG)
      expect(rig, m.id).not.toBeNull()
      const path = setupFee(m, noVram, CATALOG) + quantFee(m, 'fp8', CATALOG)
      expect(path, `${m.id}: setup + FP8 ${path} vs ${rig!.id} ${rig!.baseCost}`).toBeLessThan(rig!.baseCost)
    }
  })
})

describe('precisions data', () => {
  it('defines native, fp8 and q4 with ids matching their keys', () => {
    const keys: Precision[] = ['native', 'fp8', 'q4']
    expect(Object.keys(PRECISIONS).sort()).toEqual([...keys].sort())
    expect(PRECISION_ORDER).toEqual(keys)
    for (const k of keys) expect(PRECISIONS[k].id).toBe(k)
  })

  it('native is the identity and lower precisions trade quality for vram/cost/time', () => {
    const { native, fp8, q4 } = PRECISIONS
    expect(native).toMatchObject({ vramMult: 1, qualityMult: 1, costMult: 1, timeMult: 1, feeFraction: 0 })
    expect(fp8.vramMult).toBeLessThan(native.vramMult)
    expect(q4.vramMult).toBeLessThan(fp8.vramMult)
    expect(fp8.qualityMult).toBeLessThan(native.qualityMult)
    expect(q4.qualityMult).toBeLessThan(fp8.qualityMult)
    expect(fp8.costMult).toBeLessThan(1)
    expect(q4.costMult).toBeLessThan(fp8.costMult)
    expect(fp8.feeFraction).toBeGreaterThan(q4.feeFraction)
  })
})

describe('hashtags data', () => {
  it('has 30 entries with unique ids and tags, id === tag, no leading #', () => {
    expect(HASHTAGS).toHaveLength(30)
    const ids = HASHTAGS.map((h) => h.id)
    const tags = HASHTAGS.map((h) => h.tag)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(tags).size).toBe(tags.length)
    for (const h of HASHTAGS) {
      expect(h.tag).toBe(h.id)
      expect(h.tag).not.toMatch(/^#/)
      expect(h.tag).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('every hashtag has at least one lowercase keyword and no duplicate keywords', () => {
    for (const h of HASHTAGS) {
      expect(h.keywords.length, h.id).toBeGreaterThanOrEqual(1)
      expect(new Set(h.keywords).size, h.id).toBe(h.keywords.length)
      for (const k of h.keywords) {
        expect(k, `${h.id}: ${k}`).toBe(k.toLowerCase().trim())
        expect(k.length, `${h.id}: ${k}`).toBeGreaterThan(0)
      }
    }
  })

  it('has one type tag per model kind and family tags reference real model families', () => {
    const families = new Set(MODELS.map((m) => m.family))
    for (const kind of KINDS) {
      expect(HASHTAGS.filter((h) => h.kind === kind).length, kind).toBeLessThanOrEqual(1)
    }
    for (const kind of ['video', '3d', 'audio'] as const) {
      expect(HASHTAGS.some((h) => h.kind === kind), kind).toBe(true)
    }
    for (const h of HASHTAGS) {
      if (h.family) expect(families.has(h.family), `${h.id} → family ${h.family}`).toBe(true)
    }
  })

  it('includes the tags the rest of the game references', () => {
    const ids = new Set(HASHTAGS.map((h) => h.id))
    for (const id of ['comfyui', 'wan22', 'ltx2', 'videogen', '3dgen', 'musicgen', 'cats', 'hackathon']) {
      expect(ids.has(id), id).toBe(true)
    }
  })
})
