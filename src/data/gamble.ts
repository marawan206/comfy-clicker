/**
 * The wheel's segments, in the Latent Lounge.
 *
 * You bet credits, the sampler decides. `weight` is the outcome's probability and the table sums
 * to exactly 1, so `weightedPick` draws from it directly and the expected value is
 * `Σ weight × mult` = 0.954. Something comes back 64.5 % of the time and 17.5 % of bets turn a
 * profit.
 *
 * The table pays back less than it takes, and that is the whole reason there is no cooldown: a
 * player may bet anything, as often as they like, because grinding the wheel is a slow way to go
 * broke rather than a way to farm credits. The pity reroll and the hot sampler push the real
 * return back up toward 0.98, the 2 % pot skim is minted on top of that, and `gamble.test.ts`
 * pins the whole lot under break-even. If a future table crosses 1, the Lounge has become an
 * income source and the change is wrong.
 */
import type { GambleOutcomeDef } from '@/game/types'

export const GAMBLE_OUTCOMES: GambleOutcomeDef[] = [
  {
    id: 'nan',
    label: 'NaN latent',
    mult: 0,
    weight: 0.355,
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
    weight: 0.17,
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
    weight: 0.042,
    line: 'Batch of four and every one landed.',
  },
  {
    id: 'golden',
    label: 'Golden seed',
    mult: 10,
    weight: 0.01,
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
