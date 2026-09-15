/**
 * Player level.
 *
 * XP has two parts. The credits term is derived from lifetime credits and never stored
 * (`creditsXp`: XP_CREDITS per decade). Everything else is an activity ledger, `stats.xpBy`,
 * banked per source by `grantXp` the moment the player does the thing: a landed post, a claimed
 * contract, an achievement, a Graph node, the first unit of a card, an upgrade, a tier, a model
 * set up, a quantization, a LoRA, the daily, an income milestone, a rebrand. Every grant returns
 * an `xp` event so the UI can float it. Lifetime credits and the ledger both survive a rebrand,
 * so a prestige never demotes.
 *
 * The only other saved field is `stats.levelSeen`, the watermark that makes the level-up reward
 * idempotent across reloads and cloud merges. A save from before the ledger gets it seeded from
 * the counters it already has (`legacyXp` in save.ts); the next `settleLevelUps` then pays and
 * announces whatever level that adds up to.
 *
 * Import rule: this module may import only `@/game/types` and `@/game/constants`. `state.ts`
 * imports `playerLevel` for `statValue('level')`, so anything richer would be a cycle.
 */
import {
  LEVEL_REWARD_PER_LEVEL,
  LEVEL_REWARD_SECS,
  LEVEL_TITLES,
  LEVEL_XP,
  LOUNGE_MIN_LEVEL,
  MAX_LEVEL,
  XP_CREDITS,
  XP_DAILY_PER_DAY,
  XP_POST_BASE,
  XP_POST_PER_LEVEL,
  XP_VIRAL_MULT,
} from '@/game/constants'
import type { Catalog, Derived, GameEvent, GameState, HardwareDef, ModelDef, XpSource } from '@/game/types'

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

/** One rung of the roadmap: what reaching the level opens. */
export interface LevelRung {
  level: number
  title: string
  /** XP threshold of the level. */
  xp: number
  models: ModelDef[]
  hardware: HardwareDef[]
  features: string[]
}

/** Every activity source, in the order the breakdown lists them. */
export const XP_SOURCES: readonly XpSource[] = [
  'post',
  'viral',
  'contract',
  'achievement',
  'mapNode',
  'hardware',
  'upgrade',
  'tier',
  'setup',
  'quantize',
  'lora',
  'daily',
  'milestone',
  'rebrand',
]

export const XP_SOURCE_LABELS: Record<XpSource, string> = {
  post: 'posts',
  viral: 'viral posts',
  contract: 'contracts done',
  achievement: 'achievements',
  mapNode: 'Graph nodes',
  hardware: 'new cards',
  upgrade: 'upgrades',
  tier: 'tier upgrades',
  setup: 'models set up',
  quantize: 'quantizations',
  lora: 'LoRAs trained',
  daily: 'daily logins',
  milestone: 'income milestones',
  rebrand: 'rebrands',
}

/** The feature the Lounge level opens, as the roadmap names it. */
export const LOUNGE_FEATURE_NAME = 'The Latent Lounge'

/** The daily cycle length (DAILY_CYCLE_DAYS in daily.ts, which this module cannot import). */
const DAILY_XP_MAX_DAY = 7

/** A whole, non-negative number, or 0 for anything that is not one. */
const whole = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0

/** One source's banked XP, sanitised: a corrupt ledger value reads as zero, never as NaN. */
function banked(state: GameState, source: XpSource): number {
  return whole(state.stats.xpBy?.[source])
}

/** The derived term: XP_CREDITS per decade of lifetime credits, floored. */
export function creditsXp(state: GameState): number {
  return whole(XP_CREDITS * Math.log10(1 + Math.max(0, state.lifetimeCredits)))
}

/** The activity ledger, summed. Only finite, non-negative values count. */
export function activityXp(state: GameState): number {
  let total = 0
  for (const source of XP_SOURCES) total += banked(state, source)
  return total
}

/** Total XP: the credits term plus the ledger. */
export function playerXp(state: GameState): number {
  return creditsXp(state) + activityXp(state)
}

/**
 * Every XP source with its label, in display order: the credits term first, then each ledger row
 * that has banked anything. Every row is a whole number, so the rows add up to `playerXp` exactly
 * (the UI shows both).
 */
export function xpBreakdown(state: GameState): XpRow[] {
  const rows: XpRow[] = [{ key: 'credits', label: 'credits earned', xp: creditsXp(state) }]
  for (const source of XP_SOURCES) {
    const xp = banked(state, source)
    if (xp > 0) rows.push({ key: source, label: XP_SOURCE_LABELS[source], xp })
  }
  return rows
}

/**
 * Bank `amount` of XP under `source` and return the `xp` event to announce it. The amount is
 * floored; nothing at all happens for a grant that rounds to zero or is not a number.
 */
