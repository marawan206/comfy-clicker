import { describe, expect, it } from 'vitest'
import { CATALOG, createCatalog, type Catalog } from '@/data'
import { HARDWARE } from '@/data/hardware'
import { MODELS } from '@/data/models'
import {
  CITIZEN_TREND_MS,
  CLICK_LOCKOUT_MAX_MS,
  LEVEL_REWARD_PER_LEVEL,
  LEVEL_REWARD_SECS,
  LEVEL_XP,
  LEVEL_XP_TAIL_GROWTH,
  LOUNGE_MIN_LEVEL,
  MAX_LEVEL,
  XP_ACHIEVEMENT,
  XP_CONTRACT,
  XP_CREDITS,
  XP_DAILY_PER_DAY,
  XP_HARDWARE_FIRST,
  XP_POST_BASE,
  XP_POST_PER_LEVEL,
  XP_REBRAND,
  XP_VIRAL_MULT,
} from '@/game/constants'
import { DAILY_CYCLE_DAYS } from '@/game/daily'
import { computeDerived, createEmptyDerived } from '@/game/derived'
import { resetTickMemo, tick } from '@/game/engine'
import {
  LOUNGE_FEATURE_NAME,
  XP_SOURCES,
  XP_SOURCE_LABELS,
  activityXp,
  creditsXp,
  dailyXp,
  featuresUnlockedAt,
  grantXp,
  hardwareLevelLock,
  hardwareUnlockedAt,
  levelForXp,
  levelProgress,
  levelReward,
  levelRoadmap,
  levelTitle,
  modelLevelLock,
  modelsUnlockedAt,
  nextUnlocks,
  playerLevel,
  playerXp,
  postXp,
  settleLevelUps,
  xpBreakdown,
  xpForLevel,
} from '@/game/level'
import { applyOffline } from '@/game/offline'
import { rebrand } from '@/game/prestige'
import { mulberry32 } from '@/game/rng'
import { deserialize, legacyXp, serialize } from '@/game/save'
import { addFollowers, removeFollowers } from '@/game/social'
import { createInitialState } from '@/game/state'
import type { Derived, GameEvent, GameStats, HardwareDef, ModelDef, XpSource } from '@/game/types'
import { describeUnlock } from '@/game/unlock'

/** Lifetime credits whose derived term alone reaches `xp`: the inverse of `creditsXp`, rounded up. */
const creditsForXp = (xp: number): number => Math.ceil(10 ** (xp / XP_CREDITS))

const T0 = 1_700_000_000_000
const GUEST = 'guest-level'

/** Real hardware and models, no achievements or contracts, so a tick says only what we asked it. */
const QUIET: Catalog = createCatalog({ hardware: HARDWARE, models: MODELS })

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

const ofType = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)

const modelAt = (minLevel?: number): ModelDef => ({ id: 'm', name: 'M', minLevel } as ModelDef)
const unitAt = (id: string, minLevel?: number): HardwareDef => ({ id, name: id, minLevel } as HardwareDef)

describe('LEVEL_XP', () => {
  it('starts at zero, is strictly increasing and covers every level', () => {
    expect(LEVEL_XP).toHaveLength(MAX_LEVEL)
    expect(LEVEL_XP[0]).toBe(0)
    for (let i = 1; i < LEVEL_XP.length; i++) {
      expect(LEVEL_XP[i] as number).toBeGreaterThan(LEVEL_XP[i - 1] as number)
    }
  })

  it('is hand-placed early, then each step grows by LEVEL_XP_TAIL_GROWTH in whole hundreds', () => {
    expect(LEVEL_XP_TAIL_GROWTH).toBeGreaterThan(1)
    for (const xp of LEVEL_XP) expect(xp % 100).toBe(0)
    // Level 13 onwards is generated: step = round(previous step × growth) to the nearest hundred.
    for (let i = 12; i < LEVEL_XP.length; i++) {
      const prevStep = (LEVEL_XP[i - 1] as number) - (LEVEL_XP[i - 2] as number)
      const step = (LEVEL_XP[i] as number) - (LEVEL_XP[i - 1] as number)
      expect(step, `level ${i + 1}`).toBe(Math.round((prevStep * LEVEL_XP_TAIL_GROWTH) / 100) * 100)
    }
  })

  it('levelForXp inverts xpForLevel at every threshold and one XP below it', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const xp = xpForLevel(level)
      expect(levelForXp(xp)).toBe(level)
      expect(levelForXp(xp - 1)).toBe(Math.max(1, level - 1))
    }
  })

  it('clamps outside the table', () => {
    expect(levelForXp(-500)).toBe(1)
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(MAX_LEVEL)
    expect(xpForLevel(0)).toBe(0)
    expect(xpForLevel(MAX_LEVEL + 10)).toBe(xpForLevel(MAX_LEVEL))
  })

  it('names every level', () => {
    expect(levelTitle(1)).toBe('Fresh Install')
    expect(levelTitle(4)).toBe('Guidance Scale')
    expect(levelTitle(MAX_LEVEL)).toBe('Honorary Maintainer')
    expect(levelTitle(MAX_LEVEL + 5)).toBe('Honorary Maintainer')
  })
})

