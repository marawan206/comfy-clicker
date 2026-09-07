/**
 * Quantization and model setup fees.
 *
 * A model's "native rig" is the cheapest CUDA card that holds its full-precision weights; the
 * one-off quantization fee is a fraction of that rig's price (FP8 costs more than Q4 GGUF, see
 * src/data/precisions.ts). Setting up a model your best card can't hold costs a --lowvram tax.
 *
 * This module is the leaf of the model-runnability stack: `backendAllows` is the single source
 * of truth for backend rules (CPU / MPS / ROCm) and hardware.ts builds `runsOn` on top of it.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { SETUP_FEE_MULT } from '@/game/constants'
import { formatNum } from '@/game/format'
import type { Derived, GameState, HardwareDef, ModelDef, Precision } from '@/game/types'

/** Map nodes that gate each quantization tier. Only enforced when the catalog ships the node. */
export const QUANT_NODE_IDS: Record<Exclude<Precision, 'native'>, string> = {
  fp8: 'quant-fp8',
  q4: 'quant-q4',
}

/**
 * Backend constraints only (VRAM is checked separately):
 *  - CPU boxes run only `cpuOk` models
 *  - Apple silicon (MPS) runs only `mpsOk` image models
 *  - AMD (ROCm) runs `rocmOk` models and anything that doesn't need ZLUDA, or everything once
 *    ZLUDA is unlocked
 */
export function backendAllows(model: ModelDef, hw: HardwareDef, zluda = false): boolean {
  if (hw.cpuOnly) return model.cpuOk === true
  if (hw.mps) return model.mpsOk === true && model.kind === 'image'
  if (hw.rocm) return model.rocmOk === true || !model.needsZluda || zluda
  return true
}

/** VRAM (GB) a model needs at a precision: `vram × vramMult`. */
export function requiredVram(model: ModelDef, precision: Precision, catalog: Catalog): number {
  return model.vram * (catalog.precisions[precision]?.vramMult ?? 1)
}

/**
 * Whether `hw` is a native rig for `model`: a CUDA card (not CPU-only, not the MPS/ROCm backends
 * that genTimeMs taxes as non-native) that holds the full-precision weights. API models have no
 * native rig. This is what quantization fees and `baseTime` are quoted against.
 */
export function fitsNatively(model: ModelDef, hw: HardwareDef): boolean {
  if (model.api || hw.cpuOnly || hw.mps || hw.rocm) return false
  return hw.vram >= model.vram
}

/** Cheapest native rig (see `fitsNatively`) for the model, or null (API models, fixtures). */
export function nativeHardware(model: ModelDef, catalog: Catalog): HardwareDef | null {
  let best: HardwareDef | null = null
  for (const hw of catalog.hardware) {
    if (fitsNatively(model, hw) && (!best || hw.baseCost < best.baseCost)) best = hw
  }
  return best
}

/**
 * One-off fee to quantize `model` to `precision`: `round(feeFraction × nativeHardware.baseCost)`.
 * Native precision (fraction 0) and models with no native rig are free.
 */
export function quantFee(model: ModelDef, precision: Precision, catalog: Catalog): number {
  const fraction = catalog.precisions[precision]?.feeFraction ?? 0
  if (fraction <= 0) return 0
  const rig = nativeHardware(model, catalog)
  return rig ? Math.round(fraction * rig.baseCost) : 0
}

export function hasPrecision(state: GameState, modelId: string, precision: Precision): boolean {
  return state.models[modelId]?.precisions.includes(precision) ?? false
}

export interface QuantizeCheck {
  ok: boolean
  reason?: string
}

/**
 * Can the player quantize `model` to `precision` right now? Requires a quantizable local model
 * the player owns, a tier not yet unlocked, the tier's map node (when the catalog has one) and
 * the fee in credits. Same `{ ok, reason }` shape as hardware.ts `canBuy`.
 */
export function canQuantize(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  catalog: Catalog,
): QuantizeCheck {
  if (precision === 'native') return { ok: false, reason: 'Already at native precision' }
  const label = catalog.precisions[precision]?.label ?? precision
  if (model.api) return { ok: false, reason: `${model.name} runs on someone else's GPU · nothing to quantize` }
  if (model.quantizable === false) return { ok: false, reason: `${model.name} can't be quantized` }
  if (!(model.id in state.models)) return { ok: false, reason: `Set up ${model.name} first` }
  if (hasPrecision(state, model.id, precision)) return { ok: false, reason: `Already quantized to ${label}` }
  const gate = buildIndex(catalog).mapNodeById[QUANT_NODE_IDS[precision]]
  if (gate && !state.mapNodes.includes(gate.id)) {
    return { ok: false, reason: `Unlock ${gate.title} on the Graph` }
  }
  const fee = quantFee(model, precision, catalog)
  if (state.credits < fee) {
    return { ok: false, reason: `Need ${formatNum(fee)} credits · have ${formatNum(state.credits)}` }
  }
  return { ok: true }
}

/**
 * Pay `fee` and unlock `precision` on the model. Creates the model entry (not set up) if it is
 * somehow missing. Bumps `stats.quantizations` only when the tier is new, so callers must not.
 * Validate with `canQuantize` first; this does not re-check.
 */
export function applyQuantize(state: GameState, modelId: string, precision: Precision, fee: number): void {
  let entry = state.models[modelId]
  if (!entry) {
    entry = { precisions: ['native'], setup: false }
    state.models[modelId] = entry
  }
  state.credits -= fee
  if (entry.precisions.includes(precision)) return
  entry.precisions.push(precision)
  state.stats.quantizations += 1
}

/**
 * Setup fee for a model: free when the best owned card holds the native weights, otherwise
 * `SETUP_FEE_MULT × baseCost` (the --lowvram, offload-everything tax).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- contract signature; reserved for per-precision pricing
export function setupFee(model: ModelDef, derived: Derived, _catalog: Catalog): number {
  return model.vram > derived.bestVram ? SETUP_FEE_MULT * model.baseCost : 0
}

export interface QuantizeOption {
  precision: Exclude<Precision, 'native'>
  label: string
  fee: number
  owned: boolean
  ok: boolean
  reason?: string
}

/** Every quantization tier for a model with its fee and availability, for the model card. */
export function quantizeOptions(model: ModelDef, state: GameState, catalog: Catalog): QuantizeOption[] {
  const tiers: Array<Exclude<Precision, 'native'>> = ['fp8', 'q4']
  return tiers.map((precision) => {
    const check = canQuantize(model, precision, state, catalog)
    const option: QuantizeOption = {
      precision,
      label: catalog.precisions[precision]?.label ?? precision,
      fee: quantFee(model, precision, catalog),
      owned: hasPrecision(state, model.id, precision),
      ok: check.ok,
    }
    if (check.reason !== undefined) option.reason = check.reason
    return option
  })
}
