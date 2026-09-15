import { describe, expect, it } from 'vitest'

import { CATALOG, createCatalog } from '@/data'
import {
  BET_MIN,
  COIN_PAYOUT,
  COIN_WIN_CHANCE,
  FLOP_CHANCE_BASE,
  FOLLOW_RATE_BASE,
  FREE_SPIN_MIN,
  FREE_SPIN_SECS,
  LOUNGE_MIN_LEVEL,
  OFFLINE_CAP_HOURS_BASE,
  OFFLINE_EFFICIENCY,
  POWER_BUDGET_BASE,
  SPIN_HOT_MULT,
  SPIN_HOT_STREAK,
  SPIN_PITY_DRY,
  SPIN_POT_FRACTION,
  VIRAL_CHANCE_BASE,
} from '@/game/constants'
import { dayKey } from '@/game/daily'
import { computeDerived } from '@/game/derived'
import {
  COIN_STREAK_FLAG,
  COIN_STREAK_TARGET,
  HOT_SEED_FLAG,
  JACKPOT_FLAG,
  NAN_STREAK_FLAG,
  applyFlip,
  applySpin,
  betBounds,
  canBet,
  coinEv,
  freeSpinAvailable,
  freeStake,
  isHot,
  isLoss,
  lossFloor,
  pityDue,
  rollOutcome,
  spinEv,
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
  s.stats.levelSeen = over.level ?? LOUNGE_MIN_LEVEL
  return s
}

const seg = (id: string, mult: number, weight: number): GambleOutcomeDef => ({
  id,
  label: id,
  mult,
  weight,
  line: `${id}.`,
})

/** The shipped floor: a NaN hands a quarter back. */
const NAN_SEG = seg('nan', 0.25, 1)
const HALF_SEG = seg('half', 0.5, 1)
const CLEAN_SEG = seg('clean', 2, 1)
const S42_SEG = seg('s42', 42, 1)
/** A floor that pays nothing, for the tables that still have one. */
const DUD_SEG = seg('dud', 0, 1)

/**
 * A table where `o` is the only drawable segment, whatever the rng says. The NaN floor rides
 * along at weight 0: the dud is whichever segment pays the table's lowest multiplier, so a
 * one-segment table would otherwise make its own segment the dud.
 */
const only = (o: GambleOutcomeDef): Catalog =>
  createCatalog({ gamble: o.id === NAN_SEG.id ? [o] : [o, { ...NAN_SEG, weight: 0 }] })

/** The shipped segment with this id. */
const shipped = (id: string): GambleOutcomeDef => CATALOG.gamble.find((o) => o.id === id) as GambleOutcomeDef

/** NaN is the only drawable segment; `half` sits at weight 0 purely as the pity consolation. */
const PITY_TABLE: Catalog = createCatalog({ gamble: [NAN_SEG, seg('half', 0.5, 0)] })
/** The same shape with a zero floor: 0 is then the dud, not a special case. */
const ZERO_FLOOR_TABLE: Catalog = createCatalog({ gamble: [DUD_SEG, seg('half', 0.5, 0)] })

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
      // Every spin returns something: no segment on the shipped table pays nothing.
      expect(o.mult).toBeGreaterThan(0)
      expect(o.weight).toBeGreaterThan(0)
    }
  })
})

describe('spinEv', () => {
  it('pays back less than it takes', () => {
    const ev = spinEv(CATALOG.gamble)
    expect(ev).toBeLessThan(1)
    expect(ev).toBeGreaterThanOrEqual(0.9)
    expect(ev).toBeCloseTo(0.9555, 6)
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
    expect(Math.abs(total / rolls - analytic)).toBeLessThan(0.02)
    // Seed 42 sits at 0.2 %: 400 hits in 200k, give or take a couple of standard deviations.
    const rate = jackpots / rolls
    expect(rate).toBeGreaterThan(0.0015)
    expect(rate).toBeLessThan(0.0025)
  })

  it('leaves the coin below break-even too', () => {
    expect(coinEv()).toBeCloseTo(COIN_WIN_CHANCE * COIN_PAYOUT, 10)
    expect(coinEv()).toBeLessThan(1)
  })

  /**
   * The invariant the whole Lounge rests on. There is no cooldown and no ceiling on a bet, so the
   * only thing stopping a player from farming the tables is that they lose money on average. This
   * simulates the real loop (pity reroll, hot sampler, the 2 % minted into the pot, jackpots
   * paying it back) and insists a credit put on either table comes back worth less. If a future
   * table crosses 1, the Lounge has become an income source and the change is wrong.
   */
  it('cannot be farmed: a long session loses credits on both tables', () => {
    const wheel = spinState({ credits: 1e12 })
    const d = makeDerived({ cps: 4 })
    const r = mulberry32(7)
    const bet = 1_000
    const spins = 50_000
    for (let i = 0; i < spins; i++) applySpin(wheel, d, CATALOG, T0 + i, r, bet)
    // Credits staked minus credits returned, per credit staked, with the pot still owed.
    const wheelReturn = (wheel.stats.spinNet + spins * bet) / (spins * bet)
    expect(wheelReturn).toBeLessThan(1)
    expect(wheelReturn).toBeGreaterThan(0.9)

    const coin = spinState({ credits: 1e12 })
    const cr = mulberry32(11)
    const flips = 50_000
    for (let i = 0; i < flips; i++) applyFlip(coin, d, T0 + i, cr, bet)
    const coinReturn = (coin.stats.spinNet + flips * bet) / (flips * bet)
    expect(coinReturn).toBeLessThan(1)
    expect(coinReturn).toBeGreaterThan(0.9)
  })
})