describe('playerXp', () => {
  it('a fresh save is level 1 with no XP', () => {
    const state = createInitialState(T0, GUEST)
    expect(playerXp(state)).toBe(0)
    expect(playerLevel(state)).toBe(1)
    const p = levelProgress(state)
    expect(p).toMatchObject({ level: 1, xp: 0, floor: 0, ceiling: xpForLevel(2) })
    expect(p.fraction).toBe(0)
    expect(p.xpToGo).toBe(xpForLevel(2))
  })

  it('the credits term is XP_CREDITS per decade of lifetime credits, floored, and never negative', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e6
    expect(creditsXp(state)).toBe(Math.floor(XP_CREDITS * Math.log10(1 + 1e6)))
    state.lifetimeCredits = 1e7
    expect(creditsXp(state)).toBe(Math.floor(XP_CREDITS * Math.log10(1 + 1e7)))
    expect(creditsXp(state) - Math.floor(XP_CREDITS * Math.log10(1 + 1e6))).toBeGreaterThanOrEqual(XP_CREDITS - 1)
    state.lifetimeCredits = -5
    expect(creditsXp(state)).toBe(0)
    state.lifetimeCredits = Number.NaN
    expect(creditsXp(state)).toBe(0)
  })

  it('the ledger is summed as whole non-negative numbers, and a corrupt row reads as zero', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.xpBy = { post: 21, contract: 60, quantize: Number.NaN, lora: -5, daily: 12.9 }
    expect(activityXp(state)).toBe(21 + 60 + 12)
    expect(playerXp(state)).toBe(creditsXp(state) + activityXp(state))
    // A ledger that went missing altogether still adds up to something.
    state.stats.xpBy = undefined as unknown as GameStats['xpBy']
    expect(activityXp(state)).toBe(0)
    expect(playerXp(state)).toBe(creditsXp(state))
  })

  it('the breakdown lists credits first, then each banked source in display order, and adds up', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1_234_567
    state.stats.xpBy = { rebrand: 500, post: 21, contract: 60, achievement: 50, mapNode: 40, quantize: 0, lora: Number.NaN }
    const rows = xpBreakdown(state)
    expect(rows[0]).toEqual({ key: 'credits', label: 'credits earned', xp: creditsXp(state) })
    expect(rows.map((r) => r.key)).toEqual(['credits', 'post', 'contract', 'achievement', 'mapNode', 'rebrand'])
    for (const row of rows.slice(1)) expect(row.label).toBe(XP_SOURCE_LABELS[row.key as XpSource])
    expect(rows.reduce((sum, r) => sum + r.xp, 0)).toBe(playerXp(state))
    expect(rows.every((r) => Number.isInteger(r.xp) && r.xp >= 0)).toBe(true)
  })

  it('XP_SOURCES is the type order, each with one label', () => {
    expect(new Set(XP_SOURCES).size).toBe(XP_SOURCES.length)
    expect(Object.keys(XP_SOURCE_LABELS).sort()).toEqual([...XP_SOURCES].sort())
    expect(XP_SOURCES[0]).toBe('post')
    expect(XP_SOURCES.at(-1)).toBe('rebrand')
  })

  it('is retroactive: a lived-in save is past level 3 before anything ticks', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e6
    state.stats.xpBy = { achievement: 20 * XP_ACHIEVEMENT }
    expect(playerLevel(state)).toBeGreaterThanOrEqual(3)
  })

  it('the watermark floors the level so nothing ever demotes', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.levelSeen = 6
    expect(playerLevel(state)).toBe(6)
    // The bar stays honest: a retroactive level 6 still owes the full climb to 7.
    const p = levelProgress(state)
    expect(p.fraction).toBe(0)
    expect(p.xpToGo).toBe(xpForLevel(7))
  })

  it('tops out at MAX_LEVEL', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.xpBy = { rebrand: 10 * xpForLevel(MAX_LEVEL) }
    expect(playerLevel(state)).toBe(MAX_LEVEL)
    expect(levelProgress(state).fraction).toBe(1)
    expect(levelProgress(state).xpToGo).toBe(0)
  })
})

