/**
 * Goals: the single answer to "what should I do next" and "which achievement am I closest to".
 *
 * Nothing here invents game math. Prices come from economy.ts, gates from unlock.ts and
 * hardware.ts, fees from quantize.ts, node availability and balances from map.ts, the XP bar from
 * level.ts. The store's save-for bar and the Next up panel read the same `saveTarget`, so they can
 * never quote different numbers.
 *
 * Everything is called from 20 Hz selectors: each function is one pass over the catalog with no
 * intermediate arrays, and returns primitives or one small flat object.
 */
import type { Catalog } from '@/data'
import { hasAchievement } from '@/game/achievements'
import { buildIndex } from '@/game/catalog'
import { unitCost } from '@/game/economy'
import { formatInt, formatNum } from '@/game/format'
import { runsOn } from '@/game/hardware'
import { hardwareLevelLock, levelProgress, modelLevelLock, nextUnlocks, playerLevel } from '@/game/level'
import { currencyBalance, mapNodeAvailable, mapNodeCost } from '@/game/map'
import { setupFee } from '@/game/quantize'
import { FAMILY_LABELS, STAT_LABELS, statValue } from '@/game/state'
import { describeUnlock, isUnlocked, ownedInFamily } from '@/game/unlock'
import type {
  Currency,
  Derived,
  GameState,
  HardwareDef,
  HardwareFamily,
  ModelDef,
  StatKey,
  UnlockCond,
} from '@/game/types'

// ---------------------------------------------------------------------------
// Progress over an unlock condition
// ---------------------------------------------------------------------------

export interface Progress {
  /** Where the player is, in the condition's own unit. Fractional when credits count (see below). */
  current: number
  /** What the condition asks for. 1 for a yes/no condition. */
  target: number
  /** `current / target`, clamped to [0, 1]. */
  fraction: number
  /** `9,120 / 10,000 likes` for a measurable condition, `describeUnlock` for a yes/no one. */
  label: string
}

/** `Progress` plus the flag `nextAchievements` ranks with: a yes/no condition has no bar to draw. */
interface Measured extends Progress {
  binary: boolean
}

const COMPLETE: Measured = { current: 1, target: 1, fraction: 1, label: '', binary: true }
const NOTHING: Measured = { current: 0, target: 1, fraction: 0, label: '', binary: true }

function clamp01(n: number): number {
  if (!(n > 0)) return 0
  return n > 1 ? 1 : n
}

/** 0..100 integer, so a bar re-renders at most a hundred times per target. */
function pctOf(fraction: number): number {
  return Math.floor(clamp01(fraction) * 100)
}

/** A measurable condition: the bar is `current / target`. A zero target is already met. */
function scaled(current: number, target: number, label: string): Measured {
  return { current, target, fraction: target > 0 ? clamp01(current / target) : 1, label, binary: false }
}

/** A yes/no condition: 0 or 1, described the way every other tooltip describes it. */
function yesNo(cond: UnlockCond, state: GameState, derived: Derived, catalog: Catalog): Measured {
  const ok = isUnlocked(cond, state, derived, catalog)
  return { current: ok ? 1 : 0, target: 1, fraction: ok ? 1 : 0, label: describeUnlock(cond, catalog), binary: true }
}

/** Full digits up to six figures, compact above, so a bar label never runs off the panel. */
function pair(current: number, target: number): string {
  const fmt = Math.max(Math.abs(current), Math.abs(target)) >= 1e6 ? formatNum : formatInt
  return `${fmt(current)} / ${fmt(target)}`
}

function statLabel(key: StatKey, current: number, target: number): string {
  // "4 / 9 level" reads wrong; the level gate is the one stat whose unit goes first.
  if (key === 'level') return `level ${pair(current, target)}`
  return `${pair(current, target)} ${STAT_LABELS[key]}`
}

