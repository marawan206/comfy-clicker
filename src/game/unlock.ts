/**
 * Unlock conditions: the one predicate language shared by store visibility,
 * upgrades, map nodes and achievements.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { formatInt } from '@/game/format'
import { FAMILY_LABELS, STAT_LABELS, statValue } from '@/game/state'
import type { Derived, GameState, HardwareFamily, UnlockCond } from '@/game/types'

const TIER_UPGRADE_PREFIX = 'tier:'

/**
 * Tier upgrades are virtual (`tier:<hardwareId>:<1..4>`) and live in `state.hardwareTiers`,
 * not `state.upgrades`. Returns `[hardwareId, tier]` or null for a regular upgrade id.
 */
function parseTierUpgradeId(id: string): [string, number] | null {
  if (!id.startsWith(TIER_UPGRADE_PREFIX)) return null
  const lastColon = id.lastIndexOf(':')
  if (lastColon <= TIER_UPGRADE_PREFIX.length - 1) return null
  const hardwareId = id.slice(TIER_UPGRADE_PREFIX.length, lastColon)
  const tier = Number(id.slice(lastColon + 1))
  if (!hardwareId || !Number.isInteger(tier) || tier < 1) return null
  return [hardwareId, tier]
}

/** Units owned across every hardware def in a family. */
export function ownedInFamily(state: GameState, family: HardwareFamily, catalog: Catalog): number {
  const { hardwareById } = buildIndex(catalog)
  let total = 0
  for (const id in state.hardware) {
    const def = hardwareById[id]
    if (def && def.family === family) total += state.hardware[id] ?? 0
  }
  return total
}

/** Owns a regular upgrade, or has reached the given tier for a virtual `tier:` upgrade. */
export function hasUpgrade(state: GameState, id: string): boolean {
  if (state.upgrades.includes(id)) return true
  const tier = parseTierUpgradeId(id)
  return tier !== null && (state.hardwareTiers[tier[0]] ?? 0) >= tier[1]
}

/** `undefined` means "always available". */
export function isUnlocked(
  cond: UnlockCond | undefined,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): boolean {
  if (!cond) return true
  switch (cond.type) {
    case 'always':
      return true
    case 'stat':
      return statValue(state, cond.key, derived) >= cond.value
    case 'ownHardware':
      return (state.hardware[cond.id] ?? 0) >= (cond.count ?? 1)
    case 'ownFamily':
      return ownedInFamily(state, cond.family, catalog) >= (cond.count ?? 1)
    case 'ownModel':
      return cond.id in state.models
    case 'precision': {
      const model = state.models[cond.modelId]
      return model !== undefined && model.precisions.includes(cond.precision)
    }
    case 'mapNode':
      return state.mapNodes.includes(cond.id)
    case 'upgrade':
      return hasUpgrade(state, cond.id)
    case 'cps':
      return derived.cps >= cond.value
    case 'flag':
      return state.flags[cond.key] === true
    case 'all':
      return cond.conds.every((c) => isUnlocked(c, state, derived, catalog))
    case 'any':
      return cond.conds.some((c) => isUnlocked(c, state, derived, catalog))
    default: {
      const never: never = cond
      return never
    }
  }
}

/** Short, human-readable requirement for tooltips, e.g. `Own 5× RTX 3060`. */
export function describeUnlock(cond: UnlockCond | undefined, catalog: Catalog): string {
  if (!cond) return ''
  const index = buildIndex(catalog)
  switch (cond.type) {
    case 'always':
      return ''
    case 'stat':
      return `Reach ${formatInt(cond.value)} ${STAT_LABELS[cond.key]}`
    case 'ownHardware': {
      const name = index.hardwareById[cond.id]?.name ?? cond.id
      const n = cond.count ?? 1
      return n > 1 ? `Own ${n}× ${name}` : `Own ${name}`
    }
    case 'ownFamily': {
      const n = cond.count ?? 1
      const label = FAMILY_LABELS[cond.family]
      return n > 1 ? `Own ${n} ${label} units` : `Own any ${label} unit`
    }
    case 'ownModel':
      return `Own ${index.modelById[cond.id]?.name ?? cond.id}`
    case 'precision': {
      const name = index.modelById[cond.modelId]?.name ?? cond.modelId
      const label = catalog.precisions[cond.precision]?.label ?? cond.precision
      return `Quantize ${name} to ${label}`
    }
    case 'mapNode':
      return `Unlock ${index.mapNodeById[cond.id]?.title ?? cond.id}`
    case 'upgrade': {
      const tier = parseTierUpgradeId(cond.id)
      if (tier) {
        const hw = index.hardwareById[tier[0]]?.short ?? tier[0]
        return `Reach ${hw} tier ${tier[1]}`
      }
      return `Buy ${index.upgradeById[cond.id]?.name ?? cond.id}`
    }
    case 'cps':
      return `Reach ${formatInt(cond.value)} credits/s`
    case 'flag':
      return 'Secret'
    case 'all':
      return cond.conds
        .map((c) => describeUnlock(c, catalog))
        .filter(Boolean)
        .join(' and ')
    case 'any':
      return cond.conds
        .map((c) => describeUnlock(c, catalog))
        .filter(Boolean)
        .join(' or ')
    default: {
      const never: never = cond
      return never
    }
  }
}