describe('grantXp', () => {
  it('floors the amount, banks it under its source and returns the event', () => {
    const state = createInitialState(T0, GUEST)
    expect(grantXp(state, 16.9, 'post')).toEqual({ type: 'xp', amount: 16, source: 'post' })
    expect(grantXp(state, 16, 'post')).toEqual({ type: 'xp', amount: 16, source: 'post' })
    expect(state.stats.xpBy).toEqual({ post: 32 })
    expect(activityXp(state)).toBe(32)
    expect(playerXp(state)).toBe(32)
  })

  it('does nothing for a grant that rounds to zero or is not a number', () => {
    const state = createInitialState(T0, GUEST)
    for (const amount of [0, -3, 0.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(grantXp(state, amount, 'contract'), String(amount)).toBeNull()
    }
    expect(state.stats.xpBy).toEqual({})
  })

  it('replaces a corrupt row instead of adding to it', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.xpBy = { post: Number.NaN, lora: -40 }
    grantXp(state, 5, 'post')
    grantXp(state, 5, 'lora')
    expect(state.stats.xpBy).toEqual({ post: 5, lora: 5 })
  })

  it('moves the level the moment the threshold is banked', () => {
    const state = createInitialState(T0, GUEST)
    grantXp(state, xpForLevel(2) - 1, 'contract')
    expect(playerLevel(state)).toBe(1)
    grantXp(state, 1, 'contract')
    expect(playerLevel(state)).toBe(2)
  })
})

describe('postXp and dailyXp', () => {
  it('a post pays a base plus a slice per level the model needs, double when viral', () => {
    expect(postXp(modelAt(1), false)).toBe(XP_POST_BASE + XP_POST_PER_LEVEL)
    expect(postXp(modelAt(undefined), false)).toBe(XP_POST_BASE + XP_POST_PER_LEVEL)
    expect(postXp(modelAt(4), false)).toBe(XP_POST_BASE + 4 * XP_POST_PER_LEVEL)
    expect(postXp(modelAt(4), true)).toBe((XP_POST_BASE + 4 * XP_POST_PER_LEVEL) * XP_VIRAL_MULT)
    expect(postXp(modelAt(0), false)).toBe(postXp(modelAt(1), false))
    expect(postXp(modelAt(Number.NaN), false)).toBe(postXp(modelAt(1), false))
  })

  it('a higher-level model never pays less on the shipped table', () => {
    const sorted = [...MODELS].sort((a, b) => (a.minLevel ?? 1) - (b.minLevel ?? 1))
    expect(postXp(sorted[0] as ModelDef, false)).toBeGreaterThan(0)
    for (let i = 1; i < sorted.length; i++) {
      expect(postXp(sorted[i] as ModelDef, false)).toBeGreaterThanOrEqual(postXp(sorted[i - 1] as ModelDef, false))
    }
  })

  it('the daily pays by cycle day, capped at the end of the cycle', () => {
    expect(dailyXp(1)).toBe(XP_DAILY_PER_DAY)
    expect(dailyXp(DAILY_CYCLE_DAYS)).toBe(DAILY_CYCLE_DAYS * XP_DAILY_PER_DAY)
    expect(dailyXp(DAILY_CYCLE_DAYS + 2)).toBe(DAILY_CYCLE_DAYS * XP_DAILY_PER_DAY)
    expect(dailyXp(0)).toBe(XP_DAILY_PER_DAY)
    expect(dailyXp(Number.NaN)).toBe(XP_DAILY_PER_DAY)
    expect(dailyXp(3.7)).toBe(3 * XP_DAILY_PER_DAY)
  })
})

describe('levelReward', () => {
  it('is the bigger of a flat ladder and 90 seconds of income', () => {
    expect(levelReward(3, 0)).toBe(LEVEL_REWARD_PER_LEVEL * 3)
    expect(levelReward(3, 100)).toBe(Math.round(LEVEL_REWARD_SECS * 100))
    expect(levelReward(3, 1)).toBe(LEVEL_REWARD_PER_LEVEL * 3)
  })
})