/** Share of the next unit already paid for. A free unit (or an affordable one) is a whole unit. */
function bankedTowards(credits: number, cost: number): number {
  if (!(cost > 0)) return 1
  return clamp01(credits / cost)
}

/** Price of the cheapest unit in a family the store would show. Infinity when there is none. */
function cheapestUnitCost(
  family: HardwareFamily,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): number {
  let best = Infinity
  for (const def of catalog.hardware) {
    if (def.family !== family) continue
    if (!isUnlocked(def.unlock, state, derived, catalog)) continue
    const cost = unitCost(def, state.hardware[def.id] ?? 0)
    if (cost < best) best = cost
  }
  return best
}

function measure(
  cond: UnlockCond | undefined,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): Measured {
  if (!cond) return COMPLETE
  switch (cond.type) {
    case 'always':
      return COMPLETE
    case 'stat': {
      const current = statValue(state, cond.key, derived)
      return scaled(current, cond.value, statLabel(cond.key, current, cond.value))
    }
    case 'cps':
      return scaled(derived.cps, cond.value, `${pair(derived.cps, cond.value)} credits/s`)
    case 'ownHardware': {
      // Credits already banked toward the next unit count: that near miss is what the panel is for.
      const def = buildIndex(catalog).hardwareById[cond.id]
      const owned = state.hardware[cond.id] ?? 0
      const count = cond.count ?? 1
      const banked = def && owned < count ? bankedTowards(state.credits, unitCost(def, owned)) : 0
      return scaled(owned + banked, count, `${pair(owned, count)} ${def?.name ?? cond.id}`)
    }
    case 'ownFamily': {
      const owned = ownedInFamily(state, cond.family, catalog)
      const count = cond.count ?? 1
      const cost = owned < count ? cheapestUnitCost(cond.family, state, derived, catalog) : Infinity
      const banked = Number.isFinite(cost) ? bankedTowards(state.credits, cost) : 0
      return scaled(owned + banked, count, `${pair(owned, count)} ${FAMILY_LABELS[cond.family]} units`)
    }
    case 'ownModel':
    case 'precision':
    case 'mapNode':
    case 'upgrade':
    case 'flag':
      return yesNo(cond, state, derived, catalog)
    case 'all': {
      // The bar shows the blocker: the child furthest from done.
      let worst: Measured | null = null
      for (const child of cond.conds) {
        const m = measure(child, state, derived, catalog)
        if (!worst || m.fraction < worst.fraction) worst = m
      }
      return worst ?? COMPLETE
    }
    case 'any': {
      // Any one branch finishes it, so the closest branch is the bar.
      let best: Measured | null = null
      for (const child of cond.conds) {
        const m = measure(child, state, derived, catalog)
        if (!best || m.fraction > best.fraction) best = m
      }
      return best ?? NOTHING
    }
    default: {
      const never: never = cond
      return never
    }
  }
}

/**
 * How far along an unlock condition the player is. `stat` and `cps` divide by the threshold;
 * `ownHardware` and `ownFamily` add the credits already banked toward the next unit; everything
 * else is 0 or 1. `all` reports its furthest child, `any` its closest.
 */
export function condProgress(
  cond: UnlockCond | undefined,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): Progress {
  const m = measure(cond, state, derived, catalog)
  return { current: m.current, target: m.target, fraction: m.fraction, label: m.label }
}

// ---------------------------------------------------------------------------
// Nearest achievements
// ---------------------------------------------------------------------------

export interface NextAchievement {
  id: string
  name: string
  desc: string
  icon: string
  current: number
  target: number
  fraction: number
  label: string
}

/** True when `p` should be listed before the ranked entry at `index`. */
function ranksBefore(p: Measured, entry: NextAchievement, entryBinary: boolean): boolean {
  // A yes/no achievement has no bar, so it never outranks something with a visible near miss.
  if (p.binary !== entryBinary) return !p.binary
  if (p.fraction !== entry.fraction) return p.fraction > entry.fraction
  if (p.target !== entry.target) return p.target < entry.target
  return false
}

