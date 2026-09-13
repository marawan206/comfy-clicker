/**
 * Followers, Comfy Cloud signups and audience reach.
 *
 * Followers arrive in fractions (a post pays `likes × followRate`), so `followersFrac` banks the
 * remainder until a whole follower appears. Every time lifetime followers cross a signup
 * threshold, one of them signs up for Comfy Cloud and the studio earns a research point.
 */
import { AUDIENCE_REF_DIVISOR, SIGNUP_GROWTH, SIGNUP_THRESHOLDS } from '@/game/constants'
import type { GameEvent, GameState } from '@/game/types'

/**
 * Lifetime followers needed for the k-th signup (0-based): the SIGNUP_THRESHOLDS table, then
 * ×SIGNUP_GROWTH per step beyond it. The table's leading 0 means the very first follower signs up.
 */
export function signupThreshold(k: number): number {
  const table = SIGNUP_THRESHOLDS
  const index = Math.max(0, Math.floor(k))
  if (index < table.length) return table[index] as number
  const last = table[table.length - 1] as number
  return last * SIGNUP_GROWTH ** (index - table.length + 1)
}

/** Lifetime followers at which the next signup happens (for the "next signup at …" hint). */
export function nextSignupAt(state: GameState): number {
  return Math.max(1, signupThreshold(state.signups))
}

/**
 * Bank `n` followers (fractions allowed) and grant every signup whose threshold is now met.
 * Each signup adds one research point and emits `signup`.
 */
export function addFollowers(state: GameState, n: number): GameEvent[] {
  const events: GameEvent[] = []
  if (!(Number.isFinite(n) && n > 0)) return events
  state.followersFrac += n
  const whole = Math.floor(state.followersFrac)
  state.followersFrac -= whole
  if (whole <= 0) return events
  state.followers += whole
  state.lifetimeFollowers += whole
  while (state.lifetimeFollowers >= nextSignupAt(state)) {
    state.signups += 1
    state.rp += 1
    events.push({ type: 'signup', total: state.signups })
  }
  return events
}

/**
 * Take `n` followers away (a ratioed post drives them off). Floors at zero and leaves
 * `lifetimeFollowers` alone, so signups already earned are never revoked. Announces nothing.
 */
export function removeFollowers(state: GameState, n: number): void {
  if (!(Number.isFinite(n) && n > 0)) return
  state.followers = Math.max(0, state.followers - Math.floor(n))
}

/** Reach multiplier for likes: `1 + log10(1 + followers / AUDIENCE_REF_DIVISOR)`. */
export function audienceMult(followers: number): number {
  const f = Number.isFinite(followers) && followers > 0 ? followers : 0
  return 1 + Math.log10(1 + f / AUDIENCE_REF_DIVISOR)
}