describe('model gating', () => {
  it('groups models by the level that unlocks them', () => {
    const catalog = createCatalog({
      models: [
        { id: 'a', minLevel: 1 } as ModelDef,
        { id: 'b', minLevel: 4 } as ModelDef,
        { id: 'c', minLevel: 4 } as ModelDef,
        { id: 'd' } as ModelDef,
      ],
    })
    expect(modelsUnlockedAt(4, catalog).map((m) => m.id)).toEqual(['b', 'c'])
    expect(modelsUnlockedAt(1, catalog).map((m) => m.id)).toEqual(['a', 'd'])
    expect(modelsUnlockedAt(9, catalog)).toEqual([])
  })

  it('reports the gap, and nothing at all when the model is in reach', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.levelSeen = 3
    expect(modelLevelLock({ id: 'x', minLevel: 6 } as ModelDef, state)).toEqual({ need: 6, have: 3 })
    expect(modelLevelLock({ id: 'x', minLevel: 3 } as ModelDef, state)).toBeNull()
    expect(modelLevelLock({ id: 'x' } as ModelDef, state)).toBeNull()
  })

  it('describeUnlock puts the unit first for the level stat', () => {
    expect(describeUnlock({ type: 'stat', key: 'level', value: 9 }, CATALOG)).toBe('Reach level 9')
    expect(describeUnlock({ type: 'stat', key: 'posts', value: 9 }, CATALOG)).toBe('Reach 9 posts')
  })
})

describe('hardware gating', () => {
  it('groups units by the level that unlocks them, level 1 taking the ones with none', () => {
    const catalog = createCatalog({ hardware: [unitAt('a', 1), unitAt('b', 4), unitAt('c', 4), unitAt('d')] })
    expect(hardwareUnlockedAt(4, catalog).map((h) => h.id)).toEqual(['b', 'c'])
    expect(hardwareUnlockedAt(1, catalog).map((h) => h.id)).toEqual(['a', 'd'])
    expect(hardwareUnlockedAt(9, catalog)).toEqual([])
  })

  it('reports the gap for a unit, and nothing at all within reach, exactly like a model', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.levelSeen = 3
    expect(hardwareLevelLock(unitAt('x', 6), state)).toEqual({ need: 6, have: 3 })
    expect(hardwareLevelLock(unitAt('x', 3), state)).toBeNull()
    expect(hardwareLevelLock(unitAt('x'), state)).toBeNull()
    expect(hardwareLevelLock(unitAt('x', 6.9), state)).toEqual({ need: 6, have: 3 })
    expect(hardwareLevelLock(unitAt('x', 6), state)).toEqual(modelLevelLock(modelAt(6), state))
  })

  it('every shipped unit sits on exactly one rung', () => {
    const seen: string[] = []
    for (let level = 1; level <= MAX_LEVEL; level++) {
      seen.push(...hardwareUnlockedAt(level, CATALOG).map((h) => h.id))
    }
    expect(seen.sort()).toEqual(CATALOG.hardware.map((h) => h.id).sort())
  })
})