describe('betBounds', () => {
  it('runs from BET_MIN to the whole bank', () => {
    expect(betBounds(spinState({ credits: 100_000 }))).toEqual({ min: BET_MIN, max: 100_000 })
  })

  it('does not care about income', () => {
    const s = spinState({ credits: 12_345 })
    expect(betBounds(s)).toEqual(betBounds(s))
    expect(betBounds(s).max).toBe(12_345)
  })

  it('floors a fraction of a credit and never returns a negative ceiling', () => {
    expect(betBounds(spinState({ credits: 99.9 })).max).toBe(99)
    expect(betBounds(spinState({ credits: -5 })).max).toBe(0)
  })
})

describe('freeSpinAvailable', () => {
  it('gives one free spin per UTC day', () => {
    const s = spinState()
    expect(freeSpinAvailable(s, T0)).toBe(true)
    s.gamble.freeSpinDay = dayKey(T0)
    expect(freeSpinAvailable(s, T0)).toBe(false)
    expect(freeSpinAvailable(s, T0 + 24 * HOUR)).toBe(true)
  })

  it('scales the house stake with income', () => {
    expect(freeStake(makeDerived({ cps: 0 }))).toBe(FREE_SPIN_MIN)
    expect(freeStake(makeDerived({ cps: 4 }))).toBe(FREE_SPIN_SECS * 4)
  })
})

describe('canBet', () => {
  const d = makeDerived({ cps: 4 })

  it('accepts any bet from the floor up to the bank', () => {
    expect(canBet(spinState(), d, T0, BET_MIN)).toEqual({ ok: true, stake: BET_MIN, free: false })
    expect(canBet(spinState(), d, T0, 1000)).toEqual({ ok: true, stake: 1000, free: false })
    expect(canBet(spinState({ credits: 100_000 }), d, T0, 100_000)).toEqual({ ok: true, stake: 100_000, free: false })
  })

  it('has no cooldown: the same bet is legal twice in the same millisecond', () => {
    const s = spinState()
    expect(canBet(s, d, T0, 1000).ok).toBe(true)
    applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)
    expect(canBet(s, d, T0, 1000).ok).toBe(true)
  })

  it('accepts the free spin with the house stake', () => {
    expect(canBet(spinState(), d, T0, 'free')).toEqual({ ok: true, stake: freeStake(d), free: true })
  })

  it('refuses below the level gate', () => {
    const s = spinState({ level: 1 })
    expect(canBet(s, d, T0, 1000)).toEqual({ ok: false, reason: 'Unlocks at level 2' })
    expect(canBet(s, d, T0, 'free')).toEqual({ ok: false, reason: 'Unlocks at level 2' })
  })

  it('refuses a bet under the floor', () => {
    const s = spinState()
    expect(canBet(s, d, T0, BET_MIN - 1)).toEqual({ ok: false, reason: `Bet at least ${BET_MIN} credits` })
    expect(canBet(s, d, T0, Number.NaN)).toEqual({ ok: false, reason: `Bet at least ${BET_MIN} credits` })
  })

  it('refuses a bet the balance cannot cover', () => {
    const s = spinState({ credits: 60 })
    expect(canBet(s, d, T0, 80)).toEqual({ ok: false, reason: 'Not enough credits' })
  })

  it('refuses a second free spin on the same day', () => {
    const s = spinState()
    s.gamble.freeSpinDay = dayKey(T0)
    expect(canBet(s, d, T0, 'free')).toEqual({ ok: false, reason: 'Free spin already used today' })
  })
})

