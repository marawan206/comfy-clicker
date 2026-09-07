/**
 * Hardware pricing. Every unit costs `growth` times the previous one, rounded up.
 */
import type { Derived, HardwareDef } from '@/game/types'

/** The two fields the pricing curve needs; a full `HardwareDef` satisfies it. */
export type Priced = Pick<HardwareDef, 'baseCost' | 'growth'>

/**
 * Cost of the next unit when `owned` are already installed: `ceil(baseCost × growth^owned)`.
 * A relative epsilon strips float noise first (100 × 1.12 is 112.00000000000001, which would
 * otherwise ceil to 113); only values within 1e-9 of an integer are affected.
 */
export function unitCost(def: Priced, owned: number): number {
  const raw = def.baseCost * def.growth ** Math.max(0, owned)
  return Math.ceil(raw - Math.abs(raw) * 1e-9)
}

/** Total cost of the next `n` units. Exact per-unit ceilings, so it equals Σ unitCost. */
export function bulkCost(def: Priced, owned: number, n: number): number {
  const count = Math.max(0, Math.floor(n))
  let total = 0
  for (let i = 0; i < count; i++) total += unitCost(def, owned + i)
  return total
}

/** Guard against runaway loops on degenerate defs (e.g. baseCost 0). */
const MAX_AFFORDABLE_CAP = 1_000_000

/** Largest `n` such that `bulkCost(def, owned, n) ≤ credits`. */
export function maxAffordable(def: Priced, owned: number, credits: number): number {
  if (!(credits > 0)) return 0
  // Flat price: closed form, no loop.
  if (def.growth <= 1) {
    const cost = unitCost(def, owned)
    return cost <= 0 ? MAX_AFFORDABLE_CAP : Math.floor(credits / cost)
  }
  let n = 0
  let remaining = credits
  let cost = unitCost(def, owned)
  while (cost <= remaining && n < MAX_AFFORDABLE_CAP) {
    remaining -= cost
    n += 1
    cost = unitCost(def, owned + n)
  }
  return n
}

/**
 * Seconds for the next unit to pay for itself:
 * `unitCost(def, owned) / (baseCps × rigMult × familyMult × globalMult)`.
 * Ignores the power throttle (buying may itself trigger it). Infinity when the unit earns nothing.
 */
export function paybackSec(def: HardwareDef, derived: Derived, owned = 0): number {
  const rig = derived.rigMult[def.id] ?? 1
  const family = derived.familyMult[def.family] ?? 1
  const rate = def.baseCps * rig * family * derived.globalMult
  if (!(rate > 0)) return Infinity
  return unitCost(def, owned) / rate
}