describe('the roadmap', () => {
  it('names the Lounge at its level and nothing anywhere else', () => {
    expect(featuresUnlockedAt(LOUNGE_MIN_LEVEL)).toEqual([LOUNGE_FEATURE_NAME])
    for (let level = 1; level <= MAX_LEVEL; level++) {
      if (level !== LOUNGE_MIN_LEVEL) expect(featuresUnlockedAt(level), `level ${level}`).toEqual([])
    }
  })

  it('has one rung per level with its title, threshold and everything it opens', () => {
    const rungs = levelRoadmap(CATALOG)
    expect(rungs).toHaveLength(MAX_LEVEL)
    rungs.forEach((rung, i) => {
      const level = i + 1
      expect(rung.level).toBe(level)
      expect(rung.title).toBe(levelTitle(level))
      expect(rung.xp).toBe(xpForLevel(level))
      expect(rung.models).toEqual(modelsUnlockedAt(level, CATALOG))
      expect(rung.hardware).toEqual(hardwareUnlockedAt(level, CATALOG))
      expect(rung.features).toEqual(featuresUnlockedAt(level))
    })
    const models = rungs.flatMap((r) => r.models.map((m) => m.id))
    expect(models.sort()).toEqual(CATALOG.models.map((m) => m.id).sort())
    const hardware = rungs.flatMap((r) => r.hardware.map((h) => h.id))
    expect(hardware.sort()).toEqual(CATALOG.hardware.map((h) => h.id).sort())
    expect(rungs.filter((r) => r.features.length > 0).map((r) => r.level)).toEqual([LOUNGE_MIN_LEVEL])
  })

  it('nextUnlocks is the rung above, and nothing at the top', () => {
    const rungs = levelRoadmap(CATALOG)
    for (let level = 1; level < MAX_LEVEL; level++) {
      const above = rungs[level] as (typeof rungs)[number]
      expect(nextUnlocks(level, CATALOG)).toEqual({ models: above.models, hardware: above.hardware, features: above.features })
    }
    const nothing = { models: [], hardware: [], features: [] }
    expect(nextUnlocks(MAX_LEVEL, CATALOG)).toEqual(nothing)
    expect(nextUnlocks(MAX_LEVEL + 3, CATALOG)).toEqual(nothing)
    expect(nextUnlocks(0, CATALOG)).toEqual(nextUnlocks(1, CATALOG))
    expect(nextUnlocks(Number.NaN, CATALOG)).toEqual(nextUnlocks(1, CATALOG))
    expect(nextUnlocks(1, CATALOG).features).toEqual([LOUNGE_FEATURE_NAME])
  })
})

describe('settleLevelUps', () => {
  it('pays once per level in order and is quiet on a second call', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e7
    state.stats.xpBy = { achievement: 30 * XP_ACHIEVEMENT, post: 60 * postXp(modelAt(1), false) }
    const target = playerLevel(state)
    expect(target).toBeGreaterThanOrEqual(4)

    const before = state.credits
    const events = settleLevelUps(state, derivedWith({ cps: 4 }), CATALOG)
    const levels = ofType(events, 'levelUp')
    expect(levels.map((e) => e.level)).toEqual(
      Array.from({ length: target - 1 }, (_, i) => i + 2),
    )
    for (const e of levels) expect(e.credits).toBe(levelReward(e.level, 4))
    const paid = levels.reduce((sum, e) => sum + e.credits, 0)
    expect(state.credits).toBe(before + paid)
    expect(state.stats.levelSeen).toBeGreaterThanOrEqual(target)

    expect(settleLevelUps(state, derivedWith({ cps: 4 }), CATALOG)).toEqual([])
  })

  it('the reward moves lifetime and season credits like addCredits does', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = creditsForXp(xpForLevel(2))
    const before = { lifetime: state.lifetimeCredits, season: state.seasonCredits }
    const events = ofType(settleLevelUps(state, derivedWith(), CATALOG), 'levelUp')
    expect(events.length).toBeGreaterThan(0)
    const paid = events.reduce((sum, e) => sum + e.credits, 0)
    expect(state.lifetimeCredits).toBe(before.lifetime + paid)
    expect(state.seasonCredits).toBe(before.season + paid)
  })

  it('names the models and the hardware the new level unlocks, in catalog order', () => {
    const catalog = createCatalog({
      models: [{ id: 'later', minLevel: 3 } as ModelDef, { id: 'sdxl', minLevel: 2 } as ModelDef],
      hardware: [unitAt('pc'), unitAt('rtx-3060', 2), unitAt('rtx-3090', 3), unitAt('rx-7600-xt', 2)],
    })
    const state = createInitialState(T0, GUEST)
    // The credits term alone lands exactly on level 2, so one rung is announced and no more.
    state.lifetimeCredits = creditsForXp(xpForLevel(2))
    const events = ofType(settleLevelUps(state, derivedWith(), catalog), 'levelUp')
    expect(events).toEqual([
      { type: 'levelUp', level: 2, credits: levelReward(2, 0), unlocked: ['sdxl'], hardware: ['rtx-3060', 'rx-7600-xt'] },
    ])
  })

  it('never runs past MAX_LEVEL', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.xpBy = { rebrand: 10 * xpForLevel(MAX_LEVEL) }
    const events = ofType(settleLevelUps(state, derivedWith({ cps: 1e6 }), CATALOG), 'levelUp')
    expect(state.stats.levelSeen).toBe(MAX_LEVEL)
    expect(events.at(-1)?.level).toBe(MAX_LEVEL)
    expect(settleLevelUps(state, derivedWith({ cps: 1e6 }), CATALOG)).toEqual([])
  })
})

