import { describe, expect, it, vi } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import { GEN_TIME_MAX_S, GEN_TIME_MIN_S } from '@/game/constants'
import { createEmptyDerived } from '@/game/derived'
import { bulkCost } from '@/game/economy'
import {
  applyPurchase,
  bestRunnable,
  canBuy,
  cheapestPurchasable,
  effectiveTier,
  genTimeMs,
  lockReason,
  MPS_TIME_MULT,
  nativeTier,
  ownedHardware,
  ROCM_TIME_MULT,
  runnableHardware,
  runsOn,
  withArticle,
} from '@/game/hardware'
import { quantFee } from '@/game/quantize'
import { createInitialState } from '@/game/state'
import type { Derived, GameState, HardwareDef, ModelDef } from '@/game/types'

vi.mock('@/game/events', () => ({ eventEffects: () => [] }))

const hw = (id: string): HardwareDef => {
  const def = CATALOG.hardware.find((h) => h.id === id)
  if (!def) throw new Error(`missing hardware ${id}`)
  return def
}
const model = (id: string): ModelDef => {
  const def = CATALOG.models.find((m) => m.id === id)
  if (!def) throw new Error(`missing model ${id}`)
  return def
}

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = createInitialState(0, 'guest')
  mutate?.(s)
  return s
}

const base = derivedWith()

describe('runsOn', () => {
  it('3060 cannot run FLUX Dev natively but can at FP8', () => {
    expect(runsOn(model('flux-dev'), 'native', hw('rtx-3060'), base, CATALOG)).toBe(false)
    expect(runsOn(model('flux-dev'), 'fp8', hw('rtx-3060'), base, CATALOG)).toBe(true)
    expect(runsOn(model('flux-dev'), 'q4', hw('rtx-3060'), base, CATALOG)).toBe(true)
  })

  it('CPU boxes only run cpuOk models', () => {
    expect(runsOn(model('sd15'), 'native', hw('pc-4c8t'), base, CATALOG)).toBe(true)
    expect(runsOn(model('sdxl'), 'native', hw('pc-4c8t'), base, CATALOG)).toBe(false)
    // 32 GB of RAM does not make the 8-core box a GPU.
    expect(runsOn(model('sdxl'), 'q4', hw('pc-8c16t'), base, CATALOG)).toBe(false)
  })

  it('Apple silicon runs mpsOk image models, never video', () => {
    expect(runsOn(model('sd15'), 'native', hw('mac-mini-m4'), base, CATALOG)).toBe(true)
    expect(runsOn(model('sdxl'), 'native', hw('mac-mini-m4'), base, CATALOG)).toBe(true)
    expect(runsOn(model('wan22-5b'), 'native', hw('mac-studio-m4-max'), base, CATALOG)).toBe(false)
    expect(runsOn(model('flux-dev'), 'native', hw('mac-studio-m4-max'), base, CATALOG)).toBe(false)
  })

  it('AMD runs rocmOk and ZLUDA-free models; needsZluda models need the ZLUDA node', () => {
    expect(runsOn(model('sd15'), 'native', hw('rx-7600-xt'), base, CATALOG)).toBe(true)
    expect(runsOn(model('flux-schnell'), 'native', hw('rx-7600-xt'), base, CATALOG)).toBe(true)
    expect(runsOn(model('flux2'), 'native', hw('radeon-pro-w7900'), base, CATALOG)).toBe(false)
    expect(runsOn(model('flux2'), 'native', hw('radeon-pro-w7900'), derivedWith({ zluda: true }), CATALOG)).toBe(true)
    expect(runsOn(model('minimax-h3'), 'native', hw('mi300x'), base, CATALOG)).toBe(false)
    expect(runsOn(model('minimax-h3'), 'native', hw('mi300x'), derivedWith({ zluda: true }), CATALOG)).toBe(true)
  })

  it('API models need API Nodes and then run on anything, even the office PC', () => {
    expect(runsOn(model('kling'), 'native', hw('h100-80'), base, CATALOG)).toBe(false)
    const api = derivedWith({ apiNodes: true })
    expect(runsOn(model('kling'), 'native', hw('h100-80'), api, CATALOG)).toBe(true)
    expect(runsOn(model('kling'), 'native', hw('pc-4c8t'), api, CATALOG)).toBe(true)
  })

  it('regions run everything local', () => {
    expect(runsOn(model('minimax-h3'), 'native', hw('region-us-east'), base, CATALOG)).toBe(true)
  })
})

