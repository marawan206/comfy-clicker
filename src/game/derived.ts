/**
 * Derived numbers: everything the tick loop and UI read but never store. Recomputed when the
 * state changes shape (purchase, upgrade, map node, event, prestige), never per tick.
 *
 * Effect conventions (shared with src/data):
 *   globalMult                              additive fraction, Π(1 + v)
 *   rigMult / familyMult / clickMult /      multiplier, Π v
 *   likesMult / speedMult / followRate /
 *   weekSpeed / cpMult / familyGenTime
 *   clickFlat / clickCpsPct / concurrency / additive, Σ v
 *   powerBudget / payoutRatio / viralChance /
 *   flopChance / offlineCapHours / coolingTier / tagLikes
 *   offlineEfficiency                       best value wins, max(OFFLINE_EFFICIENCY, v…)
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import {
  ACHIEVEMENT_MULT,
  CP_MULT_PER_POINT,
  FLOP_CHANCE_BASE,
  FOLLOW_RATE_BASE,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  RP_MULT_PER_POINT,
  TIER_UPGRADE_EFFECT,
  VIRAL_CHANCE_BASE,
} from '@/game/constants'
import { eventEffects } from '@/game/events'
import { isFasterUnit } from '@/game/hardware'
import { isThrottled, powerBudget, powerDraw, throttleMult } from '@/game/power'
import type { Derived, Effect, GameState, HardwareDef, HardwareFamily } from '@/game/types'

/** Families buyable from the start; `amd-consumer` needs an `unlockFamily` effect (ROCm Setup). */
export const BASE_FAMILIES: readonly HardwareFamily[] = [
  'cpu',
  'apple',
  'nvidia-consumer',
  'workstation',
  'datacenter',
  'cloud-node',
  'region',
]

/** Flop chance never drops below this, however many negative prompts are stacked. */
export const FLOP_CHANCE_MIN = 0.02

/** Likes bonus a trained LoRA grants on its hashtag (`tagLikes` +0.25 → ×1.25 on matched posts). */
export const LORA_TAG_LIKES = 0.25

/** Wildcard tag used by marker map nodes (e.g. `lora-training`); carries no bonus. */
const WILDCARD_TAG = '*'

/** Virtual upgrade id for tier `tier` (1..4) of a hardware unit. */
export function tierUpgradeId(hardwareId: string, tier: number): string {
  return `tier:${hardwareId}:${tier}`
}

/**
 * Every effect currently applying: owned upgrades, reached hardware tiers (virtual
 * `tier:<hw>:<n>` upgrades, one per tier up to the reached one), unlocked map nodes and
 * active random events (delegated to events.ts, which knows the per-kind semantics).
 */
export function activeEffects(state: GameState, catalog: Catalog): Effect[] {
  const { upgradeById, mapNodeById } = buildIndex(catalog)
  const out: Effect[] = []
  for (const id of state.upgrades) {
    const def = upgradeById[id]
    if (def) for (const e of def.effects) out.push(e)
  }
  for (const hardwareId in state.hardwareTiers) {
    const reached = state.hardwareTiers[hardwareId] ?? 0
    for (let tier = 1; tier <= reached; tier++) {
      const def = upgradeById[tierUpgradeId(hardwareId, tier)]
      // Fixture catalogs may omit the generated tier upgrades; the effect is fixed by contract.
      if (def) for (const e of def.effects) out.push(e)
      else out.push({ kind: 'rigMult', hardwareId, value: TIER_UPGRADE_EFFECT })
    }
  }
  for (const id of state.mapNodes) {
    const def = mapNodeById[id]
    if (def) for (const e of def.effects) out.push(e)
  }
  for (const e of eventEffects(state, catalog)) out.push(e)
  return out
}

/** The no-hardware baseline: handy for tests and for the empty-rig case after a rebrand. */
export function createEmptyDerived(): Derived {
  return {
    cps: 0,
    rawCps: 0,
    clickValue: 1,
    bestVram: 0,
    bestTier: 0,
    bestHardwareId: null,
    hasGpu: false,
    powerDraw: 0,
    powerBudget: POWER_BUDGET_BASE,
    throttled: false,
    concurrency: 1,
    speedMult: 1,
    likesMult: 1,
    payoutBonus: 0,
    followRate: FOLLOW_RATE_BASE,
    viralChance: VIRAL_CHANCE_BASE,
    flopChance: FLOP_CHANCE_BASE,
    offlineCapHours: OFFLINE_CAP_HOURS_BASE,
    offlineEfficiency: OFFLINE_EFFICIENCY,
    globalMult: 1,
    cpMult: 1,
    familyMult: {},
    rigMult: {},
    familyGenTime: {},
    coolingTier: {},
    tagLikes: {},
    unlockedFamilies: [...BASE_FAMILIES],
    zluda: false,
    apiNodes: false,
    hashtagResearch: false,
    streakGrace: false,
    reservedCapacity: false,
    weekSpeed: 1,
  }
}

