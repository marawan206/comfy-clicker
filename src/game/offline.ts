/**
 * Welcome-back settlement. Called once when the tab wakes up after a gap (the loop's `onLongGap`)
 * or on load: pays idle income, runs the studio queue forward through every job that would have
 * finished, settles the resulting posts, credits them toward contracts, and announces anything
 * the gap crossed (a trending-week rollover, achievements).
 *
 * Gaps up to SHORT_GAP_S are a silent full-rate catch-up (no cap, no report, and no offline
 * claim). Longer gaps are capped at `derived.offlineCapHours`, scaled by
 * `derived.offlineEfficiency` (OFFLINE_EFFICIENCY unless an upgrade raises it) and reported with
 * an `offline` event so the UI can show the "while you were away" card.
 */
import type { Catalog } from '@/data'
import { checkAchievements } from '@/game/achievements'
import { MAX_QUEUE, SHORT_GAP_S } from '@/game/constants'
import { progressContracts } from '@/game/contracts'
import { primeTickMemo } from '@/game/engine'
import { expireEvents } from '@/game/events'
import { currentTrending, weekIndex } from '@/game/hashtags'
import { settleLevelUps } from '@/game/level'
import { hashString, mulberry32 } from '@/game/rng'
import { advanceQueue } from '@/game/studio'
import type { Derived, GameEvent, GameState, Job, Rng } from '@/game/types'
import { settlePosts } from '@/game/virality'

/**
 * Lower bound, inside the long-gap path, for a gap that counts as an offline claim (the stat the
 * "Comfy Sleep Mode" achievement reads). The upper gate is the short-gap rule: a catch-up that
 * paid at the full rate and showed no welcome-back card was a tab switch, not a night away, so it
 * never claims. Alt-tabbing for 61 seconds is not an idle strategy.
 */
export const OFFLINE_CLAIM_MIN_S = 60

export interface OfflineResult {
  elapsedSec: number
  gain: number
  events: GameEvent[]
}

export interface OfflineGain {
  /** Seconds actually paid for. */
  paidSec: number
  gain: number
  /** True for the silent catch-up path. */
  short: boolean
}

/** Pure income rule: full rate for short gaps, capped × `derived.offlineEfficiency` otherwise. */
export function offlineGain(elapsedSec: number, derived: Derived): OfflineGain {
  const elapsed = Math.max(0, elapsedSec)
  if (elapsed <= SHORT_GAP_S) return { paidSec: elapsed, gain: derived.cps * elapsed, short: true }
  const capSec = derived.offlineCapHours * 3600
  const paidSec = Number.isFinite(capSec) ? Math.min(elapsed, Math.max(0, capSec)) : elapsed
  return { paidSec, gain: derived.cps * paidSec * derived.offlineEfficiency, short: false }
}

/** Moment the earliest running job would finish (accounting for click bonus), or Infinity. */
function nextFinish(queue: Job[]): number {
  let t = Infinity
  for (const job of queue) {
    if (job.startedAt === null || job.endsAt === null) continue
    t = Math.min(t, job.endsAt - job.clickBonusMs)
  }
  return t
}

/**
 * Replays the queue from `from` to `now`: jobs finish at their real end times (so their posts carry
 * the right `createdAt` and trending week) and free slots start the next pending job at that moment.
 * Random events are expired at each step first, so a founder-repost window or a caught spark does
 * not keep boosting posts that finish long after it ended (`derived` itself is the caller's snapshot;
 * the store recomputes it from the `eventEnd` events afterwards). Each iteration finishes at least
 * one job, so it terminates in at most a few queue-lengths.
 */
export function replayQueue(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  from: number,
  now: number,
  rng: Rng,
): GameEvent[] {
  const events: GameEvent[] = []
  if (state.queue.length === 0) return events
  // Pending jobs that were waiting when we left start at the moment we left.
  const start = Math.min(from, now)
  events.push(...expireEvents(state, start))
  events.push(...advanceQueue(state, derived, catalog, start, rng))
  for (let guard = 0; guard < MAX_QUEUE * 4; guard++) {
    const t = nextFinish(state.queue)
    if (t > now) break
    const at = Math.max(t, from)
    events.push(...expireEvents(state, at))
    events.push(...advanceQueue(state, derived, catalog, at, rng))
  }
  // Anything still pending with a free slot starts now.
  events.push(...expireEvents(state, now))
  events.push(...advanceQueue(state, derived, catalog, now, rng))
  return events
}

/**
 * Settles the gap since `meta.lastTickAt`. The `offline` event (long gaps only) comes first in
 * `events`, followed by whatever the queue and feed produced, contract completions, a
 * `weekRollover` if the trending week changed while away, and achievements reached offline.
 */
export function applyOffline(state: GameState, derived: Derived, catalog: Catalog, now: number): OfflineResult {
  const last = state.meta.lastTickAt
  const elapsedSec = Math.max(0, (now - last) / 1000)
  const { gain, short } = offlineGain(elapsedSec, derived)
  const events: GameEvent[] = []

  if (gain > 0) {
    state.credits += gain
    state.lifetimeCredits += gain
    state.seasonCredits += gain
  }
  if (!short) events.push({ type: 'offline', gain, elapsedSec })

  // Deterministic per gap so a reload during settlement cannot re-roll the same posts.
  const rng = mulberry32(hashString(`${state.meta.guestId}|${last}|${now}`))
  events.push(...replayQueue(state, derived, catalog, last, now, rng))
  events.push(...settlePosts(state, derived, catalog, now))
  // Posts, likes, virals and followers earned while away count toward contracts: the events are
  // gone by the next tick, so this is the only place they can be credited.
  events.push(...progressContracts(state, events, catalog))

  if (!short && elapsedSec >= OFFLINE_CLAIM_MIN_S) state.stats.offlineClaims += 1

  // The tick seeds its rollover memo from `lastTickAt`, which is about to become `now`; announce
  // a week crossed while away here and prime the memo so the tick stays quiet about it.
  const weekAt = (t: number): number => state.weekOverride ?? weekIndex(t, derived.weekSpeed)
  if (elapsedSec > 0 && weekAt(last) !== weekAt(now)) {
    events.push({ type: 'weekRollover', tags: [...currentTrending(state, now, catalog, derived.weekSpeed)] })
  }
  primeTickMemo(state, derived, now)

  // Milestones reached offline ("Comfy Sleep Mode", a post count) ride along with the welcome-back card.
  events.push(...checkAchievements(state, derived, catalog))
  events.push(...settleLevelUps(state, derived, catalog))

  state.meta.lastTickAt = now
  return { elapsedSec, gain, events }
}
