import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import {
  CITIZEN_COLD_HEAT,
  CITIZEN_FEED_MAX,
  CITIZEN_HEAT_DECAY,
  CITIZEN_MAX_DROPS,
  CITIZEN_MAX_GAP_MS,
  CITIZEN_MIN_GAP_MS,
  CITIZEN_ROYALTY_MIN,
  CITIZEN_ROYALTY_SECS,
  CITIZEN_TREND_MS,
} from '@/game/constants'
import { addDrop, citizenHandle, hotDrops, isCold, nextGapMs, runCitizens, runRoyalty } from '@/game/citizens'
import { createEmptyDerived } from '@/game/derived'
import { mulberry32 } from '@/game/rng'
import { createInitialState } from '@/game/state'
import type { Derived, GameState } from '@/game/types'

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0)
const MIN = 60_000

const derivedWith = (cps: number): Derived => ({ ...createEmptyDerived(), cps })

/** Deterministic rng at the midpoint of every range, so gaps and picks are predictable. */
const half = () => 0.5

function stateWithDrop(now = T0, rng = half): GameState {
  const s = createInitialState(now, 'guest')
  addDrop(s, now, rng, 'w1', 'Hands, fixed')
  return s
}

describe('citizenHandle', () => {
  it('builds a handle from the catalog pools', () => {
    const handle = citizenHandle(mulberry32(1), CATALOG)
    expect(handle).toMatch(/^[a-z0-9]+_[a-z0-9]+$/)
    const [prefix, rest] = handle.split('_') as [string, string]
    expect(CATALOG.citizens.prefixes).toContain(prefix)
    expect(CATALOG.citizens.suffixes.some((sfx) => rest.startsWith(sfx))).toBe(true)
  })

  it('is deterministic for a given rng', () => {
    expect(citizenHandle(mulberry32(9), CATALOG)).toBe(citizenHandle(mulberry32(9), CATALOG))
  })
})

describe('nextGapMs and runRoyalty', () => {
  it('slows down as the workflow cools', () => {
    const hot = nextGapMs(1, half)
    const cooling = nextGapMs(0.5, half)
    expect(hot).toBeGreaterThanOrEqual(CITIZEN_MIN_GAP_MS)
    expect(hot).toBeLessThanOrEqual(CITIZEN_MAX_GAP_MS)
    expect(cooling).toBeGreaterThan(hot)
  })

  it('pays seconds of income scaled by heat, with a floor', () => {
    expect(runRoyalty(derivedWith(100), 1)).toBe(CITIZEN_ROYALTY_SECS * 100)
    expect(runRoyalty(derivedWith(100), 0.5)).toBe((CITIZEN_ROYALTY_SECS * 100) / 2)
    expect(runRoyalty(derivedWith(0), 1)).toBe(CITIZEN_ROYALTY_MIN)
  })
})

describe('addDrop', () => {
  it('starts a drop hot with a run already scheduled', () => {
    const s = stateWithDrop()
    const drop = s.citizens.drops[0]!
    expect(drop).toMatchObject({ id: 'w1', name: 'Hands, fixed', runs: 0, royalties: 0, heat: 1, cold: false })
    expect(drop.nextRunAt).toBeGreaterThan(T0)
    expect(hotDrops(s)).toHaveLength(1)
  })

  it('names an untitled workflow rather than showing a blank row', () => {
    const s = createInitialState(T0, 'guest')
    addDrop(s, T0, half, 'w1', '   ')
    expect(s.citizens.drops[0]!.name).toBe('Untitled workflow')
  })

  it('republishing the same id replaces the drop instead of doubling it', () => {
    const s = stateWithDrop()
    addDrop(s, T0 + MIN, half, 'w1', 'Hands, fixed again')
    expect(s.citizens.drops).toHaveLength(1)
    expect(s.citizens.drops[0]!.name).toBe('Hands, fixed again')
  })

  it('keeps the newest and drops the coldest once the board is full', () => {
    const s = createInitialState(T0, 'guest')
    for (let i = 0; i < CITIZEN_MAX_DROPS; i++) addDrop(s, T0 + i, half, `w${i}`, `Workflow ${i}`)
    s.citizens.drops[2]!.cold = true
    addDrop(s, T0 + 100, half, 'new', 'The newest one')

    expect(s.citizens.drops).toHaveLength(CITIZEN_MAX_DROPS)
    expect(s.citizens.drops.map((d) => d.id)).toContain('new')
    expect(s.citizens.drops.map((d) => d.id)).not.toContain('w2')
  })
})

