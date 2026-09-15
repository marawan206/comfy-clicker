import { describe, expect, it } from 'vitest'
import { HARDWARE } from '@/data/hardware'
import { LEVEL_XP, MAX_LEVEL } from '@/game/constants'
import { levelForXp } from '@/game/level'
import { defaultClickRate, defaultPostRate, projectWeek, simulate, type SimResult } from '../../../scripts/balance'

const MIN = 60
const HOUR = 60 * MIN
/** The store ladder through the datacenter aisle, and the "nothing inside three hours" bounds. */
const HORIZON_S = 3 * HOUR
/** Level 12, the cloud rung and the pod, with margin. */
const LONG_HORIZON_S = 10 * HOUR

const climb = simulate('climb', HORIZON_S)
const naive = simulate('naive', HORIZON_S)
const longClimb = simulate('climb', LONG_HORIZON_S)
const longNaive = simulate('naive', LONG_HORIZON_S)
const fortnight = projectWeek('climb', {}, 14)

const cloudNodeIds = HARDWARE.filter((h) => h.family === 'cloud-node').map((h) => h.id)
const regionIds = HARDWARE.filter((h) => h.family === 'region').map((h) => h.id)
const firstOf = (r: { firsts: Record<string, number> }, ids: string[]): number =>
  Math.min(...ids.map((id) => r.firsts[id] ?? Infinity))
/** Position of `id` in the first-buy order; Infinity when the run never bought it. */
const orderOf = (r: SimResult, id: string): number => {
  const i = r.buyOrder.indexOf(id)
  return i < 0 ? Infinity : i
}
const firstOrderOf = (r: SimResult, ids: string[]): number => Math.min(...ids.map((id) => orderOf(r, id)))

/**
 * Where each level should land for a climber who keeps posting (spec section 3). The sim is
 * deterministic, so these are exact bounds on `LEVEL_XP_HAND`, not a flake budget.
 */
const LEVEL_WINDOWS: [level: number, lo: number, hi: number][] = [
  [2, 30, 2.5 * MIN],
  [3, 3 * MIN, 7 * MIN],
  [4, 7 * MIN, 13 * MIN],
  [5, 13 * MIN, 22 * MIN],
  [6, 22 * MIN, 38 * MIN],
  [7, 35 * MIN, 60 * MIN],
  [8, 55 * MIN, 90 * MIN],
  [9, 1.5 * HOUR, 2.6 * HOUR],
  [10, 2.4 * HOUR, 4 * HOUR],
  [12, 5 * HOUR, 10 * HOUR],
]

/**
 * Where the climber actually landed when `LEVEL_XP_HAND` was last tuned: the `climb` column of
 * the level table `pnpm balance` prints, in seconds, as pasted into docs/HOW-IT-WORKS.md. The
 * windows above are the outer contract and pin the table; they sit near the late edge of the
 * current arrivals, so a richer XP economy (a bigger post or achievement weight) can pull every
 * level 20 percent early and leave them green. This band pins the weights too: a retune moves
 * the constants, this table and the doc table together.
 */
const MEASURED_ARRIVAL_S: [level: number, seconds: number][] = [
  [2, 87],
  [3, 286],
  [4, 579],
  [5, 902],
  [6, 1622],
  [7, 2855],
  [8, 4229],
  [9, 7145],
  [10, 11285],
  [11, 16145],
  [12, 25440],
]
const MEASURED_BAND = 0.15

