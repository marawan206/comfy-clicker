/**
 * Greedy pacing simulator for the Comfy Clicker hardware ladder.
 *
 *   pnpm balance            (= tsx scripts/balance.ts)
 *
 * It reads the shipped HARDWARE ladder, the power upgrades (named upgrades + infra map nodes),
 * the tier-upgrade constants and the game's own `unitCost`, `throttleMult` and `creditsForCp`,
 * and models the rest of the economy (click milestones, global upgrades, content bonus) with the
 * simple rules documented below so the ladder can be judged on its own. It tunes nothing:
 * change the data, re-run, read the table.
 *
 * Strategies
 *   naive  Every second, buy the affordable candidate with the best payback (cost / Δcps),
 *          repeat while anything is affordable. Never saves.
 *   climb  Every second, pick the candidate with the best payback among those reachable within
 *          45 s of current income (ties → higher cost rank, i.e. "the biggest thing I can save
 *          for"); buy it if affordable, otherwise hold the bank.
 *
 * Modelled (candidates compete on payback = cost / Δcps, Δcps measured after the power throttle)
 *   - hardware units, capped by `max`; AMD consumer family locked unless `opts.rocm`
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
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HARDWARE } from '@/data/hardware'
import { MAP_NODES } from '@/data/mapNodes'
import { UPGRADES } from '@/data/upgrades'
import {
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  TIER_UPGRADE_COST_MULT,
  TIER_UPGRADE_EFFECT,
  TIER_UPGRADE_THRESHOLDS,
} from '@/game/constants'
import { unitCost } from '@/game/economy'
import { throttleMult } from '@/game/power'
import { creditsForCp } from '@/game/prestige'
import type { UnlockCond } from '@/game/types'

export type Strategy = 'naive' | 'climb'

export interface SimOptions {
  /** Clicks per second as a function of seconds into the active session. */
  clickRate?: (t: number) => number
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
  powerDraw: number
  powerBudget: number
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

/** Shipped `powerBudget` sources, bought in cost order as one ladder. */
interface PowerStep {
  key: string
  cost: number
  watts: number
}

const POWER_LADDER: PowerStep[] = [
  ...UPGRADES.flatMap((u) =>
    u.effects
      .filter((e) => e.kind === 'powerBudget' && e.value > 0)
      .map((e) => ({ key: `power:${u.id}`, cost: u.cost, watts: e.kind === 'powerBudget' ? e.value : 0 })),
  ),
  ...MAP_NODES.filter((n) => n.currency === 'credits').flatMap((n) =>
    n.effects
      .filter((e) => e.kind === 'powerBudget' && e.value > 0)
      .map((e) => ({ key: `power:${n.id}`, cost: n.cost, watts: e.kind === 'powerBudget' ? e.value : 0 })),
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

interface SimState {
  /** Total active seconds. */
  t: number
  /** Seconds into the current active session (drives the click-rate schedule). */
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
  }
}

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
    case 'ownFamily': {
      let n = 0
      for (const h of HARDWARE) if (h.family === cond.family) n += s.owned[h.id] ?? 0
      return n >= (cond.count ?? 1)
    }
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

function buyPower(st: SimState, steps: PowerStep[]): void {
  for (const step of steps) {
    st.powerBought += 1
    if (st.firsts[step.key] === undefined) st.firsts[step.key] = st.t
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
    if (!isUnlocked(h.unlock, s, cps)) continue
    const tier = s.tiers[h.id] ?? 0
    const unitCps = h.baseCps * rigMult(tier)
    const cost = unitCost(h, owned)
    const buyUnit = (st: SimState): void => {
      st.owned[h.id] = (st.owned[h.id] ?? 0) + 1
      if (st.firsts[h.id] === undefined) st.firsts[h.id] = st.t
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
  spend(s, strategy, opts)
}

function runActive(s: SimState, seconds: number, strategy: Strategy, opts: SimOptions): void {
  s.session = 0
  for (let i = 0; i < seconds; i++) stepSecond(s, strategy, opts)
}

/** Offline earnings: rig cps (no content bonus, nobody is posting) × OFFLINE_EFFICIENCY for up to the base cap. */
function runOffline(s: SimState, hours: number): number {
  const capped = Math.min(hours, OFFLINE_CAP_HOURS_BASE) * 3600
  const gain = throttledRaw(rawCps(s), powerDraw(s), powerBudget(s)) * globalMult(s) * capped * OFFLINE_EFFICIENCY
  s.bank += gain
  s.lifetime += gain
  return gain
}

function result(s: SimState, opts: SimOptions): SimResult {
  return {
    firsts: { ...s.firsts },
    owned: { ...s.owned },
    cps: effectiveCps(s, opts),
    bank: s.bank,
    powerDraw: powerDraw(s),
    powerBudget: powerBudget(s),
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
}

/** Seven days of one active hour followed by `offlineHours` idle (capped by OFFLINE_CAP_HOURS_BASE). */
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

const pad = (v: string, w: number, right = false): string =>
  right ? v.padStart(w) : v.padEnd(w)

function printTable(header: string[], rows: string[][], rightAlign: boolean[]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i], rightAlign[i])).join('  ')
  console.log(line(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(r))
}

function main(): void {
  const horizon = 3 * 3600
  const climb = simulate('climb', horizon)
  const naive = simulate('naive', horizon)

  console.log(`First-purchase times over ${fmtTime(horizon)} of active play (3/s → 0.5/s clicks)\n`)
  printTable(
    ['id', 'family', 'cost', 'cps', 'payback', 'watts', 'climb', 'naive', 'climb×', 'naive×'],
    HARDWARE.map((h) => [
      h.id,
      h.family,
      fmtNum(h.baseCost),
      fmtNum(h.baseCps),
      fmtPayback(h.baseCost / h.baseCps),
      fmtWatts(h.watts),
      fmtTime(climb.firsts[h.id]),
      fmtTime(naive.firsts[h.id]),
      String(climb.owned[h.id] ?? 0),
      String(naive.owned[h.id] ?? 0),
    ]),
    [false, false, true, true, true, true, true, true, true, true],
  )
  const powerLine = (r: SimResult): string =>
    `${fmtWatts(r.powerDraw)} drawn of ${fmtWatts(r.powerBudget)}${r.powerDraw > r.powerBudget ? ' (throttled)' : ''}`
  console.log(
    `\nEnd of session · climb: ${fmtNum(climb.cps)}/s, bank ${fmtNum(climb.bank)}, ${powerLine(climb)} · naive: ${fmtNum(naive.cps)}/s, bank ${fmtNum(naive.bank)}, ${powerLine(naive)}`,
  )
  console.log(`Gates: orbital needs ${fmtNum(creditsForCp(ORBITAL_CP))} season credits (${ORBITAL_CP} CP), Dyson ${fmtNum(creditsForCp(DYSON_CP))} (${DYSON_CP} CP), after a rebrand.`)

  for (const strategy of ['climb', 'naive'] as const) {
    console.log(
      `\n7-day projection (${strategy}): 1 h active + 12 h offline (capped at ${OFFLINE_CAP_HOURS_BASE} h × ${Math.round(OFFLINE_EFFICIENCY * 100)} %) per day\n`,
    )
    printTable(
      ['day', 'cps (end of hour)', 'offline gain', 'bank', 'best unit', 'new this day'],
      projectWeek(strategy).map((d) => [
        String(d.day),
        fmtNum(d.cps),
        fmtNum(d.offlineGain),
        fmtNum(d.bank),
        d.best,
        d.firsts.length ? d.firsts.join(', ') : 'none',
      ]),
      [true, true, true, true, false, false],
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
