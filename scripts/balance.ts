/**
 * Greedy pacing simulator for the Comfy Clicker hardware ladder and the level that gates it.
 *
 *   pnpm balance            (= tsx scripts/balance.ts)
 *
 * It reads the shipped HARDWARE ladder (prices, cps, `minLevel`), the power upgrades (named
 * upgrades + infra map nodes), the tier-upgrade constants, the level table and XP weights, the
 * model table's `minLevel`s, the ACHIEVEMENTS catalog, and the game's own `unitCost`,
 * `throttleMult`, `creditsForCp`, `levelForXp`, `levelReward`, `postXp`, `dailyXp` and
 * `crossedMilestones`. It
 * models the rest of the economy (click milestones, global upgrades, content bonus) with the
 * simple rules documented below so the ladder and the level table can be judged on their own.
 * It tunes nothing: change the data, re-run, read the tables.
 *
 * Strategies
 *   naive  Every second, buy the affordable candidate with the best payback (cost / Δcps),
 *          repeat while anything is affordable. Never saves.
 *   climb  Every second, pick the candidate with the best payback among those reachable within
 *          45 s of current income (ties → higher cost rank, i.e. "the biggest thing I can save
 *          for"); buy it if affordable, otherwise hold the bank.
 *
 * Modelled (candidates compete on payback = cost / Δcps, Δcps measured after the power throttle)
 *   - hardware units, capped by `max`, gated by `minLevel ≤ level`; AMD consumer family locked
 *     unless `opts.rocm`
 *   - per-unit ×2 tier upgrades at the TIER_UPGRADE_THRESHOLDS, cost base × TIER_UPGRADE_COST_MULT
 *   - global +10 % cps at lifetime 1e3, 1e4 … 1e9, cost 2 × threshold
 *   - click value 1 → 2 (10 clicks) → ×2 (300) → ×2 (1500) → +1 % cps (4000) → +2 % cps (10000)
 *   - click rate 3/s for 3 min, 2/s to 10 min, 1/s to 30 min, 0.5/s after (per active session)
 *   - content bonus +30 % cps once 3 minutes have been played (the player has started posting)
 *   - power: draw = Σ watts, budget = POWER_BUDGET_BASE + bought power upgrades (the shipped
 *     `powerBudget` upgrades and map nodes, bought in cost order); cps scales by
 *     `throttleMult(draw, budget)` exactly as derived.ts does. A unit that would trip the breaker
 *     is also offered bundled with the power upgrades needed to cover it.
 *   - map-node gates are proxied: regions after any cloud node plus the credit cost of the two
 *     nodes on the way; the orbital and Dyson unlocks are Comfy-Point purchases, so they need
 *     `creditsForCp(cp)` of season credits (25 CP for orbital, 25 + 60 + 200 = 285 CP for the
 *     Dyson blueprint). CP is only banked by rebranding (which resets the rack), so the sim's
 *     times for those two are a lower bound on real play.
 *
 * Level model (level.ts, driven by the real constants)
 *   - level = `levelForXp(creditsXp + xp)`, settled once per second. `creditsXp` is the derived
 *     term, XP_CREDITS per decade of lifetime credits, floored; `xp` is the activity ledger.
 *   - posts: `postRate(session)` posts per minute, 6 for the first 3 min, 4 to 10 min, 2 to
 *     30 min, 1 after (the click taper, one post per ten-ish clicks). Each post pays
 *     `postXp(model)` for the highest-level model the table opens at the current level (the gate
 *     table guarantees a native card for it). Nothing goes viral and nothing is ratioed.
 *   - first unit of each hardware id: XP_HARDWARE_FIRST. A tier upgrade: XP_TIER. Each global
 *     step: XP_UPGRADE. Each power step: XP_UPGRADE when it is a named upgrade, XP_MAP_NODE (as a
 *     Graph node) when it is an infra node; a node the ladder bought counts towards the node
 *     proxy below, so it is never paid twice.
 *   - achievements: the real ACHIEVEMENTS conditions the sim can answer (`stat` on clicks,
 *     lifetimeCredits, posts, playedSec, level, contractsDone, mapNodes and achievements; `cps`;
 *     `ownHardware`; `ownFamily`; `all` and `any` over those; anything else reads false), checked
 *     once per second, XP_ACHIEVEMENT per row the first time it holds.
 *   - proxies for what the sim does not play: one contract claimed per CONTRACT_EVERY_S of
 *     active play (XP_CONTRACT), one Graph node per MAP_NODE_EVERY_S (XP_MAP_NODE), XP_SETUP for
 *     every model a new level opens (the player installs the new checkpoint), XP_MILESTONE per
 *     cps power of ten (`crossedMilestones`, as engine.ts pays it). `projectWeek` claims the
 *     daily at the start of each day (`dailyXp(cycleDay(day))`). No quantizations, no LoRAs, no
 *     rebrands, no named upgrades beyond the power ladder and the global steps, so real play
 *     earns a little more.
 *   - each level crossed pays `levelReward(level, cps)` into the bank and lifetime credits, as
 *     `settleLevelUps` does, so the credits term moves with it and the next rung is a little
 *     closer.
 *   - `levels[n]` is the active second at which level n was first reached, `levelAtBuy[id]` the
 *     level held when the first unit of `id` was bought (never below its `minLevel`, by
 *     construction: a locked unit is not a candidate).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACHIEVEMENTS } from '@/data/achievements'
import { HARDWARE } from '@/data/hardware'
import { MAP_NODES } from '@/data/mapNodes'
import { MODELS } from '@/data/models'
import { UPGRADES } from '@/data/upgrades'
import {
  LEVEL_XP,
  MAX_LEVEL,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  TIER_UPGRADE_COST_MULT,
  TIER_UPGRADE_EFFECT,
  TIER_UPGRADE_THRESHOLDS,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_CREDITS,
  XP_HARDWARE_FIRST,
  XP_MAP_NODE,
  XP_MILESTONE,
  XP_SETUP,
  XP_TIER,
  XP_UPGRADE,
} from '@/game/constants'
import { cycleDay } from '@/game/daily'
import { unitCost } from '@/game/economy'
import { crossedMilestones } from '@/game/engine'
import { dailyXp, levelForXp, levelReward, levelTitle, postXp } from '@/game/level'
import { throttleMult } from '@/game/power'
import { creditsForCp } from '@/game/prestige'
import type { ModelDef, UnlockCond, XpSource } from '@/game/types'

export type Strategy = 'naive' | 'climb'

export interface SimOptions {
  /** Clicks per second as a function of seconds into the active session. */
  clickRate?: (t: number) => number
  /** Posts per minute as a function of seconds into the active session. */
  postRate?: (t: number) => number
  /** Extra cps fraction from posting content once unlocked (default 0.3). */
  contentBonus?: number
  /** Treat the AMD consumer family as unlocked (ROCm upgrade owned). Default false. */
  rocm?: boolean
}

