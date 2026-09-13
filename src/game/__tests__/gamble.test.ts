import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import {
  FLOP_CHANCE_BASE,
  FOLLOW_RATE_BASE,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  SPIN_COOLDOWN_MS,
  SPIN_FREE_MIN,
  SPIN_FREE_SECS,
  SPIN_HOT_MULT,
  SPIN_HOT_STREAK,
  SPIN_MAX_SECS,
  SPIN_MIN_LEVEL,
  SPIN_MIN_SECS,
  SPIN_MIN_WAGER,
  SPIN_PITY_DRY,
  SPIN_POT_FRACTION,
  VIRAL_CHANCE_BASE,
} from '@/game/constants'
import { dayKey } from '@/game/daily'
import { computeDerived } from '@/game/derived'
import {
  HOT_SEED_FLAG,
  JACKPOT_FLAG,
  NAN_STREAK_FLAG,
  applySpin,
  canSpin,
  freeSpinAvailable,
  freeStake,
  isHot,
  msUntilSpin,
  pityDue,
  rollOutcome,
  spinEv,
  wagerBounds,
} from '@/game/gamble'
import { applyOffline } from '@/game/offline'
import { mulberry32 } from '@/game/rng'
import { deserialize, serialize } from '@/game/save'
import { createInitialState } from '@/game/state'
import type { Catalog, Derived, GambleOutcomeDef, GameState } from '@/game/types'

const T0 = Date.UTC(2026, 8, 13, 12, 0, 0)
const HOUR = 3_600_000

/** A Derived built by hand; the roulette reads `cps` and nothing else. */
function makeDerived(over: Partial<Derived> = {}): Derived {
  return {
    cps: 4,
    rawCps: 4,
    clickValue: 1,
    bestVram: 8,
    bestTier: 1,
    bestHardwareId: 'pc-4c8t',
    hasGpu: false,
    powerDraw: 65,
    powerBudget: POWER_BUDGET_BASE,
    throttled: false,
    concurrency: 1,
    speedMult: 1,
    likesMult: 1,
    payoutBonus: 0,
    followRate: FOLLOW_RATE_BASE,
    viralChance: VIRAL_CHANCE_BASE,
    flopChance: FLOP_CHANCE_BASE,
    offlineCapHours: OFFLINE_CAP_HOURS_BASE,
    offlineEfficiency: OFFLINE_EFFICIENCY,
    globalMult: 1,
    cpMult: 1,
    familyMult: {},
    rigMult: {},
    familyGenTime: {},
    coolingTier: {},
    tagLikes: {},
    unlockedFamilies: ['cpu'],
    zluda: false,
    apiNodes: false,
    hashtagResearch: false,
    streakGrace: false,
    reservedCapacity: false,
    weekSpeed: 1,
    ...over,
  }
}

/**
 * A state that may spin right now. The level gate reads `playerLevel`, which is floored by the
 * `levelSeen` watermark, so the watermark is the cheapest way to stand at level 2 without paying
 * lifetime credits into the fixture (which would be the very thing these tests are guarding).
 */
function spinState(over: { credits?: number; level?: number } = {}): GameState {
  const s = createInitialState(T0, 'guest')
  s.credits = over.credits ?? 100_000
  s.stats.levelSeen = over.level ?? SPIN_MIN_LEVEL
  return s
}

const seg = (id: string, mult: number, weight: number): GambleOutcomeDef => ({
  id,
  label: id,
  mult,
  weight,
  line: `${id}.`,
})

/** A one-segment table: every draw lands on it, whatever the rng says. */
const only = (o: GambleOutcomeDef): Catalog => createCatalog({ gamble: [o] })

const NAN_SEG = seg('nan', 0, 1)
const HALF_SEG = seg('half', 0.5, 1)
const CLEAN_SEG = seg('clean', 2, 1)
const S42_SEG = seg('s42', 42, 1)

/** NaN is the only drawable segment; `half` sits at weight 0 purely as the pity consolation. */
const PITY_TABLE: Catalog = createCatalog({ gamble: [NAN_SEG, seg('half', 0.5, 0)] })

const rng = () => mulberry32(1)

