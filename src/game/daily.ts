/**
 * Daily login reward. Days are UTC calendar days; the streak continues when the last claim was
 * yesterday (or the day before, with the `streakGrace` effect), otherwise it restarts at 1.
 * Rewards cycle over DAILY_CYCLE_DAYS days: day n pays n × DAILY_BASE_SECS of income (floored at
 * DAILY_MIN_CREDITS) and `dailyXp(n)` of XP, day 3 adds a Research Point and day 7 a Comfy Point.
 */
import { DAILY_BASE_SECS, DAILY_MIN_CREDITS } from '@/game/constants'
import { dailyXp, grantXp } from '@/game/level'
import type { Derived, GameEvent, GameState } from '@/game/types'

export const DAILY_CYCLE_DAYS = 7
export const DAILY_RP_DAY = 3
export const DAILY_CP_DAY = 7
/** Day keys remembered in `daily.claimed`. */
export const DAILY_CLAIMED_KEEP = 7

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` in UTC. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Whole UTC days from day key `a` to day key `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/** Position in the 7-day cycle for a streak length (1 → 1 … 7 → 7, 8 → 1). */
export function cycleDay(streak: number): number {
  return ((Math.max(1, streak) - 1) % DAILY_CYCLE_DAYS) + 1
}

/** Credits for cycle day `day` at the given income. */
export function dailyReward(cps: number, day: number): number {
  return Math.max(DAILY_MIN_CREDITS, Math.round(cps * DAILY_BASE_SECS * day))
}

/**
 * Streak the next claim would extend: 0 when it would restart (or the player never claimed),
 * otherwise the current streak. Also the value the UI should display, since a streak that lapsed
 * yesterday is already gone even though `state.daily.streak` still holds the old number.
 */
export function effectiveStreak(state: GameState, now: number, grace = false): number {
  const last = state.daily.lastClaimDay
  if (!last || state.daily.streak <= 0) return 0
  const gap = daysBetween(last, dayKey(now))
  if (gap === 0 || gap === 1) return state.daily.streak
  if (gap === 2 && grace) return state.daily.streak
  return 0
}

export function canClaim(state: GameState, now: number): boolean {
  const key = dayKey(now)
  return state.daily.lastClaimDay !== key && !state.daily.claimed.includes(key)
}

/** Claims today's reward. Returns `[]` (and changes nothing) when today was already claimed. */
export function claimDaily(state: GameState, derived: Derived, now: number): GameEvent[] {
  if (!canClaim(state, now)) return []
  const key = dayKey(now)
  const streak = effectiveStreak(state, now, derived.streakGrace) + 1
  const day = cycleDay(streak)
  const credits = dailyReward(derived.cps, day)

  state.credits += credits
  state.lifetimeCredits += credits
  state.seasonCredits += credits
  if (day === DAILY_RP_DAY) state.rp += 1
  if (day === DAILY_CP_DAY) state.cp += 1

  state.daily.streak = streak
  state.daily.lastClaimDay = key
  state.daily.claimed.push(key)
  while (state.daily.claimed.length > DAILY_CLAIMED_KEEP) state.daily.claimed.shift()

  const events: GameEvent[] = [{ type: 'daily', day, credits }]
  const xp = grantXp(state, dailyXp(day), 'daily')
  if (xp) events.push(xp)
  return events
}
