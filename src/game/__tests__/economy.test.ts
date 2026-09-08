import { describe, expect, it } from 'vitest'
import { bulkCost, maxAffordable, paybackSec, unitCost } from '@/game/economy'
import type { Derived, HardwareDef } from '@/game/types'

const rtx3060: HardwareDef = {
  id: 'rtx-3060',
  name: 'RTX 3060 12GB',
  short: '3060',
  family: 'nvidia-consumer',
  vendor: 'nvidia',
  baseCost: 100,
  baseCps: 1,
  growth: 1.12,
  vram: 12,
  watts: 170,
  speedTier: 3,
  flavor: 'The people’s card. Fits flux-dev if you squint (fp8).',
  art: 'hw-rtx-3060',
}

const flat = { baseCost: 50, growth: 1 }

function derivedWith(overrides: Partial<Derived> = {}): Derived {
  return {
    cps: 0,
    rawCps: 0,
    clickValue: 1,
    bestVram: 0,
    bestTier: 1,
    bestHardwareId: null,
    hasGpu: false,
    powerDraw: 0,
    powerBudget: 650,
    throttled: false,
    concurrency: 1,
    speedMult: 1,
    likesMult: 1,
    payoutBonus: 0,
    followRate: 0.05,
    viralChance: 0.05,
    flopChance: 0.15,
    offlineCapHours: 12,
    offlineEfficiency: 0.5,
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
    ...overrides,
  }
}

describe('unitCost', () => {
  it('starts at baseCost and compounds by growth, rounded up', () => {
    expect(unitCost(rtx3060, 0)).toBe(100)
    expect(unitCost(rtx3060, 1)).toBe(112)
    expect(unitCost(rtx3060, 2)).toBe(Math.ceil(100 * 1.12 ** 2))
    expect(unitCost(rtx3060, 10)).toBe(Math.ceil(100 * 1.12 ** 10))
  })

  it('always returns an integer', () => {
    for (let owned = 0; owned < 40; owned++) {
      expect(Number.isInteger(unitCost(rtx3060, owned))).toBe(true)
    }
  })

  it('ignores float noise but still rounds real fractions up', () => {
    // 100 × 1.12 = 112.00000000000001 in IEEE-754; the player should see 112, not 113.
    expect(unitCost({ baseCost: 100, growth: 1.12 }, 1)).toBe(112)
    expect(unitCost({ baseCost: 100, growth: 1.125 }, 1)).toBe(113)
    expect(unitCost({ baseCost: 7, growth: 1.15 }, 1)).toBe(9) // 8.05 → 9
  })
})

describe('bulkCost', () => {
  it('equals the sum of unit costs for n = 1..10 at several ownership levels', () => {
    for (const owned of [0, 1, 5, 17]) {
      for (let n = 1; n <= 10; n++) {
        let expected = 0
        for (let i = 0; i < n; i++) expected += unitCost(rtx3060, owned + i)
        expect(bulkCost(rtx3060, owned, n)).toBe(expected)
      }
    }
  })

  it('is zero for n ≤ 0', () => {
    expect(bulkCost(rtx3060, 3, 0)).toBe(0)
    expect(bulkCost(rtx3060, 3, -2)).toBe(0)
  })

  it('bulkCost(n=1) is unitCost', () => {
    expect(bulkCost(rtx3060, 4, 1)).toBe(unitCost(rtx3060, 4))
  })
})

describe('maxAffordable', () => {
  it('is the inverse of bulkCost', () => {
    for (const owned of [0, 3, 12]) {
      for (let n = 0; n <= 10; n++) {
        const exact = bulkCost(rtx3060, owned, n)
        expect(maxAffordable(rtx3060, owned, exact)).toBe(n)
        if (n > 0) expect(maxAffordable(rtx3060, owned, exact - 1)).toBe(n - 1)
        expect(maxAffordable(rtx3060, owned, exact + unitCost(rtx3060, owned + n) - 1)).toBe(n)
      }
    }
  })

  it('returns 0 with no credits, negative credits or NaN', () => {
    expect(maxAffordable(rtx3060, 0, 0)).toBe(0)
    expect(maxAffordable(rtx3060, 0, -5)).toBe(0)
    expect(maxAffordable(rtx3060, 0, NaN)).toBe(0)
    expect(maxAffordable(rtx3060, 0, 99)).toBe(0)
  })

  it('uses the closed form for flat pricing', () => {
    expect(maxAffordable(flat, 0, 499)).toBe(9)
    expect(maxAffordable(flat, 0, 500)).toBe(10)
    expect(maxAffordable(flat, 100, 1e12)).toBe(2e10)
  })
})

describe('paybackSec', () => {
  it('divides the next unit cost by its effective income', () => {
    expect(paybackSec(rtx3060, derivedWith())).toBe(100)
    expect(paybackSec(rtx3060, derivedWith(), 1)).toBe(112)
  })

  it('applies rig, family and global multipliers', () => {
    const d = derivedWith({
      rigMult: { 'rtx-3060': 2 },
      familyMult: { 'nvidia-consumer': 1.5 },
      globalMult: 2,
    })
    expect(paybackSec(rtx3060, d)).toBeCloseTo(100 / (1 * 2 * 1.5 * 2), 10)
  })

  it('ignores the power throttle and is Infinity for zero income', () => {
    expect(paybackSec(rtx3060, derivedWith({ throttled: true }))).toBe(100)
    expect(paybackSec({ ...rtx3060, baseCps: 0 }, derivedWith())).toBe(Infinity)
  })

  it('strictly decreases along a well-tuned ladder', () => {
    // Each rung earns proportionally more than it costs than the last.
    const ladder: HardwareDef[] = [
      rtx3060,
      { ...rtx3060, id: 'rtx-4090', baseCost: 1_600, baseCps: 20 },
      { ...rtx3060, id: 'rtx-pro-6000', family: 'workstation', baseCost: 10_000, baseCps: 150 },
      { ...rtx3060, id: 'h100-80', family: 'datacenter', baseCost: 30_000, baseCps: 600 },
    ]
    const d = derivedWith()
    const paybacks = ladder.map((def) => paybackSec(def, d))
    for (let i = 1; i < paybacks.length; i++) {
      expect(paybacks[i]).toBeLessThan(paybacks[i - 1] as number)
    }
  })
})