describe('canBuy', () => {
  it('locks AMD consumer cards until ROCm Setup, with a reason that says so', () => {
    const state = fresh((s) => { s.credits = 1e9; s.hardware['pc-8c16t'] = 1 })
    const locked = canBuy(hw('rx-7600-xt'), state, base, CATALOG)
    expect(locked.ok).toBe(false)
    expect(locked.reason).toMatch(/ROCm/)

    state.upgrades.push('rocm-setup')
    const unlocked = derivedWith({ unlockedFamilies: [...base.unlockedFamilies, 'amd-consumer'] })
    expect(canBuy(hw('rx-7600-xt'), state, unlocked, CATALOG)).toEqual({ ok: true })
  })

  it('AMD datacenter parts are not family-locked (ROCm tax only)', () => {
    const state = fresh((s) => { s.credits = 1e9; s.hardware['a100-80'] = 1 })
    expect(canBuy(hw('mi300x'), state, base, CATALOG).ok).toBe(true)
  })

  it('reports the store unlock condition', () => {
    const state = fresh((s) => { s.credits = 1e9 })
    const r = canBuy(hw('rtx-3060'), state, base, CATALOG)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/8c\/16t Workstation/)
  })

  it('reports missing credits with the bulk price', () => {
    const state = fresh((s) => { s.credits = 100 })
    const r = canBuy(hw('pc-8c16t'), state, base, CATALOG, 2)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Need/)
    state.credits = bulkCost(hw('pc-8c16t'), 0, 2)
    expect(canBuy(hw('pc-8c16t'), state, base, CATALOG, 2).ok).toBe(true)
  })

  it('honours the per-unit cap and rejects non-positive counts', () => {
    const capped: HardwareDef = { ...hw('pc-8c16t'), id: 'capped', max: 2 }
    const catalog = createCatalog({ hardware: [hw('pc-4c8t'), capped] })
    const state = fresh((s) => { s.credits = 1e9; s.hardware.capped = 1 })
    expect(canBuy(capped, state, base, catalog, 1).ok).toBe(true)
    expect(canBuy(capped, state, base, catalog, 2)).toEqual({ ok: false, reason: 'Only 1 more available' })
    state.hardware.capped = 2
    expect(canBuy(capped, state, base, catalog).reason).toMatch(/Maxed out/)
    expect(canBuy(hw('pc-4c8t'), state, base, catalog, 0).ok).toBe(false)
  })

  it('applyPurchase deducts the bulk cost and installs the units', () => {
    const state = fresh((s) => { s.credits = 1000 })
    const cost = applyPurchase(state, hw('pc-4c8t'), 3)
    expect(cost).toBe(bulkCost(hw('pc-4c8t'), 1, 3))
    expect(state.credits).toBe(1000 - cost)
    expect(state.hardware['pc-4c8t']).toBe(4)
    expect(applyPurchase(state, hw('pc-4c8t'), 0)).toBe(0)
  })
})

describe('owned / runnable / best', () => {
  const state = fresh((s) => { s.hardware['rtx-3060'] = 1; s.hardware['rtx-4090'] = 1; s.hardware['mac-mini-m4'] = 1 })

  it('lists owned units in catalog order', () => {
    expect(ownedHardware(state, CATALOG).map((u) => u.def.id)).toEqual(['pc-4c8t', 'mac-mini-m4', 'rtx-3060', 'rtx-4090'])
  })

  it('runnableHardware filters owned units and bestRunnable picks the fastest', () => {
    expect(runnableHardware(model('sd15'), 'native', state, base, CATALOG).map((h) => h.id)).toEqual([
      'pc-4c8t', 'mac-mini-m4', 'rtx-3060', 'rtx-4090',
    ])
    expect(bestRunnable(model('sd15'), 'native', state, base, CATALOG)?.id).toBe('rtx-4090')
    expect(bestRunnable(model('flux-dev'), 'native', state, base, CATALOG)?.id).toBe('rtx-4090')
    expect(bestRunnable(model('wan22-14b'), 'native', state, base, CATALOG)).toBeNull()
    expect(bestRunnable(model('wan22-14b'), 'q4', state, base, CATALOG)?.id).toBe('rtx-4090')
  })

  it('breaks speed-tier ties by VRAM', () => {
    const s = fresh((x) => { x.hardware['rtx-4090'] = 1; x.hardware['rtx-5080'] = 1 })
    expect(bestRunnable(model('sd15'), 'native', s, base, CATALOG)?.id).toBe('rtx-4090')
  })

  it('picks the unit with the shortest real generation time, backend taxes included', () => {
    // 3060 and RX 7600 XT share tier 3, but ROCm is ×1.25 slower: SDXL runs on the 3060.
    const amd = derivedWith({ unlockedFamilies: [...base.unlockedFamilies, 'amd-consumer'] })
    const rack = fresh((x) => { x.hardware['rtx-3060'] = 1; x.hardware['rx-7600-xt'] = 1 })
    expect(bestRunnable(model('sdxl'), 'native', rack, amd, CATALOG)?.id).toBe('rtx-3060')
    expect(genTimeMs(model('sdxl'), 'native', hw('rtx-3060'), amd, CATALOG)).toBeLessThan(
      genTimeMs(model('sdxl'), 'native', hw('rx-7600-xt'), amd, CATALOG),
    )
    // The 16 GB Radeon still wins when it is the only card that holds the model.
    expect(bestRunnable(model('flux-schnell'), 'native', rack, amd, CATALOG)?.id).toBe('rx-7600-xt')
    // A tier-2 Mac mini behind the MPS ×2 tax loses SD 1.5 to the tier-1 CPU box (10.4 s vs 6.76 s).
    const desk = fresh((x) => { x.hardware['pc-8c16t'] = 1; x.hardware['mac-mini-m4'] = 1 })
    expect(bestRunnable(model('sd15'), 'native', desk, base, CATALOG)?.id).toBe('pc-8c16t')
  })
})

