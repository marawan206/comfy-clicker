/**
 * Power system. Every owned unit draws watts; the budget starts at a single household circuit
 * and grows through PSU/infra upgrades and map nodes. Drawing more than the budget trips the
 * breaker: income is scaled by `budget / draw`, so a rig at twice its budget earns half. The
 * throttle is proportional on purpose — past the breaker another unit only helps if its cps per
 * watt beats the rack's average, which is what makes PSU upgrades and low-watt silicon matter.
 *
 * Pure helpers over `GameState`/`Derived`; derived.ts calls these once per recompute and the
 * store UI uses the projection helpers to warn before a purchase trips the breaker.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { POWER_BUDGET_BASE } from '@/game/constants'
import type { Derived, Effect, GameState, HardwareDef } from '@/game/types'

/** Total watts drawn by owned hardware: Σ count × watts. */
export function powerDraw(state: GameState, catalog: Catalog): number {
  const { hardwareById } = buildIndex(catalog)
  let draw = 0
  for (const id in state.hardware) {
    const count = state.hardware[id] ?? 0
    const def = hardwareById[id]
    if (def && count > 0) draw += count * def.watts
  }
  return draw
}

/** Watts available: the base circuit plus every `powerBudget` effect. */
export function powerBudget(effects: readonly Effect[]): number {
  let budget = POWER_BUDGET_BASE
  for (const e of effects) if (e.kind === 'powerBudget') budget += e.value
  return budget
}

/** The breaker trips when draw strictly exceeds the budget. */
export function isThrottled(draw: number, budget: number): boolean {
  return draw > budget
}

/**
 * Income multiplier for a rig drawing `draw` watts against `budget`: 1 within budget, else
 * `budget / draw` (0 when there is no budget at all). Proportional, no floor — see the header.
 */
export function throttleMult(draw: number, budget: number): number {
  if (!isThrottled(draw, budget)) return 1
  if (!(budget > 0)) return 0
  return budget / draw
}

/** Watts still available before the breaker trips (negative when already over). */
export function powerHeadroom(derived: Pick<Derived, 'powerDraw' | 'powerBudget'>): number {
  return derived.powerBudget - derived.powerDraw
}

/**
 * Load as a fraction of the budget (1 = exactly at the limit, > 1 = throttled). Useful for meters;
 * a zero budget with any draw reads as Infinity.
 */
export function powerLoad(derived: Pick<Derived, 'powerDraw' | 'powerBudget'>): number {
  if (derived.powerBudget <= 0) return derived.powerDraw > 0 ? Infinity : 0
  return derived.powerDraw / derived.powerBudget
}

export interface PowerProjection {
  draw: number
  budget: number
  throttled: boolean
  /** True when the purchase itself flips the breaker from off to on. */
  trips: boolean
  /** Income multiplier the rig would run at after the purchase (see `throttleMult`). */
  mult: number
}

/** Draw/throttle state after buying `n` more units of `def`, without touching state. */
export function projectPurchase(
  def: Pick<HardwareDef, 'watts'>,
  n: number,
  derived: Pick<Derived, 'powerDraw' | 'powerBudget' | 'throttled'>,
): PowerProjection {
  const draw = derived.powerDraw + Math.max(0, n) * def.watts
  const throttled = isThrottled(draw, derived.powerBudget)
  return {
    draw,
    budget: derived.powerBudget,
    throttled,
    trips: throttled && !derived.throttled,
    mult: throttleMult(draw, derived.powerBudget),
  }
}

/** Whether buying `n` units of `def` would leave the rig over budget. */
export function wouldThrottle(
  def: Pick<HardwareDef, 'watts'>,
  n: number,
  derived: Pick<Derived, 'powerDraw' | 'powerBudget' | 'throttled'>,
): boolean {
  return projectPurchase(def, n, derived).throttled
}

/** Largest `n` units of `def` that fit under the budget from the current draw (0 if already over). */
export function unitsWithinBudget(
  def: Pick<HardwareDef, 'watts'>,
  derived: Pick<Derived, 'powerDraw' | 'powerBudget'>,
): number {
  const headroom = powerHeadroom(derived)
  if (headroom < 0) return 0
  if (def.watts <= 0) return Infinity
  return Math.floor(headroom / def.watts)
}
