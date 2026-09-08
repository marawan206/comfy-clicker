import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import { SETUP_FEE_MULT } from '@/game/constants'
import {
  applyQuantize,
  backendAllows,
  canQuantize,
  fitsNatively,
  hasPrecision,
  nativeHardware,
  QUANT_NODE_IDS,
  quantFee,
  quantizeOptions,
  requiredVram,
  setupFee,
} from '@/game/quantize'
import { createInitialState } from '@/game/state'
import type { Derived, GameState, HardwareDef, ModelDef } from '@/game/types'

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

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = createInitialState(0, 'guest')
  mutate?.(s)
  return s
}

const derivedWithVram = (bestVram: number): Derived => ({ bestVram }) as Derived

describe('nativeHardware', () => {
  it('is the cheapest CUDA card that holds the native weights', () => {
    expect(nativeHardware(model('flux-dev'), CATALOG)?.id).toBe('rtx-3090')
    expect(nativeHardware(model('sd15'), CATALOG)?.id).toBe('rtx-3060')
    expect(nativeHardware(model('sd35-medium'), CATALOG)?.id).toBe('rtx-3060')
    expect(nativeHardware(model('wan22-14b'), CATALOG)?.id).toBe('rtx-pro-6000')
  })

  it('never picks a CPU box, Apple silicon or a Radeon, even when cheaper', () => {
    expect(nativeHardware(model('sd15'), CATALOG)?.cpuOnly).toBeUndefined()
    expect(fitsNatively(model('sdxl'), hw('mac-mini-m4'))).toBe(false)
    expect(fitsNatively(model('flux-schnell'), hw('rx-7600-xt'))).toBe(false)
    expect(fitsNatively(model('flux2'), hw('radeon-pro-w7900'))).toBe(false)
    expect(nativeHardware(model('flux2'), CATALOG)?.id).toBe('rtx-a6000')
  })

  it('is null for API models and empty fixtures', () => {
    expect(nativeHardware(model('kling'), CATALOG)).toBeNull()
    expect(nativeHardware(model('flux-dev'), createCatalog())).toBeNull()
  })

  it('backendAllows encodes the CPU / MPS / ROCm rules', () => {
    expect(backendAllows(model('sd15'), hw('pc-4c8t'))).toBe(true)
    expect(backendAllows(model('sdxl'), hw('pc-4c8t'))).toBe(false)
    expect(backendAllows(model('sdxl'), hw('mac-mini-m4'))).toBe(true)
    expect(backendAllows(model('wan22-5b'), hw('mac-mini-m4'))).toBe(false)
    expect(backendAllows(model('flux2'), hw('rx-7900-xtx'))).toBe(false)
    expect(backendAllows(model('flux2'), hw('rx-7900-xtx'), true)).toBe(true)
    expect(backendAllows(model('flux2'), hw('rtx-4090'))).toBe(true)
  })

  it('requiredVram scales by the precision multiplier', () => {
    expect(requiredVram(model('flux-dev'), 'native', CATALOG)).toBe(20)
    expect(requiredVram(model('flux-dev'), 'fp8', CATALOG)).toBe(10)
    expect(requiredVram(model('flux-dev'), 'q4', CATALOG)).toBeCloseTo(6, 9)
  })
})

describe('quantFee', () => {
  it('charges FLUX Dev FP8 at 450 (feeFraction × native rig cost)', () => {
    const rig = nativeHardware(model('flux-dev'), CATALOG)!
    expect(quantFee(model('flux-dev'), 'fp8', CATALOG)).toBe(450)
    expect(quantFee(model('flux-dev'), 'fp8', CATALOG)).toBe(Math.round(CATALOG.precisions.fp8.feeFraction * rig.baseCost))
    expect(quantFee(model('flux-dev'), 'q4', CATALOG)).toBe(Math.round(CATALOG.precisions.q4.feeFraction * rig.baseCost))
  })

  it('is free at native precision and for models without a native rig', () => {
    expect(quantFee(model('flux-dev'), 'native', CATALOG)).toBe(0)
    expect(quantFee(model('kling'), 'fp8', CATALOG)).toBe(0)
  })

  it('rounds to whole credits', () => {
    for (const m of CATALOG.models) {
      for (const p of ['fp8', 'q4'] as const) expect(Number.isInteger(quantFee(m, p, CATALOG)), m.id).toBe(true)
    }
  })
})

describe('setupFee', () => {
  it('is 0 when the best owned VRAM holds the model, else SETUP_FEE_MULT × baseCost', () => {
    expect(setupFee(model('flux-dev'), derivedWithVram(24), CATALOG)).toBe(0)
    expect(setupFee(model('flux-dev'), derivedWithVram(20), CATALOG)).toBe(0)
    expect(setupFee(model('flux-dev'), derivedWithVram(12), CATALOG)).toBe(SETUP_FEE_MULT * model('flux-dev').baseCost)
  })

  it('never charges API models', () => {
    expect(setupFee(model('kling'), derivedWithVram(0), CATALOG)).toBe(0)
  })
})