describe('pacing: climb (save for the best reachable unit, 3 clicks/s tapering off)', () => {
  it('reaches the used RTX 3060 within 4 minutes', () => {
    expect(climb.firsts['rtx-3060']).toBeLessThan(4 * MIN)
  })

  it('reaches the RTX 4090 within 15 minutes', () => {
    expect(climb.firsts['rtx-4090']).toBeLessThan(15 * MIN)
  })

  it('reaches the RTX PRO 6000 within 60 minutes (contract)', () => {
    expect(climb.firsts['rtx-pro-6000']).toBeLessThan(60 * MIN)
  })

  it('rents a cloud node within 4 hours (contract)', () => {
    expect(firstOf(longClimb, cloudNodeIds)).toBeLessThan(4 * HOUR)
  })

  it('keeps the first purchases in ladder order (no skipped cheap tiers before the 4090)', () => {
    // A rung that opens on a level-up is bought whole within one second, so the order of first
    // buys is what settles "before", not the second they landed in.
    const t = (id: string) => orderOf(longClimb, id)
    expect(t('pc-8c16t')).toBeLessThan(t('rtx-3060'))
    expect(t('rtx-3060')).toBeLessThan(t('rtx-4090'))
    expect(t('rtx-4090')).toBeLessThan(t('rtx-5090'))
    expect(t('rtx-5090')).toBeLessThan(firstOrderOf(longClimb, cloudNodeIds))
    // And the seconds agree wherever they are apart.
    expect(climb.firsts['rtx-3060']).toBeLessThan(climb.firsts['rtx-4090'])
    expect(climb.firsts['rtx-4090']).toBeLessThan(climb.firsts['rtx-5090'])
  })

  it('takes the workstation on-ramp: A6000 before the L4, PRO 6000 before any cloud node', () => {
    const t = (id: string) => orderOf(longClimb, id)
    expect(t('rtx-5090')).toBeLessThan(t('rtx-a6000'))
    expect(t('rtx-a6000')).toBeLessThan(t('l4'))
    for (const id of cloudNodeIds) expect(t('rtx-pro-6000'), id).toBeLessThan(t(id))
    expect(longClimb.firsts['rtx-pro-6000']).toBeLessThan(firstOf(longClimb, cloudNodeIds))
  })

  it('never buys the AMD consumer family without ROCm, and does with it', () => {
    const amd = HARDWARE.filter((h) => h.family === 'amd-consumer').map((h) => h.id)
    for (const id of amd) expect(climb.owned[id] ?? 0).toBe(0)
    const withRocm = simulate('climb', 10 * MIN, { rocm: true })
    expect(amd.some((id) => (withRocm.owned[id] ?? 0) > 0)).toBe(true)
  })
})

describe('pacing: climb upper bounds (something has to be slow)', () => {
  it('does not own a Comfy Cloud region inside three hours of continuous play', () => {
    for (const id of regionIds) expect(climb.firsts[id], id).toBeUndefined()
  })

  it('owns the 8x B300 pod by the end of eight hours, and every cloud node by ten', () => {
    expect(longClimb.firsts['runpod-8xb300']).toBeLessThanOrEqual(8 * HOUR)
    for (const id of cloudNodeIds) expect(longClimb.owned[id] ?? 0, id).toBeGreaterThan(0)
  })

  it('reaches a region on a one-hour-a-day fortnight, never on day one', () => {
    expect(fortnight[0]!.firsts).not.toContain('region-us-east')
    expect(fortnight.some((d) => d.firsts.includes('region-us-east'))).toBe(true)
    // The region needs level 12; day one ends well short of it.
    expect(fortnight[0]!.level).toBeLessThan(12)
  })

  it('leaves the Dyson swarm and the orbital datacenter beyond a one-hour-a-day week', () => {
    expect(fortnight[6]!.best).not.toBe('dyson-swarm')
    expect(fortnight[6]!.best).not.toBe('orbital-dc')
    // The bank keeps moving all fortnight (no dead days), and the level never slips.
    for (let i = 1; i < fortnight.length; i++) {
      expect(fortnight[i]!.cps, `day ${i + 1}`).toBeGreaterThan(fortnight[i - 1]!.cps)
      expect(fortnight[i]!.level, `day ${i + 1}`).toBeGreaterThanOrEqual(fortnight[i - 1]!.level)
    }
  })

  it('caps the one-off units at a single copy', () => {
    for (const id of ['region-us-east', 'region-eu-west', 'region-ap-southeast', 'orbital-dc', 'dyson-swarm']) {
      expect(HARDWARE.find((h) => h.id === id)?.max, id).toBe(1)
      expect(fortnight[13]!.firsts.filter((x) => x === id).length, id).toBeLessThanOrEqual(1)
    }
  })
})

