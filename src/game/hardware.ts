/**
 * Hardware: store gating, which owned rig can run a model, and how long a generation takes.
 *
 * Backend rules (CPU / MPS / ROCm) live in quantize.ts `backendAllows`; this module adds the
 * derived-dependent gates (ZLUDA, API Nodes), VRAM at the chosen precision, and the speed-tier
 * generation-time curve.
 */
import type { Catalog } from '@/data'
import { ABOVE_TIER_FACTOR, GEN_TIME_MAX_S, GEN_TIME_MIN_S, TIER_DELTA_FACTOR } from '@/game/constants'
import { bulkCost } from '@/game/economy'
import { describeCause, explainBuy, explainRun } from '@/game/guidance'
import { backendAllows, nativeHardware, requiredVram } from '@/game/quantize'
import { FAMILY_LABELS } from '@/game/state'
import type { Derived, GameState, HardwareDef, ModelDef, Precision } from '@/game/types'
import { describeUnlock } from '@/game/unlock'

export { FAMILY_LABELS }

/** Apple silicon runs everything through MPS fallbacks: twice as slow. */
export const MPS_TIME_MULT = 2
/** ROCm kernels lag CUDA by about a quarter. */
export const ROCM_TIME_MULT = 1.25
/** Relative slack when two units' generation times are compared for "which is faster". */
const GEN_TIME_TIE_EPS = 1e-9

export interface OwnedUnit {
  def: HardwareDef
  count: number
}

/** Owned units (count > 0) in catalog order. Unknown ids in the save are skipped. */
export function ownedHardware(state: GameState, catalog: Catalog): OwnedUnit[] {
  const out: OwnedUnit[] = []
  for (const def of catalog.hardware) {
    const count = state.hardware[def.id] ?? 0
    if (count > 0) out.push({ def, count })
  }
  return out
}

/** Speed tier after cooling bonuses for the unit's family. */
export function effectiveTier(hw: HardwareDef, derived: Pick<Derived, 'coolingTier'>): number {
  return hw.speedTier + (derived.coolingTier[hw.family] ?? 0)
}

/** Gen-time multiplier a unit's backend carries on local models: MPS ×2, ROCm ×1.25, CUDA/CPU ×1. */
export function backendTimeMult(hw: Pick<HardwareDef, 'mps' | 'rocm'>): number {
  let mult = 1
  if (hw.mps) mult *= MPS_TIME_MULT
  if (hw.rocm) mult *= ROCM_TIME_MULT
  return mult
}

/**
 * Model-independent speed ranking of a unit: its effective tier minus the tiers its backend tax
 * is worth (one tier = ×TIER_DELTA_FACTOR, so MPS costs ≈ 2.6 tiers and ROCm ≈ 0.9). Higher is
 * faster. `bestRunnable` compares real generation times; this is for `bestHardwareId`, which
 * has no model to measure against.
 */
export function speedScore(hw: HardwareDef, derived: Pick<Derived, 'coolingTier'>): number {
  return effectiveTier(hw, derived) - Math.log(backendTimeMult(hw)) / Math.log(TIER_DELTA_FACTOR)
}

/** Faster (by `speedScore`) wins; ties go to more VRAM, then the pricier unit. */
export function isFasterUnit(a: HardwareDef, b: HardwareDef | null, derived: Pick<Derived, 'coolingTier'>): boolean {
  if (!b) return true
  const sa = speedScore(a, derived)
  const sb = speedScore(b, derived)
  if (Math.abs(sa - sb) > GEN_TIME_TIE_EPS) return sa > sb
  return preferOnTie(a, b)
}

export interface BuyCheck {
  ok: boolean
  reason?: string
}

/**
 * Can the player buy `n` units of `def` right now? Checks, in order: family unlocked (AMD
 * consumer cards need the ROCm Setup upgrade), the store unlock condition, the player level
 * (`Needs level 5 · you are level 4`, the same words a checkpoint uses), the per-unit cap, and
 * credits.
 */
export function canBuy(
  def: HardwareDef,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  n = 1,
): BuyCheck {
  if (!Number.isInteger(n) || n < 1) return { ok: false, reason: 'Nothing to buy' }
  const cause = explainBuy(def, state, derived, catalog, n)[0]
  if (!cause) return { ok: true }
  switch (cause.kind) {
    case 'family':
      return { ok: false, reason: `Locked · ${describeCause(cause, catalog)}` }
    case 'max': {
      const left = Math.max(0, cause.max - (state.hardware[def.id] ?? 0))
      return { ok: false, reason: left === 0 ? describeCause(cause, catalog) : `Only ${left} more available` }
    }
    case 'level':
    case 'credits':
      return { ok: false, reason: describeCause(cause, catalog) }
    default: {
      // An unlock condition: the store names the whole requirement, not just the leaf that failed.
      const what = describeUnlock(def.unlock, catalog)
      return { ok: false, reason: what ? `Locked · ${what}` : 'Locked' }
    }
  }
}

/**
 * Pay for and install `n` units. Returns the credits spent. Validate with `canBuy` first; this
 * only mutates. (Tier upgrades are separate purchases and are not touched.)
 */
export function applyPurchase(state: GameState, def: HardwareDef, n: number): number {
  const count = Math.max(0, Math.floor(n))
  if (count === 0) return 0
  const owned = state.hardware[def.id] ?? 0
  const cost = bulkCost(def, owned, count)
  state.credits -= cost
  state.hardware[def.id] = owned + count
  return cost
}

/**
 * Whether `hw` can run `model` at `precision`. API models run anywhere once API Nodes is
 * unlocked; local models need the backend rules (ZLUDA-aware) and enough VRAM for the weights.
 */
