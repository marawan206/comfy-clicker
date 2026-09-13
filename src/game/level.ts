/**
 * Player level.
 *
 * XP is derived from lifetime stats and never stored: credits earned are the backbone, posts are
 * log-compressed so nothing can be farmed, and achievements are the completionist lane. Everything
 * it reads survives a rebrand, so a prestige never demotes.
 *
 * The only saved field is `stats.levelSeen`, the watermark that makes the level-up reward
 * idempotent across reloads and cloud merges. An old save gets its retroactive level for free with
 * no migration and no back-pay (`hydrate` seeds the watermark).
 *
 * Import rule: this module may import only `@/game/types` and `@/game/constants`. `state.ts`
 * imports `playerLevel` for `statValue('level')`, so anything richer would be a cycle.
 */
import {
  LEVEL_REWARD_PER_LEVEL,
  LEVEL_REWARD_SECS,
  LEVEL_TITLES,
  LEVEL_XP,
  MAX_LEVEL,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_CREDITS,
  XP_LORA,
  XP_MAP_NODE,
  XP_POSTS,
  XP_QUANTIZE,
  XP_REBRAND,
} from '@/game/constants'
import type { Catalog, Derived, GameEvent, GameState, ModelDef } from '@/game/types'

export interface XpRow {
  key: string
  label: string
  xp: number
}

export interface LevelProgress {
  level: number
  xp: number
  /** XP threshold of the current level. */
  floor: number
  /** XP threshold of the next level (the current one at MAX_LEVEL). */
  ceiling: number
  /** 0..1 through the current level. 1 at MAX_LEVEL. */
  fraction: number
  xpToGo: number
}

const log10 = (n: number): number => Math.log10(1 + Math.max(0, n))
const log2 = (n: number): number => Math.log2(1 + Math.max(0, n))
const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0)

/**
 * Every XP source with its label, in display order. Each row is floored on its own, so the rows
 * always add up to `playerXp` exactly (the UI shows both).
 */
export function xpBreakdown(state: GameState): XpRow[] {
  const stats = state.stats
  return [
    { key: 'credits', label: 'credits earned', xp: whole(XP_CREDITS * log10(state.lifetimeCredits)) },
    { key: 'posts', label: 'posts', xp: whole(XP_POSTS * log2(stats.posts)) },
    { key: 'achievements', label: 'achievements', xp: whole(XP_ACHIEVEMENT * state.achievements.length) },
    { key: 'contracts', label: 'contracts done', xp: whole(XP_CONTRACT * stats.contractsDone) },
    { key: 'mapNodes', label: 'Graph nodes', xp: whole(XP_MAP_NODE * state.mapNodes.length) },
    { key: 'quantizations', label: 'quantizations', xp: whole(XP_QUANTIZE * stats.quantizations) },
    { key: 'loras', label: 'LoRAs trained', xp: whole(XP_LORA * stats.lorasTrained) },
    { key: 'rebrands', label: 'rebrands', xp: whole(XP_REBRAND * stats.rebrands) },
  ]
}

/** Total XP: the sum of `xpBreakdown`. */
export function playerXp(state: GameState): number {
  let total = 0
  for (const row of xpBreakdown(state)) total += row.xp
  return total
}

/** Highest level whose threshold `xp` has reached. Clamped to 1..MAX_LEVEL. */
export function levelForXp(xp: number): number {
  const value = typeof xp === 'number' && !Number.isNaN(xp) ? xp : 0
  let level = 1
  for (let i = 1; i < LEVEL_XP.length && i < MAX_LEVEL; i++) {
    if (value < (LEVEL_XP[i] as number)) break
    level = i + 1
  }
  return level
}

/** XP threshold for `level`, clamped to the table. */
export function xpForLevel(level: number): number {
  const i = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1))) - 1
  return LEVEL_XP[i] as number
}

/**
 * The level the player is on: the XP level, floored by the watermark so a level already announced
 * can never be taken back (a catalog reshuffle or a rounding change must not demote anyone).
 */
export function playerLevel(state: GameState): number {
  const seen = Number.isFinite(state.stats.levelSeen) ? Math.floor(state.stats.levelSeen) : 1
  return Math.min(MAX_LEVEL, Math.max(1, levelForXp(playerXp(state)), seen))
}

/** Level, XP and the bar between the current threshold and the next. */
export function levelProgress(state: GameState): LevelProgress {
  const level = playerLevel(state)
  const xp = playerXp(state)
  const floor = xpForLevel(level)
  const ceiling = level >= MAX_LEVEL ? floor : xpForLevel(level + 1)
  const span = ceiling - floor
  const fraction = span > 0 ? Math.min(1, Math.max(0, (xp - floor) / span)) : 1
  const xpToGo = span > 0 ? Math.max(0, ceiling - xp) : 0
  return { level, xp, floor, ceiling, fraction, xpToGo }
}

/** e.g. `Guidance Scale`. Levels outside the table fall back to the last title. */
export function levelTitle(level: number): string {
  const i = Math.min(LEVEL_TITLES.length, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1))) - 1
  return (LEVEL_TITLES[i] as string) ?? ''
}

/** Credits paid for reaching `level`: a flat ladder early, 90 seconds of income once that is bigger. */
export function levelReward(level: number, cps: number): number {
  const flat = LEVEL_REWARD_PER_LEVEL * Math.max(1, Math.floor(Number.isFinite(level) ? level : 1))
  const income = Number.isFinite(cps) && cps > 0 ? Math.round(LEVEL_REWARD_SECS * cps) : 0
  return Math.max(flat, income)
}

/** Models whose `minLevel` is exactly `level`, in catalog order. */
export function modelsUnlockedAt(level: number, catalog: Catalog): ModelDef[] {
  return catalog.models.filter((m) => (m.minLevel ?? 1) === level)
}

/** `null` when the model is within reach, otherwise the level it needs and the level you are on. */
export function modelLevelLock(model: ModelDef, state: GameState): { need: number; have: number } | null {
  const need = Math.max(1, Math.floor(model.minLevel ?? 1))
  if (need <= 1) return null
  const have = playerLevel(state)
  return have >= need ? null : { need, have }
}

/**
 * Pay out every level crossed since the last time we looked, one event per level in order, and
 * move the watermark. Idempotent: a second call in the same state is silent.
 *
 * The reward would normally go through `addCredits` (engine.ts), but engine.ts imports state.ts,
 * which imports this module, so the three credit counters move inline here instead. Keep this in
 * step with `addCredits`. Paying credits raises lifetime credits and so can cross another
 * threshold on the same call; the loop catches that, bounded by MAX_LEVEL.
 */
export function settleLevelUps(state: GameState, derived: Derived, catalog: Catalog): GameEvent[] {
  const out: GameEvent[] = []
  if (!Number.isFinite(state.stats.levelSeen)) state.stats.levelSeen = 1
  for (let guard = 0; guard < MAX_LEVEL; guard++) {
    const next = state.stats.levelSeen + 1
    if (next > MAX_LEVEL || playerLevel(state) < next) break
    const credits = levelReward(next, derived.cps)
    state.credits += credits
    state.lifetimeCredits += credits
    state.seasonCredits += credits
    state.stats.levelSeen = next
    out.push({
      type: 'levelUp',
      level: next,
      credits,
      unlocked: modelsUnlockedAt(next, catalog).map((m) => m.id),
    })
  }
  return out
}
