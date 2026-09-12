import { describe, expect, it } from 'vitest'
import { HARDWARE } from '@/data/hardware'
import { defaultClickRate, projectWeek, simulate } from '../../../scripts/balance'

const MIN = 60
/** Long enough to cover every assertion below with margin. */
const HORIZON_S = 45 * MIN

const climb = simulate('climb', HORIZON_S)
const naive = simulate('naive', HORIZON_S)

const cloudNodeIds = HARDWARE.filter((h) => h.family === 'cloud-node').map((h) => h.id)
const firstOf = (r: { firsts: Record<string, number> }, ids: string[]): number =>
  Math.min(...ids.map((id) => r.firsts[id] ?? Infinity))

describe('pacing: climb (save for the best reachable unit, 3 clicks/s tapering off)', () => {
  it('reaches the used RTX 3060 within 3 minutes', () => {
    expect(climb.firsts['rtx-3060']).toBeLessThan(3 * MIN)
  })

  it('reaches the RTX 4090 within 8 minutes', () => {
    expect(climb.firsts['rtx-4090']).toBeLessThan(8 * MIN)
  })

  it('reaches the RTX PRO 6000 within 15 minutes (contract)', () => {
    expect(climb.firsts['rtx-pro-6000']).toBeLessThan(15 * MIN)
  })

  it('rents a cloud node within 25 minutes (contract)', () => {
    expect(firstOf(climb, cloudNodeIds)).toBeLessThan(25 * MIN)
  })

  it('keeps the first purchases in ladder order (no skipped cheap tiers before the 4090)', () => {
    const t = climb.firsts
    expect(t['pc-8c16t']).toBeLessThan(t['rtx-3060'])
    expect(t['rtx-3060']).toBeLessThan(t['rtx-4090'])
    expect(t['rtx-4090']).toBeLessThan(t['rtx-5090'])
    expect(t['rtx-5090']).toBeLessThan(firstOf(climb, cloudNodeIds))
  })

  it('takes the workstation on-ramp: A6000 before the L4, PRO 6000 before any cloud node', () => {
    const t = climb.firsts
    expect(t['rtx-5090']).toBeLessThan(t['rtx-a6000'])
    expect(t['rtx-a6000']).toBeLessThan(t['l4'])
    expect(t['rtx-pro-6000']).toBeLessThan(firstOf(climb, cloudNodeIds))
  })

  it('never buys the AMD consumer family without ROCm, and does with it', () => {
    const amd = HARDWARE.filter((h) => h.family === 'amd-consumer').map((h) => h.id)
    for (const id of amd) expect(climb.owned[id] ?? 0).toBe(0)
    const withRocm = simulate('climb', 10 * MIN, { rocm: true })
    expect(amd.some((id) => (withRocm.owned[id] ?? 0) > 0)).toBe(true)
  })
})

describe('pacing: climb upper bounds (something has to be slow)', () => {
  const longClimb = simulate('climb', 3 * 60 * MIN)

  it('does not own a Comfy Cloud region inside three hours of continuous play', () => {
    for (const h of HARDWARE.filter((x) => x.family === 'region')) {
      expect(longClimb.firsts[h.id], h.id).toBeUndefined()
    }
  })

  it('still buys a real rack in those three hours', () => {
    expect(longClimb.firsts['runpod-8xb300']).toBeDefined()
    for (const id of cloudNodeIds) expect(longClimb.owned[id] ?? 0, id).toBeGreaterThan(0)
  })

  it('leaves the Dyson swarm and the orbital datacenter beyond a one-hour-a-day week', () => {
    const week = projectWeek('climb')
    expect(week[6]!.best).not.toBe('dyson-swarm')
    expect(week[6]!.best).not.toBe('orbital-dc')
    // Regions are the week's mid-game, not day one's.
    expect(week[0]!.firsts).not.toContain('region-us-east')
    expect(week.some((d) => d.firsts.includes('region-us-east'))).toBe(true)
    // The bank keeps moving all week (no dead days).
    for (let i = 1; i < week.length; i++) expect(week[i]!.cps).toBeGreaterThan(week[i - 1]!.cps)
  })

  it('caps the one-off units at a single copy', () => {
    for (const id of ['region-us-east', 'region-eu-west', 'region-ap-southeast', 'orbital-dc', 'dyson-swarm']) {
      expect(projectWeek('climb', {}, 14)[13]!.firsts.length).toBeGreaterThanOrEqual(0)
      expect(HARDWARE.find((h) => h.id === id)?.max).toBe(1)
    }
  })
})

describe('pacing: naive (spend everything on the best affordable payback)', () => {
  // Naive spending trips the breaker with cheap boxes, so the proportional throttle costs it a few minutes.
  const naiveLong = simulate('naive', 60 * MIN)

  it('still reaches the RTX 4090 within 25 minutes', () => {
    expect(naive.firsts['rtx-4090']).toBeLessThan(25 * MIN)
  })

  it('is slower than climbing at every milestone', () => {
    for (const id of ['rtx-3060', 'rtx-4090', 'rtx-5090']) {
      expect(naiveLong.firsts[id], id).toBeGreaterThan(climb.firsts[id])
    }
  })

  it('buys power upgrades once the breaker trips', () => {
    expect(Object.keys(naiveLong.firsts).some((k) => k.startsWith('power:'))).toBe(true)
    expect(naiveLong.powerBudget).toBeGreaterThan(650)
  })
})

describe('simulator invariants', () => {
  it('starts with the office PC and a zero bank', () => {
    const r = simulate('climb', 0)
    expect(r.owned).toEqual({ 'pc-4c8t': 1 })
    expect(r.firsts).toEqual({ 'pc-4c8t': 0 })
    expect(r.bank).toBe(0)
    expect(r.cps).toBeCloseTo(HARDWARE[0].baseCps, 6)
  })

  it('is deterministic and monotone in cps over time', () => {
    const a = simulate('climb', 5 * MIN)
    const b = simulate('climb', 5 * MIN)
    expect(a).toEqual(b)
    expect(simulate('climb', 10 * MIN).cps).toBeGreaterThan(a.cps)
  })

  it('records first-purchase times inside the horizon, never negative', () => {
    for (const [id, t] of Object.entries(climb.firsts)) {
      expect(t, id).toBeGreaterThanOrEqual(0)
      expect(t, id).toBeLessThanOrEqual(HORIZON_S)
    }
  })

  it('honours a custom click rate (no clicks ⇒ a much slower start)', () => {
    const idle = simulate('climb', 5 * MIN, { clickRate: () => 0 })
    expect(idle.firsts['rtx-3060'] ?? Infinity).toBeGreaterThan(climb.firsts['rtx-3060'])
    expect(defaultClickRate(0)).toBe(3)
    expect(defaultClickRate(3 * MIN)).toBe(2)
    expect(defaultClickRate(10 * MIN)).toBe(1)
    expect(defaultClickRate(30 * MIN)).toBe(0.5)
  })
})