export function runsOn(
  model: ModelDef,
  precision: Precision,
  hw: HardwareDef,
  derived: Derived,
  catalog: Catalog,
): boolean {
  if (model.api) return derived.apiNodes
  if (!backendAllows(model, hw, derived.zluda)) return false
  return hw.vram >= requiredVram(model, precision, catalog)
}

/** Owned units that can run the model at that precision, in catalog order. */
export function runnableHardware(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): HardwareDef[] {
  const out: HardwareDef[] = []
  for (const { def } of ownedHardware(state, catalog)) {
    if (runsOn(model, precision, def, derived, catalog)) out.push(def)
  }
  return out
}

/** Equal speed: more VRAM wins, then the pricier unit. */
function preferOnTie(a: HardwareDef, b: HardwareDef): boolean {
  if (a.vram !== b.vram) return a.vram > b.vram
  return a.baseCost > b.baseCost
}

/**
 * The owned unit a job would run on: the one with the shortest `genTimeMs` for this model and
 * precision (so the MPS ×2 and ROCm ×1.25 taxes count against Apple and AMD units), ties broken
 * by VRAM then price. Null when nothing fits.
 */
export function bestRunnable(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): HardwareDef | null {
  let best: HardwareDef | null = null
  let bestMs = Infinity
  for (const hw of runnableHardware(model, precision, state, derived, catalog)) {
    const ms = genTimeMs(model, precision, hw, derived, catalog)
    const tie = best !== null && Math.abs(ms - bestMs) <= GEN_TIME_TIE_EPS * Math.max(ms, bestMs)
    if (best === null || (!tie && ms < bestMs) || (tie && preferOnTie(hw, best))) {
      best = hw
      bestMs = ms
    }
  }
  return best
}

/**
 * Speed tier of the model's native rig (cheapest CUDA card that holds the native weights), the
 * tier `baseTime` is quoted at. 0 for API models (no local tier) and for models no unit can hold.
 */
export function nativeTier(model: ModelDef, catalog: Catalog): number {
  return nativeHardware(model, catalog)?.speedTier ?? 0
}

/**
 * Cheapest non-CPU unit in an unlocked family that would run the model at that precision, the
 * "or buy an X" half of a lock reason. Null when no purchasable unit fits.
 */
export function cheapestPurchasable(
  model: ModelDef,
  precision: Precision,
  derived: Derived,
  catalog: Catalog,
): HardwareDef | null {
  let best: HardwareDef | null = null
  for (const hw of catalog.hardware) {
    if (hw.cpuOnly || !derived.unlockedFamilies.includes(hw.family)) continue
    if (!runsOn(model, precision, hw, derived, catalog)) continue
    if (!best || hw.baseCost < best.baseCost) best = hw
  }
  return best
}

/** Letters whose spoken name starts with a vowel sound, for initialisms like "RTX" or "H100". */
const VOWEL_SOUND_INITIALS = /^[AEFHILMNORSX]/
const INITIALISM = /^[A-Z0-9]{1,4}(\s|$)/
/** "used", "unified": a leading U pronounced "you" takes "a". */
const YOU_SOUND = /^u(?:s|ni|ti)/i

/** "an RTX 3090", "a Mac mini M4", "an A100 80GB", "a Used RTX 3060 12GB". */
export function withArticle(name: string): string {
  const vowelSound = INITIALISM.test(name)
    ? VOWEL_SOUND_INITIALS.test(name)
    : /^[aeiou]/i.test(name) && !YOU_SOUND.test(name)
  return `${vowelSound ? 'an' : 'a'} ${name}`
}

/**
 * Why the model can't run at that precision on anything the player owns, or null when it can.
 * Example: `Needs 20 GB · your best card has 12 GB · quantize FP8 for 450 or buy an RTX 3090`.
 *
 * One line over the cause layer: `explainRun` decides (level, API Nodes, backend, VRAM) and
 * `describeCause` writes it down, so every surface that wants a button instead of a sentence can
 * ask `explainRun` for the same answer.
 */
export function lockReason(
  model: ModelDef,
  precision: Precision,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): string | null {
  const cause = explainRun(model, precision, state, derived, catalog)
  return cause ? describeCause(cause, catalog) : null
}

/**
 * Generation time in milliseconds for `model` at `precision` on `hw`:
 *   base   = clamp(baseTime × TIER_DELTA_FACTOR^(nativeTier − tier) [below native]
 *                             × ABOVE_TIER_FACTOR^(tier − nativeTier) [above native],
 *                  GEN_TIME_MIN_S, GEN_TIME_MAX_S)         where tier = speedTier + cooling
 *   time   = base × precision.timeMult × speedMult × familyGenTime[family] × (mps ? 2 : 1) × (rocm ? 1.25 : 1)
 * API models ignore the local tier and backend taxes (someone else's GPU).
 */
export function genTimeMs(
  model: ModelDef,
  precision: Precision,
  hw: HardwareDef,
  derived: Derived,
  catalog: Catalog,
): number {
  let base = model.baseTime
  let backendMult = 1
  if (!model.api) {
    const delta = nativeTier(model, catalog) - effectiveTier(hw, derived)
    base *= delta > 0 ? TIER_DELTA_FACTOR ** delta : ABOVE_TIER_FACTOR ** -delta
    backendMult = backendTimeMult(hw)
  }
  base = Math.min(GEN_TIME_MAX_S, Math.max(GEN_TIME_MIN_S, base))
  const timeMult = catalog.precisions[precision]?.timeMult ?? 1
  const familyMult = derived.familyGenTime[model.family] ?? 1
  return base * timeMult * derived.speedMult * familyMult * backendMult * 1000
}