describe('pacing: levels (the level is the pace of the ladder)', () => {
  it.each(LEVEL_WINDOWS)('reaches level %i inside its window', (level, lo, hi) => {
    const t = longClimb.levels[level]
    expect(t, `level ${level} never reached`).toBeDefined()
    expect(t, `level ${level} early`).toBeGreaterThanOrEqual(lo)
    expect(t, `level ${level} late`).toBeLessThanOrEqual(hi)
  })

  it.each(MEASURED_ARRIVAL_S)('reaches level %i within 15 percent of the measured %i s', (level, measured) => {
    const t = longClimb.levels[level]
    expect(t, `level ${level} never reached`).toBeDefined()
    expect(t, `level ${level} earlier than measured`).toBeGreaterThanOrEqual(Math.floor((1 - MEASURED_BAND) * measured))
    expect(t, `level ${level} later than measured`).toBeLessThanOrEqual(Math.ceil((1 + MEASURED_BAND) * measured))
  })

  it('reaches the levels in order and reports the level its XP gives', () => {
    expect(longClimb.levels[1]).toBe(0)
    for (let level = 2; level <= longClimb.level; level++) {
      expect(longClimb.levels[level], `level ${level}`).toBeGreaterThanOrEqual(longClimb.levels[level - 1]!)
    }
    for (const level of Object.keys(longClimb.levels).map(Number)) expect(level).toBeLessThanOrEqual(longClimb.level)
    expect(levelForXp(longClimb.xp)).toBe(longClimb.level)
    expect(longClimb.xp).toBeGreaterThanOrEqual(LEVEL_XP[longClimb.level - 1]!)
    expect(longClimb.level).toBeLessThanOrEqual(MAX_LEVEL)
  })

  it('never owns a unit whose minLevel exceeds the level it had when it bought it', () => {
    // The 3 h runs stop at the H200 rung (level 9). The 10 h climb buys the level 10 and 11 rungs
    // and the first region, and the fortnight is the only run that reaches levels through the
    // offline settle and the daily claim and buys the later regions, so the gate is checked on
    // every rung it was added for.
    const minLevelOf = (id: string): number => HARDWARE.find((h) => h.id === id)?.minLevel ?? 1
    const lastDay = fortnight[fortnight.length - 1]!
    for (const r of [climb, naive, longClimb, lastDay]) {
      for (const h of HARDWARE) {
        if ((r.owned[h.id] ?? 0) === 0) continue
        expect(r.levelAtBuy[h.id], h.id).toBeGreaterThanOrEqual(h.minLevel ?? 1)
        expect(r.buyOrder).toContain(h.id)
      }
    }
    expect(Math.max(...longClimb.buyOrder.map(minLevelOf))).toBeGreaterThanOrEqual(11)
    expect(Math.max(...lastDay.buyOrder.map(minLevelOf))).toBeGreaterThanOrEqual(12)
  })

  it('banks XP from every source the sim models', () => {
    for (const source of ['post', 'contract', 'mapNode', 'achievement', 'hardware', 'upgrade', 'tier', 'setup', 'milestone'] as const) {
      expect(longClimb.xpBy[source] ?? 0, source).toBeGreaterThan(0)
    }
    // A continuous session never claims the daily; only the day-by-day projection does.
    expect(longClimb.xpBy.daily).toBeUndefined()
  })

  it('levels slower without posts (the taper: 6/min, 4/min, 2/min, 1/min)', () => {
    const quiet = simulate('climb', 30 * MIN, { postRate: () => 0 })
    expect(quiet.levels[5] ?? Infinity).toBeGreaterThan(longClimb.levels[5]!)
    expect(quiet.xpBy.post).toBeUndefined()
    expect(defaultPostRate(0)).toBe(6)
    expect(defaultPostRate(3 * MIN)).toBe(4)
    expect(defaultPostRate(10 * MIN)).toBe(2)
    expect(defaultPostRate(30 * MIN)).toBe(1)
  })
})

