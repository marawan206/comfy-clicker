/**
 * The hero level bar's pure parts, pinned: which chips the next rung shows and in what order, the
 * percent rule the bar shares with `goals.ts`, and the accessible name in the house style (no
 * em-dash, no exclamation mark, the next rung named or `credits only`).
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from '@/data'
import { LOUNGE_MIN_LEVEL, MAX_LEVEL } from '@/game/constants'
import { LOUNGE_FEATURE_NAME, levelRoadmap, levelTitle } from '@/game/level'
import { levelBarLabel, pctOf, unlockChips } from '../LevelBar'

/** The one character the house style forbids, spelled so this file does not contain it. */
const EM_DASH = String.fromCharCode(0x2014)

/** A rung past the model table and between the hardware rungs: it pays credits and nothing else. */
const CREDITS_ONLY_LEVEL = 15

describe('unlockChips', () => {
  it('lists the next rung as cards first, then checkpoints, then the Lounge', () => {
    const rung = levelRoadmap(CATALOG)[LOUNGE_MIN_LEVEL - 1]!
    expect(rung.hardware.length).toBeGreaterThan(0)
    expect(rung.models.length).toBeGreaterThan(0)
    expect(rung.features).toEqual([LOUNGE_FEATURE_NAME])

    const { chips, more } = unlockChips(LOUNGE_MIN_LEVEL - 1, CATALOG, Infinity)
    expect(chips.map((c) => c.key)).toEqual([
      ...rung.hardware.map((h) => `hw-${h.id}`),
      ...rung.models.map((m) => `model-${m.id}`),
      `feature-${LOUNGE_FEATURE_NAME}`,
    ])
    expect(chips.map((c) => c.name)).toEqual([...rung.hardware.map((h) => h.name), ...rung.models.map((m) => m.name), LOUNGE_FEATURE_NAME])
    // A card or a checkpoint carries its art id; the Lounge is a plain chip.
    for (const chip of chips) expect(chip.art).toBe(chip.key.startsWith('feature-') ? null : chip.key)
    expect(more).toBe(0)
  })

  it('shows three and counts the rest', () => {
    const { chips, more } = unlockChips(1, CATALOG)
    expect(chips.map((c) => c.key)).toEqual(['hw-mac-mini-m4', 'hw-rx-7600-xt', 'hw-rtx-3060'])
    expect(more).toBe(3)
  })

  it('is empty on a rung that only pays credits', () => {
    const rung = levelRoadmap(CATALOG)[CREDITS_ONLY_LEVEL - 1]!
    expect(rung.hardware).toEqual([])
    expect(rung.models).toEqual([])
    expect(rung.features).toEqual([])
    expect(unlockChips(CREDITS_ONLY_LEVEL - 1, CATALOG)).toEqual({ chips: [], more: 0 })
  })

  it('is empty at the top of the table', () => {
    expect(unlockChips(MAX_LEVEL, CATALOG)).toEqual({ chips: [], more: 0 })
    expect(unlockChips(MAX_LEVEL + 5, CATALOG)).toEqual({ chips: [], more: 0 })
  })

  it('never shows more than three or counts below zero, at any level', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const { chips, more } = unlockChips(level, CATALOG)
      expect(chips.length).toBeLessThanOrEqual(3)
      expect(more).toBeGreaterThanOrEqual(0)
      const rung = level < MAX_LEVEL ? levelRoadmap(CATALOG)[level]! : null
      const total = rung ? rung.hardware.length + rung.models.length + rung.features.length : 0
      expect(chips.length + more).toBe(total)
    }
  })
})

describe('pctOf', () => {
  it('floors, so the bar never reads 100 while XP is still to go', () => {
    expect(pctOf(0.629)).toBe(62)
    expect(pctOf(0.999)).toBe(99)
    expect(pctOf(1)).toBe(100)
  })

  it('clamps to 0..100 and treats garbage as empty', () => {
    expect(pctOf(0)).toBe(0)
    expect(pctOf(-0.5)).toBe(0)
    expect(pctOf(Number.NaN)).toBe(0)
    expect(pctOf(2)).toBe(100)
  })
})

describe('levelBarLabel', () => {
  it('names the level, the progress and what the next rung opens', () => {
    expect(levelBarLabel(4, 62, 1300, ['RTX 5090', 'Radeon Pro W7900', 'Wan 2.2 5B'], 1)).toBe(
      'Level 4, Guidance Scale, 62 percent of the way to level 5, 1,300 XP to go. Level 5 unlocks RTX 5090, Radeon Pro W7900, Wan 2.2 5B and 1 more. Open your level.',
    )
    expect(levelBarLabel(1, 0, 700, ['Mac mini M4'], 0)).toBe(
      'Level 1, Fresh Install, 0 percent of the way to level 2, 700 XP to go. Level 2 unlocks Mac mini M4. Open your level.',
    )
  })

  it('says credits only on a rung that opens nothing', () => {
    expect(levelBarLabel(CREDITS_ONLY_LEVEL - 1, 10, 5000, [], 0)).toBe(
      `Level 14, Seed Oracle, 10 percent of the way to level 15, 5,000 XP to go. Level ${CREDITS_ONLY_LEVEL} pays credits only. Open your level.`,
    )
  })

  it('says maxed at the top of the table and drops the numbers', () => {
    expect(levelBarLabel(MAX_LEVEL, 100, 0, [], 0)).toBe(`Level ${MAX_LEVEL}, ${levelTitle(MAX_LEVEL)}, maxed. Open your level.`)
  })

  it('keeps the house style at every level', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const { chips, more } = unlockChips(level, CATALOG)
      const label = levelBarLabel(level, 37, 1234, chips.map((c) => c.name), more)
      expect(label).not.toContain(EM_DASH)
      expect(label).not.toContain('!')
      expect(label.endsWith('Open your level.')).toBe(true)
    }
  })
})