export interface SimResult {
  /**
   * Seconds of active play at which each id was first bought: hardware ids, `tier:<id>:<n>`,
   * `global:<threshold>` and `power:<upgrade id>`.
   */
  firsts: Record<string, number>
  owned: Record<string, number>
  /** Effective cps at the end (rig × throttle × global × content multipliers). */
  cps: number
  bank: number
  /** Credits earned over the whole run (the level system's derived XP term). */
  lifetime: number
  /** Generate clicks taken over the whole run. */
  clicks: number
  powerDraw: number
  powerBudget: number
  /** Level at the end of the run. */
  level: number
  /** Total XP at the end of the run: the credits term plus the activity ledger. */
  xp: number
  /** The activity ledger alone, per source (the sim's `stats.xpBy`). */
  xpBy: Partial<Record<XpSource, number>>
  /** Seconds of active play at which each level was first reached (level 1 at 0). */
  levels: Record<number, number>
  /** Level held when the first unit of each hardware id was bought. */
  levelAtBuy: Record<string, number>
  /**
   * Hardware ids in the order their first unit was bought. `firsts` has one-second resolution
   * and a rung that opens on a level-up is often bought whole in one second, so this is what
   * settles "A before B".
   */
  buyOrder: string[]
}

const CLIMB_HORIZON_S = 45
const CONTENT_BONUS_AFTER_S = 180
const DEFAULT_CONTENT_BONUS = 0.3
const GLOBAL_UPGRADE_THRESHOLDS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
const GLOBAL_UPGRADE_COST_MULT = 2
const GLOBAL_UPGRADE_BONUS = 0.1
/** Click milestones: flat base value, or a multiplier, or a share of cps added to each click. */
const CLICK_MILESTONES: { clicks: number; base?: number; mult?: number; cpsPct?: number }[] = [
  { clicks: 10, base: 2 },
  { clicks: 300, mult: 2 },
  { clicks: 1500, mult: 2 },
  { clicks: 4000, cpsPct: 0.01 },
  { clicks: 10000, cpsPct: 0.02 },
]
const STARTER_ID = 'pc-4c8t'
/** Payback ties are decided by rank; quantise so float noise from round3(baseCps) cannot break a tie. */
const PAYBACK_BUCKET_S = 0.5
const MAX_BUYS_PER_STEP = 500
/** Proxies for the parts of the game the sim does not play: one contract, one Graph node per this many active seconds. */
export const CONTRACT_EVERY_S = 600
export const MAP_NODE_EVERY_S = 480
/** A post lands every time the per-minute rate has accumulated one minute's worth. */
const POST_MINUTE = 60

/** Credits spent on map nodes on the way to each gate (the nodes themselves, not the CP). */
const REGIONS_NODE_CREDITS = 1e7 + 2e7 // cluster-ops + regions-unlock
/** Cumulative Comfy Points the regions lane needs before each store unlock. */
const ORBITAL_CP = 25
const DYSON_CP = 25 + 60 + 200

export function defaultClickRate(t: number): number {
  if (t < 180) return 3
  if (t < 600) return 2
  if (t < 1800) return 1
  return 0.5
}

