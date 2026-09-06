/**
 * Precision tiers a model can be quantized to.
 *
 * `vramMult` scales the model's native VRAM requirement (FP8 ≈ half the weights, Q4 GGUF ≈ a
 * third). Quantizing trades likes (`qualityMult`) for cheaper jobs (`costMult`); FP8 is a bit
 * faster on Ada+ while Q4 pays a dequant tax (`timeMult`). `feeFraction` is the one-off
 * quantization fee as a fraction of the model's native rig base cost (see quantize.ts): FP8 is
 * the premium conversion (0.375 × a 1 200-credit rig = the contract's "quantize FP8 for 450"),
 * Q4 GGUF the budget route.
 */
import type { Precision, PrecisionDef } from '@/game/types'

export const PRECISIONS: Record<Precision, PrecisionDef> = {
  native: {
    id: 'native',
    label: 'Native',
    vramMult: 1,
    qualityMult: 1,
    costMult: 1,
    timeMult: 1,
    feeFraction: 0,
  },
  fp8: {
    id: 'fp8',
    label: 'FP8',
    vramMult: 0.5,
    qualityMult: 0.92,
    costMult: 0.85,
    timeMult: 0.9,
    feeFraction: 0.375,
  },
  q4: {
    id: 'q4',
    label: 'Q4 GGUF',
    vramMult: 0.3,
    qualityMult: 0.8,
    costMult: 0.7,
    timeMult: 1.15,
    feeFraction: 0.25,
  },
}

/** Display order, heaviest first. */
export const PRECISION_ORDER: readonly Precision[] = ['native', 'fp8', 'q4']