describe('the level lands in the loop', () => {
  it('tick emits levelUp within one played second of crossing', () => {
    const state = createInitialState(T0, GUEST)
    resetTickMemo(state)
    state.lifetimeCredits = creditsForLevel(2)
    const derived = derivedWith({ cps: 0 })
    const rng = mulberry32(3)
    // Half a played second: the once-per-second block has not run yet.
    expect(ofType(tick(state, derived, QUIET, 0.5, T0 + 500, rng), 'levelUp')).toEqual([])
    const events = ofType(tick(state, derived, QUIET, 0.6, T0 + 1_100, rng), 'levelUp')
    expect(events.map((e) => e.level)).toEqual([2])
    expect(state.stats.levelSeen).toBe(2)
  })

  it('applyOffline pays for a level crossed while away', () => {
    const state = createInitialState(T0, GUEST)
    state.meta.lastTickAt = T0 - 8 * 3_600_000
    const derived = derivedWith({ cps: 5, offlineCapHours: 8, offlineEfficiency: 0.5 })
    const r = applyOffline(state, derived, QUIET, T0)
    expect(r.events[0]?.type).toBe('offline')
    const levels = ofType(r.events, 'levelUp')
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.map((e) => e.level)).toEqual(levels.map((_, i) => i + 2))
    expect(state.stats.levelSeen).toBe(playerLevel(state))
  })

  it('a rebrand keeps the level and the ledger, and banks its own XP on top', () => {
    const state = createInitialState(T0, GUEST)
    state.hardware['aws-p5'] = 1
    state.lifetimeCredits = 5e8
    state.seasonCredits = 5e8
    state.stats.xpBy = { post: 420, contract: 3 * XP_CONTRACT }
    settleLevelUps(state, derivedWith({ cps: 10 }), CATALOG)
    const before = playerLevel(state)
    const banked = activityXp(state)
    expect(before).toBeGreaterThanOrEqual(3)

    const events = rebrand(state, CATALOG, T0)
    expect(events.map((e) => e.type)).toEqual(['rebrand', 'xp'])
    expect(events[1]).toEqual({ type: 'xp', amount: XP_REBRAND, source: 'rebrand' })
    expect(state.stats.xpBy).toEqual({ post: 420, contract: 3 * XP_CONTRACT, rebrand: XP_REBRAND })
    expect(activityXp(state)).toBe(banked + XP_REBRAND)
    expect(playerLevel(state)).toBeGreaterThanOrEqual(before)
  })
})

