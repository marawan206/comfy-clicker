/**
 * Seed Roulette: the KSampler spin.
 *
 * You wager credits, the seed decides. The table in `src/data/gamble.ts` has an expected value of
 * 1.038, so a spin is worth taking and nowhere near worth grinding: with one paid spin every three
 * minutes and a wager capped at five minutes of income, the whole system can add at most a couple
 * of percent to an hour of income (`gamble.test.ts` pins that with an invariant).
 *
 * Three rules keep it from being farmable.
 * 1. The cooldown is a single timestamp in the save (`gamble.nextSpinAt`), so closing the tab,
 *    reloading or sleeping for eight hours all yield exactly one ready spin, never a backlog.
 * 2. The wager is priced in seconds of income, so it scales with the rig instead of with patience.
 * 3. Payouts move `state.credits` only. See `applySpin`.
 *
 * Pure: no React, no DOM, no `Date.now()`. Every entry point takes `now` and, where it rolls, an
 * `Rng`, so the whole module replays exactly in tests.
 */
import {
  SPIN_COOLDOWN_MS,
  SPIN_FREE_MIN,
  SPIN_FREE_SECS,
  SPIN_HOT_MULT,
  SPIN_HOT_STREAK,
  SPIN_MAX_SECS,
  SPIN_MIN_LEVEL,
  SPIN_MIN_SECS,
  SPIN_MIN_WAGER,
  SPIN_PITY_DRY,
  SPIN_POT_FRACTION,
} from '@/game/constants'
import { dayKey } from '@/game/daily'
import { formatDuration, formatInt } from '@/game/format'
import { playerLevel } from '@/game/level'
import { weightedPick } from '@/game/rng'
import type { Catalog, Derived, GambleOutcomeDef, GameEvent, GameState, Rng } from '@/game/types'

/** The segment that takes the pot. The one id the engine knows by name; see `applySpin`. */
export const JACKPOT_OUTCOME_ID = 's42'
/** Raised by the x42 seed. Hidden achievement `seed-42-hit`. */
export const JACKPOT_FLAG = 'jackpot42'
/** Raised when the dry streak reaches SPIN_PITY_DRY. Hidden achievement `seed-nan-3`. */
export const NAN_STREAK_FLAG = 'nanStreak3'
/** Raised when the sampler goes hot. Hidden achievement `seed-hot`. */
export const HOT_SEED_FLAG = 'hotSeed'

/** The losing segment: a zero multiplier eats the wager and feeds the pity meter. */
const isLoss = (o: GambleOutcomeDef): boolean => !(o.mult > 0)
/** A "win" for the hot sampler: x2 or better. x1 (`same`) breaks the streak like a loss does. */
const isWin = (o: GambleOutcomeDef): boolean => o.mult >= 2

export type SpinCheck =
  | { ok: true; stake: number; free: boolean }
  | { ok: false; reason: string }

/** Income per second, floored at 0, so a broken `Derived` cannot produce a negative wager. */
function safeCps(derived: Derived): number {
  return Number.isFinite(derived.cps) && derived.cps > 0 ? derived.cps : 0
}

/**
 * Expected payout multiplier of a table, `Σ weight × mult` normalised by the total weight.
 * The shipped table sums to exactly 1, so this is the plain weighted mean; the division only
 * keeps small test fixtures honest. Returns 0 for an empty or weightless table.
 */
export function spinEv(outcomes: readonly GambleOutcomeDef[]): number {
  let weight = 0
  let sum = 0
  for (const o of outcomes) {
    if (!(Number.isFinite(o.weight) && o.weight > 0)) continue
    weight += o.weight
    sum += o.weight * (Number.isFinite(o.mult) ? o.mult : 0)
  }
  return weight > 0 ? sum / weight : 0
}

/**
 * Wager bounds in credits. Both ends are seconds of income, so the bet stays meaningful as the rig
 * grows: `min` is 30 seconds (never below SPIN_MIN_WAGER), `max` is 5 minutes, capped by the
 * credits actually on hand. `max` can fall below `min` when the player is broke; `canSpin` reports
 * that as "Not enough credits" rather than as a bound.
 */
export function wagerBounds(state: GameState, derived: Derived): { min: number; max: number } {
  const cps = safeCps(derived)
  const min = Math.max(SPIN_MIN_WAGER, Math.round(SPIN_MIN_SECS * cps))
  const affordable = Number.isFinite(state.credits) ? Math.max(0, Math.floor(state.credits)) : 0
  const max = Math.min(affordable, Math.max(min, Math.round(SPIN_MAX_SECS * cps)))
  return { min, max }
}

/** House stake on the daily free spin: 2 minutes of income, never below SPIN_FREE_MIN. */
export function freeStake(derived: Derived): number {
  return Math.max(SPIN_FREE_MIN, Math.round(SPIN_FREE_SECS * safeCps(derived)))
}

/**
 * Whether today's free spin is still there. Days are UTC calendar days (`dayKey`), the same clock
 * the daily reward uses. This asks only about the day; the level gate lives in `canSpin`.
 */
export function freeSpinAvailable(state: GameState, now: number): boolean {
  return state.gamble.freeSpinDay !== dayKey(now)
}

/** Milliseconds left on the paid cooldown, 0 when a spin is ready. */
export function msUntilSpin(state: GameState, now: number): number {
  const next = state.gamble.nextSpinAt
  if (!Number.isFinite(next)) return 0
  return Math.max(0, next - now)
}