describe('runCitizens', () => {
  const d = derivedWith(100)

  it('pays nothing until the first run is due', () => {
    const s = stateWithDrop()
    expect(runCitizens(s, d, CATALOG, T0, half)).toEqual([])
    expect(s.credits).toBe(0)
  })

  it('pays a royalty, a run and a point of rep when one comes due', () => {
    const s = stateWithDrop()
    const due = s.citizens.drops[0]!.nextRunAt
    const events = runCitizens(s, d, CATALOG, due, mulberry32(4))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'citizenRun', workflowName: 'Hands, fixed' })
    const drop = s.citizens.drops[0]!
    expect(drop.runs).toBe(1)
    expect(drop.royalties).toBeGreaterThan(0)
    expect(s.credits).toBe(drop.royalties)
    expect(s.stats.hubRuns).toBe(1)
    expect(s.hubRep).toBe(1)
    // Royalties are income, so lifetime and season totals move with the bank.
    expect(s.lifetimeCredits).toBe(drop.royalties)
    expect(s.seasonCredits).toBe(drop.royalties)
    expect(s.citizens.feed).toHaveLength(1)
    expect(s.citizens.feed[0]!.handle).toBe((events[0] as { handle: string }).handle)
  })

  it('takes at most one run per drop however long the tab was closed', () => {
    const s = stateWithDrop()
    const away = T0 + 8 * 60 * MIN
    // A gap that long also outlives the trending window, so the drop cools instead of paying.
    expect(runCitizens(s, d, CATALOG, away, half)).toEqual([])
    expect(s.citizens.drops[0]!.cold).toBe(true)

    const fresh = stateWithDrop()
    const soon = fresh.citizens.drops[0]!.nextRunAt + 5 * MIN
    expect(runCitizens(fresh, d, CATALOG, soon, mulberry32(2))).toHaveLength(1)
    expect(fresh.citizens.drops[0]!.runs).toBe(1)
    expect(runCitizens(fresh, d, CATALOG, soon, mulberry32(2))).toEqual([])
  })

  it('cools with every run and stops paying once cold', () => {
    const s = stateWithDrop()
    const r = mulberry32(5)
    let now = T0
    let runs = 0
    // Walk the clock forward run by run until the drop goes cold on its own.
    for (let i = 0; i < 500 && !s.citizens.drops[0]!.cold; i++) {
      now = s.citizens.drops[0]!.nextRunAt
      if (now - T0 > CITIZEN_TREND_MS) break
      runs += runCitizens(s, d, CATALOG, now, r).length
    }
    const drop = s.citizens.drops[0]!
    expect(drop.cold).toBe(true)
    expect(runs).toBeGreaterThan(10)
    expect(drop.heat).toBeLessThan(CITIZEN_COLD_HEAT)
    expect(drop.royalties).toBeGreaterThan(0)

    // Cold means cold: no further run, ever, however far the clock moves.
    const paid = drop.royalties
    expect(runCitizens(s, d, CATALOG, now + CITIZEN_TREND_MS, r)).toEqual([])
    expect(drop.royalties).toBe(paid)
  })

  /**
   * The economic ceiling. A publish is a burst, not an annuity: whatever the rig earns, one
   * workflow may not pay out more than a minute and a half of income over its whole life.
   */
  it('pays out less than 90 seconds of income per published workflow', () => {
    const cps = 1_000
    const rig = derivedWith(cps)
    const s = stateWithDrop()
    const r = mulberry32(3)
    let now = T0
    for (let i = 0; i < 2_000 && !s.citizens.drops[0]!.cold; i++) {
      now = Math.max(now, s.citizens.drops[0]!.nextRunAt)
      runCitizens(s, rig, CATALOG, now, r)
    }
    expect(s.citizens.drops[0]!.royalties).toBeLessThan(90 * cps)
  })

  it('marks a drop cold once the trending window closes, whatever its heat', () => {
    const s = stateWithDrop()
    const drop = s.citizens.drops[0]!
    expect(isCold(drop, T0)).toBe(false)
    expect(isCold(drop, T0 + CITIZEN_TREND_MS + 1)).toBe(true)
  })

  it('keeps the activity list to CITIZEN_FEED_MAX entries', () => {
    const s = createInitialState(T0, 'guest')
    for (let i = 0; i < CITIZEN_MAX_DROPS; i++) addDrop(s, T0, half, `w${i}`, `Workflow ${i}`)
    const r = mulberry32(8)
    let now = T0
    for (let i = 0; i < 40; i++) {
      now += CITIZEN_MAX_GAP_MS
      if (now - T0 > CITIZEN_TREND_MS) break
      runCitizens(s, derivedWith(10), CATALOG, now, r)
    }
    expect(s.citizens.feed.length).toBeLessThanOrEqual(CITIZEN_FEED_MAX)
  })

  it('does nothing with an empty name pool', () => {
    const s = stateWithDrop()
    const empty = createCatalog({ citizens: { prefixes: [], suffixes: [], lines: [] } })
    expect(runCitizens(s, d, CATALOG, T0, half)).toEqual([])
    expect(runCitizens(s, d, empty, s.citizens.drops[0]!.nextRunAt, half)).toEqual([])
    expect(s.credits).toBe(0)
  })

  it('decays heat by exactly CITIZEN_HEAT_DECAY a run', () => {
    const s = stateWithDrop()
    runCitizens(s, d, CATALOG, s.citizens.drops[0]!.nextRunAt, mulberry32(6))
    expect(s.citizens.drops[0]!.heat).toBeCloseTo(CITIZEN_HEAT_DECAY, 10)
  })
})
