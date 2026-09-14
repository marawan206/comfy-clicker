/**
 * The click combo: consecutive accepted clicks no more than `COMBO_GAP_MS` apart. The streak's
 * length picks a tier from `COMBO_TIERS`, and the tier's multiplier is applied to the click value
 * by `click` (actions.ts), so a hand that keeps going earns more per press until it stops.
 *
 * The streak itself is session bookkeeping, not save data: a reload starts at zero, so it lives
 * in a `WeakMap` side table, the same pattern as the click guard's window. The one thing that
 * persists is `stats.bestCombo`, the longest streak ever, which the two combo achievements read.
 *
 * Pure: no React, no DOM, no `Date.now()`. The caller supplies `now`.
 */
import { COMBO_GAP_MS, COMBO_TIERS } from '@/game/constants'
import type { GameState } from '@/game/types'

interface Streak {
  count: number
  lastAt: number
}

const MEMO = new WeakMap<GameState, Streak>()

/** Tier index for a streak of `count` clicks: 0 below the first tier, `COMBO_TIERS.length` at the top. */
export function comboTier(count: number): number {
  let tier = 0
  for (const t of COMBO_TIERS) if (count >= t.at) tier++
  return tier
}

/** Click multiplier for a streak: 1 below the first tier, the reached tier's `mult` from then on. */
export function comboMult(count: number): number {
  const tier = comboTier(count)
  if (tier === 0) return 1
  return COMBO_TIERS[tier - 1]?.mult ?? 1
}

/** True when `count` sits exactly on a tier threshold: the click that raised the multiplier. */
export function isComboTierUp(count: number): boolean {
  return COMBO_TIERS.some((t) => t.at === count)
}

/** The next tier above `count`, or null at the top. */
export function nextComboTier(count: number): { at: number; mult: number } | null {
  for (const t of COMBO_TIERS) if (count < t.at) return t
  return null
}

/** The streak as it stands at `now`, without touching it: 0 once the gap has passed. */
export function comboCount(state: GameState, now: number): number {
  const s = MEMO.get(state)
  if (!s || now < s.lastAt || now - s.lastAt > COMBO_GAP_MS) return 0
  return s.count
}

/**
 * Count an accepted click into the streak and return its new length, 1 when the streak restarts.
 * A clock that stepped backwards restarts it too. Keeps `stats.bestCombo` up to date.
 */
export function advanceCombo(state: GameState, now: number): number {
  const s = MEMO.get(state)
  const count = s && now >= s.lastAt && now - s.lastAt <= COMBO_GAP_MS ? s.count + 1 : 1
  MEMO.set(state, { count, lastAt: now })
  if (count > state.stats.bestCombo) state.stats.bestCombo = count
  return count
}

/** Forget the streak. For tests and for replacing a state wholesale; the gap ends it on its own. */
export function resetCombo(state: GameState): void {
  MEMO.delete(state)
}