describe('pacing: naive (spend everything on the best affordable payback)', () => {
  // Naive spending trips the breaker with cheap boxes, and a tripped breaker earns nothing at all,
  // so the detour through the PSU ladder costs it minutes that climbing never pays.
  it('still reaches the RTX 4090 within 30 minutes', () => {
    expect(naive.firsts['rtx-4090']).toBeLessThan(30 * MIN)
  })

  it('is slower than climbing at every milestone', () => {
    for (const id of ['rtx-3060', 'rtx-4090', 'rtx-5090']) {
      expect(naive.firsts[id], id).toBeGreaterThan(climb.firsts[id]!)
    }
    // Compared over the 10 h runs, so a retune that pushes naive past three hours for level 9
    // still reads as "slower" rather than as a missing number.
    for (const level of [5, 9]) {
      expect(longNaive.levels[level], `level ${level} never reached by naive`).toBeDefined()
      expect(longClimb.levels[level], `level ${level} never reached by climb`).toBeDefined()
      expect(longNaive.levels[level], `level ${level}`).toBeGreaterThan(longClimb.levels[level]!)
    }
  })

  it('buys power upgrades once the breaker trips', () => {
    expect(Object.keys(naive.firsts).some((k) => k.startsWith('power:'))).toBe(true)
    expect(naive.powerBudget).toBeGreaterThan(650)
  })
})

describe('simulator invariants', () => {
  it('starts with the office PC, a zero bank and level 1', () => {
    const r = simulate('climb', 0)
    expect(r.owned).toEqual({ 'pc-4c8t': 1 })
    expect(r.firsts).toEqual({ 'pc-4c8t': 0 })
    expect(r.bank).toBe(0)
    expect(r.cps).toBeCloseTo(HARDWARE[0].baseCps, 6)
    expect(r.level).toBe(1)
    expect(r.xp).toBe(0)
    expect(r.levels).toEqual({ 1: 0 })
    expect(r.levelAtBuy).toEqual({ 'pc-4c8t': 1 })
    expect(r.buyOrder).toEqual(['pc-4c8t'])
    expect(r.xpBy).toEqual({})
  })

  it('is deterministic and monotone in cps over time', () => {
    const a = simulate('climb', 5 * MIN)
    const b = simulate('climb', 5 * MIN)
    expect(a).toEqual(b)
    expect(simulate('climb', 10 * MIN).cps).toBeGreaterThan(a.cps)
    expect(simulate('climb', 10 * MIN).xp).toBeGreaterThan(a.xp)
  })

  it('records first-purchase times inside the horizon, never negative', () => {
    for (const [id, t] of Object.entries(climb.firsts)) {
      expect(t, id).toBeGreaterThanOrEqual(0)
      expect(t, id).toBeLessThanOrEqual(HORIZON_S)
    }
    for (const [level, t] of Object.entries(longClimb.levels)) {
      expect(t, `level ${level}`).toBeGreaterThanOrEqual(0)
      expect(t, `level ${level}`).toBeLessThanOrEqual(LONG_HORIZON_S)
    }
  })

  it('honours a custom click rate (no clicks ⇒ a much slower start)', () => {
    const idle = simulate('climb', 5 * MIN, { clickRate: () => 0 })
    expect(idle.firsts['rtx-3060'] ?? Infinity).toBeGreaterThan(climb.firsts['rtx-3060']!)
    expect(defaultClickRate(0)).toBe(3)
    expect(defaultClickRate(3 * MIN)).toBe(2)
    expect(defaultClickRate(10 * MIN)).toBe(1)
    expect(defaultClickRate(30 * MIN)).toBe(0.5)
  })
})
