/**
 * Seed Roulette outcomes.
 *
 * A KSampler-themed spin: you wager credits, the seed decides. `weight` is the outcome's
 * probability and the table sums to exactly 1, so `weightedPick` draws from it directly and the
 * expected value is `Σ weight × mult` = 1.038. Something comes back 66 % of the time and 18.8 %
 * of spins turn a profit, which is enough to keep the three-minute cooldown interesting and far
 * too little to be an income source (`gamble.ts` pins the cap with an invariant test).
 */
import type { GambleOutcomeDef } from '@/game/types'

export const GAMBLE_OUTCOMES: GambleOutcomeDef[] = [
  {
    id: 'nan',
    label: 'NaN latent',
    mult: 0,
    weight: 0.34,
    line: 'NaN. Black image. The seed owes you nothing.',
  },
  {
    id: 'half',
    label: 'Half denoised',
    mult: 0.5,
    weight: 0.3,
    line: 'Half denoised. Ship it anyway.',
  },
  {
    id: 'same',
    label: 'Same seed, same image',
    mult: 1,
    weight: 0.172,
    line: 'Same seed, same image. Nothing happened, technically.',
  },
  {
    id: 'clean',
    label: 'Clean sample',
    mult: 2,
    weight: 0.12,
    line: 'Clean sample. Frame it.',
  },
  {
    id: 'batch',
    label: 'Batch of four',
    mult: 4,
    weight: 0.05,
    line: 'Batch of four and every one landed.',
  },
  {
    id: 'golden',
    label: 'Golden seed',
    mult: 10,
    weight: 0.015,
    line: 'Golden seed. Write it down.',
  },
  {
    id: 's42',
    label: 'Seed 42',
    mult: 42,
    weight: 0.003,
    line: 'Seed 42. It was always 42.',
  },
]
