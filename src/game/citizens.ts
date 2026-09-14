/**
 * Citizens: the people who run the workflows you publish.
 *
 * Publishing a recipe to ComfyHub puts a *drop* on the board. While it is hot, invented players
 * (`src/data/citizens.ts` supplies the handles) run it every few seconds, each run paying a
 * royalty and a point of rep, exactly like a real hub run does. Interest cools with every run and
 * with the clock, and once a drop is cold it stops paying for good: a workflow is a burst, never
 * an annuity.
 *
 * Three rules hold the economy still.
 * 1. **One run per drop per tick.** `nextRunAt` is a timestamp in the save, so a tab closed for
 *    eight hours comes back to one due run per drop, never a backlog of five hundred.
 * 2. **Heat only ever falls.** `CITIZEN_HEAT_DECAY` per run plus the `CITIZEN_TREND_MS` deadline,
 *    so a drop pays out about 43 seconds of income in total, spread over about 40 minutes.
 * 3. **Royalties scale with income, not with patience.** A run pays `CITIZEN_ROYALTY_SECS × cps ×
 *    heat`, so the feature is flavour at every rig size rather than a tax on idling.
 *
 * Pure: takes `now` and an `Rng`, touches only `state`, and returns events for the UI.
 */
import {
  CITIZEN_COLD_HEAT,
  CITIZEN_FEED_MAX,
  CITIZEN_HEAT_DECAY,
  CITIZEN_MAX_DROPS,
  CITIZEN_MAX_GAP_MS,
  CITIZEN_MIN_GAP_MS,
  CITIZEN_ROYALTY_MIN,
  CITIZEN_ROYALTY_SECS,
  CITIZEN_TREND_MS,
} from '@/game/constants'
import { addCredits } from '@/game/engine'
import { pick, uniform } from '@/game/rng'
import type { Catalog, CitizenDrop, Derived, GameEvent, GameState, Rng } from '@/game/types'

/** A citizen handle: two words and, now and then, a number nobody chose carefully. */
export function citizenHandle(rng: Rng, catalog: Catalog): string {
  const { prefixes, suffixes } = catalog.citizens
  const base = `${pick(rng, prefixes)}_${pick(rng, suffixes)}`
  return rng() < 0.35 ? `${base}${Math.floor(uniform(rng, 2, 99))}` : base
}

/** Milliseconds until the next run of a drop. A cooling workflow is visited less often. */
export function nextGapMs(heat: number, rng: Rng): number {
  const gap = uniform(rng, CITIZEN_MIN_GAP_MS, CITIZEN_MAX_GAP_MS)
  return Math.round(gap / Math.max(CITIZEN_COLD_HEAT, Math.min(1, heat)))
}

/** Credits one run pays the author at this income and this much heat. */
export function runRoyalty(derived: Derived, heat: number): number {
  const cps = Number.isFinite(derived.cps) && derived.cps > 0 ? derived.cps : 0
  return Math.max(CITIZEN_ROYALTY_MIN, Math.round(CITIZEN_ROYALTY_SECS * cps * heat))
}

/** Drops still collecting runs, newest first. */
export function hotDrops(state: GameState): CitizenDrop[] {
  return state.citizens.drops.filter((d) => !d.cold).sort((a, b) => b.publishedAt - a.publishedAt)
}

/** True once a drop has spent its heat or outlived the trending window. */
export function isCold(drop: CitizenDrop, now: number): boolean {
  return drop.cold || drop.heat < CITIZEN_COLD_HEAT || now - drop.publishedAt > CITIZEN_TREND_MS
}

/**
 * Put a freshly published workflow on the board. The newest drop always gets a slot: when the
 * board is full the coldest one is dropped, so a publish is never silently ignored.
 */
export function addDrop(state: GameState, now: number, rng: Rng, id: string, name: string): CitizenDrop {
  const drop: CitizenDrop = {
    id,
    name: name.trim() || 'Untitled workflow',
    publishedAt: now,
    runs: 0,
    royalties: 0,
    heat: 1,
    nextRunAt: now + nextGapMs(1, rng),
    cold: false,
  }
  const board = state.citizens.drops.filter((d) => d.id !== id)
  board.push(drop)
  while (board.length > CITIZEN_MAX_DROPS) {
    let worst = 0
    for (let i = 1; i < board.length; i++) {
      const a = board[i] as CitizenDrop
      const b = board[worst] as CitizenDrop
      if (a.cold !== b.cold ? a.cold : a.heat < b.heat) worst = i
    }
    board.splice(worst, 1)
  }
  state.citizens.drops = board
  return drop
}

/**
 * Advance every drop to `now`. At most one run per drop, whatever the gap since the last tick,
 * and a drop that has gone cold is marked once and then left alone.
 */
export function runCitizens(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  now: number,
  rng: Rng,
): GameEvent[] {
  const events: GameEvent[] = []
  if (catalog.citizens.prefixes.length === 0) return events

  for (const drop of state.citizens.drops) {
    if (drop.cold) continue
    if (isCold(drop, now)) {
      drop.cold = true
      continue
    }
    if (now < drop.nextRunAt) continue

    const credits = runRoyalty(derived, drop.heat)
    const handle = citizenHandle(rng, catalog)
    addCredits(state, credits)
    state.stats.hubRuns += 1
    state.hubRep += 1
    drop.runs += 1
    drop.royalties += credits
    drop.heat *= CITIZEN_HEAT_DECAY
    drop.nextRunAt = now + nextGapMs(drop.heat, rng)
    if (drop.heat < CITIZEN_COLD_HEAT) drop.cold = true

    state.citizens.feed.push({
      id: `${drop.id}:${drop.runs}`,
      at: now,
      handle,
      workflowId: drop.id,
      workflowName: drop.name,
      credits,
    })
    events.push({ type: 'citizenRun', handle, workflowName: drop.name, credits })
  }

  if (state.citizens.feed.length > CITIZEN_FEED_MAX) {
    state.citizens.feed = state.citizens.feed.slice(-CITIZEN_FEED_MAX)
  }
  return events
}