describe('canQuantize', () => {
  const owned = (s: GameState) => { s.models['flux-dev'] = { precisions: ['native'], setup: true }; s.credits = 1e6 }

  it('rejects native, API and non-quantizable models', () => {
    const state = fresh(owned)
    expect(canQuantize(model('flux-dev'), 'native', state, CATALOG).ok).toBe(false)
    expect(canQuantize(model('kling'), 'fp8', state, CATALOG).ok).toBe(false)
    expect(canQuantize(model('sd15'), 'fp8', state, CATALOG).reason).toMatch(/can't be quantized/)
  })

  it('requires owning the model', () => {
    const state = fresh((s) => { s.credits = 1e6 })
    expect(canQuantize(model('flux-dev'), 'fp8', state, CATALOG).reason).toMatch(/Set up/)
  })

  it('gates each tier on its map node when the catalog ships it', () => {
    const state = fresh(owned)
    const gated = canQuantize(model('flux-dev'), 'fp8', state, CATALOG)
    expect(gated.ok).toBe(false)
    expect(gated.reason).toMatch(/on the Graph/)
    state.mapNodes.push(QUANT_NODE_IDS.fp8)
    expect(canQuantize(model('flux-dev'), 'fp8', state, CATALOG)).toEqual({ ok: true })
    expect(canQuantize(model('flux-dev'), 'q4', state, CATALOG).ok).toBe(false)
    state.mapNodes.push(QUANT_NODE_IDS.q4)
    expect(canQuantize(model('flux-dev'), 'q4', state, CATALOG).ok).toBe(true)
  })

  it('does not gate on nodes a fixture catalog lacks', () => {
    const catalog = createCatalog({ hardware: [hw('rtx-3090')], models: [model('flux-dev')] })
    expect(canQuantize(model('flux-dev'), 'fp8', fresh(owned), catalog)).toEqual({ ok: true })
  })

  it('checks credits against the fee and refuses repeats', () => {
    const state = fresh((s) => { owned(s); s.mapNodes.push(QUANT_NODE_IDS.fp8); s.credits = 449 })
    expect(canQuantize(model('flux-dev'), 'fp8', state, CATALOG).reason).toMatch(/Need 450 credits/)
    state.credits = 450
    expect(canQuantize(model('flux-dev'), 'fp8', state, CATALOG).ok).toBe(true)
    state.models['flux-dev']!.precisions.push('fp8')
    expect(canQuantize(model('flux-dev'), 'fp8', state, CATALOG).reason).toMatch(/Already/)
  })
})

describe('applyQuantize', () => {
  it('deducts the fee, unlocks the tier and counts the quantization once', () => {
    const state = fresh((s) => { s.models['flux-dev'] = { precisions: ['native'], setup: true }; s.credits = 1000 })
    applyQuantize(state, 'flux-dev', 'fp8', 450)
    expect(state.credits).toBe(550)
    expect(hasPrecision(state, 'flux-dev', 'fp8')).toBe(true)
    expect(state.stats.quantizations).toBe(1)
    applyQuantize(state, 'flux-dev', 'fp8', 0)
    expect(state.models['flux-dev']!.precisions).toEqual(['native', 'fp8'])
    expect(state.stats.quantizations).toBe(1)
  })

  it('creates a not-yet-set-up entry when the model is missing', () => {
    const state = fresh((s) => { s.credits = 100 })
    applyQuantize(state, 'sdxl', 'q4', 40)
    expect(state.models.sdxl).toEqual({ precisions: ['native', 'q4'], setup: false })
    expect(state.credits).toBe(60)
  })
})

describe('quantizeOptions', () => {
  it('lists both tiers with fee, ownership and availability', () => {
    const state = fresh((s) => {
      s.models['flux-dev'] = { precisions: ['native', 'fp8'], setup: true }
      s.mapNodes.push(QUANT_NODE_IDS.fp8, QUANT_NODE_IDS.q4)
      s.credits = 1e6
    })
    const options = quantizeOptions(model('flux-dev'), state, CATALOG)
    expect(options.map((o) => o.precision)).toEqual(['fp8', 'q4'])
    expect(options[0]).toMatchObject({ label: 'FP8', fee: 450, owned: true, ok: false })
    expect(options[1]).toMatchObject({ label: 'Q4 GGUF', fee: 300, owned: false, ok: true })
    expect(options[1]!.reason).toBeUndefined()
  })
})