describe('nativeTier', () => {
  it('is the tier of the cheapest CUDA card that holds the native weights', () => {
    expect(nativeTier(model('flux-dev'), CATALOG)).toBe(hw('rtx-3090').speedTier)
    expect(nativeTier(model('sd15'), CATALOG)).toBe(hw('rtx-3060').speedTier)
    expect(nativeTier(model('wan22-14b'), CATALOG)).toBe(hw('rtx-pro-6000').speedTier)
  })

  it('is 0 for API models', () => {
    expect(nativeTier(model('kling'), CATALOG)).toBe(0)
  })
})

describe('lockReason', () => {
  it('is null when something owned can run it', () => {
    const state = fresh((s) => { s.hardware['rtx-3060'] = 1 })
    expect(lockReason(model('sd15'), 'native', state, base, CATALOG)).toBeNull()
    expect(lockReason(model('flux-dev'), 'fp8', state, base, CATALOG)).toBeNull()
  })

  it('explains a VRAM shortfall with the quantize fee and the cheapest fitting card', () => {
    const state = fresh((s) => { s.hardware['rtx-3060'] = 1 })
    const reason = lockReason(model('flux-dev'), 'native', state, base, CATALOG)
    expect(reason).toBe(
      `Needs 20 GB · your best card has 12 GB · quantize FP8 for ${quantFee(model('flux-dev'), 'fp8', CATALOG)} or buy an RTX 3090`,
    )
  })

  it('skips the quantize hint when no owned card fits even Q4, and reports GPU VRAM not RAM', () => {
    const state = fresh((s) => { s.hardware['pc-8c16t'] = 1; s.hardware['rtx-3060'] = 1 })
    const reason = lockReason(model('minimax-h3'), 'native', state, base, CATALOG)
    expect(reason).toMatch(/^Needs 160 GB · your best card has 12 GB · buy /)
    expect(reason).not.toMatch(/quantize/)
  })

  it('asks for a GPU on a CPU-only rig', () => {
    expect(lockReason(model('sdxl'), 'native', fresh(), base, CATALOG)).toMatch(/Needs a GPU/)
  })

  it('points at ZLUDA for needsZluda models on Radeon', () => {
    const state = fresh((s) => { s.hardware['radeon-pro-w7900'] = 1 })
    expect(lockReason(model('flux2'), 'native', state, base, CATALOG)).toMatch(/ZLUDA/)
    expect(lockReason(model('flux2'), 'native', state, derivedWith({ zluda: true }), CATALOG)).toBeNull()
  })

  it('explains Apple silicon limits', () => {
    const state = fresh((s) => { s.hardware['mac-studio-m4-max'] = 1 })
    expect(lockReason(model('wan22-5b'), 'native', state, base, CATALOG)).toMatch(/images only/)
    expect(lockReason(model('flux-dev'), 'native', state, base, CATALOG)).toMatch(/Apple silicon/)
  })

  it('gates API models on the API Nodes map node only', () => {
    expect(lockReason(model('kling'), 'native', fresh(), base, CATALOG)).toMatch(/API Nodes/)
    expect(lockReason(model('kling'), 'native', fresh(), derivedWith({ apiNodes: true }), CATALOG)).toBeNull()
  })

  it('cheapestPurchasable respects unlocked families', () => {
    expect(cheapestPurchasable(model('flux-schnell'), 'native', base, CATALOG)?.id).toBe('rtx-4070-ti-super')
    const amd = derivedWith({ unlockedFamilies: [...base.unlockedFamilies, 'amd-consumer'] })
    expect(cheapestPurchasable(model('flux-schnell'), 'native', amd, CATALOG)?.id).toBe('rx-7600-xt')
  })

  it('withArticle handles initialisms', () => {
    expect(withArticle('RTX 3090')).toBe('an RTX 3090')
    expect(withArticle('A100 80GB')).toBe('an A100 80GB')
    expect(withArticle('B200')).toBe('a B200')
    expect(withArticle('Mac mini M4')).toBe('a Mac mini M4')
    expect(withArticle('Used RTX 3060 12GB')).toBe('a Used RTX 3060 12GB')
  })
})

