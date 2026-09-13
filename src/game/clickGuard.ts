/**
 * Layers two and three of the auto-clicker guard: the rate cap and the cadence detector.
 *
 * Layer one lives in the UI (`src/lib/input.ts`): an untrusted event is not a click. Real
 * automation can still drive the OS pointer, so the engine keeps two more checks:
 *
 * 1. A hard cap of `CLICK_CAP_PER_SEC` **accepted** clicks per trailing second. A refused click
 *    pays nothing and is not an accusation: it is not a strike, it just does not count.
 * 2. A cadence check over the last `CADENCE_INTERVALS` **attempted** intervals. A metronome has a
 *    coefficient of variation under 0.02; a human hand at five clicks a second sits at 0.15 to
 *    0.35. Fast plus regular is the only combination that trips. Slow regularity is allowed, so a
 *    patient human tapping a steady 3/s is never touched.
 *
 * Attempted means every call, including the ones the rate cap refuses, so a 25/s tool cannot hide
 * under the cap by having two thirds of its clicks thrown away.
 *
 * The ring of attempted timestamps is per-session bookkeeping that has no business in the save, so
 * it lives in a `WeakMap` side table, the same pattern `engine.ts` uses for its tick memo. The
 * lockout itself is persisted in `stats.clickLockUntil / clickStrikes / clickStrikeAt`, so
 * reloading the page does not wash it away (`hydrate` clamps a far-future value).
 *
 * Pure: no React, no DOM, no `Date.now()`. The caller supplies `now`.
 *
 * `evaluateClick` must be called exactly once per click attempt: it is what records the attempt.
 */
import {
  CADENCE_INTERVALS,
  CADENCE_MAX_CV,
  CADENCE_MAX_MEAN_MS,
  CLICK_CAP_PER_SEC,
  CLICK_LOCKOUT_MAX_MS,
  CLICK_LOCKOUT_MS,
  CLICK_STRIKE_DECAY_MS,
} from '@/game/constants'
import type { GameState } from '@/game/types'

/**
 * Flag raised by the first cadence strike. Drives the hidden achievement "Suspiciously Regular".
 * Defined here rather than in `constants.ts` so this module owns its own vocabulary.
 */
export const CLICK_GUARD_FLAG = 'clickGuard'

/** Trailing window the hard cap counts over. `CLICK_CAP_PER_SEC` is per *second* by definition. */
export const CLICK_RATE_WINDOW_MS = 1_000

/** Timestamps kept: `CADENCE_INTERVALS` intervals need one more timestamp than that. */
export const CLICK_RING = CADENCE_INTERVALS + 1

/** Why a click paid nothing, and the moment the player can stop worrying about it. */
export type ClickVerdict = { ok: true } | { ok: false; reason: 'locked' | 'rate' | 'cadence'; until: number }

interface GuardMemo {
  /** Attempted click timestamps, oldest first, at most `CLICK_RING` of them. */
  attempts: number[]
  /** Accepted click timestamps still inside the trailing rate window, oldest first. */
  accepted: number[]
}

const MEMO = new WeakMap<GameState, GuardMemo>()

function memoFor(state: GameState): GuardMemo {
  let memo = MEMO.get(state)
  if (!memo) {
    memo = { attempts: [], accepted: [] }
    MEMO.set(state, memo)
  }
  return memo
}

/**
 * Mean interval and coefficient of variation (population standard deviation over the mean).
 *
 * Fewer than two timestamps means no intervals at all, so `cadence([])` is `{ mean: 0, cv: 0 }`.
 * A run of identical timestamps has a mean of 0, which reads as "as fast and as regular as it
 * gets" and is exactly what should trip.
 */
export function cadence(intervals: readonly number[]): { mean: number; cv: number } {
  const n = intervals.length
  if (n === 0) return { mean: 0, cv: 0 }

  let sum = 0
  for (const d of intervals) sum += d
  const mean = sum / n
  if (!Number.isFinite(mean) || mean <= 0) return { mean: 0, cv: 0 }

  let acc = 0
  for (const d of intervals) acc += (d - mean) * (d - mean)
  return { mean, cv: Math.sqrt(acc / n) / mean }
}

/** Record the strike, escalate the lockout, raise the flag, and drop the ring. */
function strike(state: GameState, memo: GuardMemo, now: number): ClickVerdict {
  const stats = state.stats

  // Strikes decay after a quiet stretch, so one bad afternoon does not follow the player forever.
  const decayed = now - stats.clickStrikeAt >= CLICK_STRIKE_DECAY_MS
  const strikes = (decayed ? 0 : Math.max(0, stats.clickStrikes)) + 1
  const step = CLICK_LOCKOUT_MS[Math.min(strikes, CLICK_LOCKOUT_MS.length) - 1]
  const lockout = Math.min(step, CLICK_LOCKOUT_MAX_MS)

  stats.clickStrikes = strikes
  stats.clickStrikeAt = now
  stats.clickLockUntil = now + lockout
  state.flags[CLICK_GUARD_FLAG] = true

  // Start the next stretch from a clean ring: the player gets a fresh 24 intervals to be human in.
  memo.attempts.length = 0
  memo.accepted.length = 0

  return { ok: false, reason: 'cadence', until: stats.clickLockUntil }
}

/**
 * Should this click pay? Records the attempt as a side effect, so call it once per attempt.
 *
 * Order: a lockout in progress short-circuits (nothing is recorded while paused, so the ring is
 * clean when the lock lifts), then the attempt joins the ring and the cadence check runs once the
 * ring is full, then the hard cap, then the click is accepted.
 */
export function evaluateClick(state: GameState, now: number): ClickVerdict {
  const stats = state.stats
  if (stats.clickLockUntil > now) return { ok: false, reason: 'locked', until: stats.clickLockUntil }

  const memo = memoFor(state)
  const attempts = memo.attempts

  // A clock that stepped backwards would manufacture negative intervals and strand the counted
  // clicks in a window that never expires, so both ledgers start over.
  if (attempts.length > 0 && now < attempts[attempts.length - 1]) {
    attempts.length = 0
    memo.accepted.length = 0
  }
  attempts.push(now)
  if (attempts.length > CLICK_RING) attempts.splice(0, attempts.length - CLICK_RING)

  if (attempts.length === CLICK_RING) {
    const intervals: number[] = []
    for (let i = 1; i < attempts.length; i++) intervals.push(attempts[i] - attempts[i - 1])
    const { mean, cv } = cadence(intervals)
    if (mean < CADENCE_MAX_MEAN_MS && cv < CADENCE_MAX_CV) return strike(state, memo, now)
  }

  const accepted = memo.accepted
  const cutoff = now - CLICK_RATE_WINDOW_MS
  let drop = 0
  while (drop < accepted.length && accepted[drop] <= cutoff) drop++
  if (drop > 0) accepted.splice(0, drop)
  if (accepted.length >= CLICK_CAP_PER_SEC) {
    return { ok: false, reason: 'rate', until: accepted[0] + CLICK_RATE_WINDOW_MS }
  }

  accepted.push(now)
  return { ok: true }
}

/**
 * Forget everything the guard knows about this state: the ring, the counted clicks and the
 * persisted lockout. For tests and for replacing a state wholesale (import, new game). It is not
 * part of the click path: a strike clears its own ring, and only time lifts a lockout.
 */
export function resetClickGuard(state: GameState): void {
  MEMO.delete(state)
  state.stats.clickLockUntil = 0
  state.stats.clickStrikes = 0
  state.stats.clickStrikeAt = 0
}
