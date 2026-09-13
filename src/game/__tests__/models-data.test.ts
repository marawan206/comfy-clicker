import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CATALOG } from '@/data'
import { MODELS } from '@/data/models'
import { ACHIEVEMENTS } from '@/data/achievements'
import { HASHTAGS } from '@/data/hashtags'
import { PRECISIONS, PRECISION_ORDER } from '@/data/precisions'
import { SETUP_FEE_MULT } from '@/game/constants'
import { nativeHardware, quantFee, setupFee } from '@/game/quantize'
import type { Derived, ModelKind, Precision, UnlockCond } from '@/game/types'

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

// ---------------------------------------------------------------------------
// Level gates. `minLevel` is the one thing standing between a fresh install and
// a 160 GB video model, so the table is pinned here rather than left to drift.
// ---------------------------------------------------------------------------
const MAX_MODEL_LEVEL = 12

describe('model level gates', () => {
  it('gives every model an integer minLevel in 1..12', () => {
    for (const m of MODELS) {
      expect(typeof m.minLevel, m.id).toBe('number')
      expect(Number.isInteger(m.minLevel), `${m.id}: ${m.minLevel}`).toBe(true)
      expect(m.minLevel, m.id).toBeGreaterThanOrEqual(1)
      expect(m.minLevel, m.id).toBeLessThanOrEqual(MAX_MODEL_LEVEL)
    }
  })

  it('starts everyone on sd15 at level 1', () => {
    expect(MODELS.find((m) => m.id === 'sd15')!.minLevel).toBe(1)
  })

  it('unlocks at least one model on every level from 2 to 12, so no rung is dead', () => {
    for (let level = 2; level <= MAX_MODEL_LEVEL; level++) {
      const unlocked = MODELS.filter((m) => m.minLevel === level).map((m) => m.id)
      expect(unlocked.length, `level ${level} unlocks nothing`).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps api models at level 7 and up', () => {
    for (const m of apiModels) expect(m.minLevel, m.id).toBeGreaterThanOrEqual(7)
  })

  it('keeps video models at level 5 and up', () => {
    for (const m of MODELS.filter((m) => m.kind === 'video')) expect(m.minLevel, m.id).toBeGreaterThanOrEqual(5)
  })

  it('never lowers minLevel as vram rises within a local kind', () => {
    for (const kind of KINDS) {
      const sorted = local.filter((m) => m.kind === kind).sort((a, b) => a.vram - b.vram)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!
        const cur = sorted[i]!
        expect(
          cur.minLevel,
          `${kind}: ${cur.id} (${cur.vram} GB) should gate at or above ${prev.id} (${prev.vram} GB)`,
        ).toBeGreaterThanOrEqual(prev.minLevel!)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Achievement data. The grant logic lives in game/achievements.ts; these are the
// invariants the catalog itself has to hold.
// ---------------------------------------------------------------------------
function condLeaves(cond: UnlockCond): UnlockCond[] {
  if (cond.type === 'all' || cond.type === 'any') return cond.conds.flatMap(condLeaves)
  return [cond]
}

describe('achievements data', () => {
  it('has unique ids and unique names', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = ACHIEVEMENTS.map((a) => a.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('pays a positive whole number of credits wherever a reward is set', () => {
    for (const a of ACHIEVEMENTS) {
      if (a.reward === undefined) continue
      expect(Number.isInteger(a.reward), `${a.id}: ${a.reward}`).toBe(true)
      expect(a.reward, a.id).toBeGreaterThan(0)
    }
  })

  it('gates every hidden achievement on a flag or a stat, never on something the store reveals', () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden)
    expect(hidden.length).toBeGreaterThanOrEqual(3)
    for (const a of hidden) {
      const kinds = condLeaves(a.cond).map((c) => c.type)
      expect(kinds.some((k) => k === 'flag' || k === 'stat'), `${a.id}: ${kinds.join(', ')}`).toBe(true)
    }
  })
})