describe('genTimeMs', () => {
  const localModels = CATALOG.models.filter((m) => !m.api)
  const cudaUnits = CATALOG.hardware.filter((h) => !h.mps && !h.rocm)

  it('stays within [GEN_TIME_MIN_S, GEN_TIME_MAX_S] at native precision on CUDA and CPU units', () => {
    for (const m of localModels) {
      for (const h of cudaUnits) {
        const ms = genTimeMs(m, 'native', h, base, CATALOG)
        expect(ms, `${m.id} on ${h.id}`).toBeGreaterThanOrEqual(GEN_TIME_MIN_S * 1000)
        expect(ms, `${m.id} on ${h.id}`).toBeLessThanOrEqual(GEN_TIME_MAX_S * 1000)
      }
    }
  })

  it('quotes baseTime at the native tier and scales by tier distance', () => {
    expect(genTimeMs(model('flux-dev'), 'native', hw('rtx-3090'), base, CATALOG)).toBeCloseTo(8000, 6)
    // Office PC (tier 1) is two tiers below the 3060 that sets SD1.5's native tier.
    expect(genTimeMs(model('sd15'), 'native', hw('pc-4c8t'), base, CATALOG)).toBeCloseTo(4 * 1.3 ** 2 * 1000, 6)
    // 4090 is one tier above the 3090.
    expect(genTimeMs(model('flux-dev'), 'native', hw('rtx-4090'), base, CATALOG)).toBeCloseTo(8 * 0.85 * 1000, 6)
  })

  it('FP8 is faster than native and Q4 slower', () => {
    const native = genTimeMs(model('flux-dev'), 'native', hw('rtx-4090'), base, CATALOG)
    expect(genTimeMs(model('flux-dev'), 'fp8', hw('rtx-4090'), base, CATALOG)).toBeLessThan(native)
    expect(genTimeMs(model('flux-dev'), 'q4', hw('rtx-4090'), base, CATALOG)).toBeGreaterThan(native)
  })

  it('cooling raises the effective tier', () => {
    const cooled = derivedWith({ coolingTier: { 'nvidia-consumer': 1 } })
    expect(effectiveTier(hw('rtx-3090'), cooled)).toBe(hw('rtx-3090').speedTier + 1)
    expect(genTimeMs(model('flux-dev'), 'native', hw('rtx-3090'), cooled, CATALOG)).toBeCloseTo(8 * 0.85 * 1000, 6)
  })

  it('taxes MPS ×2 and ROCm ×1.25 after the clamp', () => {
    // Mac mini (tier 2) is one below SD1.5's native 3060 tier, then doubled for MPS.
    expect(genTimeMs(model('sd15'), 'native', hw('mac-mini-m4'), base, CATALOG)).toBeCloseTo(4 * 1.3 * 1000 * MPS_TIME_MULT, 6)
    // RX 7900 XTX sits at the 4090's tier: one above the 3090.
    expect(genTimeMs(model('flux-dev'), 'native', hw('rx-7900-xtx'), base, CATALOG)).toBeCloseTo(8 * 0.85 * 1000 * ROCM_TIME_MULT, 6)
  })

  it('applies speedMult and familyGenTime', () => {
    const d = derivedWith({ speedMult: 0.75, familyGenTime: { flux: 0.7 } })
    expect(genTimeMs(model('flux-dev'), 'native', hw('rtx-3090'), d, CATALOG)).toBeCloseTo(8000 * 0.75 * 0.7, 6)
    expect(genTimeMs(model('sdxl'), 'native', hw('rtx-3090'), d, CATALOG)).toBeCloseTo(
      genTimeMs(model('sdxl'), 'native', hw('rtx-3090'), base, CATALOG) * 0.75,
      6,
    )
  })

  it('API models ignore local hardware entirely', () => {
    const api = derivedWith({ apiNodes: true })
    const onPc = genTimeMs(model('kling'), 'native', hw('pc-4c8t'), api, CATALOG)
    expect(onPc).toBe(model('kling').baseTime * 1000)
    expect(genTimeMs(model('kling'), 'native', hw('h100-80'), api, CATALOG)).toBe(onPc)
    expect(genTimeMs(model('kling'), 'native', hw('mac-mini-m4'), api, CATALOG)).toBe(onPc)
  })
})