export function computeDerived(state: GameState, catalog: Catalog): Derived {
  const { hardwareById } = buildIndex(catalog)
  const effects = activeEffects(state, catalog)
  const d = createEmptyDerived()

  // ---- fold effects -------------------------------------------------------
  let clickFlat = 0
  let clickMult = 1
  let clickCpsPct = 0
  let globalProduct = 1
  let cpMultProduct = 1
  let concurrency = 0
  let payoutBonus = 0
  let followRate = 1
  let viralBonus = 0
  let flopReduction = 0
  let offlineBonus = 0
  let offlineEfficiency = OFFLINE_EFFICIENCY
  const families: HardwareFamily[] = [...BASE_FAMILIES]

  for (const e of effects) {
    switch (e.kind) {
      case 'clickFlat':
        clickFlat += e.value
        break
      case 'clickMult':
        clickMult *= e.value
        break
      case 'clickCpsPct':
        clickCpsPct += e.value
        break
      case 'rigMult':
        d.rigMult[e.hardwareId] = (d.rigMult[e.hardwareId] ?? 1) * e.value
        break
      case 'familyMult':
        d.familyMult[e.family] = (d.familyMult[e.family] ?? 1) * e.value
        break
      case 'globalMult':
        globalProduct *= 1 + e.value
        break
      case 'likesMult':
        d.likesMult *= e.value
        break
      case 'speedMult':
        d.speedMult *= e.value
        break
      case 'concurrency':
        concurrency += e.value
        break
      case 'offlineCapHours':
        offlineBonus += e.value
        break
      case 'offlineEfficiency':
        // The best owned rate wins (Always On pays the full rate); never below the base.
        offlineEfficiency = Math.max(offlineEfficiency, e.value)
        break
      case 'powerBudget':
        // Summed by powerBudget() below; listed here so the switch stays exhaustive.
        break
      case 'payoutRatio':
        payoutBonus += e.value
        break
      case 'followRate':
        followRate *= e.value
        break
      case 'viralChance':
        viralBonus += e.value
        break
      case 'flopChance':
        flopReduction += e.value
        break
      case 'unlockFamily':
        if (!families.includes(e.family)) families.push(e.family)
        break
      case 'zluda':
        d.zluda = true
        break
      case 'apiNodes':
        d.apiNodes = true
        break
      case 'hashtagResearch':
        d.hashtagResearch = true
        break
      case 'streakGrace':
        d.streakGrace = true
        break
      case 'reservedCapacity':
        d.reservedCapacity = true
        break
      case 'coolingTier':
        d.coolingTier[e.family] = (d.coolingTier[e.family] ?? 0) + e.value
        break
      case 'tagLikes':
        if (e.tag !== WILDCARD_TAG) d.tagLikes[e.tag] = (d.tagLikes[e.tag] ?? 0) + e.value
        break
      case 'familyGenTime':
        d.familyGenTime[e.family] = (d.familyGenTime[e.family] ?? 1) * e.value
        break
      case 'weekSpeed':
        d.weekSpeed *= e.value
        break
      case 'startHardware':
        // Applied once at rebrand time (prestige.ts); nothing to fold here.
        break
      case 'cpMult':
        cpMultProduct *= e.value
        break
      default: {
        const never: never = e
        return never
      }
    }
  }

  // Trained LoRAs: a permanent likes bonus on their hashtag.
  for (const tag of state.loras) d.tagLikes[tag] = (d.tagLikes[tag] ?? 0) + LORA_TAG_LIKES

  // ---- hardware -----------------------------------------------------------
  let rawCps = 0
  let best: HardwareDef | null = null
  for (const id in state.hardware) {
    const count = state.hardware[id] ?? 0
    const def = hardwareById[id]
    if (!def || count <= 0) continue
    rawCps += count * def.baseCps * (d.rigMult[id] ?? 1) * (d.familyMult[def.family] ?? 1)
    if (def.vram > d.bestVram) d.bestVram = def.vram
    if (def.speedTier > d.bestTier) d.bestTier = def.speedTier
    if (!def.cpuOnly && !def.mps) d.hasGpu = true
    // Cooling tiers are folded above, so the ranking sees the same effective tier `genTimeMs` does.
    if (isFasterUnit(def, best, d)) best = def
  }
  d.rawCps = rawCps
  d.bestHardwareId = best ? best.id : null

  // ---- multipliers --------------------------------------------------------
  d.cpMult = 1 + CP_MULT_PER_POINT * state.cp * cpMultProduct
  d.globalMult =
    globalProduct *
    (1 + RP_MULT_PER_POINT * state.rp) *
    (1 + ACHIEVEMENT_MULT * state.achievements.length) *
    d.cpMult

  // ---- power --------------------------------------------------------------
  d.powerDraw = powerDraw(state, catalog)
  d.powerBudget = powerBudget(effects)
  d.throttled = isThrottled(d.powerDraw, d.powerBudget)

  // Past the breaker the rack is dark: no passive income at all until it fits the circuit (power.ts).
  d.cps = rawCps * d.globalMult * throttleMult(d.powerDraw, d.powerBudget)
  d.clickValue = (1 + clickFlat) * clickMult * d.globalMult + clickCpsPct * d.cps

  // ---- studio / social ----------------------------------------------------
  d.concurrency = 1 + concurrency
  d.payoutBonus = payoutBonus
  d.followRate = FOLLOW_RATE_BASE * followRate
  d.viralChance = VIRAL_CHANCE_BASE + viralBonus
  d.flopChance = Math.max(FLOP_CHANCE_MIN, FLOP_CHANCE_BASE - flopReduction)
  d.offlineCapHours = OFFLINE_CAP_HOURS_BASE + offlineBonus
  d.offlineEfficiency = offlineEfficiency
  d.unlockedFamilies = families
  return d
}
