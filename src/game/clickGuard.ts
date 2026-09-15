/**
 * Layer two of the auto-clicker guard: a hard cap on accepted clicks per second, and nothing else.
 *
 * Layer one lives in the UI (`src/lib/input.ts`): an untrusted event is not a click, so a browser
 * script cannot press the button. What is left for a real pointer is this: at most
 * `CLICK_CAP_PER_SEC` **accepted** clicks over a trailing `CLICK_RATE_WINDOW_MS`. A refused click
 * pays nothing and is not an accusation. Nothing is held against the player, nothing locks, and
 * the next click counts again the moment the oldest counted one leaves the window. A fast hand is
 * allowed; past the cap it simply stops paying.
 *
 * There used to be a third layer here, a cadence detector over the last attempted intervals with
 * an escalating lockout. It kept flagging fast humans as scripters, so it is gone. The three
 * fields it persisted (`stats.clickLockUntil / clickStrikes / clickStrikeAt`) stay in the save as
 * legacy fields, never written by the engine and 0 on every fresh state.
 *
 * The counted timestamps are per-session bookkeeping with no business in the save, so they live
 * in a `WeakMap` side table, the same pattern `engine.ts` uses for its tick memo.
 *
 * Pure: no React, no DOM, no `Date.now()`. The caller supplies `now`.
 */
import { CLICK_CAP_PER_SEC } from '@/game/constants'
import type { GameState } from '@/game/types'

/**
 * Raised the first time the cap refuses a click. Drives the hidden achievement "Rate Limited".
 * Defined here rather than in `constants.ts` so this module owns its own vocabulary.
 */
export const CLICK_GUARD_FLAG = 'clickGuard'

/** Trailing window the cap counts over. `CLICK_CAP_PER_SEC` is per *second* by definition. */
export const CLICK_RATE_WINDOW_MS = 1_000

/** Why a click paid nothing, and the moment the next one will count again. */
export type ClickVerdict = { ok: true } | { ok: false; reason: 'rate'; until: number }

/** Accepted click timestamps still inside the trailing window, oldest first. */
const MEMO = new WeakMap<GameState, number[]>()

function memoFor(state: GameState): number[] {
  let accepted = MEMO.get(state)
  if (!accepted) {
    accepted = []
    MEMO.set(state, accepted)
  }
  return accepted
}

/**
 * Should this click pay? Counts an accepted click as a side effect, so call it once per attempt.
 *
 * A refused click records nothing except, the first time, the `clickGuard` flag. Its `until` is
 * the moment the oldest counted click leaves the window, which is when the button pays again.
 */
export function evaluateClick(state: GameState, now: number): ClickVerdict {
  const accepted = memoFor(state)

  // A clock that stepped backwards would strand the counted clicks in a window that never
  // expires, so the ledger starts over.
  if (accepted.length > 0 && now < accepted[accepted.length - 1]) accepted.length = 0

  const cutoff = now - CLICK_RATE_WINDOW_MS
  let drop = 0
  while (drop < accepted.length && accepted[drop] <= cutoff) drop++
  if (drop > 0) accepted.splice(0, drop)

  if (accepted.length >= CLICK_CAP_PER_SEC) {
    // Hitting the cap is an achievement, not a strike.
    state.flags[CLICK_GUARD_FLAG] = true
    return { ok: false, reason: 'rate', until: accepted[0] + CLICK_RATE_WINDOW_MS }
  }

  accepted.push(now)
  return { ok: true }
}

/**
 * Forget the counted clicks for this state, and zero the three legacy lockout fields a save from
 * before the cap may still carry. For tests and for replacing a state wholesale (import, new
 * game). It is not part of the click path: the window empties itself.
 */
export function resetClickGuard(state: GameState): void {
  MEMO.delete(state)
  state.stats.clickLockUntil = 0
  state.stats.clickStrikes = 0
  state.stats.clickStrikeAt = 0
}
