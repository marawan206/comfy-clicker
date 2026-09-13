import { describe, expect, it } from 'vitest'
import { CATALOG, createCatalog, type Catalog } from '@/data'
import { HARDWARE } from '@/data/hardware'
import { MODELS } from '@/data/models'
import {
  CLICK_LOCKOUT_MAX_MS,
  LEVEL_REWARD_PER_LEVEL,
  LEVEL_REWARD_SECS,
  LEVEL_XP,
  MAX_LEVEL,
  SPIN_COOLDOWN_MS,
  XP_CREDITS,
} from '@/game/constants'
import { computeDerived, createEmptyDerived } from '@/game/derived'
import { resetTickMemo, tick } from '@/game/engine'
import {
  levelForXp,
  levelProgress,
  levelReward,
  levelTitle,
  modelLevelLock,
  modelsUnlockedAt,
  playerLevel,
  playerXp,
  settleLevelUps,
  xpBreakdown,
  xpForLevel,
} from '@/game/level'
import { applyOffline } from '@/game/offline'
import { rebrand } from '@/game/prestige'
import { mulberry32 } from '@/game/rng'
import { deserialize, serialize } from '@/game/save'
import { addFollowers, removeFollowers } from '@/game/social'
import { createInitialState } from '@/game/state'
import type { Derived, GameEvent, ModelDef } from '@/game/types'
import { describeUnlock } from '@/game/unlock'

const T0 = 1_700_000_000_000
const GUEST = 'guest-level'

/** Real hardware and models, no achievements or contracts, so a tick says only what we asked it. */
const QUIET: Catalog = createCatalog({ hardware: HARDWARE, models: MODELS })

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return { ...createEmptyDerived(), ...overrides }
}

const ofType = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)

describe('LEVEL_XP', () => {
  it('starts at zero, is strictly increasing and covers every level', () => {
    expect(LEVEL_XP).toHaveLength(MAX_LEVEL)
    expect(LEVEL_XP[0]).toBe(0)
    for (let i = 1; i < LEVEL_XP.length; i++) {
      expect(LEVEL_XP[i] as number).toBeGreaterThan(LEVEL_XP[i - 1] as number)
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

  it('the breakdown rows add up to playerXp', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1_234_567
    state.stats.posts = 41
    state.stats.contractsDone = 7
    state.stats.quantizations = 3
    state.stats.lorasTrained = 2
    state.stats.rebrands = 1
    state.achievements = ['a', 'b', 'c']
    state.mapNodes = ['n1', 'n2', 'n3', 'n4']
    const rows = xpBreakdown(state)
    expect(rows.reduce((sum, r) => sum + r.xp, 0)).toBe(playerXp(state))
    expect(rows.every((r) => Number.isInteger(r.xp) && r.xp >= 0)).toBe(true)
  })

  it('is retroactive: a lived-in save is past level 3 before anything ticks', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e6
    state.achievements = Array.from({ length: 20 }, (_, i) => `ach-${i}`)
    state.stats.posts = 40
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
    state.lifetimeCredits = 1e120
    expect(playerLevel(state)).toBe(MAX_LEVEL)
    expect(levelProgress(state).fraction).toBe(1)
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

describe('settleLevelUps', () => {
  it('pays once per level in order and is quiet on a second call', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e7
    state.achievements = Array.from({ length: 30 }, (_, i) => `ach-${i}`)
    state.stats.posts = 60
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
    state.lifetimeCredits = 5_000
    const before = { lifetime: state.lifetimeCredits, season: state.seasonCredits }
    const events = ofType(settleLevelUps(state, derivedWith(), CATALOG), 'levelUp')
    expect(events.length).toBeGreaterThan(0)
    const paid = events.reduce((sum, e) => sum + e.credits, 0)
    expect(state.lifetimeCredits).toBe(before.lifetime + paid)
    expect(state.seasonCredits).toBe(before.season + paid)
  })

  it('names the models the new level unlocks', () => {
    const catalog = createCatalog({ models: [{ id: 'sdxl', minLevel: 2 } as ModelDef] })
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 5_000
    const [first] = ofType(settleLevelUps(state, derivedWith(), catalog), 'levelUp')
    expect(first?.level).toBe(2)
    expect(first?.unlocked).toEqual(['sdxl'])
  })

  it('never runs past MAX_LEVEL', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e120
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

  it('a rebrand keeps the level', () => {
    const state = createInitialState(T0, GUEST)
    state.hardware['aws-p5'] = 1
    state.lifetimeCredits = 5e8
    state.seasonCredits = 5e8
    state.stats.posts = 60
    settleLevelUps(state, derivedWith({ cps: 10 }), CATALOG)
    const before = playerLevel(state)
    expect(before).toBeGreaterThanOrEqual(3)
    rebrand(state, CATALOG, T0)
    expect(playerLevel(state)).toBeGreaterThanOrEqual(before)
    expect(settleLevelUps(state, derivedWith({ cps: 10 }), CATALOG)).toEqual([])
  })
})

describe('save', () => {
  it('a blob with no levelSeen hydrates to the derived level and the next tick pays nothing', () => {
    const state = createInitialState(T0, GUEST)
    state.lifetimeCredits = 1e7
    state.stats.posts = 60
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
    state.gamble = { nextSpinAt: T0 + 60_000, freeSpinDay: '2026-09-14', winStreak: 2, dryStreak: 1, pot: 375 }

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
    expect(back.gamble).toEqual({ nextSpinAt: T0, freeSpinDay: null, winStreak: 0, dryStreak: 0, pot: 0 })
    expect(back.stats.ratioed).toBe(0)
    expect(back.stats.landedStreak).toBe(0)
  })

  it('clamps a roulette cooldown and a click lockout from a clock that ran ahead', () => {
    const state = createInitialState(T0, GUEST)
    state.gamble.nextSpinAt = T0 + 30 * 86_400_000
    state.stats.clickLockUntil = T0 + 30 * 86_400_000
    const back = deserialize(serialize(state), T0, GUEST)
    expect(back.gamble.nextSpinAt).toBe(T0 + SPIN_COOLDOWN_MS)
    expect(back.stats.clickLockUntil).toBe(T0 + CLICK_LOCKOUT_MAX_MS)
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