/** Posts per minute at `t` seconds into the session: the click taper, one post per ten-ish clicks. */
export function defaultPostRate(t: number): number {
  if (t < 180) return 6
  if (t < 600) return 4
  if (t < 1800) return 2
  return 1
}

/** Shipped `powerBudget` sources, bought in cost order as one ladder. */
interface PowerStep {
  key: string
  cost: number
  watts: number
  /** Where the step came from, which decides the XP it banks: a named upgrade or a Graph node. */
  source: 'upgrade' | 'mapNode'
}

const POWER_LADDER: PowerStep[] = [
  ...UPGRADES.flatMap((u) =>
    u.effects
      .filter((e) => e.kind === 'powerBudget' && e.value > 0)
      .map((e): PowerStep => ({
        key: `power:${u.id}`,
        cost: u.cost,
        watts: e.kind === 'powerBudget' ? e.value : 0,
        source: 'upgrade',
      })),
  ),
  ...MAP_NODES.filter((n) => n.currency === 'credits').flatMap((n) =>
    n.effects
      .filter((e) => e.kind === 'powerBudget' && e.value > 0)
      .map((e): PowerStep => ({
        key: `power:${n.id}`,
        cost: n.cost,
        watts: e.kind === 'powerBudget' ? e.value : 0,
        source: 'mapNode',
      })),
  ),
].sort((a, b) => a.cost - b.cost)

/** Map-node unlocks the ladder depends on, proxied by ownership and earnings (the sim has no skill tree). */
const MAP_NODE_PROXY: Record<string, (s: SimState) => boolean> = {
  'regions-unlock': (s) =>
    s.lifetime >= REGIONS_NODE_CREDITS && HARDWARE.some((h) => h.family === 'cloud-node' && (s.owned[h.id] ?? 0) > 0),
  'orbital-unlock': (s) =>
    s.lifetime >= creditsForCp(ORBITAL_CP) && HARDWARE.some((h) => h.family === 'region' && (s.owned[h.id] ?? 0) > 0),
  'dyson-unlock': (s) => s.lifetime >= creditsForCp(DYSON_CP) && (s.owned['orbital-dc'] ?? 0) > 0,
}

/** The model a post uses at each level (index `level - 1`): the highest-level one the table opens by then. */
const POST_MODEL_BY_LEVEL: ModelDef[] = Array.from({ length: MAX_LEVEL }, (_, i) => {
  const level = i + 1
  let best = MODELS[0] as ModelDef
  for (const m of MODELS) {
    const need = m.minLevel ?? 1
    if (need <= level && need > (best.minLevel ?? 1)) best = m
  }
  return best
})

/** Models each level opens (index `level - 1`), each one a set-up the sim credits on arrival. */
const MODELS_OPENED_AT: number[] = Array.from({ length: MAX_LEVEL }, (_, i) =>
  MODELS.filter((m) => (m.minLevel ?? 1) === i + 1).length,
)

interface SimState {
  /** Total active seconds. */
  t: number
  /** Seconds into the current active session (drives the click-rate and post-rate schedules). */
  session: number
  bank: number
  lifetime: number
  clicks: number
  clickStage: number
  globalBought: number
  /** Steps of POWER_LADDER bought so far. */
  powerBought: number
  owned: Record<string, number>
  tiers: Record<string, number>
  firsts: Record<string, number>
  /** Activity XP (the ledger). The credits term is derived from `lifetime`. */
  xp: number
  xpBy: Partial<Record<XpSource, number>>
  level: number
  levels: Record<number, number>
  levelAtBuy: Record<string, number>
  buyOrder: string[]
  posts: number
  /** Post-minutes accumulated towards the next post (integer arithmetic, no float drift). */
  postAcc: number
  contracts: number
  mapNodes: number
  /** Best effective cps seen so far, for the milestone proxy. */
  bestCps: number
  achieved: Set<string>
}

interface Candidate {
  key: string
  kind: 'unit' | 'tier' | 'global' | 'power'
  cost: number
  dCps: number
  /** Cost rank of the underlying unit; global upgrades rank above everything. */
  rank: number
  buy: (s: SimState) => void
}

const RANK: Record<string, number> = Object.fromEntries(HARDWARE.map((h, i) => [h.id, i]))

function createState(): SimState {
  return {
    t: 0,
    session: 0,
    bank: 0,
    lifetime: 0,
    clicks: 0,
    clickStage: 0,
    globalBought: 0,
    powerBought: 0,
    owned: { [STARTER_ID]: 1 },
    tiers: {},
    firsts: { [STARTER_ID]: 0 },
    xp: 0,
    xpBy: {},
    level: 1,
    levels: { 1: 0 },
    levelAtBuy: { [STARTER_ID]: 1 },
    buyOrder: [STARTER_ID],
    posts: 0,
    postAcc: 0,
    contracts: 0,
    mapNodes: 0,
    bestCps: 0,
    achieved: new Set(),
  }
}

// ---------------------------------------------------------------------------
// XP and level
// ---------------------------------------------------------------------------
/** The derived credits term, as level.ts computes it: XP_CREDITS per decade of lifetime credits, floored. */
export const creditsXp = (lifetime: number): number => Math.floor(XP_CREDITS * Math.log10(1 + Math.max(0, lifetime)))