export function grantXp(state: GameState, amount: number, source: XpSource): GameEvent | null {
  const xp = Number.isFinite(amount) ? Math.floor(amount) : 0
  if (xp <= 0) return null
  const ledger = state.stats.xpBy ?? (state.stats.xpBy = {})
  ledger[source] = whole(ledger[source]) + xp
  return { type: 'xp', amount: xp, source }
}

/** XP for a landed post on `model`: a base plus a slice per level the model needs, doubled when viral. */
export function postXp(model: ModelDef, viral: boolean): number {
  const level = Math.max(1, Math.floor(Number.isFinite(model.minLevel) ? (model.minLevel as number) : 1))
  return (XP_POST_BASE + XP_POST_PER_LEVEL * level) * (viral ? XP_VIRAL_MULT : 1)
}

/** XP for claiming the daily on cycle day `day` (1..7): the streak is what pays. */
export function dailyXp(day: number): number {
  const d = Number.isFinite(day) ? Math.floor(day) : 1
  return XP_DAILY_PER_DAY * Math.min(DAILY_XP_MAX_DAY, Math.max(1, d))
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

/** `null` when `minLevel` is within reach, otherwise the level it needs and the level you are on. */
function levelLock(minLevel: number | undefined, state: GameState): { need: number; have: number } | null {
  const need = Math.max(1, Math.floor(Number.isFinite(minLevel) ? (minLevel as number) : 1))
  if (need <= 1) return null
  const have = playerLevel(state)
  return have >= need ? null : { need, have }
}

/** Models whose `minLevel` is exactly `level`, in catalog order. Level 1 takes the ones with none. */
export function modelsUnlockedAt(level: number, catalog: Catalog): ModelDef[] {
  return catalog.models.filter((m) => (m.minLevel ?? 1) === level)
}

/** Hardware whose `minLevel` is exactly `level`, in catalog order. Level 1 takes the units with none. */
export function hardwareUnlockedAt(level: number, catalog: Catalog): HardwareDef[] {
  return catalog.hardware.filter((h) => (h.minLevel ?? 1) === level)
}

/** `null` when the model is within reach, otherwise the level it needs and the level you are on. */
export function modelLevelLock(model: ModelDef, state: GameState): { need: number; have: number } | null {
  return levelLock(model.minLevel, state)
}

/** The same rule for a unit in the store: `null` within reach, else `{ need, have }`. */
export function hardwareLevelLock(def: HardwareDef, state: GameState): { need: number; have: number } | null {
  return levelLock(def.minLevel, state)
}

/** Features (not cards, not checkpoints) a level opens: the Lounge at its level, nothing elsewhere. */
export function featuresUnlockedAt(level: number): string[] {
  return level === LOUNGE_MIN_LEVEL ? [LOUNGE_FEATURE_NAME] : []
}

function buildRung(level: number, catalog: Catalog): LevelRung {
  return {
    level,
    title: levelTitle(level),
    xp: xpForLevel(level),
    models: modelsUnlockedAt(level, catalog),
    hardware: hardwareUnlockedAt(level, catalog),
    features: featuresUnlockedAt(level),
  }
}

/**
 * The roadmap per catalog object (the tick-memo pattern, as `buildIndex` does). A rung is a pure
 * function of the level and the catalog, and `nextUnlocks` sits under a 20 Hz selector through
 * `goals.nextGoal`, so scanning the catalog twice per tick for an answer that never changes was
 * garbage for nothing.
 */
const roadmaps = new WeakMap<Catalog, LevelRung[]>()

/**
 * One rung per level, 1..MAX_LEVEL, with everything each one opens. Built once per catalog object
 * and shared from then on: read it, never mutate it.
 */
export function levelRoadmap(catalog: Catalog): LevelRung[] {
  let rungs = roadmaps.get(catalog)
  if (!rungs) {
    rungs = []
    for (let level = 1; level <= MAX_LEVEL; level++) rungs.push(buildRung(level, catalog))
    roadmaps.set(catalog, rungs)
  }
  return rungs
}

function rungAt(level: number, catalog: Catalog): LevelRung {
  return levelRoadmap(catalog)[level - 1] as LevelRung
}

/** What the level after `level` opens: the cached rung's lists, shared. Empty at MAX_LEVEL. */
export function nextUnlocks(
  level: number,
  catalog: Catalog,
): { models: ModelDef[]; hardware: HardwareDef[]; features: string[] } {
  const current = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1))
  if (current >= MAX_LEVEL) return { models: [], hardware: [], features: [] }
  const rung = rungAt(current + 1, catalog)
  return { models: rung.models, hardware: rung.hardware, features: rung.features }
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
      hardware: hardwareUnlockedAt(next, catalog).map((h) => h.id),
    })
  }
  return out
}