describe('outcome table', () => {
  it('weights sum to 1', () => {
    const total = CATALOG.gamble.reduce((sum, o) => sum + o.weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('has unique ids and a line for every segment', () => {
    const ids = CATALOG.gamble.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const o of CATALOG.gamble) {
      expect(o.line.length).toBeGreaterThan(0)
      expect(o.mult).toBeGreaterThanOrEqual(0)
      expect(o.weight).toBeGreaterThan(0)
    }
  })
})

describe('spinEv', () => {
  it('sits just above break-even', () => {
    const ev = spinEv(CATALOG.gamble)
    expect(ev).toBeGreaterThanOrEqual(1.02)
    expect(ev).toBeLessThanOrEqual(1.06)
    expect(ev).toBeCloseTo(1.038, 6)
  })

  it('normalises a fixture table that does not sum to 1', () => {
    expect(spinEv([seg('a', 0, 2), seg('b', 4, 2)])).toBe(2)
  })

  it('is 0 for an empty or weightless table', () => {
    expect(spinEv([])).toBe(0)
    expect(spinEv([seg('a', 4, 0)])).toBe(0)
  })

  it('matches 200k mulberry32 rolls', () => {
    const analytic = spinEv(CATALOG.gamble)
    const r = mulberry32(42)
    const rolls = 200_000
    let total = 0
    let jackpots = 0
    for (let i = 0; i < rolls; i++) {
      const o = rollOutcome(CATALOG.gamble, r, false)
      total += o.mult
      if (o.id === 's42') jackpots += 1
    }
    // Measured: 1.0477275 against an analytic 1.038, a gap of 0.0097; s42 landed 0.315 % of the time.
    expect(Math.abs(total / rolls - analytic)).toBeLessThan(0.02)
    const rate = jackpots / rolls
    expect(rate).toBeGreaterThanOrEqual(0.002)
    expect(rate).toBeLessThanOrEqual(0.004)
  })

  /**
   * The economic ceiling. Spinning the maximum wager the instant every cooldown expires, for a
   * whole hour, must not add more than 7 % to that hour of income. This is the number that makes
   * the roulette a hook rather than a strategy; if a future table or cooldown breaks it, the
   * roulette has become an income source and the change is wrong.
   */
  it('cannot add more than 7 % to an hour of income', () => {
    const spinsPerHour = (3600 / SPIN_COOLDOWN_MS) * 1000
    const edge = spinsPerHour * (spinEv(CATALOG.gamble) - 1) * SPIN_MAX_SECS
    expect(edge).toBeLessThanOrEqual(0.07 * 3600)
  })
})

describe('wagerBounds', () => {
  it('floors at SPIN_MIN_WAGER with no income', () => {
    const s = spinState({ credits: 100_000 })
    expect(wagerBounds(s, makeDerived({ cps: 0 }))).toEqual({ min: SPIN_MIN_WAGER, max: SPIN_MIN_WAGER })
  })

  it('prices both ends in seconds of income', () => {
    const s = spinState({ credits: 100_000 })
    expect(wagerBounds(s, makeDerived({ cps: 4 }))).toEqual({
      min: SPIN_MIN_SECS * 4,
      max: SPIN_MAX_SECS * 4,
    })
  })

  it('caps the ceiling at the credits on hand', () => {
    const rich = spinState({ credits: 1e12 })
    expect(wagerBounds(rich, makeDerived({ cps: 1e6 })).max).toBe(SPIN_MAX_SECS * 1e6)

    const poor = spinState({ credits: 100_000 })
    const bounds = wagerBounds(poor, makeDerived({ cps: 1e6 }))
    expect(bounds.min).toBe(SPIN_MIN_SECS * 1e6)
    expect(bounds.max).toBe(100_000)
  })

  it('never returns a negative ceiling', () => {
    const broke = spinState({ credits: -5 })
    expect(wagerBounds(broke, makeDerived({ cps: 0 })).max).toBe(0)
  })
})

describe('freeSpinAvailable / msUntilSpin', () => {
  it('gives one free spin per UTC day', () => {
    const s = spinState()
    expect(freeSpinAvailable(s, T0)).toBe(true)
    s.gamble.freeSpinDay = dayKey(T0)
    expect(freeSpinAvailable(s, T0)).toBe(false)
    expect(freeSpinAvailable(s, T0 + 24 * HOUR)).toBe(true)
  })

  it('counts down the paid cooldown', () => {
    const s = spinState()
    s.gamble.nextSpinAt = T0 + SPIN_COOLDOWN_MS
    expect(msUntilSpin(s, T0)).toBe(SPIN_COOLDOWN_MS)
    expect(msUntilSpin(s, T0 + SPIN_COOLDOWN_MS)).toBe(0)
    expect(msUntilSpin(s, T0 + 10 * SPIN_COOLDOWN_MS)).toBe(0)
  })

  it('scales the house stake with income', () => {
    expect(freeStake(makeDerived({ cps: 0 }))).toBe(SPIN_FREE_MIN)
    expect(freeStake(makeDerived({ cps: 4 }))).toBe(SPIN_FREE_SECS * 4)
  })
})

describe('canSpin', () => {
  const d = makeDerived({ cps: 4 })

  it('accepts a wager inside the bounds', () => {
    expect(canSpin(spinState(), d, T0, 1000)).toEqual({ ok: true, stake: 1000, free: false })
  })

  it('accepts the free spin with the house stake', () => {
    expect(canSpin(spinState(), d, T0, 'free')).toEqual({ ok: true, stake: freeStake(d), free: true })
  })

  it('refuses below the level gate', () => {
    const s = spinState({ level: 1 })
    expect(canSpin(s, d, T0, 1000)).toEqual({ ok: false, reason: 'Unlocks at level 2' })
    expect(canSpin(s, d, T0, 'free')).toEqual({ ok: false, reason: 'Unlocks at level 2' })
  })

  it('refuses while the sampler is cooling down', () => {
    const s = spinState()
    s.gamble.nextSpinAt = T0 + 161_000
    expect(canSpin(s, d, T0, 1000)).toEqual({
      ok: false,
      reason: 'Sampler is cooling down · 2:41',
    })
  })

  it('lets the free spin through the cooldown', () => {
    const s = spinState()
    s.gamble.nextSpinAt = T0 + 161_000
    expect(canSpin(s, d, T0, 'free')).toEqual({ ok: true, stake: freeStake(d), free: true })
  })

  it('refuses a wager under the floor', () => {
    const s = spinState()
    expect(canSpin(s, makeDerived({ cps: 0 }), T0, 10)).toEqual({
      ok: false,
      reason: 'Bet at least 50 credits',
    })
    expect(canSpin(s, makeDerived({ cps: 0 }), T0, Number.NaN)).toEqual({
      ok: false,
      reason: 'Bet at least 50 credits',
    })
  })

  it('refuses a wager over the income ceiling', () => {
    expect(canSpin(spinState(), d, T0, 2000)).toEqual({
      ok: false,
      reason: 'Bet at most 1,200 credits right now',
    })
  })

  it('refuses a wager the balance cannot cover', () => {
    const s = spinState({ credits: 60 })
    expect(canSpin(s, makeDerived({ cps: 0 }), T0, 80)).toEqual({
      ok: false,
      reason: 'Not enough credits',
    })
  })

  it('refuses a second free spin on the same day', () => {
    const s = spinState()
    s.gamble.freeSpinDay = dayKey(T0)
    expect(canSpin(s, d, T0, 'free')).toEqual({
      ok: false,
      reason: 'Free spin already used today',
    })
  })
})

describe('rollOutcome', () => {
  it('draws from the table', () => {
    expect(rollOutcome([NAN_SEG], rng(), false).id).toBe('nan')
  })

  it('converts a loss into the cheapest winning segment under pity', () => {
    expect(rollOutcome(PITY_TABLE.gamble, rng(), true).id).toBe('half')
    expect(rollOutcome(PITY_TABLE.gamble, rng(), false).id).toBe('nan')
  })

  it('leaves a winning draw alone under pity', () => {
    expect(rollOutcome([CLEAN_SEG], rng(), true).id).toBe('clean')
  })
})

describe('applySpin', () => {
  const d = makeDerived({ cps: 4 })

  it('deducts the wager, pays the multiplier and emits exactly one spin', () => {
    const s = spinState({ credits: 100_000 })
    const events = applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)

    expect(events).toEqual([
      { type: 'spin', outcome: 'clean', mult: 2, wager: 1000, payout: 2000, free: false, hot: false },
    ])
    expect(s.credits).toBe(100_000 - 1000 + 2000)
    expect(s.gamble.nextSpinAt).toBe(T0 + SPIN_COOLDOWN_MS)
    expect(s.stats.spins).toBe(1)
    expect(s.stats.spinNet).toBe(1000)
    expect(s.gamble.winStreak).toBe(1)
    expect(s.gamble.dryStreak).toBe(0)
  })

  it('keeps the wager on a NaN latent', () => {
    const s = spinState({ credits: 100_000 })
    const events = applySpin(s, d, only(NAN_SEG), T0, rng(), 1000)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'nan', mult: 0, payout: 0 })
    expect(s.credits).toBe(99_000)
    expect(s.stats.spinNet).toBe(-1000)
    expect(s.gamble.dryStreak).toBe(1)
  })

  /**
   * The exception worth a test of its own: gambling must not farm XP (which is derived from
   * lifetime credits) and must not move the season leaderboard.
   */
  it('never moves lifetimeCredits or seasonCredits', () => {
    for (const table of [only(CLEAN_SEG), only(NAN_SEG), only(S42_SEG)]) {
      const s = spinState({ credits: 100_000 })
      const lifetime = s.lifetimeCredits
      const season = s.seasonCredits
      applySpin(s, d, table, T0, rng(), 1000)
      applySpin(s, d, table, T0, rng(), 'free')
      expect(s.lifetimeCredits).toBe(lifetime)
      expect(s.seasonCredits).toBe(season)
    }
  })

  it('refuses an illegal spin without touching the state', () => {
    const s = spinState({ level: 1 })
    const before = JSON.stringify(s)
    expect(applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)).toEqual([])
    expect(JSON.stringify(s)).toBe(before)
  })

  it('cannot be spammed: the second spin is on cooldown', () => {
    const s = spinState({ credits: 100_000 })
    applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)
    expect(applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)).toEqual([])
    expect(s.stats.spins).toBe(1)
    expect(applySpin(s, d, only(CLEAN_SEG), T0 + SPIN_COOLDOWN_MS, rng(), 1000)).toHaveLength(1)
    expect(s.stats.spins).toBe(2)
  })

  describe('free spin', () => {
    it('deducts nothing, marks the day and leaves the cooldown alone', () => {
      const s = spinState({ credits: 100_000 })
      const stake = freeStake(d)
      const events = applySpin(s, d, only(CLEAN_SEG), T0, rng(), 'free')

      expect(events).toEqual([
        { type: 'spin', outcome: 'clean', mult: 2, wager: stake, payout: stake * 2, free: true, hot: false },
      ])
      expect(s.credits).toBe(100_000 + stake * 2)
      expect(s.gamble.freeSpinDay).toBe(dayKey(T0))
      expect(s.gamble.nextSpinAt).toBe(T0)
      expect(s.gamble.pot).toBe(0)
      expect(s.stats.spinNet).toBe(stake * 2)
    })

    it('costs nothing on a NaN latent', () => {
      const s = spinState({ credits: 100_000 })
      applySpin(s, d, only(NAN_SEG), T0, rng(), 'free')
      expect(s.credits).toBe(100_000)
      expect(s.stats.spinNet).toBe(0)
    })

    it('is gone for the rest of the day', () => {
      const s = spinState({ credits: 100_000 })
      applySpin(s, d, only(CLEAN_SEG), T0, rng(), 'free')
      expect(applySpin(s, d, only(CLEAN_SEG), T0 + HOUR, rng(), 'free')).toEqual([])
      expect(applySpin(s, d, only(CLEAN_SEG), T0 + 24 * HOUR, rng(), 'free')).toHaveLength(1)
    })
  })

  describe('pity', () => {
    it('rerolls the NaN after SPIN_PITY_DRY of them and raises the flag', () => {
      const s = spinState({ credits: 100_000 })
      for (let i = 0; i < SPIN_PITY_DRY; i++) {
        const events = applySpin(s, d, PITY_TABLE, T0 + i * SPIN_COOLDOWN_MS, rng(), 1000)
        expect(events[0]).toMatchObject({ outcome: 'nan' })
      }
      expect(s.gamble.dryStreak).toBe(SPIN_PITY_DRY)
      expect(s.flags[NAN_STREAK_FLAG]).toBe(true)
      expect(pityDue(s)).toBe(true)

      const saved = applySpin(s, d, PITY_TABLE, T0 + SPIN_PITY_DRY * SPIN_COOLDOWN_MS, rng(), 1000)
      expect(saved[0]).toMatchObject({ outcome: 'half', mult: 0.5, payout: 500 })
      expect(s.gamble.dryStreak).toBe(0)
      expect(pityDue(s)).toBe(false)
    })
  })

  describe('hot sampler', () => {
    it('pays x1.5 after SPIN_HOT_STREAK wins and resets on a loss', () => {
      const s = spinState({ credits: 1_000_000 })
      for (let i = 0; i < SPIN_HOT_STREAK; i++) {
        const events = applySpin(s, d, only(CLEAN_SEG), T0 + i * SPIN_COOLDOWN_MS, rng(), 1000)
        expect(events[0]).toMatchObject({ payout: 2000, hot: false })
      }
      expect(s.gamble.winStreak).toBe(SPIN_HOT_STREAK)
      expect(isHot(s)).toBe(true)
      expect(s.flags[HOT_SEED_FLAG]).toBe(true)

      const hot = applySpin(s, d, only(CLEAN_SEG), T0 + SPIN_HOT_STREAK * SPIN_COOLDOWN_MS, rng(), 1000)
      expect(hot[0]).toMatchObject({ mult: 2, payout: 1000 * 2 * SPIN_HOT_MULT, hot: true })

      // The losing spin was still taken while the sampler was fixed, so the event says so; a x1.5
      // share of nothing is still nothing, and the streak ends here.
      const cold = applySpin(s, d, only(NAN_SEG), T0 + (SPIN_HOT_STREAK + 1) * SPIN_COOLDOWN_MS, rng(), 1000)
      expect(cold[0]).toMatchObject({ outcome: 'nan', payout: 0, hot: true })
      expect(s.gamble.winStreak).toBe(0)
      expect(isHot(s)).toBe(false)

      const after = applySpin(s, d, only(CLEAN_SEG), T0 + (SPIN_HOT_STREAK + 2) * SPIN_COOLDOWN_MS, rng(), 1000)
      expect(after[0]).toMatchObject({ payout: 2000, hot: false })
    })

    it('breaks the streak on a below-x2 result', () => {
      const s = spinState({ credits: 1_000_000 })
      applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)
      expect(s.gamble.winStreak).toBe(1)
      applySpin(s, d, only(HALF_SEG), T0 + SPIN_COOLDOWN_MS, rng(), 1000)
      expect(s.gamble.winStreak).toBe(0)
      expect(s.gamble.dryStreak).toBe(0)
    })
  })

  describe('pot', () => {
    it('takes a slice of every paid wager', () => {
      const s = spinState({ credits: 1_000_000 })
      applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)
      expect(s.gamble.pot).toBe(SPIN_POT_FRACTION * 1000)
      applySpin(s, d, only(CLEAN_SEG), T0 + SPIN_COOLDOWN_MS, rng(), 1000)
      expect(s.gamble.pot).toBe(SPIN_POT_FRACTION * 2000)
    })

    it('is emptied by the x42 seed, which also raises the flag', () => {
      const s = spinState({ credits: 1_000_000 })
      s.gamble.pot = 500
      const events = applySpin(s, d, only(S42_SEG), T0, rng(), 1000)

      // 42 x 1,000 plus the pot, this spin's own 2 % contribution included.
      expect(events[0]).toMatchObject({ outcome: 's42', mult: 42, payout: 42_000 + 500 + 20 })
      expect(s.gamble.pot).toBe(0)
      expect(s.flags[JACKPOT_FLAG]).toBe(true)
    })
  })
})

