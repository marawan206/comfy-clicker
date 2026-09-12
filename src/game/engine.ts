/**
 * The engine tick: the one function the game loop calls every STEP_S.
 *
 * `tick` never recomputes `Derived`; the caller owns that and recomputes it whenever an action
 * reports `dirty` or a tick emits an event listed in `DERIVED_EVENT_TYPES`. Everything the tick
 * does is a function of (state, derived, catalog, dt, now, rng), so a save replayed with the same
 * rng seed produces the same events.
 *
 * Two pieces of bookkeeping do not belong in the save and live in a per-state side table
 * (`WeakMap`): the trending week seen on the previous tick (so a rollover can be announced) and
 * the previous throttle flag (so the breaker flip can be announced). A freshly loaded state
 * seeds the week from `meta.lastTickAt`. The store always runs `applyOffline` before the first
 * tick, which stamps `lastTickAt = now`, so a rollover that happened while the tab was away is
 * announced by `applyOffline` itself (it still knows the old `lastTickAt`), and the first tick
 * then seeds from the current week and stays quiet. Either way the new tags are announced once.
 */
import type { Catalog } from '@/data'
import { checkAchievements } from '@/game/achievements'
import { contractsDue, progressContracts, rotateContracts } from '@/game/contracts'
import { expireEvents, maybeStartEvent } from '@/game/events'
import { currentTrending, weekIndex } from '@/game/hashtags'
import { advanceQueue } from '@/game/studio'
import type { Derived, GameEvent, GameState, Rng } from '@/game/types'
import { settlePosts } from '@/game/virality'

/** Event types that change something `computeDerived` reads; the caller recomputes after them. */
export const DERIVED_EVENT_TYPES: ReadonlySet<GameEvent['type']> = new Set<GameEvent['type']>([
  'purchase',
  'upgrade',
  'mapUnlock',
  'achievement',
  'eventStart',
  'eventEnd',
  'signup',
  'rebrand',
  'daily',
])

/** True when any event in the batch requires a `Derived` recompute. */
export function needsDerived(events: readonly GameEvent[]): boolean {
  return events.some((e) => DERIVED_EVENT_TYPES.has(e.type))
}

/** Credits earned: bank, lifetime and season counters move together. Negative amounts are ignored. */
export function addCredits(state: GameState, amount: number): void {
  if (!(amount > 0)) return
  state.credits += amount
  state.lifetimeCredits += amount
  state.seasonCredits += amount
}

/** Append a module's events (modules may return nothing when they have nothing to say). */
export function pushEvents(into: GameEvent[], from: readonly GameEvent[] | null | undefined | void): void {
  if (from) for (const e of from) into.push(e)
}

/** Trending week the game is currently in: the demo override, else the wall-clock week. */
export function currentWeek(state: GameState, derived: Derived, now: number): number {
  return state.weekOverride ?? weekIndex(now, derived.weekSpeed)
}

/**
 * Powers of ten (10, 100, 1000, …) that `cur` reaches for the first time given the previous best
 * `prev`: every 10^k with prev < 10^k ≤ cur. Below 10 there are no milestones.
 */
export function crossedMilestones(prev: number, cur: number): number[] {
  const out: number[] = []
  if (!(cur > prev) || cur < 10) return out
  let k = Math.max(1, Math.floor(Math.log10(Math.max(prev, 1))))
  let m = 10 ** k
  // log10 can land one power low from float noise; walk up until we are past `prev`.
  while (m <= prev) m = 10 ** ++k
  while (m <= cur) {
    out.push(m)
    m = 10 ** ++k
  }
  return out
}

interface TickMemo {
  week: number
  throttled: boolean
}

const MEMO = new WeakMap<GameState, TickMemo>()

/** Forget the per-state tick bookkeeping (tests, or after replacing a state wholesale). */
export function resetTickMemo(state: GameState): void {
  MEMO.delete(state)
}

/**
 * Mark the trending week at `now` as already announced. `applyOffline` calls this after emitting
 * its own `weekRollover`, so the next tick does not announce the same rollover a second time.
 */
export function primeTickMemo(state: GameState, derived: Derived, now: number): void {
  const week = currentWeek(state, derived, now)
  const memo = MEMO.get(state)
  if (memo) memo.week = week
  else MEMO.set(state, { week, throttled: derived.throttled })
}

/**
 * Advance the game by `dtSec` seconds ending at wall-clock `now`.
 *
 * Order matters: income first (so jobs finishing this tick see the new bank), then the studio
 * queue and post settlement, random events, contracts, achievements (at most once per played
 * second), the trending-week rollover, cps milestones and the breaker flip. `lastTickAt` is
 * stamped last so `applyOffline` measures from the end of this tick.
 */
export function tick(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  dtSec: number,
  now: number,
  rng: Rng,
): GameEvent[] {
  const events: GameEvent[] = []
  const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0
  const memo = MEMO.get(state) ?? {
    week: currentWeek(state, derived, state.meta.lastTickAt),
    throttled: derived.throttled,
  }

  // 1. Passive income and play time.
  if (dt > 0) addCredits(state, derived.cps * dt)
  const playedBefore = state.meta.playedSec
  state.meta.playedSec = playedBefore + dt

  // 2. Studio: start pending jobs, finish running ones, pay out likes on posts.
  pushEvents(events, advanceQueue(state, derived, catalog, now, rng))
  pushEvents(events, settlePosts(state, derived, catalog, now))

  // 3. Random events: end the expired ones before possibly starting a new one.
  pushEvents(events, expireEvents(state, now))
  pushEvents(events, maybeStartEvent(state, derived, catalog, now, rng))

  // 4. Contracts: progress goals from what happened this tick; refill/rotate when due
  //    (timer elapsed, a free slot, or a claimed one to drop; rotateContracts reschedules itself).
  pushEvents(events, progressContracts(state, events, catalog))
  if (contractsDue(state, now)) pushEvents(events, rotateContracts(state, derived, catalog, now, rng))

  // 5. Achievements: once per whole second of play, not 20× a second.
  if (Math.floor(state.meta.playedSec) !== Math.floor(playedBefore)) {
    pushEvents(events, checkAchievements(state, derived, catalog))
  }

  // 6. Trending week rollover (wall clock, weekSpeed, or a demo override change).
  const week = currentWeek(state, derived, now)
  if (week !== memo.week) {
    events.push({ type: 'weekRollover', tags: [...currentTrending(state, now, catalog, derived.weekSpeed)] })
    memo.week = week
  }

  // 7. cps milestones: announced the first time a power of ten is reached.
  for (const cps of crossedMilestones(state.stats.bestCps, derived.cps)) events.push({ type: 'milestone', cps })
  if (derived.cps > state.stats.bestCps) state.stats.bestCps = derived.cps

  // 8. Breaker flip.
  if (derived.throttled !== memo.throttled) {
    events.push({ type: 'powerThrottle', on: derived.throttled })
    memo.throttled = derived.throttled
  }

  MEMO.set(state, memo)
  state.meta.lastTickAt = now
  return events
}