/** True once `winStreak` has reached SPIN_HOT_STREAK: the next payout is multiplied by x1.5. */
export function isHot(state: GameState): boolean {
  return state.gamble.winStreak >= SPIN_HOT_STREAK
}

/** True once `dryStreak` has reached SPIN_PITY_DRY: the next losing roll is converted. */
export function pityDue(state: GameState): boolean {
  return state.gamble.dryStreak >= SPIN_PITY_DRY
}

/**
 * Validate a spin. `wager` is a credit amount, or `'free'` for the daily house spin.
 *
 * The order of the checks is the order of the copy: the gate, then the day or the cooldown, then
 * the floor, then the balance, then the ceiling. Checking the balance before the ceiling matters,
 * because `wagerBounds().max` is already capped by the balance: without it a broke player would be
 * told to bet less rather than told they cannot afford it.
 */
export function canSpin(
  state: GameState,
  derived: Derived,
  now: number,
  wager: number | 'free',
): SpinCheck {
  if (playerLevel(state) < SPIN_MIN_LEVEL) {
    return { ok: false, reason: `Unlocks at level ${SPIN_MIN_LEVEL}` }
  }

  if (wager === 'free') {
    if (!freeSpinAvailable(state, now)) return { ok: false, reason: 'Free spin already used today' }
    return { ok: true, stake: freeStake(derived), free: true }
  }

  const left = msUntilSpin(state, now)
  if (left > 0) {
    return { ok: false, reason: `Sampler is cooling down · ${formatDuration(Math.ceil(left / 1000))}` }
  }

  const { min, max } = wagerBounds(state, derived)
  const stake = Number.isFinite(wager) ? Math.floor(wager) : 0
  if (stake < min) return { ok: false, reason: `Bet at least ${formatInt(min)} credits` }
  if (stake > state.credits) return { ok: false, reason: 'Not enough credits' }
  if (stake > max) return { ok: false, reason: `Bet at most ${formatInt(max)} credits right now` }

  return { ok: true, stake, free: false }
}

/**
 * Draw one segment. With `pity` the losing segment is converted once into the cheapest winning one
 * (`half` on the shipped table), which is what the third pip on the denoise meter promises. The
 * draw itself still happens, so the rng sequence is the same either way.
 */
export function rollOutcome(
  outcomes: readonly GambleOutcomeDef[],
  rng: Rng,
  pity: boolean,
): GambleOutcomeDef {
  const rolled = weightedPick(rng, outcomes)
  if (!pity || !isLoss(rolled)) return rolled

  let consolation: GambleOutcomeDef | undefined
  for (const o of outcomes) {
    if (isLoss(o)) continue
    if (!consolation || o.mult < consolation.mult) consolation = o
  }
  return consolation ?? rolled
}

/**
 * Take a spin. Returns exactly one `spin` event, or none when the spin is not legal (the action
 * layer calls `canSpin` first for the message; this re-check only keeps the engine honest).
 *
 * **Payouts move `state.credits` and nothing else.** This looks like a missing line next to every
 * other credit path in the engine, and it is deliberate: `lifetimeCredits` feeds XP and so the
 * player level, and `seasonCredits` feeds prestige and the leaderboard. Crediting either here
 * would turn the roulette into an XP farm and let a lucky seed buy a leaderboard rank, so a spin
 * moves the spendable balance only. Do not "fix" it.
 */
export function applySpin(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  now: number,
  rng: Rng,
  wager: number | 'free',
): GameEvent[] {
  const check = canSpin(state, derived, now, wager)
  if (!check.ok) return []
  if (catalog.gamble.length === 0) return []

  const { stake, free } = check
  const g = state.gamble

  if (free) {
    // The house is paying, so the stake is never deducted and the paid cooldown is untouched.
    g.freeSpinDay = dayKey(now)
  } else {
    state.credits -= stake
    g.nextSpinAt = now + SPIN_COOLDOWN_MS
    g.pot += Math.round(SPIN_POT_FRACTION * stake)
  }

  const hot = isHot(state)
  const outcome = rollOutcome(catalog.gamble, rng, pityDue(state))
  let payout = Math.round(stake * outcome.mult * (hot ? SPIN_HOT_MULT : 1))

  // The x42 seed takes the pot with it, this spin's own contribution included.
  const jackpot = outcome.id === JACKPOT_OUTCOME_ID
  if (jackpot && g.pot > 0) {
    payout += g.pot
    g.pot = 0
  }

  if (payout > 0) state.credits += payout

  if (isLoss(outcome)) {
    g.dryStreak += 1
    g.winStreak = 0
    if (g.dryStreak >= SPIN_PITY_DRY) state.flags[NAN_STREAK_FLAG] = true
  } else {
    g.dryStreak = 0
    if (isWin(outcome)) {
      g.winStreak += 1
      if (g.winStreak >= SPIN_HOT_STREAK) state.flags[HOT_SEED_FLAG] = true
    } else {
      g.winStreak = 0
    }
  }
  if (jackpot) state.flags[JACKPOT_FLAG] = true

  state.stats.spins += 1
  state.stats.spinNet += payout - (free ? 0 : stake)

  return [
    {
      type: 'spin',
      outcome: outcome.id,
      // The segment's printed multiplier, not the paid one: `hot` and `payout` carry the x1.5.
      mult: outcome.mult,
      wager: stake,
      payout,
      free,
      hot,
    },
  ]
}