describe('offline and save', () => {
  it('leaves exactly one ready spin after eight hours away', () => {
    const s = createInitialState(T0, 'guest')
    s.credits = 100_000
    s.stats.levelSeen = SPIN_MIN_LEVEL
    s.gamble.nextSpinAt = T0 + SPIN_COOLDOWN_MS
    s.meta.lastTickAt = T0

    const now = T0 + 8 * HOUR
    const derived = computeDerived(s, CATALOG)
    applyOffline(s, derived, CATALOG, now)

    expect(s.gamble.nextSpinAt).toBe(T0 + SPIN_COOLDOWN_MS)
    expect(msUntilSpin(s, now)).toBe(0)

    const d = makeDerived({ cps: 4 })
    expect(applySpin(s, d, only(CLEAN_SEG), now, rng(), 1000)).toHaveLength(1)
    expect(applySpin(s, d, only(CLEAN_SEG), now, rng(), 1000)).toEqual([])
    expect(s.stats.spins).toBe(1)
  })

  it('clamps a cooldown written by a clock that ran ahead', () => {
    const s = createInitialState(T0, 'guest')
    s.gamble.nextSpinAt = T0 + 30 * 24 * HOUR
    const loaded = deserialize(serialize(s), T0, 'guest')
    expect(loaded.gamble.nextSpinAt).toBeLessThanOrEqual(T0 + SPIN_COOLDOWN_MS)
  })

  it('loads the defaults from a save written before the roulette', () => {
    const s = createInitialState(T0, 'guest')
    s.gamble = { nextSpinAt: T0 + HOUR, freeSpinDay: '2026-09-13', winStreak: 2, dryStreak: 1, pot: 99 }
    const blob = JSON.parse(serialize(s)) as Record<string, unknown>
    delete blob.gamble

    const loaded = deserialize(JSON.stringify(blob), T0, 'guest')
    expect(loaded.gamble).toEqual({
      nextSpinAt: T0,
      freeSpinDay: null,
      winStreak: 0,
      dryStreak: 0,
      pot: 0,
    })
    expect(freeSpinAvailable(loaded, T0)).toBe(true)
    expect(msUntilSpin(loaded, T0)).toBe(0)
  })
})