const totalXp = (s: SimState): number => creditsXp(s.lifetime) + s.xp

function grant(s: SimState, amount: number, source: XpSource): void {
  if (amount <= 0) return
  s.xp += amount
  s.xpBy[source] = (s.xpBy[source] ?? 0) + amount
}

/**
 * Recompute the level from the XP banked so far. Each level crossed is stamped with the current
 * second, pays the level reward into the bank and lifetime credits (as `settleLevelUps` does,
 * at the `cps` the caller was earning) and pays the set-up XP for the models it opens; either
 * can itself cross the next one, so the outer loop looks again.
 */
function settleLevel(s: SimState, cps: number): void {
  for (let guard = 0; guard < MAX_LEVEL; guard++) {
    const level = levelForXp(totalXp(s))
    if (level <= s.level) return
    for (let next = s.level + 1; next <= level; next++) {
      s.levels[next] = s.t
      const reward = levelReward(next, cps)
      s.bank += reward
      s.lifetime += reward
      grant(s, XP_SETUP * (MODELS_OPENED_AT[next - 1] ?? 0), 'setup')
    }
    s.level = level
  }
}

function landPosts(s: SimState, opts: SimOptions): void {
  s.postAcc += (opts.postRate ?? defaultPostRate)(s.session)
  while (s.postAcc >= POST_MINUTE) {
    s.postAcc -= POST_MINUTE
    s.posts += 1
    grant(s, postXp(POST_MODEL_BY_LEVEL[s.level - 1] as ModelDef, false), 'post')
  }
}

/** The contract and Graph-node proxies: one each per fixed slice of active play. */
function settleProxies(s: SimState): void {
  while (s.contracts < Math.floor(s.t / CONTRACT_EVERY_S)) {
    s.contracts += 1
    grant(s, XP_CONTRACT, 'contract')
  }
  while (s.mapNodes < Math.floor(s.t / MAP_NODE_EVERY_S)) {
    s.mapNodes += 1
    grant(s, XP_MAP_NODE, 'mapNode')
  }
}

function familyCount(s: SimState, family: string): number {
  let n = 0
  for (const h of HARDWARE) if (h.family === family) n += s.owned[h.id] ?? 0
  return n
}

/**
 * Achievement conditions the sim can answer. Everything it cannot (flags, models, precisions,
 * upgrades, social stats, the daily streak) reads false, so the count here is a floor. The level
 * is the one settled at the end of the previous second, as `checkAchievements` runs before
 * `settleLevelUps` in the engine too.
 */
function achieved(cond: UnlockCond, s: SimState, cps: number): boolean {
  switch (cond.type) {
    case 'stat':
      if (cond.key === 'clicks') return s.clicks >= cond.value
      if (cond.key === 'lifetimeCredits') return s.lifetime >= cond.value
      if (cond.key === 'posts') return s.posts >= cond.value
      if (cond.key === 'playedSec') return s.t >= cond.value
      if (cond.key === 'level') return s.level >= cond.value
      if (cond.key === 'contractsDone') return s.contracts >= cond.value
      if (cond.key === 'mapNodes') return s.mapNodes >= cond.value
      if (cond.key === 'achievements') return s.achieved.size >= cond.value
      return false
    case 'cps':
      return cps >= cond.value
    case 'ownHardware':
      return (s.owned[cond.id] ?? 0) >= (cond.count ?? 1)
    case 'ownFamily':
      return familyCount(s, cond.family) >= (cond.count ?? 1)
    case 'all':
      return cond.conds.every((c) => achieved(c, s, cps))
    case 'any':
      return cond.conds.some((c) => achieved(c, s, cps))
    default:
      return false
  }
}

function checkAchievements(s: SimState, cps: number): void {
  for (const a of ACHIEVEMENTS) {
    if (s.achieved.has(a.id) || !achieved(a.cond, s, cps)) continue
    s.achieved.add(a.id)
    grant(s, XP_ACHIEVEMENT, 'achievement')
  }
}