describe('save', () => {
  it('a blob with no levelSeen hydrates to the derived level and the next tick pays nothing', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e7
    // A ledger worth level 3 on its own, so the derived level clears 3 whatever the credits term adds.
    state.stats.xpBy = { post: xpForLevel(3) }
    const blob = JSON.parse(serialize(state)) as Record<string, unknown>
    const stats = blob.stats as Record<string, unknown>
    delete stats.levelSeen
    const back = deserialize(JSON.stringify(blob), T0, GUEST)
    const derived = computeDerived(back, CATALOG)

    expect(back.stats.levelSeen).toBe(playerLevel(back))
    expect(back.stats.levelSeen).toBeGreaterThanOrEqual(3)
    const before = back.credits
    expect(settleLevelUps(back, derived, CATALOG)).toEqual([])
    expect(back.credits).toBe(before)
  })

  it('round-trips the ledger, and seeds one for a blob from before it existed', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.xpBy = { post: 21, viral: 32 }
    expect(deserialize(serialize(state), T0, GUEST).stats.xpBy).toEqual({ post: 21, viral: 32 })

    const legacy = createInitialState(T0, GUEST)
    legacy.achievements = ['first-click']
    legacy.stats.contractsDone = 2
    const blob = JSON.parse(serialize(legacy)) as Record<string, unknown>
    delete (blob.stats as Record<string, unknown>).xpBy
    const back = deserialize(JSON.stringify(blob), T0, GUEST)
    // The starter box counts as an owned kind; the rest comes from the counters.
    expect(back.stats.xpBy).toEqual({
      contract: 2 * XP_CONTRACT,
      achievement: XP_ACHIEVEMENT,
      hardware: XP_HARDWARE_FIRST,
    })
    expect(back.stats.xpBy).toEqual(legacyXp(back, CATALOG))
  })

  it('round-trips the new stats, settings and gamble block', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.levelSeen = 7
    state.stats.ratioed = 3
    state.stats.dislikes = 1_240
    state.stats.spins = 12
    state.stats.spinNet = -450
    state.stats.clickLockUntil = T0 + 8_000
    state.stats.clickStrikes = 2
    state.stats.clickStrikeAt = T0 - 1_000
    state.stats.luckyClicks = 4
    state.stats.landedStreak = 5
    state.stats.bestLandedStreak = 9
    state.settings.autosave = false
    state.gamble = { freeSpinDay: '2026-09-14', winStreak: 2, dryStreak: 1, coinStreak: 4, pot: 375 }

    const back = deserialize(serialize(state), T0, GUEST)
    expect(back.stats).toMatchObject({
      levelSeen: 7,
      ratioed: 3,
      dislikes: 1_240,
      spins: 12,
      spinNet: -450,
      clickStrikes: 2,
      luckyClicks: 4,
      landedStreak: 5,
      bestLandedStreak: 9,
    })
    expect(back.settings.autosave).toBe(false)
    expect(back.gamble).toEqual(state.gamble)
  })

  it('defaults every new field when the blob predates them', () => {
    const state = createInitialState(T0, GUEST)
    const blob = JSON.parse(serialize(state)) as Record<string, unknown>
    delete blob.gamble
    delete (blob.settings as Record<string, unknown>).autosave
    const back = deserialize(JSON.stringify(blob), T0, GUEST)
    expect(back.settings.autosave).toBe(true)
    expect(back.gamble).toEqual({ freeSpinDay: null, winStreak: 0, dryStreak: 0, coinStreak: 0, pot: 0 })
    expect(back.stats.ratioed).toBe(0)
    expect(back.stats.landedStreak).toBe(0)
  })

  it('clamps a click lockout and a citizen run from a clock that ran ahead', () => {
    const state = createInitialState(T0, GUEST)
    state.stats.clickLockUntil = T0 + 30 * 86_400_000
    state.citizens.drops = [
      { id: 'w1', name: 'Hands, fixed', publishedAt: T0, runs: 2, royalties: 40, heat: 0.8, nextRunAt: T0 + 30 * 86_400_000, cold: false },
    ]
    const back = deserialize(serialize(state), T0, GUEST)
    expect(back.stats.clickLockUntil).toBe(T0 + CLICK_LOCKOUT_MAX_MS)
    expect(back.citizens.drops[0]!.nextRunAt).toBe(T0 + CITIZEN_TREND_MS)
    expect(back.citizens.drops[0]!.name).toBe('Hands, fixed')
  })

  it('keeps a negative followersGained on a ratioed post', () => {
    const state = createInitialState(T0, GUEST)
    state.posts = [
      {
        id: 'p1',
        createdAt: T0 - 9_000,
        modelId: 'sd15',
        kind: 'image',
        precision: 'native',
        prompt: 'a cat',
        tags: [],
        matchedTrending: [],
        thumb: 'cat',
        cost: 10,
        targetLikes: 400,
        likes: 400,
        creditsPerLike: 0.02,
        creditsPaid: 8,
        windowMs: 8_000,
        viral: false,
        flop: true,
        founderBoost: false,
        followersGained: -7,
        granted: true,
        ratioed: true,
        mismatchedTags: ['videogen'],
        nearViral: false,
        roll: 0.4,
        trendMult: 1,
      },
    ]
    const back = deserialize(serialize(state), T0, GUEST)
    expect(back.posts[0]).toMatchObject({
      followersGained: -7,
      ratioed: true,
      mismatchedTags: ['videogen'],
      nearViral: false,
    })
  })
})

describe('removeFollowers', () => {
  it('floors at zero, leaves lifetime alone and says nothing', () => {
    const state = createInitialState(T0, GUEST)
    addFollowers(state, 40)
    const lifetime = state.lifetimeFollowers
    const signups = state.signups
    expect(removeFollowers(state, 15)).toBeUndefined()
    expect(state.followers).toBe(25)
    removeFollowers(state, 999)
    expect(state.followers).toBe(0)
    expect(state.lifetimeFollowers).toBe(lifetime)
    expect(state.signups).toBe(signups)
    removeFollowers(state, -5)
    removeFollowers(state, Number.NaN)
    expect(state.followers).toBe(0)
  })
})

/** Lifetime credits that reach `level` on the credits term alone. */
function creditsForLevel(level: number): number {
  return Math.ceil(10 ** (xpForLevel(level) / XP_CREDITS))
}