describe('the floor', () => {
  it('is the lowest multiplier on the table, a quarter on the shipped one', () => {
    expect(lossFloor(CATALOG.gamble)).toBe(0.25)
    expect(isLoss(shipped('nan'), CATALOG.gamble)).toBe(true)
    expect(isLoss(shipped('half'), CATALOG.gamble)).toBe(false)
    expect(isLoss(shipped('same'), CATALOG.gamble)).toBe(false)
  })

  it('is zero when a table still has a segment paying nothing', () => {
    expect(lossFloor(ZERO_FLOOR_TABLE.gamble)).toBe(0)
    expect(isLoss(DUD_SEG, ZERO_FLOOR_TABLE.gamble)).toBe(true)
  })

  it('is infinite for an empty table', () => {
    expect(lossFloor([])).toBe(Infinity)
  })
})

describe('rollOutcome', () => {
  it('draws from the table', () => {
    expect(rollOutcome([NAN_SEG], rng(), false).id).toBe('nan')
  })

  it('converts a dud into the cheapest segment above the floor under pity', () => {
    expect(rollOutcome(PITY_TABLE.gamble, rng(), true).id).toBe('half')
    expect(rollOutcome(PITY_TABLE.gamble, rng(), false).id).toBe('nan')
    expect(rollOutcome(ZERO_FLOOR_TABLE.gamble, rng(), true).id).toBe('half')
  })

  it('converts a NaN on the shipped table into half', () => {
    // An rng of 0 lands on the first segment, which is the NaN.
    expect(rollOutcome(CATALOG.gamble, () => 0, false).id).toBe('nan')
    expect(rollOutcome(CATALOG.gamble, () => 0, true).id).toBe('half')
  })

  it('leaves a winning draw alone under pity', () => {
    expect(rollOutcome(only(CLEAN_SEG).gamble, rng(), true).id).toBe('clean')
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
    expect(s.stats.spins).toBe(1)
    expect(s.stats.spinNet).toBe(1000)
    expect(s.gamble.winStreak).toBe(1)
    expect(s.gamble.dryStreak).toBe(0)
  })

  it('pays a quarter back on a NaN latent and counts it as a dud', () => {
    const s = spinState({ credits: 100_000 })
    const events = applySpin(s, d, only(NAN_SEG), T0, rng(), 1000)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'nan', mult: 0.25, payout: 250 })
    expect(s.credits).toBe(100_000 - 1000 + 250)
    expect(s.stats.spinNet).toBe(-750)
    expect(s.gamble.dryStreak).toBe(1)
    expect(s.gamble.winStreak).toBe(0)
  })

  it('still eats the whole wager on a table whose floor is zero', () => {
    const s = spinState({ credits: 100_000 })
    const events = applySpin(s, d, ZERO_FLOOR_TABLE, T0, rng(), 1000)

    expect(events[0]).toMatchObject({ outcome: 'dud', mult: 0, payout: 0 })
    expect(s.credits).toBe(99_000)
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

  it('takes as many spins as the bank allows, back to back', () => {
    const s = spinState({ credits: 100_000 })
    for (let i = 0; i < 5; i++) expect(applySpin(s, d, only(NAN_SEG), T0, rng(), 1000)).toHaveLength(1)
    expect(s.stats.spins).toBe(5)
    expect(s.credits).toBe(100_000 - 5 * 1000 + 5 * 250)
  })

  it('stops at the bank: a bet bigger than the balance is refused', () => {
    const s = spinState({ credits: 1_500 })
    applySpin(s, d, only(NAN_SEG), T0, rng(), 1000)
    // 500 left plus the quarter back: 750, still short of the next 1,000.
    expect(applySpin(s, d, only(NAN_SEG), T0, rng(), 1000)).toEqual([])
    expect(s.credits).toBe(750)
    expect(s.stats.spins).toBe(1)
  })

  describe('free spin', () => {
    it('deducts nothing and marks the day', () => {
      const s = spinState({ credits: 100_000 })
      const stake = freeStake(d)
      const events = applySpin(s, d, only(CLEAN_SEG), T0, rng(), 'free')

      expect(events).toEqual([
        { type: 'spin', outcome: 'clean', mult: 2, wager: stake, payout: stake * 2, free: true, hot: false },
      ])
      expect(s.credits).toBe(100_000 + stake * 2)
      expect(s.gamble.freeSpinDay).toBe(dayKey(T0))
      expect(s.gamble.pot).toBe(0)
      expect(s.stats.spinNet).toBe(stake * 2)
    })

    it('costs nothing on a NaN latent, and the quarter of the house stake is yours', () => {
      const s = spinState({ credits: 100_000 })
      const quarter = Math.round(freeStake(d) * 0.25)
      applySpin(s, d, only(NAN_SEG), T0, rng(), 'free')
      expect(s.credits).toBe(100_000 + quarter)
      expect(s.stats.spinNet).toBe(quarter)
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
        const events = applySpin(s, d, PITY_TABLE, T0 + i, rng(), 1000)
        expect(events[0]).toMatchObject({ outcome: 'nan' })
      }
      expect(s.gamble.dryStreak).toBe(SPIN_PITY_DRY)
      expect(s.flags[NAN_STREAK_FLAG]).toBe(true)
      expect(pityDue(s)).toBe(true)

      const saved = applySpin(s, d, PITY_TABLE, T0 + SPIN_PITY_DRY, rng(), 1000)
      expect(saved[0]).toMatchObject({ outcome: 'half', mult: 0.5, payout: 500 })
      expect(s.gamble.dryStreak).toBe(0)
      expect(pityDue(s)).toBe(false)
    })
  })

  describe('hot sampler', () => {
    it('pays x1.5 after SPIN_HOT_STREAK wins and resets on a loss', () => {
      const s = spinState({ credits: 1_000_000 })
      for (let i = 0; i < SPIN_HOT_STREAK; i++) {
        const events = applySpin(s, d, only(CLEAN_SEG), T0 + i, rng(), 1000)
        expect(events[0]).toMatchObject({ payout: 2000, hot: false })
      }
      expect(s.gamble.winStreak).toBe(SPIN_HOT_STREAK)
      expect(isHot(s)).toBe(true)
      expect(s.flags[HOT_SEED_FLAG]).toBe(true)

      const hot = applySpin(s, d, only(CLEAN_SEG), T0 + SPIN_HOT_STREAK, rng(), 1000)
      expect(hot[0]).toMatchObject({ mult: 2, payout: 1000 * 2 * SPIN_HOT_MULT, hot: true })

      // The dud was still drawn while the sampler was fixed, so the event says so: the quarter
      // carries the x1.5 like any other payout, and the streak ends here.
      const cold = applySpin(s, d, only(NAN_SEG), T0 + SPIN_HOT_STREAK + 1, rng(), 1000)
      expect(cold[0]).toMatchObject({ outcome: 'nan', payout: 1000 * 0.25 * SPIN_HOT_MULT, hot: true })
      expect(s.gamble.winStreak).toBe(0)
      expect(isHot(s)).toBe(false)

      const after = applySpin(s, d, only(CLEAN_SEG), T0 + SPIN_HOT_STREAK + 2, rng(), 1000)
      expect(after[0]).toMatchObject({ payout: 2000, hot: false })
    })

    it('breaks the streak on a below-x2 result', () => {
      const s = spinState({ credits: 1_000_000 })
      applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)
      expect(s.gamble.winStreak).toBe(1)
      applySpin(s, d, only(HALF_SEG), T0 + 1, rng(), 1000)
      expect(s.gamble.winStreak).toBe(0)
      expect(s.gamble.dryStreak).toBe(0)
    })
  })

  describe('pot', () => {
    it('takes a slice of every paid wager', () => {
      const s = spinState({ credits: 1_000_000 })
      applySpin(s, d, only(CLEAN_SEG), T0, rng(), 1000)
      expect(s.gamble.pot).toBe(SPIN_POT_FRACTION * 1000)
      applySpin(s, d, only(CLEAN_SEG), T0 + 1, rng(), 1000)
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

describe('the coin', () => {
  const d = makeDerived({ cps: 4 })
  /** An rng that lands on your side, and one that lands on Comfy's. */
  const yours = () => 0
  const theirs = () => 1

  it('pays double on your side and emits exactly one flip', () => {
    const s = spinState({ credits: 10_000 })
    const events = applyFlip(s, d, T0, yours, 1000)
    expect(events).toEqual([{ type: 'flip', side: 'you', wager: 1000, payout: 1000 * COIN_PAYOUT, streak: 1 }])
    expect(s.credits).toBe(10_000 - 1000 + 1000 * COIN_PAYOUT)
    expect(s.stats.flips).toBe(1)
    expect(s.stats.spinNet).toBe(1000)
  })

  it('keeps the stake on the Comfy side', () => {
    const s = spinState({ credits: 10_000 })
    const events = applyFlip(s, d, T0, theirs, 1000)
    expect(events[0]).toMatchObject({ side: 'comfy', payout: 0, streak: 0 })
    expect(s.credits).toBe(9_000)
    expect(s.stats.spinNet).toBe(-1000)
  })

  it('never moves lifetimeCredits or seasonCredits', () => {
    for (const roll of [yours, theirs]) {
      const s = spinState({ credits: 10_000 })
      const lifetime = s.lifetimeCredits
      const season = s.seasonCredits
      applyFlip(s, d, T0, roll, 1000)
      expect(s.lifetimeCredits).toBe(lifetime)
      expect(s.seasonCredits).toBe(season)
    }
  })

  it('counts a streak and raises the flag at COIN_STREAK_TARGET', () => {
    const s = spinState({ credits: 1_000_000 })
    for (let i = 0; i < COIN_STREAK_TARGET; i++) applyFlip(s, d, T0 + i, yours, 1000)
    expect(s.gamble.coinStreak).toBe(COIN_STREAK_TARGET)
    expect(s.flags[COIN_STREAK_FLAG]).toBe(true)
    applyFlip(s, d, T0, theirs, 1000)
    expect(s.gamble.coinStreak).toBe(0)
  })

  it('feeds the same pot as the wheel', () => {
    const s = spinState({ credits: 10_000 })
    applyFlip(s, d, T0, theirs, 1000)
    expect(s.gamble.pot).toBe(SPIN_POT_FRACTION * 1000)
  })

  it('refuses an illegal bet without touching the state', () => {
    const s = spinState({ level: 1 })
    const before = JSON.stringify(s)
    expect(applyFlip(s, d, T0, yours, 1000)).toEqual([])
    expect(JSON.stringify(s)).toBe(before)
  })

  it('has no free flip', () => {
    const s = spinState()
    expect(applyFlip(s, d, T0, yours, Number.NaN)).toEqual([])
    expect(s.stats.flips).toBe(0)
  })

  it('lands on your side COIN_WIN_CHANCE of the time over 200k flips', () => {
    const s = spinState({ credits: 1e12 })
    const r = mulberry32(3)
    const flips = 200_000
    let wins = 0
    for (let i = 0; i < flips; i++) {
      const events = applyFlip(s, d, T0 + i, r, 100)
      if ((events[0] as { side: string } | undefined)?.side === 'you') wins += 1
    }
    expect(Math.abs(wins / flips - COIN_WIN_CHANCE)).toBeLessThan(0.01)
  })
})

describe('offline and save', () => {
  it('leaves the free spin and the streaks alone across eight hours away', () => {
    const s = createInitialState(T0, 'guest')
    s.credits = 100_000
    s.stats.levelSeen = LOUNGE_MIN_LEVEL
    s.gamble.dryStreak = 2
    s.meta.lastTickAt = T0

    const now = T0 + 8 * HOUR
    const derived = computeDerived(s, CATALOG)
    applyOffline(s, derived, CATALOG, now)

    expect(s.gamble.dryStreak).toBe(2)
    expect(freeSpinAvailable(s, now)).toBe(true)

    const d = makeDerived({ cps: 4 })
    expect(applySpin(s, d, only(CLEAN_SEG), now, rng(), 1000)).toHaveLength(1)
  })

  it('round-trips the gamble block', () => {
    const s = createInitialState(T0, 'guest')
    s.gamble = { freeSpinDay: '2026-09-13', winStreak: 2, dryStreak: 1, coinStreak: 4, pot: 99 }
    const loaded = deserialize(serialize(s), T0, 'guest')
    expect(loaded.gamble).toEqual({ freeSpinDay: '2026-09-13', winStreak: 2, dryStreak: 1, coinStreak: 4, pot: 99 })
  })

  it('loads the defaults from a save written before the Lounge', () => {
    const s = createInitialState(T0, 'guest')
    s.gamble = { freeSpinDay: '2026-09-13', winStreak: 2, dryStreak: 1, coinStreak: 4, pot: 99 }
    const blob = JSON.parse(serialize(s)) as Record<string, unknown>
    delete blob.gamble

    const loaded = deserialize(JSON.stringify(blob), T0, 'guest')
    expect(loaded.gamble).toEqual({
      freeSpinDay: null,
      winStreak: 0,
      dryStreak: 0,
      coinStreak: 0,
      pot: 0,
    })
    expect(freeSpinAvailable(loaded, T0)).toBe(true)
  })
})
