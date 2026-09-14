/**
 * The Latent Lounge: two bets, one bank.
 *
 * **The wheel** is the KSampler spin. You stake credits, the seed decides, and the table in
 * `src/data/gamble.ts` pays back 0.954 on the credit before the pity reroll and the hot sampler
 * push it to roughly 0.98.
 *
 * **The coin** is one flip against the house. Your side pays COIN_PAYOUT, Comfy's side takes the
 * stake, and your side lands COIN_WIN_CHANCE of the time. Same shape, tighter edge, no memory.
 *
 * There is no cooldown and no ceiling on a wager. That is deliberate and it is only safe because
 * every bet here is below break-even: a player may bet the whole bank as often as they like, and
 * the long run still bends down. The three rules that keep it that way:
 * 1. Both tables pay back less than 1 (`gamble.test.ts` pins it, pot and pity included).
 * 2. The bet is a plain credit amount. No seconds of income, no presets in minutes, no tiers.
 * 3. Payouts move `state.credits` only. See `applySpin`.
 *
 * Pure: no React, no DOM, no `Date.now()`. Every entry point takes `now` and, where it rolls, an
 * `Rng`, so the whole module replays exactly in tests.
 */
import {
  BET_MIN,
  COIN_PAYOUT,
  COIN_WIN_CHANCE,
  FREE_SPIN_MIN,
  FREE_SPIN_SECS,
  LOUNGE_MIN_LEVEL,
  SPIN_HOT_MULT,
  SPIN_HOT_STREAK,
  SPIN_PITY_DRY,
  SPIN_POT_FRACTION,
} from '@/game/constants'
import { dayKey } from '@/game/daily'
import { formatInt } from '@/game/format'
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
/** Raised by a coin that lands on your side five times running. Hidden achievement `coin-five`. */
export const COIN_STREAK_FLAG = 'coinFive'
/** Coin wins in a row that raise the flag. */
export const COIN_STREAK_TARGET = 5

/** Which side of the coin came up. */
export type CoinSide = 'you' | 'comfy'

/** The losing segment: a zero multiplier eats the wager and feeds the pity meter. */
const isLoss = (o: GambleOutcomeDef): boolean => !(o.mult > 0)
/** A "win" for the hot sampler: x2 or better. x1 (`same`) breaks the streak like a loss does. */
const isWin = (o: GambleOutcomeDef): boolean => o.mult >= 2

export type BetCheck =
  | { ok: true; stake: number; free: boolean }
  | { ok: false; reason: string }

/** Income per second, floored at 0, so a broken `Derived` cannot produce a negative free stake. */
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

/** Expected payout multiplier of one coin flip. Printed in the modal next to the button. */
export function coinEv(): number {
  return COIN_WIN_CHANCE * COIN_PAYOUT
}

/**
 * Bet bounds in credits: BET_MIN up to the whole bank. Both games use them, the slider tracks
 * them, and `max` below `min` means the player cannot cover the smallest bet on the table.
 */
export function betBounds(state: GameState): { min: number; max: number } {
  const bank = Number.isFinite(state.credits) ? Math.max(0, Math.floor(state.credits)) : 0
  return { min: BET_MIN, max: bank }
}

/** House stake on the daily free spin: 2 minutes of income, never below FREE_SPIN_MIN. */
export function freeStake(derived: Derived): number {
  return Math.max(FREE_SPIN_MIN, Math.round(FREE_SPIN_SECS * safeCps(derived)))
}

/**
 * Whether today's free spin is still there. Days are UTC calendar days (`dayKey`), the same clock
 * the daily reward uses. This asks only about the day; the level gate lives in `canBet`.
 */
export function freeSpinAvailable(state: GameState, now: number): boolean {
  return state.gamble.freeSpinDay !== dayKey(now)
}

/** True once `winStreak` has reached SPIN_HOT_STREAK: the next wheel payout is multiplied by x1.5. */
export function isHot(state: GameState): boolean {
  return state.gamble.winStreak >= SPIN_HOT_STREAK
}

/** True once `dryStreak` has reached SPIN_PITY_DRY: the next losing roll is converted. */
export function pityDue(state: GameState): boolean {
  return state.gamble.dryStreak >= SPIN_PITY_DRY
}

/**
 * Validate a bet. `wager` is a credit amount, or `'free'` for the daily house spin (the wheel
 * only). The order of the checks is the order of the copy: the gate, then the day, then the
 * floor, then the balance.
 */
export function canBet(
  state: GameState,
  derived: Derived,
  now: number,
  wager: number | 'free',
): BetCheck {
  if (playerLevel(state) < LOUNGE_MIN_LEVEL) {
    return { ok: false, reason: `Unlocks at level ${LOUNGE_MIN_LEVEL}` }
  }

  if (wager === 'free') {
    if (!freeSpinAvailable(state, now)) return { ok: false, reason: 'Free spin already used today' }
    return { ok: true, stake: freeStake(derived), free: true }
  }

  const { min } = betBounds(state)
  const stake = Number.isFinite(wager) ? Math.floor(wager) : 0
  if (stake < min) return { ok: false, reason: `Bet at least ${formatInt(min)} credits` }
  if (stake > state.credits) return { ok: false, reason: 'Not enough credits' }

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
 * Spin the wheel. Returns exactly one `spin` event, or none when the bet is not legal (the action
 * layer calls `canBet` first for the message; this re-check only keeps the engine honest).
 *
 * **Payouts move `state.credits` and nothing else.** This looks like a missing line next to every
 * other credit path in the engine, and it is deliberate: `lifetimeCredits` feeds XP and so the
 * player level, and `seasonCredits` feeds prestige and the leaderboard. Crediting either here
 * would turn the Lounge into an XP farm and let a lucky seed buy a leaderboard rank, so a bet
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
  const check = canBet(state, derived, now, wager)
  if (!check.ok) return []
  if (catalog.gamble.length === 0) return []

  const { stake, free } = check
  const g = state.gamble

  if (free) {
    // The house is paying, so the stake is never deducted.
    g.freeSpinDay = dayKey(now)
  } else {
    state.credits -= stake
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

/**
 * Flip the coin. Your side pays COIN_PAYOUT × the stake, Comfy's side keeps it, and there is no
 * free flip: the coin is the simple bet, so it has no pity meter, no streak bonus and no pot.
 * `coinStreak` is bookkeeping for one hidden achievement and pays nothing by itself.
 *
 * Same rule as the wheel: `state.credits` and nothing else.
 */
export function applyFlip(
  state: GameState,
  derived: Derived,
  now: number,
  rng: Rng,
  wager: number,
): GameEvent[] {
  const check = canBet(state, derived, now, wager)
  if (!check.ok || check.free) return []

  const { stake } = check
  const g = state.gamble
  state.credits -= stake
  g.pot += Math.round(SPIN_POT_FRACTION * stake)

  const win = rng() < COIN_WIN_CHANCE
  const side: CoinSide = win ? 'you' : 'comfy'
  const payout = win ? Math.round(stake * COIN_PAYOUT) : 0
  if (payout > 0) state.credits += payout

  if (win) {
    g.coinStreak += 1
    if (g.coinStreak >= COIN_STREAK_TARGET) state.flags[COIN_STREAK_FLAG] = true
  } else {
    g.coinStreak = 0
  }

  state.stats.flips += 1
  state.stats.spinNet += payout - stake

  return [{ type: 'flip', side, wager: stake, payout, streak: g.coinStreak }]
}
