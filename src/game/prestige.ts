/**
 * Rebrand (prestige). Once the studio runs on a cloud node or a region the player can start a new
 * season: credits, rigs, credit-bought upgrades, models, queue, feed, contracts and events reset;
 * Comfy Points equal to `rebrandCp(seasonCredits)` are banked and every CP raises the global
 * multiplier forever (derived.ts). Achievements, the whole map, RP, CP, LoRAs, hub rep, the daily
 * streak and flags survive. Prestige map nodes with `startHardware` seed the new season's rack.
 *
 * Followers reset with the account. It is a rebrand, and "Legacy Audience" on the prestige lane
 * exists precisely because they normally do not remember you. Lifetime stats are untouched.
 */
import type { Catalog } from '@/data'
import { buildIndex } from '@/game/catalog'
import { EVENT_MIN_GAP_MS, REBRAND_CP_DIVISOR, REBRAND_CP_EXP, XP_REBRAND } from '@/game/constants'
import { grantXp } from '@/game/level'
import { STARTER_HARDWARE_ID, STARTER_MODEL_ID } from '@/game/state'
import type { Effect, GameEvent, GameState, HardwareFamily } from '@/game/types'

/** Owning any unit in one of these families unlocks the Rebrand button. */
export const REBRAND_FAMILIES: readonly HardwareFamily[] = ['cloud-node', 'region']

export function canRebrand(state: GameState, catalog: Catalog): boolean {
  const { hardwareById } = buildIndex(catalog)
  for (const id in state.hardware) {
    if ((state.hardware[id] ?? 0) <= 0) continue
    const family = hardwareById[id]?.family
    if (family && REBRAND_FAMILIES.includes(family)) return true
  }
  return false
}

/** CP for a season: floor((credits / 1e8) ^ 0.45): 1e8 → 1, 1e10 → 7, 1e12 → 63. */
export function rebrandCp(seasonCredits: number): number {
  if (!(seasonCredits > 0)) return 0
  return Math.floor((seasonCredits / REBRAND_CP_DIVISOR) ** REBRAND_CP_EXP)
}

/** CP the player would bank by rebranding right now. */
export function rebrandPreview(state: GameState): number {
  return rebrandCp(state.seasonCredits)
}

/** Season credits needed for `cp` points (inverse of `rebrandCp`, for "next CP at …" hints). */
export function creditsForCp(cp: number): number {
  if (cp <= 0) return 0
  return REBRAND_CP_DIVISOR * cp ** (1 / REBRAND_CP_EXP)
}

/** Effects that persist across seasons: unlocked map nodes plus upgrades bought with RP/CP. */
function persistentEffects(state: GameState, catalog: Catalog): Effect[] {
  const { upgradeById, mapNodeById } = buildIndex(catalog)
  const out: Effect[] = []
  for (const id of state.upgrades) {
    const def = upgradeById[id]
    if (def) out.push(...def.effects)
  }
  for (const id of state.mapNodes) {
    const def = mapNodeById[id]
    if (def) out.push(...def.effects)
  }
  return out
}

/** Upgrades that survive a rebrand: anything not paid for in (resettable) credits. */
export function isPrestigeUpgrade(id: string, catalog: Catalog): boolean {
  const def = buildIndex(catalog).upgradeById[id]
  return def !== undefined && def.currency !== undefined && def.currency !== 'credits'
}

/**
 * Starts a new season. Returns `[]` and leaves the state untouched when `canRebrand` is false.
 * The catalog is consulted for kept upgrades and `startHardware` effects only.
 */
export function rebrand(state: GameState, catalog: Catalog, now: number): GameEvent[] {
  if (!canRebrand(state, catalog)) return []
  const cp = rebrandCp(state.seasonCredits)

  // Reset the season.
  state.credits = 0
  state.seasonCredits = 0
  state.hardwareTiers = {}
  state.upgrades = state.upgrades.filter((id) => isPrestigeUpgrade(id, catalog))
  state.models = { [STARTER_MODEL_ID]: { precisions: ['native'], setup: true } }
  state.queue = []
  state.posts = []
  state.followers = 0
  state.followersFrac = 0
  state.contracts = { active: [], nextRotateAt: now }
  state.events = { active: [], nextAt: now + EVENT_MIN_GAP_MS }
  state.stats.lastPostKey = ''

  // Seed the new rack: the starter box plus every persistent `startHardware` effect.
  const hardware: Record<string, number> = { [STARTER_HARDWARE_ID]: 1 }
  for (const effect of persistentEffects(state, catalog)) {
    if (effect.kind === 'startHardware' && effect.count > 0) {
      hardware[effect.hardwareId] = (hardware[effect.hardwareId] ?? 0) + effect.count
    }
  }
  state.hardware = hardware

  // Bank the season. Stats survive it, so the XP ledger does too: the rebrand itself is XP the
  // new season starts with.
  state.cp += cp
  state.meta.season += 1
  state.stats.rebrands += 1
  const events: GameEvent[] = [{ type: 'rebrand', cp }]
  const xp = grantXp(state, XP_REBRAND, 'rebrand')
  if (xp) events.push(xp)
  return events
}