/**
 * The achievements the player is closest to: not hidden (they stay `???`), not earned, not already
 * complete. Ranked by fraction descending, then the smaller target, then catalog order, with
 * yes/no conditions sunk to the bottom.
 *
 * Insertion into a list of `n` rather than a sort of the whole catalog: this runs in a selector.
 */
export function nextAchievements(
  state: GameState,
  derived: Derived,
  catalog: Catalog,
  n = 3,
): NextAchievement[] {
  const limit = Math.max(0, Math.floor(n))
  const out: NextAchievement[] = []
  if (limit === 0) return out
  const binary: boolean[] = []
  for (const def of catalog.achievements) {
    if (def.hidden) continue
    if (hasAchievement(state, def.id)) continue
    const p = measure(def.cond, state, derived, catalog)
    if (p.fraction >= 1) continue
    let at = 0
    while (at < out.length && !ranksBefore(p, out[at] as NextAchievement, binary[at] as boolean)) at++
    if (at >= limit) continue
    out.splice(at, 0, {
      id: def.id,
      name: def.name,
      desc: def.desc,
      icon: def.icon,
      current: p.current,
      target: p.target,
      fraction: p.fraction,
      label: p.label,
    })
    binary.splice(at, 0, p.binary)
    if (out.length > limit) {
      out.pop()
      binary.pop()
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The next goal
// ---------------------------------------------------------------------------

export type Goal =
  | { kind: 'claim'; index: number; title: string; reward: number }
  | { kind: 'setup'; modelId: string; name: string; fee: number }
  | {
      kind: 'buy'
      hardwareId: string
      name: string
      family: HardwareFamily
      cost: number
      pct: number
      etaSec: number
      /** Name of the biggest model this unit would newly run natively, or null. */
      unlocksModel: string | null
    }
  | { kind: 'node'; nodeId: string; title: string; cost: number; currency: Currency }
  | {
      kind: 'level'
      /** The level to reach: the current one plus one. */
      level: number
      pct: number
      xpToGo: number
      /** Up to LEVEL_GOAL_UNLOCKS names that level opens, hardware first, then models. */
      unlocks: string[]
    }

export interface HardwareTarget {
  def: HardwareDef
  cost: number
  /** 0..100 integer. */
  pct: number
  /** Whole seconds until affordable at the current rate; Infinity when cps is 0. */
  etaSec: number
}

/**
 * The cheapest visible, purchasable-but-unaffordable unit: what the player is implicitly saving
 * for. Null when everything visible is affordable (or locked for a reason credits cannot fix).
 *
 * The gates mirror `canBuy`'s non-credit checks (family unlocked, store unlock condition, player
 * level, cap) in the same order; the price is `unitCost`, so the store row and this never
 * disagree. A level-locked unit is skipped: saving for it buys nothing until the bar moves, and
 * `levelBlocked` is the function that says so.
 */
export function saveTarget(state: GameState, derived: Derived, catalog: Catalog): HardwareTarget | null {
  let best: HardwareDef | null = null
  let bestCost = Infinity
  for (const def of catalog.hardware) {
    if (!derived.unlockedFamilies.includes(def.family)) continue
    if (!isUnlocked(def.unlock, state, derived, catalog)) continue
    if (hardwareLevelLock(def, state)) continue
    const owned = state.hardware[def.id] ?? 0
    if (def.max !== undefined && owned >= def.max) continue
    const cost = unitCost(def, owned)
    if (cost > state.credits && cost < bestCost) {
      best = def
      bestCost = cost
    }
  }
  if (!best) return null
  return {
    def: best,
    cost: bestCost,
    pct: pctOf(state.credits / bestCost),
    etaSec: derived.cps > 0 ? Math.ceil((bestCost - state.credits) / derived.cps) : Infinity,
  }
}

/**
 * True when the level is the only thing between the player and a unit already paid for: some
 * unit passes the family, unlock and cap checks, fails the level, and its next unit costs no more
 * than the bank. That is the moment the Next up panel points at the bar instead of the shelf.
 */
export function levelBlocked(state: GameState, derived: Derived, catalog: Catalog): boolean {
  for (const def of catalog.hardware) {
    if (!derived.unlockedFamilies.includes(def.family)) continue
    if (!isUnlocked(def.unlock, state, derived, catalog)) continue
    if (!hardwareLevelLock(def, state)) continue
    const owned = state.hardware[def.id] ?? 0
    if (def.max !== undefined && owned >= def.max) continue
    if (state.credits >= unitCost(def, owned)) return true
  }
  return false
}

/** Whether anything already installed runs the model at native precision. */
function ownedRunsNatively(model: ModelDef, state: GameState, derived: Derived, catalog: Catalog): boolean {
  const { hardwareById } = buildIndex(catalog)
  for (const id in state.hardware) {
    if ((state.hardware[id] ?? 0) <= 0) continue
    const hw = hardwareById[id]
    if (hw && runsOn(model, 'native', hw, derived, catalog)) return true
  }
  return false
}

/**
 * The biggest model `def` would newly run at native precision: the "unlocks FLUX.1 dev native"
 * half of a save-for line. Level-locked models are skipped, so the hint never promises something
 * the purchase cannot deliver.
 */
function unlocksNatively(
  def: HardwareDef,
  state: GameState,
  derived: Derived,
  catalog: Catalog,
): string | null {
  let best: ModelDef | null = null
  for (const model of catalog.models) {
    if (model.api) continue
    if (best && model.vram <= best.vram) continue
    if (!(model.id in state.models) && !isUnlocked(model.unlock, state, derived, catalog)) continue
    if (modelLevelLock(model, state)) continue
    if (!runsOn(model, 'native', def, derived, catalog)) continue
    if (ownedRunsNatively(model, state, derived, catalog)) continue
    best = model
  }
  return best ? best.name : null
}

/** The first contract sitting done and unclaimed: free credits nobody should leave on the table. */
function claimGoal(state: GameState, catalog: Catalog): Goal | null {
  const active = state.contracts.active
  for (let i = 0; i < active.length; i++) {
    const c = active[i]
    if (!c || !c.done || c.claimed) continue
    const def = buildIndex(catalog).contractById[c.defId]
    return { kind: 'claim', index: i, title: def?.title ?? c.defId, reward: c.rewardCredits }
  }
  return null
}

/** The cheapest model the player could set up right now, free ones first. */
function setupGoal(state: GameState, derived: Derived, catalog: Catalog): Goal | null {
  let best: ModelDef | null = null
  let bestFee = Infinity
  for (const model of catalog.models) {
    if (state.models[model.id]?.setup) continue
    if (modelLevelLock(model, state)) continue
    if (!isUnlocked(model.unlock, state, derived, catalog)) continue
    if (model.api && !derived.apiNodes) continue
    const fee = setupFee(model, derived, catalog)
    if (fee > state.credits || fee >= bestFee) continue
    best = model
    bestFee = fee
  }
  return best ? { kind: 'setup', modelId: best.id, name: best.name, fee: bestFee } : null
}

/**
 * The cheapest available Graph node the player can already pay for.
 *
 * One pass, cost first: `mapNodeAvailable` walks parents and `currencyBalance` rescans every node
 * to derive RP, so both are reached only for a node that is actually cheaper than the leader, and
 * each balance is computed at most once.
 */
function nodeGoal(state: GameState, derived: Derived, catalog: Catalog): Goal | null {
  let best: Goal | null = null
  let bestCost = Infinity
  const balances: Partial<Record<Currency, number>> = {}
  for (const node of catalog.mapNodes) {
    const cost = mapNodeCost(node)
    if (cost >= bestCost) continue
    if (!mapNodeAvailable(node, state, derived, catalog)) continue
    let have = balances[node.currency]
    if (have === undefined) {
      have = currencyBalance(state, node.currency, catalog)
      balances[node.currency] = have
    }
    if (have < cost) continue
    best = { kind: 'node', nodeId: node.id, title: node.title, cost, currency: node.currency }
    bestCost = cost
  }
  return best
}

/** Names on the level goal: enough for one line under the bar. */
export const LEVEL_GOAL_UNLOCKS = 3

/**
 * The level bar as a goal: the next level, how far along the bar is, and up to LEVEL_GOAL_UNLOCKS
 * of the names it opens, hardware before models. Null at MAX_LEVEL, where there is no bar.
 */
function levelGoal(state: GameState, catalog: Catalog): Goal | null {
  const progress = levelProgress(state)
  if (progress.xpToGo <= 0) return null
  const next = nextUnlocks(progress.level, catalog)
  const unlocks: string[] = []
  for (const def of next.hardware) if (unlocks.length < LEVEL_GOAL_UNLOCKS) unlocks.push(def.name)
  for (const def of next.models) if (unlocks.length < LEVEL_GOAL_UNLOCKS) unlocks.push(def.name)
  return { kind: 'level', level: progress.level + 1, pct: pctOf(progress.fraction), xpToGo: progress.xpToGo, unlocks }
}

/**
 * What to do next, first match wins: claim a finished contract, set up a model you can afford,
 * push the level bar when it is all that stands between you and a unit you can already pay for,
 * save for the next rig, take a Graph node you can already pay for, or push the level bar anyway.
 * Null only at max level with nothing else outstanding.
 */
export function nextGoal(state: GameState, derived: Derived, catalog: Catalog): Goal | null {
  const claim = claimGoal(state, catalog)
  if (claim) return claim

  const setup = setupGoal(state, derived, catalog)
  if (setup) return setup

  if (levelBlocked(state, derived, catalog)) {
    const level = levelGoal(state, catalog)
    if (level) return level
  }

  const target = saveTarget(state, derived, catalog)
  if (target) {
    return {
      kind: 'buy',
      hardwareId: target.def.id,
      name: target.def.name,
      family: target.def.family,
      cost: target.cost,
      pct: target.pct,
      etaSec: target.etaSec,
      unlocksModel: unlocksNatively(target.def, state, derived, catalog),
    }
  }

  const node = nodeGoal(state, derived, catalog)
  if (node) return node

  return levelGoal(state, catalog)
}

/** Stable identity of a goal: the selector key the panel animates on (append the percent yourself). */
export function goalKey(goal: Goal): string {
  switch (goal.kind) {
    case 'claim':
      // The index alone is not identity: claiming splices, so another contract can take the slot.
      return `claim:${goal.index}:${goal.title}`
    case 'setup':
      return `setup:${goal.modelId}`
    case 'buy':
      return `buy:${goal.hardwareId}`
    case 'node':
      return `node:${goal.nodeId}`
    case 'level':
      return `level:${goal.level}`
    default: {
      const never: never = goal
      return never
    }
  }
}

/** Whether the goal has been met, so the panel can flip the row to its done state before moving on. */
export function isGoalDone(goal: Goal, state: GameState): boolean {
  switch (goal.kind) {
    case 'claim': {
      const c = state.contracts.active[goal.index]
      return !c || !c.done || c.claimed
    }
    case 'setup':
      return state.models[goal.modelId]?.setup === true
    case 'buy':
      // The goal was to save the price, not to spend it: banking the credits finishes it.
      return state.credits >= goal.cost
    case 'node':
      return state.mapNodes.includes(goal.nodeId)
    case 'level':
      return playerLevel(state) >= goal.level
    default: {
      const never: never = goal
      return never
    }
  }
}
