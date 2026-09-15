/**
 * The click combo: the tier table, the streak's gap rule, the multiplier riding on the click, the
 * best streak that persists, and the two achievements that read it.
 */
import { describe, expect, it } from 'vitest'

import { CATALOG } from '@/data'
import { checkAchievements } from '@/game/achievements'
import { click, type ActionContext } from '@/game/actions'
import { advanceCombo, comboCount, comboMult, comboTier, isComboTierUp, nextComboTier, resetCombo } from '@/game/combo'
import { CLICK_CAP_PER_SEC, COMBO_GAP_MS, COMBO_TIERS, LUCKY_CLICK_MULT } from '@/game/constants'
import { createEmptyDerived } from '@/game/derived'
import { deserialize, serialize } from '@/game/save'
import { createInitialState } from '@/game/state'
import type { GameEvent, GameState } from '@/game/types'

const T0 = 1_700_000_000_000
const GUEST = 'guest'

function fresh(): GameState {
  return createInitialState(T0, GUEST)
}

function ctxFor(state: GameState, now: number, rng: () => number = () => 1): ActionContext {
  return { state, derived: { ...createEmptyDerived(), clickValue: 2 }, catalog: CATALOG, now, rng }
}

/** `n` accepted clicks `gapMs` apart starting at `from`; returns the events of the last one. */
function streak(state: GameState, n: number, gapMs: number, from = T0): GameEvent[] {
  let events: GameEvent[] = []
  for (let i = 0; i < n; i++) events = click(ctxFor(state, from + i * gapMs)).events
  return events
}

describe('the tier table', () => {
  it('is ascending in clicks and in pay, and starts above one click', () => {
    expect(COMBO_TIERS.length).toBeGreaterThan(0)
    expect(COMBO_TIERS[0]?.at).toBeGreaterThan(1)
    for (let i = 1; i < COMBO_TIERS.length; i++) {
      expect(COMBO_TIERS[i]!.at).toBeGreaterThan(COMBO_TIERS[i - 1]!.at)
      expect(COMBO_TIERS[i]!.mult).toBeGreaterThan(COMBO_TIERS[i - 1]!.mult)
    }
    expect(COMBO_TIERS[0]!.mult).toBeGreaterThan(1)
  })

  it('pays 1 below the first tier and the reached tier from then on', () => {
    expect(comboTier(0)).toBe(0)
    expect(comboMult(0)).toBe(1)
    expect(comboMult(9)).toBe(1)
    expect(comboMult(10)).toBe(1.25)
    expect(comboMult(24)).toBe(1.25)
    expect(comboMult(25)).toBe(1.5)
    expect(comboMult(50)).toBe(2)
    expect(comboMult(99)).toBe(2)
    expect(comboMult(100)).toBe(3)
    expect(comboMult(10_000)).toBe(3)
    expect(comboTier(100)).toBe(COMBO_TIERS.length)
  })

  it('knows the click that raised the multiplier, and the tier after it', () => {
    expect(isComboTierUp(10)).toBe(true)
    expect(isComboTierUp(11)).toBe(false)
    expect(nextComboTier(0)).toEqual({ at: 10, mult: 1.25 })
    expect(nextComboTier(10)).toEqual({ at: 25, mult: 1.5 })
    expect(nextComboTier(100)).toBeNull()
  })
})

describe('the streak', () => {
  it('grows while clicks stay inside the gap and restarts past it', () => {
    const state = fresh()
    expect(comboCount(state, T0)).toBe(0)
    expect(advanceCombo(state, T0)).toBe(1)
    expect(advanceCombo(state, T0 + COMBO_GAP_MS)).toBe(2)
    expect(comboCount(state, T0 + COMBO_GAP_MS)).toBe(2)
    expect(comboCount(state, T0 + 2 * COMBO_GAP_MS + 1)).toBe(0)
    expect(advanceCombo(state, T0 + 2 * COMBO_GAP_MS + 1)).toBe(1)
  })

  it('restarts when the clock steps backwards, and forgets on reset', () => {
    const state = fresh()
    advanceCombo(state, T0)
    advanceCombo(state, T0 + 100)
    expect(advanceCombo(state, T0 - 1)).toBe(1)
    advanceCombo(state, T0 + 50)
    resetCombo(state)
    expect(comboCount(state, T0 + 60)).toBe(0)
  })

  it('keeps the best streak in the save and never lowers it', () => {
    const state = fresh()
    for (let i = 0; i < 7; i++) advanceCombo(state, T0 + i * 100)
    expect(state.stats.bestCombo).toBe(7)
    advanceCombo(state, T0 + 10_000)
    expect(state.stats.bestCombo).toBe(7)
    const back = deserialize(serialize(state), T0, GUEST)
    expect(back.stats.bestCombo).toBe(7)
  })
})

describe('the click pays the streak', () => {
  it('multiplies the value from the first tier and says so on the event', () => {
    const state = fresh()
    const ninth = streak(state, 9, 100)
    expect(ninth[0]).toEqual({ type: 'click', value: 2, combo: 9, mult: 1 })
    const tenth = click(ctxFor(state, T0 + 9 * 100)).events
    expect(tenth[0]).toEqual({ type: 'click', value: 2.5, combo: 10, mult: 1.25 })
    expect(state.credits).toBe(9 * 2 + 2.5)
  })

  it('stacks on the lucky seed, and a gap drops it back to one', () => {
    const state = fresh()
    streak(state, 50, 100)
    const lucky = click(ctxFor(state, T0 + 50 * 100, () => 0)).events[0]
    expect(lucky).toEqual({ type: 'click', value: 2 * LUCKY_CLICK_MULT * 2, combo: 51, mult: 2, lucky: true })
    const after = click(ctxFor(state, T0 + 50 * 100 + COMBO_GAP_MS + 1)).events[0]
    expect(after).toEqual({ type: 'click', value: 2, combo: 1, mult: 1 })
  })

  it('a refused click neither counts nor breaks the streak', () => {
    const state = fresh()
    // The cap: CLICK_CAP_PER_SEC accepted clicks inside one second, then a refusal.
    const gap = Math.floor(1000 / (CLICK_CAP_PER_SEC + 4))
    streak(state, CLICK_CAP_PER_SEC, gap)
    const refused = click(ctxFor(state, T0 + CLICK_CAP_PER_SEC * gap)).events[0]
    expect(refused?.type).toBe('clickBlocked')
    const next = click(ctxFor(state, T0 + 1000 + gap)).events[0]
    expect(next).toMatchObject({ type: 'click', combo: CLICK_CAP_PER_SEC + 1 })
  })

  it('a 50 streak and a 100 streak earn the two combo achievements', () => {
    const state = fresh()
    streak(state, 50, 100)
    const first = checkAchievements(state, createEmptyDerived(), CATALOG)
    expect(first.some((e) => e.type === 'achievement' && e.id === 'clicks-combo-50')).toBe(true)
    expect(first.some((e) => e.type === 'achievement' && e.id === 'clicks-combo-100')).toBe(false)
    streak(state, 100, 100, T0 + 60_000)
    const second = checkAchievements(state, createEmptyDerived(), CATALOG)
    expect(second.some((e) => e.type === 'achievement' && e.id === 'clicks-combo-100')).toBe(true)
  })
})