function settleMilestones(s: SimState, cps: number): void {
  grant(s, XP_MILESTONE * crossedMilestones(s.bestCps, cps).length, 'milestone')
  if (cps > s.bestCps) s.bestCps = cps
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------
const rigMult = (tier: number): number => TIER_UPGRADE_EFFECT ** tier
const globalMult = (s: SimState): number => (1 + GLOBAL_UPGRADE_BONUS) ** s.globalBought
const contentMult = (s: SimState, opts: SimOptions): number =>
  s.t >= CONTENT_BONUS_AFTER_S ? 1 + (opts.contentBonus ?? DEFAULT_CONTENT_BONUS) : 1

function rawCps(s: SimState): number {
  let sum = 0
  for (const h of HARDWARE) {
    const n = s.owned[h.id] ?? 0
    if (n > 0) sum += n * h.baseCps * rigMult(s.tiers[h.id] ?? 0)
  }
  return sum
}

function powerDraw(s: SimState): number {
  let sum = 0
  for (const h of HARDWARE) sum += (s.owned[h.id] ?? 0) * h.watts
  return sum
}

function powerBudget(s: SimState): number {
  let budget = POWER_BUDGET_BASE
  for (let i = 0; i < s.powerBought; i++) budget += POWER_LADDER[i].watts
  return budget
}

/** Rig output after the breaker, before the global/content multipliers. */
const throttledRaw = (raw: number, draw: number, budget: number): number => raw * throttleMult(draw, budget)

const effectiveCps = (s: SimState, opts: SimOptions): number =>
  throttledRaw(rawCps(s), powerDraw(s), powerBudget(s)) * globalMult(s) * contentMult(s, opts)

function clickValue(s: SimState, cps: number): number {
  let base = 1
  let pct = 0
  for (let i = 0; i < s.clickStage; i++) {
    const m = CLICK_MILESTONES[i]
    if (m.base !== undefined) base = m.base
    if (m.mult !== undefined) base *= m.mult
    if (m.cpsPct !== undefined) pct += m.cpsPct
  }
  return base * globalMult(s) + pct * cps
}

function isUnlocked(cond: UnlockCond | undefined, s: SimState, cps: number): boolean {
  if (!cond) return true
  switch (cond.type) {
    case 'always':
      return true
    case 'ownHardware':
      return (s.owned[cond.id] ?? 0) >= (cond.count ?? 1)
    case 'ownFamily':
      return familyCount(s, cond.family) >= (cond.count ?? 1)
    case 'mapNode':
      return MAP_NODE_PROXY[cond.id]?.(s) ?? false
    case 'cps':
      return cps >= cond.value
    case 'stat':
      if (cond.key === 'lifetimeCredits' || cond.key === 'seasonCredits') return s.lifetime >= cond.value
      if (cond.key === 'clicks') return s.clicks >= cond.value
      if (cond.key === 'playedSec') return s.t >= cond.value
      return false
    case 'all':
      return cond.conds.every((c) => isUnlocked(c, s, cps))
    case 'any':
      return cond.conds.some((c) => isUnlocked(c, s, cps))
    default:
      return false
  }
}

/** Power steps (from `from`) needed until the budget covers `draw`; null when the ladder runs out. */
function powerStepsToCover(from: number, budget: number, draw: number): PowerStep[] | null {
  const steps: PowerStep[] = []
  let b = budget
  let i = from
  while (b < draw) {
    const step = POWER_LADDER[i]
    if (!step) return null
    steps.push(step)
    b += step.watts
    i++
  }
  return steps
}

/**
 * Buy power steps in ladder order. A named upgrade banks XP_UPGRADE; an infra node banks
 * XP_MAP_NODE as a Graph node and counts towards the node proxy, so `settleProxies` does not
 * pay a second time for a node the ladder already bought.
 */
function buyPower(st: SimState, steps: PowerStep[]): void {
  for (const step of steps) {
    st.powerBought += 1
    if (st.firsts[step.key] === undefined) st.firsts[step.key] = st.t
    if (step.source === 'mapNode') {
      st.mapNodes += 1
      grant(st, XP_MAP_NODE, 'mapNode')
    } else {
      grant(st, XP_UPGRADE, 'upgrade')
    }
  }
}

function candidates(s: SimState, opts: SimOptions): Candidate[] {
  const out: Candidate[] = []
  const raw = rawCps(s)
  const draw = powerDraw(s)
  const budget = powerBudget(s)
  const mult = globalMult(s) * contentMult(s, opts)
  const base = throttledRaw(raw, draw, budget)
  const cps = base * mult
  /** Δcps of a purchase that changes the rig by (Δraw, Δdraw) and the budget by Δbudget. */
  const gain = (dRaw: number, dDraw: number, dBudget: number): number =>
    (throttledRaw(raw + dRaw, draw + dDraw, budget + dBudget) - base) * mult

  for (const h of HARDWARE) {
    const owned = s.owned[h.id] ?? 0
    if (h.max !== undefined && owned >= h.max) continue
    if (h.family === 'amd-consumer' && !opts.rocm) continue
    if ((h.minLevel ?? 1) > s.level) continue
    if (!isUnlocked(h.unlock, s, cps)) continue
    const tier = s.tiers[h.id] ?? 0
    const unitCps = h.baseCps * rigMult(tier)
    const cost = unitCost(h, owned)
    const buyUnit = (st: SimState): void => {
      st.owned[h.id] = (st.owned[h.id] ?? 0) + 1
      if (st.firsts[h.id] === undefined) {
        st.firsts[h.id] = st.t
        st.levelAtBuy[h.id] = st.level
        st.buyOrder.push(h.id)
        grant(st, XP_HARDWARE_FIRST, 'hardware')
      }
    }
    // As-is: worth it only when its cps/W beats the rack's average once over budget.
    const asIs = gain(unitCps, h.watts, 0)
    if (asIs > 0) out.push({ key: h.id, kind: 'unit', cost, dCps: asIs, rank: RANK[h.id], buy: buyUnit })
    // Bundled with the power upgrades that keep the breaker off.
    if (draw + h.watts > budget) {
      const steps = powerStepsToCover(s.powerBought, budget, draw + h.watts)
      if (steps && steps.length > 0) {
        const extra = steps.reduce((sum, p) => sum + p.watts, 0)
        const powerCost = steps.reduce((sum, p) => sum + p.cost, 0)
        out.push({
          key: `${h.id}+power`,
          kind: 'unit',
          cost: cost + powerCost,
          dCps: gain(unitCps, h.watts, extra),
          rank: RANK[h.id],
          buy: (st) => {
            buyPower(st, steps)
            buyUnit(st)
          },
        })
      }
    }
    if (owned > 0 && tier < TIER_UPGRADE_THRESHOLDS.length && owned >= TIER_UPGRADE_THRESHOLDS[tier]) {
      const key = `tier:${h.id}:${tier + 1}`
      out.push({
        key,
        kind: 'tier',
        cost: h.baseCost * TIER_UPGRADE_COST_MULT[tier],
        dCps: gain(owned * unitCps * (TIER_UPGRADE_EFFECT - 1), 0, 0),
        rank: RANK[h.id],
        buy: (st) => {
          st.tiers[h.id] = tier + 1
          if (st.firsts[key] === undefined) st.firsts[key] = st.t
          grant(st, XP_TIER, 'tier')
        },
      })
    }
  }
  // A power upgrade on its own pays only while the breaker is tripped.
  const nextPower = POWER_LADDER[s.powerBought]
  if (nextPower && draw > budget) {
    out.push({
      key: nextPower.key,
      kind: 'power',
      cost: nextPower.cost,
      dCps: gain(0, 0, nextPower.watts),
      rank: HARDWARE.length,
      buy: (st) => buyPower(st, [nextPower]),
    })
  }
  const k = s.globalBought
  if (k < GLOBAL_UPGRADE_THRESHOLDS.length && s.lifetime >= GLOBAL_UPGRADE_THRESHOLDS[k]) {
    const threshold = GLOBAL_UPGRADE_THRESHOLDS[k]
    const key = `global:${threshold}`
    out.push({
      key,
      kind: 'global',
      cost: threshold * GLOBAL_UPGRADE_COST_MULT,
      dCps: cps * GLOBAL_UPGRADE_BONUS,
      rank: HARDWARE.length,
      buy: (st) => {
        st.globalBought = k + 1
        if (st.firsts[key] === undefined) st.firsts[key] = st.t
        grant(st, XP_UPGRADE, 'upgrade')
      },
    })
  }
  return out.filter((c) => c.dCps > 0)
}

const payback = (c: Candidate): number => c.cost / c.dCps

/** Lower bucketed payback wins; equal buckets go to the higher rank (the bigger purchase). */
function better(a: Candidate, b: Candidate): boolean {
  const pa = Math.round(payback(a) / PAYBACK_BUCKET_S)
  const pb = Math.round(payback(b) / PAYBACK_BUCKET_S)
  if (pa !== pb) return pa < pb
  if (a.rank !== b.rank) return a.rank > b.rank
  return a.cost < b.cost
}

function best(list: Candidate[]): Candidate | undefined {
  let top: Candidate | undefined
  for (const c of list) if (!top || better(c, top)) top = c
  return top
}

function purchase(s: SimState, c: Candidate): void {
  s.bank -= c.cost
  c.buy(s)
}

function spend(s: SimState, strategy: Strategy, opts: SimOptions): void {
  for (let guard = 0; guard < MAX_BUYS_PER_STEP; guard++) {
    const cands = candidates(s, opts)
    if (strategy === 'naive') {
      const pick = best(cands.filter((c) => c.cost <= s.bank))
      if (!pick) return
      purchase(s, pick)
      continue
    }
    const cps = effectiveCps(s, opts)
    const income = cps + (opts.clickRate ?? defaultClickRate)(s.session) * clickValue(s, cps)
    const horizon = s.bank + CLIMB_HORIZON_S * income
    const reachable = cands.filter((c) => c.cost <= horizon)
    // Nothing within reach: hold out for the cheapest thing on the shelf.
    const target = best(reachable) ?? cands.reduce<Candidate | undefined>((m, c) => (!m || c.cost < m.cost ? c : m), undefined)
    if (!target || target.cost > s.bank) return
    purchase(s, target)
  }
}

/**
 * One active second: income and clicks, then the posts and proxies that pay XP, the shopping
 * pass (which pays first-unit, tier and upgrade XP), the cps milestones and achievements the new
 * rack may have crossed, and finally the level, so a level earned this second gates next second's
 * shopping.
 */
function stepSecond(s: SimState, strategy: Strategy, opts: SimOptions): void {
  const cps = effectiveCps(s, opts)
  const rate = (opts.clickRate ?? defaultClickRate)(s.session)
  const income = cps + rate * clickValue(s, cps)
  s.bank += income
  s.lifetime += income
  s.clicks += rate
  while (s.clickStage < CLICK_MILESTONES.length && s.clicks >= CLICK_MILESTONES[s.clickStage].clicks) {
    s.clickStage++
  }
  s.t += 1
  s.session += 1
  landPosts(s, opts)
  settleProxies(s)
  spend(s, strategy, opts)
  const after = effectiveCps(s, opts)
  settleMilestones(s, after)
  checkAchievements(s, after)
  settleLevel(s, after)
}

function runActive(s: SimState, seconds: number, strategy: Strategy, opts: SimOptions): void {
  s.session = 0
  for (let i = 0; i < seconds; i++) stepSecond(s, strategy, opts)
}

/** Rig cps with nobody at the keyboard: after the breaker and the global upgrades, no content bonus. */
const idleCps = (s: SimState): number => throttledRaw(rawCps(s), powerDraw(s), powerBudget(s)) * globalMult(s)

/** Offline earnings: `idleCps` × OFFLINE_EFFICIENCY for up to the base cap. A level the credits cross is paid at that rate. */
function runOffline(s: SimState, hours: number): number {
  const capped = Math.min(hours, OFFLINE_CAP_HOURS_BASE) * 3600
  const cps = idleCps(s)
  const gain = cps * capped * OFFLINE_EFFICIENCY
  s.bank += gain
  s.lifetime += gain
  settleLevel(s, cps)
  return gain
}

function result(s: SimState, opts: SimOptions): SimResult {
  return {
    firsts: { ...s.firsts },
    owned: { ...s.owned },
    cps: effectiveCps(s, opts),
    bank: s.bank,
    lifetime: s.lifetime,
    clicks: s.clicks,
    powerDraw: powerDraw(s),
    powerBudget: powerBudget(s),
    level: s.level,
    xp: totalXp(s),
    xpBy: { ...s.xpBy },
    levels: { ...s.levels },
    levelAtBuy: { ...s.levelAtBuy },
    buyOrder: [...s.buyOrder],
  }
}

/** Simulate one continuous active session of `seconds` from a fresh save. */
export function simulate(strategy: Strategy, seconds: number, opts: SimOptions = {}): SimResult {
  const s = createState()
  runActive(s, Math.max(0, Math.floor(seconds)), strategy, opts)
  return result(s, opts)
}

export interface DayProjection {
  day: number
  /** Effective cps at the end of the active hour. */
  cps: number
  offlineGain: number
  bank: number
  /** Highest-ranked unit owned at the end of the day. */
  best: string
  /** Ids first bought during this day's session, in rank order. */
  firsts: string[]
  /** Level at the end of the day (after the offline credits have been counted). */
  level: number
  /** Everything owned by the end of the day. */
  owned: Record<string, number>
  /** Level held when the first unit of each hardware id was bought, over the projection so far. */
  levelAtBuy: Record<string, number>
  /** Hardware ids in first-buy order, over the projection so far. */
  buyOrder: string[]
}

/**
 * `days` days of one active hour followed by `offlineHours` idle (capped by
 * OFFLINE_CAP_HOURS_BASE). Each day starts with the daily claim, which pays `dailyXp` for the
 * streak's cycle day.
 */
export function projectWeek(
  strategy: Strategy,
  opts: SimOptions = {},
  days = 7,
  activeSeconds = 3600,
  offlineHours = 12,
): DayProjection[] {
  const s = createState()
  const rows: DayProjection[] = []
  for (let day = 1; day <= days; day++) {
    const before = new Set(Object.keys(s.firsts))
    grant(s, dailyXp(cycleDay(day)), 'daily')
    settleLevel(s, effectiveCps(s, opts))
    runActive(s, activeSeconds, strategy, opts)
    const cps = effectiveCps(s, opts)
    const offlineGain = runOffline(s, offlineHours)
    const bestOwned = [...HARDWARE].reverse().find((h) => (s.owned[h.id] ?? 0) > 0)
    rows.push({
      day,
      cps,
      offlineGain,
      bank: s.bank,
      best: bestOwned?.id ?? STARTER_ID,
      firsts: HARDWARE.filter((h) => s.firsts[h.id] !== undefined && !before.has(h.id)).map((h) => h.id),
      level: s.level,
      owned: { ...s.owned },
      levelAtBuy: { ...s.levelAtBuy },
      buyOrder: [...s.buyOrder],
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi']

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (Math.abs(n) < 1000) return n < 10 ? n.toFixed(2) : Math.round(n).toString()
  let i = 0
  let v = n
  while (Math.abs(v) >= 1000 && i < SUFFIXES.length - 1) {
    v /= 1000
    i++
  }
  return `${v.toPrecision(3)}${SUFFIXES[i]}`
}

function fmtTime(sec: number | undefined): string {
  if (sec === undefined) return 'n/a'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`
}

function fmtPayback(sec: number): string {
  if (sec < 600) return `${sec.toFixed(1)}s`
  if (sec < 7200) return `${(sec / 60).toFixed(1)}m`
  return `${(sec / 3600).toFixed(1)}h`
}

function fmtWatts(w: number): string {
  if (w >= 1e9) return `${(w / 1e9).toFixed(2)} GW`
  if (w >= 1e6) return `${(w / 1e6).toFixed(1)} MW`
  if (w >= 1e3) return `${(w / 1e3).toFixed(1)} kW`
  return `${Math.round(w)} W`
}

const fmtXp = (n: number): string => Math.round(n).toLocaleString('en-US')

const pad = (v: string, w: number, right = false): string =>
  right ? v.padStart(w) : v.padEnd(w)

function printTable(header: string[], rows: string[][], rightAlign: boolean[]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i], rightAlign[i])).join('  ')
  console.log(line(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(r))
}

function xpLine(r: SimResult): string {
  const parts = Object.entries(r.xpBy)
    .filter(([, xp]) => (xp ?? 0) > 0)
    .map(([source, xp]) => `${source} ${fmtXp(xp ?? 0)}`)
  return `${fmtXp(r.xp)} XP, level ${r.level} (credits ${fmtXp(creditsXp(r.lifetime))}, ${parts.join(', ')})`
}

function main(): void {
  const horizon = 3 * 3600
  const levelHorizon = 10 * 3600
  const climb = simulate('climb', horizon)
  const naive = simulate('naive', horizon)
  // The level table needs the long run; its first hours are the 3 h run, so it also fills the
  // tail of the first-purchase table (`climb 10h`) that the level gate pushes past three hours.
  const longClimb = simulate('climb', levelHorizon)
  const longNaive = simulate('naive', levelHorizon)

  console.log(
    `First-purchase times over ${fmtTime(horizon)} of active play (3/s → 0.5/s clicks, 6/min → 1/min posts); \`climb 10h\` is the same climber over ${fmtTime(levelHorizon)}\n`,
  )
  printTable(
    ['id', 'family', 'lvl', 'cost', 'cps', 'payback', 'watts', 'climb', 'naive', 'climb 10h', 'climb×', 'naive×'],
    HARDWARE.map((h) => [
      h.id,
      h.family,
      String(h.minLevel ?? 1),
      fmtNum(h.baseCost),
      fmtNum(h.baseCps),
      fmtPayback(h.baseCost / h.baseCps),
      fmtWatts(h.watts),
      fmtTime(climb.firsts[h.id]),
      fmtTime(naive.firsts[h.id]),
      fmtTime(longClimb.firsts[h.id]),
      String(climb.owned[h.id] ?? 0),
      String(naive.owned[h.id] ?? 0),
    ]),
    [false, false, true, true, true, true, true, true, true, true, true, true],
  )
  const powerLine = (r: SimResult): string =>
    `${fmtWatts(r.powerDraw)} drawn of ${fmtWatts(r.powerBudget)}${r.powerDraw > r.powerBudget ? ' (throttled)' : ''}`
  console.log(
    `\nEnd of session · climb: ${fmtNum(climb.cps)}/s, bank ${fmtNum(climb.bank)}, ${powerLine(climb)} · naive: ${fmtNum(naive.cps)}/s, bank ${fmtNum(naive.bank)}, ${powerLine(naive)}`,
  )
  console.log(`XP at ${fmtTime(horizon)} · climb: ${xpLine(climb)}`)
  console.log(`XP at ${fmtTime(horizon)} · naive: ${xpLine(naive)}`)
  console.log(`Gates: orbital needs ${fmtNum(creditsForCp(ORBITAL_CP))} season credits (${ORBITAL_CP} CP), Dyson ${fmtNum(creditsForCp(DYSON_CP))} (${DYSON_CP} CP), after a rebrand.`)

  const shown = Math.max(12, longClimb.level, longNaive.level)
  console.log(`\nLevel arrival times over ${fmtTime(levelHorizon)} of active play (xp is the threshold the level needs)\n`)
  printTable(
    ['level', 'title', 'xp', 'climb', 'naive'],
    Array.from({ length: shown }, (_, i) => {
      const level = i + 1
      return [
        String(level),
        levelTitle(level),
        fmtXp(LEVEL_XP[level - 1] as number),
        fmtTime(longClimb.levels[level]),
        fmtTime(longNaive.levels[level]),
      ]
    }),
    [true, false, true, true, true],
  )
  console.log(`\nXP at ${fmtTime(levelHorizon)} · climb: ${xpLine(longClimb)}`)

  const days = 14
  for (const strategy of ['climb', 'naive'] as const) {
    console.log(
      `\n${days}-day projection (${strategy}): 1 h active + 12 h offline (capped at ${OFFLINE_CAP_HOURS_BASE} h × ${Math.round(OFFLINE_EFFICIENCY * 100)} %) per day, daily claimed\n`,
    )
    printTable(
      ['day', 'level', 'cps (end of hour)', 'offline gain', 'bank', 'best unit', 'new this day'],
      projectWeek(strategy, {}, days).map((d) => [
        String(d.day),
        String(d.level),
        fmtNum(d.cps),
        fmtNum(d.offlineGain),
        fmtNum(d.bank),
        d.best,
        d.firsts.length ? d.firsts.join(', ') : 'none',
      ]),
      [true, true, true, true, true, false, false],
    )
  }
}

function isMain(): boolean {
  try {
    const self = fileURLToPath(import.meta.url)
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
    return entry === self || entry === self.replace(/\.[cm]?[jt]s$/, '')
  } catch {
    return false
  }
}

if (isMain()) main()
